const {getProject,getCustomer}=require("../certificate-projects.cjs");

function referencePrefix(db,project) {
  const customer=getCustomer(db,project.customer_id);
  return `${customer.code||"CL"+customer.id}-${project.code||"PRJ"+project.id}`;
}

function awardReference(db,project) {
  return referencePrefix(db,project)+"-ASG";
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
  let reference;
  do {
    sequence++;
    reference=`${prefix}-${kind}-${String(sequence).padStart(4,"0")}`;
  } while (db.get(occupied[kind],[projectId,reference]));
  db.run(`INSERT INTO ops_sequences(project_id,kind,number) VALUES (?,?,?)
    ON CONFLICT(project_id,kind) DO UPDATE SET number=excluded.number`,[projectId,kind,sequence]);
  return reference;
}

module.exports={awardReference,nextReference};
