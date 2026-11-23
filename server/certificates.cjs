const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const {
  CAPABILITIES, accessFor, adminAccess, audit, authorize, date, encode, fail,
  featureEnabled, getGrant, getUserGrant, hasManagerRole, idOf, inScope, initializeSessionSecret, issueCertificateSession,
  certificateSessionUser, revokeCertificateSession, lookup, parse, scopeSql, setGrant, setting, setSetting, str, today,
} = require("./certificate-access.cjs");
const {initializeMasterCodes, getProject, getCustomer, customerData,saveCustomerData,createCustomer, saveCustomerProfile, createProject, updateProject, createLocation,
  projectLookupKeys, projectLocations, projectEntrySuggestions, getProfile, cleanRules, cleanSettings, latestVersion, saveProjectRules, checkedLocation} = require("./certificate-projects.cjs");
const {allocationLedger, addReceipt, updateReceipt, changeReceipt, collectionResponse} = require("./certificate-ledger.cjs");
const {getRevision, certificateDocumentInput, certificateNumber, createDraft, saveDraft, runAction, forAccess, recognizedReceipts,previewOperationalQuantities,carryForwardLines} = require("./certificate-revisions.cjs");
const {importLegacyCertificates} = require("./certificate-legacy.cjs");
const {stageImport, commitImport} = require("./certificate-imports.cjs");
const {money, toMinor} = require("./certificate-valuation.cjs");
const {legacySnapshot} = require("./certificate-history.cjs");
const {deleteArchivedFiles,deleteCertificate} = require("./certificate-deletion.cjs");
const {certificateLocationFields} = require("./document-locations.cjs");
const {
  initializeCertificateArtifacts, enqueueCertificateRender, processCertificateRender,
  resumeCertificateRenders, registerCertificateDocumentRoutes,
} = require("./certificate-documents.cjs");
const {certificateReportOptions} = require("./certificate-document-model.cjs");
const {retentionReport,retentionNotices,retentionHtml}=require('./certificate-retentions.cjs');
const {initializeCertificateNumbers}=require("./certificate-numbering.cjs");
const {reconcile:reconcileOperations} = require("./project-operations/finance.cjs");

function initializeCertificates(database) {
  database.transaction(() => {
    database.exec(fs.readFileSync(path.join(__dirname, "certificate-schema.sql"), "utf8"));
    initializeCertificateNumbers(database);
    if (!database.all("PRAGMA table_info(cert_receipt_allocations)").some(({name}) => name === "allocated_at"))
      database.run("ALTER TABLE cert_receipt_allocations ADD COLUMN allocated_at TEXT");
    initializeSessionSecret(database);
    initializeCertificateArtifacts(database);
    initializeMasterCodes(database);
    if (!setting(database,"certificates_shared_projects_seeded")) {
      const rows = database.all(`
        SELECT DISTINCT d.party_id,d.project FROM documents d JOIN parties p ON p.id=d.party_id
        WHERE p.role='customer' AND d.deleted_at IS NULL AND TRIM(COALESCE(d.project,'')) <> ''
      `);
      const projects = new Map();
      for (const row of rows) {
        const key = lookup(row.project);
        if (!key) continue;
        const resolved = createProject(database,{customer_id:row.party_id,name:row.project,raw:{host_seeded:true}});
        projects.set(row.party_id + ":" + key,resolved.id);
      }
      for (const row of database.all(`
        SELECT DISTINCT party_id,project,building_unit FROM work_items
        WHERE deleted_at IS NULL AND party_id IS NOT NULL AND TRIM(COALESCE(building_unit,'')) <> ''
      `)) {
        const projectId = projects.get(row.party_id + ":" + lookup(row.project));
        if (projectId && lookup(row.building_unit)) createLocation(database,projectId,{name:row.building_unit,kind:"building"});
      }
      setSetting(database,"certificates_shared_projects_seeded","1");
    }
  });
}

function canChangeUsers(database, req, {target, role} = {}) {
  if (!target && role !== "admin" && role !== "manager") return true;
  const protectedUser = target && (["admin","manager"].includes(target.role) || getGrant(database,target.id).capabilities.length);
  if (!protectedUser && role !== "admin" && role !== "manager") return true;
  const actor = certificateSessionUser(database,req);
  return Boolean(actor && ["admin","manager"].includes(actor.role));
}

function hasMasterPermission(access) {
  return access.user.can_edit_company_settings || ["admin","manager"].includes(access.user.role);
}

function projectsResponse(database, req, access) {
  const scope = scopeSql(access,"id");
  const customerId = idOf(req.query.customer_id);
  const matches = lookup(req.query.q);
  const rows = database.all(`
    SELECT id,name,alternate_name,customer_id,code,address,contract_ref,contract_date,currency,
      json_extract(raw_json,'$.name_history') AS name_history,json_extract(raw_json,'$.customer_project_code') AS customer_project_code FROM cert_projects
    WHERE ${scope.clause} AND (? IS NULL OR customer_id=?)
      AND (? = '' OR search_name LIKE ? OR alternate_name LIKE ? OR code LIKE ? OR contract_ref LIKE ? OR address LIKE ?
        OR EXISTS (SELECT 1 FROM json_each(cert_projects.raw_json,'$.name_history') WHERE value LIKE ?)
        OR json_extract(raw_json,'$.customer_project_code') LIKE ?)
    ORDER BY created_at DESC,id DESC ${customerId&&req.query.all==='1'?'':'LIMIT 200'}
  `, [...scope.params,customerId,customerId,matches,`%${matches}%`,`%${str(req.query.q)}%`,`%${matches}%`,`%${str(req.query.q)}%`,
    `%${str(req.query.q)}%`,`%${str(req.query.q)}%`,`%${str(req.query.q)}%`]);
  return rows.map(({name_history,...row}) => ({...row,search_aliases:parse(name_history,[])}));
}

function certificateList(database, req, access) {
  const scope = scopeSql(access,"r.project_id");
  const projectId = idOf(req.query.project_id);
  if (projectId && !inScope(access,projectId)) fail(404,"Project not found");
  const pageSize = Math.max(1,Math.min(200,Math.trunc(Number(req.query.limit) || 100)));
  const page = Math.max(1,Math.min(1e6,Math.trunc(Number(req.query.page) || 1)));
  const status = str(req.query.status);
  const val = normalizeListStatus(status);
  const match = lookup(req.query.q);
  const like = `%${match}%`;
  const displayStatus = "CASE WHEN r.status='historical' THEN CASE WHEN lw.approved_at IS NULL THEN 'unapproved' ELSE 'approved' END ELSE r.status END";
  const where = `${scope.clause} AND (? IS NULL OR r.project_id=?)
    AND (? = '' OR ${displayStatus}=? OR (? = 'historical' AND r.status='historical'))
    AND (? = '' OR cp.search_name LIKE ? OR p.search_name LIKE ? OR r.legacy_number LIKE ?
      OR CAST(r.official_number AS TEXT) LIKE ? OR CAST(r.reserved_number AS TEXT) LIKE ?)`;
  const params = [...scope.params,projectId,projectId,val,val,val,match,like,like,like,like,like];
  const joins = "FROM cert_revisions r JOIN cert_projects cp ON r.project_id=cp.id JOIN parties p ON p.id=cp.customer_id LEFT JOIN cert_legacy_workflow lw ON lw.revision_id=r.id";
  const total = database.get(`SELECT count(*) AS total ${joins} WHERE ${where}`,params).total;
  const items = database.all(`
    SELECT r.id,r.project_id,r.series_key,r.revises_id,${displayStatus} AS status,r.pdf_status,r.type,r.revision,r.version,r.official_number,r.reserved_number,
      r.legacy_number,COALESCE(json_extract(lw.edited_json,'$.header.work_to'),r.work_to) AS work_to,r.collection_cutoff,r.issued_at,r.updated_at,r.header_json,
      COALESCE(json_extract(lw.edited_json,'$.totals.current'),json_extract(r.snapshot_json,'$.totals.current')) AS current,
      json_extract(r.snapshot_json,'$.totals.cumulative_payable') AS cumulative_payable,
      cp.name AS project_name,p.display_name AS customer_name
    ${joins} WHERE ${where} ORDER BY r.updated_at DESC,r.id DESC LIMIT ? OFFSET ?
  `, [...params,pageSize,(page-1)*pageSize]).map(({header_json,series_key,revises_id,...row}) => ({...row,
    certificate_number:certificateNumber(database,{...row,series_key,revises_id}),header:parse(header_json)}));
  return {items,total,page,limit:pageSize};
}

function normalizeListStatus(status) {
  if (!status || status === "all") return "";
  if (!["draft","in_review","approved","issued","historical","unapproved"].includes(status)) fail(400,"Unknown certificate status");
  return status;
}

function sourceList(database, project) {
  const certificates = database.all(`
    SELECT id,project_id,series_key,revises_id,reserved_number,official_number,legacy_number,revision,work_to,snapshot_json
    FROM cert_revisions WHERE project_id=? AND status IN ('approved','issued','historical')
    ORDER BY work_to DESC,id DESC LIMIT 12
  `, [project.id]).map(({snapshot_json,...row}) => {
    const snapshot=snapshot_json?parse(snapshot_json):certificateDocumentInput(database,getRevision(database,row.id));
    return {...row,label:`#${certificateNumber(database,row)}${row.revision > 1 ? ` · R${row.revision}` : ""}`,
    lines:snapshot.lines.map(({identity,location_id,location,work_type,work_item,description,mode,
      width,height,dimension_unit,count,quantity,unit,rate,agreed_amount,...fields}) =>
      ({identity,location_id,...certificateLocationFields({...fields,location}),work_type,work_item,description,mode,width,height,dimension_unit,count,quantity,
        unit,rate,agreed_amount,prior_certified:true})),
    };
  });
  const projectKeys = projectLookupKeys(project);
  const documents = database.all(`SELECT id,operation_no,project,title,entry_date,document_type FROM documents
    WHERE party_id=? AND deleted_at IS NULL AND document_type IN ('price_offer','invoice') AND status='approved' ORDER BY id DESC`,
  [project.customer_id]).filter((document) => projectKeys.has(lookup(document.project)));
  const sourceDocuments = (type) => documents.filter((record) => record.document_type === type).slice(0,25).map((quote) => ({
    id:quote.id, label:quote.title || quote.operation_no, reference:quote.operation_no, date:quote.entry_date,
    lines:database.all(`SELECT id,work_type,description,statement_text,unit,unit_code,rate,building_unit,floor_apartment
      FROM work_items WHERE document_id=? AND deleted_at IS NULL AND COALESCE(collection_amount,0)=0 ORDER BY id LIMIT 2500`,
    [quote.id]).map((row) => ({
      identity:"quotation:" + quote.id + ":" + row.id,...certificateLocationFields(row),work_type:row.work_type, description:row.description || row.statement_text,
      unit:row.unit,rate:row.rate,mode:row.unit_code === "count" ? "count" : "direct",source:quote.operation_no,
    })),
  }));
  return {certificates,quotations:sourceDocuments("price_offer"),invoices:sourceDocuments("invoice")};
}

function reportResponse(database, req, access) {
  const projectId = idOf(req.query.project_id);
  if (projectId && !inScope(access,projectId)) fail(404,"Project not found");
  const locationId = idOf(req.query.location_id);
  if (locationId && !projectId) fail(400,"Select a project for a location report");
  if (locationId) checkedLocation(database,projectId,locationId);
  const workCutoff = date(req.query.work_cutoff,true) || today();
  const collectionCutoff = date(req.query.collection_cutoff,true) || today();
  const scope = scopeSql(access,"cp.id");
  const projects = database.all(`SELECT cp.id,cp.name,cp.currency FROM cert_projects cp WHERE ${scope.clause}
    AND (cp.id=? OR (? IS NULL AND (EXISTS (SELECT 1 FROM cert_revisions r WHERE r.project_id=cp.id)
      OR EXISTS (SELECT 1 FROM cert_receipts r WHERE r.project_id=cp.id)
      OR EXISTS (SELECT 1 FROM cert_legacy_records r WHERE r.project_id=cp.id AND r.record_type='receipt'))))
    ORDER BY cp.name`,[...scope.params,projectId,projectId]);
  const totalsByCurrency = new Map();
  const items = [];
  for (const project of projects) {
    const portions = database.all(`
      SELECT id,series_key,location_id,official_number,revision,work_to,snapshot_json,
        ROW_NUMBER() OVER (PARTITION BY series_key,location_id ORDER BY work_to DESC,issued_at DESC,id DESC) as latest
      FROM cert_revisions WHERE project_id=? AND status='issued' AND work_to<=? AND (? IS NULL OR location_id IS ? OR location_id IS NULL)
    `,[project.id,workCutoff,locationId,locationId]);
    const historic = database.get(`SELECT COUNT(DISTINCT a.revision_id) AS count, COALESCE(SUM(a.amount_minor),0) AS amount
      FROM cert_legacy_records a JOIN cert_revisions r ON r.id=a.revision_id
      WHERE a.project_id=? AND a.record_type='work_row'
        AND COALESCE(json_extract(a.data_json,'$.date'),r.work_to,'0001-01-01')<=?
        AND (? IS NULL OR json_extract(a.data_json,'$.location') = (SELECT name FROM cert_locations WHERE id=?))
        AND NOT EXISTS (SELECT 1 FROM cert_legacy_workflow lw WHERE lw.revision_id=r.id AND lw.approved_at IS NOT NULL AND lw.edited_json IS NOT NULL)`,
    [project.id,workCutoff,locationId,locationId]);
    for (const legacy of database.all(`SELECT r.* FROM cert_revisions r JOIN cert_legacy_workflow lw ON lw.revision_id=r.id
      WHERE r.project_id=? AND lw.approved_at IS NOT NULL AND lw.edited_json IS NOT NULL
      AND json_extract(lw.edited_json,'$.header.work_to')<=?`,[project.id,workCutoff])) {
      const snapshot = legacySnapshot(database,legacy);
      const lines = snapshot.lines.filter((line) => !locationId || line.location_id === locationId);
      if (lines.length) historic.count++;
      historic.amount += lines.reduce((sum,line) => sum + (toMinor(line.current) || 0),0);
    }
    const work = portions.reduce((acc,row) => {
      const snapshot = parse(row.snapshot_json);
      if (locationId && !row.location_id) {
        const lines = snapshot.lines.filter((line) => line.location_id === locationId);
        for (const line of lines) {
          const amount = toMinor(line.current) || 0;
          if (row.latest === 1) acc.current += amount;
          acc.cumulative += amount;
        }
        if (lines.length) acc.supports_settlement = false;
      } else {
        const value = snapshot.totals;
        const amount = toMinor(value.current) || 0;
        if (row.latest === 1) acc.current += amount;
        acc.cumulative += amount;
        acc.cumulative_earned += toMinor(value.current_earned) ?? amount;
      }
      return acc;
    },{current:0,cumulative:0,cumulative_earned:0,supports_settlement:true});
    const profile = getProfile(database,project.id,workCutoff);
    const ledger = allocationLedger(database,project.id,profile,collectionCutoff,{workCutoff,locationId});
    const historicalAdvances = ledger.entries.reduce((sum,entry) =>
      sum + (entry.kind === "advance" && entry.source === "historical" ? (ledger.recognizedAmounts.get(entry.id) || 0) : 0),0);
    const earned = work.cumulative_earned + historic.amount - historicalAdvances;
    const amounts = {current:work.current,cumulative:work.cumulative + historic.amount,
      cumulative_earned:work.supports_settlement ? earned : null,ordinary_collections:ledger.ordinary_minor,
      cumulative_payable:work.supports_settlement ? earned - ledger.ordinary_minor + ledger.released_recovery_minor : null,
      historical_work:historic.amount,unapplied_collections:ledger.unapplied_minor};
    const asMoney = (value) => value === null ? null : money(value);
    const moneyFields = Object.fromEntries(Object.entries(amounts).map(([key,value]) => [key,asMoney(value)]));
    const combined = totalsByCurrency.get(project.currency) || {};
    for (const [key,value] of Object.entries(amounts))
      combined[key] = value === null || combined[key] === null ? null : (combined[key] || 0)+value;
    totalsByCurrency.set(project.currency,combined);
    items.push({project_id:project.id,project_name:project.name,currency:project.currency,certificate_count:portions.length + historic.count,
      historical_count:historic.count,...moneyFields});
  }
  const currencies = Object.fromEntries([...totalsByCurrency].map(([code,raw]) => [code,
    Object.fromEntries(Object.entries(raw).map(([key,value]) => [key,value === null ? null : money(value)]))]));
  const totals = totalsByCurrency.size === 1 ? Object.values(currencies)[0] : {};
  return {items,totals,currencies,location_id:locationId,work_cutoff:workCutoff,collection_cutoff:collectionCutoff};
}

function registerCertificateRoutes(app, database, dataDir, { branding = () => ({}), appVersion = "",renderPdf } = {}) {
  const router = express.Router();
  app.use("/api/certificates",router);
  router.use((req,_res,next) => {
    if (!certificateSessionUser(database,req)) fail(401,"Sign in again to access certificates");
    next();
  });
  const checked = (req, capability, projectId = null) => authorize(database,req,capability,projectId);
  const revision = (req, capability) => {
    checked(req,capability);
    const row = getRevision(database,req.params.id);
    return {row,access:checked(req,capability,row.project_id)};
  };
  const project = (req, capability) => {
    const projectId = idOf(req.params.projectId);
    if (!projectId) fail(404,"Project not found");
    const access = checked(req,capability,projectId);
    return {project:getProject(database,projectId),access};
  };
  const admin = (req) => adminAccess(database,req);
  router.get('/retentions',(req,res)=>res.json(retentionReport(database,checked(req,'view_collections'),req.query)));
  router.get('/retentions/notices',(req,res)=>res.json({events:retentionNotices(database,checked(req,'view_collections'),req.query.locale)}));
  router.post('/retentions/pdf',async(req,res,next)=>{try{
    const access=checked(req,'view_collections');checked(req,'export');
    const data=retentionReport(database,access,req.body||{}),locale=req.body?.locale==='en'?'en':'ar';
    const pdf=await renderPdf(retentionHtml(data,{locale,branding:branding()}),{report_language:locale});
    res.type('pdf').set('Content-Disposition',`attachment; filename="Retentions-${today()}.pdf"`).send(pdf);
  }catch(error){next(error);}});
  const detail = (row,access) => forAccess(database,row,access);
  const printInput = (model, user, options = {}) => {
    const settings = getProfile(database, model.project_id).settings;
    const header = {...model.header};
    if (["ar", "en"].includes(options.language)) header.locale = options.language;
    if (["auto", "cover", "detail"].includes(options.layout)) header.output_mode = options.layout;
    if (["A4", "Letter"].includes(options.paper)) header.paper_size = options.paper;
    header.group_work_types = options.group == null ? (header.group_work_types ?? settings.group_work_types) : options.group === "1";
    if (["none","building","unit","work_type"].includes(options.group_by)) header.group_by = options.group_by;
    else if (options.group != null) header.group_by = options.group === "1" ? "work_type" : "none";
    else header.group_by = header.group_by ?? settings.group_by;
    header.show_group_subtotals = options.subtotals == null ? (header.show_group_subtotals ?? settings.show_group_subtotals) : options.subtotals === "1";
    const reportOptions = certificateReportOptions(header,settings);
    for (const key of Object.keys(reportOptions)) {
      if (options[key] === "1" || options[key] === "0") reportOptions[key] = options[key] === "1";
    }
    const cutoff = options.receipts !== "0" && options.collections_through ? date(options.collections_through) : null;
    const paymentDetails = cutoff ? allocationLedger(database, model.project_id, getProfile(database, model.project_id, cutoff), cutoff, {
      locationId:header.location_id || null,
    }) : null;
    const project = model.project?.code ? model.project : {...model.project,code:getProject(database,model.project_id).code};
    const customerId = model.customer?.id || project.customer_id || getProject(database,model.project_id).customer_id;
    const customer = model.customer?.code ? model.customer : {...model.customer,code:getCustomer(database,customerId).code};
    return {...model, header, project, customer, report_options:reportOptions, issuer: {...model.issuer, ...branding()}, prepared_by: user?.display_name || "",
      prepared_at:new Intl.DateTimeFormat("en-GB",{timeZone:"Africa/Cairo", dateStyle:"short", timeStyle:"short"}).format(new Date()),
      show_status_watermark: options.watermark !== "0",
      include_receipts: options.receipts == null ? undefined : options.receipts === "1",
      receipts: paymentDetails ? recognizedReceipts(paymentDetails) : model.receipts,
      payment_details_through: cutoff,
      app_version: appVersion, rule_settings: {...model.rule_settings, signatures: settings.signatures || []}};
  };

  router.get("/access",(req,res) => {
    const {user,...access} = accessFor(database,req);
    res.json({...access,user_id:user.id});
  });
  router.get("/admin/feature",(req,res) => {
    admin(req);
    res.json({enabled:featureEnabled(database)});
  });
  router.put("/admin/feature",(req,res) => {
    const access = admin(req);
    const enabled = req.body.enabled === true;
    database.transaction(() => {
      setSetting(database,"certificates_enabled",enabled ? "1" : "0");
      audit(database,access.user,"feature_changed",{details:{enabled}});
    });
    res.json({enabled:featureEnabled(database)});
  });
  router.get("/admin/projects",(req,res) => {
    admin(req);
    res.json(database.all(`SELECT cp.id,cp.name,p.display_name AS customer_name
      FROM cert_projects cp JOIN parties p ON p.id=cp.customer_id ORDER BY cp.name`));
  });
  router.get("/admin/users",(req,res) => {
    admin(req);
    const users = database.all("SELECT id,role FROM users");
    res.json(Object.fromEntries(users.map((user) => [user.id,getUserGrant(database,user)])));
  });
  router.get("/admin/users/:userId",(req,res) => {
    admin(req);
    const user = database.get("SELECT id,role FROM users WHERE id=?",[idOf(req.params.userId)]);
    if (!user) fail(404,"User not found");
    res.json(getUserGrant(database,user));
  });
  router.put("/admin/users/:userId",(req,res) => {
    const access = admin(req);
    const user = database.get("SELECT id,role FROM users WHERE id=?",[idOf(req.params.userId)]);
    if (!user) fail(404,"User not found");
    if (hasManagerRole(user)) fail(409,"Managers receive certificate permissions through their role");
    res.json({...setGrant(database,access.user,user.id,req.body),inherited_from_role:false});
  });
  router.get("/customers",(req,res) => {
    const access = checked(req,"view");
    const scope = scopeSql(access,"cp.id");
    const match = lookup(req.query.q);
    const like = "%" + match + "%";
    const typed = "%" + str(req.query.q) + "%";
    res.json(database.all(`
      SELECT p.id,p.display_name,p.base_name AS name,p.address,p.tax_no,c.code,c.alternate_name
      FROM parties p LEFT JOIN cert_customer_profiles c ON c.customer_id=p.id
      WHERE p.role='customer' AND (?=1 OR EXISTS (
        SELECT 1 FROM cert_projects cp WHERE cp.customer_id=p.id AND ${scope.clause}
      )) AND (?='' OR p.search_name LIKE ? OR p.display_name LIKE ? OR c.code LIKE ? OR c.alternate_name LIKE ?)
      ORDER BY p.created_at DESC,p.id DESC LIMIT 120
    `,[access.all_projects ? 1 : 0,...scope.params,match,like,typed,like,typed]));
  });
  router.post("/customers",(req,res) => {
    const access = checked(req,"create_master");
    if ((!access.allow_project_creation && !access.all_projects) || !hasMasterPermission(access))
      fail(403,"Customer creation requires company settings and new-project permission");
    const customer = database.transaction(() => {
      const saved = createCustomer(database,req.body);
      if (saved.created) {
        saveCustomerProfile(database,saved.id,req.body);
        audit(database,access.user,"customer_created",{details:{customer_id:saved.id}});
      } else if (!access.all_projects && !database.get(`
        SELECT 1 FROM cert_projects p JOIN cert_project_grants g ON g.project_id=p.id WHERE g.user_id=? AND p.customer_id=?
      `,[access.user.id,saved.id]) && !database.get("SELECT 1 FROM cert_customer_creators WHERE customer_id=? AND user_id=?",[saved.id,access.user.id])) {
        fail(409,"A matching customer exists. Request the customer or project from the administrator");
      }
      database.run("INSERT OR IGNORE INTO cert_customer_creators (customer_id,user_id) VALUES (?,?)",[saved.id,access.user.id]);
      return {...getCustomer(database,saved.id),created:saved.created};
    });
    res.status(customer.created ? 201 : 200).json(customer);
  });
  function scopedCustomer(req,capability){
    const access=checked(req,capability),id=idOf(req.params.customerId),scope=scopeSql(access,'cp.id');
    if(!access.all_projects&&!database.get(`SELECT 1 FROM cert_projects cp WHERE cp.customer_id=? AND ${scope.clause}`,[id,...scope.params]))fail(404,'Customer not found');
    return {access,id};
  }
  router.get('/customers/:customerId',(req,res)=>{const {id,access}=scopedCustomer(req,'view');res.json({...customerData(database,id),can_edit:access.capabilities.includes('create_master')&&hasMasterPermission(access)});});
  router.put('/customers/:customerId',(req,res)=>{
    const {access,id}=scopedCustomer(req,'create_master');
    if(!hasMasterPermission(access))fail(403,'Company settings permission is required to edit customer data');
    res.json(database.transaction(()=>saveCustomerData(database,id,req.body,access.user)));
  });
  router.put("/customers/:customerId/settings",(req,res) => {
    const access = checked(req,"manage_settings");
    const customerId = idOf(req.params.customerId);
    const scope = scopeSql(access,"cp.id");
    if (!access.all_projects && !database.get(`
      SELECT 1 FROM cert_projects cp WHERE cp.customer_id=? AND ${scope.clause}`,[customerId,...scope.params]))
      fail(404,"Customer not found");
    if (!access.all_projects && database.get(`SELECT 1 FROM cert_projects cp
      WHERE cp.customer_id=? AND NOT (${scope.clause})`,[customerId,...scope.params]))
      fail(403,"Customer defaults require access to all of this customer's projects");
    getCustomer(database,customerId);
    const input = {rules:req.body.rules === undefined ? undefined : cleanRules(req.body.rules),
      settings:cleanSettings(req.body.settings)};
    database.transaction(() => {
      database.run(`INSERT INTO cert_customer_profiles (customer_id,settings_json) VALUES (?,?)
        ON CONFLICT(customer_id) DO UPDATE SET settings_json=excluded.settings_json`,[customerId,encode(input)]);
      audit(database,access.user,"customer_defaults_updated",{details:{customer_id:customerId}});
    });
    res.json(input);
  });
  router.put("/admin/company-defaults",(req,res) => {
    const access = admin(req);
    const input = {rules:cleanRules(req.body.rules || []),settings:cleanSettings(req.body.settings)};
    database.transaction(() => {
      setSetting(database,"certificates_company_defaults",encode(input));
      audit(database,access.user,"company_defaults_updated");
    });
    res.json(input);
  });
  router.get("/projects",(req,res) => res.json(projectsResponse(database,req,checked(req,"view"))));
  router.post("/projects",(req,res) => {
    const access = checked(req,"create_master");
    if (!access.allow_project_creation && !access.all_projects) fail(403,"New-project permission is required");
    const linkedCustomer = idOf(req.body.customer_id);
    const canLink = access.all_projects || database.get(`
      SELECT 1 FROM cert_customer_creators WHERE customer_id=? AND user_id=?
      UNION SELECT 1 FROM cert_projects cp JOIN cert_project_grants g ON g.project_id=cp.id WHERE cp.customer_id=? AND g.user_id=?`,
      [linkedCustomer,access.user.id,linkedCustomer,access.user.id]);
    if (!canLink) fail(404,"Customer not found");
    const saved = database.transaction(() => {
      const result = createProject(database,{...req.body,raw:null},access.user.id);
      if (!result.created && !inScope(access,result.id)) fail(409,"A matching project exists. Request access from the administrator");
      if (result.created) {
        if (!access.all_projects) database.run("INSERT INTO cert_project_grants VALUES (?,?)",[access.user.id,result.id]);
        audit(database,access.user,"project_created",{projectId:result.id});
      }
      return {...getProject(database,result.id),created:result.created};
    });
    res.status(saved.created ? 201 : 200).json(saved);
  });
  router.get("/projects/:projectId",(req,res) => {
    const {project:row} = project(req,"view");
    const profile = getProfile(database,row.id);
    const baseline = database.get(`SELECT id,official_number,revision,work_to,collection_cutoff FROM cert_revisions
      WHERE project_id=? AND status='issued' ORDER BY work_to DESC,issued_at DESC,id DESC LIMIT 1`,[row.id]);
    res.json({...row,customer:getCustomer(database,row.customer_id),locations:projectLocations(database,row.id),
      work_types:profile.settings.work_types,work_items:profile.settings.work_items,
      settings:{...profile, latest_version:latestVersion(database,row.id)},baseline});
  });
  router.patch("/projects/:projectId",(req,res) => {
    const {project:row,access} = project(req,"manage_settings");
    res.json(database.transaction(() => {
      const saved = updateProject(database,row,req.body);
      audit(database,access.user,"project_details_updated",{projectId:row.id});
      return saved;
    }));
  });
  router.get("/projects/:projectId/entry-suggestions",(req,res) => {
    const {project:row} = project(req,"view");
    res.json(projectEntrySuggestions(database,row));
  });
  router.get("/projects/:projectId/operational-quantities",(req,res)=>{
    const {project:row,access}=project(req,"view");
    if (!access.capabilities.includes("ops_view")) fail(403,"Project Operations viewing permission is required");
    res.json(reconcileOperations(database,row.id,{cutoff:date(req.query.work_to,true)}));
  });
  router.post("/projects/:projectId/operational-quantities",(req,res)=>{
    const {project:row,access}=project(req,"view");
    if (!access.capabilities.includes("ops_view") || !access.capabilities.includes(req.body.revision_id?"edit_draft":"create"))
      fail(403,"Project Operations and certificate editing permissions are required");
    res.json(previewOperationalQuantities(database,row,req.body));
  });
  router.post("/projects/:projectId/locations",(req,res) => {
    const {project:row,access} = project(req,"create_master");
    const location = database.transaction(() => {
      const result = createLocation(database,row.id,req.body);
      if (result.created) audit(database,access.user,"location_created",{projectId:row.id,details:{location_id:result.id}});
      return {...projectLocations(database,row.id).find((entry) => entry.id === result.id),created:result.created};
    });
    res.status(location.created ? 201 : 200).json(location);
  });
  router.put("/projects/:projectId/settings",(req,res) => {
    const {project:row,access} = project(req,"manage_settings");
    res.json(database.transaction(() => saveProjectRules(database,row.id,req.body,access.user)));
  });
  router.get("/projects/:projectId/carry-forward",(req,res)=>{
    const {project:row}=project(req,"create");checked(req,"view",row.id);
    res.json(carryForwardLines(database,row,req.query));
  });
  router.get("/projects/:projectId/sources",(req,res) => {
    const {project:row} = project(req,"create");
    res.json(sourceList(database,row));
  });
  router.get("/projects/:projectId/collections",(req,res) => {
    const {project:row} = project(req,"view_collections");
    const cutoff = date(req.query.cutoff,true) || today();
    const ledger = allocationLedger(database,row.id,getProfile(database,row.id,cutoff),cutoff);
    res.json(collectionResponse(database,row,ledger,cutoff));
  });
  router.post("/projects/:projectId/collections",(req,res) => {
    const {project:row,access} = project(req,"manage_collections");
    checked(req,"view_collections",row.id);
    res.status(201).json(database.transaction(() => addReceipt(database,row,req.body,access.user)));
  });
  router.post("/projects/:projectId/collections/:receiptId/action",(req,res) => {
    const {project:row,access} = project(req,"manage_collections");
    checked(req,"view_collections",row.id);
    res.json(database.transaction(() => updateReceipt(database,row,idOf(req.params.receiptId),req.body,access.user)));
  });
  function saveReceiptChange(req,res) {
    const {project:row,access} = project(req,"manage_collections");
    checked(req,"view_collections",row.id);
    const remove = req.method === "DELETE";
    if (remove && !access.can_delete_documents) fail(403,"Only managers may delete project payments");
    res.json(database.transaction(() => changeReceipt(database,row,req.params.receiptId,remove ? null : req.body ?? {},access.user)));
  }
  router.route("/projects/:projectId/collections/:receiptId").patch(saveReceiptChange).delete(saveReceiptChange);
  router.get("/reports",(req,res) => res.json(reportResponse(database,req,checked(req,"view"))));

  router.get("/",(req,res) => res.json(certificateList(database,req,checked(req,"view"))));
  router.post("/",(req,res) => {
    const projectId = idOf(req.body.project_id);
    if (!projectId) fail(400,"Select a project");
    const access = checked(req,"create",projectId);
    if (req.body.header?.rule_override) checked(req,"manage_settings",projectId);
    if (Array.isArray(req.body.lines) && req.body.lines.length) checked(req,"edit_draft",projectId);
    const row = database.transaction(() => createDraft(database,getProject(database,projectId),req.body,access.user));
    res.status(201).json(detail(row,access));
  });

  registerCertificateDocumentRoutes(router,{
    database,dataDir,authorize:checked,
    getCertificate:(id) => getRevision(database,id),
    documentFor:(req,row) => printInput({...certificateDocumentInput(database,row),certificate_number:certificateNumber(database,row)},
      certificateSessionUser(database,req),req.query),
    issueAccess:(req,projectId) => checked(req,"issue",projectId),
  });

  router.get("/:id",(req,res) => {
    const {row,access} = revision(req,"view");
    res.json(detail(row,access));
  });
  for (const [path,remove] of [[ "/:id",deleteCertificate ],[ "/:id/documents",deleteArchivedFiles ]]) {
    router.delete(path,(req,res) => {
      const {row,access} = revision(req,"view");
      if (!access.can_delete_documents) fail(403,"Only managers may permanently delete certificates or their archived documents");
      res.json(database.transaction(() => remove(database,row,access.user,req.body?.version)));
    });
  }
  router.put("/:id",(req,res) => {
    const {row,access} = revision(req,"edit_draft");
    res.json(detail(database.transaction(() => saveDraft(database,row,req.body,access.user,access)),access));
  });
  router.post("/:id/action",(req,res) => {
    const action = str(req.body.action);
    const capability = ["submit","approve","issue"].includes(action) ? action : action === "return" ? "approve" : "revise";
    const {row,access} = revision(req,capability);
    const enqueue = (db, id, model) => enqueueCertificateRender(db,id,printInput(model,access.user));
    const updated = database.transaction(() => runAction(database,row,req.body,access.user,enqueue));
    res.json(detail(updated,access));
    if (action === "issue" && updated.pdf_status === "pending") {
      void processCertificateRender(database,updated.id,dataDir).catch((error) => console.warn("Certificate render paused: " + error.message));
    }
  });
  router.post("/:id/import/stage",(req,res) => {
    const {row,access} = revision(req,"import");
    res.json(database.transaction(() => stageImport(database,row,req.body,access.user)));
  });
  router.post("/:id/import/commit",(req,res) => {
    const {row,access} = revision(req,"import");
    checked(req,"edit_draft",row.project_id);
    res.json(detail(database.transaction(() => commitImport(database,row,req.body,access)),access));
  });
  router.use((error,req,res,next) => {
    if (res.headersSent) return next(error);
    if (!error.status) console.error("Certificate operation failed:",error);
    res.status(error.status || 500).json({error:error.status ? error.message : "Certificate operation failed",
      ...error.extra});
  });
}

module.exports = {initializeCertificates, registerCertificateRoutes, issueCertificateSession, revokeCertificateSession,
  certificateSessionUser, canChangeUsers, importLegacyCertificates, resumeCertificateRenders, CAPABILITIES};
