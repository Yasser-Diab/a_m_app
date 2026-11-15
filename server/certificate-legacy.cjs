const crypto = require("node:crypto");
const {audit, date, encode, fail, idOf, lookup, parse, str} = require("./certificate-access.cjs");
const {createCustomer, saveCustomerProfile, createProject, createLocation, getProject, getCustomer} = require("./certificate-projects.cjs");
const {money, toMinor, MODES} = require("./certificate-valuation.cjs");

function validateList(input, label) {
  if (!Array.isArray(input)) fail(400, "Missing legacy " + label);
  return input;
}

function historicalDate(value) {
  return value ? date(value) : null;
}

function sourceKey(row, fallback) {
  return str(row.source_key ?? row.source_id ?? fallback, 220);
}

function archive(database, fingerprint, type, key, data, projectId = null, revisionId = null, minor = null) {
  if (!key) fail(400, "A workbook source identifier is missing");
  database.run("INSERT INTO cert_legacy_records (fingerprint,record_type,source_key,project_id,revision_id,amount_minor,data_json) VALUES (?,?,?,?,?,?,?)",
    [fingerprint,type,key,projectId,revisionId,minor,encode(data)]);
}

function checkedAmount(value, source) {
  const amount = toMinor(value);
  if (amount === null) fail(400, "Invalid workbook amount at " + source);
  return amount;
}

function importLegacyCertificates(database, batch) {
  const fingerprint = str(batch.fingerprint, 100).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) fail(400, "A workbook SHA-256 fingerprint is required");
  const filename = str(batch.source_name, 260);
  if (!filename) fail(400, "A workbook source name is required");
  return database.transaction(() => {
    const prior = database.get("SELECT summary_json FROM cert_legacy_batches WHERE fingerprint=?", [fingerprint]);
    if (prior) return {...parse(prior.summary_json), already_imported:true};
    const summary = {fingerprint,source_name:filename,customers:0,projects:0,locations:0,
      certificates:0,lines:0,receipts:0,work_minor:0,receipts_minor:0};
    const customerIds = new Map();
    const projectIds = new Map();
    database.run("INSERT INTO cert_legacy_batches (fingerprint,source_name,summary_json) VALUES (?,?,?)",
      [fingerprint,filename,"{}"]);

    for (const record of validateList(batch.customers,"customers")) {
      const key = sourceKey(record);
      if (!key || customerIds.has(key)) fail(400, "Legacy customer identifiers must be unique");
      const link = idOf(record.existing_customer_id);
      const customer = link ? getCustomer(database,link) : createCustomer(database,record);
      if (customer.created) saveCustomerProfile(database, customer.id, record);
      customerIds.set(key,customer.id);
      archive(database,fingerprint,"customer",key,{...record,customer_id:customer.id});
      summary.customers++;
    }

    for (const record of validateList(batch.projects,"projects")) {
      const key = sourceKey(record);
      const customerId = customerIds.get(str(record.customer_source_id));
      if (!key || projectIds.has(key) || !customerId) fail(400, "Legacy project identifiers must be unique and linked to a known customer");
      const project = createProject(database,{...record,customer_id:customerId});
      projectIds.set(key,project.id);
      archive(database,fingerprint,"project",key,record,project.id);
      for (const location of record.locations || []) {
        if (!lookup(location.name)) continue;
        const linked = createLocation(database,project.id,{...location,kind:location.kind || "building"});
        archive(database,fingerprint,"location",key + ":" + String(location.source_row || linked.id),location,project.id);
        summary.locations++;
      }
      summary.projects++;
    }

    for (const record of validateList(batch.certificates,"certificates")) {
      const projectId = projectIds.get(str(record.project_source_id));
      if (!projectId) fail(400, "Legacy certificate refers to an unknown project");
      const project = getProject(database,projectId);
      const customer = getCustomer(database,project.customer_id);
      const records = validateList(record.lines,"work rows");
      const orderedDates = records.map((row) => historicalDate(row.date)).filter(Boolean).sort();
      const header = {type:"progress",locale:"ar",currency:project.currency,
        work_from:historicalDate(record.work_from) || orderedDates[0] || null,
        work_to:historicalDate(record.work_to) || orderedDates.at(-1) || null,
        collection_cutoff:null,output_mode:"auto",contract_ref:project.contract_ref,
        source_name:filename,source_type:str(record.source_type),legacy_number:str(record.source_number),
        historical:true,notes:""};
      const key = sourceKey(record, str(record.project_source_id) + ":" + header.legacy_number + ":" + header.source_type);
      const inserted = database.run(`INSERT INTO cert_revisions
        (project_id,series_key,official_number,legacy_number,status,pdf_status,type,work_to,header_json)
        VALUES (?,?,NULL,?,'historical',NULL,'progress',?,?)`,
      [projectId,lookup(project.contract_ref),header.legacy_number,header.work_to,encode(header)]);
      const revisionId = inserted.lastInsertRowid;
      let sum = 0;
      const totalsByType = new Map();
      const lines = records.map((line,index) => {
        const rowKey = str(line.source_sheet) + ":" + str(line.source_row);
        const minor = checkedAmount(line.amount,rowKey);
        sum += minor;
        const workType = str(line.work_type);
        totalsByType.set(workType,(totalsByType.get(workType) || 0) + minor);
        archive(database,fingerprint,"work_row",rowKey,line,projectId,revisionId,minor);
        const official = {...line};
        delete official.raw;
        delete official.amount;
        const stable = crypto.createHash("sha256").update(fingerprint + rowKey).digest("hex");
        return {...official,id:stable,identity:stable,mode:MODES.has(line.mode) ? line.mode : "direct",work_type: workType,
          previous:0,current:money(minor),cumulative:money(minor),last_current:null,
          billed_quantity:line.quantity ?? null,source:rowKey};
      });
      const totals = {previous:0,current:money(sum),cumulative:money(sum),last_current:null,
        current_payable:null,cumulative_payable:null,components:[],groups:[...totalsByType]
          .map(([work_type,amount]) => ({work_type,previous:0,current:money(amount),cumulative:money(amount),last_current:null}))};
      const snapshot = {id:revisionId,project_id:projectId,project,customer,official_number:null,
        legacy_number:header.legacy_number,status:"historical",type:"progress",revision:1,version:1,
        header,locale:"ar",lines,totals,validation:[],historical:true,source_name:filename};
      database.run("UPDATE cert_revisions SET root_id=id,snapshot_json=? WHERE id=?", [encode(snapshot),revisionId]);
      archive(database,fingerprint,"certificate",key,{...record,lines:undefined},projectId,revisionId,sum);
      summary.certificates++;
      summary.lines+=lines.length;
      summary.work_minor+=sum;
    }

    for (const record of validateList(batch.receipts,"receipts")) {
      const projectId = projectIds.get(str(record.project_source_id)) || null;
      if (!projectId) fail(400, "Historical receipt refers to an unknown project");
      const key = sourceKey(record,str(record.source_sheet) + ":" + str(record.source_row));
      const amount = checkedAmount(record.amount,key);
      historicalDate(record.date);
      archive(database,fingerprint,"receipt",key,record,projectId,null,amount);
      summary.receipts++;
      summary.receipts_minor+=amount;
    }
    if (Array.isArray(batch.unlinked)) for (const record of batch.unlinked) {
      const key = sourceKey(record,str(record.source_sheet) + ":" + str(record.source_row));
      archive(database,fingerprint,"unlinked",key,record);
    }
    database.run("UPDATE cert_legacy_batches SET summary_json=? WHERE fingerprint=?", [encode(summary),fingerprint]);
    audit(database,null,"legacy_imported",{details:summary});
    return {...summary,already_imported:false};
  });
}

module.exports = {importLegacyCertificates};
