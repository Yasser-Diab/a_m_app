const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createServer}=require('../server/index.cjs');
const {approvalParts}=require('../server/project-operations/specifications.cjs');
async function main(){
  const temp=await fs.mkdtemp(path.join(process.env.AM_TEST_TEMP||os.tmpdir(),'source-orders-'));
  const app=await createServer({dataDir:temp,dbPath:path.join(temp,'test.db'),port:0}),http=await app.listen(0,'127.0.0.1'),db=app.database;
  const origin='http://127.0.0.1:'+http.address().port,realFetch=global.fetch;
  global.fetch=(url,options)=>String(url).startsWith(origin)?realFetch(url,options):Promise.resolve(Response.json({has_access:true}));let token;
  async function api(route,method='GET',body,status=200){
    const response=await realFetch(origin+'/api'+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    const result=await response.json();assert.equal(response.status,status,method+' '+route+' '+JSON.stringify(result).slice(0,700));return result;
  }
  try{
    db.run('INSERT OR REPLACE INTO app_settings(key,value) VALUES(?,?)',['company_profile',JSON.stringify({free_access_until:'2099-01-01T00:00:00Z'})]);
    const password=crypto.randomBytes(20).toString('hex');
    db.run('INSERT INTO users(username,display_name,role,pin_hash) VALUES(?,?,?,?)',['source-manager','Source manager','manager',crypto.createHash('sha256').update(password).digest('hex')]);
    const manager=(await api('/auth/login','POST',{username:'source-manager',password})).user;token=manager.certificate_session;
    const customer=await api('/certificates/customers','POST',{name:'Source order customer'},201);
    const project=await api('/certificates/projects','POST',{customer_id:customer.id,name:'Many source project',address:'Original site'},201);
    const scope='/project-operations/projects/'+project.id;
    async function source(number,count,description='Shared sliding opening'){
      const id=db.run(`INSERT INTO documents(document_type,document_no,operation_no,status,party_id,party_role,project,customer_name)
        VALUES('invoice',?,?,'draft',?,'customer',?,?)`,[number,String(number),customer.id,project.name,customer.display_name]).lastInsertRowid;
      db.transaction(()=>{for(let i=0;i<count;i++)db.run(`INSERT INTO work_items(document_id,party_id,project,description,item_count,width_cm,height_cm,total_quantity,quantity,unit,unit_code,rate,gross_total,net_total)
        VALUES(?,?,?,?,1,?,150,1,1,'Pcs','count',100,100,100)`,[id,customer.id,project.name,description,100+i]);});
      await api('/documents/'+id,'PUT',{status:'approved'});await api(scope+'/boqs','POST',{boq_id:id});return id;
    }
    const first=await source(8101,125);let items=(await api(scope+'/items?all=1')).items;
    await api(scope+'/specifications','POST',{remember:false,rows:items.map(item=>({id:item.id,version:item.version,category:'windows',system:'windows-8',technical:{leaves:2,profile:'Project section',color:'9007',screen:'ضلفة مستقلة',lock_right:'Right latch',lock_left:'Left handle'}}))});
    items=(await api(scope+'/items?all=1')).items;
    const available=await api(scope+'/order-items?boq_id='+first);assert.equal(available.items.length,125);
    assert.equal(available.items.reduce((sum,item)=>sum+item.available_quantity,0),125);
    const order=await api(scope+'/orders','POST',{source_document_id:first,items:items.slice(0,50).map(item=>({item_id:item.id,quantity:1}))}),endpoint=scope+'/orders/'+order.id;
    assert.equal(order.source_document_id,first);
    const duplicate=await api(scope+'/orders','POST',{source_document_id:first,items:[{item_id:items[50].id,quantity:1}]},409);
    assert.match(duplicate.error,/already has a work order/);
    await api(endpoint+'/loading-settings','PATCH',{version:0,enabled:true,rows:[{label:'Spare pack',unit:'kg',quantity:2}]});
    for(const stage of [...approvalParts,'manufacturing'])await api(endpoint+'/approvals','POST',{stage,approved:true});
    let details=await api(endpoint);assert.equal(details.status,'released');assert.equal(details.coverage.available_quantity,75);
    const prior=details.items.map(item=>item.id),reviews=db.get('SELECT COUNT(*) n FROM ops_order_reviews').n;
    await api(endpoint+'/include-remaining','POST',{fingerprint:'stale'},409);
    assert.equal((await api(endpoint)).items.length,50);
    details=await api(endpoint+'/include-remaining','POST',{fingerprint:details.coverage.fingerprint,copy_approvals:false});
    assert.equal(details.items.length,125);assert.equal(details.status,'draft');assert.equal(details.coverage.available_quantity,0);
    assert.deepEqual(details.items.slice(0,50).map(item=>item.id),prior);assert.equal(db.get('SELECT COUNT(*) n FROM ops_order_reviews').n,reviews);
    assert.equal(details.stage_approvals.find(stage=>stage.stage==='measurement').items.filter(item=>item.approved).length,50);
    assert.equal(details.loading_settings.rows[0].label,'Spare pack');
    assert.equal(details.source_scope,'all');
    assert.equal((await api(endpoint+'/include-remaining','POST',{fingerprint:'already applied'})).items.length,125);
    const report=await api(endpoint+'/report','POST',{kind:'manufacturing',classification:'materials',locale:'en'});
    assert.equal((report.html.match(/<tr>/g)||[]).length>125,true);assert.ok(report.html.includes('125'));
    await api(endpoint+'/report','POST',{kind:'manufacturing',classification:'manufacturing',locale:'en'},409);
    const second=await source(8102,3);
    const inherited=(await api(scope+'/items?all=1&boq_id='+second)).items;
    assert.equal(inherited[0].technical.profile,'Project section');assert.equal(inherited[0].system,'windows-8');
    assert.equal(inherited[0].technical.width_mm,1000);assert.equal(inherited[1].technical.width_mm,1010);
    const other=await api(scope+'/orders','POST',{source_document_id:second,items:inherited.map(item=>({item_id:item.id,quantity:1}))});
    assert.notEqual(other.reference,order.reference);assert.equal(other.source_document_id,second);
    const secondPath=scope+'/orders/'+other.id;assert.equal((await api(scope+'/orders?source_document_id='+second)).items.length,1);
    await api(scope+'/orders','POST',{source_document_id:first,items:[{item_id:inherited[0].id,quantity:1}]},400);
    const firstBefore=JSON.stringify((await api(endpoint)).items);
    db.run("UPDATE work_items SET profile_spec='Changed source section',width_cm=188 WHERE document_id=?",[second]);
    const preview=await api(scope+'/source-refresh?document_id='+second);
    await api(scope+'/source-refresh','POST',{document_id:second,version:preview.version,fingerprint:preview.fingerprint,confirm:true});
    assert.equal((await api(secondPath)).items[0].specification.technical.width_mm,1880);
    assert.equal(JSON.stringify((await api(endpoint)).items),firstBefore,'Updating one source does not change another order');
    let current=await api(scope+'/items/'+inherited[0].id);
    await api(scope+'/items/'+current.id,'PATCH',{...current,technical:{...current.technical,profile:'Last project choice',color:'9010'},remember:false});
    const third=await source(8103,2);const next=(await api(scope+'/items?all=1&boq_id='+third)).items;
    assert.equal(next[0].technical.profile,'Last project choice');assert.equal(next[0].technical.color,'9010');
    assert.equal(next[0].technical.width_mm,1000);assert.equal(next[1].technical.width_mm,1010);
    const whole=await api(scope+'/orders','POST',{source_document_id:third,include_all:true,items:next.map(item=>({item_id:item.id,quantity:1}))});
    assert.equal((await api(scope+'/orders/'+whole.id)).items.length,2);
    db.run(`INSERT INTO work_items(document_id,party_id,project,description,item_count,width_cm,height_cm,total_quantity,quantity,unit,unit_code,rate,gross_total,net_total)
      VALUES(?,?,?,'Shared sliding opening',1,150,175,1,1,'Pcs','count',100,100,100)`,[third,customer.id,project.name]);
    const updatedSource=await api(scope+'/source-refresh?document_id='+third);
    await api(scope+'/source-refresh','POST',{document_id:third,version:updatedSource.version,fingerprint:updatedSource.fingerprint,confirm:true});
    assert.equal((await api(scope+'/orders/'+whole.id)).items.length,3,'Full-source orders receive newly added source lines on confirmed refresh');
    assert.equal((await api(endpoint)).items.length,125,'Other source orders remain intact');
    await api('/certificates/projects/'+project.id,'PATCH',{name:'Renamed project',address:'Updated site'});
    assert.equal((await api(scope)).project.name,'Renamed project');
    assert.ok((await api(endpoint+'/report','POST',{kind:'manufacturing',classification:'materials',locale:'en'})).html.includes('Updated site'));
    await api('/documents/'+second,'PUT',{project:'Project edited at source'});
    assert.equal((await api(scope)).project.name,'Project edited at source');
    assert.ok((await api(secondPath+'/report','POST',{kind:'manufacturing',classification:'materials',locale:'en'})).html.includes('Project edited at source'));
    // Repair with explicitly approved carry-over only, not a fabricated approval on discovery.
    const fourth=await source(8104,3,'Separate source opening');let more=(await api(scope+'/items?all=1&boq_id='+fourth)).items;
    await api(scope+'/specifications','POST',{remember:false,rows:more.map(item=>({id:item.id,version:item.version,category:'windows',system:'windows-8',technical:{leaves:2,lock_right:'Latch',lock_left:'Handle'}}))});
    const small=await api(scope+'/orders','POST',{source_document_id:fourth,items:[{item_id:more[0].id,quantity:1}]}),smallPath=scope+'/orders/'+small.id;
    for(const stage of [...approvalParts,'manufacturing'])await api(smallPath+'/approvals','POST',{stage,approved:true});
    const ready=await api(smallPath);
    const expanded=await api(smallPath+'/include-remaining','POST',{fingerprint:ready.coverage.fingerprint,copy_approvals:true});
    assert.equal(expanded.items.length,3);assert.equal(expanded.status,'released');
    assert.equal(expanded.stage_approvals.find(stage=>stage.stage==='manufacturing').approved,true);
    assert.equal(db.get('SELECT COUNT(*) n FROM ops_orders WHERE project_id=?',[project.id]).n,4);
    if(process.env.AM_SOURCE_ORDERS_QA_HOOK)await require(process.env.AM_SOURCE_ORDERS_QA_HOOK)({origin,api,user:manager,customer,project,scope,first,items,order,endpoint,other,second,db});
    console.log('125-opening coverage and repair, source-specific orders and refresh, project defaults, metadata and approval preservation passed');
  }finally{global.fetch=realFetch;await new Promise(resolve=>http.close(resolve));app.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});


