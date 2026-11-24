const {fail,idOf} = require("../certificate-access.cjs");
const {getProject,getCustomer} = require("../certificate-projects.cjs");
const {people} = require("./core.cjs");
const {configuration,fieldsFor,directions,categories,perimeterDescription} = require("./specifications.cjs");
const {orderDetails} = require("./production.cjs");
const {openingDescription}=require('./customer-defaults.cjs');
const {orderQuantities,unitKey,unitName}=require('./order-quantities.cjs');
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
const dimensionMarker=Symbol('dimension-pair');
// Keep width first in the data and isolate each number so RTL cannot reverse the convention.
const dimensionPair=(values,locale,suffix='')=>({[dimensionMarker]:true,values,locale,suffix});
const valueHtml=value=>value?.[dimensionMarker]
  ?`<span class="dimension-pair" dir="${value.locale==='ar'?'rtl':'ltr'}">${value.values.map(part=>`<bdi dir="ltr">${escape(part)}</bdi>`).join('<span>×</span>')}</span>${value.suffix?`<bdi dir="auto">${escape(value.suffix)}</bdi>`:''}`
  :`<bdi dir="${direction(value)}">${escape(value)}</bdi>`;
const row = (cells,tag="td")=>`<tr>${cells.map((value)=>`<${tag}>${valueHtml(value)}</${tag}>`).join("")}</tr>`;
const grid = (pairs) => `<dl>${pairs.filter(([,value])=>value!=="" && value!=null).map(([key,value,scope])=>
  `<div><dt>${escape(key)}</dt><dd>${valueHtml(value)}${scope?`<small class="field-scope"><bdi>${escape(scope)}</bdi></small>`:""}</dd></div>`).join("")}</dl>`;
const panelLabels={frames:["حلوق","Frames"],sliding:["ضلف جرار","Sliding leaves"],hinged:["ضلف مفصلي","Hinged leaves"],
  sliding_blades:["سكينة جرار","Sliding blades"],
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
  @page{size:A4;margin:12mm 12mm 20mm}*{box-sizing:border-box}
  body{font:9.5pt ${String(branding.bodyFontStack||"Arial,Tahoma,sans-serif").replace(/[<>]/g,"")};color:#183148;background:#fff;margin:0;line-height:1.32;print-color-adjust:exact}
  header{display:flex;gap:10px;align-items:center;border-block-end:2px solid ${hex(branding.lineColor,"#26465b")};padding-bottom:7px}
  header img{max-width:56px;max-height:52px}header strong{font-size:17pt;color:${hex(branding.companyNameColor,"#203956")}}
  h1{font-size:18pt;margin:12px 0 5px;color:${hex(branding.companyNameColor,"#203956")}}h2{font-size:13pt;margin:10px 0 5px}h3{margin:0 0 5px;font-size:12pt}
  header strong,h1,h2,h3{font-family:${String(branding.headingFontStack||"Arial,Tahoma,sans-serif").replace(/[<>]/g,"")}}
  .classification{font-weight:700}.watermark{position:fixed;inset:45% 0 auto;text-align:center;z-index:0;
  font-size:28pt;font-weight:800;transform:rotate(-29deg);opacity:.20;color:${watermarkColor||color};pointer-events:none}
  header,h1,section,.signoffs{position:relative;z-index:1}
  section{border:1px solid ${color};border-radius:3px;padding:7px;margin-block:7px;break-inside:avoid}
  section h2{margin-top:0}section.loading{break-inside:auto}.group-subtotal{background:#e5eef1;padding:5px 7px;margin-top:6px;break-inside:avoid}.group-subtotal dl{margin:0}
  .dimension-pair{display:inline-flex;align-items:baseline;gap:.28em;unicode-bidi:isolate;white-space:nowrap}
  .order-summary table{margin:0}.order-summary th,.order-summary td{border:0;background:#e5eef1;padding:7px}
  .order-unit-total{display:inline-flex;align-items:baseline;gap:.25em;white-space:nowrap;margin-inline-end:.65em;font-variant-numeric:tabular-nums}
  .shared-specifications{break-inside:avoid}.item-number{font-weight:700;font-size:9pt;margin:0 0 5px}
  .field-scope{display:block;color:#546573;font-size:8pt}dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px 10px;margin:4px 0}
  dl div{break-inside:avoid}dt{font-size:9pt;font-weight:700;color:#405467}dd{margin:0;overflow-wrap:anywhere}
  table{border-collapse:collapse;width:100%;margin-block:7px}th,td{text-align:start;border-bottom:1px solid #dce7e9;padding:4px}
  td.number{white-space:nowrap;font-variant-numeric:tabular-nums}.work-group h3{font-size:10.5pt}
  thead{display:table-header-group;background:#e5eef1}tr,td,th{break-inside:avoid!important;page-break-inside:avoid!important}
  .loading-sheet{table-layout:fixed;font-size:8.5pt}.loading-sheet td{height:12mm}
  .loading-sheet tbody.opening-band-0{background:#f1f6f8}.loading-sheet tbody.opening-band-1{background:#fff}
  .loading-sheet td:nth-child(2),.loading-sheet td:nth-child(n+4):nth-child(-n+8){white-space:nowrap}
  .loading-sheet td:first-child,.loading-sheet td:nth-child(3){white-space:normal;overflow-wrap:anywhere}
  .loading-sheet.delivery-sheet td:nth-child(1),.loading-sheet.delivery-sheet td:nth-child(2),.loading-sheet.delivery-sheet td:nth-child(4),.loading-sheet.delivery-sheet td:nth-child(7){white-space:normal;overflow-wrap:anywhere}.loading-sheet.delivery-sheet td:nth-child(3){white-space:nowrap}
  .loading-sheet th{font-size:8pt;overflow-wrap:normal;hyphens:none}.measurements td:first-child{overflow-wrap:anywhere}
  .drawings{display:flex;flex-wrap:wrap;gap:8px}
  figure{max-width:47%;margin:6px 0 0;break-inside:avoid}figure img{max-width:100%;max-height:66mm;object-fit:contain}
  .signoffs{display:grid;grid-template-columns:minmax(0,1fr);gap:28px;margin-block:28px 12px}
  .signoff h3{margin-block:0 15px}
  .signatures{display:flex;flex-wrap:wrap;gap:20px 16px;padding-top:12px;align-items:start}
  .signatures>div{flex:1 1 130px;border-top:1px solid #587384;padding-top:6px;min-height:39px;min-width:0;text-align:center;overflow-wrap:anywhere;break-inside:avoid}
  .signoff{break-inside:avoid}
  .loading-transport dl{grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}
  .loading-transport dd{min-height:8mm;padding-top:2mm;border-bottom:1px dotted #587384}
  .project-people{display:flex;gap:6px 22px;flex-wrap:wrap;margin-top:8px}.project-person{white-space:normal;break-inside:avoid}
  </style></head><body>${watermark?`<div class="watermark" lang="en" dir="ltr">${escape(watermark)}</div>`:""}
  <header>${logo?`<img alt="" src="${escape(logo)}">`:""}<div><strong>${escape(name)}</strong>
  ${secondary?`<div>${escape(secondary)}</div>`:""}</div></header><h1>${escape(title)}</h1>
  ${classification?`<div class="classification">${escape(classification)}</div>`:""}${body}</body></html>`;
}

function projectBlock(db,project,customer,state,order,locale,branding) {
  const t=(ar,en)=>label(ar,en,locale);
  const info=state.details;
  const buildings=[...new Set(order.items.map(item=>String(item.specification.technical.building||'').trim()).filter(Boolean))];
  const representatives=people(db,project.id).map(person=>'<span class="project-person"><bdi>'+escape(person.name)+'</bdi>'+
    (person.name&&person.position?' : ':'')+'<bdi>'+escape(person.position)+'</bdi></span>');
  const sources=new Set(order.items.map(({specification})=>specification.source_document_id||state.boq_id));
  const projectBoqs=db.all(`SELECT b.document_id,b.snapshot,d.operation_no,d.document_type FROM ops_project_boqs b
    JOIN documents d ON d.id=b.document_id WHERE b.project_id=?`,[project.id])
    .filter(({document_id})=>sources.has(document_id)).map(({snapshot,...source})=>({...JSON.parse(snapshot),...source}));
  return `<section class="project-info">${grid([
    [t("المشروع","Project"),project.name],[t("رمز المشروع","Project code"),project.code],
    [t("كود المشروع لدى العميل","Customer project code"),project.customer_project_code],
    [t("العميل","Customer"),customer.display_name],[t("الموقع","Site"),info.location],
    [t("عنوان الموقع","Site address"),info.address||project.address],[t("المبنى / القطاع","Building / sector"),buildings.length?buildings.join(" / "):info.building],
    [t("رقم الإسناد","Award no."),state.award_reference],
    [t("رقم عقد العميل أو أمر الشراء","Client contract or PO no."),info.contract_ref||project.contract_ref],
    ...projectBoqs.map((source)=>[
      source.document_type==="invoice"?t("الفاتورة","Invoice"):t("عرض السعر","Quotation"),source.operation_no,
    ]),
    [order.kind==="maintenance"?t("رقم أمر الصيانة","Maintenance order no."):t("رقم أمر التشغيل","Work order no."),order.reference],
    [t("تاريخ الأمر","Order date"),order.created_at?.slice(0,10)],
    [t("موعد التسليم","Required by"),order.required_date],[t("المخطط","Drawing number"),info.drawing_ref],
    [t("إصدار المخطط","Drawing revision"),info.drawing_revision],
  ])}${representatives.length?'<div class="project-people">'+representatives.join('')+'</div>':''}</section>`;
}

const internalFields=new Set(["measurement_status","material_status","manufacturing_status","safety_approval"]);
const partFields=['panel_measurement_basis','fixed_width_mm','fixed_height_mm','leaf_width_mm','leaf_height_mm'];
const dimensionFields=new Set(["quantity","width_mm","height_mm","depth_mm","tag","building","floor","room","drawing_ref",...partFields]);
const locks=new Set(["lock_left","lock_right","central_lock_handle","interlock_left","interlock_right"]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  return value && typeof value==="object" ? Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])])) : value;
}

const populated=(value,key)=>value!=null&&(typeof value!=="string"||value.trim()!=="")&&(!Array.isArray(value)||value.length>0||key==="perimeter");

function specificationGroups(items) {
  const buckets=new Map();
  const groups=[];
  const prepared=[];
  for (const [index,item] of items.entries()) {
    const source=item.specification;
    const technical={...source.technical};
    const spec={...source,technical};
    const shared=Object.fromEntries(Object.entries(spec.technical).filter(([key,value])=>
      !dimensionFields.has(key)&&!internalFields.has(key)&&populated(value,key)));
    const key=JSON.stringify([spec.category,spec.system]);
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
      group={spec,shared:{...shared},items:[],index};
      bucket.push(group);buckets.set(key,bucket);groups.push(group);
    }
    Object.assign(group.shared,shared);
    group.spec.technical={...group.spec.technical,...shared};
    group.index=Math.min(group.index,index);
    group.items.push({...item,reportTechnical:spec.technical,index});
  }
  return groups.sort((a,b)=>a.index-b.index).map(group=>({...group,items:group.items.sort((a,b)=>a.index-b.index)}));
}

function groupSubtotal(items,locale,{partial=0,shipment=false}={}) {
  const t=(ar,en)=>label(ar,en,locale),format=value=>new Intl.NumberFormat('en-US',{maximumFractionDigits:4}).format(value);
  const count=items.reduce((sum,item)=>sum+Number(item.quantity||0),0);
  const measured=items.filter(item=>Number(item.specification.technical.width_mm)>0&&Number(item.specification.technical.height_mm)>0);
  const area=measured.reduce((sum,item)=>sum+Number(item.quantity)*Number(item.specification.technical.width_mm)*Number(item.specification.technical.height_mm)/1e6,0);
  const totals=orderQuantities({items});
  const pairs=[[shipment?t('الفتحات المحملة كاملة','Complete openings loaded'):t('إجمالي عدد الفتحات','Opening count'),format(count)]];
  if(measured.length) pairs.push([shipment?t('مساحة الفتحات المحملة كاملة م²','Complete opening area m²'):t('المساحة التقديرية م²','Estimated area m²'),format(area)]);
  for(const amount of totals.quantities.filter(amount=>!['Pcs','m²'].includes(amount.unit)))pairs.push([t('كمية الأعمال ','Work quantity ')+unitName(amount.unit,locale),format(amount.quantity)]);
  if(partial)pairs.push([t('فتحات محملة جزئيًا','Partially loaded openings'),format(partial)]);
  return '<div class="group-subtotal">'+grid(pairs)+'</div>';
}

function groupedWork(db,items,locale,drawingSets) {
  const groups=specificationGroups(items).map(group=>{
    const drawings=[];
    for(const item of group.items)for(const drawing of drawingSets[item.index]||[])
      if(!drawings.some(stored=>stored.name===drawing.name&&Buffer.from(stored.content).equals(Buffer.from(drawing.content))))drawings.push(drawing);
    return {...group,drawings};
  });
  const t=(ar,en)=>label(ar,en,locale);
  const directionNames={right:"Right",left:"Left",top:"Top",bottom:"Bottom"};
  const text=(value)=>Array.isArray(value)?value.map((side)=>technicalText(directionNames[side]||side,locale)).join(t("، ",", ")):
    typeof value==="boolean"?value?t("نعم","Yes"):t("لا","No"):technicalText(directionNames[value]||value,locale);
  const supplemental=(tech,system)=>{
    const pairs=[];
    if (system?.tags.includes("sliding")&&Number(tech.leaves)>=2) {
      const positions=[["lock_right","يمين","Right lock"],["lock_left","شمال","Left lock"],
        ...(Number(tech.leaves)>2?[["central_lock_handle","وسط","Centre lock"]]:[])];
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
        if (frame) pairs.push([t("علب","Sub-frame")+" "+text(side),dimensionPair([frame.width,frame.depth].filter((value)=>value!=null),locale,
          tech.subframe.status==="not_deducted"&&frame.deduction!=null?" / "+t("الخصم","Deduction")+" "+frame.deduction:"")]);
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
      [t("النظام","System"),locale==="ar"&&spec.system_label?.ar===spec.system_label?.en?system?.ar:localized(spec.system_label,locale)],
      ...fieldsFor(spec.category,system,tech,true).filter(({key})=>populated(tech[key],key)&&!dimensionFields.has(key)&&!internalFields.has(key)&&!locks.has(key))
        .map((field)=>{
          const specified=items.filter((item)=>populated(item.reportTechnical[field.key],field.key));
          return [field[locale],field.key==="perimeter"?perimeterDescription(tech[field.key],locale):field.key==="coating_direction"?text(({Inside:"للداخل",Outside:"للخارج"})[tech[field.key]]||tech[field.key]):text(tech[field.key]),
            specified.length&&specified.length<items.length?t("محدد للفتحات ","Specified for openings ")+
              specified.map(({specification})=>openingDescription(specification)).join(", "):null];
        }),
    ];
    pairs.push(...supplemental(tech,system));
    const integrated=tech.integrated?.system?configuration(db,tech.integrated.category,tech.integrated.system):null;
    if (integrated) pairs.push([t("وحدة الفتح المدمجة","Integrated opening"),integrated[locale]],
      ...fieldsFor(tech.integrated.category,integrated,tech.integrated.spec,true).filter(({key})=>populated(tech.integrated.spec[key],key)&&!internalFields.has(key)&&!locks.has(key))
        .map((field)=>[field[locale],field.key==="perimeter"?perimeterDescription(tech.integrated.spec[field.key],locale):text(tech.integrated.spec[field.key])]),...supplemental(tech.integrated.spec,integrated));
    const size=(value)=>value==null?"":value;
    const hasLocation=items.some(({specification})=>["building","floor","room"].some((key)=>specification.technical[key]));
    const hasTag=items.some(({specification})=>specification.technical.tag);
    const hasWidth=items.some(({specification})=>specification.technical.width_mm!=null);
    const hasHeight=items.some(({specification})=>specification.technical.height_mm!=null);
    const hasDepth=items.some(({specification})=>specification.technical.depth_mm!=null);
    const hasDrawing=items.some(({specification})=>specification.technical.drawing_ref);
    const measuredParts=partFields.filter(key=>items.some(({specification})=>populated(specification.technical[key],key)));
    const changedDimensions=(item)=>{
      const data=item.specification.technical;
      const net=item.specification.manufacturing_dimensions;
      return net&&(Number(net.width)!==Number(data.width_mm)||Number(net.height)!==Number(data.height_mm));
    };
    const hasDeductions=items.some(changedDimensions);
    const measures=items.map((item)=>{
      const data=item.specification.technical;
      const net=item.specification.manufacturing_dimensions;
      return row([openingDescription(item.specification),...(hasTag?[data.tag]:[]),...(hasLocation?[[data.building,data.floor,data.room].filter(Boolean).join(" / ")]:[]),
        item.quantity,...(hasWidth?[size(data.width_mm)]:[]),...(hasHeight?[size(data.height_mm)]:[]),...(hasDepth?[size(data.depth_mm)]:[]),
        ...measuredParts.map(key=>text(data[key])),...(hasDrawing?[data.drawing_ref]:[]),...(hasDeductions?[changedDimensions(item)?dimensionPair([net.width,net.height],locale):""]:[])]);
    }).join("");
    const imageHtml=drawings.length?'<div class="drawings">'+drawings.map(({name,mime,content})=>mime==="application/pdf"
      ?"<p>"+escape(t("رسم مرفق بنهاية الملف","Drawing appended to the PDF"))+" · "+escape(name)+"</p>"
      :'<figure><img alt="'+escape(name)+'" src="data:'+mime+';base64,'+Buffer.from(content).toString("base64")+
        '"><figcaption>'+escape(name)+"</figcaption></figure>").join("")+"</div>":"";
    return '<section class="work-group"><p class="item-number">'+escape(t(`البند ${groupIndex+1} من ${groups.length}`,`Item ${groupIndex+1} of ${groups.length}`))+
      '</p><h3>'+escape(items.every(item=>item.specification.commercial.description===spec.commercial.description)?spec.commercial.description:system?.[locale]||categories.get(spec.category)?.[locale])+'</h3><table class="measurements"><thead>'+
      row([t("وصف الفتحة","Opening description"),...(hasTag?[t('رقم الفتحة','Opening tag')]:[]),...(hasLocation?[t("الموقع","Location")]:[]),t("العدد","Count"),...(hasWidth?[t("العرض مم","Width mm")]:[]),...(hasHeight?[t("الارتفاع مم","Height mm")]:[]),
        ...(hasDepth?[t("العمق مم","Depth mm")]:[]),...measuredParts.map(key=>fieldsFor(spec.category,system,{...tech,panel_measurement_basis:key.startsWith('leaf_')?'Operable leaf':'Fixed panel'},true).find(field=>field.key===key)?.[locale]||key),...(hasDrawing?[t("مرجع الرسم","Drawing reference")]:[]),
        ...(hasDeductions?[t("مقاس التصنيع بعد التخصيم مم","Manufacturing after deduction mm")]:[])],"th")+
      "</thead><tbody>"+measures+'</tbody></table>'+(groups.length>1?groupSubtotal(items,locale):'')+'<div class="shared-specifications">'+grid(pairs)+"</div>"+imageHtml+"</section>";
  }).join("");
}

function signatures(db,projectId,order,kind,locale,selection) {
  const t=(ar,en)=>label(ar,en,locale);
  const assigned=people(db,projectId);
  const allowed=kind==="maintenance"?[kind,"all"]:[kind,"both","all",...(kind==="delivery"?["loading"]:[])];
  const signers=new Map(assigned.filter((person)=>allowed.includes(person.signature_usage)||
    person.signature_usage&&!["manufacturing","loading","maintenance","both","all"].includes(person.signature_usage))
    .map((person)=>[person.id,{person,title:person.signature_label||person.position}]));
  const roles={loading:["مسؤول التحميل","Loading lead"],engineer:["مهندس المشروع","Project engineer"],
    reviewer:["الاستلام","Receiver"],approver:["الاعتماد","Approval"]};
  const projectSignatures=require("./core.cjs").operation(db,projectId).details.report_signatures?.[kind]??(kind==="delivery"?require("./core.cjs").operation(db,projectId).details.report_signatures?.loading:undefined);
  const globalSignatures=require('../signature-directory.cjs').defaults(db,kind);
  const saved=projectSignatures??(globalSignatures.length?globalSignatures:undefined);
  if(Array.isArray(saved)) {
    signers.clear();
    saved.forEach((person,index)=>signers.set("saved-"+index,{person,title:person.title}));
  }
  if (["loading","delivery"].includes(kind)&&!Array.isArray(saved))
    for (const [key,names] of Object.entries(roles)) {
      const custom=typeof selection?.[key]==="string"&&!idOf(selection[key])?selection[key].trim().slice(0,200):null;
      const person=assigned.find(({id})=>id===idOf(selection?.[key]))||
        (custom?{name:custom,side:key==="reviewer"?"client":"company"}:null)
        || assigned.find(({responsibility})=>responsibility===key) || order.loads[0]?.responsible?.[key];
      if (person) signers.set(person.id||person.side+":"+person.name,{person,title:person.signature_label||person.position||t(...names)});
    }
  const groups=[[" company","",true],[" client",t("العميل","Customer"),false]];
  const blocks=groups.map(([side,heading,internal])=>{
    const members=[...signers.values()].filter(({person})=>(person.side?person.side==="company":Boolean(person.user_id))===internal);
    return members.length?`<div class="signoff${side}">${heading?`<h3>${escape(heading)}</h3>`:''}<div class="signatures" style="--signers:${members.length}">${members.map(({person,title})=>
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
  ])}<table><thead>${row([t("وصف الفتحة","Opening description"),t("العدد","Count")],"th")}</thead><tbody>
    ${order.items.map((item)=>row([openingDescription(item.specification),item.quantity])).join("")}
    </tbody></table></section>`;
}

function loadingBlock(order,locale) {
  const t=(ar,en)=>label(ar,en,locale);
  const details=new Map(order.items.map((item)=>[item.id,item.specification]));
  const priority={frames:0,sliding:1,hinged:2,fixed:3,other:4,items:5,screens:6,sliding_blades:7};
  const groups=specificationGroups(order.items);
  const tables=groups.map((group,groupIndex)=>{
  const ordered=group.items.flatMap(item=>order.balances.filter(entry=>entry.order_item_id===item.id).sort((a,b)=>(priority[a.kind]??5)-(priority[b.kind]??5)));
  let last=null,band=-1;
  const rows=ordered.map((entry)=>{
    const begin=last!==entry.order_item_id;if(begin){last=entry.order_item_id;band++;}
    const spec=details.get(entry.order_item_id);
    const tech=spec.technical;
    const values=[openingDescription(spec)+(tech.tag?' · '+tech.tag:''),dimensionPair([tech.width_mm??"—",tech.height_mm??"—"],locale),t(...panelLabels[entry.kind]),
      entry.required,entry.loaded,"","",entry.remaining,""];
    return (begin?(band?'</tbody>':'')+`<tbody class="opening-band-${band%2}" data-opening="${entry.order_item_id}">`:'')+
      "<tr>"+values.map((value,index)=>'<td'+(index>2&&index<8?' class="number"':"")+'>'+valueHtml(value)+"</td>").join("")+"</tr>";
  }).join("");
  return '<h3>'+escape(t(`المجموعة ${groupIndex+1} من ${groups.length}`,`Group ${groupIndex+1} of ${groups.length}`))+'</h3>'+
    '<table class="loading-sheet"><colgroup>'+[22,14,15,8,9,8,8,9,7].map(width=>'<col style="width:'+width+'%">').join('')+'</colgroup><thead>'+row([t("وصف الفتحة","Opening description"),t("المقاس مم","Size mm"),t("المكون","Component"),t("المطلوب","Required"),
      t("المحمل سابقًا","Previous"),t("الحالي","This load"),t("التراكمي","To date"),t("المتبقي","Remaining"),t("ملاحظات / تاريخ","Notes / date")],"th")+
    "</thead>"+rows+(ordered.length?'</tbody>':'')+"</table>"+(groups.length>1?groupSubtotal(group.items,locale):'');
  }).join('');
  const frames=order.balances.filter(({kind})=>kind==="frames").reduce((sum,entry)=>sum+entry.required,0);
  const leaves=order.balances.filter(({kind})=>["sliding","hinged","other"].includes(kind)).reduce((sum,entry)=>sum+entry.required,0);
  const screens=order.balances.filter(({kind})=>kind==="screens").reduce((sum,entry)=>sum+entry.required,0);
  return '<section class="loading">'+
    '<p>'+escape(t("إجمالي الحلوق","Total frames"))+' '+frames+' · '+escape(t("إجمالي الضلف","Total leaves"))+' '+leaves+
    (screens?' · '+escape(t("إجمالي ضلف السلك","Total flyscreen leaves"))+' '+screens:'')+'</p>'+
    tables+"</section>"+loadingExtras(order,locale);
}

function loadingExtras(order,locale){
  const settings=order.loading_settings;
  if(!settings?.enabled||!settings.rows?.length)return '';
  const t=(ar,en)=>label(ar,en,locale);
  return '<section class="loading-extras"><h3>'+escape(t('بنود تحميل إضافية','Additional loading items'))+'</h3><table><thead>'+row([
    t('الفتحة','Opening'),t('البيان','Description'),t('الوحدة','Unit'),t('الكمية','Quantity')],'th')+'</thead><tbody>'+settings.rows.map(entry=>{
      const item=order.items.find(item=>item.id===Number(entry.order_item_id));
      return row([item?openingDescription(item.specification):t('عام للأمر','General'),entry.label,unitName(unitKey(entry.unit),locale),entry.quantity*(entry.per_opening&&item?item.quantity:1)]);
    }).join('')+'</tbody></table></section>';
}

function loadingTransportBlock(order,locale){
  const transport=order.loading_transport||{};
  return '<section class="loading-transport"><dl>'+[
    [label('رقم السيارة','Vehicle license plate',locale),transport.vehicle_plate],
    [label('اسم السائق','Driver name',locale),transport.driver_name],
  ].map(([name,value])=>'<div><dt>'+escape(name)+'</dt><dd><bdi dir="auto">'+escape(value||'')+'</bdi></dd></div>').join('')+'</dl></section>';
}

function orderSummary(order,locale){
  const totals=orderQuantities(order),t=(ar,en)=>label(ar,en,locale);
  const format=value=>new Intl.NumberFormat('en-US',{maximumFractionDigits:4}).format(value);
  const area=order.items.reduce((sum,item)=>{const tech=item.specification.technical;return sum+(Number(tech.width_mm)>0&&Number(tech.height_mm)>0?item.quantity*tech.width_mm*tech.height_mm/1e6:0);},0);
  const quantities=totals.quantities.map(item=>'<span class="order-unit-total"><bdi dir="ltr">'+format(item.quantity)+'</bdi><bdi>'+escape(unitName(item.unit,locale))+'</bdi></span>').join('');
  return '<section class="order-summary"><table><tbody><tr><th>'+escape(t('إجمالي الأمر','Order total'))+'</th><td>'+escape(t('العدد','Count'))+
    ' <bdi dir="ltr">'+format(totals.count)+'</bdi></td><td>'+escape(t('كمية الأعمال','Work quantity'))+' '+(quantities||'—')+'</td>'+(area?'<td>'+escape(t('المساحة التقديرية م²','Estimated area m²'))+' <bdi dir="ltr">'+format(area)+'</bdi></td>':'')+'</tr></tbody></table></section>';
}

function approvalReport(db,order,locale) {
  const t=(ar,en)=>label(ar,en,locale),stages={measurement:['المقاسات','Measurements'],profile:['القطاعات','Profiles'],glass:['الزجاج','Glass'],accessories:['الإكسسوارات','Accessories'],finish:['التشطيب','Finish'],details:['التفاصيل','Details'],drawing:['الرسومات','Drawings'],manufacturing:['التصنيع','Manufacturing'],pre_shipment:['الشحن','Shipment']};
  const matrix=order.items.map(item=>row([item.specification.technical.tag||'',openingDescription(item.specification),...order.stage_approvals.map(stage=>{const approved=stage.items.find(row=>row.id===item.id);return approved?.approved&&!approved.stale?'✓':'';})])).join('');
  const blocks=order.stage_approvals.map(stage=>'<div><strong>'+escape(t(...stages[stage.stage]))+'</strong><div class="approval-sign-line"></div>'+(stage.people||[]).map(person=>'<bdi>'+escape(person.name)+'</bdi>'+(person.title?'<small>'+escape(person.title)+'</small>':'')+(person.date?'<small dir="ltr">'+escape(String(person.date).slice(0,10))+'</small>':'')).join('')+'</div>').join('');
  return '<style>@page{size:A4 landscape}.approval-matrix{table-layout:fixed;font-size:8pt}.approval-matrix th,.approval-matrix td{text-align:center;overflow-wrap:anywhere;padding:4px}.approval-matrix th:nth-child(2),.approval-matrix td:nth-child(2){text-align:start}.approval-signatures{display:flex;flex-wrap:wrap;gap:20px 24px;break-inside:avoid;margin-top:22px}.approval-signatures>div{flex:1 1 calc((100% - 96px)/5);min-width:150px;text-align:center;break-inside:avoid}.approval-signatures small{display:block}.approval-sign-line{border-bottom:1px solid #789;margin:20px 0 5px}</style><section class="loading"><table class="approval-matrix"><colgroup><col style="width:7%"><col style="width:25%">'+order.stage_approvals.map(()=>'<col>').join('')+'</colgroup><thead>'+row(['Tag',t('البيان','Description'),...order.stage_approvals.map(stage=>t(...stages[stage.stage]))],'th')+'</thead><tbody>'+matrix+'</tbody></table></section><div class="approval-signatures">'+blocks+'</div>';
}

function reportFilename(customer,order,options) {
  const ar=options.locale==="ar";
  const stage=order.kind==="maintenance"?(ar?"صيانة":"Maintenance"):options.kind==="approvals"?(ar?"حالة الاعتمادات":"Approval Status"):
    options.kind==="delivery"?(ar?"إذن تسليم":"Delivery Note"):options.kind==="loading"?(ar?"تحميل":"Loading"):options.classification==="manufacturing"?(ar?"تصنيع":"Manufacturing"):(ar?"طلب خامات":"Material Requisition");
  const safe=(value)=>String(value||"").replace(/[\\/:*?"<>|\u0000-\u001f]/g,"_").replace(/[. ]+$/g,"").slice(0,90);
  return safe(customer.display_name||customer.name)+" - "+safe(["loading","delivery"].includes(options.kind)?order.loading_reference||order.reference:order.reference)+" - "+stage+".pdf";
}

function report(db,state,rawOrder,options,branding) {
  const locale=options.locale==="ar"?"ar":"en";
  const t=(ar,en)=>label(ar,en,locale);
  const project=getProject(db,state.project_id);
  const customer=getCustomer(db,project.customer_id);
  const order=orderDetails(db,rawOrder);
  if(options.kind==='loading'&&rawOrder.loading_reference){
    order.loading_reference=rawOrder.loading_reference;
    order.loading_transport=db.get('SELECT * FROM ops_loading_orders WHERE order_id=? AND reference=?',[order.id,rawOrder.loading_reference]);
    if(rawOrder.loading_after_load_id!=null)order.balances=require('./production.cjs').loadingBalances(db,order.id,rawOrder.loading_after_load_id);
  }
  if (order.kind==="maintenance") {
    const body=projectBlock(db,project,customer,state,order,locale,branding)+maintenanceBlock(order,locale)+
      signatures(db,project.id,order,"maintenance",locale);
    return {html:wrap({locale,branding,title:t("تقرير الصيانة","Maintenance Report"),color:"#7992a3",body}),pdfDrawings:[]};
  }
  const loading=options.kind==="loading";
  const approvals=options.kind==="approvals";
  const approved=options.classification==="manufacturing";
  if (!loading&&!approvals&&approved&&!order.stage_approvals.find(({stage})=>stage==="manufacturing")?.approved)
    fail(409,"Approve the manufacturing stage before generating this order",{approval_required:true});
  const classification="";
  const title=approvals?t("حالة الاعتمادات","Approval Status"):loading?t("أمر تحميل","Loading Order")+" "+(order.loading_reference||order.reference):
    approved?t("أمر تصنيع","Manufacturing Order"):t("طلب توريد الخامات","Material Requisition");
  const drawingSets=!loading && !approvals && options.drawings===true ? order.items.map((item)=>eligibleDrawings(db,item)) : [];
  const body=projectBlock(db,project,customer,state,order,locale,branding)+(approvals?approvalReport(db,order,locale):loading?loadingBlock(order,locale):
    groupedWork(db,order.items,locale,drawingSets))+(!approvals?orderSummary(order,locale):'')+(loading?loadingTransportBlock(order,locale):'')+
    (approvals?'':signatures(db,project.id,order,loading?"loading":"manufacturing",locale,options.people));
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

function snapshotReport(db,state,order,locale,branding){const t=(ar,en)=>locale==='ar'?ar:en,approved=order.stage_approvals?.find(stage=>stage.stage==='manufacturing')?.approved,project=getProject(db,state.project_id),customer=getCustomer(db,project.customer_id),drawingSets=order.items.map(item=>eligibleDrawings(db,item));const body=projectBlock(db,project,customer,state,order,locale,branding)+groupedWork(db,order.items,locale,drawingSets)+orderSummary(order,locale)+signatures(db,project.id,order,'manufacturing',locale);return {html:wrap({locale,branding,title:t('أمر تشغيل — إصدار سابق','Work Order — previous version')+' '+order.reference,color:approved?'#90bc94':'#d5a1a1',body}),pdfDrawings:drawingSets.flat().filter(drawing=>drawing.mime==='application/pdf')};}

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

module.exports={report,appendDrawings,reportFilename,wrap,escape,grid,row,dimensionPair,orderSummary,loadingTransportBlock,projectBlock,signatures,panelLabels,specificationGroups,groupSubtotal,snapshotReport};
