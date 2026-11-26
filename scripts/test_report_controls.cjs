const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const pageSetup=require('../server/report-page-setup.cjs');
module.exports=async context=>{
 const {api,db,user,project,customer,inspection,ir,mappedRequest,endpoint,first,manualShipment}=context;
 const base='/project-operations/inspections',asset=db.get("SELECT id FROM inspection_assets WHERE name='Returned.pdf'");
 let draft=await api(base+'/requests/'+ir.id+'/attachments','POST',{version:ir.version,asset_id:asset.id});
 assert.equal(draft.attachments.length,1);await api(base+'/requests/'+draft.id+'/attachments/remove','POST',{version:draft.version-1,asset_id:asset.id},409);
 draft=await api(base+'/requests/'+draft.id+'/attachments/remove','POST',{version:draft.version,asset_id:asset.id});assert.equal(draft.attachments.length,0);assert.equal(draft.status,'draft');assert.ok(db.get('SELECT id FROM inspection_assets WHERE id=?',[asset.id]),'Removing a document link must preserve its archived asset');
 const event=db.get("SELECT snapshot FROM inspection_events WHERE request_id=? AND action='attachment_removed'",[draft.id]);assert.equal(JSON.parse(event.snapshot).attachments.length,1);
 await api(base+'/requests/'+inspection.id+'/attachments/remove','POST',{version:inspection.version,asset_id:asset.id},409);
 const info=await api(base+'/assets/'+asset.id+'/info?project_id='+project.id);assert.equal(info.name,'Returned.pdf');assert.equal(info.content,undefined);
 const fresh=await api(base+'/requests','POST',{project_id:project.id,kind:'MIR',command_key:crypto.randomUUID(),data:{values:{subject:'Attachment edit test'}},rows:[{id:'a',description:'Within edit window',unit:'Pcs',quantity:1}]});
 let issued=await api(base+'/requests/'+fresh.id+'/attachments','POST',{version:fresh.version,asset_id:asset.id});issued=await api(base+'/requests/'+issued.id+'/action','POST',{action:'submit',version:issued.version});
 issued=await api(base+'/requests/'+issued.id+'/action','POST',{action:'respond',version:issued.version,action_code:'A',accepted:{a:1},reviewer:'Attachment reviewer'});
 issued=await api(base+'/requests/'+issued.id+'/attachments/remove','POST',{version:issued.version,asset_id:asset.id});assert.equal(issued.status,'draft');assert.equal(issued.attachments.length,0);assert.equal(issued.rows[0].accepted,undefined);assert.equal(issued.data.action_code,'');
 const quote=db.run("INSERT INTO documents(document_type,document_no,operation_no,status,party_id,party_role,project,customer_name) VALUES('price_offer',8808,'008808','draft',?,'customer',?,?)",[customer.id,project.name,customer.name]).lastInsertRowid;
 db.run("INSERT INTO work_items(document_id,party_id,project,description,item_count,total_quantity,quantity,unit,unit_code,rate,gross_total,net_total,entry_date) VALUES(?,?,?,'QUOTATION MARKER',3,3,3,'Pcs','count',100,300,300,'2026-11-26')",[quote,customer.id,project.name]);
 db.run('UPDATE work_items SET accounting_status=? WHERE document_id=?',[require('../server/domain.cjs').STATUS.OFFER,quote]);
 const image={name:'Customer mark.png',data_uri:'data:image/png;base64,'+fs.readFileSync(path.join(__dirname,'../build/variants/main.png')).toString('base64')};
 let logos=await api('/report-logos?document_id='+quote+'&scope=customer');assert.equal(logos.version,0);
 await api('/report-logos','POST',{document_id:quote,scope:'customer',version:0,data:{enabled:true,logos:{customer:image}}});
 logos=await api('/report-logos?document_id='+quote+'&scope=project');assert.equal(logos.data.logos.customer.name,image.name);
 await api('/report-logos','POST',{document_id:quote,scope:'project',version:0,data:{enabled:true,logos:{customer:image,project:{...image,name:'Project mark.png'}}}});
 logos=await api('/report-logos?document_id='+quote+'&scope=project');assert.equal(logos.data.logos.project.name,'Project mark.png');assert.equal(logos.version,1);
 await api('/report-logos','POST',{document_id:quote,scope:'project',version:0,data:{enabled:false,logos:{}}},409);
 const access={all_projects:true,project_ids:[],user},document=db.get('SELECT * FROM documents WHERE id=?',[quote]);
 const logoService=require('../server/report-logos.cjs');assert.equal(logoService.report(db,access,document,{show_logos:'0'}).enabled,false);assert.ok(logoService.html(logoService.report(db,access,document,{show_logos:'1'})).includes('report-logo-set'));
 const otherProject=db.run("INSERT INTO documents(document_type,document_no,operation_no,status,party_id,party_role,project,customer_name) VALUES('price_offer',8809,'008809','draft',?,'customer','Quotation-only project',?)",[customer.id,customer.name]).lastInsertRowid;
 db.run("INSERT INTO work_items(document_id,party_id,project,description,item_count,total_quantity,quantity,unit,unit_code,rate,gross_total,net_total,entry_date,accounting_status) SELECT ?,party_id,'Quotation-only project','SECOND QUOTE',item_count,total_quantity,quantity,unit,unit_code,rate,gross_total,net_total,entry_date,accounting_status FROM work_items WHERE document_id=?",[otherProject,quote]);
 await api('/report-logos','POST',{document_id:otherProject,scope:'project',version:0,data:{enabled:true,logos:{project:image}}});assert.equal((await api('/report-logos?document_id='+otherProject)).data.logos.project.name,image.name,'Project logos also work before an operating project is created');
 db.run("DELETE FROM report_logo_profiles WHERE scope='customer' AND scope_id=?",[customer.id]);assert.equal((await api('/report-logos?document_id='+otherProject+'&scope=customer')).data.logos.project,undefined,'A customer-wide form must not inherit one project’s logo set');
 assert.equal(pageSetup.normalize(null),null);assert.throws(()=>pageSetup.normalize({paper:'A4',margins:{left:120,right:120}}),/40 mm/);assert.throws(()=>pageSetup.normalize('{bad'),/Invalid/);
 const setup=pageSetup.normalize({paper:'A3',orientation:'landscape',margins:{top:21,right:25,bottom:28,left:17}});assert.equal(setup.width,420);assert.equal(setup.height,297);
 if(process.env.AM_REPORT_CONTROLS_ARTIFACTS){
  const root=process.env.AM_REPORT_CONTROLS_ARTIFACTS;fs.mkdirSync(root,{recursive:true});const results=[],{PDFDocument}=require('pdf-lib');
  async function verify(name,route,body){const separator=route.includes('?')?'&':'?';const data=await api(body?route:route+separator+'page_setup='+encodeURIComponent(JSON.stringify(setup)),body?'POST':'GET',body?{...body,page_setup:setup}:undefined);const pdf=await PDFDocument.load(data);assert.ok(pdf.getPageCount()>0);for(const page of pdf.getPages()){assert.ok(Math.abs(page.getWidth()-420*72/25.4)<2,name+' width');assert.ok(Math.abs(page.getHeight()-297*72/25.4)<2,name+' height');}fs.writeFileSync(path.join(root,name+'.pdf'),data);results.push({name,pages:pdf.getPageCount()});return data;}
  await verify('quotation','/documents/offer/pdf?document_id='+quote+'&show_logos=1');
  const invoice=db.get("SELECT id FROM documents WHERE document_type='invoice' AND party_id=?",[customer.id]);await verify('invoice','/documents/invoice/pdf?document_id='+invoice.id);
  await verify('statement','/documents/statement/pdf?party_id='+customer.id);
  await verify('productive','/productive-quantities/pdf?period=year&year=2026');
  await verify('work-order',endpoint+'/pdf',{kind:'manufacturing',classification:'manufacturing',locale:'en'});
  await verify('loading-order',endpoint+'/pdf',{kind:'loading',locale:'ar'});
  await verify('delivery-note',endpoint+'/shipments/'+first.id+'/pdf',{locale:'en'});
  await verify('manual-delivery','/project-operations/delivery-notes/'+manualShipment.id+'/pdf',{locale:'ar'});
  await verify('progress','/project-operations/reports/progress/pdf',{locale:'en'});
  await verify('quantities','/project-operations/reports/quantities/pdf',{locale:'en',mode:'project',project_id:project.id});
  await verify('retentions','/certificates/retentions/pdf',{locale:'en'});
  const before=await api(base+'/requests/'+inspection.id+'/pdf','POST',{locale:'en'});await verify('mir',base+'/requests/'+inspection.id+'/pdf',{locale:'en'});assert.deepEqual(before,await api(base+'/requests/'+inspection.id+'/pdf','POST',{locale:'en'}),'Custom print settings must preserve the canonical archived PDF');
  await verify('mapped-mir',base+'/requests/'+mappedRequest.id+'/pdf',{locale:'ar'});
  const renderer=require('../server/certificate-documents.cjs'),line={id:'c',mode:'direct',work_type:'Windows',description:'CERTIFICATE MARKER',quantity:3,unit:'Pcs',rate:100,previous:0,current:150,cumulative:150,progress:50};
  const model=renderer.buildCertificateDocument({header:{locale:'en',currency:'EGP'},issuer:{name:'Company'},project:{name:project.name},customer:{name:customer.name},lines:[line],totals:{current:150,cumulative:150,current_payable:150,cumulative_payable:150}});model.pageSetup=setup;const certificate=await renderer.renderCertificatePdf(model);const parsed=await PDFDocument.load(certificate.buffer);assert.ok(Math.abs(parsed.getPage(0).getWidth()-420*72/25.4)<2);fs.writeFileSync(path.join(root,'certificate.pdf'),certificate.buffer);results.push({name:'certificate',pages:parsed.getPageCount()});
  fs.writeFileSync(path.join(root,'verification.json'),JSON.stringify({setup,results},null,2));
 }
 if(process.env.AM_REPORT_CONTROLS_QA_HOOK)await require(process.env.AM_REPORT_CONTROLS_QA_HOOK)({...context,quote,logos});
 assert.equal(db.all('PRAGMA foreign_key_check').length,0);console.log('Report controls: editable attachment removal, immutable history, saved logo metadata, quotation scopes, paper settings and archived PDF isolation passed.');
};
if(require.main===module){const result=require('node:child_process').spawnSync(process.execPath,[require.resolve('./test_inspections.cjs')],{stdio:'inherit',env:{...process.env,AM_INSPECTION_QA_HOOK:__filename}});process.exitCode=result.status||0;}
