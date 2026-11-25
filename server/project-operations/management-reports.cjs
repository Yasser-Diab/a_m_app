const {onSite}=require('./maintenance.cjs');
const {scopeSql,parse,idOf,date,fail,lookup,today}=require("../certificate-access.cjs");
const {approvalParts,frameQuantity,screenQuantity,configuration}=require("./specifications.cjs");
const {wrap,escape,row,stageHeader,grid,dimensionPair}=require("./reports.cjs");
const {pageOptions}=require("./core.cjs");
const {unitKey,unitName}=require('./order-quantities.cjs');
const stages={installation:["التركيب","Installation"],specifications:["استكمال المواصفات","Specifications"],measurement:["اعتماد المقاسات","Measurements"],
  materials:["اعتماد الخامات","Materials"],manufacturing:["التصنيع","Manufacturing"],qc:["فحص ما قبل الشحن","Pre-shipment QC"],
  loading:["التحميل","Loading"],maintenance:["الصيانة","Maintenance"],completed:["مكتمل","Completed"],review:["مراجعة التعديلات","Changes to review"],rejected:["مرفوض","Rejected"]};
const components={sliding_blades:["سكينة جرار","Sliding blades"],frames:["حلوق","Frames"],screens:["ضلف سلك","Flyscreen leaves"],sliding:["ضلف جرار","Sliding leaves"],
  hinged:["ضلف مفصلي","Hinged leaves"],fixed:["ثوابت","Fixed panels"],other:["ضلف أخرى","Other leaves"],items:["وحدات","Items"]};
const round=value=>Math.round((value+Number.EPSILON)*1e6)/1e6;
const format=value=>value==null?"—":new Intl.NumberFormat("en-US",{maximumFractionDigits:4}).format(value);
function projectRows(db,access,query={}){
  const scope=scopeSql(access,"p.id"),project=idOf(query.project_id),customer=idOf(query.customer_id),q=lookup(query.q);
  const rows=db.all(`SELECT p.id,p.name,p.code,p.customer_id,p.created_at,c.created_at AS customer_created_at,c.display_name AS customer,o.details
    FROM ops_projects o JOIN cert_projects p ON p.id=o.project_id JOIN parties c ON c.id=p.customer_id
    WHERE ${scope.clause} AND (? IS NULL OR p.id=?) AND (? IS NULL OR p.customer_id=?)
    ORDER BY p.created_at DESC,p.id DESC`,[...scope.params,project,project,customer,customer]);
  if(project&&!rows.length)fail(404,"Operational project not found");
  return rows.map(item=>({...item,details:parse(item.details,{})})).filter(item=>!q||[item.name,item.code,item.customer].some(value=>lookup(value).includes(q)));
}
function reportOptions(db,access){
  const projects=projectRows(db,access);
  return {projects:projects.map(({id,name,code,customer_id,customer})=>({id,name,code,customer_id,customer})),
    customers:[...new Map(projects.map(project=>[project.customer_id,{id:project.customer_id,name:project.customer,created_at:project.customer_created_at}])).values()]
      .sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))||b.id-a.id)};
}
function grouped(rows,key){const result=new Map();for(const item of rows){const entries=result.get(item[key])||[];entries.push(item);result.set(item[key],entries);}return result;}
function sourceData(db,projects){
  const ids=JSON.stringify(projects.map(({id})=>id)),inside="IN (SELECT value FROM json_each(?))";
  const items=db.all(`SELECT id,code,project_id,source_document_id,active,version,category,system,technical,commercial FROM ops_items WHERE project_id ${inside}`,[ids])
    .map(item=>({...item,technical:parse(item.technical,{}),commercial:parse(item.commercial,{})}));
  const orders=db.all(`SELECT * FROM ops_orders WHERE project_id ${inside} ORDER BY id DESC`,[ids]);
  const openings=db.all(`SELECT oi.*,o.project_id,o.status,o.kind,o.service_data FROM ops_order_items oi JOIN ops_orders o ON o.id=oi.order_id
    WHERE o.project_id ${inside}`,[ids]).map(item=>{
      const quantities=parse(item.quantities,{}),specification=parse(item.specification,{}),technical=specification.technical||{};
      if(Object.keys(quantities).length){
        if(['draft','released'].includes(item.status)&&quantities.sliding>0&&!Object.hasOwn(quantities,'sliding_blades'))quantities.sliding_blades=quantities.sliding;
        if(!Object.hasOwn(quantities,"frames")){const n=frameQuantity(specification.category,configuration(db,specification.category,specification.system),technical,item.quantity);if(n)quantities.frames=n;}
        if(["draft","released"].includes(item.status)&&!Object.hasOwn(quantities,"screens")){
          const n=Object.hasOwn(technical.panel_counts||{},"screens")?technical.panel_counts.screens*item.quantity:screenQuantity(specification.category,technical,item.quantity);
          if(n)quantities.screens=n;
        }
      }
      return {...item,quantities,specification};
    });
  const loads=db.all(`SELECT l.*,b.loading_date,b.order_id,b.reference,o.project_id,o.status FROM ops_load_lines l JOIN ops_loads b ON b.id=l.load_id
    JOIN ops_orders o ON o.id=b.order_id WHERE o.project_id ${inside} ORDER BY b.loading_date,b.id`,[ids]);
  return {items,orders,openings,loads,ids,itemsByProject:grouped(items,"project_id"),ordersByProject:grouped(orders,"project_id"),
    openingsByProject:grouped(openings,"project_id"),loadsByProject:grouped(loads,"project_id"),loadsByOpening:grouped(loads,"order_item_id")};
}
function runningProjects(db,access,query={},all=false){
  const projects=projectRows(db,access,query),data=sourceData(db,projects);
  const approvals=db.all(`SELECT a.* FROM ops_item_approvals a JOIN ops_items i ON i.id=a.item_id
    WHERE i.project_id IN (SELECT value FROM json_each(?)) AND a.item_version=i.version`,[data.ids]);
  const inspections=db.all(`SELECT q.* FROM ops_inspections q JOIN ops_order_items oi ON oi.id=q.order_item_id JOIN ops_orders o ON o.id=oi.order_id
    WHERE o.project_id IN (SELECT value FROM json_each(?)) ORDER BY q.id DESC`,[data.ids]);
  const reviews=db.all(`SELECT r.* FROM ops_order_reviews r JOIN ops_order_items oi ON oi.id=r.order_item_id JOIN ops_orders o ON o.id=oi.order_id
    WHERE o.project_id IN (SELECT value FROM json_each(?))`,[data.ids]);
  const installations=db.all(`SELECT x.*,oi.order_id FROM ops_installations x JOIN ops_order_items oi ON oi.id=x.order_item_id JOIN ops_orders o ON o.id=oi.order_id WHERE o.project_id IN (SELECT value FROM json_each(?))`,[data.ids]);
  const assigned=db.all(`SELECT a.*,o.project_id,o.reference FROM ops_stage_assignments a JOIN ops_orders o ON o.id=a.order_id WHERE o.project_id IN (SELECT value FROM json_each(?))`,[data.ids]);
  const actors=db.all(`SELECT a.project_id,a.entity_id,a.action,a.details,u.display_name,u.username FROM ops_audit a LEFT JOIN users u ON u.id=a.actor_id WHERE a.project_id IN (SELECT value FROM json_each(?)) ORDER BY a.id DESC`,[data.ids]);
  const parts=new Map(),qc=new Map(),decisions=new Map(),byId=new Map(data.items.map(item=>[item.id,item]));
  approvals.forEach(item=>{const set=parts.get(item.item_id)||new Set();set.add(item.part);parts.set(item.item_id,set);});
  inspections.forEach(item=>{const record=parse(item.record,{}),key=item.order_item_id+":"+record.item_version+":"+item.stage;
    if(!qc.has(key))qc.set(key,record.release==="approved");});
  reviews.forEach(item=>decisions.set(item.order_item_id+":"+item.item_version+":"+item.stage,item.approved));
  const seenItems=new Set(approvals.map(item=>item.item_id)),seenOrders=new Set();
  for(const entry of db.all(`SELECT action,entity_id,details FROM ops_audit WHERE project_id IN (SELECT value FROM json_each(?))
    AND action IN('manufacturing_components_reviewed','order_stage_approved')`,[data.ids])){
    if(entry.action==='order_stage_approved')seenOrders.add(entry.entity_id);
    else if(parse(entry.details,{}).decisions?.length)seenItems.add(entry.entity_id);
  }
  const orderStates=new Map();
  const openingsByOrder=grouped(data.openings,'order_id'),openingsByItem=grouped(data.openings,'item_id');
  const withdrawn=new Set(reviews.filter(review=>review.approved===0).map(review=>review.order_item_id+':'+review.item_version));
  for(const order of data.orders){
    const rows=openingsByOrder.get(order.id)||[];
    const started=onSite(order)||seenOrders.has(order.id)||rows.some(row=>seenItems.has(row.item_id));
    const rejected=started&&!onSite(order)&&rows.some(row=>withdrawn.has(row.id+':'+byId.get(row.item_id)?.version));
    orderStates.set(order.id,{started,rejected});
  }
  const records=projects.map(project=>{
    const allItems=data.itemsByProject.get(project.id)||[],allOrders=data.ordersByProject.get(project.id)||[],allOpenings=data.openingsByProject.get(project.id)||[];
    const orders=allOrders.filter(order=>orderStates.get(order.id)?.started&&!(query.exclude_rejected==='1'&&orderStates.get(order.id)?.rejected));
    const orderIds=new Set(orders.map(order=>order.id));
    const projectOpenings=allOpenings.filter(item=>orderIds.has(item.order_id)),openings=projectOpenings.filter(item=>!onSite(item));
    const includedSources=new Set(projectOpenings.map(item=>byId.get(item.item_id)?.source_document_id));
    for(const item of allItems)if(seenItems.has(item.id)&&!openingsByItem.has(item.id))includedSources.add(item.source_document_id);
    const items=allItems.filter(item=>item.active&&includedSources.has(item.source_document_id));
    if(!items.length&&!orders.length)return null;
    const rejected=orders.length?orders.every(order=>orderStates.get(order.id)?.rejected):items.some(item=>seenItems.has(item.id))&&!items.some(item=>parts.get(item.id)?.size);
    if(query.exclude_rejected==='1'&&rejected)return null;
    const counts={items:items.length,specifications:items.filter(item=>item.system).length,measurement:0,materials:0,
      manufacturing:0,qc:0,ordered:0,required:0,loaded:0,stale:0,maintenance:orders.filter(order=>onSite(order)&&order.status!=="closed").length};
    for(const item of items){const approved=parts.get(item.id)||new Set();if(approved.has("measurement"))counts.measurement++;
      if(["profile","glass","accessories","finish"].every(key=>approved.has(key)))counts.materials++;}
    for(const opening of openings){
      counts.ordered+=opening.quantity;counts.required+=Object.values(opening.quantities).reduce((sum,value)=>sum+Number(value||0),0);
      const current=byId.get(opening.item_id),version=opening.specification.version;
      if(!current?.active||current.version!==version){counts.stale++;continue;}
      if(["released","shipped","closed"].includes(opening.status)&&approvalParts.every(part=>parts.get(current.id)?.has(part))&&
        decisions.get(opening.id+":"+version+":manufacturing")!==0)counts.manufacturing+=opening.quantity;
      if(qc.get(opening.id+":"+version+":pre_shipment"))counts.qc+=opening.quantity;
    }
    counts.delivered=openings.reduce((sum,opening)=>{const loaded={};for(const line of data.loadsByOpening.get(opening.id)||[])loaded[line.kind]=(loaded[line.kind]||0)+line.quantity;return sum+completedOpenings(opening.quantities,loaded,opening.quantity);},0);
    counts.loaded=(data.loadsByProject.get(project.id)||[]).filter(load=>orderIds.has(load.order_id)).reduce((sum,load)=>sum+load.quantity,0);
    counts.installed=installations.filter(entry=>orderIds.has(entry.order_id)).reduce((sum,entry)=>sum+entry.quantity,0);
    const fullyOrdered=items.length>0&&items.every(item=>item.technical.quantity>0&&projectOpenings.filter(opening=>opening.item_id===item.id)
      .reduce((sum,opening)=>sum+opening.quantity,0)>=item.technical.quantity);
    const onsiteComplete=orders.filter(onSite).every(order=>Boolean(parse(order.service_data,{}).completed_on));
    const servicesOnlyComplete=orders.length>0&&orders.every(order=>onSite(order)&&Boolean(parse(order.service_data,{}).completed_on));
    const completed=servicesOnlyComplete||/^(مكتمل|مغلق|ملغي|completed|closed|cancelled)$/i.test(project.details.status||"")||fullyOrdered&&counts.ordered>0&&counts.installed===counts.ordered&&onsiteComplete;
    const stage=rejected?'rejected':completed?"completed":counts.stale?"review":counts.maintenance&&!openings.length?"maintenance":
      !counts.items||counts.specifications<counts.items?"specifications":counts.measurement<counts.items?"measurement":counts.materials<counts.items?"materials":
      !counts.ordered||counts.manufacturing<counts.ordered?"manufacturing":counts.qc<counts.ordered?"qc":counts.required>0&&counts.loaded>=counts.required?"installation":"loading";
    const manualStages=orders.filter(order=>order.status!=='closed'&&Object.entries(parse(order.service_data,{}).workflow_versions||{}).every(([id,version])=>byId.get(Number(id))?.version===version)).map(order=>parse(order.service_data,{}).workflow_stage).filter(key=>Object.hasOwn(stages,key));
    const active_stages=[...new Set([...manualStages,stage])];if(counts.delivered>counts.installed&&!active_stages.includes('installation'))active_stages.push('installation');
    const responsibilities=Object.fromEntries(['specifications','measurement','materials','manufacturing','qc','loading','installation','maintenance'].map(key=>{
      const explicit=assigned.filter(row=>row.project_id===project.id&&orderIds.has(row.order_id)&&row.stage===key).flatMap(row=>(parse(row.data,{}).assignees||[]).map(person=>({...person,order:row.reference})));
      if(explicit.length)return [key,explicit];
      if(key==='loading'){const latest=db.get('SELECT responsible FROM ops_loads WHERE order_id IN (SELECT value FROM json_each(?)) ORDER BY id DESC LIMIT 1',[JSON.stringify([...orderIds])]);const loading=parse(latest?.responsible,{}).loading;return [key,loading?.name?[{name:loading.name,title:loading.position||''}]:[]];}
      if(['qc','measurement'].includes(key)){const inspection=inspections.find(row=>orderIds.has(data.openings.find(item=>item.id===row.order_item_id)?.order_id)&&row.stage===(key==='qc'?'pre_shipment':'survey'));return [key,inspection?.inspector_name?[{name:inspection.inspector_name,title:''}]:[]];}
      return [key,[]];
    }));
    return {...project,counts,stage:!completed&&!rejected&&!counts.stale&&manualStages.length?manualStages[0]:stage,active_stages,responsibilities,completed,has_rejected:rejected||orders.some(order=>orderStates.get(order.id)?.rejected),orders:orders.map(order=>({id:order.id,reference:order.reference,rejected:orderStates.get(order.id)?.rejected})),loading_percent:counts.required?round(Math.min(100,counts.loaded/counts.required*100)):0};
  }).filter(item=>item&&(item.has_rejected||query.include_completed===true||query.include_completed==="1"||!item.completed));
  const selected=String(query.stages||'').split(',').filter(stage=>Object.hasOwn(stages,stage));
  const filtered=selected.length?records.filter(item=>item.active_stages.some(stage=>selected.includes(stage))):records;
  const paging=pageOptions(query);
  return {items:all?filtered:filtered.slice(paging.offset,paging.offset+paging.limit),total:filtered.length,page:paging.page,limit:paging.limit};
}
function completedOpenings(required,counts,quantity){
  const parts=Object.entries(required).filter(([,value])=>Number(value)>0);
  return parts.length?Math.min(quantity,...parts.map(([kind,value])=>Math.floor((Number(counts[kind]||0)+1e-8)/(Number(value)/quantity)))):0;
}
function workQuantities(db,access,query={},all=false){
  const mode=["project","customer","loading"].includes(query.mode)?query.mode:"project";
  if(mode==="project"&&!idOf(query.project_id))fail(400,"Select a project");
  if(mode==="customer"&&!idOf(query.customer_id))fail(400,"Select a customer");
  const from=mode==="loading"?date(query.from,true):null,to=mode==="loading"?(date(query.to,true)||today()):null;
  if(from&&to&&from>to)fail(400,"The end date precedes the start date");
  const projects=projectRows(db,access,query),byId=new Map(projects.map(project=>[project.id,project])),data=sourceData(db,projects),records=[];
  const makeRow=(item,values={})=>{const project=byId.get(item.project_id),technical=item.technical||{},commercial=item.commercial||{};
    return {key:item.id,project_id:project.id,project:project.name,project_code:project.code,customer:project.customer,
      description:commercial.description,tag:technical.tag||item.code||"",category:item.category,unit:unitKey(commercial.unit||commercial.unit_code),
      quantity:commercial.quantity==null?null:Number(commercial.quantity),count:technical.quantity??null,
      width_mm:technical.width_mm??null,height_mm:technical.height_mm??null,
      estimated_area:[technical.quantity,technical.width_mm,technical.height_mm].every(value=>value!=null)?round(technical.quantity*technical.width_mm*technical.height_mm/1e6):null,...values};};
  if(mode!=="loading")for(const item of data.items.filter(item=>item.active))records.push(makeRow(item));
  else for(const opening of data.openings.filter(item=>!onSite(item)&&["released","shipped","closed"].includes(item.status))){
    const selected=(data.loadsByOpening.get(opening.id)||[]).filter(load=>load.loading_date<=to),before={},after={},loaded={};
    for(const load of selected){after[load.kind]=(after[load.kind]||0)+load.quantity;
      if(from&&load.loading_date<from)before[load.kind]=(before[load.kind]||0)+load.quantity;
      else loaded[load.kind]=(loaded[load.kind]||0)+load.quantity;}
    if(!Object.keys(loaded).length)continue;
    const required=opening.quantities,spec=opening.specification,technical=spec.technical||{};
    const count=completedOpenings(required,after,opening.quantity)-completedOpenings(required,before,opening.quantity);
    const perOpening=Number(technical.quantity)>0&&spec.commercial.quantity!=null?Number(spec.commercial.quantity)/Number(technical.quantity):null;
    records.push(makeRow({...spec,id:opening.id,project_id:opening.project_id},{key:"loaded-"+opening.id,order:data.orders.find(order=>order.id===opening.order_id)?.reference,
      loading_references:[...new Set(selected.filter(load=>!from||load.loading_date>=from).map(load=>load.reference))],
      count,quantity:perOpening==null?null:round(perOpening*count),components:loaded,
      estimated_area:technical.width_mm!=null&&technical.height_mm!=null?round(count*technical.width_mm*technical.height_mm/1e6):null}));
  }
  const quantities=new Map(),totals={quantities:[],count:null,estimated_area:null,components:{}};
  for(const item of records){if(item.quantity!=null&&item.unit)quantities.set(item.unit,round((quantities.get(item.unit)||0)+item.quantity));
    if(item.count!=null)totals.count=Number(totals.count||0)+Number(item.count);
    if(item.estimated_area!=null)totals.estimated_area=Number(totals.estimated_area||0)+Number(item.estimated_area);
    for(const [kind,value]of Object.entries(item.components||{}))totals.components[kind]=(totals.components[kind]||0)+value;}
  totals.quantities=[...quantities].map(([unit,quantity])=>({unit,quantity}));
  if(totals.count!=null)totals.count=round(totals.count);if(totals.estimated_area!=null)totals.estimated_area=round(totals.estimated_area);
  const paging=pageOptions(query);
  const scope={customer:idOf(query.customer_id)||idOf(query.project_id)?projects[0]?.customer:null,
    project:idOf(query.project_id)&&projects[0]?projects[0].code+' · '+projects[0].name:null};
  return {mode,from,to,scope,items:all?records:records.slice(paging.offset,paging.offset+paging.limit),total:records.length,page:paging.page,limit:paging.limit,totals};
}
function managementReport(kind,data,options,branding){
  const locale=options.locale==="ar"?"ar":"en",t=(ar,en)=>locale==="ar"?ar:en;let body,title;
  if(kind==="progress"){
    title=t("موقف أعمال التشغيل","Current Work Summary");
    const ratio=(value,total)=>total?value+'/'+total:'—';
    const owners=String(options.responsibles||'').split(',').filter(stage=>Object.hasOwn(stages,stage));
    const ownerText=(item,key)=>owners.includes(key)?(item.responsibilities[key]||[]).map(person=>[person.name,person.title,person.order].filter(Boolean).join(' · ')).join(' / '):'';
    const selected=String(options.stages||'').split(',').filter(key=>Object.hasOwn(stages,key));
    body='<section>'+grid([[t('تاريخ التقرير','Report date'),today()],[t('المشروعات','Projects'),data.total],[t('المراحل','Stages'),selected.length?selected.map(key=>t(...stages[key])).join(' / '):t('تقرير عام — كل المراحل','General report — all stages')]])+'</section>'+
      '<section class="loading"><table class="progress-table" style="table-layout:fixed"><colgroup><col style="width:22%"><col style="width:15%">'+Array.from({length:7},()=>'<col style="width:9%">').join('')+'</colgroup><thead>'+stageHeader([t('المشروع / العميل','Project / customer'),t('المرحلة الحالية','Current stage'),t('المواصفات','Specifications'),t('المقاسات','Measurements'),t('الخامات','Materials'),t('التصنيع','Manufacturing'),t('الفحص','QC'),t('التحميل','Loading'),t('التركيب','Installation')])+'</thead><tbody>'+
      data.items.map(item=>row([item.code+' · '+item.name+' / '+item.customer+(item.orders?.length?'\n'+item.orders.map(order=>order.reference+(order.rejected?' ('+t(...stages.rejected)+')':'')).join(' / '):''),[t(...stages[item.stage]),item.details.status,ownerText(item,'maintenance')].filter(Boolean).join('\n'),
        ...[['specifications',ratio(item.counts.specifications,item.counts.items)],['measurement',ratio(item.counts.measurement,item.counts.items)],['materials',ratio(item.counts.materials,item.counts.items)],['manufacturing',ratio(item.counts.manufacturing,item.counts.ordered)],['qc',ratio(item.counts.qc,item.counts.ordered)],['loading',item.counts.required?format(item.loading_percent)+'%':'—'],['installation',ratio(item.counts.installed,item.counts.ordered)]].map(([key,value])=>[value,ownerText(item,key)].filter(Boolean).join('\n'))])).join('').replaceAll('\n','<br>')+'</tbody></table></section><style>@page{size:A4 landscape}.progress-table th{font-size:8pt}.progress-table td,.progress-table th{vertical-align:top}.progress-table th{vertical-align:middle;overflow-wrap:normal;word-break:normal;hyphens:none}.progress-table td{overflow-wrap:anywhere;font-size:8pt}</style>';
  }else{
    title=t("حصر كميات الأعمال","Work Quantity Takeoff");const loaded=data.mode==="loading";
    body='<section>'+grid([[t("النطاق","Scope"),loaded?t("التحميل المؤكد","Confirmed loading"):data.mode==="customer"?t("العميل","Customer"):t("المشروع بالكامل","Whole project")],
      [t("العميل","Customer"),data.scope.customer],[t("المشروع","Project"),data.scope.project],
      [t("من","From"),data.from],[t("حتى","Through"),data.to],[t("الكميات","Quantities"),data.totals.quantities.map(item=>format(item.quantity)+' '+unitName(item.unit,locale)).join(' + ')],
      [loaded?t("الفتحات المكتملة التحميل","Complete loaded openings"):t("العدد الفني","Technical count"),format(data.totals.count)],
      [t("المساحة التقديرية م²","Estimated area m²"),format(data.totals.estimated_area)]])+'</section>'+
      (loaded?'<section>'+grid(Object.entries(data.totals.components).map(([kind,value])=>[t(...components[kind]),format(value)]))+
        '<p>'+escape(t("تُحصر كميات الفتحات المكتملة بعد تحميل جميع مكوناتها. تظهر مكونات التحميل الجزئي منفصلة.","Complete opening quantities require all their components to be loaded. Partial loading components are shown separately."))+'</p></section>':'')+
      '<section class="loading"><table><thead>'+row([t("المشروع","Project"),t("البند / الفتحة","Item / opening"),...(loaded?[t("أمر التشغيل","Work order")]:[]),
        t("كمية الأعمال","Work quantity"),t("الوحدة","Unit"),t("العدد","Count"),t("العرض × الارتفاع مم","Width × height mm"),t("المساحة التقديرية م²","Estimated area m²")],"th")+
      '</thead><tbody>'+data.items.map(item=>row([item.project_code+' · '+item.project,item.tag+' · '+item.description,...(loaded?[[item.order,...item.loading_references].join(' / ')]:[]),format(item.quantity),unitName(item.unit,locale),
        format(item.count),item.width_mm!=null&&item.height_mm!=null?dimensionPair([format(item.width_mm),format(item.height_mm)],locale):'',format(item.estimated_area)])).join('')+'</tbody></table></section>';
  }
  return wrap({locale,branding,title,color:"#adc4cf",body}).replace('</style>','bdi[dir="ltr"]{white-space:nowrap;font-variant-numeric:tabular-nums}</style>');
}
module.exports={reportOptions,runningProjects,workQuantities,managementReport,stages,components,unitName,completedOpenings};
