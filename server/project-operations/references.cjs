const {getProject,getCustomer}=require("../certificate-projects.cjs");

function referencePrefix(db,project) {
  const customer=getCustomer(db,project.customer_id);
  return `${customer.code||"CL"+customer.id}-${project.code||"PRJ"+project.id}`;
}

function awardReference(db,project) {
  return referencePrefix(db,project)+"-ASG";
}

function compactLoadingReference(prefix,sequence){
  const codes=/^CL(\d+)-PRJ(\d+)$/i.exec(prefix);
  if(!codes)throw new Error('Loading orders require numeric customer and project codes');
  return 'LO'+codes[1].padStart(4,'0')+codes[2].padStart(4,'0')+String(sequence).padStart(4,'0');
}
function migrateLoadingReferences(db){
  for(const row of db.all(`SELECT l.*,o.project_id FROM ops_loading_orders l JOIN ops_orders o ON o.id=l.order_id WHERE l.reference LIKE '%-LO-%'`)){
    const match=/^(CL\d+-PRJ\d+)-LO-(\d+)$/i.exec(row.reference);if(!match)continue;
    const reference=compactLoadingReference(match[1],Number(match[2]));
    if(db.get('SELECT 1 FROM ops_loading_orders WHERE reference=? UNION SELECT 1 FROM ops_manual_loading_orders WHERE reference=? UNION SELECT 1 FROM ops_manual_shipments WHERE reference=?',[reference,reference,reference]))continue;
    db.run('UPDATE ops_loading_orders SET previous_reference=reference,reference=? WHERE id=?',[reference,row.id]);
    db.run("UPDATE ops_report_edits SET document_ref=? WHERE order_id=? AND document_ref=? AND report_kind='loading'",[reference,row.order_id,row.reference]);
    db.run(`INSERT INTO ops_audit(project_id,actor_name,action,entity_id,details) VALUES(?,'System','loading_reference_formatted',?,?)`,
      [row.project_id,row.id,JSON.stringify({before:row.reference,after:reference})]);
  }
}

const occupied={
  WO:"SELECT 1 FROM ops_orders WHERE project_id=? AND reference=?",
  MT:"SELECT 1 FROM ops_orders WHERE project_id=? AND reference=?",
  LD:`SELECT 1 FROM ops_loads l JOIN ops_orders o ON o.id=l.order_id WHERE o.project_id=? AND l.reference=?`,
  LO:`SELECT 1 FROM ops_loading_orders l JOIN ops_orders o ON o.id=l.order_id WHERE o.project_id=? AND l.reference=?`,
  QC:`SELECT 1 FROM ops_inspections x JOIN ops_order_items i ON i.id=x.order_item_id
      JOIN ops_orders o ON o.id=i.order_id WHERE o.project_id=? AND x.reference=?`,
  QTY:`SELECT 1 FROM ops_confirmations c JOIN ops_items i ON i.id=c.item_id WHERE i.project_id=? AND c.reference=?`,
};

function nextReference(db,projectId,kind) {
  const saved=db.get("SELECT award_reference FROM ops_projects WHERE project_id=?",[projectId]);
  const prefix=saved?.award_reference ? saved.award_reference.slice(0,-4) : referencePrefix(db,getProject(db,projectId));
  let sequence=db.get("SELECT number FROM ops_sequences WHERE project_id=? AND kind=?",[projectId,kind])?.number||0;
  if(kind==='LO')sequence=Math.max(sequence,db.get('SELECT number FROM ops_loading_sequences WHERE project_id=?',[projectId])?.number||0);
  let reference;
  do {
    sequence++;
    reference=kind==='LO'?compactLoadingReference(prefix,sequence):`${prefix}-${kind}-${String(sequence).padStart(4,"0")}`;
  } while (kind==='LO'?db.get('SELECT 1 FROM ops_loading_orders WHERE reference=? UNION SELECT 1 FROM ops_manual_loading_orders WHERE reference=? UNION SELECT 1 FROM ops_manual_shipments WHERE reference=?',[reference,reference,reference]):db.get(occupied[kind],[projectId,reference]));
  if(kind==='LO'){
    db.run(`INSERT INTO ops_loading_sequences(project_id,number) VALUES(?,?) ON CONFLICT(project_id) DO UPDATE SET number=excluded.number`,[projectId,sequence]);
    if(!saved)return reference;
  }
  db.run(`INSERT INTO ops_sequences(project_id,kind,number) VALUES (?,?,?)
    ON CONFLICT(project_id,kind) DO UPDATE SET number=excluded.number`,[projectId,kind,sequence]);
  return reference;
}

module.exports={awardReference,nextReference,compactLoadingReference,migrateLoadingReferences};
