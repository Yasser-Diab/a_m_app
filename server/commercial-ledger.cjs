const {certificateSessionUser, accessFor, lookup, parse, scopeSql} = require("./certificate-access.cjs");

function commercialAccess(database, req) {
  if (!certificateSessionUser(database, req)) return null;
  const access = accessFor(database, req);
  return access.enabled && access.capabilities.includes("view") ? access : null;
}

function commercialProjects(database, access, filters = {}) {
  if (!access) return [];
  const scope = scopeSql(access, "cp.id");
  const name = lookup(filters.customer);
  const projectName = lookup(filters.project);
  return database.all(`SELECT cp.id, cp.customer_id, cp.name, cp.search_name, cp.alternate_name, cp.code,
    cp.contract_ref, cp.currency, p.display_name AS customer_name, p.base_name AS base_party_name,
    p.category AS party_category
    FROM cert_projects cp JOIN parties p ON p.id=cp.customer_id
    WHERE ${scope.clause} AND (? = '' OR cp.customer_id = ?) AND (? = '' OR cp.currency = ?)
      ${filters.hasReceipts ? `AND (EXISTS (SELECT 1 FROM cert_receipts cr WHERE cr.project_id=cp.id)
        OR EXISTS (SELECT 1 FROM cert_legacy_records lr WHERE lr.project_id=cp.id AND lr.record_type='receipt'))` : ""}
    ORDER BY cp.name, cp.code, cp.id`,
  [...scope.params, filters.party_id || "", filters.party_id || "", filters.currency || "", filters.currency || ""])
    .filter((project) => (!name || [project.customer_name, project.base_party_name].some((value) => {
      const key = lookup(value);
      return filters.exact ? key === name : key.includes(name);
    })) && (!projectName || [project.name, project.alternate_name, project.code].some((value) => lookup(value) === projectName))
      && (!filters.category || project.party_category === filters.category));
}

function priorPayments(database, project) {
  const projectNames = new Set([project.name, project.alternate_name, project.code].map(lookup).filter(Boolean));
  const related = database.all("SELECT name, alternate_name, code FROM cert_projects WHERE customer_id=?", [project.customer_id]);
  for (const name of projectNames) {
    if (related.filter((entry) => [entry.name, entry.alternate_name, entry.code].some((value) => lookup(value) === name)).length !== 1)
      projectNames.delete(name);
  }
  if (!projectNames.size || project.currency !== "EGP") return [];
  return database.all(`SELECT wi.id, COALESCE(wi.entry_date,d.entry_date) AS received_at,
    COALESCE(NULLIF(wi.project,''),d.project) AS project, COALESCE(NULLIF(wi.building_unit,''),d.building_unit) AS location,
    COALESCE(d.operation_no,wi.operation_no,wi.serial) AS reference,
    ROUND(ABS(wi.collection_amount) * 100) AS amount_minor
    FROM work_items wi LEFT JOIN documents d ON d.id=wi.document_id
    WHERE wi.deleted_at IS NULL AND d.deleted_at IS NULL AND COALESCE(wi.collection_amount,0) <> 0
      AND COALESCE(wi.party_role,d.party_role,'customer')='customer'
      AND (wi.party_id=? OR (wi.party_id IS NULL AND d.party_id=?))`, [project.customer_id, project.customer_id])
    .filter((row) => projectNames.has(lookup(row.project)))
    .map((row) => ({...row, id:`payment-${row.id}`, kind:"receipt", status:"cleared", cleared_at:row.received_at,
      received_at:String(row.received_at || "").slice(0, 10), source:"payment"}));
}

function importedReceipts(database, project, existing = []) {
  const known = new Set(existing.filter((row) => row.reference && row.kind !== "reversal")
    .map((row) => JSON.stringify([lookup(row.reference), row.received_at, row.amount_minor])));
  return database.all(`SELECT rowid, amount_minor, data_json FROM cert_legacy_records
    WHERE project_id=? AND record_type='receipt'`, [project.id]).flatMap((row) => {
    const entry = parse(row.data_json);
    const date = String(entry.date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !row.amount_minor) return [];
    if (entry.reference && known.has(JSON.stringify([lookup(entry.reference), date, row.amount_minor]))) return [];
    return [{id:`receipt-import-${row.rowid}`, received_at:date, cleared_at:date, kind:entry.kind === "advance" ? "advance" : "receipt",
      status:"cleared", amount_minor:row.amount_minor, reference:entry.reference || "", location:entry.location, source:"historical"}];
  });
}

function customerReceipts(database, project) {
  const active = database.all("SELECT * FROM cert_receipts WHERE project_id=? ORDER BY received_at,id", [project.id]);
  const prior = priorPayments(database, project);
  return {active, prior, imported: importedReceipts(database, project, [...active, ...prior])};
}

function receiptPaymentRow(project, row) {
  const reversal = row.kind === "reversal";
  const id = typeof row.id === "number" ? `certificate-receipt-${row.id}` : row.id;
  return {id, document_id:id, document_no:row.reference || row.id,
    source:"certificate_receipt", receipt_id:row.id, kind:row.kind, status:row.status,
    document_type:"payment", party_id:project.customer_id, party_role:"customer", party_category:project.party_category,
    customer_name:project.customer_name, customer_display_name:project.customer_name, base_party_name:project.base_party_name,
    project:project.name, project_id:project.id, building_unit:row.location || "", currency:project.currency,
    entry_date:row.received_at, collection_amount:(reversal ? -row.amount_minor : row.amount_minor) / 100,
    collection_note:row.reference || ""};
}

function projectPaymentRows(database, access, filters) {
  if (!access?.capabilities.includes("view_collections") || (filters.role && filters.role !== "customer")) return [];
  return commercialProjects(database, access, {...filters, hasReceipts:true}).flatMap((project) => {
    const {active, imported} = customerReceipts(database, project);
    return [...active, ...imported].map((row) => receiptPaymentRow(project, row));
  });
}

module.exports = {commercialAccess, commercialProjects, customerReceipts, projectPaymentRows};
