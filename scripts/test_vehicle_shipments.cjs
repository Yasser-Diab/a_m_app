const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createServer}=require('../server/index.cjs');
const {shipmentData,shipmentRows,shipmentReport}=require('../server/project-operations/shipment-report.cjs');
async function main(){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'vehicle-shipment-')),app=await createServer({dataDir:directory,dbPath:path.join(directory,'test.db'),port:0}),http=await app.listen(0,'127.0.0.1'),db=app.database;
 const origin='http://127.0.0.1:'+http.address().port,realFetch=global.fetch;let token;
 global.fetch=(url,options)=>String(url).startsWith(origin)?realFetch(url,options):Promise.resolve(Response.json({has_access:true}));
 async function api(route,method='GET',body,status=200){const response=await realFetch(origin+'/api'+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});const result=response.headers.get('content-type')?.includes('pdf')?Buffer.from(await response.arrayBuffer()):await response.json();assert.equal(response.status,status,route+' '+JSON.stringify(result).slice(0,500));return result;}
 try{
  db.run('INSERT OR REPLACE INTO app_settings(key,value) VALUES(?,?)',['company_profile',JSON.stringify({free_access_until:'2099-01-01T00:00:00Z'})]);
  const password=crypto.randomUUID();db.run('INSERT INTO users(username,display_name,role,pin_hash) VALUES(?,?,?,?)',['shipment-review','Shipment review','manager',crypto.createHash('sha256').update(password).digest('hex')]);
  const user=(await api('/auth/login','POST',{username:'shipment-review',password})).user;token=user.certificate_session;
  const customer=await api('/certificates/customers','POST',{name:'Shipment customer'},201),project=await api('/certificates/projects','POST',{name:'Shipment project',customer_id:customer.id},201);
  const document=db.run("INSERT INTO documents(document_type,document_no,operation_no,status,party_id,party_role,project,customer_name) VALUES('invoice',7701,'007701','draft',?,'customer',?,?)",[customer.id,project.name,customer.name]).lastInsertRowid;
  for(const [description,count] of [['Complete window',1],['Partial door',2]])db.run("INSERT INTO work_items(document_id,party_id,project,description,item_count,width_cm,height_cm,total_quantity,quantity,unit,unit_code,rate,gross_total,net_total) VALUES(?,?,?,?,?,100,150,?,?, 'Pcs','count',100,100,100)",[document,customer.id,project.name,description,count,count,count]);
  db.run("UPDATE work_items SET building_unit='Building B-41' WHERE document_id=?",[document]);
  await api('/documents/'+document,'PUT',{status:'approved'});const scope='/project-operations/projects/'+project.id;await api(scope,'POST',{boq_id:document});
  const catalogue=await api('/project-operations/catalogue');
  for(const name of ['باب جرار','باب مفصلي','باب جرار مع ثابت علوي','باب مفصلي مع ثابت علوي وجانبي'])assert.ok(catalogue.categories.find(c=>c.id==='doors').systems.some(s=>s.ar===name),name);
  const items=(await api(scope+'/items')).items;
  await api(scope+'/specifications','POST',{remember:false,rows:items.map((item,index)=>({id:item.id,version:item.version,category:index?'doors':'windows',system:index?'doors-28':'windows-8',technical:{...item.technical,leaves:2,fixed_panels:index?1:null,profile:'Approved section',viewing:'Inside',lock_right:'Right handle',lock_left:'Left handle',glass_type:'Tempered',infill:'6 mm clear',width_mm:1000,height_mm:1500}}))});
  const order=await api(scope+'/orders','POST',{items:items.map(item=>({item_id:item.id,quantity:item.technical.quantity}))}),endpoint=scope+'/orders/'+order.id;
  for(const stage of catalogue.approvalParts)await api(endpoint+'/approvals','POST',{stage,approved:true});
  await api(endpoint+'/approvals','POST',{stage:'manufacturing',approved:true});
  let details=await api(endpoint),opening=details.items[0],other=details.items[1];
  assert.equal(details.balances.find(p=>p.order_item_id===opening.id&&p.kind==='sliding_blades').required,2);
  assert.equal(details.balances.find(p=>p.order_item_id===other.id&&p.kind==='sliding_blades').required,4);
  const settings={enabled:true,version:0,rows:[{id:'handles',order_item_id:opening.id,per_opening:true,label:'Opening handles',unit:'Pcs',quantity:1},{id:'packing',label:'Packing material',unit:'kg',quantity:10}]};
  await api(endpoint+'/loading-settings','PATCH',settings);details=await api(endpoint+'/shipment-preparation','POST',{});
  const firstParts=details.parts.filter(p=>p.order_item_id===opening.id).map(p=>({part_id:p.part_id,quantity:p.remaining}));
  firstParts.push({part_id:other.id+':frames',quantity:1},{part_id:'extra:packing',quantity:2.5});
  const body={command_key:crypto.randomUUID(),reference:details.loading_reference,vehicle_plate:'ABC 123',driver_name:'Vehicle One Driver',responsible:{loading:'Dispatch lead'},parts:firstParts};
  await api(endpoint+'/shipment','POST',body,409);assert.equal(db.get('SELECT COUNT(*) n FROM ops_loads').n,0);
  await api(endpoint+'/approvals','POST',{stage:'pre_shipment',approved:true});
  const first=await api(endpoint+'/shipment','POST',body);assert.equal(first.status,'released');
  assert.equal((await api(endpoint+'/shipment','POST',body)).id,first.id);assert.equal(db.get('SELECT COUNT(*) n FROM ops_loads').n,1);
  const snapshot=shipmentData(db,order,first.id),rows=shipmentRows(snapshot);assert.equal(rows.filter(row=>row.complete).length,1);assert.equal(rows[0].progress,100);assert.equal(rows[0].quantity,1);
  assert.equal(rows.filter(row=>row.item?.id===other.id).length,1);assert.equal(rows.find(row=>row.item?.id===other.id).kind,'frames');assert.ok(rows.find(row=>row.item?.id===other.id).progress>0&&rows.find(row=>row.item?.id===other.id).progress<100);
  assert.deepEqual(rows.map(row=>row.tag),['1','2','3']);
  const tagged=structuredClone(snapshot);tagged.items[0].specification.technical.tag='W-01';assert.deepEqual(shipmentRows(tagged).map(row=>row.tag),['W-01','','']);
  tagged.items[1].specification.technical.tag='D-02';assert.deepEqual(shipmentRows(tagged).map(row=>row.tag),['W-01','D-02','']);
  assert.equal(snapshot.transport.driver_name,'Vehicle One Driver');assert.equal(rows.find(row=>row.part_id==='extra:packing').quantity,2.5);
  const source=require('../server/project-operations/core.cjs').operation(db,project.id),html=shipmentReport(db,source,order,first.id,'en',{}).html;
  assert.ok(html.includes('Delivery Note ')&&html.includes('<th><bdi dir="auto">Tag</bdi></th>'));
  assert.ok(html.includes('Only the load on this vehicle')&&html.includes('100%')&&html.includes('ABC 123'));
  assert.ok(html.includes('Building B-41')&&html.includes('Building / sector'));
  assert.equal((html.match(/class="group-subtotal"/g)||[]).length,2);
  assert.ok(html.includes('Complete opening area m²')&&html.includes('1.5')&&html.includes('Partially loaded openings'));
  const plan=require('../server/project-operations/reports.cjs').report(db,source,order,{kind:'loading',locale:'en'},{}).html;
  const work=require('../server/project-operations/reports.cjs').report(db,source,require('../server/project-operations/production.cjs').order(db,project.id,order.id),{kind:'manufacturing',classification:'manufacturing',locale:'en'},{}).html;
  for(const output of [plan,work]){assert.ok(output.includes('Building B-41'));assert.equal((output.match(/class="group-subtotal"/g)||[]).length,2);assert.ok(output.includes('Estimated area m²'));}
  const originalSnapshot=db.get('SELECT shipment_data FROM ops_loads WHERE id=?',[first.id]).shipment_data;
  const regrouped={...snapshot,items:[...snapshot.items,{...snapshot.items[0],id:999999}],parts:[],lines:[]};
  for(const item of regrouped.items){regrouped.parts.push({part_id:item.id+':frames',order_item_id:item.id,kind:'frames',unit:'Pcs',required:1});regrouped.lines.push({part_id:item.id+':frames',quantity:1});}
  db.run('UPDATE ops_loads SET shipment_data=? WHERE id=?',[JSON.stringify(regrouped),first.id]);
  const regroupedHtml=shipmentReport(db,source,order,first.id,'en',{}).html;
  assert.deepEqual([...regroupedHtml.matchAll(/<tr><td><bdi dir="ltr">(\d+)<\/bdi><\/td><td>/g)].map(match=>match[1]),['1','2','3'],'Serial numbers follow displayed specification groups');
  db.run('UPDATE ops_loads SET shipment_data=? WHERE id=?',[originalSnapshot,first.id]);
  assert.ok(!html.includes('Sliding blades')&&!html.includes('Remaining'),'Unloaded components and balances must not appear');
  await api(endpoint+'/loading-settings','PATCH',{...settings,version:1,rows:[]},409);
  await api(endpoint+'/shipment','POST',{...body,command_key:crypto.randomUUID(),reference:'OVERLOAD',parts:[{part_id:other.id+':frames',quantity:999}]},409);
  assert.equal(db.get('SELECT COUNT(*) n FROM ops_loads').n,1);
  const next=await api(endpoint+'/shipment-preparation','POST',{});assert.notEqual(next.loading_reference,first.reference);
  assert.equal(next.parts.find(part=>part.part_id==='extra:packing').remaining,7.5);
  const second=await api(endpoint+'/shipment','POST',{command_key:crypto.randomUUID(),reference:next.loading_reference,driver_name:'Vehicle Two Driver',vehicle_plate:'XYZ 456',responsible:{loading:'Dispatch lead'},parts:next.parts.filter(p=>p.remaining>0).map(p=>({part_id:p.part_id,quantity:p.remaining}))});
  assert.equal(second.status,'shipped');assert.equal((await api(endpoint)).parts.every(p=>p.remaining===0),true);
  assert.equal(new Set(shipmentRows(shipmentData(db,order,second.id)).filter(row=>row.item).map(row=>row.tag)).size,1);
  assert.equal(shipmentData(db,order,first.id).transport.driver_name,'Vehicle One Driver');assert.ok(!shipmentReport(db,source,order,second.id,'en',{}).html.includes('Complete window'),'Previously shipped openings must not reappear on the next vehicle report');
  assert.equal(db.all('PRAGMA foreign_key_check').length,0);
  if(process.env.AM_SHIPMENT_QA_HOOK)await require(process.env.AM_SHIPMENT_QA_HOOK)({origin,api,user,customer,project,scope,endpoint,order,first,second,db,app});
  db.run("UPDATE ops_projects SET details=json_set(details,'$.status','موقوف') WHERE project_id=?",[project.id]);
  db.transaction(()=>require('../server/project-operations/document-deletion.cjs').deleteDocumentEverywhere(db,db.get('SELECT * FROM documents WHERE id=?',[document]),user));
  assert.equal(db.get('SELECT id FROM documents WHERE id=?',[document]),null);
  assert.equal(db.get('SELECT COUNT(*) n FROM ops_load_parts').n,0);assert.equal(db.get('SELECT COUNT(*) n FROM ops_loads').n,0);
  assert.equal(db.all('PRAGMA foreign_key_check').length,0,'Invoice removal also deletes linked custom parts and Delivery Notes');
  console.log('Vehicle shipment checkboxes data, sliding blades, scoped custom parts, partial/complete truck-only reports, QC gates, idempotency and history passed.');
 }finally{global.fetch=realFetch;await new Promise(resolve=>http.close(resolve));app.close();await fs.rm(directory,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
