const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createServer}=require('../server/index.cjs');
const {calculateValuation}=require('../server/certificate-valuation.cjs');
const {cleanRules}=require('../server/certificate-projects.cjs');
const {buildCertificateDocument,writeCertificateXlsx}=require('../server/certificate-documents.cjs');
const {buildCertificateHtml}=require('../server/certificate-document-html.cjs');
const {cleanTechnical,configuration,fieldsFor}=require('../server/project-operations/specifications.cjs');
const ExcelJS=require('exceljs');
const rule={category:'works_insurance',label:'تأمينات الأعمال',rate:10};
const line={identity:'one',mode:'direct',description:'Window',unit:'Pcs',quantity:10,rate:100,recognition:'cumulative'};
const ledger=()=>({ordinary_minor:0,period_ordinary_minor:0,advances:[]});
const calculate=(lines,baseline,rules=[rule])=>calculateValuation(lines,baseline,{version:1,settings:{},rules:cleanRules(rules)},ledger());
async function main(){
  const first=calculate([{...line,progress:50}],null);assert.equal(first.totals.current_payable,450);assert.equal(first.totals.holds[0].balance,50);
  const next=calculate([{...line,progress:95}],first);assert.equal(next.totals.current_payable,405);assert.equal(next.totals.holds[0].balance,95);
  const final=calculate([{...line,progress:100}],next);assert.equal(final.totals.current,50);assert.equal(final.totals.current_payable,145);
  assert.equal(final.totals.holds[0].balance,0);assert.equal(final.totals.cumulative_earned,1000);
  const capped=calculate([{...line,progress:100},{...line,identity:'two',progress:50}],null,[{...rule,cap:50}]);
  assert.equal(capped.totals.holds[0].balance,50); // Cap applies after excluding completed work.
  const mixed=calculate([{...line,progress:50},{...line,identity:'two',progress:50}],null);
  const partial=calculate([{...line,progress:100},{...line,identity:'two',progress:80}],mixed);
  assert.equal(partial.totals.holds[0].lines.find(l=>l.identity==='one').balance,0);
  assert.equal(partial.totals.holds[0].lines.find(l=>l.identity==='two').balance,80);
  assert.equal(partial.totals.current_payable,820);
  for(const r of [{...rule,collection_date:'2026-01-01'},{...rule,category:'final_insurance'}]){
    const held=calculate([{...line,progress:100}],null,[r]);assert.equal(held.totals.current_payable,900);assert.equal(held.totals.holds[0].balance,100);
  }
  assert.throws(()=>cleanRules([{...rule,key:'same'},{...rule,key:'same'}]),/distinct/);
  assert.throws(()=>cleanRules([{...rule,collection_date:'2026-02-30'}]),/calendar/);
  const temp=fs.mkdtempSync(path.join(process.env.AM_TEST_TEMP||os.tmpdir(),'easycommercial-retentions-'));
  const app=await createServer({dataDir:temp,dbPath:path.join(temp,'test.db'),port:0}),http=await app.listen(0,'127.0.0.1'),db=app.database;
  const origin='http://127.0.0.1:'+http.address().port,realFetch=global.fetch;
  global.fetch=(url,options)=>String(url).startsWith(origin)?realFetch(url,options):Promise.resolve(Response.json({has_access:true}));
  let token;
  const api=async(route,method='GET',body,status=200,session=token)=>{
    const response=await realFetch(origin+'/api'+route,{method,headers:{'Content-Type':'application/json',...(session?{Authorization:'Bearer '+session}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    const data=response.headers.get('content-type')?.includes('application/pdf')?Buffer.from(await response.arrayBuffer()):await response.json();
    assert.equal(response.status,status,method+' '+route+' '+JSON.stringify(data).slice(0,500));return data;
  };
  try{
    db.run('INSERT OR REPLACE INTO app_settings(key,value) VALUES(?,?)',['company_profile',JSON.stringify({free_access_until:'2099-01-01T00:00:00Z'})]);
    const password=crypto.randomBytes(20).toString('hex'),hash=crypto.createHash('sha256').update(password).digest('hex');
    for(const [name,role]of [['retention-manager','manager'],['retention-viewer','user']])db.run('INSERT INTO users(username,display_name,role,pin_hash) VALUES(?,?,?,?)',[name,name,role,hash]);
    const manager=(await api('/auth/login','POST',{username:'retention-manager',password})).user;token=manager.certificate_session;
    const viewer=(await api('/auth/login','POST',{username:'retention-viewer',password})).user;
    const c='/certificates',customer=await api(c+'/customers','POST',{name:'عميل التأمينات'},201);
    const project=await api(c+'/projects','POST',{customer_id:customer.id,name:'مشروع التأمينات',customer_project_code:'CLIENT-2026-17'},201);
    const scope=c+'/projects/'+project.id;
    const customerCount=db.get('SELECT COUNT(*) AS n FROM parties').n,projectCount=db.get('SELECT COUNT(*) AS n FROM cert_projects').n;
    const saved=await api(c+'/customers/'+customer.id,'PUT',{tax_no:'123-456-789',address:'المقر الرئيسي — القاهرة',commercial_registration:'CR-55',legal_name:'الشركة التجريبية',email:'private@example.test'});
    assert.equal(saved.commercial_registration,'CR-55');assert.equal(saved.code,customer.code);
    assert.equal((await api(scope,'PATCH',{customer_project_code:'CLIENT-UPDATED',address:'Site address'})).code,project.code);
    assert.equal((await api(c+'/projects?q=CLIENT-UPDATED'))[0].id,project.id);
    assert.equal((await api('/project-operations/projects?q=CLIENT-UPDATED')).items[0].id,project.id);
    assert.equal(db.get('SELECT COUNT(*) AS n FROM parties').n,customerCount);assert.equal(db.get('SELECT COUNT(*) AS n FROM cert_projects').n,projectCount);
    await api(c+'/retentions','GET',undefined,401,'');await api(c+'/retentions','GET',undefined,403,viewer.certificate_session);
    await api(c+'/customers/'+customer.id,'PUT',{},403,viewer.certificate_session);
    const defaults=cleanTechnical(db,'windows',configuration(db,'windows','windows-8'),{leaves:2,slide_direction:'Left',trim_type:'بومبيه',trim_size_cm:5});
    assert.equal(defaults.viewing,'Inside');assert.equal(defaults.perimeter.length,4);assert.equal(defaults.trim_size_cm,5);
    assert.equal(cleanTechnical(db,'windows',configuration(db,'windows','windows-8'),{perimeter:[]}).perimeter.length,0);
    assert.equal(cleanTechnical(db,'windows',configuration(db,'windows','windows-8'),{perimeter:null,viewing:null}).viewing,null);
    assert.ok(!fieldsFor('windows',configuration(db,'windows','windows-8'),{perimeter:[]}).some(field=>field.key==='trim_type'));
    assert.equal(configuration(db,'windows','windows-7').ar,'قلاب عادي');
    db.run("UPDATE ops_systems SET ar=en WHERE id='windows-7'");assert.equal(configuration(db,'windows','windows-7').ar,'قلاب عادي');
    const settings=await api(scope+'/settings','PUT',{expected_version:0,effective_at:'2026-01-01',rules:[rule],settings:{}});
    const draft=await api(c,'POST',{project_id:project.id,header:{work_to:'2026-01-01'},lines:[{...line,progress:50}]},201);
    await api(c+'/'+draft.id+'/action','POST',{action:'approve',version:draft.version});
    // Simulate a genuine pre-feature frozen document, preserving its original values.
    const old=JSON.parse(db.get('SELECT snapshot_json FROM cert_revisions WHERE id=?',[draft.id]).snapshot_json);delete old.totals.holds;
    for(const component of old.totals.components){delete component.previous;delete component.cumulative;delete component.rule_key;}
    const oldJson=JSON.stringify(old);db.run('UPDATE cert_revisions SET snapshot_json=? WHERE id=?',[oldJson,draft.id]);
    const second=await api(c,'POST',{project_id:project.id,header:{work_to:'2026-02-01'},lines:[{...line,progress:100}]},201);
    assert.equal(second.totals.current_payable,550);assert.equal(second.totals.cumulative_earned,1000);
    assert.equal(db.get('SELECT snapshot_json FROM cert_revisions WHERE id=?',[draft.id]).snapshot_json,oldJson);
    await api(c+'/'+second.id+'/action','POST',{action:'approve',version:second.version});
    const scheduled=await api(c+'/projects','POST',{customer_id:customer.id,name:'Scheduled retention'},201),scheduledScope=c+'/projects/'+scheduled.id;
    await api(scheduledScope+'/settings','PUT',{expected_version:0,effective_at:'2026-01-01',rules:[{...rule,category:'final_insurance',collection_date:'2026-01-15'}],settings:{}});
    const held=await api(c,'POST',{project_id:scheduled.id,header:{work_to:'2026-01-01'},lines:[{...line,progress:100}]},201);
    await api(c+'/'+held.id+'/action','POST',{action:'approve',version:held.version});
    let report=await api(c+'/retentions');assert.equal(report.records.length,1);assert.equal(report.records[0].outstanding,100);assert.equal(report.records[0].due,true);
    assert.equal((await api(c+'/retentions/notices?locale=en')).events.length,1);
    const internal=buildCertificateDocument(held,{variant:'internal'}),client=buildCertificateDocument(held,{variant:'customer'});
    assert.equal(internal.holds[0].collection_date,'2026-01-15');assert.equal(client.holds.length,0);
    assert.ok(buildCertificateHtml(internal).includes('2026-01-15'));assert.ok(!buildCertificateHtml(client).includes('2026-01-15'));
    for(const [model,has]of [[internal,true],[client,false]]){const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await writeCertificateXlsx(model));assert.equal(Boolean(workbook.getWorksheet(model.locale==='ar'?'المحتجزات':'Retentions')),has);}
    const receipt=await api(scheduledScope+'/collections','POST',{kind:'receipt',amount:900,received_at:'2026-01-02'},201);
    assert.equal((await api(c+'/retentions')).records[0].outstanding,100);
    await api(scheduledScope+'/collections','POST',{kind:'receipt',amount:100,received_at:'2026-01-03'},201);
    assert.equal((await api(c+'/retentions')).records.length,0);assert.equal((await api(c+'/retentions/notices')).events.length,0);
    assert.equal((await api(c+'/retentions?status=all')).records[0].outstanding,0);
    await api(scheduledScope+'/collections','POST',{kind:'reversal',reverses_id:receipt.id,received_at:'2026-01-04'},201);
    assert.equal((await api(c+'/retentions/notices')).events.length,1);
    const advanceProject=await api(c+'/projects','POST',{customer_id:customer.id,name:'Advance-backed retention'},201),advanceScope=c+'/projects/'+advanceProject.id;
    await api(advanceScope+'/settings','PUT',{expected_version:0,effective_at:'2026-01-01',rules:[
      {...rule,category:'final_insurance',collection_date:'2026-01-15'},{category:'advance_recovery',rate:20}],settings:{}});
    const advance=await api(advanceScope+'/collections','POST',{kind:'advance',amount:200,received_at:'2026-01-01'},201);
    const advanced=await api(c,'POST',{project_id:advanceProject.id,header:{work_to:'2026-01-02'},lines:[{...line,progress:100}]},201);
    assert.equal(advanced.totals.current_earned,700);
    await api(c+'/'+advanced.id+'/action','POST',{action:'approve',version:advanced.version});
    await api(advanceScope+'/collections','POST',{kind:'receipt',amount:800,received_at:'2026-01-03'},201);
    assert.equal((await api(c+'/retentions?project_id='+advanceProject.id)).records.length,0);
    await api(advanceScope+'/collections','POST',{kind:'reversal',reverses_id:advance.id,received_at:'2026-01-04'},201);
    assert.equal((await api(c+'/retentions?project_id='+advanceProject.id)).records[0].outstanding,100);
    await api(advanceScope+'/collections','POST',{kind:'receipt',amount:200,received_at:'2026-01-05'},201);
    assert.equal((await api(c+'/retentions?project_id='+advanceProject.id)).records.length,0);
    await api(c+'/admin/users/'+viewer.id,'PUT',{capabilities:['view','view_collections'],project_ids:[project.id]});
    assert.equal((await api(c+'/retentions','GET',undefined,200,viewer.certificate_session)).records.length,0);
    assert.equal(db.get('PRAGMA foreign_key_check'),null);
    if(process.env.AM_RETENTION_QA_HOOK)await require(process.env.AM_RETENTION_QA_HOOK)({origin,api,manager,customer,project,scheduled,held,db,app});
    console.log('Retention releases, historical balances, collection alerts, client privacy, customer data, trim defaults and scoped access passed.');
  }finally{global.fetch=realFetch;await new Promise(resolve=>http.close(resolve));app.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
