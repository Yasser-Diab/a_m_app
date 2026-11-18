import {useEffect,useState} from "react";
import {ClipboardList,Factory,History,Layers3,Truck,Users} from "lucide-react";
import {queryString,useDebounce,useResource} from "../certificates/shared.jsx";
import "../certificates/certificates.css";
import "./operations.css";
import {ErrorMessage,Page,Pick,Suggest,Table,Text,assignmentRoles,display,options,quantity,useAction,useOperationsApi,usePaged} from "./shared.jsx";
import {WorkItems,Changes} from "./WorkItems.jsx";
import {technicalText} from "./terminology.js";
import Production from "./Production.jsx";
import ProjectSignatures from "./ProjectSignatures.jsx";
import SourceRefresh from './SourceRefresh.jsx';
import {RunningProjects,QuantityTakeoff} from "./OperationsReports.jsx";

const tabs=[
  ["items","جدول الكميات","BOQ",Layers3],["overview","بيانات المشروع","Project details",ClipboardList],
  ["people","الفريق والتوقيعات","Team & Sign-offs",Users],["changes","تعديلات العقد","Contract variations",Factory],
  ["production","أوامر التشغيل والتحميل","Work Orders & Loading",Truck],
  ["history","السجل","History",History],
];
const fields = [
  ["customer_project_code","كود المشروع لدى العميل (اختياري)","Customer project code (optional)"],
  ["owner","صاحب المشروع","Project owner"],["main_contractor","المقاول الرئيسي","Main contractor"],
  ["consultant","الاستشاري","Consultant"],["location","المدينة / الموقع","City / site"],
  ["address","عنوان موقع المشروع","Site address"],["building","المبنى / المرحلة","Building / phase"],
  ["start_date","تاريخ البدء","Start date","date"],["delivery_date","تاريخ التسليم المطلوب","Required delivery","date"],
  ["contract_ref","رقم عقد العميل أو أمر الشراء","Client contract or PO no."],
  ["finishing","متطلبات التشطيب","Finishing requirements"],["drawing_ref","مرجع المخططات","Drawing reference"],
  ["drawing_revision","إصدار المخططات","Drawing revision"],["site_phone","هاتف الموقع","Site phone"],
  ["approval_party","جهة الاعتماد","Approval organization"],["notes","ملاحظات المشروع","Project notes"],
];
const signatures={manufacturing:["أمر التصنيع","Manufacturing"],loading:["محضر التحميل","Loading sheet"],
  maintenance:["أمر الصيانة","Maintenance"],both:["التصنيع والتحميل","Manufacturing & loading"],all:["جميع التقارير","All reports"]};

export default function ProjectOperations({api,apiBase,session,access,uiLanguage,active,onOpenDocument,onOpenOffers,saveNativeReport,shareNativeReport}) {
  const t=(ar,en)=>uiLanguage==="ar"?ar:en;
  const can=(key)=>access.capabilities.includes("ops_"+key);
  const request=useOperationsApi(api,session);
  const [projectId,setProject]=useState(null);
  const [search,setSearch]=useState("");
  const [tab,setTab]=useState("items");
  const [view,setView]=useState("projects");
  const [preferred,setPreferred]=useState(null);
  const [discoveryError,setDiscoveryError]=useState(null);
  const [opening,setOpening]=useState(false);
  const [revision,refresh]=useState(0);
  const reload=()=>refresh((n)=>n+1);
  useEffect(()=>{if (active) refresh((value)=>value+1);},[active]);
  const q=useDebounce(search);
  const projects=usePaged(request,"/projects",{q},revision);
  const path=projectId?`/projects/${projectId}`:null;
  const context=useResource(request,path,revision);
  const catalogue=useResource(request,"/catalogue",revision);
  const [cachedContext,setContext]=useState(null);
  const [cachedCatalogue,setCatalogue]=useState(null);
  useEffect(()=>{if (context.data) setContext(context.data);},[context.data]);
  useEffect(()=>{if (catalogue.data) setCatalogue(catalogue.data);},[catalogue.data]);
  const current=context.data||(cachedContext?.project.id===projectId?cachedContext:null);
  const currentCatalogue=catalogue.data||cachedCatalogue;
  const controls={request,t,can,path,ctx:current,catalogue:currentCatalogue,revision,reload,uiLanguage,apiBase,session,
    onOpenDocument,saveNativeReport,shareNativeReport,preferred};
  async function openProject(row) {
    setDiscoveryError(null);
    const doc=row.matched_document||row.source_document;
    setPreferred(doc);
    if (row.id) {setProject(row.id);setTab("items");return;}
    setOpening(true);
    try {
      const result=await request("/resolve-project",{method:"POST",body:{document_id:doc.id,project:row.name}});
      setProject(result.id);setTab("items");
    } catch(error) {setDiscoveryError(error);}
    finally {setOpening(false);}
  }
  const documentLabel=(doc)=>doc.document_type==="invoice"?t("فاتورة","Invoice"):t("عرض سعر","Quotation");
  return <div className="pc-workspace ops-workspace" dir={uiLanguage==="ar"?"rtl":"ltr"}>
    <nav className="pc-tabs" aria-label={t("أقسام إدارة التشغيل","Operations management sections")}>
      {[["projects","المشروعات","Projects"],["progress","متابعة التشغيل","Work progress"],["quantities","حصر الكميات","Quantity takeoff"]].map(([id,ar,en])=>
        <button type="button" key={id} aria-pressed={view===id} onClick={()=>setView(id)}>{t(ar,en)}</button>)}
    </nav>
    <div className="pc-stack" hidden={view!=="projects"}>
    <section className="pc-panel pc-stack">
      {projectId ? <div className="pc-toolbar">
        <button type="button" onClick={()=>{setProject(null);setPreferred(null);setTab("items");}}>{t("اختيار مشروع آخر","Choose another project")}</button>
        <strong>{current?.project.name}</strong><bdi>{current?.project.code}</bdi>
        <span>{current?.customer.name}</span>
      </div> : <>
        <Text label={t("بحث برقم الفاتورة أو عرض السعر أو المشروع","Search by invoice, quotation or project number")}
          placeholder={t("رقم الفاتورة أو العرض أو اسم المشروع أو العميل","Invoice, quotation, project or customer")}
          value={search} onChange={(value)=>{setSearch(value);projects.setPage(1);}} />
        <ErrorMessage error={projects.error||discoveryError}/>
        <Table headers={[t("المشروع","Project"),t("رقم المشروع","Project no."),t("العميل","Customer"),
          t("الفاتورة / عرض السعر","Invoice / quotation"),t("الحالة","Status")]}
          empty={projects.pending?t("جارٍ التحميل…","Loading…"):t("لا توجد مشروعات مطابقة.","No matching projects.")}
          rows={(projects.data?.items||[]).map((row)=>[row.id||row.key,[
            <button type="button" className="pc-name" disabled={opening} onClick={()=>openProject(row)}>{row.name}</button>,
            <bdi>{row.code||"—"}</bdi>,row.customer,
            row.source_document&&<button type="button" className="pc-name" onClick={()=>onOpenDocument(row.source_document,{name:row.customer})}>
              {documentLabel(row.source_document)} <bdi>{row.source_document.operation_no||row.source_document.document_no}</bdi></button>,
            row.configured?t("مفتوح","Open"):row.has_approved_source?t("جاهز لأعمال التشغيل","Ready to start"):t("بانتظار اعتماد العرض","Awaiting approval"),
          ]])}/>
        <Page data={projects.data} onPage={projects.setPage} t={t}/>
      </>}
    </section>
    <ErrorMessage error={context.error||catalogue.error}/>
    {projectId && context.pending && !current && <p role="status">{t("جارٍ تحميل المشروع…","Loading project…")}</p>}
    {current && !current.operations && <Setup key={projectId} {...controls} onOpenOffers={onOpenOffers} preferred={preferred}/>}
    {current?.operations && currentCatalogue && <>
      <nav className="pc-tabs" aria-label={t("عمليات المشروع","Project operations")}>{tabs.map(([id,ar,en,Icon])=>
        <button type="button" key={id} aria-pressed={tab===id} onClick={()=>setTab(id)}><Icon size={16}/>{t(ar,en)}</button>
      )}</nav>
      <section className="pc-panel pc-stack" hidden={tab!=="items"} key={projectId+":items"}>
        <WorkItems {...controls}/>
      </section>
      {tab!=="items"&&<section className="pc-panel pc-stack" key={projectId+":"+tab}>
        {tab==="overview" && <Overview {...controls}/>}
        {tab==="people" && <People {...controls}/>}
        {tab==="changes" && <Changes {...controls}/>}
        {tab==="production" && <Production {...controls}/>}
        {tab==="history" && <Audit {...controls}/>}
      </section>}
    </>}
    </div>
    <div hidden={view!=="progress"}><RunningProjects {...controls} active={view==="progress"} onOpenProject={row=>{setView("projects");openProject(row);}}/></div>
    <div hidden={view!=="quantities"}><QuantityTakeoff {...controls} active={view==="quantities"}/></div>
  </div>;
}

function Setup({ctx,path,t,request,can,reload,onOpenOffers,onOpenDocument,preferred}) {
  const [chosen,setBoq]=useState("");
  const boq=chosen||String(ctx.boqs.find(({id})=>id===preferred?.id)?.id||(ctx.boqs.length===1?ctx.boqs[0].id:""));
  const [date,setDate]=useState("");
  const action=useAction(request,reload);
  const selected=ctx.boqs.find(({id})=>String(id)===boq);
  return <form className="pc-panel pc-stack" onSubmit={(event)=>{
    event.preventDefault();action.run(path,"POST",{boq_id:Number(boq),approval_date:date});
  }}>
    <h3>{t("فتح جدول الكميات","Open the BOQ")}</h3>
    {ctx.boqs.length ? <div className="pc-form">
      <Pick label={t("الفاتورة أو عرض السعر المعتمد","Approved invoice or quotation")} value={boq} onChange={setBoq} required
        items={ctx.boqs.map(({id,operation_no,title})=>[id,[operation_no,title].filter(Boolean).join(" · ")])}/>
      {selected && !selected.approval_date && <Text label={t("تاريخ الاعتماد إذا كان معروفًا","BOQ approval date, if known")}
        type="date" value={date} onChange={setDate}/>}
    </div> : <p>{t("اعتمد الفاتورة أو عرض السعر لفتح جدول المواصفات.",
      "Approve the invoice or quotation to open the specifications worksheet.")}</p>}
    <ErrorMessage error={action.error}/>
    <div className="pc-toolbar">
      {can("edit") && <button type="submit" className="primary" disabled={!selected||action.busy}>{t("فتح استمارة المواصفات","Open specifications form")}</button>}
      {preferred?<button type="button" onClick={()=>onOpenDocument(preferred,ctx.customer)}>
        {preferred.document_type==="invoice"?t("فتح الفاتورة","Open invoice"):t("فتح عرض السعر","Open quotation")}
        {" "}<bdi>{preferred.operation_no||preferred.document_no}</bdi></button>:
        <button type="button" onClick={onOpenOffers}>{t("فتح عروض الأسعار","Open Quotations")}</button>}
    </div>
  </form>;
}

function Overview({ctx,request,path,t,can,catalogue,reload,onOpenDocument,uiLanguage,revision}) {
  const state=ctx.operations;
  const [draft,setDraft]=useState(()=>({...state.details,customer_project_code:ctx.project.customer_project_code||'',address:state.details.address||ctx.project.address||"",
    contract_ref:state.details.contract_ref||ctx.project.contract_ref||""}));
  const action=useAction(request,reload);
  const loading=useResource(request,path+"/loading",revision);
  const totals=loading.data?.totals;
  const boq=state.boq_snapshot;
  const total=ctx.dashboard.total;
  return <>
    <div className="pc-toolbar"><h3>{t("بيانات المشروع","Project details")}</h3>
      <button type="button" onClick={()=>onOpenDocument(boq,ctx.customer)}>
        {boq.document_type==="invoice"?t("الفاتورة المعتمدة","Approved invoice"):t("عرض السعر المعتمد","Approved quotation")} <bdi>{boq.operation_no}</bdi></button>
      <span className="pc-chip">{t("معتمد","Approved")}{boq.approval_date&&<> · <bdi>{boq.approval_date}</bdi></>}</span>
    </div>
    <SourceRefresh {...{ctx,path,request,t,can,reload}}/>
    <dl className="ops-project-meta">
      {[[t("كود العميل","Customer code"),ctx.customer.code],[t("رقم المشروع","Project no."),ctx.project.code],
        [t("رقم الإسناد","Award no."),state.award_reference]].map(([name,value])=><div key={name}><dt>{name}</dt><dd><bdi>{value}</bdi></dd></div>)}
    </dl>
    <div className="pc-cards">
      {[[t("البنود","Work items"),total.items],[t("الكمية","Technical quantity"),total.quantity],
        [t("المساحة التقديرية م²","Estimated area (m²)"),total.estimated_area],[t("تعديلات بانتظار الاعتماد","Pending revisions"),ctx.dashboard.pending_changes],
        ...(can("finance")?[[t("تسويات بانتظار المالية","Awaiting Finance"),ctx.dashboard.pending_finance]]:[]),
        [t("تحميل مؤكد","Confirmed loaded"),totals?.loaded],[t("متبقي التحميل","Loading remaining"),totals?.remaining]]
        .map(([title,value])=><div key={title}><span>{title}</span><strong dir="ltr">{quantity(value)}</strong></div>)}
    </div>
    <Table headers={[t("الفئة","Category"),t("البنود","Items"),t("الكمية","Quantity"),t("المساحة التقديرية م²","Estimated area (m²)")]}
      rows={ctx.dashboard.rows.map((row)=>[row.category,[catalogue.categories.find(({id})=>id===row.category)?.[uiLanguage] ||
        t("بانتظار التصنيف","Unclassified"),quantity(row.items),quantity(row.quantity),quantity(row.estimated_area)]])} empty=""/>
    <form className="pc-stack" onSubmit={(event)=>{event.preventDefault();action.run(path,"PATCH",{version:state.version,details:draft});}}>
      <fieldset disabled={!can("edit")||action.busy}><legend>{t("بيانات الموقع والتسليم","Site & delivery")}</legend><div className="pc-form">
        {fields.filter(([key])=>["customer_project_code","address","building","start_date","delivery_date","contract_ref"].includes(key))
          .map(([key,ar,en,type])=><Text key={key} label={t(ar,en)} value={draft[key]} type={type} onChange={(value)=>setDraft({...draft,[key]:value})}/>)}
        <Pick label={t("حالة المشروع","Project status")} value={draft.status} onChange={(value)=>setDraft({...draft,status:value})}
          items={catalogue.projectStatuses.map((status)=>[status,technicalText(status,uiLanguage)])}/>
      </div><details>
        <summary>{t("بيانات إضافية","Additional project details")}</summary>
        <div className="pc-form">
          {fields.filter(([key])=>!["customer_project_code","address","building","start_date","delivery_date","contract_ref"].includes(key))
            .map(([key,ar,en,type])=><Text key={key} label={t(ar,en)} value={draft[key]} type={type} onChange={(value)=>setDraft({...draft,[key]:value})}/>)}
        </div>
      </details></fieldset>
      <ErrorMessage error={action.error}/>
      {can("edit")&&<div><button type="submit" className="primary" disabled={action.busy}>{t("حفظ بيانات العمليات","Save operational details")}</button></div>}
    </form>
  </>;
}

function PersonRoles({form,update,t}) {
  return <>
    <Suggest label={t("المسؤولية","Responsibility")} value={display(assignmentRoles,form.responsibility,t)==="—"?"":display(assignmentRoles,form.responsibility,t)}
      onChange={(value)=>update("responsibility",options(assignmentRoles,t).find(([,text])=>text===value)?.[0]||value)} items={options(assignmentRoles,t)}/>
    <Suggest label={t("التوقيع في","Sign on")} value={display(signatures,form.signature_usage,t)==="—"?"":display(signatures,form.signature_usage,t)}
      onChange={(value)=>update("signature_usage",options(signatures,t).find(([,text])=>text===value)?.[0]||value)} items={options(signatures,t)}/>
    <Text label={t("عنوان التوقيع","Signature heading")} value={form.signature_label} onChange={(value)=>update("signature_label",value)}/>
  </>;
}

function People({request,path,t,can,revision,reload,ctx}) {
  const people=useResource(request,path+"/people",revision);
  const staff=useResource(request,can("edit")?"/employees":null);
  const [kind,setKind]=useState("staff");
  const [form,setForm]=useState({});
  const [edit,setEdit]=useState(null);
  const [contactSearch,setContactSearch]=useState("");
  const q=useDebounce(contactSearch);
  const contacts=useResource(request,can("edit")&&kind==="existing"?"/contacts"+queryString({q}):null,revision);
  const action=useAction(request,()=>{setForm({});setEdit(null);reload();});
  const update=(key,value)=>setForm({...form,[key]:value});
  return <>
    {["staff","client"].map((side)=><section key={side} className="ops-section pc-stack">
      <h3>{side==="staff"?t("طرف الشركة","Company team"):t("طرف العميل والاستشاري","Client & consultant")}</h3>
      <Table headers={[t("الاسم","Name"),t("الجهة","Company"),t("الصفة","Title"),t("المسؤولية","Responsibility"),
        t("التوقيع في","Sign on"),t("الاتصال","Contact"),t("الإجراءات","Actions")]}
        empty={t("لا يوجد أفراد معينون.","No assignments yet.")}
        rows={(people.data||[]).filter((row)=>(row.side==="company") === (side==="staff")).map((row)=>[row.id,[row.name,row.company||"—",
          row.position||"—",display(assignmentRoles,row.responsibility,t),display(signatures,row.signature_usage,t),
          [row.mobile,row.email,row.details].filter(Boolean).join(" · ")||"—",can("edit")&&<div className="pc-toolbar">
            <button type="button" onClick={()=>{setEdit(row.id);setForm({...row});}}>
              {t("تعديل","Edit")}</button>
            <button type="button" onClick={()=>action.run(path+"/people/"+row.id,"DELETE")}>{t("إزالة","Remove")}</button>
          </div>]])}/>
    </section>)}
    <ErrorMessage error={people.error||staff.error||contacts.error||action.error}/>
    {can("edit")&&edit!=null&&<form className="pc-stack" onSubmit={(event)=>{event.preventDefault();action.run(path+"/people/"+edit,"PATCH",form);}}>
      <div className="pc-form">
        <Text label={t("الصفة","Title")} value={form.position} onChange={(value)=>update("position",value)}/>
        <Pick label={t("الطرف","Side")} value={form.side} onChange={(value)=>update("side",value)}
          items={[["company",t("الشركة","Company")],["client",t("العميل / الاستشاري","Client / consultant")]]}/>
        <PersonRoles {...{form,update,t}}/>
      </div>
      <div className="pc-toolbar"><button type="submit" className="primary" disabled={action.busy}>{t("حفظ","Save")}</button>
        <button type="button" onClick={()=>{setEdit(null);setForm({});}}>{t("إلغاء","Cancel")}</button></div>
    </form>}
    {can("edit")&&edit==null&&<form className="pc-stack" onSubmit={(event)=>{
      event.preventDefault();
      action.run(path+"/people","POST",{...form,side:kind==="staff"||kind==="company"?"company":"client",
        company:form.company||(kind==="new"?ctx.customer.name:"")});
    }}>
      <div className="pc-form">
        <Pick label={t("النوع","Assignment type")} required value={kind} onChange={(value)=>{setKind(value);setForm({});}}
          items={[["staff",t("مستخدم من البرنامج","App user")],["company",t("من الشركة بدون حساب","Company employee without an account")],
            ["existing",t("اسم مسجل","Existing contact")],["new",t("ممثل العميل أو الاستشاري","Client / consultant contact")]]}/>
        {kind==="staff"&&<Pick label={t("الموظف","Employee")} value={form.user_id} onChange={(value)=>update("user_id",value)} required
          items={(staff.data||[]).map(({id,name})=>[id,name])}/>}
        {kind==="existing"&&<>
          <Text label={t("بحث عن ممثل","Find a representative")} value={contactSearch} onChange={(value)=>{setContactSearch(value);update("contact_id","");}}/>
          <Pick label={t("الممثل","Representative")} value={form.contact_id} onChange={(value)=>update("contact_id",value)} required
            items={(contacts.data||[]).map(({id,name,company})=>[id,[name,company].filter(Boolean).join(" · ")])}/>
        </>}
        <Text label={t("الصفة","Title")} value={form.position} onChange={(value)=>update("position",value)}/>
        <PersonRoles {...{form,update,t}}/>
        {["new","company"].includes(kind)&&[["name","الاسم","Name"],["company","الجهة","Organization"],["mobile","الهاتف","Phone"],
          ["email","البريد الإلكتروني","Email"],["details","بيانات إضافية","Additional contact details"]].map(([key,ar,en])=>
          <Text key={key} label={t(ar,en)} value={form[key]} required={key==="name"} onChange={(value)=>update(key,value)}/>)}
      </div>
      <div><button type="submit" className="primary" disabled={action.busy}>{t("إضافة إلى المشروع","Add to project")}</button></div>
    </form>}
    <ProjectSignatures {...{ctx,path,request,t,can,reload}} people={people.data||[]}/>
  </>;
}

function Audit({request,path,t,revision}) {
  const list=usePaged(request,path+"/history",{},revision);
  return <>
    <h3>{t("سجل العمليات","Operational history")}</h3>
    <ErrorMessage error={list.error}/>
    <Table headers={[t("التوقيت","Time"),t("المستخدم","User"),t("الإجراء","Action"),t("التفاصيل","Details")]}
      empty={t("لا توجد تعديلات مسجلة.","No recorded changes.")}
      rows={(list.data?.items||[]).map((entry)=>[entry.id,[<bdi>{entry.created_at}</bdi>,entry.actor_name,entry.action.replaceAll("_"," "),
        entry.details&&<details><summary>{t("عرض التغيير","View change")}</summary><pre className="ops-json">{JSON.stringify(entry.details,null,2)}</pre></details>]])}/>
    <Page data={list.data} onPage={list.setPage} t={t}/>
  </>;
}
