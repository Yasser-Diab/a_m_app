const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createServer}=require('../server/index.cjs');
const {buildCertificateDocument,writeCertificateXlsx}=require('../server/certificate-documents.cjs');
const {buildCertificateHtml}=require('../server/certificate-document-html.cjs');
const {cleanReportBody}=require('../server/project-operations/report-edits.cjs');
const ExcelJS=require('exceljs');
async function main(){
  const {selectionStatistics,mergeVisibleRows,reorderVisibleRows,offsetIndex}=await import('../src/table-tools.mjs');
  assert.deepEqual(selectionStatistics(['١٬٢٠٠٫٥٠','-200.5','',null,'name',0]),{count:6,numericCount:3,sum:1000,average:1000/3});
  const rows=[{_gridId:'a',value:1},{_gridId:'hidden',value:7},{_gridId:'b',value:2}];
  assert.equal(mergeVisibleRows(rows,[{...rows[0],value:4},{...rows[2],value:4}])[1],rows[1]);
  assert.deepEqual(reorderVisibleRows(rows,[rows[2],rows[0]]).map(row=>row._gridId),['b','hidden','a']);
  assert.equal(offsetIndex([0,52,200,252],199),1);
  const clean=cleanReportBody('<script>evil()</script><img src="https://bad.test/x"><p onclick="evil()" style="text-align:center;background-image:url(https://bad.test)">Safe</p><iframe src="https://bad.test"></iframe>');
  assert.ok(!/script|iframe|onclick|bad.test/.test(clean));assert.ok(clean.includes('text-align:center'));
  const temp=fs.mkdtempSync(path.join(process.env.AM_TEST_TEMP||os.tmpdir(),'easycommercial-205-'));
  const app=await createServer({dataDir:temp,dbPath:path.join(temp,'test.db'),port:0}),http=await app.listen(0,'127.0.0.1'),db=app.database;
  const origin='http://127.0.0.1:'+http.address().port,realFetch=global.fetch;
  global.fetch=(url,options)=>String(url).startsWith(origin)?realFetch(url,options):Promise.resolve(Response.json({has_access:true}));let token;
  const api=async(route,method='GET',body,status=200,session=token)=>{
    const response=await realFetch(origin+'/api'+route,{method,headers:{'Content-Type':'application/json',...(session?{Authorization:'Bearer '+session}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    const data=response.headers.get('content-type')?.includes('application/pdf')?Buffer.from(await response.arrayBuffer()):await response.json();
    assert.equal(response.status,status,method+' '+route+' '+JSON.stringify(data).slice(0,650));return data;
  };
  try{
    db.run('INSERT OR REPLACE INTO app_settings(key,value) VALUES(?,?)',['company_profile',JSON.stringify({free_access_until:'2099-01-01T00:00:00Z'})]);
    const password=crypto.randomBytes(20).toString('hex'),hash=crypto.createHash('sha256').update(password).digest('hex');
    for(const [name,role]of [['update-manager','manager'],['update-viewer','user']])db.run('INSERT INTO users(username,display_name,role,pin_hash) VALUES(?,?,?,?)',[name,name,role,hash]);
    const manager=(await api('/auth/login','POST',{username:'update-manager',password})).user;token=manager.certificate_session;
    const viewer=(await api('/auth/login','POST',{username:'update-viewer',password})).user;
    const cert='/certificates',customer=await api(cert+'/customers','POST',{name:'Update 205 Customer'},201);
    const project=await api(cert+'/projects','POST',{customer_id:customer.id,name:'Update 205 Project'},201);
    const line={identity:'original',description:'Opening',work_type:'Aluminium',mode:'direct',quantity:10,unit:'Pcs',rate:100,recognition:'cumulative',progress:50};
    let first=await api(cert,'POST',{project_id:project.id,header:{work_to:'2026-01-01',locale:'en'},lines:[line]},201);
    first=await api(cert+'/'+first.id+'/action','POST',{action:'approve',version:first.version});
    const original=db.get('SELECT snapshot_json FROM cert_revisions WHERE id=?',[first.id]).snapshot_json;
    let correction=await api(cert+'/'+first.id+'/action','POST',{action:'revise',version:first.version,reason:'Correct percentage only'});
    assert.equal(correction.lines.length,1);assert.equal(correction.lines[0].carried_forward,undefined);
    assert.equal(correction.lines[0].progress,'50');
    correction=await api(cert+'/'+correction.id,'PUT',{version:correction.version,lines:correction.lines.map(row=>({...row,progress:65}))});
    assert.equal(correction.validation.length,0);assert.equal(correction.totals.current,150);assert.equal(correction.totals.cumulative,650);
    correction=await api(cert+'/'+correction.id,'PUT',{version:correction.version,lines:correction.lines.map(row=>({...row,progress:40,description:'Corrected description'}))});
    assert.equal(correction.validation.length,0);assert.equal(correction.totals.current,-100);assert.equal(correction.totals.cumulative,400);
    await api(cert+'/'+correction.id+'/action','POST',{action:'approve',version:correction.version});
    assert.equal(db.get('SELECT snapshot_json FROM cert_revisions WHERE id=?',[first.id]).snapshot_json,original);
    const fixture={...first,lines:[
      {...first.lines[0],building_unit:'B1',work_type:'Windows',current:10,cumulative:10,billed_quantity:1,count:1},
      {...first.lines[0],id:'two',building_unit:'B1',work_type:'Doors',current:20,cumulative:20,billed_quantity:2,count:2},
      {...first.lines[0],id:'three',building_unit:'B2',work_type:'Windows',current:30,cumulative:30,billed_quantity:3,count:3}]};
    for(const showBuilding of [true,false])for(const showType of [true,false]){
      const model=buildCertificateDocument({...fixture,report_options:{show_summary_building:showBuilding,show_summary_work_type:showType}});
      assert.equal(model.coverRows.reduce((sum,row)=>sum+row.current,0),60);
      assert.equal(model.coverRows.length,showBuilding&&showType?3:showBuilding||showType?2:1);
      if(!showBuilding)assert.ok(!model.coverTextColumns.some(column=>column.key==='building'));
      if(!showType)assert.ok(model.coverRows.every(row=>!row.work_description));
    }
    const hiddenQuantities=buildCertificateDocument({...fixture,report_options:{group_work_types:true,show_work_type_subtotals:true,show_summary_quantities:false,show_detail_quantities:false}});
    const html=buildCertificateHtml(hiddenQuantities);
    const cover=html.match(/<template id="cover-rows">([\s\S]*?)<\/template>/)[1];assert.ok(!cover.includes('quantity-pair'));
    const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await writeCertificateXlsx(hiddenQuantities));
    const detail=workbook.getWorksheet(hiddenQuantities.labels.detail),headers=detail.getRow(1).values;
    const total=detail.getRow(detail.rowCount);assert.equal(total.getCell(headers.indexOf(hiddenQuantities.labels.billed_quantity)).value,null);
    const doc=db.run(`INSERT INTO documents(document_type,document_no,operation_no,status,party_id,party_role,project,customer_name)
      VALUES('invoice',2505,'002505','draft',?,'customer',?,?)`,[customer.id,project.name,customer.display_name]).lastInsertRowid;
    for(const width of [110,130])db.run(`INSERT INTO work_items(document_id,party_id,project,description,item_count,width_cm,height_cm,total_quantity,quantity,unit,unit_code,rate,gross_total,net_total)
      VALUES(?,?,?,'Sliding opening',2,?,150,2,2,'Pcs','count',350,700,700)`,[doc,customer.id,project.name,width]);
    await api('/documents/'+doc,'PUT',{status:'approved'});const scope='/project-operations/projects/'+project.id;
    await api(scope,'POST',{boq_id:doc});let items=(await api(scope+'/items')).items;
    for(const item of items)await api(scope+'/items/'+item.id,'PATCH',{...item,category:'windows',system:'windows-8',technical:{...item.technical,leaves:2,screen:'ضلفة مستقلة'}});
    items=(await api(scope+'/items')).items;
    const order=await api(scope+'/orders','POST',{items:items.map(item=>({item_id:item.id,quantity:2}))}),endpoint=scope+'/orders/'+order.id;
    const options={kind:'loading',locale:'en'},report=await api(endpoint+'/report','POST',options);
    const openingBodies=[...report.html.matchAll(/<tbody class="opening-band-(\d)"[^>]*>([\s\S]*?)<\/tbody>/g)];assert.equal(openingBodies.length,2);
    assert.deepEqual(openingBodies.map(match=>match[1]),['0','1']);
    for(const body of openingBodies)assert.ok(body[2].indexOf('Frames')<body[2].indexOf('Sliding leaves')&&body[2].indexOf('Sliding leaves')<body[2].indexOf('Flyscreen leaves'));
    const originalItems=JSON.stringify((await api(endpoint)).items);
    const draftBody=report.html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)[1].replace('Loading Order','Updated Loading Order').replace(/<section class="order-summary">[\s\S]*?<\/section>/,'')+'<dl><div><dt>Dispatch note</dt><dd>Call site before arrival</dd></div></dl>';
    await api(endpoint+'/report-edits','POST',{...options,version:0,document_ref:report.document_ref,html:draftBody});
    const edited=await api(endpoint+'/report','POST',options);assert.ok(edited.html.includes('Dispatch note'));assert.equal(edited.edit_version,1);
    assert.equal((edited.html.match(/class="order-summary"/g)||[]).length,1,'Add computed totals to older customized reports without discarding manual notes');
    const transport=await api(endpoint+'/loading-transport/prepare','POST',{});
    await api(endpoint+'/loading-transport','PATCH',{document_ref:transport.reference,version:transport.version,driver_name:'Updated driver',vehicle_plate:'GIZA 127'});
    const updatedTransport=await api(endpoint+'/report','POST',options);
    assert.ok(updatedTransport.html.includes('Updated driver')&&updatedTransport.html.includes('Call site before arrival'));
    const legacy=`${customer.code}-${project.code}-LO-0001`;
    db.run('UPDATE ops_loading_orders SET reference=? WHERE order_id=? AND reference=?',[legacy,order.id,transport.reference]);
    db.run('UPDATE ops_report_edits SET document_ref=?,body_html=REPLACE(body_html,?,?) WHERE order_id=?',[legacy,transport.reference,legacy,order.id]);
    db.transaction(()=>require('../server/project-operations/references.cjs').migrateLoadingReferences(db));
    const migrated=db.get('SELECT * FROM ops_loading_orders WHERE order_id=?',[order.id]);
    assert.equal(migrated.reference,transport.reference);assert.equal(migrated.previous_reference,legacy);
    assert.equal(migrated.vehicle_plate,'GIZA 127');
    const migratedReport=await api(endpoint+'/report','POST',options);
    assert.equal(migratedReport.edit_version,1);assert.ok(migratedReport.html.includes('Updated driver')&&migratedReport.html.includes('Call site before arrival'));
    assert.ok(migratedReport.html.includes(migrated.reference)&&!migratedReport.html.includes(legacy));
    await api(endpoint+'/report-edits','POST',{...options,version:0,document_ref:report.document_ref,html:'stale'},409);
    assert.ok(!(await api(endpoint+'/report','POST',{kind:'manufacturing',locale:'en'})).html.includes('Dispatch note'));
    assert.ok(!(await api(endpoint+'/report','POST',{kind:'loading',locale:'ar'})).html.includes('Dispatch note'));
    assert.equal(JSON.stringify((await api(endpoint)).items),originalItems);
    await api('/certificates/admin/users/'+viewer.id,'PUT',{capabilities:['view','ops_view','ops_export'],project_ids:[project.id]});
    await api(endpoint+'/report-edits','POST',{...options,version:1,document_ref:report.document_ref,html:'unauthorized'},403,viewer.certificate_session);
    const editorDraft=await api(cert,'POST',{project_id:project.id,header:{work_to:'2026-12-01',locale:'en'},lines:Array.from({length:2000},(_,i)=>({
      identity:'row-'+i,description:'Opening '+i+' — '+('Long description that must wrap in a narrow column. '.repeat(i<4?12:2)),building_unit:i%2?'B':'A',work_type:'Aluminium',mode:'direct',quantity:1,unit:'Pcs',rate:100,progress:i===0?10:i%2?20:30}))},201);
    if(process.env.AM_205_QA_HOOK)await require(process.env.AM_205_QA_HOOK)({origin,api,manager,customer,project,editorDraft,fixture,endpoint,order,db});
    const latestReport=await api(endpoint+'/report','POST',options);
    await api(endpoint+'/report-edits','POST',{...options,version:latestReport.edit_version,document_ref:report.document_ref,reset:true});
    assert.ok(!(await api(endpoint+'/report','POST',options)).html.includes('Dispatch note'));
    assert.equal(db.get('SELECT COUNT(*) AS n FROM ops_report_edit_history').n>=2,true);assert.equal(db.get('PRAGMA foreign_key_check'),null);
    console.log('2.0.5 correction-only edits, summary aggregation, quantity controls, report edits, loading bands, permissions and table helpers passed.');
  }finally{global.fetch=realFetch;await new Promise(resolve=>http.close(resolve));app.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
