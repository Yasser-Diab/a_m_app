const assert=require('node:assert/strict');
module.exports=async({origin,api,db,user,customer,project,scope,endpoint,order,first,second})=>{
 const dir=await api('/certificates/signature-directory');assert.ok(dir.titles.some(title=>title.code==='CEO'&&title.description==='Chief Executive Officer'));
 const directory=await api('/certificates/signature-directory','PUT',{...dir,people:[{id:'ceo',name:'Global Signer',title:'CEO',side:'company'}],defaults:{invoice:['ceo'],manufacturing:['ceo'],loading:['ceo'],delivery:['ceo'],certificate:['ceo']}});assert.equal(directory.version,dir.version+1);
 const material=await api(endpoint+'/report','POST',{kind:'manufacturing',classification:'materials',locale:'en'});assert.ok(material.html.includes('Global Signer'));
 const notes=await api('/project-operations/delivery-notes?q=Shipment');assert.equal(notes.total,2);
 let note=await api('/project-operations/delivery-notes/'+first.id);assert.equal(note.edit_window.editable,true);
 const original=JSON.parse(db.get('SELECT shipment_data FROM ops_loads WHERE id=?',[first.id]).shipment_data);
 const update={version:note.version,loading_date:note.loading_date,driver_name:'Updated Driver',vehicle_plate:'EDIT 1',notes:'Edited within 24 hours',parts:Object.entries(note.amounts).map(([part_id,quantity])=>({part_id,quantity}))};
 await api('/project-operations/delivery-notes/'+first.id,'PATCH',update);note=await api('/project-operations/delivery-notes/'+first.id);assert.equal(note.loading_transport.driver_name,'Updated Driver');assert.equal(note.history.length,1);
 assert.equal(JSON.parse(db.get("SELECT before_json FROM document_edit_history WHERE kind='delivery' AND document_id=? ORDER BY id LIMIT 1",[first.id]).before_json).transport.driver_name,original.transport.driver_name);
 db.run("UPDATE document_edit_locks SET first_locked_at=? WHERE kind='delivery' AND document_id=?",[new Date(Date.now()-25*3600e3).toISOString(),first.id]);
 await api('/project-operations/delivery-notes/'+first.id,'PATCH',{...update,version:note.version},409);
 const corrected=await api('/project-operations/delivery-notes/'+first.id,'PATCH',{...update,version:note.version,correction:true,reason:'Correct vehicle data',driver_name:'Correction Driver'});assert.match(corrected.reference,/-COR-0001$/);
 note=await api('/project-operations/delivery-notes/'+first.id);assert.equal(note.edit_window.editable,true);assert.equal(note.history.filter(row=>row.is_correction).length,1);
 await api(endpoint+'/responsibilities','PATCH',{stage:'installation',version:0,assignees:[{name:'Outside Installer',title:'SE'}]});
 let progress=await api('/project-operations/reports/progress?stages=installation&responsibles=installation');assert.ok(progress.items.some(item=>item.id===project.id));assert.equal(progress.items.find(item=>item.id===project.id).responsibilities.installation[0].name,'Outside Installer');
 const hidden=await api('/project-operations/reports/progress?stages=manufacturing');assert.ok(!hidden.items.some(item=>item.id===project.id));
 await api('/project-operations/progress-preferences','PATCH',{stages:['installation'],responsibles:['installation'],include_completed:true});assert.deepEqual((await api('/project-operations/progress-preferences')).stages,['installation']);
 let installed=await api(endpoint+'/installation');assert.equal(installed.total,3);assert.equal(installed.items[1].loaded,2);
 installed=await api(endpoint+'/installation','PATCH',{installation_date:'2026-11-24',items:installed.items.map((row,i)=>({...row,installed:i?0:1}))});assert.equal(installed.total,3);assert.equal(installed.installed,1);
 await api(endpoint+'/installation','PATCH',{items:installed.items.map(row=>({...row,installed:row.loaded+1}))},400);
 installed=await api(endpoint+'/installation','PATCH',{items:installed.items.map(row=>({...row,installed:row.loaded}))});assert.equal(installed.complete,true);
 await api(endpoint,'PATCH',{status:'closed',reason:'Installation complete'});let closed=await api(endpoint);assert.ok(closed.stage_approvals.find(stage=>stage.stage==='manufacturing').approved);
 assert.ok((await api(endpoint+'/report','POST',{kind:'manufacturing',classification:'manufacturing',locale:'en'})).html.includes('Global Signer'));
 const reopened=await api(endpoint+'/reopen','POST',{reason:'Review details'});assert.equal(reopened.status,'shipped');assert.equal(reopened.loads.length,2);
 // Legacy finalized orders have no lock row yet; use their original finalization audit.
 db.run("DELETE FROM document_edit_locks WHERE kind='order' AND document_id=?",[order.id]);
 const finalized=db.all("SELECT id,created_at FROM ops_audit WHERE entity_id=? AND action IN('production_order_shipped','production_order_closed')",[order.id]);
 for(const row of finalized)db.run('UPDATE ops_audit SET created_at=? WHERE id=?',[new Date(Date.now()-25*3600e3).toISOString(),row.id]);
 await api(endpoint+'/approvals','POST',{stage:'measurement',approved:false},409);
 for(const row of finalized)db.run('UPDATE ops_audit SET created_at=? WHERE id=?',[row.created_at,row.id]);
 db.run("INSERT INTO document_edit_locks VALUES('order',?,?)",[order.id,new Date().toISOString()]);
 db.run("UPDATE document_edit_locks SET first_locked_at=? WHERE kind='order' AND document_id=?",[new Date(Date.now()-25*3600e3).toISOString(),order.id]);await api(endpoint+'/reopen','POST',{reason:'Too late'},409);
 const revision=await api(endpoint+'/reopen','POST',{correction:true,reason:'Approved correction'});assert.match(revision.reference,/-COR-0001$/);assert.equal(revision.loads.length,2);
 const manualBody={project_id:project.id,command_key:require('crypto').randomUUID(),status:'issued',items:[{label:'General item',unit:'Pcs',quantity:2}],loading_date:'2026-11-24'};let manual=await api('/project-operations/loading-orders','POST',manualBody);assert.equal(manual.signatures[0].name,'Global Signer');
 db.run("UPDATE document_edit_locks SET first_locked_at=? WHERE kind='manual_loading' AND document_id=?",[new Date(Date.now()-25*3600e3).toISOString(),manual.id]);await api('/project-operations/loading-orders/'+manual.id,'PATCH',{...manualBody,version:manual.version},409);
 manual=await api('/project-operations/loading-orders/'+manual.id,'PATCH',{...manualBody,version:manual.version,correction:true,reason:'Correct additional quantity',items:[{label:'General item',unit:'Pcs',quantity:3}]});assert.match(manual.edit_window.active_reference,/-COR-0001$/);
 const invoice=await api('/documents/invoice?document_id='+db.get('SELECT source_document_id FROM ops_orders WHERE id=?',[order.id]).source_document_id);assert.ok(invoice.signatures.some(person=>person.name==='Global Signer'));
 const cp=await api('/certificates/projects','POST',{name:'24 hour edit certificate',customer_id:customer.id},201),line={identity:'edit-1',description:'Work',work_type:'Installation',mode:'direct',quantity:10,unit:'Pcs',rate:100,progress:40};
 assert.equal((await api('/certificates/projects/'+cp.id)).settings.settings.signatures[0].name,'Global Signer');
 let certificate=await api('/certificates','POST',{project_id:cp.id,header:{work_to:'2026-11-24'},lines:[line]},201);certificate=await api('/certificates/'+certificate.id+'/action','POST',{action:'approve',version:certificate.version});assert.equal(certificate.edit_window.editable,true);const lock=certificate.edit_window.first_locked_at;
 certificate=await api('/certificates/'+certificate.id,'PUT',{version:certificate.version,header:certificate.header,lines:[{...line,progress:60}]});assert.equal(certificate.totals.current,600);assert.equal(certificate.status,'approved');assert.equal(certificate.edit_window.first_locked_at,lock);
 db.run("UPDATE document_edit_locks SET first_locked_at=? WHERE kind='certificate' AND document_id=?",[new Date(Date.now()-25*3600e3).toISOString(),certificate.id]);await api('/certificates/'+certificate.id,'PUT',{version:certificate.version,lines:[line]},409);
 const correction=await api('/certificates/'+certificate.id+'/action','POST',{action:'revise',version:certificate.version,reason:'After deadline'});assert.equal(correction.type,'correction');
 // Issued edits retain the exact previous PDFs and regenerate the current archive.
 const issuedProject=await api('/certificates/projects','POST',{name:'Issued PDF edit history',customer_id:customer.id},201);
 let issued=await api('/certificates','POST',{project_id:issuedProject.id,header:{work_to:'2026-11-24',locale:'en'},lines:[{...line,identity:'issued-edit',progress:20}]},201);
 issued=await api('/certificates/'+issued.id+'/action','POST',{action:'approve',version:issued.version});
 issued=await api('/certificates/'+issued.id+'/action','POST',{action:'issue',version:issued.version});
 async function ready(id){for(let i=0;i<90;i++){const row=await api('/certificates/'+id);if(row.pdf_status==='ready')return row;if(row.pdf_status==='failed')throw Error('Certificate PDF render failed');await new Promise(resolve=>setTimeout(resolve,500));}throw Error('Certificate PDF render timed out');}
 issued=await ready(issued.id);const oldPdf=await api('/certificates/'+issued.id+'/pdf'),official=issued.official_number;
 issued=await api('/certificates/'+issued.id,'PUT',{version:issued.version,header:issued.header,lines:[{...line,identity:'issued-edit',description:'Updated issued work',progress:30}]});
 issued=await ready(issued.id);assert.equal(issued.status,'issued');assert.equal(issued.official_number,official);assert.equal(issued.totals.current,300);
 const currentPdf=await api('/certificates/'+issued.id+'/pdf');assert.notDeepEqual(currentPdf,oldPdf);
 const versions=await api('/certificates/'+issued.id+'/edit-artifacts'),oldVersion=versions.find(version=>version.variant==='customer');assert.ok(oldVersion);assert.deepEqual(await api('/certificates/'+issued.id+'/edit-artifacts/'+oldVersion.id+'/pdf'),oldPdf);
 if(process.env.AM_CYCLE_PDF_DIR){const fs=require('node:fs/promises'),path=require('node:path');for(const [name,data] of [['native-issued-before.pdf',oldPdf],['native-issued-after.pdf',currentPdf],['native-progress-ar.pdf',await api('/project-operations/reports/progress/pdf','POST',{locale:'ar',responsibles:'installation,manufacturing,loading',include_completed:true})],['native-delivery-ar.pdf',await api('/project-operations/delivery-notes/'+first.id+'/pdf','POST',{locale:'ar'})],['native-manual-previous-en.pdf',await api('/project-operations/loading-orders/'+manual.id+'/pdf','POST',{locale:'en',history_id:manual.document_history[0].id})]])await fs.writeFile(path.join(process.env.AM_CYCLE_PDF_DIR,name),data);}
 const {shipmentMatrix,matrixChanges}=await import('../src/project-operations/shipment-matrix.mjs');const parts=[{part_id:'a',order_item_id:1,description:'A',kind:'frames',unit:'Pcs',remaining:1},{part_id:'b',order_item_id:1,description:'A',kind:'sliding',unit:'Pcs',remaining:2},{part_id:'c',order_item_id:1,description:'A',kind:'sliding_blades',unit:'Pcs',remaining:2},{part_id:'d',description:'General',custom:true,unit:'kg',remaining:10}];const matrix=shipmentMatrix(parts,{});assert.equal(matrix.length,2);assert.deepEqual(matrixChanges(matrix[0],'leaves','true'),[['b',2]]);assert.deepEqual(matrixChanges(matrix[0],'frames','false'),[['a','']]);assert.throws(()=>matrixChanges(matrix[0],'frames',2));
 if(process.env.AM_CYCLE_QA_HOOK)await require(process.env.AM_CYCLE_QA_HOOK)({origin,api,db,user,customer,project,scope,endpoint,order,first,second});
 console.log('Lifecycle: installation and stage owners, filtering, signature defaults, Delivery Note history/corrections, 24 hour certificate/order edits and matrix columns passed.');
};
if(require.main===module){const cp=require('node:child_process');const result=cp.spawnSync(process.execPath,[require.resolve('./test_vehicle_shipments.cjs')],{stdio:'inherit',env:{...process.env,AM_SHIPMENT_QA_HOOK:__filename}});process.exitCode=result.status||0;}
