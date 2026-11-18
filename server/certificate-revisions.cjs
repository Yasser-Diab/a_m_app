const crypto = require("node:crypto");
const {certificateReportOptions} = require("./certificate-document-model.cjs");
const {audit, date, encode, fail, idOf, lookup, nextCertificateId, now, parse, setting, str, today} = require("./certificate-access.cjs");
const {getProject, getCustomer, getProfile, projectLocations, cleanRules, checkedLocation} = require("./certificate-projects.cjs");
const {allocationLedger, DATE_FLOOR} = require("./certificate-ledger.cjs");
const {calculateValuation, MODES, decimal, money, toMinor} = require("./certificate-valuation.cjs");
const {legacySnapshot, legacyLines, legacyCertificateInput} = require("./certificate-history.cjs");
const {certificateLocationFields} = require("./document-locations.cjs");
const {reconcile: reconcileOperations} = require("./project-operations/finance.cjs");
const {nextSeriesNumber,certificateNumber}=require("./certificate-numbering.cjs");

function normalizeHeader(input = {}, project, profile, originalType) {
  const type = originalType && !["progress", "final"].includes(originalType) ? originalType :
    input.type === "final" ? "final" : "progress";
  const workFrom = date(input.work_from, true);
  const workTo = date(input.work_to, true) || today();
  const cutoff = date(input.collection_cutoff, true) || workTo;
  if (workFrom && workFrom > workTo) fail(400, "Work start date follows the work cutoff");
  const header = {type, work_from: workFrom, work_to: workTo, collection_cutoff: cutoff,
    locale: input.locale === "en" ? "en" : "ar", currency: project.currency,
    contract_ref: str(input.contract_ref ?? project.contract_ref), location_id: idOf(input.location_id),
    title: str(input.title), notes: str(input.notes, 3000),
    paper_size: input.paper_size === "Letter" ? "Letter" : "A4",
    output_mode: ["auto", "cover", "detail"].includes(input.output_mode) ? input.output_mode : profile.settings.output_mode,
    group_work_types: input.group_work_types ?? profile.settings.group_work_types ?? false,
    show_group_subtotals: input.show_group_subtotals ?? profile.settings.show_group_subtotals ?? false,
    optional_fields: {},
  };
  if (type==="correction"&&input.recover_advance===true) header.recover_advance=true;
  if (["none","building","unit","work_type"].includes(input.group_by ?? profile.settings.group_by))
    header.group_by = input.group_by ?? profile.settings.group_by;
  for (const key of ["show_building_subtotals", "show_unit_subtotals", "show_work_type_subtotals"]) {
    const flag = input[key] ?? profile.settings[key];
    if (typeof flag === "boolean") header[key] = flag;
  }
  if (input.optional_fields && typeof input.optional_fields === "object") {
    for (const key of ["customer_code","customer_address","tax_no","customer_tax_no","customer_contact","project_code",
      "project_address","contract_ref","contract_date","location","currency","notes"]) {
      if (Object.hasOwn(input.optional_fields, key)) header.optional_fields[key] = input.optional_fields[key] !== false;
    }
  }
  if (input.rule_override != null) {
    if (!str(input.override_reason)) fail(400, "A financial override requires a reason");
    header.rule_override = cleanRules(input.rule_override);
    header.override_reason = str(input.override_reason, 2000);
  }
  return header;
}

const scopeKey = (header) => lookup(header.contract_ref);

function normalizeLines(database, project, header, candidates) {
  if (!Array.isArray(candidates) || candidates.length > 2500) fail(400, "Provide up to 2,500 work rows");
  const locations = new Map(projectLocations(database, project.id).map((row) => [row.id, row]));
  const ids = new Set();
  const identities = new Set();
  return candidates.filter((line) => !line?.carried_forward).map((input) => {
    const row = input && typeof input === "object" ? input : {};
    const lineId = str(row.id, 120) || crypto.randomUUID();
    const identity = str(row.identity, 150) || lineId;
    if (ids.has(lineId) || identities.has(identity)) fail(400, "Work row IDs and measurement identities must be unique");
    ids.add(lineId);
    identities.add(identity);
    const suppliedLocation = idOf(row.location_id);
    if (suppliedLocation && !locations.has(suppliedLocation)) fail(400, "Work row location is outside the certificate scope");
    const usesRowFields = Object.hasOwn(row,"building_unit") || Object.hasOwn(row,"floor_apartment");
    const fields = usesRowFields ? certificateLocationFields({building_unit:str(row.building_unit),floor_apartment:str(row.floor_apartment)}) : {};
    let locationId = suppliedLocation || header.location_id;
    if (usesRowFields) {
      const name = [fields.building_unit,fields.floor_apartment].filter(Boolean).join(" › ");
      const direct = [...locations.values()].filter((location) => name && lookup(location.label) === lookup(name));
      const buildings = [...locations.values()].filter((location) => fields.building_unit &&
        location.kind === "building" && lookup(location.name) === lookup(fields.building_unit));
      if (direct.length === 1) locationId = direct[0].id;
      else if (buildings.length === 1) locationId = buildings[0].id;
      else locationId = header.location_id;
      if (header.location_id && name && locationId === header.location_id && direct.length !== 1 && buildings.length !== 1) {
        const expected = certificateLocationFields({location:locations.get(header.location_id)?.label});
        if (lookup(fields.building_unit) !== lookup(expected.building_unit) ||
            (expected.floor_apartment && lookup(fields.floor_apartment) !== lookup(expected.floor_apartment)))
          fail(400,"Work row building or unit is outside the certificate scope");
      }
    }
    let ancestor = locationId;
    while (ancestor && ancestor !== header.location_id) ancestor = locations.get(ancestor)?.parent_id;
    if ((locationId && !locations.has(locationId)) || (header.location_id && ancestor !== header.location_id))
      fail(400, "Work row location is outside the certificate scope");
    const line = {id: lineId, identity, location_id: locationId,
      location: (usesRowFields && [fields.building_unit,fields.floor_apartment].filter(Boolean).join(" › ")) || locations.get(locationId)?.label || "", ...fields,
      work_type: str(row.work_type), work_item: str(row.work_item), description: str(row.description, 3000),
      mode: MODES.has(row.mode) ? row.mode : "direct", dimension_unit: str(row.dimension_unit, 20),
      unit: str(row.unit, 60), recognition: row.recognition === "cumulative" ? "cumulative" : "incremental",
      reason: str(row.reason, 2000), note: str(row.note, 2000), source: str(row.source, 300),
    };
    for (const key of ["width","height","count","quantity","rate","agreed_amount","progress","claim_amount","adjustment_amount","override_quantity"]) {
      line[key] = row[key] == null || row[key] === "" ? null : str(row[key], 60);
    }
    if (row.ops_item_id) {
      const opsId=idOf(row.ops_item_id);
      if (!opsId || !database.get("SELECT 1 FROM ops_items WHERE id=? AND project_id=?",[opsId,project.id]))
        fail(400,"The linked operational item is outside this project");
      line.ops_item_id=opsId;
    }
    return line;
  });
}

function getRevision(database, id) {
  const revision = database.get("SELECT * FROM cert_revisions WHERE id=?", [idOf(id)]);
  if (!revision) fail(404, "Certificate not found");
  return revision;
}

function getLines(database, id) {
  return database.all("SELECT data_json FROM cert_lines WHERE revision_id=? ORDER BY position", [id])
    .map((row) => parse(row.data_json));
}

function replaceLines(database, id, lines) {
  database.run("DELETE FROM cert_lines WHERE revision_id=?", [id]);
  const insert = database.db.prepare(`
    INSERT INTO cert_lines (revision_id,id,position,location_id,identity,data_json) VALUES (?,?,?,?,?,?)
  `);
  try {
    lines.forEach((line, index) => insert.run([id, line.id, index, line.location_id, line.identity, encode(line)]));
  } finally {
    insert.free();
  }
}

function scopeBaseline(database, row, header) {
  if (row.revises_id) {
    const parent = getRevision(database, row.revises_id);
    if (parent.status === "historical") return legacyCertificateInput(database,parent,{useEdits:false});
    if (["approved","issued"].includes(parent.status)) return certificateDocumentInput(database,parent);
  }
  const prior = database.get(`
    SELECT snapshot_json FROM cert_revisions WHERE project_id=? AND series_key=? AND location_id IS ?
      AND id<>? AND status IN ('approved','issued') AND snapshot_json IS NOT NULL AND work_to<=?
      AND (work_to<? OR COALESCE(root_id,id)<COALESCE(?,?))
    ORDER BY work_to DESC,COALESCE(root_id,id) DESC,revision DESC,issued_at DESC,id DESC LIMIT 1
  `, [row.project_id, scopeKey(header), header.location_id, row.id, header.work_to,header.work_to,row.root_id,row.id]);
  if (prior) return parse(prior.snapshot_json);
  const earlier = header.location_id == null && database.get(`SELECT * FROM cert_revisions
    WHERE project_id=? AND series_key=? AND status='historical' AND work_to<=?
    ORDER BY work_to DESC,CAST(legacy_number AS INTEGER) DESC,id DESC LIMIT 1`,
  [row.project_id,scopeKey(header),header.work_to]);
  return earlier ? legacyCertificateInput(database,earlier,{useEdits:false}) : null;
}

function certificateDocumentInput(database, row, lines = null) {
  if (row.status === "historical")
    return {...legacyCertificateInput(database,row),version:row.version,pdf_status:row.pdf_status};
  if (row.snapshot_json) {
    return {...parse(row.snapshot_json),version:row.version,pdf_status:row.pdf_status};
  }
  const header = parse(row.header_json);
  const project = getProject(database, row.project_id);
  const customer = getCustomer(database, project.customer_id);
  const profile = getProfile(database, project.id, row.rules_version == null ? today() : header.work_to, row.rules_version);
  if (header.rule_override) profile.rules = header.rule_override;
  const baseline = scopeBaseline(database, row, header);
  if (header.recover_advance) {
    profile.rules=profile.rules.filter(({category})=>category==="advance_recovery");
    profile.settings={...profile.settings,collections_basis:baseline?.rule_settings?.collections_basis||profile.settings.collections_basis};
  }
  const ledger = allocationLedger(database,project.id,profile,header.collection_cutoff,{workCutoff:header.work_to,
    previousCutoff:baseline?.header?.collection_cutoff ?? DATE_FLOOR,locationId:header.location_id,revisionId:row.id,seriesKey:row.series_key});
  const calculated = calculateValuation(lines || getLines(database, row.id), baseline, profile, ledger,{recoverAdvance:header.recover_advance===true});
  const validation = [...calculated.errors];
  if (!calculated.lines.some((line) => !line.carried_forward) && row.type !== "reopen"&&!header.recover_advance)
    validation.push({field:"lines", message:"Enter at least one work row"});
  if (baseline?.header?.collection_cutoff > header.collection_cutoff)
    validation.push({field:"collection_cutoff", message:"Collections cutoff precedes the prior issued cutoff"});
  const incompatible = database.get(`SELECT 1 FROM cert_revisions WHERE project_id=? AND series_key=?
    AND status IN ('approved','issued') AND ((location_id IS NULL) <> (? IS NULL)) LIMIT 1`, [project.id,row.series_key,header.location_id]);
  if (incompatible) validation.push({field:"location_id", message:"The series already uses a different project or location valuation scope"});
  const newer = database.get(`SELECT 1 FROM cert_revisions WHERE project_id=? AND series_key=?
    AND location_id IS ? AND status IN ('approved','issued') AND work_to>? LIMIT 1`, [project.id, row.series_key, header.location_id, header.work_to]);
  if (newer) validation.push({field:"work_to", message:"Work cutoff precedes a later issued certificate in this scope"});
  const receipts = recognizedReceipts(ledger);
  const actualLocation = projectLocations(database, project.id).find((entry) => entry.id === header.location_id);
  const operations = reconcileOperations(database,project.id,{lines:calculated.lines,revisionId:row.id,cutoff:header.work_to});
  const issuerProfile = parse(setting(database, "company_profile", "{}"), {});
  const branding = parse(setting(database,"report_branding","{}"), {});
  return {
    id: row.id, project_id: row.project_id, status: row.status, revision: row.revision,certificate_number:certificateNumber(database,row),
    version: row.version, revises_id: row.revises_id, type: row.type, locale: row.locale,
    official_number: row.official_number, issued_at: row.issued_at, updated_at:row.updated_at,
    header: {...header, location: actualLocation?.label || ""}, project, customer,
    issuer: {company_name:issuerProfile.company_name, address:issuerProfile.address, website:issuerProfile.website,
      phone:issuerProfile.phone,email:issuerProfile.email,logo_data_url:branding.logoDataUri},
    pdf_status: row.pdf_status, lines: calculated.lines, totals: calculated.totals,
    validation, recoveries: calculated.recoveries, receipts, operational_quantities: operations,
    applied_rules: profile.rules, rule_version: profile.version, rule_settings: profile.settings,
    baseline: baseline ? {id: baseline.id, official_number: baseline.official_number||baseline.certificate_number||
      certificateNumber(database,getRevision(database,baseline.id)), revision: baseline.revision,
      work_to: baseline.header.work_to, collection_cutoff: baseline.header.collection_cutoff} : null,
  };
}

function previewOperationalQuantities(database,project,body) {
  const revisionId=idOf(body.revision_id);
  const revision=revisionId?getRevision(database,revisionId):null;
  if (revision && revision.project_id!==project.id) fail(404,"Certificate not found");
  const profile=getProfile(database,project.id,date(body.header?.work_to,true)||today(),revision?.rules_version);
  const header=normalizeHeader(body.header,project,profile,revision?.type);
  const lines=normalizeLines(database,project,header,body.lines||[]);
  const baseline=revision?scopeBaseline(database,revision,header):null;
  const {lines:calculated}=calculateValuation(lines,baseline,{...profile,rules:[]},
    {ordinary_minor:0,period_ordinary_minor:0,advances:[]});
  return reconcileOperations(database,project.id,{lines:calculated,revisionId,cutoff:header.work_to});
}

function recognizedReceipts(ledger) {
  return ledger.entries.filter((entry) => ledger.recognizedAmounts.has(entry.id))
    .map((entry) => ({id:entry.id,kind:entry.kind,date:entry.received_at,received_at:entry.received_at,
      cleared_at:entry.cleared_at,status:entry.status,amount:money(ledger.recognizedAmounts.get(entry.id)),
      method:entry.method,reference:entry.reference}));
}

function carryForwardLines(database,project,input) {
  const profile=getProfile(database,project.id),header=normalizeHeader(input,project,profile);
  checkedLocation(database,project.id,header.location_id);
  const baseline=scopeBaseline(database,{id:0,root_id:Number.MAX_SAFE_INTEGER,project_id:project.id,series_key:scopeKey(header)},header);
  if(!baseline)return {lines:[],baseline:null};
  const result=calculateValuation([],baseline,{...profile,rules:[]},{ordinary_minor:0,period_ordinary_minor:0,advances:[]});
  return {lines:result.lines,baseline:{id:baseline.id,work_to:baseline.header.work_to}};
}

function createDraft(database, project, body, user, revision = {}) {
  if (project.historical_only && !revision.revisesId) fail(409, "Add the missing project details before creating a new certificate");
  const supplied = body.header || {};
  const profile = getProfile(database, project.id);
  const header = normalizeHeader(supplied, project, profile, revision.type);
  const seriesKey = scopeKey(header);
  const series = database.get("SELECT final_revision_id FROM cert_series WHERE project_id=? AND reference=?", [project.id, seriesKey]);
  if (series?.final_revision_id && !revision.revisesId) fail(409, "The series was finalized. Issue an authorized reopening before starting new work");
  if (!revision.revisesId&&database.get(`SELECT 1 FROM cert_revisions WHERE project_id=? AND series_key=?
    AND type='final' AND status='approved' LIMIT 1`,[project.id,seriesKey]))
    fail(409,"The final certificate is approved. Reopen its series before starting new work");
  checkedLocation(database, project.id, header.location_id);
  const rows = normalizeLines(database, project, header, body.lines || []);
  const id = nextCertificateId(database);
  database.run(`
    INSERT INTO cert_revisions
      (id,project_id,series_key,root_id,revises_id,revision,type,locale,location_id,work_to,collection_cutoff,header_json,rules_version,created_by,reserved_number)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  [id, project.id, seriesKey, revision.rootId || null, revision.revisesId || null, revision.number || 1,
    header.type, header.locale, header.location_id, header.work_to, header.collection_cutoff, encode(header), profile.version, user.id,
    revision.revisesId?null:nextSeriesNumber(database,{project_id:project.id,series_key:seriesKey})]);
  if (!revision.rootId) database.run("UPDATE cert_revisions SET root_id=id WHERE id=?", [id]);
  replaceLines(database, id, rows);
  audit(database, user, "draft_created", {projectId: project.id, revisionId: id, reason: revision.reason});
  return getRevision(database, id);
}

function requireVersion(row, expected) {
  if (!Number.isSafeInteger(Number(expected)) || row.version !== Number(expected))
    fail(409, "Certificate changed. Reload the latest revision", {version: row.version});
}

function saveDraft(database, row, body, user, grant) {
  if (row.status === "historical") return saveLegacyDraft(database,row,body,user);
  if (!["draft","in_review"].includes(row.status)) fail(409, "Approved certificates require a correction");
  requireVersion(row, body.version);
  const old = parse(row.header_json);
  if (body.header?.recover_advance!==undefined&&body.header.recover_advance!==Boolean(old.recover_advance))
    fail(400,"Create an advance recovery correction from the approved certificate");
  const project = getProject(database, row.project_id);
  const changes = {...old, ...body.header};
  const version = body.refresh_rules ? getProfile(database,project.id).version : row.rules_version;
  if (body.refresh_rules && !grant.capabilities.includes("manage_settings"))
    fail(403, "Certificate financial settings permission is required");
  const profile = getProfile(database, project.id, version == null ? today() : date(changes.work_to, true) || today(), version);
  const header = normalizeHeader(changes, project, profile, row.type);
  checkedLocation(database, project.id, header.location_id);
  if (row.revises_id && (scopeKey(header) !== row.series_key || header.location_id !== row.location_id))
    fail(400, "A correction must use the issued certificate scope");
  if (encode(old.rule_override || null) !== encode(header.rule_override || null) && !grant.capabilities.includes("manage_settings"))
    fail(403, "Certificate financial settings permission is required");
  const rows = normalizeLines(database, project, header, body.lines === undefined ? getLines(database, row.id) : body.lines);
  if (header.recover_advance&&rows.length) fail(400,"An advance recovery correction keeps the approved work quantities");
  const reference = scopeKey(header);
  database.run(`UPDATE cert_revisions SET series_key=?,type=?,locale=?,location_id=?,work_to=?,collection_cutoff=?,
    header_json=?,rules_version=?,reserved_number=?,status='draft',approved_json=NULL,baseline_id=NULL,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
  [reference,header.type,header.locale,header.location_id,header.work_to,header.collection_cutoff,encode(header),profile.version,
    !row.revises_id&&reference!==row.series_key?nextSeriesNumber(database,{project_id:project.id,series_key:reference}):row.reserved_number,row.id]);
  replaceLines(database, row.id, rows);
  audit(database, user, "draft_saved", {projectId: project.id, revisionId: row.id,
    reason: header.override_reason, details: {row_count:rows.length}});
  return getRevision(database, row.id);
}

function saveLegacyDraft(database,row,body,user) {
  requireVersion(row,body.version);
  const snapshot = legacySnapshot(database,row,true);
  if (snapshot.approval_at) fail(409,"Approved certificates require a correction");
  const project = getProject(database,row.project_id);
  const settings = getProfile(database,project.id,snapshot.header.work_to);
  const locationMap = new Map(projectLocations(database,project.id).map((location) => [lookup(location.name),location]));
  const existing = legacyLines(snapshot,locationMap);
  const header = {...snapshot.header,...normalizeHeader({...snapshot.header,...body.header,
    contract_ref:snapshot.header.contract_ref,location_id:snapshot.header.location_id,rule_override:null},project,settings,row.type)};
  const original = new Map(existing.map((line) => [line.id,line]));
  const normalized = new Map(normalizeLines(database,project,header,existing).map((line) => [line.id,line]));
  const validation = [];
  const lines = normalizeLines(database,project,header,body.lines ?? existing).map((line) => {
    const before = original.get(line.id);
    const fields = normalized.get(line.id);
    if (before && !before.location_id && !line.location_id) line.location = before.location || "";
    const sameValuation = fields && ["mode","recognition","unit","dimension_unit"].every((key) => line[key] === fields[key]) &&
      ["width","height","count","quantity","rate","agreed_amount","progress","claim_amount","adjustment_amount","override_quantity"]
        .every((key) => decimal(line[key]) === decimal(fields[key]));
    if (sameValuation && (line.description || line.work_item) && !snapshot.validation?.some((error) => error.line_id === line.id))
      return {...before,...line};
    const result = calculateValuation([line],null,{...settings,rules:[]},{ordinary_minor:0,period_ordinary_minor:0,advances:[]});
    validation.push(...result.errors);
    return result.lines[0];
  });
  if (!lines.length) validation.push({field:"lines",message:"Enter at least one work row"});
  const current = money(lines.reduce((sum,line) => sum + (toMinor(line.current) || 0),0));
  const edited = {edited:true,header,lines,validation,totals:{...snapshot.totals,current}};
  database.run(`INSERT INTO cert_legacy_workflow (revision_id,edited_json) VALUES (?,?)
    ON CONFLICT(revision_id) DO UPDATE SET edited_json=excluded.edited_json`,[row.id,encode(edited)]);
  database.run("UPDATE cert_revisions SET version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?",[row.id]);
  audit(database,user,"draft_saved",{projectId:project.id, revisionId:row.id,details:{row_count:lines.length}});
  return getRevision(database,row.id);
}

function approvalKey(input) {
  const {status, version, issued_at, official_number, pdf_status, updated_at, ...content} = input;
  const {advance_remaining,...totals} = content.totals;
  return crypto.createHash("sha256").update(encode({...content,totals})).digest("hex");
}

function validateReview(input) {
  if (input.validation.length) fail(422, "Resolve the certificate validation errors", {validation: input.validation});
}

function missingAdvanceRecovery(database,row,source) {
  if (!["approved","issued"].includes(row.status)||source.legacy||!["progress","final"].includes(row.type)||
      !(source.totals.current>0)||source.totals.advance_recovery>0) return null;
  if (database.get("SELECT 1 FROM cert_revisions WHERE root_id=? AND revision>? LIMIT 1",[row.root_id||row.id,row.revision])) return null;
  const profile=getProfile(database,row.project_id);
  const rule=profile.rules.find((entry)=>entry.enabled&&entry.category==="advance_recovery"&&entry.basis==="work"&&Number(entry.rate)>0);
  if (!rule) return null;
  profile.rules=[rule];
  profile.settings={...profile.settings,collections_basis:source.rule_settings?.collections_basis||profile.settings.collections_basis};
  const ledger=allocationLedger(database,row.project_id,profile,source.header.collection_cutoff,
    {workCutoff:source.header.work_to,previousCutoff:source.header.collection_cutoff,locationId:source.header.location_id,seriesKey:row.series_key});
  const preview=calculateValuation([],source,profile,ledger,{recoverAdvance:true});
  return preview.totals.advance_recovery>0?{rate:Number(rule.rate),amount:preview.totals.advance_recovery,payable:preview.totals.cumulative_payable}:null;
}

function makeRevision(database, row, action, reason, user, recoverAdvance=false) {
  const source = certificateDocumentInput(database,row);
  if (!["approved","issued"].includes(source.status) || (action !== "revise" && row.status === "approved"))
    fail(409, "Approve the certificate before creating a correction");
  if (!reason) fail(400, "A reason is required for this request");
  const advanceFix=recoverAdvance&&action==="revise"?missingAdvanceRecovery(database,row,source):null;
  if (recoverAdvance&&!advanceFix) fail(409,"This certificate has no outstanding advance recovery to correct");
  const project = getProject(database, row.project_id);
  const root = row.root_id || row.id;
  const latest = database.get("SELECT * FROM cert_revisions WHERE root_id=? ORDER BY revision DESC LIMIT 1", [root]);
  if (latest && latest.id !== row.id) fail(409, "Open the latest revision before making a correction");
  const type = action === "revise" ? "correction" : action;
  if (type === "reopen") {
    const series = database.get("SELECT final_revision_id FROM cert_series WHERE project_id=? AND reference=?", [row.project_id, row.series_key]);
    if (series?.final_revision_id !== row.id) fail(409, "Select the final certificate closing this series");
  }
  const workTo = advanceFix?source.header.work_to:today() > source.header.work_to ? today() : source.header.work_to;
  const collectionCutoff = advanceFix?source.header.collection_cutoff:workTo > source.header.collection_cutoff ? workTo : source.header.collection_cutoff;
  const header = {...source.header, type, work_from:advanceFix?source.header.work_from:null, work_to:workTo, collection_cutoff:collectionCutoff,
    rule_override:null, override_reason:null,recover_advance:Boolean(advanceFix)};
  const lines = type === "void" || row.status === "historical" ? source.lines.filter((line) => !line.carried_forward).map((line) =>
    ({...line, mode:"adjustment", adjustment_amount:type === "void" ? -line.current : 0, recognition:"incremental", reason})) : [];
  return createDraft(database, project, {header, lines}, user, {type,rootId:root,revisesId:row.id,number:row.revision+1,reason});
}

function runAction(database, row, body, user, enqueueRender) {
  const action = str(body.action);
  const key = str(body.command_key || body.idempotency_key, 180);
  const reason = str(body.reason, 2000);
  if (key) {
    const command = database.get("SELECT * FROM cert_commands WHERE revision_id=? AND actor_id=? AND command_key=?", [row.id,user.id,key]);
    if (command) {
      if (command.action !== action) fail(409, "The same command key was used for another action");
      return getRevision(database, command.result_revision);
    }
  }
  if (action === "issue" && row.status === "issued") return row;
  requireVersion(row, body.version);
  let result = row;
  if (["revise","void","reopen"].includes(action)) {
    result = makeRevision(database, row, action, reason, user,body.recover_advance===true);
  } else if (action === "submit") {
    if (row.status !== "draft") fail(409, "Only drafts can be submitted");
    const model = certificateDocumentInput(database, row);
    validateReview(model);
    database.run(`UPDATE cert_revisions SET status='in_review',baseline_id=?,approved_json=?,version=version+1,
      updated_at=CURRENT_TIMESTAMP WHERE id=?`, [model.baseline?.id ?? null,approvalKey(model),row.id]);
  } else if (action === "return") {
    if (row.status !== "in_review" && !(row.status === "approved" && !row.snapshot_json))
      fail(409, "Only certificates in review can be returned to draft");
    if (!reason) fail(400, "Enter the review comments");
    database.run(`UPDATE cert_revisions SET status='draft',approved_json=NULL,version=version+1,
      updated_at=CURRENT_TIMESTAMP WHERE id=?`, [row.id]);
  } else if (action === "approve" || action === "issue") {
    if (action === "approve" ? !["draft","in_review","historical"].includes(row.status) : row.status !== "approved")
      fail(409, action === "approve" ? "This certificate is already approved" : "Approve the certificate before issuance");
    const model = certificateDocumentInput(database,row);
    validateReview(model);
    if ((row.status === "in_review" || action === "issue") && row.approved_json !== approvalKey(model))
      fail(409, "Certificate calculation, baseline or print details changed. Return it to draft and submit again");
    if (row.status === "historical") {
      if (model.approval_at) fail(409,"This certificate is already approved");
      const approvedAt = now();
      database.run(`INSERT INTO cert_legacy_workflow (revision_id,approved_json,approved_at,approved_by) VALUES (?,?,?,?)
        ON CONFLICT(revision_id) DO UPDATE SET approved_json=excluded.approved_json,approved_at=excluded.approved_at,approved_by=excluded.approved_by`,
      [row.id,encode({...model,status:"approved",approval_at:approvedAt}),approvedAt,user.id]);
      database.run("UPDATE cert_revisions SET version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?",[row.id]);
    } else if (action === "approve") {
      database.run(`UPDATE cert_revisions SET status='approved',approved_json=?,baseline_id=?,snapshot_json=?,version=version+1,
        updated_at=CURRENT_TIMESTAMP WHERE id=?`,[approvalKey(model),model.baseline?.id ?? null,encode({...model,status:"approved"}),row.id]);
      for (const movement of model.recoveries) database.run("INSERT INTO cert_advance_recoveries VALUES (?,?,?,?)",
        [row.project_id,movement.advance_id,row.id,movement.amount_minor]);
    } else {
      database.run("INSERT OR IGNORE INTO cert_series (project_id,reference) VALUES (?,?)", [row.project_id,row.series_key]);
      const series = database.get("SELECT * FROM cert_series WHERE project_id=? AND reference=?", [row.project_id,row.series_key]);
      if (series.final_revision_id && !row.revises_id) fail(409, "The series has been finalized");
      if (row.type === "reopen" && series.final_revision_id !== row.revises_id) fail(409, "The final certificate changed");
      const nextAvailable = nextSeriesNumber(database,row);
      const number = certificateNumber(database,row);
      const timestamp = now();
      const frozen = {...model, official_number:number, issued_at:timestamp, status:"issued",pdf_status:"pending",version:row.version+1};
      database.run(`UPDATE cert_series SET next_number=?,final_revision_id=? WHERE project_id=? AND reference=?`,
        [Math.max(Number(number)+1,nextAvailable), row.type === "final" ? row.id : row.type === "reopen" ? null : series.final_revision_id,
          row.project_id,row.series_key]);
      database.run(`UPDATE cert_revisions SET status='issued',official_number=?,issued_at=?,pdf_status='pending',
        snapshot_json=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?`, [number,timestamp,encode(frozen),row.id]);
      for (const movement of model.recoveries) {
        database.run("INSERT OR IGNORE INTO cert_advance_recoveries VALUES (?,?,?,?)",
          [row.project_id,movement.advance_id,row.id,movement.amount_minor]);
      }
      enqueueRender(database,row.id,frozen);
    }
  } else fail(400, "Unknown certificate action");
  result = getRevision(database,result.id);
  audit(database,user,action,{projectId:row.project_id,revisionId:row.id,reason,
    details:{version:result.version,result_revision:result.id,status:result.status}});
  if (key) database.run("INSERT INTO cert_commands VALUES (?,?,?,?,?)", [row.id,user.id,key,action,result.id]);
  return result;
}

function forAccess(database, row, access) {
  const raw = certificateDocumentInput(database, row);
  const result = {...raw, certificate_number:certificateNumber(database,row),
    report_options:certificateReportOptions(raw.header,getProfile(database,row.project_id).settings)};
  if (access.capabilities.includes("revise")) result.advance_recovery_correction=missingAdvanceRecovery(database,row,raw);
  if (row.status === "approved" && !row.snapshot_json) result.can_return_legacy_approval = true;
  const collectionAccess = access.capabilities.includes("view_collections");
  const auditAccess = access.capabilities.includes("view_audit");
  if (!collectionAccess) {
    delete result.recoveries;
    delete result.receipts;
  }
  if (!access.capabilities.includes("ops_view")) delete result.operational_quantities;
  if (auditAccess) {
    result.history = database.all(`SELECT a.id,a.actor_id,u.display_name AS actor,a.action,a.reason,a.created_at,a.details_json
      FROM cert_audit a LEFT JOIN users u ON u.id=a.actor_id WHERE revision_id=? ORDER BY a.id DESC`, [row.id])
      .map(({details_json,...event}) => ({...event,details:parse(details_json)}));
  }
  if (!auditAccess) {
    const editor = ["draft","in_review","unapproved"].includes(raw.status) && access.capabilities.includes("edit_draft");
    const settingsAccess = access.capabilities.includes("manage_settings");
    result.lines = raw.lines.map(({reason,exact_amount,...line}) => editor ? {...line,reason} : line);
    if (!settingsAccess && !editor) {
      const {rule_override,override_reason,...header} = raw.header;
      result.header = header;
      delete result.applied_rules;
      delete result.rule_settings;
    }
  }
  return result;
}

module.exports = {getRevision, getLines, replaceLines, scopeBaseline, certificateDocumentInput, certificateNumber,
  createDraft, requireVersion, saveDraft, runAction, forAccess, recognizedReceipts,previewOperationalQuantities,carryForwardLines};
