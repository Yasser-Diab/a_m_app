const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createServer}=require('../server/index.cjs');
async function main(){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'project-accounts-')),app=await createServer({dataDir:dir,dbPath:path.join(dir,'test.db'),port:0}),http=await app.listen(0,'127.0.0.1'),db=app.database;
 const origin='http://127.0.0.1:'+http.address().port,realFetch=global.fetch;let token;
 global.fetch=(url,options)=>String(url).startsWith(origin)?realFetch(url,options):Promise.resolve(Response.json({has_access:true}));
 async function api(route,method='GET',body,status=200){const response=await realFetch(origin+'/api'+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)}),result=response.headers.get('content-type')?.includes('pdf')?Buffer.from(await response.arrayBuffer()):await response.json();assert.equal(response.status,status,route+' '+JSON.stringify(result).slice(0,600));return result;}
 try{
  db.run('INSERT OR REPLACE INTO app_settings(key,value) VALUES(?,?)',['company_profile',JSON.stringify({free_access_until:'2099-01-01T00:00:00Z'})]);
  const password=crypto.randomUUID();db.run('INSERT INTO users(username,display_name,role,pin_hash) VALUES(?,?,?,?)',['accounts-review','Accounts review','manager',crypto.createHash('sha256').update(password).digest('hex')]);
  const user=(await api('/auth/login','POST',{username:'accounts-review',password})).user;token=user.certificate_session;
  const customer=await api('/certificates/customers','POST',{name:'Amorada customer'},201),project=await api('/certificates/projects','POST',{name:'Amorada',customer_id:customer.id},201);
  await api('/certificates/projects/'+project.id+'/settings','PUT',{effective_at:'2026-01-01',expected_version:0,settings:{collections_basis:'received'},rules:[{label:'Advance recovery',category:'advance_recovery',basis:'work',rate:25,enabled:true}]});
  const receipt=await api('/certificates/projects/'+project.id+'/collections','POST',{kind:'advance',amount:196350,received_at:'2026-01-01',command_key:crypto.randomUUID()},201);
  await api('/certificates/projects/'+project.id+'/collections','POST',{kind:'receipt',amount:304000,received_at:'2026-01-02'},201);
  const line={identity:'V',description:'Building V',building_unit:'V',mode:'direct',quantity:470.1,unit:'l.m',rate:1700,progress:100};
  let original=await api('/certificates','POST',{project_id:project.id,header:{type:'final',work_to:'2026-11-23'},lines:[line]},201);
  original=await api('/certificates/'+original.id+'/action','POST',{action:'approve',version:original.version});assert.equal(original.totals.cumulative_payable,298820);
  const body={final_id:original.id,command_key:crypto.randomUUID()},account=await api('/certificates/projects/'+project.id+'/accounts','POST',body,201);assert.equal(account.number,2);
  assert.equal((await api('/certificates/projects/'+project.id+'/accounts','POST',body,201)).id,account.id);assert.equal(db.get('SELECT COUNT(*) n FROM cert_projects').n,1);
  let next=await api('/certificates','POST',{project_id:project.id,header:{account_id:account.id,work_to:'2026-11-23'},lines:[{...line,identity:'N',description:'Building N',building_unit:'N',quantity:194.05,unit:'m',rate:800}]},201);
  assert.equal(next.project.name,'Amorada #2');assert.equal(next.certificate_number,1);assert.equal(next.baseline,null);assert.equal(next.lines.length,1);assert.equal(next.receipts.length,0);assert.equal(next.totals.cumulative_payable,155240);assert.equal(next.totals.advance_recovery,0);
  assert.equal((await api('/certificates/projects/'+project.id+'/carry-forward?account_id='+account.id+'&work_to=2026-11-24')).lines.length,0);
  assert.equal((await api('/certificates/projects/'+project.id+'/sources?account_id='+account.id)).certificates.length,0);
  await api('/certificates/projects/'+project.id+'/collections','POST',{kind:'receipt',amount:1000,account_id:account.id,received_at:'2026-11-24'},201);
  await api('/certificates/projects/'+project.id+'/collections','POST',{kind:'receipt',amount:2000,received_at:'2026-11-24'},201);
  const scoped=await api('/certificates/projects/'+project.id+'/collections?account_id='+account.id+'&cutoff=2026-11-24');assert.equal(scoped.ordinary_collections,1000);assert.equal(scoped.advances.length,0);
  next=await api('/certificates/'+next.id,'PUT',{version:next.version,header:{...next.header,work_to:'2026-11-24',collection_cutoff:'2026-11-24'},lines:[{...line,identity:'N',description:'Building N',building_unit:'N',quantity:194.05,rate:800}]});assert.equal(next.totals.cumulative_payable,154240);
  const old=await api('/certificates/'+original.id);assert.equal(old.totals.cumulative_payable,298820);
  await api('/certificates/projects/'+project.id+'/collections','POST',{kind:'reversal',reverses_id:receipt.id,received_at:'2026-11-24',account_id:account.id,reference:'Reverse original'},201);
  assert.equal(db.get('SELECT account_id FROM cert_receipts WHERE reverses_id=?',[receipt.id]).account_id,null);
  const customer2=await api('/certificates/customers','POST',{name:'Other customer'},201);await api('/certificates/projects','POST',{name:'Amorada',customer_id:customer2.id},201);
  const options=await api('/certificates/projects?q=Amorada');assert.equal(options.length,2);assert.ok(options.every(row=>row.customer_name));assert.equal((await api('/certificates/projects?q=Other%20customer')).length,1);
  const foreign=await api('/certificates/projects','POST',{name:'Unrelated',customer_id:customer.id},201);await api('/certificates','POST',{project_id:foreign.id,header:{account_id:account.id},lines:[]},404);
  assert.equal(db.all('PRAGMA foreign_key_check').length,0);
  if(process.env.AM_ACCOUNTS_QA_HOOK)await require(process.env.AM_ACCOUNTS_QA_HOOK)({origin,api,db,user,customer,project,original,account,next});
  console.log('Independent project accounts: fresh #2 numbering, balances, advances, payments, reversal ownership, sources, customer search and preserved original final certificate passed.');
 }finally{global.fetch=realFetch;await new Promise(resolve=>http.close(resolve));app.close();await fs.rm(dir,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
