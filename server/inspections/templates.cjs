const {randomUUID}=require('node:crypto');
const {str,fail,encode,parse,inScope,scopeSql,audit}=require('../certificate-access.cjs');
const field=(key,en,ar,type='text',extra={})=>({key,en,ar,type,empty:'blank',...extra});
const fields=[
 field('project','Project','المشروع'),field('project_code','Project code','كود المشروع'),field('customer','Customer','العميل'),
 field('owner','Owner','المالك'),field('management','Project management','إدارة المشروع'),field('consultant','Consultant','الاستشاري'),
 field('contractor','Main contractor','المقاول الرئيسي'),field('subcontractor','Subcontractor','مقاول الباطن'),field('from','From','من'),field('to','To','إلى'),
 field('contract','Contract / PO','العقد / أمر الشراء'),field('client_reference','External reference','المرجع لدى العميل'),
 field('discipline','Discipline','التخصص','select',{options:['Architectural / معماري','Structural / إنشائي','Civil / مدني','Mechanical / ميكانيكا','Electrical / كهرباء','Other / أخرى']}),
 field('subject','Subject','الموضوع','textarea',{required:true}),field('location','Location / scope of work','الموقع / نطاق الأعمال'),
 field('building','Building','المبنى'),field('floor','Floor / level','الدور / المنسوب'),field('zone','Zone / grid','المنطقة / المحاور'),
 field('requested_date','Inspection date','تاريخ الفحص','date'),field('requested_time','Inspection time','وقت الفحص','time'),
 field('submission_date','Submission date','تاريخ التقديم','date'),field('delivery_date','Delivery date','تاريخ التوريد','date'),
 field('drawing','Drawing reference / revision','مرجع الرسم / المراجعة'),field('specification','Specification reference','مرجع المواصفات'),
 field('boq','BOQ reference','مرجع جدول الكميات'),field('itp','ITP reference / activity','خطة الفحص والاختبار / النشاط'),
 field('method','Method statement reference','مرجع بيان طريقة التنفيذ'),field('material_approval','Material approval / submittal','مرجع اعتماد المواد'),
 field('manufacturer','Manufacturer','المصنع'),field('supplier','Supplier','المورد'),field('origin','Source / country of origin','المصدر / بلد المنشأ'),
 field('transmittal','Material transmittal reference','مرجع إرسال المواد'),field('activity','Programme activity','نشاط البرنامج الزمني'),
 field('readiness','Work is ready for inspection','الأعمال جاهزة للفحص','checkbox'),field('remarks','Remarks','ملاحظات','textarea'),
 field('reviewer','Reviewer name','اسم القائم بالفحص'),field('reviewer_title','Reviewer title','وظيفة القائم بالفحص'),
 field('response_date','Response date','تاريخ الرد','date'),field('response_comments','Consultant comments','ملاحظات الاستشاري','textarea'),
];
const column=(key,en,ar,type='text',width=15)=>({key,en,ar,type,width});
const columns=[column('tag','Tag','Tag','text',9),column('description','Description','البيان','text',32),column('unit','Unit','الوحدة','text',8),
 column('quantity','Quantity','الكمية','number',10),column('location','Location','الموقع','text',14),column('reference','Source reference','مرجع المصدر','text',16),column('remarks','Remarks','ملاحظات','text',16),{...column('accepted','Accepted','المقبول','number',10),condition:'response'}];
const codes=[['A','Approved','معتمد','accepted'],['B','Approved as noted','معتمد مع ملاحظات','conditional'],['C','Revise and resubmit','يُعدّل ويعاد التقديم','reinspect'],['D','Rejected','مرفوض','rejected']].map(([code,en,ar,outcome])=>({code,en,ar,outcome}));
const block=(id,type,en,ar,extra={})=>({id,type,en,ar,span:12,columns:4,border:true,gap:1.5,...extra});
function builtin(kind,style='table'){
 const mir=kind==='MIR',selected=keys=>fields.filter(f=>keys.includes(f.key));
 return {mode:'flow',paper:'A4',page_width:210,page_height:297,repeat_header:true,orientation:'portrait',margin:10,font:'Arial',font_size:9,color:'#18544f',line_color:'#9eafb6',
  title_en:mir?'Material Inspection Request (MIR)':'Work Inspection Request (IR)',title_ar:mir?'طلب فحص واستلام مواد (MIR)':'طلب فحص واستلام أعمال (IR)',
  form_number:'',footer:'',numbering:{pattern:'{project}-{originator}-{discipline}-{type}-{sequence}',originator:'EC',discipline:'ARC',digits:4,start:1,revision_prefix:'R',revision_digits:2},
  fields:selected(['project','project_code','customer','owner','management','consultant','contractor','subcontractor','from','to','contract','client_reference','discipline','subject','location','building','floor','zone','requested_date','requested_time','submission_date','drawing','specification','boq','itp','remarks','reviewer','reviewer_title','response_date','response_comments',...(mir?['delivery_date','material_approval','manufacturer','supplier','origin','transmittal','activity']:['method','readiness'])]),
  item_columns:columns,action_codes:codes,logos:['owner','project','consultant','contractor','company'].map(role=>({role,en:role,ar:({owner:'المالك',project:'المشروع',consultant:'الاستشاري',contractor:'المقاول',company:'الشركة'})[role],asset_id:'',width:28,height:18})),
  blocks:[block('identity','fields','Project information','بيانات المشروع',{keys:['project','project_code','customer','owner','management','consultant','contractor','subcontractor','contract','client_reference','from','to','submission_date']}),
   block('scope','fields','Inspection request','طلب الفحص',{keys:['discipline','subject','location','building','floor','zone','requested_date','requested_time','drawing','specification','boq','itp',...(mir?['delivery_date','material_approval','manufacturer','supplier','origin','transmittal','activity']:['method','readiness'])],narrative:style==='narrative'}),
   block('items','items',mir?'Materials for inspection':'Work for inspection',mir?'المواد المطلوب فحصها':'الأعمال المطلوب فحصها',{totals:true}),
   block('checklist','checklist','Contractor QC checklist','قائمة فحص المقاول',{checks:mir?['Material matches approved submittal / مطابقة اعتماد المواد','No visible damage / عدم وجود تلف ظاهري','Stored as specified / التخزين طبقًا للمواصفات']:['Work matches approved drawings / مطابقة الرسومات المعتمدة','Location and scope checked / مراجعة الموقع والنطاق','Ready for inspection / جاهز للفحص']}),
   block('notes','fields','Remarks','ملاحظات',{keys:['remarks']}),block('attachments','attachments','Attachments','المرفقات'),
   block('contractor_sign','signatures','Contractor','المقاول',{group:'contractor',roles:['Prepared by / إعداد','QA/QC Engineer / مهندس الجودة','Project Manager / مدير المشروع']}),
   block('response','response','Consultant review','مراجعة الاستشاري',{keys:['reviewer','reviewer_title','response_date','response_comments']}),
   block('consultant_sign','signatures','Consultant / receipt','الاستشاري / الاستلام',{group:'consultant',roles:['Consultant Engineer / مهندس الاستشاري','Received by contractor / استلم بواسطة المقاول']}),
   block('statement','text','Statement','إقرار',{text_en:'Inspection and review do not relieve the contractor of its obligations under the contract documents.',text_ar:'لا يعفي الفحص والمراجعة المقاول من التزاماته وفقًا لمستندات العقد.'})],overlay:{asset_id:'',elements:[],rows_per_page:12,table:{page:1,x:10,y:100,width:190,row_height:8}},
 };
}
function initialize(db){for(const [id,kind,name,style] of [['builtin-ir','IR','IR — tabular','table'],['builtin-ir-narrative','IR','IR — narrative','narrative'],['builtin-mir','MIR','MIR — materials','table']]){
 db.run("INSERT OR IGNORE INTO inspection_templates(id,name,kind,scope,config) VALUES(?,?,?,'global',?)",[id,name,kind,encode(builtin(kind,style))]);
}}
function scope(db,access,type,id,write=false){
 if(type==='global'){if(write&&!access.capabilities.includes('ops_catalogue'))fail(403,'Template catalogue permission is required for global settings');return 0;}
 if(type==='project'){id=Number(id);if(!inScope(access,id)||!db.get('SELECT id FROM cert_projects WHERE id=?',[id]))fail(404,'Project not found');return id;}
 if(type==='customer'){id=Number(id);if(!db.get("SELECT id FROM parties WHERE id=? AND role='customer'",[id]))fail(404,'Customer not found');if(!access.all_projects){const grant=scopeSql(access,'p.id');if(write||!db.get('SELECT p.id FROM cert_projects p WHERE p.customer_id=? AND '+grant.clause,[id,...grant.params]))fail(403,'Company-wide project access is required for customer templates');}return id;}
 fail(400,'Choose a template scope');
}
function visible(db,access,row){try{scope(db,access,row.scope,row.scope_id);return true;}catch{return false;}}
function get(db,access,id,projectId){const row=db.get('SELECT * FROM inspection_templates WHERE id=?',[id]);if(!row||!visible(db,access,row))fail(404,'Template not found');
 if(projectId){const project=db.get('SELECT customer_id FROM cert_projects WHERE id=?',[projectId]);if(!project||!inScope(access,projectId)||row.scope==='project'&&row.scope_id!==Number(projectId)||row.scope==='customer'&&row.scope_id!==project.customer_id)fail(400,'Choose a template belonging to this project or customer');}
 return {...row,config:parse(row.config)};
}
const cleanKey=value=>{const key=str(value,80);if(!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)||['__proto__','constructor','prototype'].includes(key))fail(400,'Use a unique field key containing letters, numbers and underscores');return key;};
const num=(value,fallback,min,max)=>{const n=Number(value??fallback);if(!Number.isFinite(n)||n<min||n>max)fail(400,'Layout dimensions are outside their allowed range');return n;};
const label=value=>str(value,250),text=value=>str(value,20000);
function config(input){
 if(!input||typeof input!=='object')fail(400,'Choose a template configuration');
 const result=structuredClone(input);for(const key of ['fields','item_columns','blocks','action_codes','logos'])if(!Array.isArray(result[key])||result[key].length>150)fail(400,'Invalid template '+key);
 result.mode=result.mode==='overlay'?'overlay':'flow';result.paper=['A4','A3','Letter','Custom'].includes(result.paper)?result.paper:'A4';result.orientation=result.orientation==='landscape'?'landscape':'portrait';
 result.page_width=num(result.page_width,210,100,594);result.page_height=num(result.page_height,297,100,841);result.repeat_header=result.repeat_header!==false;
 result.margin=num(result.margin,10,0,35);result.font=['Arial','Tahoma','Segoe UI','Times New Roman'].includes(result.font)?result.font:'Arial';result.font_size=num(result.font_size,10,7,20);
 for(const key of ['color','line_color'])result[key]=/^#[a-f0-9]{6}$/i.test(result[key])?result[key]:'#425b66';
 for(const key of ['title_en','title_ar','form_number','footer'])result[key]=text(result[key]);
 const fieldsSeen=new Set();result.fields=result.fields.map(f=>{const key=cleanKey(f.key);if(fieldsSeen.has(key))fail(400,'Field keys must be unique');fieldsSeen.add(key);return {key,en:label(f.en)||key,ar:label(f.ar)||label(f.en)||key,type:['text','textarea','number','date','time','select','checkbox'].includes(f.type)?f.type:'text',required:f.required===true,span:Math.trunc(num(f.span,1,1,6)),empty:['hide','blank','required'].includes(f.empty)?f.empty:'blank',options:(f.options||[]).map(label).slice(0,100)};});
 const columnsSeen=new Set();result.item_columns=result.item_columns.map(c=>{const key=cleanKey(c.key);if(columnsSeen.has(key))fail(400,'Column keys must be unique');columnsSeen.add(key);return {key,en:label(c.en)||key,ar:label(c.ar)||label(c.en)||key,type:c.type==='number'?'number':'text',width:num(c.width,15,3,200),required:c.required===true,condition:c.condition==='response'?'response':'always'};});if(!result.item_columns.length)fail(400,'Add at least one item column');
 const blockIds=new Set();result.blocks=result.blocks.map(b=>{const id=cleanKey(b.id);if(blockIds.has(id))fail(400,'Block identifiers must be unique');blockIds.add(id);if(!['fields','items','text','checklist','response','signatures','attachments','spacer','table'].includes(b.type))fail(400,'Choose a supported block type');return {id,type:b.type,en:label(b.en),ar:label(b.ar),span:num(b.span,12,1,12),columns:num(b.columns,2,1,6),border:b.border!==false,hidden:b.hidden===true,new_page:b.new_page===true,keep:b.keep!==false,gap:num(b.gap,3,0,20),keys:(b.keys||[]).filter(k=>fieldsSeen.has(k)),text_en:text(b.text_en),text_ar:text(b.text_ar),narrative:b.narrative===true,totals:b.totals!==false,checks:(b.checks||[]).map(label).slice(0,100),group:label(b.group)||id,roles:(b.roles||[]).map(label).slice(0,12),height:num(b.height,8,0,100),grid_rows:Math.trunc(num(b.grid_rows,3,1,40)),grid_columns:Math.trunc(num(b.grid_columns,4,1,12)),cells:(b.cells||[]).slice(0,300).map(cell=>({id:cleanKey(cell.id),row:Math.trunc(num(cell.row,1,1,40)),col:Math.trunc(num(cell.col,1,1,12)),rowspan:Math.trunc(num(cell.rowspan,1,1,40)),colspan:Math.trunc(num(cell.colspan,1,1,12)),key:str(cell.key,100),text_ar:text(cell.text_ar),text_en:text(cell.text_en),show_label:cell.show_label===true}))};});
 const codeSeen=new Set();result.action_codes=result.action_codes.map(c=>{const code=label(c.code);if(!code||codeSeen.has(code))fail(400,'Action codes must be unique');codeSeen.add(code);return {code,en:label(c.en)||code,ar:label(c.ar)||label(c.en)||code,outcome:['accepted','conditional','reinspect','rejected','na'].includes(c.outcome)?c.outcome:'reinspect'};});
 result.logos=result.logos.map(l=>({role:cleanKey(l.role),en:label(l.en),ar:label(l.ar),asset_id:str(l.asset_id,100),width:num(l.width,28,5,150),height:num(l.height,18,5,70)}));
 const n=result.numbering||{};result.numbering={pattern:str(n.pattern,200)||'{project}-{type}-{sequence}',originator:str(n.originator,30)||'EC',discipline:str(n.discipline,30)||'ARC',digits:num(n.digits,4,1,10),start:num(n.start,1,1,99999999),revision_prefix:str(n.revision_prefix,10)||'R',revision_digits:num(n.revision_digits,2,1,4)};if(!result.numbering.pattern.includes('{sequence}'))fail(400,'The numbering pattern needs {sequence}');
 const o=result.overlay||{};result.overlay={asset_id:str(o.asset_id,100),rows_per_page:Math.trunc(num(o.rows_per_page,12,1,100)),elements:(o.elements||[]).slice(0,300).map(e=>({id:cleanKey(e.id),type:['field','text','logo','checkbox','signatures'].includes(e.type)?e.type:'field',key:str(e.key,100),text_en:text(e.text_en),text_ar:text(e.text_ar),page:Math.trunc(num(e.page,1,1,100)),x:num(e.x,10,0,420),y:num(e.y,10,0,594),width:num(e.width,40,2,420),height:num(e.height,8,2,594),font_size:num(e.font_size,10,6,30),show_label:e.show_label===true})),table:{page:Math.trunc(num(o.table?.page,1,1,100)),x:num(o.table?.x,10,0,420),y:num(o.table?.y,100,0,594),width:num(o.table?.width,190,10,420),row_height:num(o.table?.row_height,8,4,50),show_header:o.table?.show_header===true}};
 return result;
}
function assetIds(c){return [...c.logos.map(l=>l.asset_id),c.overlay?.asset_id].filter(Boolean);}
function assetsFor(db,access,c,projectId){for(const id of assetIds(c)){const a=db.get('SELECT project_id,customer_id FROM inspection_assets WHERE id=?',[id]);if(!a)fail(400,'A template image or background is missing');checkAsset(db,access,a,projectId);}}
function checkAsset(db,access,a,projectId){if(a.project_id&&!inScope(access,a.project_id))fail(404,'Asset not found');if(a.customer_id&&!access.all_projects&&!projectId)fail(403,'Customer asset is outside this project');if(projectId){const p=db.get('SELECT customer_id FROM cert_projects WHERE id=?',[projectId]);if(a.project_id&&a.project_id!==Number(projectId)||a.customer_id&&a.customer_id!==p?.customer_id)fail(400,'Choose images belonging to this project or customer');}}
function list(db,access,query={}){const project=query.project_id?Number(query.project_id):null,p=project?db.get('SELECT customer_id FROM cert_projects WHERE id=?',[project]):null;if(project&&!inScope(access,project))fail(404,'Project not found');return db.all('SELECT * FROM inspection_templates WHERE archived=0 ORDER BY updated_at DESC,id').filter(row=>visible(db,access,row)&&(!query.kind||row.kind===query.kind)&&(!project||row.scope==='global'||row.scope==='project'&&row.scope_id===project||row.scope==='customer'&&row.scope_id===p?.customer_id)).map(row=>({...row,config:parse(row.config)}));}
function save(db,access,id,body){const old=id?get(db,access,id):null;if(old&&Number(body.version)!==old.version)fail(409,'The template changed. Reload before saving');
 const kind=body.kind||old?.kind;if(!['IR','MIR'].includes(kind))fail(400,'Choose IR or MIR');const type=body.scope||old?.scope||'project',scopeId=scope(db,access,type,body.scope_id??old?.scope_id,true);if(old)scope(db,access,old.scope,old.scope_id,true);
 const c=config(body.config);assetsFor(db,access,c,type==='project'?scopeId:null);const name=label(body.name);if(!name)fail(400,'Enter a template name');id=id||randomUUID();
 if(old)db.run('INSERT INTO inspection_template_history(template_id,version,config,name,actor_id) VALUES(?,?,?,?,?)',[id,old.version,encode(old.config),old.name,access.user.id]);
 db.run(`INSERT INTO inspection_templates(id,name,kind,scope,scope_id,config,updated_by) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,scope=excluded.scope,scope_id=excluded.scope_id,config=excluded.config,version=inspection_templates.version+1,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`,[id,name,kind,type,scopeId||null,encode(c),access.user.id]);audit(db,access.user,'inspection_template_saved',{projectId:type==='project'?scopeId:null,details:{id,name}});return get(db,access,id);
}
module.exports={fields,columns,codes,builtin,initialize,scope,get,list,save,config,assetIds,assetsFor,checkAsset};
