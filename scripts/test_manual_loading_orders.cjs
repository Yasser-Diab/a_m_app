const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createServer}=require('../server/index.cjs');
const {manualReport}=require('../server/project-operations/loading-orders.cjs');
async function main(){
  const dir=await fs.mkdtemp(path.join(process.env.AM_TEST_TEMP||os.tmpdir(),'manual-loading-'));
  const app=await createServer({dataDir:dir,dbPath:path.join(dir,'test.db'),port:0}),http=await app.listen(0,'127.0.0.1'),db=app.database;
  const origin='http://127.0.0.1:'+http.address().port,realFetch=global.fetch;let token;
  global.fetch=(url,options)=>String(url).startsWith(origin)?realFetch(url,options):Promise.resolve(Response.json({has_access:true}));
  async function api(route,method='GET',body,status=200){const response=await realFetch(origin+'/api'+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();assert.equal(response.status,status,method+' '+route+' '+JSON.stringify(data).slice(0,700));return data;}
  try{
    db.run('INSERT OR REPLACE INTO app_settings(key,value) VALUES(?,?)',['company_profile',JSON.stringify({free_access_until:'2099-01-01T00:00:00Z'})]);
    const password=crypto.randomBytes(20).toString('hex');db.run('INSERT INTO users(username,display_name,role,pin_hash) VALUES(?,?,?,?)',['loading-manager','Loading manager','manager',crypto.createHash('sha256').update(password).digest('hex')]);
    const user=(await api('/auth/login','POST',{username:'loading-manager',password})).user;token=user.certificate_session;
    const customer=await api('/certificates/customers','POST',{name:'Manual customer',tax_no:'TX-900'},201);
    const project=await api('/certificates/projects','POST',{name:'Manual project',customer_id:customer.id,address:'Original address'},201),scope='/project-operations/projects/'+project.id;
    const duplicate=await api('/certificates/customers','POST',{name:'Manual customer'});assert.equal(duplicate.id,customer.id);
    const command=crypto.randomUUID(),input={project_id:project.id,customer_id:customer.id,command_key:command,loading_date:'2026-11-23',
      items:Array.from({length:1001},(_,index)=>({label:'Loading item '+(index+1),unit:index===1000?'kg':'Pcs',quantity:index===1000?2.5:1})),
      signatures:[{name:'Dispatch lead',title:'Warehouse',side:'company'},{name:'Receiver',title:'Site engineer',side:'client'}]};
    let manual=await api('/project-operations/loading-orders','POST',input);
    assert.equal(manual.items.length,1001);assert.match(manual.reference,/^LO\d{12}$/);
    assert.equal(db.get('SELECT COUNT(*) n FROM ops_projects').n,0);assert.equal(db.get('SELECT COUNT(*) n FROM documents').n,0);
    assert.equal((await api('/project-operations/loading-orders','POST',input)).id,manual.id);
    await api('/project-operations/loading-orders/'+manual.id,'PATCH',{...input,version:0},409);
    manual=await api('/project-operations/loading-orders/'+manual.id,'PATCH',{...input,version:manual.version,vehicle_plate:'ABC 456',driver_name:'Driver One',notes:'Handle carefully'});
    assert.equal(manual.items.length,1001);assert.equal(manual.driver_name,'Driver One');
    assert.equal(db.get('SELECT COUNT(*) n FROM ops_manual_loading_history WHERE loading_order_id=?',[manual.id]).n,2);
    const html=manualReport(manual,{locale:'en'},{companyNameEn:'Company',companyNameColor:'#a87823'});
    assert.equal((html.match(/<tr>/g)||[]).length,1002);assert.ok(html.includes('ABC 456')&&html.includes('Driver One'));
    assert.ok(html.indexOf('loading-transport')<html.lastIndexOf('class="signoffs"'));assert.ok(html.includes('color:#a87823'));
    const list=await api('/project-operations/loading-orders?q='+encodeURIComponent(manual.reference));assert.equal(list.total,1);
    const doc=db.run("INSERT INTO documents(document_type,document_no,operation_no,status,party_id,party_role,project,customer_name) VALUES('invoice',9201,'009201','draft',?,'customer',?,?)",[customer.id,project.name,customer.display_name]).lastInsertRowid;
    const sourceId=db.run("INSERT INTO work_items(document_id,party_id,party_role,project,description,item_count,width_cm,height_cm,total_quantity,quantity,unit,unit_code,rate,gross_total,net_total) VALUES(?,?,'customer',?,'Sliding',1,100,150,1,1,'Pcs','count',100,100,100)",[doc,customer.id,project.name]).lastInsertRowid;
    await api('/documents/'+doc,'PUT',{status:'approved'});await api(scope,'POST',{boq_id:doc});await api(scope);
    let item=(await api(scope+'/items')).items[0];item=await api(scope+'/items/'+item.id,'PATCH',{...item,category:'windows',system:'windows-8',technical:{...item.technical,leaves:2,lock_right:'Latch',lock_left:'Handle'}});
    assert.equal((await api('/project-operations/reports/progress?project_id='+project.id)).total,0,'Importing or viewing an approved invoice does not start work progress');
    const order=await api(scope+'/orders','POST',{source_document_id:doc,items:[{item_id:item.id,quantity:1}]}),endpoint=scope+'/orders/'+order.id;
    assert.equal((await api('/project-operations/reports/progress?project_id='+project.id)).total,0,'A draft work order alone is not an approval');
    await api(endpoint+'/approvals','POST',{stage:'profile',approved:true});
    assert.equal((await api('/project-operations/reports/progress?project_id='+project.id)).total,1);
    await api(endpoint+'/approvals','POST',{stage:'profile',approved:false});
    const rejected=await api('/project-operations/reports/progress?project_id='+project.id);assert.equal(rejected.items[0].stage,'rejected');assert.equal(rejected.items[0].orders[0].rejected,true);
    const state=(await api(scope)).operations;
    await api(scope,'PATCH',{version:state.version,details:{...state.details,status:'مكتمل'}});
    assert.equal((await api('/project-operations/reports/progress?project_id='+project.id)).items[0].stage,'rejected','Rejected orders stay visible even when the project was marked completed');
    assert.equal((await api('/project-operations/reports/progress?project_id='+project.id+'&exclude_rejected=1')).total,0);
    await api(endpoint+'/approvals','POST',{stage:'profile',approved:true});
    assert.notEqual((await api('/project-operations/reports/progress?project_id='+project.id+'&include_completed=1')).items[0].stage,'rejected');
    const linked=await api(endpoint+'/loading-transport/prepare','POST',{});assert.notEqual(linked.reference,manual.reference);assert.ok(linked.reference.endsWith('0002'));
    const linkedReport=await api(endpoint+'/report','POST',{kind:'loading',locale:'en'});
    const customBody=linkedReport.html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)[1].replace('</section>','<dl><div><dt>Site instruction</dt><dd>Keep this custom header instruction</dd></div></dl></section>');
    await api(endpoint+'/report-edits','POST',{kind:'loading',locale:'en',version:0,document_ref:linked.reference,html:customBody});
    const more=await api('/project-operations/loading-orders','POST',{...input,command_key:crypto.randomUUID(),items:input.items.slice(0,1)});assert.ok(more.reference.endsWith('0003'));
    assert.equal((await api('/project-operations/loading-orders?project_id='+project.id)).total,3);
    await api('/certificates/customers/'+customer.id,'PUT',{name:'Renamed customer'});
    assert.equal((await api('/certificates/customers/'+customer.id)).tax_no,'TX-900');
    assert.equal(db.get('SELECT customer_name FROM documents WHERE id=?',[doc]).customer_name,'Renamed customer');
    assert.equal(db.get('SELECT customer_display_name FROM work_items WHERE id=?',[sourceId]).customer_display_name,'Renamed customer');
    await api('/certificates/projects/'+project.id,'PATCH',{name:'Renamed project',address:'Updated address',customer_project_code:'SITE-88',currency:'USD'});
    assert.equal(db.get('SELECT project FROM documents WHERE id=?',[doc]).project,'Renamed project');
    assert.equal(db.get('SELECT project FROM work_items WHERE id=?',[sourceId]).project,'Renamed project');
    const updated=await api('/project-operations/loading-orders/'+manual.id);assert.equal(updated.customer.display_name,'Renamed customer');assert.equal(updated.project.name,'Renamed project');
    assert.equal(updated.customer.code,customer.code);assert.equal(updated.project.code,project.code);
    const refreshed=await api(endpoint+'/report','POST',{kind:'loading',locale:'en'});
    assert.ok(refreshed.html.includes('Renamed customer')&&refreshed.html.includes('Renamed project')&&refreshed.html.includes('Keep this custom header instruction'));
    assert.ok(!refreshed.html.includes('Manual project'));
    const otherCustomer=await api('/certificates/customers','POST',{name:'Another customer'},201);
    const otherProject=await api('/certificates/projects','POST',{customer_id:otherCustomer.id,name:'Another project'},201);
    await api('/project-operations/loading-orders','POST',{...input,command_key:crypto.randomUUID(),project_id:otherProject.id},400);
    const userId=db.run('INSERT INTO users(username,display_name,role,pin_hash) VALUES(?,?,?,?)',['restricted-loading','Restricted','user',crypto.createHash('sha256').update(password).digest('hex')]).lastInsertRowid;
    await api('/certificates/admin/users/'+userId,'PUT',{capabilities:['view','ops_view','ops_export'],project_ids:[otherProject.id]});
    token=(await api('/auth/login','POST',{username:'restricted-loading',password})).user.certificate_session;
    assert.equal((await api('/project-operations/loading-orders')).total,0);await api('/project-operations/loading-orders/'+manual.id,'GET',undefined,404);
    token=user.certificate_session;
    if(process.env.AM_MANUAL_LOADING_QA_HOOK)await require(process.env.AM_MANUAL_LOADING_QA_HOOK)({origin,api,user,customer:updated.customer,project:updated.project,manual:updated,scope,order,db});
    console.log('Standalone 1001-item loading orders, unique shared numbering, revisions, master renaming, approval-driven progress and scoped access passed');
  }finally{global.fetch=realFetch;await new Promise(resolve=>http.close(resolve));app.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
