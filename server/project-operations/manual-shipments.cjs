const {fail,str,parse,encode,date,today,inScope,audit}=require('../certificate-access.cjs');
const windows=require('../document-edit-window.cjs');
const plans=require('./loading-orders.cjs');
const production=require('./production.cjs');
const {unitKey}=require('./order-quantities.cjs');

function initialize(db){
 db.exec(`CREATE TABLE IF NOT EXISTS ops_manual_shipments(
  id INTEGER PRIMARY KEY AUTOINCREMENT,loading_order_id INTEGER NOT NULL REFERENCES ops_manual_loading_orders(id) ON DELETE CASCADE,
  reference TEXT NOT NULL UNIQUE,command_key TEXT NOT NULL,loading_date TEXT NOT NULL,
  data TEXT NOT NULL CHECK(json_valid(data)),linked_load_id INTEGER UNIQUE REFERENCES ops_loads(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1,recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(loading_order_id,command_key));
 CREATE TABLE IF NOT EXISTS ops_manual_shipment_lines(
  shipment_id INTEGER NOT NULL REFERENCES ops_manual_shipments(id) ON DELETE CASCADE,
  row_id TEXT NOT NULL,quantity REAL NOT NULL CHECK(quantity>0),PRIMARY KEY(shipment_id,row_id));
 CREATE INDEX IF NOT EXISTS ops_manual_shipment_order ON ops_manual_shipments(loading_order_id,id);
 CREATE INDEX IF NOT EXISTS ops_manual_shipment_row ON ops_manual_shipment_lines(row_id,shipment_id);`);
 if(!db.all('PRAGMA table_info(ops_manual_loading_orders)').some(column=>column.name==='work_order_id'))db.run('ALTER TABLE ops_manual_loading_orders ADD COLUMN work_order_id INTEGER REFERENCES ops_orders(id) ON DELETE SET NULL');
 if(!db.get("SELECT 1 FROM app_settings WHERE key='ops_manual_shipment_ids_v1'")){for(const order of db.all('SELECT id,items FROM ops_manual_loading_orders')){
  const items=parse(order.items,[]);if(items.some(item=>!item.id))db.run('UPDATE ops_manual_loading_orders SET items=? WHERE id=?',[encode(items.map((item,index)=>({...item,id:item.id||'legacy-'+order.id+'-'+index}))),order.id]);
 }db.run("INSERT INTO app_settings(key,value) VALUES('ops_manual_shipment_ids_v1','1')");}
}
const external=id=>'manual-'+id;
const numeric=id=>Number(String(id).replace(/^manual-/,''));
function quantities(db,id,exclude=null,through=null){return new Map(db.all(`SELECT l.row_id,SUM(l.quantity) quantity FROM ops_manual_shipment_lines l JOIN ops_manual_shipments s ON s.id=l.shipment_id
 WHERE s.loading_order_id=? AND (? IS NULL OR s.id<>?) AND (? IS NULL OR s.id<=?) GROUP BY l.row_id`,[id,exclude,exclude,through,through]).map(row=>[row.row_id,Number(row.quantity)]));}
function validatePlan(db,before,data,workOrderId){
 const linked=workOrderId?production.order(db,before.project_id,workOrderId):null;
 if(linked&&require('./maintenance.cjs').onSite(linked))fail(400,'On-site maintenance does not have loading components');
 const parts=new Map(linked?production.loadingParts(db,linked).map(part=>[part.part_id,part]):[]),seen=new Set(),loaded=quantities(db,before.id||0);
 for(const item of data.items){
  const old=before.items?.find(row=>row.id===item.id),done=loaded.get(item.id)||0;
  if(done>Number(item.quantity)+1e-8)fail(409,'Required quantities cannot be below confirmed shipments');
  if(done&&(!old||unitKey(old.unit)!==unitKey(item.unit)||old.part_id!==item.part_id||old.part_id&&before.work_order_id!==workOrderId))fail(409,'Keep the unit and work link of an already shipped item');
  if(item.part_id){const part=parts.get(item.part_id);if(!part||seen.has(item.part_id))fail(400,'Choose each related work component once');seen.add(item.part_id);if(!part.custom&&!Number.isInteger(item.quantity))fail(400,'Work components require whole quantities');if(item.quantity>part.required+1e-8)fail(400,'Required quantity exceeds the related component quantity');if(unitKey(item.unit)!==unitKey(part.unit))fail(400,'Use the same unit as the related work component');}
 }
 if(before.items?.some(row=>loaded.get(row.id)>0&&!data.items.some(item=>item.id===row.id)))fail(409,'An item with confirmed shipments cannot be removed');
}
function workOptions(db,access,id,selected,projectId){
 const plan=id?plans.get(db,access,id):{project_id:Number(projectId)};if(!inScope(access,plan.project_id))fail(404,'Project not found');require('../certificate-projects.cjs').getProject(db,plan.project_id);const orders=db.all(`SELECT o.id,o.reference,o.status,d.operation_no source_reference,d.document_type source_type FROM ops_orders o LEFT JOIN documents d ON d.id=o.source_document_id
 WHERE o.project_id=? AND NOT(o.kind='maintenance' AND COALESCE(json_extract(o.service_data,'$.mode'),'site')<>'factory') ORDER BY o.id DESC`,[plan.project_id]);
 const choice=selected?production.order(db,plan.project_id,Number(selected)):null;
 return {orders,parts:choice?production.loadingParts(db,choice):[]};
}
function balance(db,plan,exclude=null){
 const done=quantities(db,plan.id,exclude),linked=plan.work_order_id?production.order(db,plan.project_id,plan.work_order_id):null;
 const work=new Map(linked?production.loadingParts(db,linked).map(part=>[part.part_id,part]):[]);
 const ownLoad=exclude?db.get('SELECT linked_load_id FROM ops_manual_shipments WHERE id=?',[exclude])?.linked_load_id:null;
 const ownParts=ownLoad?new Map(require('./shipment-report.cjs').shipmentData(db,linked,ownLoad).lines.map(part=>[part.part_id,part.quantity])):new Map();
 return plan.items.map(item=>{const loaded=done.get(item.id)||0,remaining=Math.max(0,Number(item.quantity)-loaded),part=item.part_id?work.get(item.part_id):null;
  const available=item.part_id?Math.min(remaining,Math.max(0,(part?.remaining||0)+Number(ownParts.get(item.part_id)||0))):remaining;
  return {...item,loaded,remaining,available,work_integer:Boolean(part&&!part.custom),work_remaining:item.part_id?available:null};});
}
function preparation(db,access,id){
 const plan=plans.get(db,access,id);if(plan.status!=='issued')fail(409,'Issue the loading order before confirming a shipment');
 return {...plan,rows:balance(db,plan),loading_lead:access.user.display_name||access.user.username};
}
function get(db,access,id){
 const batch=db.get('SELECT s.*,p.project_id FROM ops_manual_shipments s JOIN ops_manual_loading_orders p ON p.id=s.loading_order_id WHERE s.id=?',[numeric(id)]);
 if(!batch||!inScope(access,batch.project_id))fail(404,'Delivery Note not found');
 const data=parse(batch.data,{}),plan=plans.get(db,access,batch.loading_order_id);
 return {...batch,...data,id:external(batch.id),manual_shipment_id:batch.id,kind:'manual',manual_order_id:plan.id,order:{...plan,kind:'manual'},rows:balance(db,plan,batch.id),
  amounts:Object.fromEntries(db.all('SELECT row_id,quantity FROM ops_manual_shipment_lines WHERE shipment_id=?',[batch.id]).map(row=>[row.row_id,row.quantity])),
  reference:windows.info(db,'manual_delivery',batch.id,batch.recorded_at).active_reference||batch.reference,
  edit_window:windows.info(db,'manual_delivery',batch.id,batch.recorded_at),history:windows.history(db,'manual_delivery',batch.id)};
}
function inputLines(plan,rows,body){
 if(!Array.isArray(body.items)||!body.items.length)fail(400,'Enter actual shipment quantities');
 const available=new Map(rows.map(row=>[row.id,row])),seen=new Set(),positions=new Map(plan.items.map((row,index)=>[row.id,index]));
 return body.items.map(input=>{const row=available.get(input.row_id),quantity=Number(input.quantity);if(!row||seen.has(row.id)||!Number.isFinite(quantity)||quantity<=0||quantity>row.available+1e-8)fail(409,'Confirm quantities within the remaining balance');
  if(row.work_integer&&!Number.isInteger(quantity))fail(400,'Work components require whole quantities');seen.add(row.id);return {...row,required:row.quantity,quantity};}).sort((a,b)=>positions.get(a.id)-positions.get(b.id));
}
function transport(body){const loading_lead=str(body.loading_lead,200);if(!loading_lead)fail(400,'Enter the person responsible for loading');return {loading_lead,vehicle_plate:str(body.vehicle_plate,100),driver_name:str(body.driver_name,200),notes:str(body.notes,5000)};}
function writeLines(db,id,lines){db.run('DELETE FROM ops_manual_shipment_lines WHERE shipment_id=?',[id]);for(const line of lines)db.run('INSERT INTO ops_manual_shipment_lines VALUES(?,?,?)',[id,line.id,line.quantity]);}
function exposeLinkedReference(db,loadId,reference){if(!loadId)return;const batch=db.get('SELECT shipment_data FROM ops_loads WHERE id=?',[loadId]);db.run('UPDATE ops_loads SET shipment_data=? WHERE id=?',[encode({...parse(batch.shipment_data,{}),document_reference:reference}),loadId]);}
function confirm(db,access,id,body){
 if(!access.capabilities.includes('ops_load'))fail(403,'Loading permission is required');
 const plan=plans.get(db,access,id),key=str(body.command_key,100);if(!key)fail(400,'Provide a shipment request reference');
 const previous=db.get('SELECT id FROM ops_manual_shipments WHERE loading_order_id=? AND command_key=?',[id,key]);if(previous)return get(db,access,previous.id);
 if(plan.status!=='issued')fail(409,'Issue the loading order before confirming a shipment');
 if(Number(body.order_version)!==plan.version)fail(409,'The loading plan changed. Reload before confirming');
 const lines=inputLines(plan,balance(db,plan),body),details=transport({loading_lead:access.user.display_name||access.user.username,...plan,...body}),loading_date=date(body.loading_date,true)||today();
 let linkedLoad=null;const mapped=lines.filter(line=>line.part_id);
 if(mapped.length){const order=production.order(db,plan.project_id,plan.work_order_id);linkedLoad=production.confirmShipment(db,order,{command_key:'manual-'+plan.id+'-'+key,loading_date,parts:mapped.map(line=>({part_id:line.part_id,quantity:line.quantity})),responsible:{loading:details.loading_lead},vehicle_plate:details.vehicle_plate,driver_name:details.driver_name,notes:details.notes},access).id;}
 const reference=require('./references.cjs').nextReference(db,plan.project_id,'LO'),snapshot={...details,items:lines,signatures:plan.signatures,work_snapshot:linkedLoad?require('./shipment-report.cjs').shipmentData(db,production.order(db,plan.project_id,plan.work_order_id),linkedLoad):null};
 const note=db.run('INSERT INTO ops_manual_shipments(loading_order_id,reference,command_key,loading_date,data,linked_load_id,recorded_by) VALUES(?,?,?,?,?,?,?)',[id,reference,key,loading_date,encode(snapshot),linkedLoad,access.user.id]).lastInsertRowid;
 writeLines(db,note,lines);windows.lock(db,'manual_delivery',note);exposeLinkedReference(db,linkedLoad,reference);
 audit(db,access.user,'manual_shipment_confirmed',{projectId:plan.project_id,details:{id:note,reference,loading_order_id:id,linked_load_id:linkedLoad}});
 return get(db,access,note);
}
function save(db,access,id,body){
 if(!access.capabilities.includes('ops_release'))fail(403,'Release permission is required to edit a confirmed Delivery Note');
 const old=get(db,access,id),plan=old.order;if(Number(body.version)!==old.version)fail(409,'The Delivery Note changed. Reload before saving');
 windows.check(db,'manual_delivery',old.manual_shipment_id,old.recorded_at,body.correction===true,body.reason);
 const lines=inputLines(plan,balance(db,plan,old.manual_shipment_id),{...body,items:body.items??Object.entries(old.amounts).map(([row_id,quantity])=>({row_id,quantity}))}),details=transport({...old,...body}),loading_date=date(body.loading_date??old.loading_date,true)||today();
 const before=snapshot(db,old),mapped=lines.filter(line=>line.part_id);let linkedLoad=old.linked_load_id;
 if(linkedLoad){const linked=require('./delivery-notes.cjs').get(db,access,linkedLoad);
  if(mapped.length)require('./delivery-notes.cjs').save(db,access,linkedLoad,{...body,version:linked.version,parts:mapped.map(line=>({part_id:line.part_id,quantity:line.quantity})),loading_date,responsible:{loading:details.loading_lead}}, {manualShipmentId:old.manual_shipment_id});
  else{
   windows.check(db,'delivery',linkedLoad,linked.edit_window.first_locked_at,body.correction===true,body.reason);
   const prior=require('./shipment-report.cjs').shipmentData(db,linked.order,linkedLoad);
   db.run('DELETE FROM ops_load_lines WHERE load_id=?',[linkedLoad]);db.run('DELETE FROM ops_load_parts WHERE load_id=?',[linkedLoad]);
   const empty={items:[],parts:[],lines:[],transport:{vehicle_plate:details.vehicle_plate,driver_name:details.driver_name}};
   db.run('UPDATE ops_loads SET loading_date=?,shipment_data=?,responsible=?,notes=?,version=version+1 WHERE id=?',[loading_date,encode(empty),encode({loading:{name:details.loading_lead,side:'company'}}),details.notes,linkedLoad]);
   if(require('./lifecycle.cjs').installation(db,linked.order).items.some(row=>row.installed>row.loaded))fail(409,'The change would leave installed openings without sufficient delivered parts');
   if(production.loadingParts(db,linked.order).some(part=>part.remaining>0))db.run("UPDATE ops_orders SET status='released' WHERE id=?",[linked.order_id]);
   windows.revision(db,'delivery',linkedLoad,linked.base_reference,prior,empty,access.user,{correction:body.correction===true,reason:body.reason});
  }
 }else if(mapped.length){linkedLoad=production.confirmShipment(db,production.order(db,plan.project_id,plan.work_order_id),{command_key:'manual-edit-'+old.manual_shipment_id+'-'+old.version,loading_date,parts:mapped.map(line=>({part_id:line.part_id,quantity:line.quantity})),responsible:{loading:details.loading_lead},vehicle_plate:details.vehicle_plate,driver_name:details.driver_name,notes:details.notes},access).id;}
 const revision=windows.revision(db,'manual_delivery',old.manual_shipment_id,old.reference.replace(/-COR-\d+$/,''),before,null,access.user,{correction:body.correction===true,reason:body.reason});
 const reference=body.correction?revision.reference:old.reference;
 writeLines(db,old.manual_shipment_id,lines);db.run('UPDATE ops_manual_shipments SET loading_date=?,data=?,linked_load_id=?,version=version+1 WHERE id=?',[loading_date,encode({...details,items:lines,signatures:old.signatures,work_snapshot:linkedLoad?require('./shipment-report.cjs').shipmentData(db,production.order(db,plan.project_id,plan.work_order_id),linkedLoad):old.work_snapshot}),linkedLoad,old.manual_shipment_id]);exposeLinkedReference(db,linkedLoad,reference);
 db.run('UPDATE document_edit_history SET after_json=? WHERE id=?',[encode(snapshot(db,get(db,access,id))),revision.id]);
 audit(db,access.user,'manual_delivery_note_edited',{projectId:plan.project_id,details:{id:old.manual_shipment_id,reference}});return get(db,access,id);
}
function snapshot(db,note){
 const all=quantities(db,note.manual_order_id,null,note.manual_shipment_id),general=note.items.filter(item=>!item.part_id);
 let data=note.linked_load_id?require('./shipment-report.cjs').shipmentData(db,production.order(db,note.project_id,note.order.work_order_id),note.linked_load_id):note.work_snapshot||{items:[],parts:[],lines:[],cumulative_lines:[]};
 data={...data,items:[...data.items],parts:[...data.parts],lines:[...data.lines],cumulative_lines:[...data.cumulative_lines],reference:note.reference,transport:{vehicle_plate:note.vehicle_plate,driver_name:note.driver_name},manual_signatures:note.signatures||[],notes:note.notes};
 for(const item of general){const part_id='manual:'+item.id;data.parts.push({part_id,label:item.label,description:item.label,unit:item.unit,required:item.required||item.quantity,custom:true});data.lines.push({part_id,quantity:item.quantity});data.cumulative_lines.push({part_id,quantity:all.get(item.id)||0});}
 if(note.loading_lead&&!data.manual_signatures.some(person=>person.name===note.loading_lead))data.manual_signatures.push({name:note.loading_lead,side:'company',responsibility:'loading'});
 return data;
}
function report(db,access,id,options,branding){const note=get(db,access,id);let data;
 if(options.history_id){const old=db.get("SELECT before_json FROM document_edit_history WHERE kind='manual_delivery' AND document_id=? AND id=?",[note.manual_shipment_id,Number(options.history_id)]);if(!old)fail(404,'Delivery Note revision not found');data=JSON.parse(old.before_json);}else data=snapshot(db,note);
 const operation=db.get('SELECT * FROM ops_projects WHERE project_id=?',[note.project_id]);
 const state=operation?{...operation,details:parse(operation.details,{})}:{details:note.order.project_details||{}};
 return require('./shipment-report.cjs').shipmentReport(db,state,{...note.order,kind:'manual'},null,options.locale,branding,data);
}
module.exports={initialize,quantities,validatePlan,workOptions,balance,preparation,get,confirm,save,report};
