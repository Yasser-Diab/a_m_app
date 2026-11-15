const crypto = require("node:crypto");
const {audit, date, encode, fail, idOf, lookup, now, parse, setting, str, today} = require("./certificate-access.cjs");
const {getProject, getCustomer, getProfile, projectLocations, cleanRules, checkedLocation} = require("./certificate-projects.cjs");
const {allocationLedger, DATE_FLOOR} = require("./certificate-ledger.cjs");
const {calculateValuation, MODES, money} = require("./certificate-valuation.cjs");

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
    optional_fields: {},
  };
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
    const locationId = idOf(row.location_id) || header.location_id;
    if ((locationId && !locations.has(locationId)) || (header.location_id && locationId !== header.location_id))
      fail(400, "Work row location is outside the certificate scope");
    const line = {id: lineId, identity, location_id: locationId, location: locations.get(locationId)?.label || "",
      work_type: str(row.work_type), work_item: str(row.work_item), description: str(row.description, 3000),
      mode: MODES.has(row.mode) ? row.mode : "direct", dimension_unit: str(row.dimension_unit, 20),
      unit: str(row.unit, 60), recognition: row.recognition === "cumulative" ? "cumulative" : "incremental",
      reason: str(row.reason, 2000), note: str(row.note, 2000), source: str(row.source, 300),
    };
    for (const key of ["width","height","count","quantity","rate","agreed_amount","progress","claim_amount","adjustment_amount","override_quantity"]) {
      line[key] = row[key] == null || row[key] === "" ? null : str(row[key], 60);
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
  const prior = database.get(`
    SELECT snapshot_json FROM cert_revisions WHERE project_id=? AND series_key=? AND location_id IS ?
      AND id<>? AND status='issued' AND work_to<=?
    ORDER BY work_to DESC,issued_at DESC,id DESC LIMIT 1
  `, [row.project_id, scopeKey(header), header.location_id, row.id, header.work_to]);
  return prior && parse(prior.snapshot_json);
}

function certificateDocumentInput(database, row, lines = null) {
  if (row.snapshot_json) return {...parse(row.snapshot_json), version:row.version, pdf_status:row.pdf_status};
  const header = parse(row.header_json);
  const project = getProject(database, row.project_id);
  const customer = getCustomer(database, project.customer_id);
  const profile = getProfile(database, project.id, header.work_to, row.rules_version);
  if (header.rule_override) profile.rules = header.rule_override;
  const baseline = scopeBaseline(database, row, header);
  const ledger = allocationLedger(database,project.id,profile,header.collection_cutoff,{workCutoff:header.work_to,
    previousCutoff:baseline?.header?.collection_cutoff ?? DATE_FLOOR,locationId:header.location_id,revisionId:row.id,seriesKey:row.series_key});
  const calculated = calculateValuation(lines || getLines(database, row.id), baseline, profile, ledger);
  const validation = [...calculated.errors];
  if (!calculated.lines.some((line) => !line.carried_forward) && row.type !== "reopen")
    validation.push({field:"lines", message:"Enter at least one work row"});
  if (calculated.lines.some((line) => !line.work_type))
    validation.push({field:"work_type", message:"Assign every row a work type before submitting"});
  if (baseline?.header?.collection_cutoff > header.collection_cutoff)
    validation.push({field:"collection_cutoff", message:"Collections cutoff precedes the prior issued cutoff"});
  const incompatible = database.get(`SELECT 1 FROM cert_revisions WHERE project_id=? AND series_key=?
    AND status='issued' AND ((location_id IS NULL) <> (? IS NULL)) LIMIT 1`, [project.id,row.series_key,header.location_id]);
  if (incompatible) validation.push({field:"location_id", message:"The series already uses a different project or location valuation scope"});
  const newer = database.get(`SELECT 1 FROM cert_revisions WHERE project_id=? AND series_key=?
    AND location_id IS ? AND status='issued' AND work_to>? LIMIT 1`, [project.id, row.series_key, header.location_id, header.work_to]);
  if (newer) validation.push({field:"work_to", message:"Work cutoff precedes a later issued certificate in this scope"});
  const receipts = ledger.entries
    .filter((entry) => ledger.recognizedAmounts.has(entry.id))
    .map((entry) => ({id:entry.id,kind:entry.kind,date:entry.received_at,received_at:entry.received_at,
      cleared_at:entry.cleared_at,status:entry.status,amount:money(ledger.recognizedAmounts.get(entry.id)),
      method:entry.method,reference:entry.reference}));
  const actualLocation = projectLocations(database, project.id).find((entry) => entry.id === header.location_id);
  const issuerProfile = parse(setting(database, "company_profile", "{}"), {});
  const branding = parse(setting(database,"report_branding","{}"), {});
  return {
    id: row.id, project_id: row.project_id, status: row.status, revision: row.revision,
    version: row.version, revises_id: row.revises_id, type: row.type, locale: row.locale,
    official_number: row.official_number, issued_at: row.issued_at, updated_at:row.updated_at,
    header: {...header, location: actualLocation?.label || ""}, project, customer,
    issuer: {company_name:issuerProfile.company_name, address:issuerProfile.address, website:issuerProfile.website,
      phone:issuerProfile.phone,email:issuerProfile.email,logo_data_url:branding.logoDataUri},
    pdf_status: row.pdf_status, lines: calculated.lines, totals: calculated.totals,
    validation, recoveries: calculated.recoveries, receipts,
    applied_rules: profile.rules, rule_version: profile.version, rule_settings: profile.settings,
    baseline: baseline ? {id: baseline.id, official_number: baseline.official_number, revision: baseline.revision,
      work_to: baseline.header.work_to, collection_cutoff: baseline.header.collection_cutoff} : null,
  };
}

function createDraft(database, project, body, user, revision = {}) {
  if (project.historical_only) fail(409, "This workbook placeholder is available for historical review only");
  const supplied = body.header || {};
  const profile = getProfile(database, project.id, date(supplied.work_to, true) || today());
  const header = normalizeHeader(supplied, project, profile, revision.type);
  const seriesKey = scopeKey(header);
  const series = database.get("SELECT final_revision_id FROM cert_series WHERE project_id=? AND reference=?", [project.id, seriesKey]);
  if (series?.final_revision_id && !revision.revisesId) fail(409, "The series was finalized. Issue an authorized reopening before starting new work");
  checkedLocation(database, project.id, header.location_id);
  const rows = normalizeLines(database, project, header, body.lines || []);
  const result = database.run(`
    INSERT INTO cert_revisions
      (project_id,series_key,root_id,revises_id,revision,type,locale,location_id,work_to,collection_cutoff,header_json,rules_version,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  [project.id, seriesKey, revision.rootId || null, revision.revisesId || null, revision.number || 1,
    header.type, header.locale, header.location_id, header.work_to, header.collection_cutoff, encode(header), profile.version, user.id]);
  const id = result.lastInsertRowid;
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
  if (row.status !== "draft") fail(409, "Only a draft can be edited");
  requireVersion(row, body.version);
  const old = parse(row.header_json);
  const project = getProject(database, row.project_id);
  const changes = {...old, ...body.header};
  const version = body.refresh_rules ? null : row.rules_version;
  if (body.refresh_rules && !grant.capabilities.includes("manage_settings"))
    fail(403, "Certificate financial settings permission is required");
  const profile = getProfile(database, project.id, date(changes.work_to, true) || today(), version);
  const header = normalizeHeader(changes, project, profile, row.type);
  checkedLocation(database, project.id, header.location_id);
  if (row.revises_id && (scopeKey(header) !== row.series_key || header.location_id !== row.location_id))
    fail(400, "A correction must use the issued certificate scope");
  if (encode(old.rule_override || null) !== encode(header.rule_override || null) && !grant.capabilities.includes("manage_settings"))
    fail(403, "Certificate financial settings permission is required");
  const rows = normalizeLines(database, project, header, body.lines === undefined ? getLines(database, row.id) : body.lines);
  const reference = scopeKey(header);
  database.run(`UPDATE cert_revisions SET series_key=?,type=?,locale=?,location_id=?,work_to=?,collection_cutoff=?,
    header_json=?,rules_version=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
  [reference,header.type,header.locale,header.location_id,header.work_to,header.collection_cutoff,encode(header),profile.version,row.id]);
  replaceLines(database, row.id, rows);
  audit(database, user, "draft_saved", {projectId: project.id, revisionId: row.id,
    reason: header.override_reason, details: {row_count:rows.length}});
  return getRevision(database, row.id);
}

function approvalKey(input) {
  const {status, version, issued_at, official_number, pdf_status, updated_at, ...content} = input;
  return crypto.createHash("sha256").update(encode(content)).digest("hex");
}

function validateReview(input) {
  if (input.validation.length) fail(422, "Resolve the certificate validation errors", {validation: input.validation});
}

function makeRevision(database, row, action, reason, user) {
  if (row.status !== "issued") fail(409, "Only issued certificates can be revised");
  if (!reason) fail(400, "A reason is required for this request");
  const source = parse(row.snapshot_json);
  const project = getProject(database, row.project_id);
  const root = row.root_id || row.id;
  const latest = database.get("SELECT * FROM cert_revisions WHERE root_id=? ORDER BY revision DESC LIMIT 1", [root]);
  if (latest && latest.id !== row.id) fail(409, "Open the latest revision before making a correction");
  const type = action === "revise" ? "correction" : action;
  if (type === "reopen") {
    const series = database.get("SELECT final_revision_id FROM cert_series WHERE project_id=? AND reference=?", [row.project_id, row.series_key]);
    if (series?.final_revision_id !== row.id) fail(409, "Select the final certificate closing this series");
  }
  const workTo = today() > source.header.work_to ? today() : source.header.work_to;
  const collectionCutoff = workTo > source.header.collection_cutoff ? workTo : source.header.collection_cutoff;
  const header = {...source.header, type, work_from:null, work_to:workTo, collection_cutoff:collectionCutoff,
    rule_override:null, override_reason:null};
  const lines = type === "void" ? source.lines.filter((line) => line.current).map((line) =>
    ({...line, mode:"adjustment", adjustment_amount:-line.current, recognition:"incremental", reason})) : [];
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
    result = makeRevision(database, row, action, reason, user);
  } else if (action === "submit") {
    if (row.status !== "draft") fail(409, "Only drafts can be submitted");
    const model = certificateDocumentInput(database, row);
    validateReview(model);
    database.run(`UPDATE cert_revisions SET status='in_review',baseline_id=?,approved_json=?,version=version+1,
      updated_at=CURRENT_TIMESTAMP WHERE id=?`, [model.baseline?.id ?? null,approvalKey(model),row.id]);
  } else if (action === "return") {
    if (!["in_review","approved"].includes(row.status)) fail(409, "Certificate must be in review or approved");
    if (!reason) fail(400, "Enter the review comments");
    database.run(`UPDATE cert_revisions SET status='draft',approved_json=NULL,version=version+1,
      updated_at=CURRENT_TIMESTAMP WHERE id=?`, [row.id]);
  } else if (action === "approve" || action === "issue") {
    if (row.status !== (action === "approve" ? "in_review" : "approved"))
      fail(409, action === "approve" ? "Submit the draft before approval" : "Approve the certificate before issuance");
    const model = certificateDocumentInput(database,row);
    validateReview(model);
    if (row.approved_json !== approvalKey(model)) fail(409, "Certificate calculation, baseline or print details changed. Return it to draft and submit again");
    if (action === "approve") {
      database.run("UPDATE cert_revisions SET status='approved',version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?", [row.id]);
    } else {
      database.run("INSERT OR IGNORE INTO cert_series (project_id,reference) VALUES (?,?)", [row.project_id,row.series_key]);
      const series = database.get("SELECT * FROM cert_series WHERE project_id=? AND reference=?", [row.project_id,row.series_key]);
      if (series.final_revision_id && !row.revises_id) fail(409, "The series has been finalized");
      if (row.type === "reopen" && series.final_revision_id !== row.revises_id) fail(409, "The final certificate changed");
      const number = row.revises_id ? getRevision(database, row.revises_id).official_number : series.next_number;
      const timestamp = now();
      const frozen = {...model, official_number:number, issued_at:timestamp, status:"issued",pdf_status:"pending",version:row.version+1};
      database.run(`UPDATE cert_series SET next_number=?,final_revision_id=? WHERE project_id=? AND reference=?`,
        [series.next_number + (row.revises_id ? 0 : 1), row.type === "final" ? row.id : row.type === "reopen" ? null : series.final_revision_id,
          row.project_id,row.series_key]);
      database.run(`UPDATE cert_revisions SET status='issued',official_number=?,issued_at=?,pdf_status='pending',
        snapshot_json=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?`, [number,timestamp,encode(frozen),row.id]);
      for (const movement of model.recoveries) {
        database.run("INSERT INTO cert_advance_recoveries VALUES (?,?,?,?)",
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
  const result = {...raw};
  const collectionAccess = access.capabilities.includes("view_collections");
  const auditAccess = access.capabilities.includes("view_audit");
  if (!collectionAccess) {
    delete result.recoveries;
    delete result.receipts;
  }
  if (auditAccess) {
    result.history = database.all(`SELECT a.id,a.actor_id,u.display_name AS actor,a.action,a.reason,a.created_at,a.details_json
      FROM cert_audit a LEFT JOIN users u ON u.id=a.actor_id WHERE revision_id=? ORDER BY a.id DESC`, [row.id])
      .map(({details_json,...event}) => ({...event,details:parse(details_json)}));
  }
  if (!auditAccess) {
    const editor = row.status === "draft" && access.capabilities.includes("edit_draft");
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

module.exports = {getRevision, getLines, replaceLines, scopeBaseline, certificateDocumentInput,
  createDraft, requireVersion, saveDraft, runAction, forAccess};
