const {fail,str,parse,inScope,scopeSql}=require('../certificate-access.cjs');
const production=require('../project-operations/production.cjs');
const {openingDescription}=require('../project-operations/customer-defaults.cjs');
const {getProject}=require('../certificate-projects.cjs');
function project(db,access,id){id=Number(id);if(!inScope(access,id))fail(404,'Project not found');return getProject(db,id);}
function options(db,access,id){project(db,access,id);const items=[];
 for(const row of db.all('SELECT id,reference,status FROM ops_orders WHERE project_id=? ORDER BY id DESC',[id]))items.push({...row,type:'work',label:row.reference});
 for(const row of db.all('SELECT id,reference,status FROM ops_manual_loading_orders WHERE project_id=? ORDER BY id DESC',[id]))items.push({...row,type:'loading',label:row.reference});
 for(const row of db.all('SELECT l.id,l.reference FROM ops_loading_orders l JOIN ops_orders o ON o.id=l.order_id WHERE o.project_id=? ORDER BY l.id DESC',[id]))items.push({...row,type:'work_loading',label:row.reference});
 for(const row of db.all("SELECT l.id,COALESCE(json_extract(l.shipment_data,'$.document_reference'),l.reference) reference FROM ops_loads l JOIN ops_orders o ON o.id=l.order_id WHERE o.project_id=? AND NOT EXISTS(SELECT 1 FROM ops_manual_shipments s WHERE s.linked_load_id=l.id) ORDER BY l.id DESC",[id]))items.push({...row,type:'delivery',label:row.reference,status:'confirmed'});
 for(const row of db.all("SELECT 'manual-'||s.id id,s.reference FROM ops_manual_shipments s JOIN ops_manual_loading_orders p ON p.id=s.loading_order_id WHERE p.project_id=? ORDER BY s.id DESC",[id]))items.push({...row,type:'delivery',label:row.reference,status:'confirmed'});
 for(const row of db.all("SELECT id,status,official_number,reserved_number,legacy_number,revision,work_to FROM cert_revisions WHERE project_id=? AND status NOT IN ('void','superseded') ORDER BY id DESC",[id]))items.push({...row,type:'certificate',label:String(row.legacy_number||row.official_number||row.reserved_number||('Draft '+row.id))+' · '+row.work_to});
 return items;
}
function line(type,id,key,description,unit,quantity,reference,extra={}){return {id:type+':'+id+':'+key,tag:'',description:description||'',unit:unit||'Pcs',quantity:Number(quantity)||0,source_quantity:Number(quantity)||0,reference,source:{type,id:String(id),key:String(key)},...extra};}
function workRows(db,current,type,id,ref){const details=production.orderDetails(db,current);return details.items.map(item=>{const spec=item.specification,tech=spec.technical||{};return line(type,id,item.id,openingDescription(spec),'Pcs',item.quantity,ref,{tag:tech.tag||'',location:[tech.building,tech.floor,tech.room].filter(Boolean).join(' / '),width_mm:tech.width_mm||'',height_mm:tech.height_mm||'',profile:tech.profile||'',ral:tech.color||'',glass:tech.infill||'',recorded_installed:Number(db.get('SELECT quantity FROM ops_installations WHERE order_item_id=?',[item.id])?.quantity||0),work_type:spec.category||'',source_quantity:Number(item.quantity)});});}
function rows(db,access,projectId,type,id){project(db,access,projectId);id=String(id);let result=[];
 if(type==='loading'){const p=require('../project-operations/loading-orders.cjs').get(db,access,Number(id));if(p.project_id!==Number(projectId))fail(404,'Source not found');result=p.items.map(item=>line(type,id,item.id,item.label,item.unit,item.quantity,p.reference,{remarks:'',delivery_date:p.loading_date}));}
 else if(type==='work_loading'){const p=db.get('SELECT l.*,o.project_id FROM ops_loading_orders l JOIN ops_orders o ON o.id=l.order_id WHERE l.id=?',[Number(id)]);if(!p||p.project_id!==Number(projectId))fail(404,'Source not found');result=workRows(db,production.order(db,Number(projectId),p.order_id),type,id,p.reference);}
 else if(type==='work'){const current=production.order(db,Number(projectId),Number(id));result=workRows(db,current,type,id,current.reference);}
 else if(type==='delivery'){
  const n=require('../project-operations/delivery-notes.cjs').get(db,access,id);if(n.project_id!==Number(projectId))fail(404,'Source not found');let data;
  if(n.kind==='manual'){const snap=n.work_snapshot||{items:[],parts:[],lines:[]};data={...snap,reference:n.reference,loading_date:n.loading_date};
   result=(n.items||[]).filter(item=>!item.part_id).map(item=>line(type,id,'manual:'+item.id,item.label,item.unit,item.quantity,n.reference,{delivery_date:n.loading_date}));
   if(n.linked_load_id)data=require('../project-operations/shipment-report.cjs').shipmentData(db,production.order(db,n.project_id,n.order.work_order_id),n.linked_load_id);
  }else data=require('../project-operations/shipment-report.cjs').shipmentData(db,n.order,Number(id));
  const items=new Map((data.items||[]).map(item=>[item.id,item])),parts=new Map((data.parts||[]).map(part=>[part.part_id,part]));
  for(const actual of data.lines||[]){const part=parts.get(actual.part_id);if(!part||!(actual.quantity>0))continue;const item=items.get(part.order_item_id),tech=item?.specification.technical||{};result.push(line(type,id,part.part_id,(item?openingDescription(item.specification)+' — ':'')+(part.label||part.component||part.kind),part.unit,actual.quantity,n.reference,{tag:tech.tag||'',location:[tech.building,tech.floor,tech.room].filter(Boolean).join(' / '),delivery_date:n.loading_date,profile:tech.profile||'',ral:tech.color||'',glass:tech.infill||''}));}
 }else if(type==='certificate'){
  const r=require('../certificate-revisions.cjs').getRevision(db,Number(id));if(r.project_id!==Number(projectId))fail(404,'Source not found');const input=require('../certificate-revisions.cjs').certificateDocumentInput(db,r),ref=String(require('../certificate-revisions.cjs').certificateNumber(db,r));
  result=(input.lines||[]).filter(item=>item.mode!=='adjustment').map((item,index)=>line(type,id,item.identity||item.id||index,item.description||item.work_item,item.unit,item.quantity??item.count??1,ref,{location:[item.building_unit,item.floor_apartment,item.location].filter(Boolean).join(' / '),progress:item.cumulative_progress??item.progress??'',work_type:item.work_type||''}));
 }else fail(400,'Choose a supported source document');
 return result.filter(row=>row.source_quantity>0);
}
function key(row,kind,stage){return kind+':'+(kind==='IR'?stage:'materials')+':'+row.source.type+':'+row.source.id+':'+row.source.key;}
function totals(db,projectId,excludeRoot){const used=new Map();
 for(let r of db.all("SELECT id,root_id,kind,data,rows,status FROM inspection_requests WHERE project_id=? AND (status IN ('submitted','responded') OR status='draft' AND submitted_at IS NOT NULL)",[projectId])){
  if(Number(excludeRoot)===Number(r.root_id||r.id))continue;
  if(r.status==='draft'){const previous=db.get("SELECT snapshot FROM inspection_events WHERE request_id=? AND json_extract(snapshot,'$.status') IN ('submitted','responded') ORDER BY id DESC LIMIT 1",[r.id]);if(!previous)continue;const snapshot=parse(previous.snapshot);r={...snapshot,data:JSON.stringify(snapshot.data),rows:JSON.stringify(snapshot.rows)};}
  const effectiveData=parse(r.data,{});
  for(const row of parse(r.rows,[])){if(!row.source)continue;const k=key(row,r.kind,effectiveData.stage||'installation'),prior=used.get(k)||{accepted:0,pending:0};prior.accepted+=Number(row.accepted||0);if(r.status==='submitted')prior.pending+=Number(row.quantity||0);used.set(k,prior);}
 }return used;
}
module.exports={project,options,rows,key,totals};
