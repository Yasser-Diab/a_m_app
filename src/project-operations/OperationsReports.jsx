import {useEffect,useRef,useState} from "react";
import {queryString,useDebounce,useResource,localDate} from "../certificates/shared.jsx";
import {DimensionPair,ErrorMessage,Page,Pick,Table,Text,display,panelNames,quantity} from "./shared.jsx";

const stageNames={specifications:["استكمال المواصفات","Specifications"],measurement:["اعتماد المقاسات","Measurements"],materials:["اعتماد الخامات","Materials"],
  manufacturing:["التصنيع","Manufacturing"],qc:["فحص ما قبل الشحن","Pre-shipment QC"],loading:["التحميل","Loading"],maintenance:["الصيانة","Maintenance"],
  completed:["مكتمل","Completed"],review:["مراجعة التعديلات","Changes to review"]};
const unit=(name,locale)=>locale==="ar"?({"m²":"م²","l.m":"م.ط",Pcs:"عدد",kg:"كجم"}[name]||name):name;

export function PdfOutput({kind,filters,apiBase,session,t,uiLanguage,can,saveNativeReport,shareNativeReport,disabled,endpoint,reportType='project-operations'}) {
  const [pdf,setPdf]=useState(null),[error,setError]=useState(null),[busy,setBusy]=useState(false);
  const [reportLanguage,setReportLanguage]=useState(uiLanguage);
  const abort=useRef(null),frame=useRef(null);
  const filterKey=JSON.stringify(filters);
  useEffect(()=>{abort.current?.abort();setPdf(null);setBusy(false);},[filterKey,endpoint]);
  useEffect(()=>()=>abort.current?.abort(),[]);
  useEffect(()=>()=>{if(pdf)URL.revokeObjectURL(pdf.url);},[pdf]);
  async function preview(){
    abort.current?.abort();const controller=new AbortController();abort.current=controller;setBusy(true);setError(null);
    try{
      const response=await fetch(`${apiBase.replace(/\/$/,"")}${endpoint||`/api/project-operations/reports/${kind}/pdf`}`,{method:"POST",signal:controller.signal,
        headers:{"Content-Type":"application/json",Authorization:`Bearer ${session}`},body:JSON.stringify({...filters,locale:reportLanguage})});
      if(!response.ok)throw new Error((await response.json().catch(()=>null))?.error||`HTTP ${response.status}`);
      const blob=await response.blob(),disposition=response.headers.get("content-disposition")||"";
      const encoded=disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const name=encoded?decodeURIComponent(encoded):disposition.match(/filename="([^"]+)"/)?.[1]||kind+".pdf";
      if(!controller.signal.aborted)setPdf({blob,name,url:URL.createObjectURL(blob)});
    }catch(cause){if(!controller.signal.aborted)setError(cause);}finally{if(!controller.signal.aborted)setBusy(false);}
  }
  async function output(print=false){
    try{
      const bytes=new Uint8Array(await pdf.blob.arrayBuffer());
      if(print&&window.priceOfferDesktop?.openReportPreview)await window.priceOfferDesktop.openReportPreview({bytes,fileName:pdf.name});
      else if(!print&&window.priceOfferDesktop?.saveReportFile)await window.priceOfferDesktop.saveReportFile({bytes,fileName:pdf.name,format:"pdf",reportType});
      else if(print&&shareNativeReport)await shareNativeReport(pdf.blob,pdf.name);
      else if(!print&&saveNativeReport)await saveNativeReport(pdf.blob,pdf.name,{reportType});
      else if(print){frame.current?.contentWindow?.focus();frame.current?.contentWindow?.print();}
      else{const link=document.createElement("a");link.href=pdf.url;link.download=pdf.name;link.click();}
    }catch(cause){setError(cause);}
  }
  return <div className="pc-stack"><div className="pc-toolbar">
    <Pick label={t("لغة التقرير","Report language")} value={reportLanguage} placeholder="" items={[["ar","العربية"],["en","English"]]}
      onChange={value=>{abort.current?.abort();setBusy(false);setReportLanguage(value);setPdf(null);}}/>
    {can("export")&&<button type="button" disabled={busy||disabled} onClick={preview}>{busy?t("جارٍ إعداد PDF…","Preparing PDF…"):t("معاينة PDF","PDF Preview")}</button>}
    {pdf&&<><button type="button" onClick={()=>output()}>{t("تنزيل PDF","Download PDF")}</button>
      <button type="button" onClick={()=>output(true)}>{t("فتح للطباعة","Open for printing")}</button>
      <button type="button" onClick={()=>setPdf(null)}>{t("إغلاق المعاينة","Close preview")}</button></>}
  </div><ErrorMessage error={error}/>{pdf&&!shareNativeReport&&<iframe ref={frame} className="ops-preview pc-preview" title={t("معاينة التقرير","Report preview")} src={pdf.url}/>}</div>;
}

export function RunningProjects(props){
  const {request,t,active,revision,reload,onOpenProject}=props;
  const [search,setSearch]=useState(""),[completed,setCompleted]=useState(false),[page,setPage]=useState(1),q=useDebounce(search);
  const filters={q,include_completed:completed?"1":"0"};
  const data=useResource(request,active?"/reports/progress"+queryString({...filters,page}):null,revision);
  return <section className="pc-panel pc-stack"><h2>{t("متابعة التشغيل","Work progress")}</h2>
    <div className="pc-form"><Text label={t("بحث بالمشروع أو العميل","Search by project or customer")} value={search} onChange={value=>{setSearch(value);setPage(1);}}/>
      <label className="pc-check"><input type="checkbox" checked={completed} onChange={event=>{setCompleted(event.target.checked);setPage(1);}}/>{t("إظهار المشروعات المكتملة","Include completed projects")}</label></div>
    <div className="pc-toolbar"><span>{t("المشروعات","Projects")}: <bdi>{data.data?.total??"—"}</bdi></span><button type="button" onClick={reload}>{t("تحديث","Refresh")}</button></div>
    <ErrorMessage error={data.error}/>
    <Table headers={[t("المشروع / العميل","Project / customer"),t("المرحلة الحالية","Current stage"),t("المواصفات","Specifications"),t("المقاسات","Measurements"),
      t("الخامات","Materials"),t("التصنيع","Manufacturing"),t("الفحص","QC"),t("التحميل","Loading")]}
      empty={data.pending?t("جارٍ التحميل…","Loading…"):t("لا توجد مشروعات مطابقة.","No matching projects.")}
      rows={(data.data?.items||[]).map(item=>[item.id,[<><button type="button" className="pc-name" onClick={()=>onOpenProject(item)}>{item.name}</button>
        <small className="pc-caption"> {item.code} · {item.customer}</small></>,<><span className="pc-chip">{display(stageNames,item.stage,t)}</span>
        {item.details.status&&<small className="pc-caption"> {item.details.status}</small>}</>,
        <bdi>{item.counts.items?`${item.counts.specifications}/${item.counts.items}`:"—"}</bdi>,<bdi>{item.counts.items?`${item.counts.measurement}/${item.counts.items}`:"—"}</bdi>,
        <bdi>{item.counts.items?`${item.counts.materials}/${item.counts.items}`:"—"}</bdi>,<bdi>{item.counts.ordered?`${item.counts.manufacturing}/${item.counts.ordered}`:"—"}</bdi>,
        <bdi>{item.counts.ordered?`${item.counts.qc}/${item.counts.ordered}`:"—"}</bdi>,<bdi>{item.counts.required?quantity(item.loading_percent)+"%":"—"}</bdi>]])}/>
    <Page data={data.data} onPage={setPage} t={t}/>
    <PdfOutput key={queryString(filters)} {...props} kind="progress" filters={filters} disabled={data.pending||q!==search}/>
  </section>;
}

export function QuantityTakeoff(props){
  const {request,t,active,revision,uiLanguage}=props;
  const [mode,setMode]=useState("project"),[project,setProject]=useState(""),[customer,setCustomer]=useState(""),[page,setPage]=useState(1);
  const [from,setFrom]=useState(localDate().slice(0,8)+"01"),[to,setTo]=useState(localDate());
  const choices=useResource(request,active?"/report-options":null,revision);
  const ready=mode==="loading"||mode==="project"&&project||mode==="customer"&&customer;
  const filters={mode,project_id:mode==="customer"?"":project,customer_id:mode==="project"?"":customer,...(mode==="loading"?{from,to}:{})};
  const data=useResource(request,active&&ready?"/reports/quantities"+queryString({...filters,page}):null,revision);
  const change=(setter,value)=>{setter(value);setPage(1);};
  return <section className="pc-panel pc-stack"><h2>{t("حصر الكميات","Quantity takeoff")}</h2>
    <div className="pc-form"><Pick label={t("الحصر حسب","Takeoff by")} value={mode} required placeholder="" onChange={value=>change(setMode,value)}
      items={[["project",t("المشروع بالكامل","Whole project")],["customer",t("العميل","Customer")],["loading",t("التحميل المؤكد خلال فترة","Confirmed loading in a date range")]]}/>
      {mode!=="project"&&<Pick label={t("العميل","Customer")} value={customer} required={mode==="customer"} onChange={value=>{change(setCustomer,value);setProject("");}}
        placeholder={mode==="loading"?t("جميع العملاء","All customers"):"—"} items={(choices.data?.customers||[]).map(item=>[item.id,item.name])}/>}
      {mode!=="customer"&&<Pick label={t("المشروع","Project")} value={project} required={mode==="project"} onChange={value=>change(setProject,value)}
        placeholder={mode==="loading"?t("جميع المشروعات","All projects"):"—"} items={(choices.data?.projects||[]).filter(item=>mode!=="loading"||!customer||String(item.customer_id)===String(customer))
          .map(item=>[item.id,item.code+" · "+item.name+" · "+item.customer])}/>}
      {mode==="loading"&&<><Text type="date" label={t("من تاريخ","From date")} value={from} onChange={value=>change(setFrom,value)}/>
        <Text type="date" label={t("إلى تاريخ","Through date")} value={to} onChange={value=>change(setTo,value)}/></>}
    </div><ErrorMessage error={choices.error||data.error}/>
    {data.data&&<><div className="pc-cards">{data.data.totals.quantities.map(item=><div key={item.unit}><span>{unit(item.unit,uiLanguage)}</span><strong dir="ltr">{quantity(item.quantity)}</strong></div>)}
      <div><span>{mode==="loading"?t("فتحات مكتملة التحميل","Complete loaded openings"):t("العدد الفني","Technical count")}</span><strong dir="ltr">{quantity(data.data.totals.count)}</strong></div>
      <div><span>{t("المساحة التقديرية م²","Estimated area m²")}</span><strong dir="ltr">{quantity(data.data.totals.estimated_area)}</strong></div></div>
      {mode==="loading"&&<><div className="pc-toolbar">{Object.entries(data.data.totals.components).map(([kind,value])=><span className="pc-chip" key={kind}>{display(panelNames,kind,t)}: <bdi>{quantity(value)}</bdi></span>)}</div>
        <p className="pc-caption">{t("تُحصر الفتحات المكتملة بعد تحميل جميع مكوناتها؛ وتظهر مكونات التحميل الجزئي منفصلة.","Complete openings require all their components to be loaded; partial loading components are shown separately.")}</p></>}
      <Table headers={[t("المشروع","Project"),t("البند / الفتحة","Item / opening"),...(mode==="loading"?[t("أمر التشغيل","Work order")]:[]),t("كمية الأعمال","Work quantity"),
        t("الوحدة","Unit"),t("العدد","Count"),t("المقاس مم","Size mm")]}
        rows={data.data.items.map(item=>[item.key,[item.project,<>{item.tag}<br/>{item.description}</>,...(mode==="loading"?[<>{item.order}<small className="pc-caption">{item.loading_references.join(" / ")}</small></>]:[]),<bdi>{quantity(item.quantity)}</bdi>,
          unit(item.unit,uiLanguage),<bdi>{quantity(item.count)}</bdi>,item.width_mm!=null&&item.height_mm!=null?<DimensionPair values={[quantity(item.width_mm),quantity(item.height_mm)]} locale={uiLanguage}/>:"—"]])}
        empty={t("لا توجد كميات في هذا النطاق.","No quantities in this scope.")}/><Page data={data.data} onPage={setPage} t={t}/></>}
    {ready&&<PdfOutput key={queryString(filters)} {...props} kind="quantities" filters={filters} disabled={data.pending||choices.pending}/>}
  </section>;
}
