const fs=require('node:fs'),path=require('node:path'),express=require('express');
const {fail,str,scopeSql,parse}=require('../certificate-access.cjs');
const templates=require('./templates.cjs'),records=require('./records.cjs'),sources=require('./sources.cjs'),assets=require('./assets.cjs'),report=require('./report.cjs');
function initialize(db){db.exec(fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8'));templates.initialize(db);}
function register(parent,db,{branding,renderPdf}){
 const router=express.Router();
 const endpoint=(method,url,cap,handler,write=false)=>router[method](url,async(req,res)=>{const access=require('../project-operations/core.cjs').authorizeOperations(db,req,cap);const run=()=>handler(req,access,res);const result=await(write?db.transaction(run):run());if(!res.headersSent)res.json(result);});
 const get=(url,handler)=>endpoint('get',url,'ops_view',handler),post=(url,cap,handler)=>endpoint('post',url,cap,handler,true);
 get('/options',(req,access)=>{const scope=scopeSql(access,'p.id'),q='%'+str(req.query.q,150)+'%';return {projects:db.all(`SELECT p.id,p.name,p.code,p.customer_id,c.display_name customer FROM cert_projects p JOIN parties c ON c.id=p.customer_id WHERE ${scope.clause} AND (p.name LIKE ? OR p.code LIKE ? OR c.display_name LIKE ? OR p.id=?) ORDER BY p.id DESC LIMIT 200`,[...scope.params,q,q,q,Number(req.query.project_id)||0]),fields:templates.fields,columns:templates.columns,action_codes:templates.codes,stages:records.stages};});
 get('/templates',(req,access)=>templates.list(db,access,req.query));
 get('/templates/:id',(req,access)=>templates.get(db,access,req.params.id,req.query.project_id));
 get('/templates/:id/history',(req,access)=>{templates.get(db,access,req.params.id);return db.all('SELECT version,name,config,created_at FROM inspection_template_history WHERE template_id=? ORDER BY version DESC',[req.params.id]).map(row=>({...row,config:parse(row.config)}));});
 post('/templates','ops_edit',(req,access)=>templates.save(db,access,null,req.body));
 endpoint('patch','/templates/:id','ops_edit',(req,access)=>templates.save(db,access,req.params.id,req.body),true);
 get('/profile',(req,access)=>records.profile(db,access,req.query.scope,req.query.scope_id));
 post('/profile','ops_edit',(req,access)=>records.saveProfile(db,access,req.body));
 get('/projects/:projectId/defaults',(req,access)=>records.resolvedProfile(db,access,Number(req.params.projectId),branding()));
 get('/projects/:projectId/sources',(req,access)=>sources.options(db,access,Number(req.params.projectId)));
 get('/projects/:projectId/source',(req,access)=>{const rows=sources.rows(db,access,Number(req.params.projectId),req.query.type,req.query.id),used=sources.totals(db,Number(req.params.projectId),req.query.exclude_root);return rows.map(row=>{const balance=used.get(sources.key(row,req.query.kind==='MIR'?'MIR':'IR',req.query.stage||'installation'))||{accepted:0,pending:0};return {...row,accepted_before:balance.accepted,pending_before:balance.pending,available:Math.max(0,row.source_quantity-balance.accepted-balance.pending)};});});
 endpoint('post','/assets','ops_edit',async(req,access)=>{const file=await assets.prepare(req.body);return db.transaction(()=>assets.store(db,access,req.body,file));});
 get('/assets/:id/info',(req,access)=>{const file=assets.get(db,access,req.params.id,req.query.project_id);return {id:file.id,name:file.name,mime:file.mime,metadata:file.metadata};});
 get('/assets/:id',(req,access,res)=>{const file=assets.get(db,access,req.params.id,req.query.project_id);res.set('Cache-Control','private, no-store').set('X-Content-Type-Options','nosniff').set('Content-Security-Policy',"default-src 'none'; sandbox").type(file.mime).send(Buffer.from(file.content));});
 get('/requests',(req,access)=>records.list(db,access,req.query));
 post('/requests','ops_edit',(req,access)=>records.create(db,access,req.body,branding()));
 get('/requests/:id',(req,access)=>records.get(db,access,req.params.id));
 endpoint('patch','/requests/:id','ops_edit',(req,access)=>records.save(db,access,req.params.id,req.body),true);
 endpoint('post','/requests/:id/action','ops_view',(req,access)=>{const cap=req.body.action==='respond'?'ops_qc':req.body.action==='revision'||req.body.action==='reinspect'?'ops_edit':'ops_approve';if(!access.capabilities.includes(cap))fail(403,'Inspection action permission is required');return records.action(db,access,req.params.id,req.body);},true);
 post('/requests/:id/attachments','ops_edit',(req,access)=>records.attach(db,access,req.params.id,req.body));
 post('/requests/:id/attachments/remove','ops_edit',(req,access)=>records.removeAttachment(db,access,req.params.id,req.body));
 endpoint('post','/preview','ops_export',(req,access)=>{const project=sources.project(db,access,req.body.project_id),template=templates.get(db,access,req.body.template_id,project.id),config=templates.config(req.body.config||template.config);templates.assetsFor(db,access,config,project.id);const record={id:0,project_id:project.id,kind:template.kind,reference:req.body.reference||'PREVIEW',revision:Number(req.body.revision)||0,status:'draft',template_snapshot:config,data:records.cleanData(req.body.data||{},config),rows:records.checkedRows(req.body.rows||[],config),attachments:req.body.attachments||[]};return {html:report.html(db,access,record,req.body.locale==='en'?'en':'ar',branding(),false)};});
 endpoint('post','/requests/:id/pdf','ops_export',async(req,access,res)=>{const result=await report.artifact(db,access,req.params.id,req.body,branding(),renderPdf),name=result.reference.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_')+'.pdf';res.set('Cache-Control','no-store').set('Access-Control-Expose-Headers','Content-Disposition, X-Report-Page-Setup').attachment(name).type('application/pdf').send(Buffer.from(result.pdf));});
 endpoint('post','/template-preview/pdf','ops_export',async(req,access,res)=>{const project=sources.project(db,access,req.body.project_id),template=templates.get(db,access,req.body.template_id,project.id),config=templates.config(req.body.config||template.config);templates.assetsFor(db,access,config,project.id);const record={project_id:project.id,kind:template.kind,reference:'PREVIEW',revision:0,status:'draft',template_snapshot:config,data:records.cleanData(req.body.data||{},config),rows:records.checkedRows(req.body.rows||[],config),attachments:[]};const output=await report.pdf(db,access,record,req.body.locale==='en'?'en':'ar',branding(),renderPdf);res.attachment('inspection-preview.pdf').type('application/pdf').send(output);});
 parent.use('/inspections',router);
}
module.exports={initialize,register};
