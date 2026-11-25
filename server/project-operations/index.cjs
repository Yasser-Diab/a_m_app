const fs = require("node:fs");
const path = require("node:path");
const {randomUUID} = require("node:crypto");
const express = require("express");
const {encode,parse,fail,str,idOf,scopeSql} = require("../certificate-access.cjs");
const {getProject,getCustomer} = require("../certificate-projects.cjs");
const core = require("./core.cjs");
const specs = require("./specifications.cjs");
const production = require("./production.cjs");
const finance = require("./finance.cjs");
const management = require("./management-reports.cjs");
const sourceRefresh=require("./source-refresh.cjs");
const loadingOrders=require('./loading-orders.cjs');
const {editedReport,saveReportEdit}=require('./report-edits.cjs');
const {report,appendDrawings,reportFilename} = require("./reports.cjs");
const {awardReference}=require("./references.cjs");

function initializeOperations(db) {
  require("../document-edit-window.cjs").initialize(db);
  db.exec(fs.readFileSync(path.join(__dirname,"schema.sql"),"utf8"));
  db.transaction(()=>{
    const addColumn=(table,column,definition)=>{
      if (!db.all(`PRAGMA table_info(${table})`).some(({name})=>name===column))
        db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    };
    addColumn("work_items","ops_adjustment_sign","INTEGER NOT NULL DEFAULT 1 CHECK(ops_adjustment_sign IN (-1,1))");
    addColumn("ops_projects","award_reference","TEXT");
    addColumn("ops_items","source_document_id","INTEGER REFERENCES documents(id)");
    addColumn("ops_items","defaults_applied","INTEGER NOT NULL DEFAULT 0");
    addColumn("ops_items","opening_description","TEXT NOT NULL DEFAULT ''");
    addColumn("ops_items","description_version","INTEGER NOT NULL DEFAULT 1");
    const migrateOverrides=!db.all('PRAGMA table_info(ops_items)').some(({name})=>name==='specification_overrides');
    addColumn("ops_items","specification_overrides","TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(specification_overrides))");
    addColumn("ops_people","signature_usage","TEXT NOT NULL DEFAULT ''");
    addColumn("ops_people","responsibility","TEXT NOT NULL DEFAULT ''");
    addColumn("ops_people","side","TEXT NOT NULL DEFAULT ''");
    addColumn("ops_people","signature_label","TEXT NOT NULL DEFAULT ''");
    db.run("UPDATE ops_people SET side=CASE WHEN user_id IS NOT NULL THEN 'company' ELSE 'client' END WHERE side=''");
    addColumn("ops_orders","command_key","TEXT");
    addColumn("ops_orders","source_document_id","INTEGER REFERENCES documents(id)");
    addColumn("ops_orders","source_scope","TEXT NOT NULL DEFAULT 'selected' CHECK(source_scope IN ('selected','all'))");
    addColumn("ops_project_specs","save_sequence","INTEGER NOT NULL DEFAULT 0");
    addColumn("ops_orders","kind","TEXT NOT NULL DEFAULT 'manufacturing' CHECK(kind IN ('manufacturing','maintenance'))");
    addColumn("ops_orders","service_data","TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(service_data))");
    addColumn("ops_orders","loading_settings","TEXT NOT NULL DEFAULT '{\"enabled\":false,\"rows\":[]}' CHECK(json_valid(loading_settings))");
    addColumn("ops_orders","loading_settings_version","INTEGER NOT NULL DEFAULT 0");
    addColumn("ops_loading_orders","vehicle_plate","TEXT NOT NULL DEFAULT ''");
    addColumn("ops_loading_orders","driver_name","TEXT NOT NULL DEFAULT ''");
    addColumn("ops_loading_orders","version","INTEGER NOT NULL DEFAULT 0");
    addColumn("ops_loading_orders","previous_reference","TEXT");
    addColumn("ops_loads","command_key","TEXT");
    addColumn("ops_loads","version","INTEGER NOT NULL DEFAULT 1");
    addColumn('ops_order_reviews','approver_name',"TEXT NOT NULL DEFAULT ''");
    addColumn('ops_order_reviews','approver_title',"TEXT NOT NULL DEFAULT ''");
    addColumn("ops_loads","shipment_data","TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(shipment_data))");
    addColumn("ops_inspections","reference","TEXT");
    addColumn("ops_confirmations","command_key","TEXT");
    for (const {project_id} of db.all("SELECT project_id FROM ops_projects WHERE award_reference IS NULL"))
      db.run("UPDATE ops_projects SET award_reference=? WHERE project_id=?",[awardReference(db,getProject(db,project_id)),project_id]);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ops_award_reference ON ops_projects(award_reference);
      CREATE UNIQUE INDEX IF NOT EXISTS ops_order_command ON ops_orders(project_id,command_key);
      CREATE UNIQUE INDEX IF NOT EXISTS ops_load_command ON ops_loads(order_id,command_key);
      CREATE UNIQUE INDEX IF NOT EXISTS ops_quantity_command ON ops_confirmations(item_id,command_key);`);
    db.run("INSERT OR IGNORE INTO ops_project_boqs(project_id,document_id,snapshot) SELECT project_id,boq_id,boq_snapshot FROM ops_projects");
    if (db.get("SELECT 1 FROM ops_items WHERE source_document_id IS NULL"))
      db.run(`UPDATE ops_items SET source_document_id=(SELECT boq_id FROM ops_projects p WHERE p.project_id=ops_items.project_id)
        WHERE source_document_id IS NULL`);
    db.exec("CREATE INDEX IF NOT EXISTS ops_item_source ON ops_items(project_id,source_document_id,id)");
    db.run(`UPDATE ops_orders SET source_document_id=(SELECT MIN(i.source_document_id) FROM ops_order_items oi JOIN ops_items i ON i.id=oi.item_id
      WHERE oi.order_id=ops_orders.id HAVING COUNT(DISTINCT i.source_document_id)=1) WHERE source_document_id IS NULL`);
    db.exec("CREATE INDEX IF NOT EXISTS ops_order_source ON ops_orders(project_id,source_document_id,kind)");
    specs.initializeSystems(db);
    require('./customer-defaults.cjs').initializeDefaults(db,migrateOverrides);
    const defaults=require('./customer-defaults.cjs');
    const seeded=new Map();
    for(const item of db.all(`SELECT i.*,MAX(a.id) AS last_save FROM ops_items i LEFT JOIN ops_audit a ON a.entity_id=i.id
      AND a.project_id=i.project_id AND a.action IN('specification_updated','opening_description_updated')
      WHERE i.active=1 AND i.system<>'' AND NOT EXISTS(SELECT 1 FROM ops_project_specs s WHERE s.project_id=i.project_id)
      GROUP BY i.id ORDER BY last_save DESC,i.id DESC`)){
      const current={...item,commercial:parse(item.commercial,{}),technical:parse(item.technical,{})};
      const key=encode([item.project_id,defaults.openingDescription(current),item.category,item.system]);
      if(!seeded.has(key))seeded.set(key,current);
    }
    for(const current of [...seeded.values()].reverse())defaults.rememberProjectSpecification(db,current);
    require('./manual-shipments.cjs').initialize(db);
    require('../inspections/index.cjs').initialize(db);
    require('./references.cjs').migrateLoadingReferences(db);
  });
}

function drawings(db,itemId) {
  return db.all(`SELECT id,name,mime,item_version,created_at,removed_at FROM ops_attachments WHERE item_id=? ORDER BY id DESC`,[itemId]);
}

function attachment(db,projectId,id,withContent=false) {
  const row=db.get(`SELECT a.id,a.name,a.mime,a.item_id,a.removed_at${withContent?",a.content":""}
    FROM ops_attachments a JOIN ops_items i ON i.id=a.item_id WHERE a.id=? AND i.project_id=?`,[id,projectId]);
  if (!row) fail(404,"Drawing not found");
  return row;
}

function storeDrawing(db,item,body,user) {
  const name=str(body.name,160).replace(/[\u0000-\u001f\u007f]/g,"");
  const mime=str(body.mime,40);
  const value=body.base64;
  if (!name || typeof value!=="string" || value.length>10_000_000 || !/^[a-z0-9+/]+={0,2}$/i.test(value))
    fail(400,"Choose a supported drawing up to 7 MB");
  const data=Buffer.from(value,"base64");
  const types={
    "image/png":()=>data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
    "image/jpeg":()=>data.subarray(0,3).equals(Buffer.from([255,216,255])),
    "image/webp":()=>data.toString("ascii",0,4)==="RIFF" && data.toString("ascii",8,12)==="WEBP",
    "application/pdf":()=>data.toString("ascii",0,5)==="%PDF-",
  };
  if (!types[mime]?.()) fail(400,"Choose a PNG, JPEG, WebP or PDF drawing");
  const id=db.run("INSERT INTO ops_attachments(item_id,item_version,name,mime,content,actor_id) VALUES (?,?,?,?,?,?)",
    [item.id,item.version,name,mime,new Uint8Array(data),user.id]).lastInsertRowid;
  core.record(db,user,item.project_id,"drawing_attached",id,{name,item_id:item.id,item_version:item.version});
  return drawings(db,item.id).find((row)=>row.id===id);
}

function saveSystem(db,body,actor) {
  const category=str(body.category,50);
  const en=str(body.en,180);
  const ar=str(body.ar,180)||en;
  if (!specs.categories.has(category) || !en) fail(400,"Select a category and enter a configuration name");
  const tags=[...new Set(Array.isArray(body.tags)?body.tags.map((value)=>str(value,40)).filter((value)=>/^[a-z_]+$/.test(value)):[])];
  const fields=specs.extensionFields(body.fields);
  const id=randomUUID();
  db.run("INSERT INTO ops_systems(id,category,ar,en,tags,fields) VALUES (?,?,?,?,?,?)",[id,category,ar,en,encode(tags),encode(fields)]);
  core.record(db,actor,null,"configuration_added",null,{id,category,ar,en,tags,fields});
  return {id,category,ar,en,tags,fields};
}

function registerOperations(app,db,{branding,allocateDocument,renderPdf}) {
  const router=express.Router();
  require('../inspections/index.cjs').register(router,db,{branding,renderPdf});
  function endpoint(method,route,capability,handler,write=false) {
    router[method](route,async(req,res)=>{
      const projectId=req.params.projectId==null?null:idOf(req.params.projectId);
      if (req.params.projectId!=null && !projectId) fail(404,"Project not found");
      const access=core.authorizeOperations(db,req,capability,projectId);
      const run=()=>handler(req,access,projectId,res);
      const result=await (write?db.transaction(run):run());
      if (!res.headersSent) res.json(result);
    });
  }
  const get=(route,handler,cap="ops_view")=>endpoint("get",route,cap,handler);
  const post=(route,cap,handler)=>endpoint("post",route,cap,handler,true);
  const patch=(route,cap,handler)=>endpoint("patch",route,cap,handler,true);
  const item=(req,id)=>core.getItem(db,id,idOf(req.params.itemId));
  const order=(req,id)=>production.order(db,id,idOf(req.params.orderId));
  const change=(req,id)=>core.getChange(db,id,idOf(req.params.changeId));
  const base="/projects/:projectId";
  get('/loading-options',(req,access)=>loadingOrders.options(db,access,req.query));
  get('/loading-orders',(req,access)=>loadingOrders.list(db,access,req.query));
  get('/loading-work-options',(req,access)=>require('./manual-shipments.cjs').workOptions(db,access,null,req.query.work_order_id,req.query.project_id));
  get('/loading-orders/:loadingId/work-options',(req,access)=>require('./manual-shipments.cjs').workOptions(db,access,idOf(req.params.loadingId),req.query.work_order_id));
  post('/loading-orders/:loadingId/shipment-preparation','ops_load',(req,access)=>require('./manual-shipments.cjs').preparation(db,access,idOf(req.params.loadingId)));
  post('/loading-orders/:loadingId/shipments','ops_release',(req,access)=>require('./manual-shipments.cjs').confirm(db,access,idOf(req.params.loadingId),req.body));
  get('/loading-orders/:loadingId',(req,access)=>loadingOrders.get(db,access,idOf(req.params.loadingId)));
  post('/loading-orders','ops_edit',(req,access)=>loadingOrders.create(db,access,req.body));
  patch('/loading-orders/:loadingId','ops_edit',(req,access)=>loadingOrders.update(db,access,idOf(req.params.loadingId),req.body));
  endpoint('post','/loading-orders/:loadingId/pdf','ops_export',async(req,access,_,res)=>{
    let order=loadingOrders.get(db,access,idOf(req.params.loadingId));
    if(req.body.history_id){const history=db.get("SELECT before_json FROM document_edit_history WHERE kind='manual_loading' AND document_id=? AND id=?",[order.id,idOf(req.body.history_id)]);if(!history)fail(404,'Loading order revision not found');order=JSON.parse(history.before_json);}
    const html=loadingOrders.manualReport(order,req.body,branding());
    const pdf=await renderPdf(html,{report_language:req.body.locale==='en'?'en':'ar',prepared_by:access.user.display_name||access.user.username});
    const name=reportFilename(order.customer,{reference:order.edit_window?.active_reference||order.reference,loading_reference:order.edit_window?.active_reference||order.reference},{kind:'loading',locale:req.body.locale});
    res.set('Cache-Control','no-store').set('Access-Control-Expose-Headers','Content-Disposition').attachment(name).type('application/pdf').send(pdf);
  });
  get('/delivery-notes',(req,access)=>require('./delivery-notes.cjs').list(db,access,req.query));
  get('/delivery-notes/:noteId',(req,access)=>require('./delivery-notes.cjs').get(db,access,req.params.noteId));
  patch('/delivery-notes/:noteId','ops_load',(req,access)=>require('./delivery-notes.cjs').save(db,access,req.params.noteId,req.body));
  endpoint('post','/delivery-notes/:noteId/pdf','ops_export',async(req,access,_,res)=>{
    const note=require('./delivery-notes.cjs').get(db,access,req.params.noteId);
    if(note.kind==='manual'){const output=require('./manual-shipments.cjs').report(db,access,note.id,req.body,branding());const pdf=await renderPdf(output.html,{report_language:req.body.locale==='en'?'en':'ar',prepared_by:access.user.display_name||access.user.username});res.set('Cache-Control','no-store').attachment(reportFilename(output.customer,{reference:output.reference,loading_reference:output.reference},{kind:'delivery',locale:req.body.locale})).type('application/pdf').send(pdf);return;}
    let snapshot;if(req.body.history_id){const history=db.get("SELECT before_json FROM document_edit_history WHERE kind='delivery' AND document_id=? AND id=?",[note.id,idOf(req.body.history_id)]);if(!history)fail(404,'Delivery Note revision not found');snapshot=JSON.parse(history.before_json);}
    const output=require('./shipment-report.cjs').shipmentReport(db,core.operation(db,note.project_id),note.order,note.id,req.body.locale,branding(),snapshot);
    const pdf=await renderPdf(output.html,{report_language:req.body.locale==='en'?'en':'ar',prepared_by:access.user.display_name||access.user.username});res.set('Cache-Control','no-store').attachment(reportFilename(output.customer,{reference:output.reference,loading_reference:output.reference},{kind:'delivery',locale:req.body.locale})).type('application/pdf').send(pdf);
  });
  get('/signature-directory',()=>require('../signature-directory.cjs').directory(db));
  get('/approval-options',(_,access)=>({name:access.user.display_name||access.user.username,...require('../signature-directory.cjs').directory(db)}));
  get("/catalogue",()=>specs.catalogueForClient(db));
  get("/projects",(req,access)=>core.projectChoices(db,access,req.query));
  get("/report-options",(_,access)=>management.reportOptions(db,access));
  function managementData(kind,access,query,all=false) {
    if(kind==="progress")return management.runningProjects(db,access,query,all);
    if(kind==="quantities")return management.workQuantities(db,access,query,all);
    fail(404,"Report not found");
  }
  get('/progress-preferences',(req,access)=>JSON.parse(require('../certificate-access.cjs').setting(db,'progress_preferences_'+access.user.id,'{}')));
  patch('/progress-preferences','ops_view',(req,access)=>{const clean=values=>[...new Set((Array.isArray(values)?values:[]).filter(key=>Object.hasOwn(management.stages,key)))];const data={stages:clean(req.body.stages),responsibles:clean(req.body.responsibles),include_completed:req.body.include_completed===true};require('../certificate-access.cjs').setSetting(db,'progress_preferences_'+access.user.id,JSON.stringify(data));return data;});
  get("/reports/:kind",(req,access)=>managementData(req.params.kind,access,req.query));
  endpoint("post","/reports/:kind/pdf","ops_export",async(req,access,_,res)=>{
    const data=managementData(req.params.kind,access,req.body,true);
    const html=management.managementReport(req.params.kind,data,req.body,branding());
    const pdf=await renderPdf(html,{landscape:req.params.kind==="progress",report_language:req.body.locale==="ar"?"ar":"en",prepared_by:access.user.display_name||access.user.username});
    const name=(req.params.kind==="progress"?"Current Work Summary":"Work Quantity Takeoff")+" - "+new Date().toISOString().slice(0,10)+".pdf";
    res.set("Cache-Control","no-store").set("Access-Control-Expose-Headers","Content-Disposition").attachment(name).type("application/pdf").send(pdf);
  });
  post("/resolve-project","ops_edit",(req,access)=>core.resolveProject(db,access,req.body));
  get("/employees",()=>db.all("SELECT id,display_name AS name FROM users WHERE is_active=1 ORDER BY display_name"),"ops_edit");
  get("/contacts",(req,access)=>core.contacts(db,access,req.query),"ops_edit");
  post("/catalogue","ops_catalogue",(req,access)=>{
    if (!access.all_projects) fail(403,"Company-wide permission is required to configure the catalogue");
    return saveSystem(db,req.body,access.user);
  });
  get(base,(_,__,id)=>core.projectContext(db,id));
  post(base,"ops_edit",(req,access,id)=>core.setup(db,getProject(db,id),idOf(req.body.boq_id),access.user,req.body.approval_date));
  post(base+"/boqs","ops_edit",(req,access,id)=>core.setup(db,getProject(db,id),idOf(req.body.boq_id),access.user,req.body.approval_date));
  get(base+"/source-refresh",(req,_,id)=>sourceRefresh.previewSource(db,id,req.query),'ops_edit');
  post(base+"/source-refresh",'ops_edit',(req,access,id)=>sourceRefresh.refreshSource(db,id,req.body,access.user));
  patch(base,"ops_edit",(req,access,id)=>core.changeProjectDetails(db,core.operation(db,id),req.body,access.user));
  patch(base+"/signatures","ops_edit",(req,access,id)=>core.saveReportSignatures(db,core.operation(db,id),req.body,access.user));
  get(base+"/people",(_,access,id)=>core.people(db,id,access.capabilities.includes("ops_edit")));
  post(base+"/people","ops_edit",(req,access,id)=>{
    core.operation(db,id);
    return core.addPerson(db,access,id,req.body);
  });
  patch(base+"/people/:personId","ops_edit",(req,access,id)=>{
    const person=db.get("SELECT * FROM ops_people WHERE id=? AND project_id=?",[idOf(req.params.personId),id]);
    if (!person) fail(404,"Assignment not found");
    const updated=core.updateAssignment(db,id,person.id,req.body);
    core.record(db,access.user,id,"assignment_updated",person.id,
      {position:updated.position,signature_usage:updated.signature_usage,responsibility:updated.responsibility});
    return updated;
  });
  endpoint("delete",base+"/people/:personId","ops_edit",(req,access,id)=>{
    const person=db.get("SELECT * FROM ops_people WHERE id=? AND project_id=?",[idOf(req.params.personId),id]);
    if (!person) fail(404,"Assignment not found");
    db.run("DELETE FROM ops_people WHERE id=?",[person.id]);
    core.record(db,access.user,id,"assignment_removed",person.id,person);
    return {id:person.id};
  },true);
  get(base+"/items",(req,_,id)=>core.itemPage(db,id,req.query));
  get(base+'/order-items',(req,_,id)=>production.availableItems(db,id,req.query));
  get(base+"/specification-groups",(req,_,id)=>core.specificationGroups(db,id,req.query));
  get(base+"/items/:itemId",(req,_,id)=>{
    const current=item(req,id);
    return {...current,approvals:production.itemApprovals(db,current),drawings:drawings(db,current.id)};
  });
  patch(base+"/items/:itemId","ops_edit",(req,access,id)=>{
    const updated=core.updateItem(db,item(req,id),req.body,access.user);
    if (req.body.remember===true) core.rememberSpecification(db,getProject(db,id).customer_id,updated);
    return updated;
  });
  post(base+"/specifications","ops_edit",(req,access,id,res)=>{
    try {return core.saveSpecifications(db,id,req.body,access.user);}
    catch(error) {
      if (!error.extra?.specification_conflicts) throw error;
      res.status(409).json({error:error.message,...error.extra});
    }
  });
  post(base+"/items","ops_edit",(req,access,id)=>{
    core.operation(db,id);
    return core.proposeItem(db,id,req.body,access.user);
  });
  post(base+"/items/:itemId/changes","ops_edit",(req,access,id)=>core.submitChange(db,item(req,id),req.body,access.user));
  post(base+"/items/:itemId/approvals","ops_release",(req,access,id)=>production.recordApprovals(db,item(req,id),req.body,access.user));
  post(base+"/items/:itemId/confirm","ops_load",(req,access,id)=>production.confirmQuantity(db,item(req,id),req.body,access));
  get(base+"/changes",(req,_,id)=>core.changePage(db,id,req.query));
  post(base+"/changes/:changeId/review","ops_approve",(req,access,id)=>{
    const reviewed=core.reviewChange(db,id,idOf(req.params.changeId),req.body,access.user);
    if (reviewed.status==="approved" && !finance.waitingForEarlierAdjustment(db,reviewed)) {
      finance.prepareAdjustment(db,core.operation(db,id),reviewed,access.user,allocateDocument);
      return change(req,id);
    }
    return reviewed;
  });
  get(base+"/changes/:changeId/adjustment",(req,_,id)=>{
    const current=change(req,id);
    return current.adjustment_id?finance.status(db,current.adjustment_id):null;
  },"ops_finance");
  post(base+"/changes/:changeId/adjustment","ops_finance",(req,access,id)=>
    finance.prepareAdjustment(db,core.operation(db,id),change(req,id),access.user,allocateDocument));
  post(base+"/changes/:changeId/post","ops_finance",(req,access,id)=>{
    const current=change(req,id);
    const state=core.operation(db,id);
    const posted=finance.postAdjustment(db,state,current,access.user);
    const next=db.get("SELECT id FROM ops_changes WHERE item_id=? AND id>? AND status='approved' ORDER BY id LIMIT 1",
      [current.item_id,current.id]);
    if (next) finance.prepareAdjustment(db,state,core.getChange(db,id,next.id),access.user,allocateDocument);
    return posted;
  });
  post(base+"/items/:itemId/drawings","ops_edit",(req,access,id)=>storeDrawing(db,item(req,id),req.body,access.user));
  get(base+"/drawings/:drawingId",(req,_,id,res)=>{
    const drawing=attachment(db,id,idOf(req.params.drawingId),true);
    res.set("X-Content-Type-Options","nosniff");
    res.set("Cache-Control","no-store");
    res.type(drawing.mime).send(Buffer.from(drawing.content));
  });
  endpoint("delete",base+"/drawings/:drawingId","ops_edit",(req,access,id)=>{
    const drawing=attachment(db,id,idOf(req.params.drawingId));
    if (drawing.removed_at) return {id:drawing.id};
    db.run("UPDATE ops_attachments SET removed_at=CURRENT_TIMESTAMP WHERE id=?",[drawing.id]);
    core.record(db,access.user,id,"drawing_archived",drawing.id,{item_id:drawing.item_id,name:drawing.name});
    return {id:drawing.id};
  },true);
  get(base+"/orders",(req,_,id)=>production.orderPage(db,id,req.query));
  post(base+"/orders","ops_edit",(req,access,id)=>{
    core.operation(db,id);
    return production.addOrder(db,id,req.body,access.user);
  });
  get(base+"/orders/:orderId",(req,_,id)=>production.orderDetails(db,order(req,id)));
  patch(base+"/orders/:orderId/loading-settings","ops_edit",(req,access,id)=>
    production.saveLoadingSettings(db,order(req,id),req.body,access.user));
  post(base+"/orders/:orderId/loading-transport/prepare","ops_export",(req,access,id)=>production.loadingTransport(db,order(req,id),access.user,req.body.loading_reference));
  patch(base+"/orders/:orderId/loading-transport","ops_edit",(req,access,id)=>production.saveLoadingTransport(db,order(req,id),req.body,access.user));
  patch(base+"/orders/:orderId","ops_release",(req,access,id)=>production.updateOrderStatus(db,order(req,id),req.body,access.user));
  post(base+"/orders/:orderId/complete","ops_edit",(req,access,id)=>
    production.completeService(db,order(req,id),req.body,access.user));
  post(base+"/orders/:orderId/refresh","ops_edit",(req,access,id)=>production.refreshDraftOrder(db,order(req,id),access.user));
  post(base+'/orders/:orderId/include-remaining','ops_edit',(req,access,id)=>production.includeRemaining(db,order(req,id),req.body,access));
  post(base+"/orders/:orderId/inspections","ops_qc",(req,access,id)=>production.inspect(db,order(req,id),req.body,access));
  post(base+"/orders/:orderId/approvals","ops_release",(req,access,id)=>production.reviewStage(db,order(req,id),req.body,access));
  get(base+'/orders/:orderId/review-changes',(req,_,id)=>require('./approval-review.cjs').changes(db,order(req,id)));
  post(base+'/orders/:orderId/review-changes','ops_release',(req,access,id)=>require('./approval-review.cjs').save(db,order(req,id),req.body,access));
  endpoint('post',base+'/orders/:orderId/history/:historyId/pdf','ops_export',async(req,access,id,res)=>{const current=order(req,id),history=db.get("SELECT * FROM document_edit_history WHERE kind='order' AND document_id=? AND id=?",[current.id,idOf(req.params.historyId)]);if(!history)fail(404,'Order revision not found');const output=require('./reports.cjs').snapshotReport(db,core.operation(db,id),JSON.parse(history.before_json),req.body.locale==='en'?'en':'ar',branding());const pdf=await appendDrawings(await renderPdf(output.html,{report_language:req.body.locale}),output.pdfDrawings);res.attachment(history.reference+' - previous.pdf').type('application/pdf').send(pdf);});
  get(base+'/orders/:orderId/installation',(req,_,id)=>require('./lifecycle.cjs').installation(db,order(req,id)));
  patch(base+'/orders/:orderId/installation','ops_edit',(req,access,id)=>require('./lifecycle.cjs').saveInstallation(db,order(req,id),req.body,access.user));
  patch(base+'/orders/:orderId/responsibilities','ops_edit',(req,access,id)=>require('./lifecycle.cjs').assign(db,order(req,id),req.body,access.user));
  post(base+'/orders/:orderId/confirm-stage','ops_edit',(req,access,id)=>require('./lifecycle.cjs').confirmStage(db,order(req,id),req.body,access.user));
  post(base+'/orders/:orderId/reopen','ops_release',(req,access,id)=>require('./lifecycle.cjs').reopen(db,order(req,id),req.body,access.user));
  post(base+"/orders/:orderId/loading","ops_load",(req,access,id)=>production.loadBatch(db,order(req,id),req.body,access.user));
  post(base+'/orders/:orderId/shipment-preparation','ops_load',(req,access,id)=>production.shipmentPreparation(db,order(req,id),access.user));
  post(base+'/orders/:orderId/shipment','ops_release',(req,access,id)=>production.confirmShipment(db,order(req,id),req.body,access));
  endpoint('post',base+'/orders/:orderId/shipments/:loadId/pdf','ops_export',async(req,access,id,res)=>{
    const current=order(req,id),manual=db.get('SELECT m.id FROM ops_manual_shipments m JOIN ops_loads l ON l.id=m.linked_load_id WHERE l.id=? AND l.order_id=?',[idOf(req.params.loadId),current.id]);
    const output=manual?require('./manual-shipments.cjs').report(db,access,'manual-'+manual.id,req.body,branding()):require('./shipment-report.cjs').shipmentReport(db,core.operation(db,id),current,idOf(req.params.loadId),req.body.locale,branding());
    const pdf=await renderPdf(output.html,{report_language:req.body.locale==='en'?'en':'ar',prepared_by:access.user.display_name||access.user.username});
    const name=reportFilename(output.customer,{reference:output.reference,loading_reference:output.reference},{kind:'delivery',locale:req.body.locale});
    res.set('Cache-Control','no-store').set('Access-Control-Expose-Headers','Content-Disposition').attachment(name).type('application/pdf').send(pdf);
  });
  const prepareReport=(req,access,id)=>db.transaction(()=>{
    const current=production.prepareOutput(db,order(req,id),req.body,access.user);
    const output=report(db,core.operation(db,id),current,req.body,branding());
    return {current,...output,...editedReport(db,current,req.body,output.html)};
  });
  endpoint("post",base+"/orders/:orderId/report","ops_export",(req,access,id)=>{
    const {html,edit_version,document_ref,report_key,customized}=prepareReport(req,access,id);return {html,edit_version,document_ref,report_key,customized};
  });
  post(base+'/orders/:orderId/report-edits','ops_edit',(req,access,id)=>{
    const current=production.prepareOutput(db,order(req,id),req.body,access.user);
    return saveReportEdit(db,current,req.body,access.user);
  });
  endpoint("post",base+"/orders/:orderId/pdf","ops_export",async(req,access,id,res)=>{
    const {current,html,pdfDrawings}=prepareReport(req,access,id);
    const rendered=await renderPdf(html,{landscape:req.body.kind==='approvals',report_language:req.body.locale==="ar"?"ar":"en",prepared_by:access.user.display_name || access.user.username});
    const pdf=await appendDrawings(rendered,pdfDrawings);
    const customer=getCustomer(db,getProject(db,id).customer_id);
    const name=reportFilename(customer,current,req.body);
    res.set("Cache-Control","no-store").set("Access-Control-Expose-Headers","Content-Disposition").attachment(name).type("application/pdf").send(pdf);
  });
  get(base+"/loading",(_,__,id)=>{
    const rows=db.all(`SELECT o.id,o.reference,o.status FROM ops_orders o WHERE o.project_id=? ORDER BY o.id DESC`,[id])
      .map((order)=>({...order,items:production.loadingBalances(db,order.id)}));
    return {orders:rows,totals:rows.flatMap(({items})=>items).reduce((sum,row)=>({
      required:sum.required+row.required,loaded:sum.loaded+row.loaded,remaining:sum.remaining+row.remaining,
    }),{required:0,loaded:0,remaining:0})};
  });
  get(base+"/claims",(req,_,id)=>finance.reconcile(db,id,{cutoff:str(req.query.cutoff,10)||null}));
  get(base+"/history",(req,_,id)=>{
    const {page,limit,offset}=core.pageOptions(req.query);
    return {page,limit,total:db.get("SELECT COUNT(*) AS n FROM ops_audit WHERE project_id=?",[id]).n,
      items:db.all("SELECT * FROM ops_audit WHERE project_id=? ORDER BY id DESC LIMIT ? OFFSET ?",[id,limit,offset])
        .map((entry)=>({...entry,details:parse(entry.details)}))};
  });
  router.use((error,req,res,next)=>error.status?res.status(error.status).json({error:error.message}):next(error));
  app.use("/api/project-operations",router);
}

module.exports = {initializeOperations,registerOperations,isAdjustment:finance.isAdjustment,reconcile:finance.reconcile};
