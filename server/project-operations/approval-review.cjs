const {encode,parse,str,fail}=require('../certificate-access.cjs');
const core=require('./core.cjs'),specs=require('./specifications.cjs'),windows=require('../document-edit-window.cjs');
const canonical=value=>JSON.stringify(value&&typeof value==='object'?(Array.isArray(value)?value.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(value).sort().map(key=>[key,JSON.parse(canonical(value[key]))]))):value??null);
function manufacturingData(item){return {category:item.category,system:item.system,technical:Object.fromEntries(Object.entries(item.technical||{}).filter(([key])=>!['tag','location','floor','building','quantity'].includes(key)))};}
function changes(db,current){
 const order=require('./production.cjs').orderDetails(db,current);
 const rows=order.items.map(row=>{const item=core.getItem(db,current.project_id,row.item_id),before=row.specification;
  const fields=[...new Set([...Object.keys(before.technical||{}),...Object.keys(item.technical||{})])].filter(key=>canonical(before.technical[key])!==canonical(item.technical[key]));
  return {id:row.id,item_id:item.id,description:require('./customer-defaults.cjs').openingDescription(item),version:item.version,before_version:before.version,
   changed:item.version!==before.version||item.opening_description!==before.opening_description,
   metadata_only:canonical(manufacturingData(before))===canonical(manufacturingData(item)),fields};});
 return {rows:rows.filter(row=>row.changed),edit_window:order.edit_window,stages:order.stage_approvals};
}
function inheritApprovals(db,row,item){
 db.run(`INSERT OR IGNORE INTO ops_item_approvals(item_id,item_version,part,decision,reference,actor_id,approved_at)
  SELECT item_id,?,part,decision,reference,actor_id,approved_at FROM ops_item_approvals old WHERE item_id=? AND item_version=?
  AND NOT EXISTS(SELECT 1 FROM ops_order_reviews r WHERE r.order_item_id=? AND r.item_version=? AND r.stage=old.part)`,[item.version,item.id,row.specification.version,row.id,item.version]);
 db.run(`INSERT OR IGNORE INTO ops_order_reviews(order_item_id,item_version,stage,approved,actor_id,updated_at,approver_name,approver_title)
  SELECT order_item_id,?,stage,approved,actor_id,updated_at,approver_name,approver_title FROM ops_order_reviews WHERE order_item_id=? AND item_version=?`,[item.version,row.id,row.specification.version]);
 const existing=db.all('SELECT * FROM ops_inspections WHERE order_item_id=?',[row.id]),seen=new Set();
 for(const inspection of [...existing].reverse()){
  const record=parse(inspection.record,{});if(record.item_version!==row.specification.version||seen.has(inspection.stage))continue;seen.add(inspection.stage);
  if(existing.some(next=>next.stage===inspection.stage&&parse(next.record,{}).item_version===item.version))continue;
  db.run('INSERT INTO ops_inspections(order_item_id,stage,inspection_date,inspector_id,inspector_name,record,reference) VALUES(?,?,?,?,?,?,?)',[row.id,inspection.stage,inspection.inspection_date,inspection.inspector_id,inspection.inspector_name,encode({...record,item_version:item.version,inherited_from:inspection.id,metadata_only:true}),require('./references.cjs').nextReference(db,item.project_id,'QC')]);
 }
}
function save(db,current,body,access){
 const production=require('./production.cjs'),before=production.orderDetails(db,current),preview=changes(db,current);
 windows.check(db,'order',current.id,preview.edit_window.first_locked_at,body.correction===true,body.reason);
 if(preview.edit_window.locked)windows.lock(db,'order',current.id,preview.edit_window.first_locked_at);
 const revisions=new Map(preview.rows.map(row=>[row.id,row]));
 if(preview.rows.length&&!Array.isArray(body.versions))fail(400,'Review the changed opening versions');
 for(const row of before.items){
  const change=revisions.get(row.id);if(!change)continue;
  const expected=body.versions.find(version=>Number(version.id)===row.id);
  if(Number(expected?.version)!==change.version)fail(409,'The opening changed during review. Reload the review');
  const item=core.getItem(db,current.project_id,row.item_id);if(!item.active||!item.system)fail(409,'The opening is no longer active or configured');
  const reserved=db.get("SELECT SUM(i.quantity) n FROM ops_order_items i JOIN ops_orders o ON o.id=i.order_id WHERE i.item_id=? AND o.kind='manufacturing'",[item.id]).n||0;
  if(reserved>item.technical.quantity)fail(409,'The revised source quantity is below the existing work orders');
  const system=specs.configuration(db,item.category,item.system),quantities=specs.loadingQuantities(item.category,system,item.technical,row.quantity);
  for(const loaded of db.all('SELECT kind,SUM(quantity) quantity FROM ops_load_lines WHERE order_item_id=? GROUP BY kind',[row.id]))
   if(loaded.quantity>(quantities[loaded.kind]||0))fail(409,'Confirmed loading exceeds the revised component quantity. Correct the Delivery Notes or create a new work order');
  if(change.metadata_only&&row.specification.version!==item.version)inheritApprovals(db,row,item);
  db.run('UPDATE ops_order_items SET quantities=?,specification=? WHERE id=?',[encode(quantities),encode({...item,original:undefined,system_label:{ar:system.ar,en:system.en}}),row.id]);
 }
 if(current.status==='closed'){
  const status=db.get('SELECT 1 FROM ops_loads WHERE order_id=?',[current.id])?'shipped':'draft';db.run('UPDATE ops_orders SET status=? WHERE id=?',[status,current.id]);current={...current,status};
 }
 const stages=body.stages||[];if(!Array.isArray(stages)||stages.some(stage=>!production.orderStages.includes(stage)))fail(400,'Choose valid approval stages');
 const withdrawn=body.withdraw_stages||[];if(!Array.isArray(withdrawn)||withdrawn.some(stage=>!production.orderStages.includes(stage)))fail(400,'Choose valid approval stages');
 const history=windows.revision(db,'order',current.id,current.reference,before,null,access.user,{correction:body.correction===true,reason:body.reason});
 if(current.status==='shipped'&&production.loadingParts(db,current).some(part=>part.remaining>0)){db.run("UPDATE ops_orders SET status='released' WHERE id=?",[current.id]);current={...current,status:'released'};}
 for(const stage of production.orderStages.filter(stage=>stages.includes(stage)))production.reviewStage(db,current,{stage,approved:true,order_item_id:body.order_item_id,approver_name:body.approver_name,approver_title:body.approver_title,note:body.reason},access);
 for(const stage of withdrawn)production.reviewStage(db,current,{stage,approved:false,order_item_id:body.order_item_id,approver_name:body.approver_name,approver_title:body.approver_title,note:body.reason},access);
 if(require('./lifecycle.cjs').installation(db,current).items.some(row=>row.installed>row.loaded))fail(409,'Revised specifications must preserve quantities already installed');
 const after=production.orderDetails(db,production.order(db,current.project_id,current.id));
 db.run('UPDATE document_edit_history SET after_json=? WHERE id=?',[encode(after),history.id]);
 core.record(db,access.user,current.project_id,'order_changes_reviewed',current.id,{rows:preview.rows,stages,approver_name:str(body.approver_name,200)});
 return after;
}
module.exports={changes,save};
