const crypto = require("node:crypto");
const {audit, encode, fail, lookup, parse, str} = require("./certificate-access.cjs");
const {projectLocations} = require("./certificate-projects.cjs");
const {getLines, saveDraft} = require("./certificate-revisions.cjs");
const {MODES, decimal} = require("./certificate-valuation.cjs");

const IMPORT_FIELDS = ["location", "building_unit", "floor_apartment", "work_type", "work_item", "description", "mode", "width", "height",
  "dimension_unit", "count", "quantity", "unit", "rate", "agreed_amount", "progress", "amount", "note", "identity"];
const NUMERIC_FIELDS = new Set(["width","height","count","quantity","rate","agreed_amount","progress","amount"]);
const hash = (input) => crypto.createHash("sha256").update(encode(input)).digest("hex");

function stageImport(database, row, body, user) {
  if (row.status !== "draft") fail(409, "Select an editable draft");
  const source = body.rows;
  if (!Array.isArray(source) || !source.length || source.length > 2500) fail(400, "Provide up to 2,500 input rows");
  const mapping = {};
  for (const key of IMPORT_FIELDS) {
    const supplied = body.mapping?.[key];
    if (typeof supplied === "number" && Number.isInteger(supplied) && supplied >= 0 && supplied < 200)
      mapping[key] = supplied;
    else if (typeof supplied === "string" && supplied.trim()) mapping[key] = str(supplied, 150);
    else if (!body.mapping && typeof source[0] === "object" && !Array.isArray(source[0])) mapping[key] = key;
  }
  const label = str(body.source_label, 260) || "Imported measurements";
  const externalId = str(body.source_id, 200);
  const amountType = ["previous","current","cumulative"].includes(body.amount_type) ? body.amount_type : null;
  const fixed = {quantity_unit:str(body.quantity_unit),dimension_unit:str(body.dimension_unit),default_mode:str(body.default_mode)};
  const fingerprint = hash({source,mapping,label,externalId,amountType,fixed});
  const batchId = hash({revision_id:row.id,fingerprint});
  const locations = projectLocations(database,row.project_id);
  const entries = [];
  let skipped = 0;
  for (const [index,values] of source.entries()) {
    if (!values || typeof values !== "object" || !Object.values(values).some((cell) => str(cell)))
      { skipped++; continue; }
    const mapped = {};
    for (const [key,column] of Object.entries(mapping)) {
      if (!Object.hasOwn(values,column)) continue;
      const value = str(values[column],key === "description" ? 3000 : 600);
      if (value) mapped[key] = value;
    }
    const canonical = externalId || fingerprint;
    const id = hash({canonical,index});
    const selected = locations.filter((item) => {
      const candidate = lookup(mapped.location);
      return candidate && [item.label,item.name,item.code].some((value) => lookup(value) === candidate);
    });
    const problems = [];
    for (const field of NUMERIC_FIELDS) {
      if (mapped[field] !== undefined && decimal(mapped[field]) === null) problems.push({field,message:"Enter a valid number"});
    }
    if (mapped.location && selected.length !== 1)
      problems.push({field:"location",message:selected.length ? "Choose from matching locations" : "Location requires a link"});
    const mode = MODES.has(mapped.mode) ? mapped.mode : MODES.has(fixed.default_mode) ? fixed.default_mode :
      mapped.height ? "area" : mapped.width ? "linear" : "direct";
    const line = {...mapped,id,identity:mapped.identity || id,mode,location_id:selected.length === 1 ? selected[0].id : null,
      dimension_unit:mapped.dimension_unit || fixed.dimension_unit,unit:mapped.unit || fixed.quantity_unit,
      source:label};
    delete line.amount;
    if (mapped.amount !== undefined) {
      if (!amountType) problems.push({field:"amount",message:"Identify the source amount as prior, current or cumulative"});
      else if (amountType === "previous") problems.push({field:"amount",message:"Prior values must come from an issued baseline"});
      else if (mode === "lump") {
        line.recognition = amountType === "cumulative" ? "cumulative" : "incremental";
        line.claim_amount = mapped.amount;
      } else if (amountType === "cumulative") {
        line.recognition = "cumulative";
      }
    }
    if (!line.description && !line.work_item) problems.push({field:"description",message:"Description is required"});
    if (["area","linear"].includes(mode) && !line.dimension_unit)
      problems.push({field:"dimension_unit",message:"Select an explicit dimension unit"});
    if (mode === "direct" && !line.unit)
      problems.push({field:"unit",message:"Select an explicit quantity unit"});
    entries.push({id,line,validation:problems,order:index,candidates:selected});
  }
  database.run(`INSERT OR IGNORE INTO cert_import_batches
    (id,revision_id,user_id,source_label,mapping_json,source_json) VALUES (?,?,?,?,?,?)`,
  [batchId,row.id,user.id,label,encode({mapping,amount_type:amountType,source_id:externalId,fixed}),encode({entries,source,skipped})]);
  return {batch_id:batchId,rows:entries,recognized:entries.length,skipped,
    unresolved:entries.filter(({validation}) => validation.length).length};
}

function commitImport(database, row, body, access) {
  const stage = database.get("SELECT * FROM cert_import_batches WHERE id=? AND revision_id=?", [str(body.batch_id),row.id]);
  if (!stage) fail(404, "Import preview not found");
  if (stage.committed_at) return row;
  const decoded = parse(stage.source_json);
  const exclusions = new Set((Array.isArray(body.exclude_ids) ? body.exclude_ids : []).map((item) => str(item)));
  const exclusionReasons = new Map(Object.entries(body.exclusion_reasons || {}).map(([id,reason]) => [id,str(reason,1000)]));
  for (const id of exclusions) if (!exclusionReasons.get(id)) exclusionReasons.set(id,str(body.reason,1000) || "Excluded during import review");
  const replacements = new Set((Array.isArray(body.replace_ids) ? body.replace_ids : []).map((item) => str(item)));
  const resolutions = new Map((Array.isArray(body.resolutions) ? body.resolutions : []).map((item) =>
    [str(item.id),item.line || {}]));
  const lines = getLines(database,row.id);
  const positions = new Map(lines.map((item,index) => [item.identity,index]));
  for (const entry of decoded.entries) {
    if (exclusions.has(entry.id)) continue;
    const override = resolutions.get(entry.id) || {};
    const line = {...entry.line,...override,id:entry.line.id,identity:entry.line.identity,source:entry.line.source};
    const unresolved = entry.validation.filter(({field}) =>
      field === "location" ? !line.location_id && line.project_wide !== true :
      field === "amount" ? !line.claim_amount && !line.quantity : field === "description" ? !line.description && !line.work_item : !line[field]);
    if (unresolved.length) fail(422,"Resolve or exclude incomplete imported work",{
      validation:unresolved.map((issue) => ({...issue,line_id:entry.id})),
    });
    const position = positions.get(line.identity);
    if (position === undefined) {
      positions.set(line.identity,lines.length);
      lines.push(line);
    } else if (replacements.has(entry.id)) {
      lines[position] = {...lines[position],...line,id:lines[position].id};
    }
  }
  const updated = saveDraft(database,row,{version:body.version,lines},access.user,access);
  database.run("UPDATE cert_import_batches SET committed_at=CURRENT_TIMESTAMP WHERE id=?", [stage.id]);
  audit(database,access.user,"work_imported",{projectId:row.project_id,revisionId:row.id,reason:body.reason,
    details:{batch_id:stage.id,exclusions:[...exclusionReasons].map(([id,reason]) => ({id,reason})),replaced_ids:[...replacements],resolved_ids:[...resolutions.keys()]}});
  return updated;
}

module.exports = {stageImport, commitImport};
