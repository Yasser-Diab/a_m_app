const {certificateSessionUser,accessFor,inScope,fail,str,lookup,audit,parse}=require('./certificate-access.cjs');
const roles=['customer','project','consultant','contractor'];
const projectKey=(customer,name)=>name?-parseInt(require('node:crypto').createHash('sha256').update(customer+':'+lookup(name)).digest('hex').slice(0,12),16):null;
function initialize(db){db.exec(`CREATE TABLE IF NOT EXISTS report_logo_profiles(scope TEXT NOT NULL CHECK(scope IN ('customer','project')),scope_id INTEGER NOT NULL,customer_id INTEGER NOT NULL REFERENCES parties(id) ON DELETE CASCADE,project_id INTEGER REFERENCES cert_projects(id) ON DELETE CASCADE,data TEXT NOT NULL CHECK(json_valid(data)),version INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(scope,scope_id));`);}
function identity(db,access,documentId){
 const document=db.get('SELECT * FROM documents WHERE id=? AND deleted_at IS NULL',[Number(documentId)]);if(!document)fail(404,'Document not found');
 const customerId=Number(document.party_id),projects=require('./commercial-ledger.cjs').commercialProjects(db,access,{party_id:customerId,project:document.project,exact:true});
 if(!access.all_projects&&!projects.length)fail(404,'Document not found');
 const matches=projects;
 if(matches.length>1)fail(409,'Select an unambiguous project before saving logos');
 return {document,customerId,projectId:matches[0]?.id||null,projectScopeId:matches[0]?.id||projectKey(customerId,document.project),customer:db.get('SELECT display_name FROM parties WHERE id=?',[customerId])?.display_name||'',project:document.project};
}
function inherited(db,customerId,projectId,projectName=''){
 let result={enabled:false,logos:{}};
 for(const [scope,id] of [['customer',customerId],['project',projectKey(customerId,projectName)],['project',projectId]]){
  if(!id)continue;
  const inspection=parse(db.get('SELECT data FROM inspection_profiles WHERE scope=? AND scope_id=?',[scope,id])?.data,{});
  for(const role of roles){const assetId=inspection.logos?.[role==='customer'?'owner':role];if(!assetId)continue;const asset=db.get('SELECT name,mime,content,project_id,customer_id FROM inspection_assets WHERE id=?',[assetId]);if(asset?.mime.startsWith('image/')&&(!asset.project_id||asset.project_id===projectId)&&(!asset.customer_id||asset.customer_id===customerId))result.logos[role]={name:asset.name,data_uri:'data:'+asset.mime+';base64,'+Buffer.from(asset.content).toString('base64')};}
  const saved=parse(db.get('SELECT data FROM report_logo_profiles WHERE scope=? AND scope_id=?',[scope,id])?.data,{});result={...result,...saved,logos:{...result.logos,...saved.logos}};
 }
 return result;
}
function report(db,access,document,query={}){
 if(!access||!document?.party_id)return {enabled:false,logos:{}};
 const projects=require('./commercial-ledger.cjs').commercialProjects(db,access,{party_id:document.party_id,project:document.project,exact:true});
 const matches=projects;
 const result=inherited(db,document.party_id,matches.length===1?matches[0].id:null,document.project);
 return {...result,enabled:query.show_logos==='1'||query.show_logos!=='0'&&result.enabled};
}
function register(app,db){
 const router=require("express").Router();
 function access(req){const user=certificateSessionUser(db,req);if(!user)fail(401,'Sign in to manage report logos');return accessFor(db,req);}
 router.get('/',(req,res)=>{
  const a=access(req),i=identity(db,a,req.query.document_id),scope=req.query.scope==='customer'?'customer':'project',scopeId=scope==='customer'?i.customerId:i.projectScopeId;
  const row=scopeId?db.get('SELECT version,data FROM report_logo_profiles WHERE scope=? AND scope_id=?',[scope,scopeId]):null;
  res.json({customer_id:i.customerId,project_id:i.projectId,project_available:Boolean(i.projectScopeId),customer:i.customer,project:i.project,scope,version:row?.version||0,data:row?parse(row.data):inherited(db,i.customerId,i.projectId,i.project),can_edit:Boolean(a.user.can_create_invoices||a.capabilities.includes('edit_draft')||a.capabilities.includes('ops_edit')),can_edit_customer:a.all_projects});
 });
 router.post('/',async(req,res)=>{
  const a=access(req),i=identity(db,a,req.body.document_id),scope=req.body.scope==='customer'?'customer':'project',scopeId=scope==='customer'?i.customerId:i.projectScopeId;
  if(!(a.user.can_create_invoices||a.capabilities.includes('edit_draft')||a.capabilities.includes('ops_edit')))fail(403,'Document editing permission is required');
  if(scope==='customer'&&!a.all_projects)fail(403,'Customer-wide logo changes require access to all projects');if(!scopeId)fail(400,'Save this project in Customers Data before applying project-specific logos');
  const logos={};for(const role of roles){const image=req.body.data?.logos?.[role];if(!image?.data_uri){logos[role]=null;continue;}const match=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+=*)$/.exec(image.data_uri);if(!match)fail(400,'Choose PNG, JPEG or WebP logos');const file=await require('./inspections/assets.cjs').prepare({mime:match[1],base64:match[2],name:image.name});logos[role]={name:file.name,data_uri:'data:'+file.mime+';base64,'+file.content.toString('base64')};}
  db.transaction(()=>{const old=db.get('SELECT version FROM report_logo_profiles WHERE scope=? AND scope_id=?',[scope,scopeId]);if(Number(req.body.version)!==Number(old?.version||0))fail(409,'Logo settings changed. Reload before saving');
   db.run(`INSERT INTO report_logo_profiles(scope,scope_id,customer_id,project_id,data) VALUES(?,?,?,?,?) ON CONFLICT(scope,scope_id) DO UPDATE SET data=excluded.data,version=report_logo_profiles.version+1,updated_at=CURRENT_TIMESTAMP`,[scope,scopeId,i.customerId,scope==='project'?i.projectId:null,JSON.stringify({enabled:req.body.data?.enabled===true,logos})]);audit(db,a.user,'report_logos_saved',{projectId:i.projectId,details:{scope,scope_id:scopeId}});
  });res.json({ok:true});
 });
 router.use((error,req,res,next)=>{if(error.status)return res.status(error.status).json({error:error.message});next(error);});
 app.use("/api/report-logos",router);
}
function html(set){if(!set?.enabled)return '';const images=roles.filter(role=>set.logos?.[role]?.data_uri).map(role=>{const value=set.logos[role];return '<img alt="'+role+'" src="'+value.data_uri+'" style="width:42mm;height:24mm;object-fit:contain"/>';});return images.length?'<div class="report-logo-set" style="display:flex;justify-content:space-evenly;align-items:center;gap:4mm;flex-wrap:wrap;margin:3mm 0;break-inside:avoid">'+images.join('')+'</div>':'';}
module.exports={initialize,register,report,html,inherited};
