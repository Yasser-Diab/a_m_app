const {encode,parse,str,date,fail,idOf,today} = require("../certificate-access.cjs");
const {getItem,itemPage,record,people,pageOptions,responsibilityKeys} = require("./core.cjs");
const {createHash}=require('node:crypto');
const {nextReference}=require("./references.cjs");
const {configuration,approvalParts,loadingQuantities,frameQuantity,screenQuantity,number} = require("./specifications.cjs");
const {openingDescription}=require('./customer-defaults.cjs');
const {onSite,factory,mode:maintenanceMode}=require('./maintenance.cjs');

const qcStages = ["survey","receipt","cutting","assembly","glazing","pre_shipment","installation","handover"];
const qcChecks = ["measurements","profile","finish","glass","opening","accessories","fixing","packaging"];
const qcResults = ["passed","failed","hold","reinspect"];
const checks = ["compliant","noncompliant","na","uninspected"];

function itemApprovals(db,item) {
  return db.all("SELECT * FROM ops_item_approvals WHERE item_id=? AND item_version=? ORDER BY part",[item.id,item.version]);
}

function recordApprovals(db,item,body,user) {
  if (!item.active || Number(body.version)!==item.version) fail(409,"Reload this item before giving manufacturing approval");
  for (const part of approvalParts) {
    const value=body.parts?.[part];
    if (!value) continue;
    const reference=str(value.reference,500)||"Item approval";
    if (value.decision==="unapproved") {
      db.run("DELETE FROM ops_item_approvals WHERE item_id=? AND item_version=? AND part=?",[item.id,item.version,part]);
      continue;
    }
    if (!["approved","na"].includes(value.decision)) fail(400,"Choose an approval decision");
    if (["measurement","details"].includes(part) && value.decision==="na") fail(400,"Measurements and technical details require approval");
    db.run(`INSERT INTO ops_item_approvals(item_id,item_version,part,decision,reference,actor_id)
      VALUES (?,?,?,?,?,?) ON CONFLICT(item_id,item_version,part) DO UPDATE SET decision=excluded.decision,reference=excluded.reference,
      actor_id=excluded.actor_id,approved_at=CURRENT_TIMESTAMP`,[item.id,item.version,part,value.decision,reference,user.id]);
  }
  const decisions=itemApprovals(db,item);
  record(db,user,item.project_id,"manufacturing_components_reviewed",item.id,{version:item.version,decisions});
  return decisions;
}

function order(db,projectId,id) {
  const row=db.get("SELECT * FROM ops_orders WHERE project_id=? AND id=?",[projectId,id]);
  if (!row) fail(404,"Production order not found");
  return row;
}

function orderPage(db,projectId,query) {
  const {page,limit,offset}=pageOptions(query);
  const source=idOf(query.source_document_id),params=[projectId,source,source];
  const items=db.all(`SELECT o.id,o.reference,o.status,o.kind,o.required_date,o.source_document_id,json_extract(o.service_data,'$.mode') AS maintenance_mode,
    d.operation_no AS source_reference,d.document_type AS source_type,d.title AS source_title,json_extract(o.service_data,'$.completed_on') AS completed_on
    FROM ops_orders o LEFT JOIN documents d ON d.id=o.source_document_id WHERE o.project_id=? AND (? IS NULL OR o.source_document_id=?)
    ORDER BY o.id DESC LIMIT ? OFFSET ?`,[...params,limit,offset]);
  return {items,total:db.get("SELECT COUNT(*) AS n FROM ops_orders WHERE project_id=? AND (? IS NULL OR source_document_id=?)",params).n,page,limit};
}

function orderItems(db,id) {
  const open=["draft","released"].includes(db.get("SELECT status FROM ops_orders WHERE id=?",[id])?.status);
  return db.all("SELECT * FROM ops_order_items WHERE order_id=? ORDER BY id",[id])
    .map((item)=>{
      const specification=parse(item.specification,{});
      specification.technical=require('./customer-defaults.cjs').normalizeLocks(specification.technical);
      const quantities=parse(item.quantities,{});
      if(open&&quantities.sliding>0&&!Object.hasOwn(quantities,'sliding_blades'))quantities.sliding_blades=quantities.sliding;
      if (!Object.hasOwn(quantities,"frames")&&Object.keys(quantities).length) {
        const frames=frameQuantity(specification.category,configuration(db,specification.category,specification.system),
          specification.technical,item.quantity);
        if (frames) quantities.frames=frames;
      }
      if (open&&!Object.hasOwn(quantities,"screens")&&Object.keys(quantities).length) {
        const screens=Object.hasOwn(specification.technical.panel_counts||{},"screens")
          ? specification.technical.panel_counts.screens*item.quantity
          : screenQuantity(specification.category,specification.technical,item.quantity);
        if (screens) quantities.screens=screens;
      }
      return {...item,quantities,specification};
    });
}

function addOrder(db,projectId,body,user) {
  const commandKey=str(body.command_key,100)||null;
  const previous=commandKey&&db.get("SELECT * FROM ops_orders WHERE project_id=? AND command_key=?",[projectId,commandKey]);
  if (previous) return previous;
  if (!Array.isArray(body.items) || !body.items.length) fail(400,"Select at least one BOQ item");
  const kind=body.kind==="maintenance"?"maintenance":"manufacturing";
  const maintenance=kind==="maintenance";
  const mode=maintenance?(body.maintenance_mode||'site'):null;
  if(maintenance&&!['site','factory'].includes(mode))fail(400,'Select on-site or factory maintenance');
  const workshop=maintenance&&mode==='factory';
  const prepared=body.items.map(entry=>({entry,item:getItem(db,projectId,idOf(entry.item_id))}));
  if(!maintenance&&prepared.some(({item})=>item.category==='maintenance'))fail(400,'Create a maintenance order for maintenance work items');
  if(maintenance&&prepared.some(({item})=>item.category==='maintenance'&&maintenanceMode(item.technical)!==mode))fail(400,'Choose maintenance items with the same on-site or factory location');
  const sources=new Set(prepared.map(({item})=>item.source_document_id).filter(Boolean));
  const source=idOf(body.source_document_id)||(sources.size===1?[...sources][0]:null);
  if(body.source_document_id!=null&&(!source||sources.size!==1||!sources.has(source)))fail(400,'Choose openings from the selected invoice or quotation');
  if(source&&!db.get('SELECT 1 FROM ops_project_boqs WHERE project_id=? AND document_id=?',[projectId,source]))fail(400,'The source is not linked to this project');
  // Explicit source selection opens one order per source; older partial-order clients remain compatible.
  if(!maintenance&&body.source_document_id!=null){
    const existing=db.get("SELECT id,reference FROM ops_orders WHERE project_id=? AND source_document_id=? AND kind='manufacturing' ORDER BY id DESC LIMIT 1",[projectId,source]);
    if(existing)fail(409,'This source already has a work order. Open it to update its openings',{existing_order:existing});
  }
  let sourceScope='selected';
  if(!maintenance&&body.include_all===true){
    const active=itemPage(db,projectId,{boq_id:source,all:'1'}).items.filter(item=>item.active&&item.category!=='maintenance');
    const counts=new Map(prepared.map(({entry,item})=>[item.id,Number(entry.quantity)]));
    if(!source||active.length!==prepared.length||active.some(item=>!item.system||counts.get(item.id)!==Number(item.technical.quantity)))
      fail(409,'The source openings changed. Review all openings before creating the order');
    sourceScope='all';
  }
  const reference=str(body.reference,120)||nextReference(db,projectId,maintenance?"MT":"WO");
  const requestedPerson=idOf(body.assignee_id);
  const assignee=maintenance&&requestedPerson?people(db,projectId).find(({id})=>id===requestedPerson):null;
  if (maintenance&&requestedPerson&&!assignee) fail(400,"Select a member of this project’s team");
  const service=maintenance?{mode,instructions:str(body.instructions,3000),assignee}:null;
  if (db.get("SELECT 1 FROM ops_orders WHERE project_id=? AND reference=? COLLATE NOCASE",[projectId,reference]))
    fail(409,"An order already uses this reference");
  const id=db.run("INSERT INTO ops_orders(project_id,source_document_id,source_scope,reference,required_date,created_by,command_key,kind,service_data) VALUES (?,?,?,?,?,?,?,?,?)",
    [projectId,source,sourceScope,reference,date(body.required_date,true),user.id,commandKey,kind,encode(service||{})]).lastInsertRowid;
  const used=new Set();
  for (const {entry,item} of prepared) {
    if (!item.active || ((!maintenance||workshop)&&!item.system) || used.has(item.id)) fail(400,"Select distinct eligible BOQ items");
    const quantity=number(entry.quantity,maintenance?"maintenance quantity":"production quantity",{integer:true,positive:true});
    if (!quantity) fail(400,"Enter the quantity for "+item.code);
    if (!maintenance) {
      const reserved=db.get(`SELECT COALESCE(SUM(oi.quantity),0) AS n FROM ops_order_items oi JOIN ops_orders o ON o.id=oi.order_id
        WHERE oi.item_id=? AND o.kind='manufacturing'`,[item.id]).n;
      if (!item.technical.quantity || reserved+quantity>item.technical.quantity)
        fail(400,"Production quantity exceeds the unassigned openings for " + item.code);
    }
    const system=item.system?configuration(db,item.category,item.system):null;
    const quantities=maintenance&&!workshop?{}:loadingQuantities(item.category,system,item.technical,quantity);
    db.run("INSERT INTO ops_order_items(order_id,item_id,quantity,quantities,specification) VALUES (?,?,?,?,?)",
      [id,item.id,quantity,encode(quantities),encode({...item,original:undefined,
        system_label:system?{ar:system.ar,en:system.en}:null})]);
    used.add(item.id);
  }
  record(db,user,projectId,maintenance?"maintenance_order_created":"production_order_created",id,{reference,items:[...used]});
  return order(db,projectId,id);
}

function availableItems(db,projectId,query={}){
  const result=itemPage(db,projectId,{...query,all:'1'}),maintenance=query.kind==='maintenance';
  const reserved=new Map(db.all(`SELECT oi.item_id,SUM(oi.quantity) AS quantity FROM ops_order_items oi JOIN ops_orders o ON o.id=oi.order_id
    WHERE o.project_id=? AND o.kind='manufacturing' GROUP BY oi.item_id`,[projectId]).map(row=>[row.item_id,Number(row.quantity)]));
  const eligible=result.items.filter(item=>maintenance?(item.category!=='maintenance'||!query.maintenance_mode||maintenanceMode(item.technical)===query.maintenance_mode):item.category!=='maintenance');
  return {...result,total:eligible.length,items:eligible.map(item=>({...item,reserved_quantity:reserved.get(item.id)||0,
    available_quantity:maintenance?(Number(item.technical.quantity)||1):Math.max(0,(Number(item.technical.quantity)||0)-(reserved.get(item.id)||0))}))};
}

function orderCoverage(db,current,rows=orderItems(db,current.id)){
  if(current.kind==='maintenance')return null;
  const sources=new Set(current.source_document_id?[current.source_document_id]:rows.map(row=>row.specification.source_document_id).filter(Boolean));
  const candidates=availableItems(db,current.project_id).items.filter(item=>item.active&&sources.has(item.source_document_id));
  const remaining=candidates.filter(item=>item.system&&item.available_quantity>0);
  const count=rows.reduce((sum,row)=>sum+row.quantity,0),sourceCount=candidates.reduce((sum,item)=>sum+(Number(item.technical.quantity)||0),0);
  const fingerprint=createHash('sha256').update(JSON.stringify({status:current.status,rows:rows.map(row=>[row.id,row.item_id,row.quantity,row.specification.version]),
    candidates:candidates.map(item=>[item.id,item.version,item.description_version,item.technical.quantity,item.available_quantity])})).digest('hex');
  return {included_quantity:count,source_quantity:sourceCount||count,available_quantity:remaining.reduce((sum,item)=>sum+item.available_quantity,0),fingerprint,
    remaining_items:remaining.map(item=>({id:item.id,description:openingDescription(item),quantity:item.available_quantity,width_mm:item.technical.width_mm,height_mm:item.technical.height_mm})),
    unconfigured_quantity:candidates.filter(item=>!item.system).reduce((sum,item)=>sum+item.available_quantity,0)};
}

function includeRemaining(db,current,body,access){
  if(current.kind==='maintenance'||!['draft','released'].includes(current.status)||db.get('SELECT 1 FROM ops_loads WHERE order_id=?',[current.id]))
    fail(409,'Add remaining openings before loading begins');
  if(body.copy_approvals===true&&!access.capabilities.includes('ops_release'))fail(403,'Approval permission is required');
  const before=orderItems(db,current.id),coverage=orderCoverage(db,current,before);
  if(!coverage.available_quantity)return orderDetails(db,current);
  if(body.fingerprint!==coverage.fingerprint)fail(409,'The available openings changed. Reopen the remaining openings list');
  const approved=body.copy_approvals===true?stageApprovals(db,current).filter(stage=>stage.approved).map(stage=>stage.stage):[];
  const byItem=new Map(before.map(row=>[row.item_id,row])),affected=[];
  for(const remaining of coverage.remaining_items){
    const item=getItem(db,current.project_id,remaining.id),prior=byItem.get(item.id),quantity=(prior?.quantity||0)+remaining.quantity;
    const system=configuration(db,item.category,item.system),quantities=loadingQuantities(item.category,system,item.technical,quantity);
    const specification=encode({...item,original:undefined,system_label:{ar:system.ar,en:system.en}});
    if(prior){db.run('UPDATE ops_order_items SET quantity=?,quantities=?,specification=? WHERE id=?',[quantity,encode(quantities),specification,prior.id]);affected.push(prior.id);}
    else affected.push(db.run('INSERT INTO ops_order_items(order_id,item_id,quantity,quantities,specification) VALUES(?,?,?,?,?)',
      [current.id,item.id,quantity,encode(quantities),specification]).lastInsertRowid);
  }
  db.run("UPDATE ops_orders SET status='draft',source_scope=? WHERE id=?",
    [coverage.included_quantity+coverage.available_quantity===coverage.source_quantity?'all':'selected',current.id]);
  record(db,access.user,current.project_id,'remaining_openings_included',current.id,{before,added_quantity:coverage.available_quantity,order_item_ids:affected,copy_approvals:body.copy_approvals===true});
  for(const stage of approved)reviewStage(db,order(db,current.project_id,current.id),{stage,approved:true,order_item_ids:affected,note:'Existing order approval explicitly applied to added openings'},access);
  return orderDetails(db,order(db,current.project_id,current.id));
}

function inspections(db,id) {
  return db.all(`SELECT r.* FROM ops_inspections r JOIN ops_order_items oi ON oi.id=r.order_item_id
    WHERE oi.order_id=? ORDER BY r.id DESC`,[id]).map((row)=>({...row,record:parse(row.record)}));
}

function latestInspection(rows,orderItem,stage) {
  return rows.find((row)=>row.order_item_id===orderItem.id && row.stage===stage &&
    row.record?.item_version===orderItem.specification.version)?.record;
}

const orderStages=[...approvalParts,"manufacturing","pre_shipment"];

function stageApprovals(db,current) {
  const rows=orderItems(db,current.id),inspectionsForOrder=inspections(db,current.id);
  const reviews=db.all(`SELECT r.*,COALESCE(NULLIF(r.approver_name,''),u.display_name,u.username,'') name FROM ops_order_reviews r
    LEFT JOIN users u ON u.id=r.actor_id WHERE r.order_item_id IN(SELECT id FROM ops_order_items WHERE order_id=?)`,[current.id]);
  const reviewMap=new Map(reviews.map(review=>[review.order_item_id+':'+review.item_version+':'+review.stage,review]));
  const prepared=rows.map(row=>{const item=getItem(db,current.project_id,row.item_id);return {row,item,stale:item.version!==row.specification.version,components:new Set(itemApprovals(db,item).map(({part})=>part))};});
  return orderStages.map(stage=>{
    const items=prepared.map(({row,item,stale,components})=>{
      const saved=reviewMap.get(row.id+':'+row.specification.version+':'+stage);let approved=false;
      if(approvalParts.includes(stage))approved=!stale&&components.has(stage);
      if(stage==='measurement')approved=approved&&latestInspection(inspectionsForOrder,row,'survey')?.release==='approved';
      if(stage==='pre_shipment')approved=!stale&&latestInspection(inspectionsForOrder,row,stage)?.release==='approved';
      if(stage==='manufacturing')approved=!stale&&['released','shipped','closed'].includes(current.status)&&saved?.approved!==0&&approvalParts.every(part=>components.has(part))&&latestInspection(inspectionsForOrder,row,'survey')?.release==='approved';
      return {id:row.id,item_id:item.id,code:item.code,version:item.version,approved,stale,approver_name:saved?.name||'',approver_title:saved?.approver_title||'',approved_at:saved?.updated_at||null};
    });
    const people=[...new Map(items.filter(item=>item.approved&&item.approver_name).map(item=>[item.approver_name+':'+item.approver_title,{name:item.approver_name,title:item.approver_title,date:item.approved_at}])).values()];
    return {stage,approved:items.length>0&&items.every(item=>item.approved),items,people};
  });
}

function orderEditWindow(db,current) {
  const fallback=["shipped","closed"].includes(current.status)?db.get("SELECT MIN(created_at) at FROM ops_audit WHERE entity_id=? AND action IN('production_order_shipped','production_order_closed','maintenance_completed')",[current.id])?.at||current.created_at:null;
  return require("../document-edit-window.cjs").info(db,"order",current.id,fallback);
}
function reviewStage(db,current,body,access) {
  require("../document-edit-window.cjs").check(db,"order",current.id,orderEditWindow(db,current).first_locked_at);
  const stage=str(body.stage);
  if (!orderStages.includes(stage)||typeof body.approved!=="boolean"||onSite(current))
    fail(400,"Choose a manufacturing approval stage");
  if (current.status==="closed") fail(409,"This order is closed");
  if(body.order_item_ids!=null&&!Array.isArray(body.order_item_ids))fail(400,'Select valid order items');
  const ids=body.order_item_ids?new Set(body.order_item_ids.map(value=>idOf(value))):null;
  if(ids?.has(null))fail(400,'Select valid order items');
  const rows=orderItems(db,current.id).filter((row)=>body.order_item_id?row.id===idOf(body.order_item_id):!ids||ids.has(row.id));
  if(ids&&rows.length!==ids.size)fail(404,'Order item not found');
  if (!rows.length) fail(404,"Order item not found");
  const approved=body.approved;
  const user=access.user;
  const approverName=str(body.approver_name,200)||user.display_name||user.username,approverTitle=str(body.approver_title,200);
  for (const row of rows) {
    const item=getItem(db,current.project_id,row.item_id);
    if (approved&&item.version!==row.specification.version) fail(409,"Review the changed specifications before approving",{approval_required:true});
    if (approved&&stage==="manufacturing") {
      if(factory(current)&&item.category==='maintenance'&&maintenanceMode(item.technical)!=='factory')fail(409,'This item is now on-site maintenance. Review its work order route');
      fitForManufacturing(db,item);
      if (latestInspection(inspections(db,current.id),row,"survey")?.release!=="approved")
        fail(409,"Approve measurements before manufacturing");
    }
    if (approvalParts.includes(stage))
      recordApprovals(db,item,{version:item.version,parts:{[stage]:{decision:approved?"approved":"unapproved",reference:current.reference}}},user);
    if (stage==="measurement"||stage==="pre_shipment") {
      const inspectionStage=stage==="measurement"?"survey":"pre_shipment";
      const checklist=Object.fromEntries(qcChecks.map((key)=>[key,approved?"compliant":"uninspected"]));
      inspect(db,current,{order_item_id:row.id,stage:inspectionStage,result:approved?"passed":"hold",
        release:approved?"approved":"pending",checklist,defects:approved?"":"Approval withdrawn",
        corrective_action:str(body.note)||current.reference,closed_on:today(),inspector_name:approverName},access);
    }
    db.run(`INSERT INTO ops_order_reviews(order_item_id,item_version,stage,approved,actor_id) VALUES(?,?,?,?,?)
      ON CONFLICT(order_item_id,item_version,stage) DO UPDATE SET approved=excluded.approved,actor_id=excluded.actor_id,updated_at=CURRENT_TIMESTAMP`,
    [row.id,row.specification.version,stage,approved?1:0,user.id]);
    db.run('UPDATE ops_order_reviews SET approver_name=?,approver_title=? WHERE order_item_id=? AND item_version=? AND stage=?',[approverName,approverTitle,row.id,row.specification.version,stage]);
  }
  if (stage==="manufacturing"&&approved&&current.status==="draft") updateOrderStatus(db,current,{status:"released"},user);
  record(db,user,current.project_id,approved?"order_stage_approved":"order_stage_unapproved",current.id,
    {stage,order_item_ids:rows.map(({id})=>id),note:str(body.note),approver_name:approverName,approver_title:approverTitle});
  return stageApprovals(db,order(db,current.project_id,current.id));
}

function fitForManufacturing(db,item) {
  const specification=item.technical;
  if ((item.category!=="maintenance"||configuration(db,item.category,item.system)?.tags.includes("glass"))&&(!specification.quantity || !item.manufacturing_dimensions || !specification.width_mm || !specification.height_mm ||
      (item.category==="windows" || item.category==="doors") && specification.subframe &&
        Object.values(specification.subframe.sides).some(({width,depth})=>!width || !depth)))
    fail(409,"Complete measured dimensions and any sub-frame deductions for " + item.code);
  const sliding=["windows","doors"].includes(item.category)&&configuration(db,item.category,item.system)?.tags.includes("sliding");
  if (sliding && Number(specification.leaves)>=2 &&
    (!specification.lock_left||!specification.lock_right||Number(specification.leaves)>2&&!specification.central_lock_handle))
    fail(409,"Enter the lock types for each applicable position on "+item.code);
  if(item.category==='maintenance'){if(maintenanceMode(specification)!=='factory')fail(409,'On-site maintenance does not require manufacturing release');loadingQuantities(item.category,configuration(db,item.category,item.system),specification,specification.quantity||1);}
  const approved=new Set(itemApprovals(db,item).map(({part})=>part));
  if (approvalParts.some((part)=>!approved.has(part))) fail(409,"Record the required manufacturing approvals for " + item.code);
}

function updateOrderStatus(db,current,body,user) {
  const status=str(body.status);
  if (status===current.status) return current;
  if (onSite(current)&&status!=="closed") fail(409,"Use Complete maintenance to finish a service order");
  const rows=orderItems(db,current.id);
  if (status==="released" && current.status==="draft") {
    const qc=inspections(db,current.id);
    for (const row of rows) {
      const item=getItem(db,current.project_id,row.item_id);
      if (!item.active || item.version!==row.specification.version) fail(409,"An item changed after planning. Update the draft order.");
      fitForManufacturing(db,item);
      const survey=latestInspection(qc,row,"survey");
      if (!survey || survey.release!=="approved") fail(409,"Approve the measurement survey for " + item.code);
      const drawing_ids=db.all("SELECT id FROM ops_attachments WHERE item_id=? AND item_version<=? AND removed_at IS NULL ORDER BY id",
        [item.id,item.version]).map(({id})=>id);
      db.run("UPDATE ops_order_items SET specification=? WHERE id=?",[encode({...row.specification,drawing_ids}),row.id]);
    }
  } else if (status==="shipped" && current.status==="released") {
    const balances=loadingParts(db,current);
    if (balances.some(({remaining})=>remaining>0)) fail(409,"Confirm the remaining loading quantities before shipment");
    verifyShipment(db,current.id,rows.map(({id})=>id));
  } else if (status==="closed" && !["draft","released","shipped"].includes(current.status)) {
    fail(409,"This order is already closed");
  } else if (status!=="closed") fail(409,"This production status transition is unavailable");
  if(status==='closed'&&!onSite(current)&&current.status==='shipped'&&!require('./lifecycle.cjs').installation(db,current).complete)fail(409,'Record completed installation before closing this delivered work order');
  const reason=str(body.reason,1000);
  if (status==="closed" && !reason) fail(400,"Enter the closing reason");
  db.run("UPDATE ops_orders SET status=? WHERE id=?",[status,current.id]);
  if(["shipped","closed"].includes(status))require("../document-edit-window.cjs").lock(db,"order",current.id);
  record(db,user,current.project_id,"production_order_"+status,current.id,{previous:current.status,reason});
  return order(db,current.project_id,current.id);
}

function completeService(db,current,body,user) {
  if (!onSite(current)) fail(400,"Complete factory maintenance through QC, delivery and installation");
  const service=parse(current.service_data,{});
  if (service.completed_on) return orderDetails(db,current);
  if (current.status!=="draft") fail(409,"This maintenance order has been closed");
  const completed={...service,completed_on:date(body.completed_on,true)||today(),
    completion_notes:str(body.completion_notes,3000),completed_by:user.display_name||user.username};
  db.run("UPDATE ops_orders SET status='closed',service_data=? WHERE id=?",[encode(completed),current.id]);
  require("../document-edit-window.cjs").lock(db,"order",current.id);
  record(db,user,current.project_id,"maintenance_completed",current.id,{reference:current.reference,...completed});
  return orderDetails(db,order(db,current.project_id,current.id));
}

function refreshDraftOrder(db,current,user) {
  require("../document-edit-window.cjs").check(db,"order",current.id,orderEditWindow(db,current).first_locked_at);
  if (!["draft","released"].includes(current.status)||onSite(current)||
    db.get("SELECT 1 FROM ops_loads WHERE order_id=?",[current.id])) fail(409,"Refresh specifications before loading begins");
  const previous=orderItems(db,current.id);
  for (const row of previous) {
    const item=getItem(db,current.project_id,row.item_id);
    if (!item.active || !item.system) fail(409,"An order item is no longer active or configured");
    const reserved=db.get(`SELECT COALESCE(SUM(i.quantity),0) AS n FROM ops_order_items i JOIN ops_orders o ON o.id=i.order_id
      WHERE i.item_id=? AND o.kind='manufacturing'`,[item.id]).n;
    if (reserved>item.technical.quantity) fail(409,"Production quantity exceeds the approved openings for " + item.code);
    const system=configuration(db,item.category,item.system);
    const quantities=loadingQuantities(item.category,system,item.technical,row.quantity);
    db.run("UPDATE ops_order_items SET quantities=?,specification=? WHERE id=?",
      [encode(quantities),encode({...item,original:undefined,system_label:{ar:system.ar,en:system.en}}),row.id]);
  }
  if (current.status==="released") db.run("UPDATE ops_orders SET status='draft' WHERE id=?",[current.id]);
  record(db,user,current.project_id,"production_order_refreshed",current.id,{previous_status:current.status,previous});
  return orderDetails(db,order(db,current.project_id,current.id));
}

function inspect(db,current,body,access) {
  if (onSite(current)) fail(409,"Record service findings with the maintenance completion notes");
  if (current.status==="closed") fail(409,"This production order is closed");
  const item=orderItems(db,current.id).find(({id})=>id===idOf(body.order_item_id));
  if (!item) fail(404,"Order item not found");
  const stage=str(body.stage);
  const result=str(body.result);
  const release=str(body.release)||"pending";
  if (!qcStages.includes(stage) || !qcResults.includes(result) || !["pending","approved","rejected"].includes(release))
    fail(400,"Select a stage, result and release decision");
  if (release!=="pending" && !access.capabilities.includes("ops_release")) fail(403,"Release permission is required");
  const checklist=Object.fromEntries(qcChecks.map((key)=>[key,checks.includes(body.checklist?.[key])?body.checklist[key]:"uninspected"]));
  const recordData={item_version:item.specification.version,checklist,result,release,defects:str(body.defects,2000),corrective_action:str(body.corrective_action,2000),
    correction_owner:str(body.correction_owner,200),closed_on:date(body.closed_on,true),delivery_ref:str(body.delivery_ref,120)};
  const latest=latestInspection(inspections(db,current.id),item,stage);
  if (result!=="passed" && !recordData.defects) fail(400,"Record defects or observations for an unresolved inspection");
  if (release==="approved" && (result!=="passed" || Object.values(checklist).some((value)=>!["compliant","na"].includes(value))))
    fail(400,"Only completed passing inspections can be released");
  if (release==="approved" && latest && latest.result!=="passed" && (!recordData.closed_on || !recordData.corrective_action))
    fail(400,"Record how the defect was corrected and closed before release");
  const user=access.user;
  const reference=nextReference(db,current.project_id,"QC");
  const id=db.run(`INSERT INTO ops_inspections(order_item_id,stage,inspection_date,inspector_id,inspector_name,record,reference)
    VALUES(?,?,?,?,?,?,?)`,[item.id,stage,date(body.inspection_date,true)||today(),user.id,str(body.inspector_name,200)||user.display_name || user.username,encode(recordData),reference]).lastInsertRowid;
  record(db,user,current.project_id,"inspection_recorded",id,{order_id:current.id,stage,result,release});
  return {id,reference,...recordData};
}

function loadingBalances(db,orderId,cutoff=null) {
  const loaded=new Map(db.all(`SELECT l.order_item_id,l.kind,SUM(l.quantity) AS quantity FROM ops_load_lines l
    JOIN ops_loads b ON b.id=l.load_id WHERE b.order_id=? AND (? IS NULL OR b.id<=?) GROUP BY l.order_item_id,l.kind`,[orderId,cutoff,cutoff])
    .map((row)=>[row.order_item_id+":"+row.kind,row.quantity]));
  return orderItems(db,orderId).flatMap((row)=>Object.entries(row.quantities).map(([kind,required])=>{
    const quantity=loaded.get(row.id+":"+kind)||0;
    const spec=row.specification.technical;
    return {order_item_id:row.id,item_id:row.item_id,code:row.specification.code,description:openingDescription(row.specification),tag:spec.tag,
      width_mm:spec.width_mm,height_mm:spec.height_mm,kind,required,loaded:quantity,remaining:required-quantity};
  }));
}

function loadingParts(db,current,cutoff=null){
  return [...loadingBalances(db,current.id,cutoff).map(row=>({...row,part_id:row.order_item_id+':'+row.kind,unit:'Pcs'})),
    ...require('./loading-parts.cjs').extraBalances(db,current,orderItems(db,current.id),cutoff)];
}

function shipmentPreparation(db,current,user){
  if(onSite(current)||current.status!=='released')fail(409,'Release the manufacturing order before confirming a shipment');
  const loading=loadingOrder(db,current,user);
  return {...orderDetails(db,current),loading_reference:loading.reference,loading_transport:loading};
}
function confirmShipment(db,current,body,access){
  if(!access.capabilities.includes('ops_load'))fail(403,'Loading permission is required to confirm shipped quantities');
  let result;
  if((body.parts||[]).length)result=loadBatch(db,current,body,access.user);
  else {
    if(loadingParts(db,current).some(part=>part.remaining>0))fail(400,'Select the parts loaded on this vehicle');
    result=db.get('SELECT id,reference FROM ops_loads WHERE order_id=? ORDER BY id DESC LIMIT 1',[current.id]);
    if(!result)fail(400,'Record actual loading quantities first');
  }
  if(loadingParts(db,current).every(part=>part.remaining<=0)&&current.status==='released')updateOrderStatus(db,current,{status:'shipped'},access.user);
  return {...result,status:order(db,current.project_id,current.id).status};
}

function verifyShipment(db,orderId,items) {
  const qc=inspections(db,orderId);
  for (const item of orderItems(db,orderId).filter(({id})=>items.includes(id))) {
    const current=getItem(db,item.specification.project_id,item.item_id);
    if (current.version!==item.specification.version) fail(409,"An order item changed. Review the revised specifications before loading.",{approval_required:true});
    fitForManufacturing(db,current);
    const decision=db.get("SELECT approved FROM ops_order_reviews WHERE order_item_id=? AND item_version=? AND stage='manufacturing'",
      [item.id,item.specification.version]);
    if (decision?.approved===0) fail(409,"Manufacturing approval has been withdrawn");
    const beforeShipment=latestInspection(qc,item,"pre_shipment");
    if (beforeShipment?.release!=="approved") fail(409,"An approved pre-shipment inspection is required");
    for (const stage of qcStages.slice(1,5)) {
      const current=latestInspection(qc,item,stage);
      if (current && current.release!=="approved") fail(409,"Resolve outstanding production inspections");
    }
  }
}

function loadBatch(db,current,input,user) {
  if (onSite(current)) fail(409,"Loading applies to manufacturing orders");
  const commandKey=str(input.command_key,100)||null;
  const prior=commandKey&&db.get("SELECT id,reference FROM ops_loads WHERE order_id=? AND command_key=?",[current.id,commandKey]);
  if (prior) return {...prior,balances:loadingBalances(db,current.id)};
  const requested=str(input.reference,100);
  const alias=requested&&db.get('SELECT reference,previous_reference FROM ops_loading_orders WHERE order_id=? AND (reference=? COLLATE NOCASE OR previous_reference=? COLLATE NOCASE)',[current.id,requested,requested]);
  const reference=alias?.reference||requested||loadingOrder(db,current,user).reference;
  const loadedOn=date(input.loading_date,true)||today();
  const supplied=Array.isArray(input.parts)?input.parts.map(part=>({part_id:str(part.part_id),quantity:part.quantity})):input.lines;
  if (!Array.isArray(supplied) || !supplied.length) fail(400,"Enter actual loading quantities");
  const previousReference=alias?.previous_reference||db.get('SELECT previous_reference FROM ops_loading_orders WHERE order_id=? AND reference=?',[current.id,reference])?.previous_reference;
  const existing=db.get("SELECT id FROM ops_loads WHERE order_id=? AND (reference=? COLLATE NOCASE OR reference=? COLLATE NOCASE)",[current.id,reference,previousReference||reference]);
  if (existing) fail(409,"This loading reference was already recorded");
  if (current.status!=="released") fail(409,"Release the order for manufacturing before recording loading");
  const balances=new Map(loadingParts(db,current).map(row=>[row.part_id,row]));
  const assignments=people(db,current.project_id);
  const responsible={};
  for (const key of responsibilityKeys) {
    const supplied=input.responsible?.[key];
    const manual=supplied&&!idOf(supplied)&&str(supplied,200);
    const person=supplied ? assignments.find(({id})=>id===idOf(supplied))||
      (manual?{name:manual,position:"",side:key==="reviewer"?"client":"company"}:null):
      assignments.find(({responsibility})=>responsibility===key);
    if (!supplied&&!person) continue;
    if (!person) fail(400,"Assign responsibility to project personnel");
    responsible[key]=person;
  }
  if (!responsible.loading) fail(400,"Select the person responsible for loading");
  const seen=new Set();
  const lines=supplied.map((line)=>{
    const key=line.part_id||idOf(line.order_item_id)+":"+str(line.kind);
    const balance=balances.get(key);
    const quantity=number(line.quantity,"loading quantity",{integer:!balance?.custom,positive:true});
    if (!balance || seen.has(key) || !quantity || quantity>balance.remaining+1e-8) fail(409,"Confirm only the remaining quantities for each panel category");
    seen.add(key);
    return {...balance,quantity};
  });
  const affected=[...new Set(lines.map(row=>row.order_item_id).filter(Boolean))];
  verifyShipment(db,current.id,affected);
  const id=db.run(`INSERT INTO ops_loads(order_id,reference,loading_date,responsible,notes,recorded_by,command_key) VALUES(?,?,?,?,?,?,?)`,
    [current.id,reference,loadedOn,encode(responsible),str(input.notes,2000),user.id,commandKey]).lastInsertRowid;
  for (const row of lines) {
    if(row.custom)db.run('INSERT INTO ops_load_parts VALUES(?,?,?,?,?,?)',[id,row.part_id,row.order_item_id,row.label,row.unit,row.quantity]);
    else db.run("INSERT INTO ops_load_lines VALUES (?,?,?,?)",[id,row.order_item_id,row.kind,row.quantity]);
  }
  const items=orderItems(db,current.id).filter(row=>affected.includes(row.id));
  for(const item of items)db.run('UPDATE ops_order_items SET quantities=? WHERE id=?',[encode(item.quantities),item.id]);
  const savedTransport=db.get('SELECT * FROM ops_loading_orders WHERE order_id=? AND reference=?',[current.id,reference])||{};
  const transport={vehicle_plate:str(input.vehicle_plate??savedTransport.vehicle_plate,100),driver_name:str(input.driver_name??savedTransport.driver_name,200)};
  const snapshot={items,parts:[...balances.values()].filter(row=>affected.includes(row.order_item_id)||lines.some(line=>line.part_id===row.part_id)),lines,transport};
  db.run('UPDATE ops_loads SET shipment_data=? WHERE id=?',[encode(snapshot),id]);
  db.run('UPDATE ops_loading_orders SET vehicle_plate=?,driver_name=?,version=version+1 WHERE order_id=? AND reference=?',[transport.vehicle_plate,transport.driver_name,current.id,reference]);
  record(db,user,current.project_id,"loading_confirmed",id,{order_id:current.id,reference});
  return {id,reference,balances:loadingBalances(db,current.id)};
}

function orderDetails(db,current) {
  const loads=db.all("SELECT * FROM ops_loads WHERE order_id=? ORDER BY id DESC",[current.id]);
  const byBatch=new Map(loads.map((row)=>[row.id,{...row,responsible:parse(row.responsible),lines:[]}]));
  for (const row of db.all(`SELECT l.*,i.code FROM ops_load_lines l JOIN ops_loads b ON b.id=l.load_id
    JOIN ops_order_items oi ON oi.id=l.order_item_id JOIN ops_items i ON i.id=oi.item_id WHERE b.order_id=? ORDER BY l.load_id`,[current.id]))
    byBatch.get(row.load_id).lines.push(row);
  for(const row of db.all('SELECT p.*,p.part_id AS kind FROM ops_load_parts p JOIN ops_loads b ON b.id=p.load_id WHERE b.order_id=?',[current.id]))byBatch.get(row.load_id).lines.push(row);
  const transport=db.get("SELECT reference,vehicle_plate,driver_name,version FROM ops_loading_orders WHERE order_id=? AND after_load_id=?",
    [current.id,loads[0]?.id||0]);
  const loadingReference=transport?.reference;
  const items=orderItems(db,current.id);
  const service=parse(current.service_data,{});
  const workflowStale=Boolean(service.workflow_versions&&db.all('SELECT i.id,i.version FROM ops_items i JOIN ops_order_items oi ON oi.item_id=i.id WHERE oi.order_id=?',[current.id])
    .some(item=>service.workflow_versions[item.id]!==item.version));
  const source=current.source_document_id?db.get('SELECT id,operation_no,document_type,title,status FROM documents WHERE id=?',[current.source_document_id]):null;
  return {...current,reference:require("../document-edit-window.cjs").info(db,"order",current.id).active_reference||current.reference,source,coverage:orderCoverage(db,current,items),loading_settings:parse(current.loading_settings,{enabled:false,rows:[]}),loading_reference:loadingReference||null,
    loading_transport:transport||{reference:null,vehicle_plate:'',driver_name:'',version:0},service:{...service,workflow_stale:workflowStale},items,inspections:inspections(db,current.id),
    responsibilities:require("./lifecycle.cjs").assignments(db,current.id),edit_window:orderEditWindow(db,current),document_history:require("../document-edit-window.cjs").history(db,"order",current.id),
    balances:loadingBalances(db,current.id),parts:loadingParts(db,current),loads:[...byBatch.values()],stage_approvals:onSite(current)?[]:stageApprovals(db,current)};
}

function saveLoadingSettings(db,current,body,user){
  if(Number(body.version)!==current.loading_settings_version)fail(409,'The loading settings changed. Reopen this work order before saving');
  if(onSite(current))fail(400,'Loading applies to manufacturing orders');
  if(typeof body.enabled!=='boolean'||!Array.isArray(body.rows))fail(400,'Enter loading rows with a label, unit and quantity');
  const rows=require('./loading-parts.cjs').cleanExtraRows(db,current,body.rows,orderItems(db,current.id));
  if(!body.enabled&&require('./loading-parts.cjs').extraBalances(db,current,orderItems(db,current.id)).some(row=>row.loaded>0))fail(409,'Keep confirmed additional loading parts visible');
  const settings={enabled:body.enabled,rows},version=current.loading_settings_version+1;
  db.run('UPDATE ops_orders SET loading_settings=?,loading_settings_version=? WHERE id=?',[encode(settings),version,current.id]);
  record(db,user,current.project_id,'loading_settings_updated',current.id,{reference:current.reference,before:parse(current.loading_settings),after:settings,version});
  return {loading_settings:settings,loading_settings_version:version};
}

function loadingOrder(db,current,user) {
  const after=db.get("SELECT COALESCE(MAX(id),0) AS id FROM ops_loads WHERE order_id=?",[current.id]).id;
  const existing=db.get("SELECT * FROM ops_loading_orders WHERE order_id=? AND after_load_id=?",[current.id,after]);
  if (existing) return existing;
  const reference=nextReference(db,current.project_id,"LO");
  const id=db.run("INSERT INTO ops_loading_orders(order_id,after_load_id,reference,created_by) VALUES(?,?,?,?)",
    [current.id,after,reference,user.id]).lastInsertRowid;
  record(db,user,current.project_id,"loading_order_prepared",id,{order_id:current.id,reference,after_load_id:after});
  return db.get("SELECT * FROM ops_loading_orders WHERE id=?",[id]);
}

function loadingTransport(db,current,user,reference){
  if(onSite(current))fail(400,'Loading applies to manufacturing orders');
  const row=reference?db.get('SELECT * FROM ops_loading_orders WHERE order_id=? AND (reference=? OR previous_reference=?)',[current.id,reference,reference]):loadingOrder(db,current,user);
  if(!row)fail(404,'Loading order not found');
  return {reference:row.reference,vehicle_plate:row.vehicle_plate,driver_name:row.driver_name,version:row.version};
}
function saveLoadingTransport(db,current,body,user){
  const before=loadingTransport(db,current,user,body.document_ref);
  if(body.document_ref!==before.reference||Number(body.version)!==before.version)fail(409,'The loading order changed. Reopen its vehicle and driver details');
  const next={vehicle_plate:str(body.vehicle_plate,100),driver_name:str(body.driver_name,200)};
  if(next.vehicle_plate===before.vehicle_plate&&next.driver_name===before.driver_name)return before;
  db.run('UPDATE ops_loading_orders SET vehicle_plate=?,driver_name=?,version=version+1 WHERE order_id=? AND reference=?',
    [next.vehicle_plate,next.driver_name,current.id,before.reference]);
  record(db,user,current.project_id,'loading_transport_updated',current.id,{before,after:next,reference:before.reference});
  return {...before,...next,version:before.version+1};
}

function prepareOutput(db,current,options,user) {
  if (current.status==="draft"&&!onSite(current)&&orderItems(db,current.id).some((row)=>
    getItem(db,current.project_id,row.item_id).version!==row.specification.version)) {
    refreshDraftOrder(db,current,user);
    current=order(db,current.project_id,current.id);
  }
  if (options.kind==="loading"&&!onSite(current)){
    const loading=options.loading_reference?db.get('SELECT * FROM ops_loading_orders WHERE order_id=? AND (reference=? OR previous_reference=?)',[current.id,options.loading_reference,options.loading_reference]):loadingOrder(db,current,user);
    if(!loading)fail(404,'Loading order not found');
    current={...current,loading_reference:loading.reference,loading_previous_reference:loading.previous_reference,loading_after_load_id:loading.after_load_id};
  }
  return current;
}

function confirmQuantity(db,item,body,access) {
  const stage=str(body.stage);
  if (stage==="claimable" && !access.capabilities.includes("ops_finance")) fail(403,"Financial approval permission is required");
  const user=access.user;
  const commandKey=str(body.command_key,100)||null;
  const prior=commandKey&&db.get("SELECT id,reference FROM ops_confirmations WHERE item_id=? AND command_key=?",[item.id,commandKey]);
  if (prior) return prior;
  const reference=str(body.reference,100)||nextReference(db,item.project_id,"QTY");
  const quantity=number(body.quantity,"confirmed quantity",{positive:true});
  if (!quantity || !["installed","claimable"].includes(stage)) fail(400,"Enter a stage and positive confirmed quantity");
  if (db.get("SELECT 1 FROM ops_confirmations WHERE item_id=? AND stage=? AND reference=? COLLATE NOCASE",[item.id,stage,reference]))
    fail(409,"This confirmation reference was already recorded");
  if (!item.active) fail(409,"Only active items can receive quantity confirmations");
  const id=db.run("INSERT INTO ops_confirmations(item_id,stage,quantity,unit,reference,confirmed_on,actor_id,command_key) VALUES(?,?,?,?,?,?,?,?)",
    [item.id,stage,quantity,item.commercial.unit,reference,date(body.confirmed_on,true)||today(),user.id,commandKey]).lastInsertRowid;
  record(db,user,item.project_id,"quantity_confirmed",id,{item_id:item.id,stage,quantity,unit:item.commercial.unit});
  return {id,reference};
}

module.exports = {qcStages,qcChecks,qcResults,checks,order,orderPage,orderDetails,addOrder,updateOrderStatus,refreshDraftOrder,prepareOutput,loadingOrder,
  inspect,verifyShipment,loadBatch,loadingBalances,loadingParts,shipmentPreparation,confirmShipment,itemApprovals,recordApprovals,confirmQuantity,completeService,stageApprovals,reviewStage,orderStages,saveLoadingSettings,availableItems,orderCoverage,includeRemaining,loadingTransport,saveLoadingTransport};
