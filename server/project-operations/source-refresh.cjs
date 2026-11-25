const {onSite}=require('./maintenance.cjs');
const {createHash}=require('node:crypto');
const {encode,parse,idOf,fail,lookup}=require('../certificate-access.cjs');
const {getProject,projectLookupKeys}=require('../certificate-projects.cjs');
const {operation,itemValues,getItem,record}=require('./core.cjs');
const {configuration,loadingQuantities,openingDefaults}=require('./specifications.cjs');

function sourcePlan(db,projectId,documentId){
  const state=operation(db,projectId),project=getProject(db,projectId),id=idOf(documentId)||state.boq_id;
  if(!db.get('SELECT 1 FROM ops_project_boqs WHERE project_id=? AND document_id=?',[projectId,id]))fail(404,'The source is not linked to this project');
  const source=db.get("SELECT * FROM documents WHERE id=? AND deleted_at IS NULL AND status='approved'",[id]);
  if(!source)fail(409,'Approve the updated invoice or quotation before importing it again');
  const names=projectLookupKeys(project);
  const rows=db.all(`SELECT w.*,COALESCE(NULLIF(w.project,''),d.project) AS effective_project FROM work_items w JOIN documents d ON d.id=w.document_id
    WHERE w.document_id=? AND w.deleted_at IS NULL AND COALESCE(w.collection_amount,0)=0 AND COALESCE(d.party_id,w.party_id)=? ORDER BY w.id`,[id,project.customer_id])
    .filter(row=>names.has(lookup(row.effective_project)));
  if(!rows.length)fail(409,'The updated source has no work lines for this project');
  const old=db.all('SELECT * FROM ops_items WHERE project_id=? AND source_document_id=? ORDER BY id',[projectId,id]);
  const available=new Set(old.map(item=>item.id)),matches=[];
  for(const row of rows){
    let item=old.find(item=>available.has(item.id)&&item.source_line_id===row.id);
    if(!item){
      const candidates=old.filter(item=>available.has(item.id)&&parse(item.commercial,{}).description===itemValues(row).description);
      const exact=candidates.filter(item=>{const t=parse(item.technical,{});return t.width_mm===itemValues(row).width_mm&&t.height_mm===itemValues(row).height_mm;});
      if(exact.length===1)item=exact[0];else if(candidates.length===1)item=candidates[0];
    }
    if(item)available.delete(item.id);
    matches.push({row,item});
  }
  const orders=db.all(`SELECT DISTINCT o.* FROM ops_orders o JOIN ops_order_items oi ON oi.order_id=o.id JOIN ops_items i ON i.id=oi.item_id
    WHERE o.project_id=? AND i.source_document_id=? ORDER BY o.id`,[projectId,id]);
  const refreshable=orders.filter(order=>['draft','released'].includes(order.status)&&!db.get('SELECT 1 FROM ops_loads WHERE order_id=?',[order.id]));
  const fingerprint=createHash('sha256').update(encode({source,rows,items:old.map(item=>[item.id,item.version]),
    orders:orders.map(order=>[order.id,order.status,db.all('SELECT * FROM ops_order_items WHERE order_id=? ORDER BY id',[order.id]),
      db.get('SELECT COUNT(*) AS n FROM ops_loads WHERE order_id=?',[order.id]).n])})).digest('hex');
  const summary={source:{id,reference:source.operation_no,type:source.document_type},version:state.version,fingerprint,
    added:matches.filter(match=>!match.item).length,updated:matches.filter(match=>match.item).length,removed:available.size,
    refreshable_orders:refreshable.length,historical_orders:orders.length-refreshable.length};
  return {state,project,source,rows,old,matches,removed:old.filter(item=>available.has(item.id)),orders,refreshable,summary};
}
function previewSource(db,projectId,input){return sourcePlan(db,projectId,input.document_id).summary;}

function refreshSource(db,projectId,body,user){
  if(body.confirm!==true)fail(400,'Confirm replacement of the imported source data');
  const plan=sourcePlan(db,projectId,body.document_id),{state,project,source,old,matches,removed,refreshable}=plan;
  if(Number(body.version)!==state.version||body.fingerprint!==plan.summary.fingerprint)fail(409,'The source or project changed. Review the import again');
  const savedFor=require('./customer-defaults.cjs').sourceDefaults(db,project.customer_id);
  const beforeOrders=refreshable.map(order=>({...order,items:db.all('SELECT * FROM ops_order_items WHERE order_id=?',[order.id])}));
  const previous=new Map(old.map(item=>[item.id,parse(item.technical,{})]));
  const owners=beforeOrders.filter(order=>order.kind!=='maintenance'&&(order.source_scope==='all'&&order.source_document_id===source.id||old.filter(item=>item.active&&item.category!=='maintenance').every(item=>
    order.items.some(line=>line.item_id===item.id&&line.quantity===previous.get(item.id).quantity))));
  const owner=owners.length===1?owners[0]:null;
  const changed=[];
  for(const {row,item}of matches){
    const values=itemValues(row),saved=require('./customer-defaults.cjs').projectDefault(db,projectId,values.description)||savedFor(values.description),standard=parse(saved?.technical,{}),base=item?parse(item.technical,{}):standard;
    const technical=openingDefaults(item?.category||saved?.category,{...base,building:row.building_unit||'',room:row.floor_apartment||'',
      profile:row.profile_spec||base.profile||'',infill:row.glass_spec||base.infill||'',color:row.color||base.color||'',width_mm:values.width_mm,height_mm:values.height_mm,
      quantity:Number.isInteger(row.item_count)&&row.item_count>0?row.item_count:null});
    if(item)for(const key of parse(item.specification_overrides,[]))if(Object.hasOwn(base,key))technical[key]=base[key];
    let id=item?.id;
    if(item){
      db.run(`UPDATE ops_items SET source_line_id=?,commercial=?,technical=?,active=1,version=version+1,financial_version=financial_version+1 WHERE id=?`,
        [row.id,encode(values),encode(technical),id]);
      db.run("UPDATE ops_changes SET status='returned',review_note='Source document imported again' WHERE item_id=? AND status='pending'",[id]);
    }else{
      id=db.run(`INSERT INTO ops_items(project_id,source_line_id,source_document_id,code,original,commercial,technical,category,system,defaults_applied)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,[projectId,row.id,source.id,'BOQ-'+row.id,encode({values,line:row}),encode(values),encode(technical),saved?.category||'',saved?.system||'',saved?1:0]).lastInsertRowid;
    }
    changed.push(getItem(db,projectId,id));
  }
  for(const item of removed){
    db.run('UPDATE ops_items SET active=0,version=version+1 WHERE id=?',[item.id]);
    db.run("UPDATE ops_changes SET status='returned',review_note='Source item removed' WHERE item_id=? AND status='pending'",[item.id]);
  }
  for(const current of beforeOrders){
    for(const line of current.items){
      const item=changed.find(item=>item.id===line.item_id);
      if(!old.some(item=>item.id===line.item_id))continue;
      if(!item){db.run('DELETE FROM ops_order_items WHERE id=?',[line.id]);continue;}
      const other=db.all(`SELECT oi.quantity,o.id FROM ops_order_items oi JOIN ops_orders o ON o.id=oi.order_id
        WHERE oi.item_id=? AND o.kind='manufacturing' AND o.id<>?`,[item.id,current.id]);
      const reserved=other.reduce((sum,row)=>sum+row.quantity,0),count=item.technical.quantity;
      const quantity=current.kind==='maintenance'?line.quantity:Math.max(0,Math.min(owner?.id===current.id?count:line.quantity,Number(count||0)-reserved));
      if(!quantity){db.run('DELETE FROM ops_order_items WHERE id=?',[line.id]);continue;}
      const system=item.system?configuration(db,item.category,item.system):null;
      const quantities=onSite(current)||!system?{}:loadingQuantities(item.category,system,item.technical,quantity);
      db.run('UPDATE ops_order_items SET quantity=?,quantities=?,specification=? WHERE id=?',
        [quantity,encode(quantities),encode({...item,original:undefined,system_label:system?{ar:system.ar,en:system.en}:null}),line.id]);
    }
    if(owner?.id===current.id)for(const item of changed.filter(item=>item.category!=='maintenance'&&!old.some(before=>before.id===item.id)&&item.system&&item.technical.quantity)){
      const system=configuration(db,item.category,item.system),quantity=item.technical.quantity;
      db.run('INSERT INTO ops_order_items(order_id,item_id,quantity,quantities,specification) VALUES(?,?,?,?,?)',
        [current.id,item.id,quantity,encode(loadingQuantities(item.category,system,item.technical,quantity)),encode({...item,original:undefined,system_label:{ar:system.ar,en:system.en}})]);
    }
    db.run("UPDATE ops_orders SET status='draft' WHERE id=?",[current.id]);
  }
  const snapshot={...source,import_fingerprint:plan.summary.fingerprint,approval_date:db.get('SELECT approved_on FROM ops_source_approvals WHERE document_id=?',[source.id])?.approved_on};
  db.run('UPDATE ops_project_boqs SET snapshot=? WHERE project_id=? AND document_id=?',[encode(snapshot),projectId,source.id]);
  db.run('UPDATE ops_projects SET boq_snapshot=CASE WHEN boq_id=? THEN ? ELSE boq_snapshot END,version=version+1 WHERE project_id=?',[source.id,encode(snapshot),projectId]);
  record(db,user,projectId,'source_document_refreshed',source.id,{...plan.summary,before:old,orders:beforeOrders,items:changed.map(item=>item.id)});
  return {...plan.summary,version:state.version+1};
}
function syncSourceProjectMetadata(db,before,after,user){
  if(before.party_id!==after.party_id||!after.project?.trim()||before.project===after.project)return;
  const projects=db.all('SELECT DISTINCT project_id FROM ops_project_boqs WHERE document_id=?',[after.id]);
  for(const {project_id} of projects){
    const project=getProject(db,project_id);
    if(project.customer_id!==after.party_id||!projectLookupKeys(project).has(lookup(before.project)))continue;
    const updated=require('../certificate-projects.cjs').updateProject(db,project,{name:after.project});
    record(db,user||{id:null,username:'Document editor'},project_id,'project_source_metadata_updated',after.id,{before:project,after:updated});
  }
}
module.exports={previewSource,refreshSource,syncSourceProjectMetadata};
