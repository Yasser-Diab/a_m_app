const {audit, date, fail, idOf, lookup, parse, setting, setSetting, str, today} = require("./certificate-access.cjs");
const {money, toMinor} = require("./certificate-valuation.cjs");
const {checkedLocation, getProject} = require("./certificate-projects.cjs");
const {customerReceipts, workbookReceipt} = require("./commercial-ledger.cjs");

const DATE_FLOOR = "0001-01-01";

function allocationLedger(database, projectId, profile, cutoff, options = {}) {
  const {workCutoff = cutoff,previousCutoff = DATE_FLOOR,locationId = null,revisionId = null,seriesKey = null,
    includeImported = () => true, includeReceipt = () => true} = options;
  const clearance = profile.settings.collections_basis === "cleared";
  const project = getProject(database,projectId);
  const {active, prior, imported} = customerReceipts(database, project);
  const location = locationId === null ? null : database.get(
    "SELECT name, code FROM cert_locations WHERE project_id=? AND id=?", [projectId,locationId]);
  const locationNames = new Set([lookup(location?.name), lookup(location?.code)].filter(Boolean));
  const external = [...prior, ...imported.filter(includeImported)].filter((row) => row.received_at && row.received_at <= cutoff &&
    (locationId === null || locationNames.has(lookup(row.location))));
  const entries = [...active, ...external].filter((row) => row.received_at <= cutoff && includeReceipt(row))
    .sort((left, right) => left.received_at.localeCompare(right.received_at));
  const ids = new Set(active.map(({id}) => id));
  const allocations = database.all(`SELECT a.*,r.location_id AS certificate_location_id,r.series_key AS certificate_series
    FROM cert_receipt_allocations a LEFT JOIN cert_revisions r ON r.id=a.certificate_id
    WHERE a.project_id=? AND (a.allocated_at IS NULL OR a.allocated_at<=?) ORDER BY a.id`, [projectId,cutoff])
    .filter((entry) => ids.has(entry.receipt_id));
  const grouped = new Map();
  for (const entry of allocations) {
    const list = grouped.get(entry.receipt_id) || [];
    list.push(entry);
    grouped.set(entry.receipt_id, list);
  }
  const eligibleAt = (row) => clearance ? row.cleared_at : row.received_at;
  const eligible = (row) => row && row.status !== "pending" && (!clearance || row.status === "cleared") &&
    eligibleAt(row) && eligibleAt(row) <= cutoff;
  const reversals = new Map(entries.filter((row) => row.reverses_id && eligible(row)).map((row) => [row.reverses_id, row]));
  const recovered = new Map(database.all(`
    SELECT a.advance_id,SUM(a.amount_minor) AS sum FROM cert_advance_recoveries a
    JOIN cert_revisions r ON r.id=a.certificate_id
    WHERE a.project_id=? AND r.status IN ('approved','issued') AND r.work_to<=?
      AND (? IS NULL OR r.location_id IS ?) AND (? IS NULL OR r.series_key=?)
    GROUP BY a.advance_id`, [projectId,workCutoff,locationId,locationId,seriesKey,seriesKey]).map((row) => [row.advance_id,row.sum]));
  const recoveredAll = new Map(database.all(`
    SELECT advance_id,SUM(amount_minor) AS sum FROM cert_advance_recoveries
    WHERE project_id=? GROUP BY advance_id`, [projectId]).map((row) => [row.advance_id,row.sum]));
  const closedAdvances = new Set(database.all("SELECT reverses_id FROM cert_receipts WHERE project_id=? AND reverses_id IS NOT NULL",[projectId]).map((row) => row.reverses_id));
  let ordinary = 0;
  let period = 0;
  let unapplied = 0;
  let released = 0;
  let periodReleased = 0;
  let advancePrincipal = 0;
  const advances = [];
  const recognizedAmounts = new Map();
  for (const row of entries) {
    if (!eligible(row) || row.kind === "reversal") continue;
    const reversal = reversals.get(row.id);
    const links = grouped.get(row.id) || [];
    const unappliedAmount = row.amount_minor - links.reduce((sum, entry) => sum + entry.amount_minor, 0);
    const eligibleLocation = (entry) => {
      const allocationLocation = entry.location_id ?? entry.certificate_location_id;
      return (!seriesKey || !entry.certificate_id || seriesKey === entry.certificate_series) &&
        (locationId === null || allocationLocation === locationId || (entry.certificate_id && entry.certificate_id === revisionId));
    };
    const amount = (locationId === null || row.source ? unappliedAmount : 0) +
      links.filter(eligibleLocation).reduce((sum, link) => sum + link.amount_minor, 0);
    if (amount > 0) {
      recognizedAmounts.set(row.id,amount);
      if (reversal) recognizedAmounts.set(reversal.id,-amount);
    }
    if (row.kind === "advance") {
      if (!reversal) {
        advancePrincipal += amount;
        if (typeof row.id === "number") advances.push({id: row.id, principal_minor: amount, recovered_minor: recovered.get(row.id) || 0,
          outstanding_minor: Math.max(0,amount - (recovered.get(row.id) || 0)),
          available_minor: closedAdvances.has(row.id) ? 0 : Math.max(0,row.amount_minor - (recoveredAll.get(row.id) || 0))});
      }
      else {
        const releasedAmount = recovered.get(row.id) || 0;
        released += releasedAmount;
        if (eligibleAt(reversal) > previousCutoff) periodReleased += releasedAmount;
      }
      continue;
    }
    ordinary += reversal ? 0 : amount;
    unapplied += reversal ? 0 : unappliedAmount;
    if (eligibleAt(row) > previousCutoff) period += amount;
    if (reversal && eligibleAt(reversal) > previousCutoff) period -= amount;
  }
  return {ordinary_minor: ordinary, period_ordinary_minor: period, unapplied_minor: unapplied,
    advances, advance_principal_minor:advancePrincipal, released_recovery_minor: released,
    period_released_recovery_minor: periodReleased, entries, allocations, recognizedAmounts};
}

function publicReceipt(row) {
  return {...row, amount: money(row.amount_minor)};
}

function normalizeAllocations(database, projectId, entries, available) {
  if (!Array.isArray(entries) || entries.length > 200) fail(400, "Invalid receipt allocations");
  let allocated = 0;
  const allocations = entries.map((item) => {
    const locationId = checkedLocation(database, projectId, idOf(item.location_id));
    const certification = idOf(item.certificate_id);
    if (certification) {
      const cert = database.get("SELECT status,location_id FROM cert_revisions WHERE project_id=? AND id=?", [projectId,certification]);
      if (!cert || cert.status !== "issued" || (cert.location_id && locationId && cert.location_id !== locationId))
        fail(400, "Allocation certificate must be issued in this location and project");
    }
    const part = toMinor(item.amount);
    if (!part || part <= 0) fail(400, "Allocation amount must be positive");
    allocated += part;
    return {locationId,certification,part};
  });
  if (allocated > available) fail(400, "Allocated amount exceeds the remaining unapplied balance");
  return {allocations,allocated};
}

function storeAllocations(database, projectId, receiptId, at, rows) {
  for (const item of rows) database.run(`INSERT INTO cert_receipt_allocations
    (project_id,receipt_id,amount_minor,location_id,certificate_id,allocated_at) VALUES (?,?,?,?,?,?)`,
  [projectId,receiptId,item.part,item.locationId,item.certification,at]);
}

const lastReceiptIdSetting = "certificates_last_receipt_id";

function addReceipt(database, project, input, user) {
  const kind = ["receipt","advance","reversal"].includes(input.kind) ? input.kind : "receipt";
  const key = str(input.command_key, 200);
  if (key) {
    const found = database.get("SELECT * FROM cert_receipts WHERE project_id=? AND created_by=? AND command_key=?", [project.id,user.id,key]);
    if (found) return publicReceipt(found);
  }
  const reversesId = idOf(input.reverses_id);
  const original = reversesId ? database.get("SELECT * FROM cert_receipts WHERE project_id=? AND id=?", [project.id,reversesId]) : null;
  if (kind === "reversal" && (!original || original.kind === "reversal")) fail(400, "Select a receipt or advance to reverse");
  if (kind !== "reversal" && reversesId) fail(400, "Only a reversal may reference an earlier receipt");
  if (original && database.get("SELECT 1 FROM cert_receipts WHERE reverses_id=?", [original.id])) fail(409, "This receipt was already reversed");
  const amount = kind === "reversal" ? original.amount_minor : toMinor(input.amount);
  if (!amount || amount <= 0) fail(400, "The receipt amount must be positive");
  const received = date(input.received_at || input.date || today());
  if (original && received < original.received_at) fail(400, "A reversal cannot precede the original receipt");
  const cleared = date(input.cleared_at, true);
  const due = date(input.due_at, true);
  if (cleared && cleared < received) fail(400, "Clearance cannot precede receipt");
  const status = ["pending","received","cleared"].includes(input.status) ? input.status : "received";
  if (status === "cleared" && !cleared) fail(400, "Clearance date is required for a cleared receipt");
  if (kind === "reversal" && status === "pending") fail(400, "Post a reversal as received or cleared");
  const supplied = input.allocations === undefined ? [] : input.allocations;
  if (kind === "reversal" && supplied?.length) fail(400, "A reversal inherits its original allocations");
  const {allocations,allocated} = normalizeAllocations(database,project.id,supplied,amount);
  const last = database.get("SELECT MAX(id) AS id FROM cert_receipts").id || 0;
  const receiptId = Math.max(last, Number(setting(database,lastReceiptIdSetting,"0")) || 0) + 1;
  database.run(`INSERT INTO cert_receipts
    (id,project_id,kind,amount_minor,received_at,cleared_at,due_at,currency,status,method,reference,evidence,command_key,reverses_id,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  [receiptId,project.id,kind,amount,received,cleared,due,project.currency,status,str(input.method),str(input.reference),
    str(input.evidence,2000),key || null,reversesId,user.id]);
  storeAllocations(database,project.id,receiptId,received,allocations);
  audit(database, user, kind + "_posted", {projectId:project.id, reason:input.reason,
    details:{receipt_id:receiptId, amount_minor:amount, allocated_minor:allocated, reverses_id:reversesId}});
  return publicReceipt(database.get("SELECT * FROM cert_receipts WHERE id=?", [receiptId]));
}

function updateReceipt(database, project, receiptId, input, user) {
  const receipt = database.get("SELECT * FROM cert_receipts WHERE project_id=? AND id=?", [project.id,receiptId]);
  if (!receipt) fail(404,"Receipt not found");
  const action = str(input.action);
  const commandKey = str(input.command_key,180);
  if (commandKey && database.get(`
    SELECT 1 FROM cert_audit WHERE project_id=? AND actor_id=? AND action=?
     AND json_extract(details_json,'$.receipt_id')=? AND json_extract(details_json,'$.command_key')=?
  `,[project.id,user.id,"receipt_"+action,receiptId,commandKey])) return publicReceipt(receipt);
  const reversed = database.get("SELECT 1 FROM cert_receipts WHERE reverses_id=?",[receiptId]);
  if (reversed) fail(409,"Cannot change a reversed receipt");
  if (action === "clear") {
    const cleared = date(input.cleared_at);
    if (cleared < receipt.received_at) fail(400,"Clearance cannot precede receipt");
    if (receipt.status === "cleared" && receipt.cleared_at !== cleared) fail(409,"Receipt already cleared at a different date");
    database.run("UPDATE cert_receipts SET status='cleared',cleared_at=? WHERE id=?",[cleared,receiptId]);
    audit(database,user,"receipt_clear",{projectId:project.id,details:{receipt_id:receiptId,cleared_at:cleared,command_key:commandKey}});
  } else if (action === "allocate") {
    if (receipt.kind === "reversal") fail(400,"A reversal inherits its original allocations");
    const at = date(input.allocated_at,true) || today();
    if (at < receipt.received_at) fail(400,"Allocation cannot precede receipt");
    const existing = database.get("SELECT COALESCE(SUM(amount_minor),0) AS total FROM cert_receipt_allocations WHERE receipt_id=?",[receiptId]).total;
    const {allocations,allocated} = normalizeAllocations(database,project.id,input.allocations,receipt.amount_minor-existing);
    if (!allocations.length) fail(400,"Add at least one allocation");
    storeAllocations(database,project.id,receiptId,at,allocations);
    audit(database,user,"receipt_allocate",{projectId:project.id,details:{receipt_id:receiptId,allocated_at:at,
      allocated_minor:allocated,command_key:commandKey}});
  } else fail(400,"Unknown receipt action");
  return publicReceipt(database.get("SELECT * FROM cert_receipts WHERE id=?",[receiptId]));
}

function changeReceipt(database, project, receiptId, input, user) {
  const importedId = receiptId.match(/^receipt-import-(\d+)$/)?.[1];
  const imported = importedId ? database.get(`SELECT rowid,amount_minor,data_json FROM cert_legacy_records
    WHERE project_id=? AND record_type='receipt' AND rowid=?`, [project.id,idOf(importedId)]) : null;
  const receipt = imported ? workbookReceipt(imported) : database.get("SELECT * FROM cert_receipts WHERE project_id=? AND id=?",[project.id,idOf(receiptId)]);
  if (!receipt) fail(404,"Receipt not found");
  if (!imported && database.get("SELECT 1 FROM cert_receipts WHERE reverses_id=?",[receipt.id]))
    fail(409,"Remove the reversal before changing this payment");
  if (!imported && database.get("SELECT 1 FROM cert_advance_recoveries WHERE advance_id=?",[receipt.id]))
    fail(409,"This advance has a recovery in a certificate");
  const recognized = database.get(`SELECT 1 FROM cert_revisions r LEFT JOIN cert_legacy_workflow h ON h.revision_id=r.id
    WHERE r.project_id=? AND (r.status IN ('approved','issued') OR h.approved_at IS NOT NULL)
    AND EXISTS (SELECT 1 FROM json_each(COALESCE(h.approved_json,r.snapshot_json),'$.receipts') p
      WHERE json_extract(p.value,'$.id')=?) LIMIT 1`,[project.id,receipt.id]);
  if (recognized) fail(409,"This payment is included in an approved certificate. Record a reversal or correct the certificate first");

  if (!input) {
    if (imported) database.run("DELETE FROM cert_legacy_records WHERE rowid=?",[imported.rowid]);
    else {
      const lastDeleted = Number(setting(database,lastReceiptIdSetting,"0")) || 0;
      if (receipt.id > lastDeleted) setSetting(database,lastReceiptIdSetting,String(receipt.id));
      database.run("DELETE FROM cert_receipt_allocations WHERE receipt_id=?",[receipt.id]);
      database.run("DELETE FROM cert_receipts WHERE id=?",[receipt.id]);
    }
    audit(database,user,"receipt_deleted",{projectId:project.id,details:{receipt_id:receipt.id,amount_minor:receipt.amount_minor}});
    return {deleted:true};
  }

  if (receipt.kind === "reversal") fail(409,"A reversal must keep its original payment values");
  const saved = {...receipt,...input};
  const amount = Object.hasOwn(input,"amount") ? toMinor(input.amount) : receipt.amount_minor;
  if (!(amount > 0)) fail(400,"The receipt amount must be positive");
  if (!["receipt","advance"].includes(saved.kind)) fail(400,"Select a valid receipt type");
  if (!["pending","received","cleared"].includes(saved.status)) fail(400,"Select a valid receipt status");
  const received = date(saved.received_at);
  const cleared = date(saved.cleared_at,true);
  const due = date(saved.due_at,true);
  if (cleared && cleared < received) fail(400,"Clearance cannot precede receipt");
  if (saved.status === "cleared" && !cleared) fail(400,"Clearance date is required for a cleared receipt");
  const method = str(saved.method), reference = str(saved.reference), evidence = str(saved.evidence,2000);
  if (imported) {
    const source = parse(imported.data_json);
    const data = {...source,kind:saved.kind,status:saved.status,date:received,due_date:due,cleared_at:cleared,
      reference,method,evidence,amount:money(amount)};
    database.run("UPDATE cert_legacy_records SET amount_minor=?,data_json=? WHERE rowid=?",[amount,JSON.stringify(data),imported.rowid]);
  } else {
    const allocations = database.get(`SELECT SUM(amount_minor) AS amount,MIN(allocated_at) AS first_date
      FROM cert_receipt_allocations WHERE receipt_id=?`,[receipt.id]);
    if (allocations.amount > amount) fail(400,"Amount cannot be less than the allocated balance");
    if (allocations.first_date && allocations.first_date < received) fail(400,"Receipt date cannot be after an allocation");
    database.run(`UPDATE cert_receipts SET kind=?,amount_minor=?,received_at=?,cleared_at=?,due_at=?,status=?,method=?,reference=?,evidence=? WHERE id=?`,
      [saved.kind,amount,received,cleared,due,saved.status,method,reference,evidence,receipt.id]);
  }
  audit(database,user,"receipt_edited",{projectId:project.id,details:{receipt_id:receipt.id,previous_amount_minor:receipt.amount_minor,amount_minor:amount}});
  return {id:receipt.id,amount:money(amount)};
}

function collectionResponse(database, project, ledger, cutoff) {
  return {
    cutoff, project_id: project.id,
    ordinary_collections: money(ledger.ordinary_minor), unapplied: money(ledger.unapplied_minor),
    receipts: ledger.entries.map(publicReceipt),
    allocations: ledger.allocations.map((row) => ({...row,amount:money(row.amount_minor)})),
    advances: ledger.advances.map((row) => ({...row,principal:money(row.principal_minor),
      recovered:money(row.recovered_minor),outstanding:money(row.outstanding_minor)})),
  };
}

module.exports = {allocationLedger, addReceipt, updateReceipt, changeReceipt, collectionResponse, DATE_FLOOR};
