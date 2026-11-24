const {encode,parse,fail,hasManagerRole}=require('../certificate-access.cjs');
const {record}=require('./core.cjs');

function documentProjects(db,id){
  return db.all(`SELECT DISTINCT p.project_id,p.details FROM ops_projects p WHERE p.boq_id=?
    OR EXISTS(SELECT 1 FROM ops_project_boqs b WHERE b.project_id=p.project_id AND b.document_id=?)
    OR EXISTS(SELECT 1 FROM ops_items i LEFT JOIN work_items w ON w.id=i.source_line_id
      WHERE i.project_id=p.project_id AND (i.source_document_id=? OR w.document_id=?))
    OR EXISTS(SELECT 1 FROM ops_changes c JOIN ops_items i ON i.id=c.item_id WHERE i.project_id=p.project_id AND c.adjustment_id=?)`,[id,id,id,id,id]);
}

// All removals participate in the caller's transaction. Shared projects and BOQs remain intact.
function deleteDocumentEverywhere(db,document,user){
  const projects=documentProjects(db,document.id);
  if(projects.length){
    if(!user)fail(401,'Sign in again before deleting a document linked to project operations');
    if(!hasManagerRole(user))fail(403,'Manager access is required to delete an invoice linked to project operations');
    if(document.document_type==='invoice'&&projects.some(project=>!/^موقوف$|^on hold$|^paused$|^inactive$/i.test(parse(project.details,{}).status||'')))
      fail(409,'Set the project status to موقوف before deleting its invoice');
  }
  const items=db.all(`SELECT id,project_id FROM ops_items WHERE source_document_id=? OR source_line_id IN
    (SELECT id FROM work_items WHERE document_id=?)`,[document.id,document.id]);
  const ids=encode(items.map(item=>item.id));
  const changes=db.all('SELECT id,adjustment_id FROM ops_changes WHERE item_id IN (SELECT value FROM json_each(?))',[ids]);
  const adjustments=[...new Set(changes.map(change=>change.adjustment_id).filter(Boolean))];
  const orderRows=db.all('SELECT id,order_id FROM ops_order_items WHERE item_id IN (SELECT value FROM json_each(?))',[ids]);
  const rowIds=encode(orderRows.map(row=>row.id)),orderIds=[...new Set([...orderRows.map(row=>row.order_id),
    ...db.all('SELECT id FROM ops_orders WHERE source_document_id=?',[document.id]).map(row=>row.id)])];
  db.run('DELETE FROM ops_load_lines WHERE order_item_id IN (SELECT value FROM json_each(?))',[rowIds]);
  db.run('DELETE FROM ops_load_parts WHERE order_item_id IN (SELECT value FROM json_each(?))',[rowIds]);
  db.run('DELETE FROM ops_order_items WHERE id IN (SELECT value FROM json_each(?))',[rowIds]);
  const loadIds=orderIds.flatMap(orderId=>db.all('SELECT id FROM ops_loads WHERE order_id=?',[orderId]).map(row=>row.id));
  for(const orderId of orderIds){
    for(const batch of db.all('SELECT id,shipment_data FROM ops_loads WHERE order_id=?',[orderId])){
      const data=parse(batch.shipment_data,{}),removed=new Set(orderRows.map(row=>row.id));
      if(data.items){data.items=data.items.filter(item=>!removed.has(item.id));data.parts=data.parts.filter(part=>!removed.has(part.order_item_id));data.lines=data.lines.filter(part=>!removed.has(part.order_item_id));db.run('UPDATE ops_loads SET shipment_data=? WHERE id=?',[encode(data),batch.id]);}
    }

    db.run('DELETE FROM ops_loads WHERE order_id=? AND NOT EXISTS(SELECT 1 FROM ops_load_lines l WHERE l.load_id=ops_loads.id) AND NOT EXISTS(SELECT 1 FROM ops_load_parts p WHERE p.load_id=ops_loads.id)',[orderId]);
    db.run('DELETE FROM ops_orders WHERE id=? AND NOT EXISTS(SELECT 1 FROM ops_order_items i WHERE i.order_id=ops_orders.id)',[orderId]);
  }
  for(const loadId of loadIds)if(!db.get('SELECT 1 FROM ops_loads WHERE id=?',[loadId])){db.run("DELETE FROM document_edit_history WHERE kind='delivery' AND document_id=?",[loadId]);db.run("DELETE FROM document_edit_locks WHERE kind='delivery' AND document_id=?",[loadId]);}
  for(const orderId of orderIds)if(!db.get('SELECT 1 FROM ops_orders WHERE id=?',[orderId])){db.run("DELETE FROM document_edit_history WHERE kind IN('order','installation') AND document_id=?",[orderId]);db.run("DELETE FROM document_edit_locks WHERE kind IN('order','installation') AND document_id=?",[orderId]);}
  db.run('UPDATE ops_changes SET prior_change_id=NULL WHERE prior_change_id IN (SELECT value FROM json_each(?))',[encode(changes.map(change=>change.id))]);
  db.run('DELETE FROM ops_items WHERE id IN (SELECT value FROM json_each(?))',[ids]);
  db.run("UPDATE ops_changes SET adjustment_id=NULL,status='returned',review_note='Adjustment invoice deleted' WHERE adjustment_id=?",[document.id]);
  db.run('DELETE FROM ops_project_boqs WHERE document_id=?',[document.id]);
  for(const project of projects){
    const remaining=db.get('SELECT document_id,snapshot FROM ops_project_boqs WHERE project_id=? ORDER BY document_id DESC LIMIT 1',[project.project_id]);
    if(!remaining)db.run('DELETE FROM ops_projects WHERE project_id=?',[project.project_id]);
    else db.run(`UPDATE ops_projects SET boq_id=CASE WHEN boq_id=? THEN ? ELSE boq_id END,
      boq_snapshot=CASE WHEN boq_id=? THEN ? ELSE boq_snapshot END,version=version+1 WHERE project_id=?`,
      [document.id,remaining.document_id,document.id,remaining.snapshot,project.project_id]);
  }
  // Adjustments generated exclusively for the removed source are representations of that invoice.
  for(const id of adjustments){
    db.run('DELETE FROM work_items WHERE document_id=?',[id]);
    db.run('DELETE FROM documents WHERE id=?',[id]);
  }
  db.run('DELETE FROM work_items WHERE document_id=?',[document.id]);
  db.run('DELETE FROM documents WHERE id=?',[document.id]);
  record(db,user||{id:null,username:'Authorized operator'},null,'source_document_deleted',document.id,{reference:document.operation_no,
    project_ids:projects.map(project=>project.project_id),items:items.length,order_lines:orderRows.length,adjustments});
  return {operational_items:items.length,order_lines:orderRows.length,adjustments:adjustments.length,document_ids:[document.id,...adjustments]};
}
module.exports={deleteDocumentEverywhere};
