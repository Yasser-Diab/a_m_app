const {idOf,str,date,today,parse,encode,fail,inScope,scopeSql,audit}=require('../certificate-access.cjs');
const {getProject,getCustomer}=require('../certificate-projects.cjs');
const {nextReference}=require('./references.cjs');
const {wrap,escape,grid,row,loadingTransportBlock}=require('./reports.cjs');
const {unitKey,unitName}=require('./order-quantities.cjs');
function options(db,access,query={}){
  const scope=scopeSql(access,'p.id'),customer=idOf(query.customer_id),q='%'+str(query.q,150)+'%';
  const customers=db.all(`SELECT c.id,c.display_name,c.base_name AS name,m.code FROM parties c LEFT JOIN cert_customer_profiles m ON m.customer_id=c.id
    WHERE c.role='customer' AND (?=1 OR EXISTS(SELECT 1 FROM cert_projects p WHERE p.customer_id=c.id AND ${scope.clause})
      OR EXISTS(SELECT 1 FROM cert_customer_creators x WHERE x.customer_id=c.id AND x.user_id=?))
      AND (c.display_name LIKE ? OR c.search_name LIKE ? OR m.code LIKE ?) ORDER BY c.id DESC LIMIT 120`,
    [access.all_projects?1:0,...scope.params,access.user.id,q,q,q]);
  const projects=!customer?[]:db.all(`SELECT p.id,p.name,p.code,p.customer_id,p.address,p.currency,
    (SELECT json_extract(details,'$.report_signatures.loading') FROM ops_projects WHERE project_id=p.id) AS loading_signatures
    FROM cert_projects p WHERE ${scope.clause} AND p.customer_id=? ORDER BY p.created_at DESC,p.id DESC`,[...scope.params,customer])
    .map(project=>({...project,loading_signatures:parse(project.loading_signatures,null)??require('../signature-directory.cjs').defaults(db,'loading')}));
  return {customers,projects};
}
function list(db,access,query={}){
  const page=Math.max(1,Math.min(1e7,Math.trunc(Number(query.page)||1))),limit=50,q='%'+str(query.q,150)+'%',project=idOf(query.project_id),customer=idOf(query.customer_id);
  const scope=scopeSql(access,'x.project_id');
  const from=`FROM (SELECT 'manual' AS kind,id,NULL AS order_id,project_id,reference,status,loading_date,created_at FROM ops_manual_loading_orders
    UNION ALL SELECT 'linked',l.id,o.id,o.project_id,l.reference,o.status,SUBSTR(l.created_at,1,10),l.created_at FROM ops_loading_orders l JOIN ops_orders o ON o.id=l.order_id) x
    JOIN cert_projects p ON p.id=x.project_id JOIN parties c ON c.id=p.customer_id
    WHERE ${scope.clause} AND (? IS NULL OR x.project_id=?) AND (? IS NULL OR p.customer_id=?) AND (x.reference LIKE ? OR p.name LIKE ? OR p.code LIKE ? OR c.display_name LIKE ?)`;
  const args=[...scope.params,project,project,customer,customer,q,q,q,q];
  return {items:db.all(`SELECT x.*,p.name AS project,p.code AS project_code,p.customer_id,c.display_name AS customer ${from} ORDER BY x.created_at DESC,x.id DESC LIMIT ? OFFSET ?`,[...args,limit,(page-1)*limit]),
    total:db.get('SELECT COUNT(*) n '+from,args).n,page,limit};
}
function get(db,access,id){
  const result=db.get('SELECT * FROM ops_manual_loading_orders WHERE id=?',[id]);
  if(!result||!inScope(access,result.project_id))fail(404,'Loading order not found');
  return {...result,edit_window:require('../document-edit-window.cjs').info(db,'manual_loading',result.id,result.status!=='draft'?result.created_at:null),document_history:require('../document-edit-window.cjs').history(db,'manual_loading',result.id),items:parse(result.items,[]),signatures:parse(result.signatures,[]),project:getProject(db,result.project_id),
    customer:getCustomer(db,getProject(db,result.project_id).customer_id),project_details:parse(db.get('SELECT details FROM ops_projects WHERE project_id=?',[result.project_id])?.details,{}),people:require('./core.cjs').people(db,result.project_id)};
}
function values(body){
  if(!Array.isArray(body.items)||!body.items.length)fail(400,'Add at least one loading item');
  const items=body.items.map(item=>{
    if(!item||typeof item!=='object')fail(400,'Enter valid loading items');
    const label=str(item.label,3000),unit=str(item.unit,60),quantity=Number(item.quantity);
    if(!label||!unit||!Number.isFinite(quantity)||quantity<=0)fail(400,'Each loading item needs a description, unit and positive quantity');
    return {label,unit,quantity};
  });
  const status=str(body.status)||'draft';if(!['draft','issued','cancelled'].includes(status))fail(400,'Choose a loading order status');
  const signatures=(Array.isArray(body.signatures)?body.signatures:[]).map(person=>({name:str(person.name,200),title:str(person.title,200),side:person.side==='client'?'client':'company'})).filter(person=>person.name||person.title);
  return {items,signatures,status,loading_date:date(body.loading_date,true)||today(),vehicle_plate:str(body.vehicle_plate,100),driver_name:str(body.driver_name,200),notes:str(body.notes,5000)};
}
function history(db,current,user){
  db.run('INSERT INTO ops_manual_loading_history(loading_order_id,version,snapshot,actor_id) VALUES(?,?,?,?)',[current.id,current.version,encode(current),user.id]);
  audit(db,user,'manual_loading_order_saved',{projectId:current.project_id,details:{id:current.id,reference:current.reference,version:current.version,items:current.items.length}});
}
function create(db,access,body){
  const project=getProject(db,idOf(body.project_id));if(!inScope(access,project.id))fail(404,'Project not found');
  if(body.customer_id!=null&&Number(body.customer_id)!==project.customer_id)fail(400,'The project belongs to another customer');
  const command=str(body.command_key,100);if(!command)fail(400,'Provide a loading order request reference');
  const previous=db.get('SELECT id,project_id FROM ops_manual_loading_orders WHERE command_key=?',[command]);
  if(previous){if(previous.project_id!==project.id)fail(409,'This request belongs to a different project');return get(db,access,previous.id);}
  const data=values({...body,signatures:body.signatures??require('../signature-directory.cjs').defaults(db,'loading')}),reference=nextReference(db,project.id,'LO');
  const id=db.run(`INSERT INTO ops_manual_loading_orders(project_id,reference,command_key,loading_date,status,items,signatures,vehicle_plate,driver_name,notes,created_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`,[project.id,reference,command,data.loading_date,data.status,encode(data.items),encode(data.signatures),data.vehicle_plate,data.driver_name,data.notes,access.user.id]).lastInsertRowid;
  if(data.status!=='draft')require('../document-edit-window.cjs').lock(db,'manual_loading',id);
  const current=get(db,access,id);history(db,current,access.user);return current;
}
function update(db,access,id,body){
  const before=get(db,access,id);if(Number(body.version)!==before.version)fail(409,'The loading order changed. Reload it before saving');
  if(body.project_id!=null&&Number(body.project_id)!==before.project_id)fail(400,'Create a new loading order for a different project');
  if(before.edit_window.locked)require('../document-edit-window.cjs').check(db,'manual_loading',id,before.edit_window.first_locked_at,body.correction===true,body.reason);
  const data=values(body);
  db.run(`UPDATE ops_manual_loading_orders SET loading_date=?,status=?,items=?,signatures=?,vehicle_plate=?,driver_name=?,notes=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [data.loading_date,data.status,encode(data.items),encode(data.signatures),data.vehicle_plate,data.driver_name,data.notes,id]);
  if(data.status!=='draft')require('../document-edit-window.cjs').lock(db,'manual_loading',id,before.edit_window.first_locked_at||new Date().toISOString());
  const current=get(db,access,id);require('../document-edit-window.cjs').revision(db,'manual_loading',id,current.reference,before,current,access.user,{correction:body.correction===true,reason:body.reason});history(db,current,access.user);return get(db,access,id);
}
function manualReport(order,options,branding){
  const locale=options.locale==='en'?'en':'ar',t=(ar,en)=>locale==='ar'?ar:en,totals=new Map();
  for(const item of order.items){const unit=unitKey(item.unit);totals.set(unit,(totals.get(unit)||0)+item.quantity);}
  const signoffs=['company','client'].map(side=>{
    const people=order.signatures.filter(person=>person.side===side);
    return !people.length?'':`<div class="signoff">${side==='client'?'<h3>'+t('العميل','Customer')+'</h3>':''}<div class="signatures" style="--signers:${people.length}">${people.map(person=>'<div><strong><bdi>'+escape(person.name||person.title)+'</bdi></strong>'+(person.name&&person.title?'<br><bdi>'+escape(person.title)+'</bdi>':'')+'</div>').join('')}</div></div>`;
  }).join('');
  const personnel=(order.people||[]).map(person=>'<span class="project-person"><bdi>'+escape(person.name)+'</bdi>'+(person.name&&person.position?' : ':'')+'<bdi>'+escape(person.position)+'</bdi></span>').join('');
  const body='<section class="project-info">'+grid([[t('العميل','Customer'),order.customer.display_name],[t('كود العميل','Customer code'),order.customer.code],
    [t('المشروع','Project'),order.project.name],[t('رقم المشروع','Project code'),order.project.code],[t('عنوان الموقع','Site address'),order.project.address],
    [t('المبنى / القطاع','Building / sector'),order.project_details?.building],[t('تاريخ التحميل','Loading date'),order.loading_date]])+(personnel?'<div class="project-people">'+personnel+'</div>':'')+'</section><section class="loading"><table><thead>'+row([t('البيان','Description'),t('الوحدة','Unit'),t('الكمية المطلوبة','Required quantity'),t('التحميل الفعلي','Actual loading'),t('ملاحظات','Remarks')],'th')+
    '</thead><tbody>'+order.items.map(item=>row([item.label,unitName(unitKey(item.unit),locale),new Intl.NumberFormat('en-US',{maximumFractionDigits:4}).format(item.quantity),'',''])).join('')+'</tbody></table></section>'+
    (order.notes?'<section>'+grid([[t('ملاحظات','Notes'),order.notes]])+'</section>':'')+
    '<section class="order-summary">'+grid([...totals].map(([unit,amount])=>[t('إجمالي ','Total ')+unitName(unit,locale),new Intl.NumberFormat('en-US',{maximumFractionDigits:4}).format(amount)]))+'</section>'+
    loadingTransportBlock({loading_transport:order},locale)+(signoffs?'<div class="signoffs">'+signoffs+'</div>':'');
  return wrap({locale,branding,title:t('أمر تحميل ','Loading Order ')+(order.edit_window?.active_reference||order.reference),color:'#7992a3',body});
}
module.exports={options,list,get,create,update,manualReport};
