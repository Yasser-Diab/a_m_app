const sanitize=require('sanitize-html');
const {fail,str}=require('../certificate-access.cjs');
const {record}=require('./core.cjs');
const size=/^(?:0|[\d.]+(?:px|pt|mm|cm|em|rem|%))$/;
const colour=/^(?:#[a-f\d]{3,8}|[a-z]+|rgba?\([\d.,%\s]+\))$/i;
function cleanReportBody(html){
  if(typeof html!=='string'||Buffer.byteLength(html)>20*1024*1024)fail(400,'The edited report must be smaller than 20 MB');
  return sanitize(html,{
    allowedTags:['header','footer','main','section','aside','div','span','p','bdi','bdo','h1','h2','h3','h4','h5','h6','dl','dt','dd',
      'table','thead','tbody','tfoot','tr','th','td','colgroup','col','img','figure','figcaption','strong','b','em','i','u','s','small','br','hr','ul','ol','li','blockquote','sub','sup','font'],
    allowedAttributes:{'*':['class','dir','style'],img:['src','alt','width','height'],th:['scope','colspan','rowspan'],td:['colspan','rowspan'],col:['span','width'],font:['size','color','face']},
    allowedSchemes:['data'],allowedSchemesByTag:{img:['data']},allowProtocolRelative:false,
    exclusiveFilter:frame=>frame.tag==='img'&&!/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(frame.attribs.src||''),
    allowedStyles:{'*':{'color':[colour],'background-color':[colour],'text-align':[/^(?:start|end|left|right|center|justify)$/],
      'font-weight':[/^(?:normal|bold|[1-9]00)$/],'font-size':[size],'font-style':[/^(?:normal|italic)$/],'font-family':[/^[a-z\s,"'-]+$/i],
      'text-decoration':[/^(?:none|underline|line-through)$/],'white-space':[/^(?:normal|pre|pre-wrap|nowrap)$/],
      'width':[size],'height':[size],'max-width':[size],'max-height':[size],'padding':[size],'margin':[size],
      'margin-top':[size],'margin-bottom':[size],'border-width':[size],'border-color':[colour],'border-style':[/^(?:solid|none|dashed|dotted)$/],
      'break-before':[/^(?:auto|page)$/],'break-inside':[/^(?:auto|avoid)$/],'--signers':[/^\d{1,3}$/]}},
  });
}
function identity(current,options={}){
  const kind=options.kind||'manufacturing';if(!['manufacturing','loading','maintenance','approvals'].includes(kind))fail(400,'Unknown report type');
  const reportKind=kind==='manufacturing'?kind+':'+(options.classification==='manufacturing'?'manufacturing':'materials'):kind;
  const reference=kind==='loading'?current.loading_reference:current.reference;
  if(!reference)fail(409,'Prepare the loading order before editing its report');
  return {order_id:current.id,document_ref:reference,report_kind:reportKind,locale:options.locale==='en'?'en':'ar'};
}
function saved(db,current,options){const key=identity(current,options);return {key,row:db.get(`SELECT * FROM ops_report_edits
  WHERE order_id=? AND document_ref=? AND report_kind=? AND locale=?`,Object.values(key))};}
function editedReport(db,current,options,html){
  const {key,row}=saved(db,current,options);
  let body=row?.body_html;
  if(body!=null){
    const fresh=html.match(/<section class="project-info">[\s\S]*?<\/section>/)?.[0];
    const previous=[...body.matchAll(/<section\b[^>]*>[\s\S]*?<\/section>/g)].map(match=>match[0]).find(section=>
      section.startsWith('<section class="project-info">')||section.includes('<dt>المشروع</dt>')&&section.includes('<dt>رمز المشروع</dt>')||section.includes('<dt>Project</dt>')&&section.includes('<dt>Project code</dt>'));
    if(fresh&&previous){
      const managed=new Set(['المشروع','رمز المشروع','كود المشروع لدى العميل','العميل','الموقع','عنوان الموقع','المبنى / القطاع','رقم الإسناد','رقم عقد العميل أو أمر الشراء','الفاتورة','عرض السعر','رقم أمر الصيانة','رقم أمر التشغيل','تاريخ الأمر','موعد التسليم','المخطط','إصدار المخطط',
        'Project','Project code','Customer project code','Customer','Site','Site address','Building / sector','Award no.','Client contract or PO no.','Invoice','Quotation','Maintenance order no.','Work order no.','Order date','Required by','Drawing number','Drawing revision']);
      const custom=[...previous.matchAll(/<div><dt>([\s\S]*?)<\/dt><dd>[\s\S]*?<\/dd><\/div>/g)].filter(match=>!managed.has(match[1])).map(match=>match[0]).join('');
      body=body.replace(previous,()=>fresh.replace('</section>',(custom?'<dl>'+custom+'</dl>':'')+'</section>'));
    }
  }
  if(body!=null&&options.kind==='loading'&&current.loading_previous_reference)
    body=body.replace(/<h1\b[^>]*>[\s\S]*?<\/h1>/i,heading=>heading.replaceAll(current.loading_previous_reference,current.loading_reference));
  if(body!=null&&options.kind==='loading'){
    const extras=html.match(/<section class="loading-extras">[\s\S]*?<\/section>/)?.[0]||'';
    const section=/<section class="loading-extras">[\s\S]*?<\/section>/;
    body=section.test(body)?body.replace(section,()=>extras):body.includes('<div class="signoffs">')?
      body.replace('<div class="signoffs">',()=>extras+'<div class="signoffs">'):body+extras;
  }
  if(body!=null){
    const section=/<section class="order-summary">[\s\S]*?<\/section>/;
    const summary=html.match(section)?.[0];
    if(summary)body=section.test(body)?body.replace(section,()=>summary):body.includes('<div class="signoffs">')?
      body.replace('<div class="signoffs">',()=>summary+'<div class="signoffs">'):body+summary;
  }
  if(body!=null&&options.kind==='loading'){
    const section=/<section class="loading-transport">[\s\S]*?<\/section>/;
    const transport=html.match(section)?.[0]||'';
    body=section.test(body)?body.replace(section,()=>transport):body.includes('<div class="signoffs">')?
      body.replace('<div class="signoffs">',()=>transport+'<div class="signoffs">'):body+transport;
  }
  return {html:body!=null?html.replace(/<body[^>]*>[\s\S]*<\/body>/i,()=>'<body>'+body+'</body>'):html,
    edit_version:row?.version||0,document_ref:key.document_ref,report_key:key.report_kind+':'+key.locale,customized:row?.body_html!=null};
}
function saveReportEdit(db,current,options,user){
  require("../document-edit-window.cjs").check(db,"order",current.id,["closed","shipped"].includes(current.status)?current.created_at:null);
  const {key,row}=saved(db,current,options);
  if(str(options.document_ref)!==key.document_ref)fail(409,'The loading order changed. Reopen its report before saving');
  if(Number(options.version)!==(row?.version||0))fail(409,'The report was edited elsewhere. Reopen it before saving');
  const html=options.reset===true?null:cleanReportBody(options.html),version=(row?.version||0)+1;
  const id=row?.id||db.run('INSERT INTO ops_report_edits(order_id,document_ref,report_kind,locale,body_html,version,updated_by) VALUES(?,?,?,?,?,?,?)',
    [...Object.values(key),html,version,user.id]).lastInsertRowid;
  if(row)db.run('UPDATE ops_report_edits SET body_html=?,version=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[html,version,user.id,id]);
  db.run('INSERT INTO ops_report_edit_history(report_edit_id,version,body_html,actor_id) VALUES(?,?,?,?)',[id,version,html,user.id]);
  record(db,user,current.project_id,options.reset?'report_edits_reset':'report_edited',id,{...key,version});
  return {version,document_ref:key.document_ref,customized:html!=null};
}
module.exports={cleanReportBody,editedReport,saveReportEdit};
