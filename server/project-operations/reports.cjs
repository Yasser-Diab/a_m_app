const {fail,idOf} = require("../certificate-access.cjs");
const {getProject,getCustomer} = require("../certificate-projects.cjs");
const {people} = require("./core.cjs");
const {configuration,fieldsFor,directions,categories,perimeterDescription} = require("./specifications.cjs");
const {orderDetails} = require("./production.cjs");
const { PDFDocument, PDFName } = require("pdf-lib");
const translations=require("./translations.json");
const technicalText=(value,locale)=>translations[value]?.[locale==="ar"?0:1]??value;

const escape = (value) => String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
  .replaceAll('"',"&quot;").replaceAll("'","&#39;");
const hex = (value,fallback) => /^#[0-9a-f]{6}$/i.test(value||"") ? value : fallback;
const label = (ar,en,locale) => locale==="ar"?ar:en;
const localized = (value,locale) => typeof value === "object" ? value?.[locale] : value;
const head = (text) => `<h2>${escape(text)}</h2>`;
const direction=(value)=>/^[\d\s.,×%:/-]+$/.test(String(value))?"ltr":"auto";
const row = (cells,tag="td")=>`<tr>${cells.map((value)=>`<${tag}><bdi dir="${direction(value)}">${escape(value)}</bdi></${tag}>`).join("")}</tr>`;
const grid = (pairs) => `<dl>${pairs.filter(([,value])=>value!=="" && value!=null).map(([key,value,scope])=>
  `<div><dt>${escape(key)}</dt><dd><bdi dir="${direction(value)}">${escape(value)}</bdi>${scope?`<small class="field-scope"><bdi>${escape(scope)}</bdi></small>`:""}</dd></div>`).join("")}</dl>`;
const panelLabels={frames:["حلوق","Frames"],sliding:["ضلف جرار","Sliding leaves"],hinged:["ضلف مفصلي","Hinged leaves"],
  fixed:["ثوابت","Fixed panels"],other:["ضلف أخرى","Other leaves"],screens:["ضلف سلك","Flyscreen leaves"],items:["وحدات","Items"]};
const inspectionLabels={survey:["رفع المقاسات","Measurement survey"],receipt:["استلام الخامات","Material receipt"],
  cutting:["قص وتجهيز","Cutting and preparation"],assembly:["تجميع","Assembly"],glazing:["تركيب الزجاج","Glass installation"],
  pre_shipment:["قبل الشحن","Pre-shipment"],installation:["بعد التركيب","Post-installation"],handover:["استلام نهائي","Final handover"],
  passed:["اجتاز","Passed"],failed:["لم يجتز","Failed"],hold:["معلق","On hold"],reinspect:["إعادة فحص","Reinspection required"],
  pending:["بانتظار الاعتماد","Pending"],approved:["معتمد","Approved"],rejected:["مرفوض","Rejected"]};

function eligibleDrawings(db,item) {
  const {version,drawing_ids}=item.specification;
  const selection=Array.isArray(drawing_ids)?JSON.stringify(drawing_ids):null;
  return db.all(`SELECT name,mime,content FROM ops_attachments WHERE item_id=? AND item_version<=?
    AND ((? IS NULL AND removed_at IS NULL) OR id IN (SELECT value FROM json_each(?))) ORDER BY id`,
  [item.item_id,version,selection,selection]);
}

function wrap({locale,branding,title,classification,watermark,watermarkColor,color,body}) {
  const name=branding.companyNameEn || branding.companyNameAr || branding.companyName || "EasyCommercial";
  const secondary=branding.companyNameAr && branding.companyNameAr!==name?branding.companyNameAr:"";
  const logo=/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(branding.logoDataUri||"")?branding.logoDataUri:null;
  return `<!doctype html><html lang="${locale}" dir="${locale==="ar"?"rtl":"ltr"}"><head><meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
  <title>${escape(title)}</title><style>
  @page{size:A4;margin:12mm}*{box-sizing:border-box}
  body{font:9.5pt ${String(branding.bodyFontStack||"Arial,Tahoma,sans-serif").replace(/[<>]/g,"")};color:#183148;background:#fff;margin:0;line-height:1.32;print-color-adjust:exact}
  header{display:flex;gap:10px;align-items:center;border-block-end:2px solid ${hex(branding.lineColor,"#26465b")};padding-bottom:7px}
  header img{max-width:56px;max-height:52px}header strong{font-size:17pt;color:${hex(branding.companyNameColor,"#203956")}}
  h1{font-size:18pt;margin:12px 0 5px}h2{font-size:13pt;margin:10px 0 5px}h3{margin:0 0 5px;font-size:12pt}
  header strong,h1,h2,h3{font-family:${String(branding.headingFontStack||"Arial,Tahoma,sans-serif").replace(/[<>]/g,"")}}
  .classification{font-weight:700}.watermark{position:fixed;inset:45% 0 auto;text-align:center;z-index:0;
  font-size:28pt;font-weight:800;transform:rotate(-29deg);opacity:.20;color:${watermarkColor||color};pointer-events:none}
  header,h1,section,.signoffs{position:relative;z-index:1}
  section{border:1px solid ${color};border-radius:3px;padding:7px;margin-block:7px;break-inside:avoid}
  section h2{margin-top:0}section.loading{break-inside:auto}.work-group+.work-group{break-before:page}
  .shared-specifications{break-inside:avoid}.item-number{font-weight:700;font-size:9pt;margin:0 0 5px}
  .field-scope{display:block;color:#546573;font-size:8pt}dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px 10px;margin:4px 0}
  dl div{break-inside:avoid}dt{font-size:9pt;font-weight:700;color:#405467}dd{margin:0;overflow-wrap:anywhere}
  table{border-collapse:collapse;width:100%;margin-block:7px}th,td{text-align:start;border-bottom:1px solid #dce7e9;padding:4px}
  td.number{white-space:nowrap;font-variant-numeric:tabular-nums}.work-group h3{font-size:10.5pt}
  thead{display:table-header-group;background:#e5eef1}tr{break-inside:avoid}
  .loading-sheet{table-layout:fixed;font-size:8.5pt}.loading-sheet td{height:12mm}
  .loading-sheet td:nth-child(-n+8){white-space:nowrap}.loading-sheet th{font-size:8pt;overflow-wrap:normal;hyphens:none}
  .drawings{display:flex;flex-wrap:wrap;gap:8px}
  figure{max-width:47%;margin:6px 0 0;break-inside:avoid}figure img{max-width:100%;max-height:66mm;object-fit:contain}
  .signoffs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;margin-block:12px}
  .signoff h3{margin-block:0 15px}
  .signatures{display:grid;grid-template-columns:repeat(auto-fit,minmax(116px,1fr));gap:16px;padding-top:12px}
  .signatures div{border-top:1px solid #587384;padding-top:6px;min-height:39px;break-inside:avoid}
  </style></head><body>${watermark?`<div class="watermark" lang="en" dir="ltr">${escape(watermark)}</div>`:""}
  <header>${logo?`<img alt="" src="${escape(logo)}">`:""}<div><strong>${escape(name)}</strong>
  ${secondary?`<div>${escape(secondary)}</div>`:""}</div></header><h1>${escape(title)}</h1>
  ${classification?`<div class="classification">${escape(classification)}</div>`:""}${body}</body></html>`;
}

function projectBlock(db,project,customer,state,order,locale,branding) {
  const t=(ar,en)=>label(ar,en,locale);
  const info=state.details;
  const organization=(locale==="ar"?branding.companyNameAr:branding.companyNameEn)||branding.companyName;
  const representatives=people(db,project.id).map((person)=>row([person.name,person.side==="company"?(person.company||organization):person.company,person.position]));
  const sources=new Set(order.items.map(({specification})=>specification.source_document_id||state.boq_id));
  const projectBoqs=db.all("SELECT document_id,snapshot FROM ops_project_boqs WHERE project_id=?",[project.id])
    .filter(({document_id})=>sources.has(document_id)).map(({snapshot})=>JSON.parse(snapshot));
  return `<section>${grid([
    [t("المشروع","Project"),project.name],[t("رمز المشروع","Project code"),project.code],
    [t("العميل","Customer"),customer.display_name],[t("الموقع","Site"),info.location],
    [t("عنوان الموقع","Site address"),info.address||project.address],[t("المبنى / القطاع","Building / sector"),info.building],
    [t("رقم الإسناد","Award no."),state.award_reference],
    [t("رقم عقد العميل أو أمر الشراء","Client contract or PO no."),info.contract_ref||project.contract_ref],
    ...projectBoqs.map((source)=>[
      source.document_type==="invoice"?t("الفاتورة","Invoice"):t("عرض السعر","Quotation"),source.operation_no,
    ]),
    [order.kind==="maintenance"?t("رقم أمر الصيانة","Maintenance order no."):t("رقم أمر التشغيل","Work order no."),order.reference],
    [t("تاريخ الأمر","Order date"),order.created_at?.slice(0,10)],
    [t("موعد التسليم","Required by"),order.required_date],[t("المخطط","Drawing number"),info.drawing_ref],
    [t("إصدار المخطط","Drawing revision"),info.drawing_revision],
  ])}${representatives.length?`<table><thead>${row([t("الاسم","Name"),t("الشركة","Company"),t("المنصب","Position")],"th")}</thead>
    <tbody>${representatives.join("")}</tbody></table>`:""}</section>`;
}

const internalFields=new Set(["measurement_status","material_status","manufacturing_status","safety_approval"]);
const dimensionFields=new Set(["quantity","width_mm","height_mm","depth_mm","tag","building","floor","room","drawing_ref"]);
const locks=new Set(["lock_left","lock_right","central_lock_handle","interlock_left","interlock_right"]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  return value && typeof value==="object" ? Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])])) : value;
}

function groupedWork(db,items,locale,drawingSets) {
  const buckets=new Map();
  const groups=[];
  const populated=(value,key)=>value!=null&&value!==""&&(!Array.isArray(value)||value.length>0||key==="perimeter");
  const prepared=[];
  for (const [index,item] of items.entries()) {
    const source=item.specification;
    const technical={...source.technical};
    for (const [key,commercial] of [["profile","profile"],["infill","glass"],["finish","finish"]])
      if (!technical[key]&&source.commercial[commercial]) technical[key]=source.commercial[commercial];
    const spec={...source,technical};
    const shared=Object.fromEntries(Object.entries(spec.technical).filter(([key,value])=>
      !dimensionFields.has(key)&&!internalFields.has(key)&&populated(value,key)));
    const key=JSON.stringify([spec.category,spec.system,spec.commercial.description.normalize("NFC").replace(/\s+/g," ").trim()]);
    prepared.push({item,index,spec,shared,key});
  }
  // Resolve fuller specifications first so missing fields can stay within a matching item.
  for (const {item,index,spec,shared,key} of prepared.sort((a,b)=>Object.keys(b.shared).length-Object.keys(a.shared).length)) {
    const bucket=buckets.get(key)||[];
    const matches=bucket.filter((group)=>Object.entries(shared).every(([field,value])=>
      !Object.hasOwn(group.shared,field)||JSON.stringify(stable(group.shared[field]))===JSON.stringify(stable(value))));
    const exact=matches.find((group)=>JSON.stringify(stable(group.shared))===JSON.stringify(stable(shared)));
    let group=exact||(matches.length===1?matches[0]:null);
    if (!group) {
      group={spec,shared:{...shared},items:[],drawings:[],index};
      bucket.push(group);buckets.set(key,bucket);groups.push(group);
    }
    Object.assign(group.shared,shared);
    group.spec.technical={...group.spec.technical,...shared};
    group.index=Math.min(group.index,index);
    group.items.push({...item,reportTechnical:spec.technical,index});
    for (const drawing of drawingSets[index]||[])
      if (!group.drawings.some((stored)=>stored.name===drawing.name&&Buffer.from(stored.content).equals(Buffer.from(drawing.content))))
        group.drawings.push(drawing);
  }
  const t=(ar,en)=>label(ar,en,locale);
  const directionNames={right:"Right",left:"Left",top:"Top",bottom:"Bottom"};
  const text=(value)=>Array.isArray(value)?value.map((side)=>technicalText(directionNames[side]||side,locale)).join(t("، ",", ")):
    typeof value==="boolean"?value?t("نعم","Yes"):t("لا","No"):technicalText(directionNames[value]||value,locale);
  const supplemental=(tech,system)=>{
    const pairs=[];
    if (system?.tags.includes("sliding")&&Number(tech.leaves)>=2) {
      const positions=[["lock_left","تسكيك شمال","Left lock"],["lock_right","تسكيك يمين","Right lock"],
        ...(Number(tech.leaves)>2?[["central_lock_handle","تسكيك وسط","Centre lock"]]:[])];
      const combined=positions.map(([key,ar,en])=>{
        const values=[tech[key],tech[key.replace("lock_","interlock_")]].filter(Boolean);
        const value=[...new Set(values)].map(text).join(" / ");
        return value?t(ar,en)+" "+value:"";
      }).filter(Boolean).join(" - ");
      if (combined) pairs.push([t("التسكيك","Locking"),combined]);
    }
    if (typeof tech.rubber_bar==="boolean") pairs.push([t("الربر بار","Rubber bar"),text(tech.rubber_bar)]);
    const componentCounts=Object.entries(tech.panel_counts||{}).filter(([,value])=>value!=null&&value!=="");
    if (componentCounts.length) pairs.push([t("المكونات لكل فتحة","Components per opening"),
      componentCounts.map(([kind,value])=>t(...panelLabels[kind])+" "+value).join(" - ")]);
    if (tech.subframe) {
      pairs.push([t("حالة تخصيم العلب","Sub-frame deduction"),tech.subframe.status==="deducted"?t("تم التخصيم","Already deducted"):t("لم يتم التخصيم","Not deducted")]);
      for (const side of directions) {
        const frame=tech.subframe.sides[side];
        if (frame) pairs.push([t("علب","Sub-frame")+" "+text(side),[frame.width,frame.depth].filter((value)=>value!=null).join(" × ")+
          (tech.subframe.status==="not_deducted"&&frame.deduction!=null?" / "+t("الخصم","Deduction")+" "+frame.deduction:"")]);
      }
    }
    return pairs;
  };
  return groups.sort((a,b)=>a.index-b.index).map(({spec,items,drawings},groupIndex)=>{
    items.sort((a,b)=>a.index-b.index);
    const tech=spec.technical;
    const system=configuration(db,spec.category,spec.system);
    const pairs=[
      [t("نوع العمل","Work type"),categories.get(spec.category)?.[locale]],
      [t("النظام","System"),localized(spec.system_label,locale)],
      ...fieldsFor(spec.category,system,tech,true).filter(({key})=>!dimensionFields.has(key)&&!internalFields.has(key)&&!locks.has(key))
        .map((field)=>{
          const specified=items.filter((item)=>populated(item.reportTechnical[field.key],field.key));
          return [field[locale],field.key==="perimeter"?perimeterDescription(tech[field.key],locale):field.key==="coating_direction"?text(({Inside:"للداخل",Outside:"للخارج"})[tech[field.key]]||tech[field.key]):text(tech[field.key]),
            specified.length&&specified.length<items.length?t("محدد للفتحات ","Specified for openings ")+
              specified.map(({specification})=>specification.technical.tag||specification.code).join(", "):null];
        }),
    ];
    pairs.push(...supplemental(tech,system));
    const integrated=tech.integrated?.system?configuration(db,tech.integrated.category,tech.integrated.system):null;
    if (integrated) pairs.push([t("وحدة الفتح المدمجة","Integrated opening"),integrated[locale]],
      ...fieldsFor(tech.integrated.category,integrated,tech.integrated.spec,true).filter(({key})=>!internalFields.has(key)&&!locks.has(key))
        .map((field)=>[field[locale],field.key==="perimeter"?perimeterDescription(tech.integrated.spec[field.key],locale):text(tech.integrated.spec[field.key])]),...supplemental(tech.integrated.spec,integrated));
    const size=(value)=>value==null?"":value;
    const hasLocation=items.some(({specification})=>["building","floor","room"].some((key)=>specification.technical[key]));
    const hasDepth=items.some(({specification})=>specification.technical.depth_mm!=null);
    const hasDrawing=items.some(({specification})=>specification.technical.drawing_ref);
    const changedDimensions=(item)=>{
      const data=item.specification.technical;
      const net=item.specification.manufacturing_dimensions;
      return net&&(Number(net.width)!==Number(data.width_mm)||Number(net.height)!==Number(data.height_mm));
    };
    const hasDeductions=items.some(changedDimensions);
    const measures=items.map((item)=>{
      const data=item.specification.technical;
      const net=item.specification.manufacturing_dimensions;
      return row([data.tag||item.specification.code,...(hasLocation?[[data.building,data.floor,data.room].filter(Boolean).join(" / ")]:[]),
        item.quantity,size(data.width_mm),size(data.height_mm),...(hasDepth?[size(data.depth_mm)]:[]),
        ...(hasDrawing?[data.drawing_ref]:[]),...(hasDeductions?[changedDimensions(item)?net.width+" × "+net.height:""]:[])]);
    }).join("");
    const imageHtml=drawings.length?'<div class="drawings">'+drawings.map(({name,mime,content})=>mime==="application/pdf"
      ?"<p>"+escape(t("رسم مرفق بنهاية الملف","Drawing appended to the PDF"))+" · "+escape(name)+"</p>"
      :'<figure><img alt="'+escape(name)+'" src="data:'+mime+';base64,'+Buffer.from(content).toString("base64")+
        '"><figcaption>'+escape(name)+"</figcaption></figure>").join("")+"</div>":"";
    return '<section class="work-group"><p class="item-number">'+escape(t(`البند ${groupIndex+1} من ${groups.length}`,`Item ${groupIndex+1} of ${groups.length}`))+
      '</p><h3>'+escape(spec.commercial.description)+'</h3><table class="measurements"><thead>'+
      row([t("الفتحة","Opening"),...(hasLocation?[t("الموقع","Location")]:[]),t("العدد","Count"),t("العرض مم","Width mm"),t("الارتفاع مم","Height mm"),
        ...(hasDepth?[t("العمق مم","Depth mm")]:[]),...(hasDrawing?[t("مرجع الرسم","Drawing reference")]:[]),
        ...(hasDeductions?[t("مقاس التصنيع بعد التخصيم مم","Manufacturing after deduction mm")]:[])],"th")+
      "</thead><tbody>"+measures+'</tbody></table><div class="shared-specifications">'+grid(pairs)+"</div>"+imageHtml+"</section>";
  }).join("");
}

function signatures(db,projectId,order,kind,locale,selection) {
  const t=(ar,en)=>label(ar,en,locale);
  const assigned=people(db,projectId);
  const allowed=kind==="maintenance"?[kind,"all"]:[kind,"both","all"];
  const signers=new Map(assigned.filter((person)=>allowed.includes(person.signature_usage)||
    person.signature_usage&&!["manufacturing","loading","maintenance","both","all"].includes(person.signature_usage))
    .map((person)=>[person.id,{person,title:person.signature_label||person.position}]));
  const roles={loading:["مسؤول التحميل","Loading lead"],engineer:["مهندس المشروع","Project engineer"],
    reviewer:["الاستلام","Receiver"],approver:["الاعتماد","Approval"]};
  const saved=require("./core.cjs").operation(db,projectId).details.report_signatures?.[kind];
  if(Array.isArray(saved)) {
    signers.clear();
    saved.forEach((person,index)=>signers.set("saved-"+index,{person,title:person.title}));
  }
  if (kind==="loading"&&!Array.isArray(saved))
    for (const [key,names] of Object.entries(roles)) {
      const custom=typeof selection?.[key]==="string"&&!idOf(selection[key])?selection[key].trim().slice(0,200):null;
      const person=assigned.find(({id})=>id===idOf(selection?.[key]))||
        (custom?{name:custom,side:key==="reviewer"?"client":"company"}:null)
        || assigned.find(({responsibility})=>responsibility===key) || order.loads[0]?.responsible?.[key];
      if (person) signers.set(person.id||person.side+":"+person.name,{person,title:person.signature_label||person.position||t(...names)});
    }
  const groups=[[" company",t("توقيعات الشركة","Company sign-off"),true],
    [" client",t("توقيعات العميل والاستشاري","Client & consultant sign-off"),false]];
  const blocks=groups.map(([side,heading,internal])=>{
    const members=[...signers.values()].filter(({person})=>(person.side?person.side==="company":Boolean(person.user_id))===internal);
    return members.length?`<div class="signoff${side}"><h3>${escape(heading)}</h3><div class="signatures">${members.map(({person,title})=>
      `<div><strong><bdi>${escape(person.name||title)}</bdi></strong>${person.name&&title?`<br>${escape(title)}`:""}
        ${person.company?`<br><bdi>${escape(person.company)}</bdi>`:""}</div>`).join("")}</div></div>`:"";
  }).join("");
  return blocks?`<div class="signoffs">${blocks}</div>`:"";
}

function maintenanceBlock(order,locale) {
  const t=(ar,en)=>label(ar,en,locale);
  const service=order.service;
  return `<section>${grid([
    [t("حالة الصيانة","Status"),service.completed_on?t("مكتملة","Completed"):order.status==="draft"?t("مفتوحة","Open"):t("ملغاة","Cancelled")],
    [t("مسؤول الصيانة","Assigned to"),service.assignee?.name],
    [t("أعمال الصيانة المطلوبة","Instructions"),service.instructions],
    [t("تاريخ الإنهاء","Completed on"),service.completed_on],
    [t("مسجل الإنهاء","Completed by"),service.completed_by],
    [t("ملاحظات الإنهاء","Completion notes"),service.completion_notes],
  ])}<table><thead>${row([t("البند","Item"),t("البيان","Description"),t("العدد","Count")],"th")}</thead><tbody>
    ${order.items.map((item)=>row([item.specification.code,item.specification.commercial.description,item.quantity])).join("")}
    </tbody></table></section>`;
}

function loadingBlock(order,locale) {
  const t=(ar,en)=>label(ar,en,locale);
  const details=new Map(order.items.map((item)=>[item.id,item.specification]));
  const rows=order.balances.map((entry)=>{
    const spec=details.get(entry.order_item_id);
    const tech=spec.technical;
    const values=[tech.tag||spec.code,(tech.width_mm??"—")+" × "+(tech.height_mm??"—"),t(...panelLabels[entry.kind]),
      entry.required,entry.loaded,"","",entry.remaining,""];
    return "<tr>"+values.map((value,index)=>'<td'+(index>2&&index<8?' class="number"':"")+'><bdi dir="'+direction(value)+'">'+escape(value)+"</bdi></td>").join("")+"</tr>";
  }).join("");
  const frames=order.balances.filter(({kind})=>kind==="frames").reduce((sum,entry)=>sum+entry.required,0);
  const leaves=order.balances.filter(({kind})=>["sliding","hinged","other"].includes(kind)).reduce((sum,entry)=>sum+entry.required,0);
  const screens=order.balances.filter(({kind})=>kind==="screens").reduce((sum,entry)=>sum+entry.required,0);
  return '<section class="loading">'+
    '<p>'+escape(t("إجمالي الحلوق","Total frames"))+' '+frames+' · '+escape(t("إجمالي الضلف","Total leaves"))+' '+leaves+
    (screens?' · '+escape(t("إجمالي ضلف السلك","Total flyscreen leaves"))+' '+screens:'')+'</p>'+
    '<table class="loading-sheet"><colgroup>'+[14,15,15,8,10,8,10,10,10].map(width=>'<col style="width:'+width+'%">').join('')+'</colgroup><thead>'+row([t("الفتحة","Opening"),t("المقاس مم","Size mm"),t("المكون","Component"),t("المطلوب","Required"),
      t("المحمل سابقًا","Previously loaded"),t("الحالي","Current"),t("التراكمي","Cumulative"),t("المتبقي","Remaining"),t("ملاحظات / تاريخ","Notes / date")],"th")+
    "</thead><tbody>"+rows+"</tbody></table></section>";
}

function approvalReport(db,order,locale) {
  const t=(ar,en)=>label(ar,en,locale);
  const stages={measurement:["المقاسات","Measurements"],profile:["القطاعات","Profiles"],glass:["الزجاج","Glass"],
    accessories:["الإكسسوارات","Accessories"],finish:["التشطيب","Finish"],details:["التفاصيل","Technical details"],drawing:["الرسومات","Drawings"],
    manufacturing:["التصنيع","Manufacturing"],pre_shipment:["الشحن","Shipment"]};
  const list=order.stage_approvals.flatMap(({stage,items})=>items.map((item)=>row([item.code,t(...stages[stage]),
    item.stale?t("المواصفات معدلة","Specifications changed"):item.approved?t("معتمد","Approved"):t("غير معتمد","Unapproved")])));
  const history=order.inspections.map((item)=>row([item.reference,item.inspection_date,
    order.items.find(({id})=>id===item.order_item_id)?.specification.code,t(...inspectionLabels[item.stage]),
    item.inspector_name,t(...inspectionLabels[item.record.result]),t(...inspectionLabels[item.record.release])]));
  const itemStatus=order.items.flatMap(({specification})=>[
    ["measurement_status","حالة اعتماد المقاس","Measurement approval"],["material_status","حالة اعتماد الخامات","Material approval"],
    ["manufacturing_status","حالة التصنيع","Manufacturing status"],["safety_approval","اعتماد السلامة","Safety approval"],
  ].filter(([key])=>specification.technical[key]!=null&&specification.technical[key]!=="").map(([key,ar,en])=>
    row([specification.technical.tag||specification.code,t(ar,en),technicalText(specification.technical[key],locale)])));
  return '<section class="loading"><table><thead>'+row([t("الفتحة","Opening"),t("المرحلة","Stage"),t("حالة الاعتماد","Approval status")],"th")+
    "</thead><tbody>"+list.join("")+itemStatus.join("")+"</tbody></table></section>"+
    (history.length?'<section class="loading"><h2>'+escape(t("سجل الفحص","Inspection history"))+'</h2><table><thead>'+
      row([t("رقم الفحص","Inspection no."),t("التاريخ","Date"),t("الفتحة","Opening"),t("المرحلة","Stage"),t("الفاحص","Inspector"),t("النتيجة","Result"),t("الإفراج","Release")],"th")+
      "</thead><tbody>"+history.join("")+"</tbody></table></section>":"");
}

function reportFilename(customer,order,options) {
  const ar=options.locale==="ar";
  const stage=order.kind==="maintenance"?(ar?"صيانة":"Maintenance"):options.kind==="approvals"?(ar?"حالة الاعتمادات":"Approval Status"):
    options.kind==="loading"?(ar?"تحميل":"Loading"):options.classification==="manufacturing"?(ar?"تصنيع":"Manufacturing"):(ar?"طلب خامات":"Material Requisition");
  const safe=(value)=>String(value||"").replace(/[\\/:*?"<>|\u0000-\u001f]/g,"_").replace(/[. ]+$/g,"").slice(0,90);
  return safe(customer.display_name||customer.name)+" - "+safe(options.kind==="loading"?order.loading_reference||order.reference:order.reference)+" - "+stage+".pdf";
}

function report(db,state,rawOrder,options,branding) {
  const locale=options.locale==="ar"?"ar":"en";
  const t=(ar,en)=>label(ar,en,locale);
  const project=getProject(db,state.project_id);
  const customer=getCustomer(db,project.customer_id);
  const order=orderDetails(db,rawOrder);
  if (order.kind==="maintenance") {
    const body=projectBlock(db,project,customer,state,order,locale,branding)+maintenanceBlock(order,locale)+
      signatures(db,project.id,order,"maintenance",locale);
    return {html:wrap({locale,branding,title:t("تقرير الصيانة","Maintenance Report"),color:"#7992a3",body}),pdfDrawings:[]};
  }
  const loading=options.kind==="loading";
  const approvals=options.kind==="approvals";
  const approved=options.classification==="manufacturing";
  if (!loading&&!approvals&&approved&&!order.stage_approvals.find(({stage})=>stage==="manufacturing")?.approved)
    fail(409,"Approve the manufacturing stage before generating this order");
  const classification="";
  const title=approvals?t("حالة الاعتمادات","Approval Status"):loading?t("أمر تحميل","Loading Order")+" "+(order.loading_reference||order.reference):
    approved?t("أمر تصنيع","Manufacturing Order"):t("طلب توريد الخامات","Material Requisition");
  const drawingSets=!loading && !approvals && options.drawings===true ? order.items.map((item)=>eligibleDrawings(db,item)) : [];
  const body=projectBlock(db,project,customer,state,order,locale,branding)+(approvals?approvalReport(db,order,locale):loading?loadingBlock(order,locale):
    groupedWork(db,order.items,locale,drawingSets))+
    signatures(db,project.id,order,loading?"loading":"manufacturing",locale,options.people);
  const measured=order.stage_approvals.find(({stage})=>stage==="measurement");
  const approvedMeasurements=measured?.items.filter(({approved})=>approved).length||0;
  const measurementState=measured?.approved?"approved":approvedMeasurements?"partial":"unapproved";
  const measurementLabels={approved:["مقاسات معتمدة","MEASUREMENTS APPROVED"],partial:["مقاسات معتمدة جزئيًا","MEASUREMENTS PARTLY APPROVED"],
    unapproved:["مقاسات غير معتمدة","MEASUREMENTS UNAPPROVED"]};
  const watermark=!loading&&!approvals&&options.measurement_watermark===true?t(...measurementLabels[measurementState]):"";
  return {html:wrap({locale,branding,title,classification,watermark,watermarkColor:{approved:"#36864a",partial:"#ac7b20",unapproved:"#b84949"}[measurementState],
    color:loading?"#7992a3":approved?"#90bc94":"#d5a1a1",body}),
    pdfDrawings:drawingSets.flat().filter(({mime})=>mime==="application/pdf")};
}

async function appendDrawings(buffer,drawings) {
  if (!drawings.length) return buffer;
  const output=await PDFDocument.load(buffer);
  for (const {name,content} of drawings) {
    try {
      const source=await PDFDocument.load(content);
      for (const page of await output.copyPages(source,source.getPageIndices())) {
        page.node.delete(PDFName.of("Annots"));
        page.node.delete(PDFName.of("AA"));
        output.addPage(page);
      }
    } catch {
      fail(422,"Could not include the PDF drawing "+name+". Check that it opens and is unlocked.");
    }
  }
  return Buffer.from(await output.save());
}

module.exports={report,appendDrawings,reportFilename,wrap,escape,grid,row};
