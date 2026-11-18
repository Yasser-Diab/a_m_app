import {useEffect,useRef,useState} from "react";
import {Dialog,localDate,newKey,useDebounce,useResource} from "../certificates/shared.jsx";
import {ErrorMessage,Page,Pick,Suggest,Table,Text,assignmentRoles,display,options,panelNames,quantity,results,stages,states,useAction,usePaged} from "./shared.jsx";
import ProjectSignatures from "./ProjectSignatures.jsx";

const checkLabels={measurements:["المقاسات","Measurement conformity"],profile:["القطاعات","Profile conformity"],
  finish:["التشطيب","Finish"],glass:["الزجاج","Glass"],opening:["اتجاه الفتح والمقابض","Opening and handles"],
  accessories:["الإكسسوارات","Accessories"],fixing:["العزل والتثبيت","Insulation and fixing"],packaging:["الحماية والتغليف","Protection and packaging"]};
const checkResults={compliant:["مطابق","Compliant"],noncompliant:["غير مطابق","Non-compliant"],na:["غير منطبق","Not applicable"],
  uninspected:["لم يفحص","Not inspected"]};

export default function Production(props) {
  const {request,path,t,can,revision}=props;
  const [orderId,setOrder]=useState(null);
  const [create,setCreate]=useState("");
  const orders=usePaged(request,path+"/orders",{},revision);
  const loading=useResource(request,path+"/loading",revision);
  const active=useResource(request,orderId?path+"/orders/"+orderId:null,revision);
  const [cachedOrder,setCachedOrder]=useState(null);
  useEffect(()=>{if (active.data) setCachedOrder(active.data);},[active.data]);
  const current=active.data||(cachedOrder?.id===orderId?cachedOrder:null);
  const totals=loading.data?.totals;
  const completion=totals?.required ? (100*totals.loaded/totals.required).toFixed(1)+"%" : "—";
  return <>
    <div className="pc-toolbar"><h3>{t("أوامر التشغيل والتحميل","Work Orders & Loading")}</h3>
      {can("edit")&&<>
        <button type="button" className="primary" onClick={()=>setCreate("manufacturing")}>{t("أمر تشغيل جديد","New work order")}</button>
        <button type="button" onClick={()=>setCreate("maintenance")}>{t("أمر صيانة جديد","New maintenance order")}</button>
      </>}
    </div>
    {totals&&<div className="pc-cards">
      {[[t("المطلوب للتحميل","Required"),totals.required],[t("محمل","Loaded"),totals.loaded],[t("متبقي","Remaining"),totals.remaining],
        [t("اكتمال التحميل","Loading completion"),completion]].map(([label,value])=><div key={label}><span>{label}</span>
          <strong dir="ltr">{typeof value==="number"?quantity(value):value}</strong></div>)}
    </div>}
    <ErrorMessage error={orders.error||loading.error||active.error}/>
    <Table headers={[t("رقم الأمر","Order no."),t("نوع العمل","Work type"),t("الحالة","Status"),t("موعد التسليم","Required by")]}
      empty={t("لا توجد أوامر إنتاج.","No production orders.")}
      rows={(orders.data?.items||[]).map((row)=>[row.id,[<button type="button" className="pc-name" onClick={()=>setOrder(row.id)}>
        {row.reference}</button>,row.kind==="maintenance"?t("صيانة","Maintenance"):t("تصنيع","Manufacturing"),
        row.completed_on?t("مكتمل","Completed"):row.kind==="maintenance"?
          (row.status==="draft"?t("مفتوح","Open"):t("ملغى","Cancelled")):display(states,row.status,t),
        <bdi>{row.required_date||"—"}</bdi>]])}/>
    <Page data={orders.data} onPage={orders.setPage} t={t}/>
    {create&&<CreateOrder {...props} maintenance={create==="maintenance"} close={()=>setCreate("")} onCreated={(row)=>{setCreate("");setOrder(row.id);}}/>}
    {current&&(current.kind==="maintenance"?<MaintenanceDetails {...props} order={current} key={current.id}/>:
      <OrderDetails {...props} order={current} key={current.id}/>)}
  </>;
}

function CreateOrder({request,path,t,reload,close,onCreated,maintenance}) {
  const [search,setSearch]=useState("");
  const q=useDebounce(search);
  const list=usePaged(request,path+"/items",{q},0);
  const [selected,setSelected]=useState({});
  const [commandKey]=useState(newKey);
  const [required,setRequired]=useState("");
  const [instructions,setInstructions]=useState("");
  const [assignee,setAssignee]=useState("");
  const team=useResource(request,maintenance?path+"/people":null);
  const action=useAction(request,(result)=>{onCreated(result);reload();});
  const pick=(item,amount)=>{
    const next={...selected};
    if (amount==null) delete next[item.id]; else next[item.id]={code:item.code,quantity:amount};
    setSelected(next);
  };
  const visible=(list.data?.items||[]).filter((item)=>item.active&&(maintenance||item.system));
  const defaultAmount=(item)=>item.technical.quantity||(maintenance?1:"");
  return <Dialog t={t} wide title={maintenance?t("أمر صيانة جديد","New maintenance order"):t("أمر تشغيل جديد","New work order")} onClose={close}>
    <form className="pc-stack" onSubmit={(event)=>{
      event.preventDefault();action.run(path+"/orders","POST",{command_key:commandKey,required_date:required,
        kind:maintenance?"maintenance":"manufacturing",instructions,assignee_id:assignee,
        items:Object.entries(selected).map(([item_id,{quantity}])=>({item_id,quantity}))});
    }}>
      <div className="pc-form">
        <Text type="date" label={t("موعد التسليم","Required by")} value={required} onChange={setRequired}/>
        {maintenance&&<>
          <Pick label={t("مسؤول الصيانة","Assigned to")} value={assignee} onChange={setAssignee}
            items={(team.data||[]).map((person)=>[person.id,[person.name,person.position].filter(Boolean).join(" · ")])}/>
          <Text label={t("أعمال الصيانة المطلوبة","Maintenance instructions")} value={instructions} onChange={setInstructions}/>
        </>}
        <Text label={t("بحث في البنود","Find work items")} value={search} onChange={(value)=>{setSearch(value);list.setPage(1);}}/>
      </div>
      {visible.length>0&&<button type="button" onClick={()=>setSelected({...selected,...Object.fromEntries(visible
        .filter((item)=>defaultAmount(item)).map((item)=>[item.id,selected[item.id]||{code:item.code,quantity:defaultAmount(item)}]))})}>
        {t("تحديد بنود الصفحة","Select items on this page")}</button>}
      {visible.map((item)=><div key={item.id} className="pc-toolbar ops-line-choice">
        <label className="pc-check"><input type="checkbox" checked={Boolean(selected[item.id])}
          onChange={(event)=>pick(item,event.target.checked?defaultAmount(item):null)}/>
          <bdi>{item.code}</bdi> {item.commercial.description}</label>
        {selected[item.id]&&<Text label={maintenance?t("العدد المطلوب","Service count"):t("عدد الفتحات","Opening count")} type="number" min={1} step={1} required
          value={selected[item.id].quantity} onChange={(amount)=>pick(item,amount)}/>}
      </div>)}
      <Page data={list.data} onPage={list.setPage} t={t}/>
      <p className="pc-caption">{t("البنود المختارة","Selected items")} {Object.values(selected).map(({code})=>code).join(", ")||"—"}</p>
      <ErrorMessage error={action.error||list.error||team.error}/>
      <button type="submit" className="primary" disabled={action.busy||!Object.keys(selected).length}>{t("إنشاء الأمر","Create order")}</button>
    </form>
  </Dialog>;
}

function MaintenanceDetails({order,path,request,t,can,reload,...props}) {
  const [dialog,setDialog]=useState("");
  const [notes,setNotes]=useState("");
  const [date,setDate]=useState(localDate);
  const action=useAction(request,()=>{setDialog("");reload();});
  const endpoint=path+"/orders/"+order.id;
  const service=order.service;
  const opened=order.status==="draft";
  return <section className="ops-section pc-stack">
    <div className="pc-toolbar">
      <h3><bdi>{order.reference}</bdi></h3>
      <span className="pc-chip">{service.completed_on?t("مكتمل","Completed"):opened?t("مفتوح","Open"):t("ملغى","Cancelled")}</span>
      {opened&&can("edit")&&<button type="button" className="primary" onClick={()=>{setNotes("");setDialog("complete");}}>
        {t("إنهاء الصيانة","Complete maintenance")}</button>}
      {opened&&can("release")&&<button type="button" onClick={()=>{setNotes("");setDialog("cancel");}}>
        {t("إلغاء الأمر","Cancel order")}</button>}
      {can("export")&&<button type="button" onClick={()=>setDialog("report")}>{t("تقرير الصيانة","Maintenance report")}</button>}
    </div>
    <dl className="ops-project-meta">
      {[[t("مسؤول الصيانة","Assigned to"),service.assignee?.name],[t("موعد التسليم","Required by"),order.required_date],
        [t("أعمال الصيانة المطلوبة","Instructions"),service.instructions],[t("تاريخ الإنهاء","Completed on"),service.completed_on],
        [t("ملاحظات الإنهاء","Completion notes"),service.completion_notes]].filter(([,value])=>value)
        .map(([label,value])=><div key={label}><dt>{label}</dt><dd><bdi>{value}</bdi></dd></div>)}
    </dl>
    <Table headers={[t("البند","Item"),t("البيان","Description"),t("العدد","Count")]}
      rows={order.items.map(({id,quantity:count,specification})=>[id,[specification.code,specification.commercial.description,quantity(count)]])}/>
    {dialog==="report"&&<Report {...props} endpoint={endpoint} t={t} maintenance reference={order.reference} close={()=>setDialog("")}/>}
    {["complete","cancel"].includes(dialog)&&<Dialog t={t} title={dialog==="complete"?t("إنهاء الصيانة","Complete maintenance"):t("إلغاء الأمر","Cancel order")}
      onClose={()=>setDialog("")}>
      <form className="pc-stack" onSubmit={(event)=>{
        event.preventDefault();
        if (dialog==="complete") action.run(endpoint+"/complete","POST",{completed_on:date,completion_notes:notes});
        else action.run(endpoint,"PATCH",{status:"closed",reason:notes});
      }}>
        {dialog==="complete"&&<Text label={t("تاريخ الإنهاء","Completed on")} type="date" value={date} onChange={setDate} required/>}
        <Text label={dialog==="complete"?t("ملاحظات الإنهاء","Completion notes"):t("سبب الإلغاء","Cancellation reason")}
          value={notes} onChange={setNotes} required={dialog==="cancel"}/>
        <ErrorMessage error={action.error}/>
        <button type="submit" className="primary" disabled={action.busy}>{t("حفظ","Save")}</button>
      </form>
    </Dialog>}
  </section>;
}

function OrderDetails({order,path,t,request,can,reload,revision,uiLanguage,apiBase,session,saveNativeReport,shareNativeReport,ctx}) {
  const [dialog,setDialog]=useState(null);
  const [reason,setReason]=useState("");
  const action=useAction(request,reload);
  const people=useResource(request,path+"/people",revision);
  const endpoint=path+"/orders/"+order.id;
  const decide=(status)=>action.run(endpoint,"PATCH",{status,reason}).then((result)=>{if (result) setDialog(null);});
  const loadState=({required,loaded})=>loaded===required?t("مكتمل","Complete"):loaded?t("جزئي","Partial"):t("لم يحمّل","Not loaded");
  return <section className="ops-section pc-stack">
    <div className="pc-toolbar"><h3>{order.reference}</h3><span className="pc-chip">{display(states,order.status,t)}</span>
      {can("edit")&&["draft","released"].includes(order.status)&&!order.loads.length&&<button type="button" disabled={action.busy}
        onClick={()=>action.run(endpoint+"/refresh","POST",{})}>{t("تحديث المواصفات","Refresh draft specifications")}</button>}
      {can("release")&&order.status==="draft"&&<button type="button" className="primary" disabled={action.busy}
        onClick={()=>decide("released")}>{t("إفراج للتصنيع","Release for manufacturing")}</button>}
      {can("release")&&order.status==="released"&&<button type="button" disabled={action.busy} onClick={()=>decide("shipped")}>
        {t("تأكيد الشحن","Confirm shipment")}</button>}
      {can("release")&&order.status!=="closed"&&<button type="button" onClick={()=>setDialog("close")}>{t("إغلاق الأمر","Close order")}</button>}
      {can("qc")&&order.status!=="closed"&&<button type="button" onClick={()=>setDialog("qc")}>{t("تسجيل فحص","Record inspection")}</button>}
      {can("load")&&order.status==="released"&&<button type="button" onClick={()=>setDialog("load")}>{t("تسجيل التحميل","Record loading")}</button>}
      {can("export")&&<><button type="button" onClick={()=>setDialog("manufacturing")}>{t("أمر تصنيع / طلب خامات","Manufacturing order / materials")}</button>
        <button type="button" onClick={()=>setDialog("loadingReport")}>{t("أمر تحميل","Loading order")}</button>
        <button type="button" onClick={()=>setDialog("approvalReport")}>{t("تقرير الاعتمادات","Approval status report")}</button></>}
    </div>
    <ErrorMessage error={action.error||people.error}/>
    <StageApprovals {...{order,endpoint,request,t,can,reload}}/>
    <Table headers={[t("الفتحة","Opening"),t("المقاس مم","Size mm"),t("المكون","Component"),t("المطلوب","Required"),t("المحمل","Loaded"),t("المتبقي","Remaining"),t("التقدم","Progress")]}
      empty={t("لا توجد كميات.","No quantities.")}
      rows={order.balances.map((row)=>[row.order_item_id+":"+row.kind,[row.tag||row.code,
        <bdi dir="ltr">{row.width_mm??"—"} × {row.height_mm??"—"}</bdi>,display(panelNames,row.kind,t),
        quantity(row.required),quantity(row.loaded),quantity(row.remaining),loadState(row)]])}/>
    <h3>{t("فحص الجودة","Quality inspections")}</h3>
    <Table headers={[t("رقم الفحص","Inspection no."),t("البند","Item"),t("المرحلة","Stage"),t("التاريخ","Date"),t("الفاحص","Inspector"),t("النتيجة","Result"),t("الإفراج","Release")]}
      empty={t("لا توجد فحوصات.","No inspections.")}
      rows={order.inspections.map((row)=>[row.id,[<bdi>{row.reference||"—"}</bdi>,order.items.find(({id})=>id===row.order_item_id)?.specification.code,
        display(stages,row.stage,t),<bdi>{row.inspection_date}</bdi>,row.inspector_name,
        <details><summary>{display(results,row.record.result,t)}</summary>
          <dl>{Object.entries(row.record.checklist).map(([key,val])=><div key={key}><dt>{t(...checkLabels[key])}</dt>
            <dd>{display(checkResults,val,t)}</dd></div>)}</dl>
          {[row.record.defects,row.record.corrective_action,row.record.correction_owner,row.record.closed_on,row.record.delivery_ref].filter(Boolean).join(" · ")}
        </details>,display(states,row.record.release,t)]])}/>
    <h3>{t("دفعات التحميل","Loading history")}</h3>
    <Table headers={[t("المرجع","Reference"),t("التاريخ","Date"),t("المسؤول","Responsible"),t("الكميات","Quantities"),t("الملاحظات","Notes")]}
      empty={t("لا يوجد تحميل مؤكد.","No confirmed loading.")}
      rows={order.loads.map((batch)=>[batch.id,[batch.reference,<bdi>{batch.loading_date}</bdi>,batch.responsible.loading?.name,
        <bdi>{batch.lines.map((row)=>[row.code,display(panelNames,row.kind,t),row.quantity].join(" · ")).join(", ")}</bdi>,batch.notes]])}/>
    {dialog==="qc"&&<Inspection {...{order,endpoint,request,can,t,reload}} close={()=>setDialog(null)}/>}
    {dialog==="load"&&<Loading {...{order,endpoint,request,t,reload}} people={people.data||[]} close={()=>setDialog(null)}/>}
    {["manufacturing","loadingReport","approvalReport"].includes(dialog)&&<Report {...{endpoint,t,uiLanguage,apiBase,session,saveNativeReport,shareNativeReport,ctx,path,request,can,reload}}
      reference={order.reference} loading={dialog==="loadingReport"} approvals={dialog==="approvalReport"}
      people={people.data||[]} close={()=>setDialog(null)}/>}
    {dialog==="close"&&<Dialog t={t} title={t("إغلاق الأمر","Close production order")} onClose={()=>setDialog(null)}>
      <form className="pc-stack" onSubmit={(event)=>{event.preventDefault();decide("closed");}}>
        <Text label={t("سبب الإغلاق","Closing reason")} value={reason} onChange={setReason} required/>
        <ErrorMessage error={action.error}/>
        <button type="submit" className="primary">{t("إغلاق الأمر","Close order")}</button>
      </form>
    </Dialog>}
  </section>;
}

const approvalStages={measurement:["المقاسات","Measurements"],profile:["القطاعات","Profiles"],glass:["الزجاج","Glass"],
  accessories:["الإكسسوارات","Accessories"],finish:["التشطيب","Finish"],details:["التفاصيل","Technical details"],drawing:["الرسومات","Drawings"],
  manufacturing:["التصنيع","Manufacturing"],pre_shipment:["الشحن","Shipment"]};

function StageApprovals({order,endpoint,request,t,can,reload}) {
  const [exceptions,setExceptions]=useState(false);
  const action=useAction(request,reload);
  const decide=(stage,approved,id)=>action.run(endpoint+"/approvals","POST",{stage,approved,order_item_id:id});
  return <section className="ops-stage-approvals pc-stack">
    <h3>{t("اعتمادات أمر التشغيل","Work order approvals")}</h3>
    <div className="ops-stage-buttons">{(order.stage_approvals||[]).map(({stage,approved})=><button type="button" key={stage}
      disabled={!can("release")||action.busy||order.status==="closed"} aria-pressed={approved}
      onClick={()=>decide(stage,!approved)}>
      {t(...approvalStages[stage])} · {approved?t("معتمد","Approved"):t("اعتماد","Approve")}
    </button>)}</div>
    <button type="button" className="pc-name" onClick={()=>setExceptions(!exceptions)}>{t("تعديل اعتماد فتحة واحدة","Review an individual opening")}</button>
    {exceptions&&<Table headers={[t("الفتحة","Opening"),...Object.values(approvalStages).map((text)=>t(...text))]}
      rows={order.items.map((item)=>[item.id,[item.specification.technical.tag||item.specification.code,
        ...Object.entries(approvalStages).map(([stage,text])=>{
          const current=order.stage_approvals.find((row)=>row.stage===stage)?.items.find(({id})=>id===item.id);
          return <button type="button" aria-label={(item.specification.technical.tag||item.specification.code)+" · "+t(...text)}
            aria-pressed={Boolean(current?.approved)} disabled={!can("release")||action.busy||order.status==="closed"}
            onClick={()=>decide(stage,!current?.approved,item.id)}>{current?.approved?t("معتمد","Approved"):t("اعتماد","Approve")}</button>;
        }),
      ]])}/>}
    <ErrorMessage error={action.error}/>
  </section>;
}

function Inspection({order,endpoint,request,can,t,reload,close}) {
  const [data,setData]=useState({stage:"survey",result:"hold",release:"pending",inspection_date:localDate(),checklist:{}});
  const action=useAction(request,()=>{close();reload();});
  const set=(key,value)=>setData({...data,[key]:value});
  const entries=[["defects","العيوب / الملاحظات","Defects / observations"],["corrective_action","الإجراء التصحيحي","Corrective action"],
    ["correction_owner","مسؤول التصحيح","Correction owner"],["closed_on","تاريخ الإغلاق","Closure date","date"],
    ["delivery_ref","مرجع التسليم","Delivery reference"]];
  return <Dialog t={t} wide title={t("تسجيل فحص الجودة","Record inspection")} onClose={close}>
    <form className="pc-stack" onSubmit={(event)=>{event.preventDefault();action.run(endpoint+"/inspections","POST",data);}}>
      <div className="pc-form">
        <Pick label={t("بند الإنتاج","Order item")} required value={data.order_item_id} onChange={(value)=>set("order_item_id",value)}
          items={order.items.map(({id,specification})=>[id,specification.code])}/>
        <Pick label={t("المرحلة","Inspection stage")} value={data.stage} required onChange={(value)=>set("stage",value)} items={options(stages,t)}/>
        <Text type="date" label={t("تاريخ الفحص","Inspection date")} value={data.inspection_date} required onChange={(value)=>set("inspection_date",value)}/>
      </div>
      <fieldset><legend>{t("قائمة الفحص","Checklist")}</legend><div className="pc-form">
        {Object.entries(checkLabels).map(([key,labels])=><Pick label={t(...labels)} key={key} value={data.checklist[key]||"uninspected"}
          items={options(checkResults,t)} onChange={(value)=>set("checklist",{...data.checklist,[key]:value})}/>)}
      </div></fieldset>
      <div className="pc-form">
        <Pick label={t("النتيجة","Result")} value={data.result} required onChange={(value)=>set("result",value)} items={options(results,t)}/>
        {can("release")&&<Pick label={t("اعتماد الإفراج","Release decision")} value={data.release} onChange={(value)=>set("release",value)}
          items={options({pending:states.pending,approved:states.approved,rejected:states.rejected},t)}/>}
        {entries.map(([key,ar,en,type])=><Text key={key} label={t(ar,en)} value={data[key]} type={type}
          required={key==="defects"&&data.result!=="passed"} onChange={(value)=>set(key,value)}/>)}
      </div>
      <ErrorMessage error={action.error}/>
      <button type="submit" className="primary" disabled={action.busy}>{t("حفظ الفحص","Save inspection")}</button>
    </form>
  </Dialog>;
}

function Assignments({people,values,set,t,required=false}) {
  const optionsForPeople=people.map((row)=>[row.id,[row.name,row.company,row.position].filter(Boolean).join(" · ")]);
  return <div className="pc-form">{options(assignmentRoles,t).map(([key,name])=><Suggest key={key} label={name}
    value={optionsForPeople.find(([id])=>String(id)===String(values[key]))?.[1]||values[key]}
    onChange={(value)=>set({...values,[key]:optionsForPeople.find(([,text])=>text===value)?.[0]||value})}
    required={required&&key==="loading"} items={optionsForPeople}/>)}</div>;
}

function Loading({order,endpoint,request,t,people,reload,close}) {
  const defaults=Object.fromEntries(people.filter(({responsibility})=>responsibility).map((person)=>[person.responsibility,person.id]));
  const [data,setData]=useState(()=>({responsible:defaults,reference:order.loading_reference||"",loading_date:localDate(),command_key:newKey()}));
  const [amounts,setAmounts]=useState({});
  const set=(key,value)=>setData({...data,[key]:value});
  const action=useAction(request,()=>{close();reload();});
  return <Dialog t={t} wide title={t("تسجيل دفعة تحميل","Record loading batch")} onClose={close}>
    <form className="pc-stack" onSubmit={(event)=>{
      event.preventDefault();
      const lines=order.balances.filter((row)=>Number(amounts[row.order_item_id+":"+row.kind])>0).map((row)=>({
        order_item_id:row.order_item_id,kind:row.kind,quantity:amounts[row.order_item_id+":"+row.kind]}));
      action.run(endpoint+"/loading","POST",{...data,lines});
    }}>
      <div className="pc-form">
        <Text type="date" label={t("تاريخ التحميل","Loading date")} value={data.loading_date} required onChange={(value)=>set("loading_date",value)}/>
        <Text label={t("رقم أمر التحميل","Loading order no.")} value={data.reference} onChange={(value)=>set("reference",value)}/>
        <Text label={t("ملاحظات","Notes")} value={data.notes} onChange={(value)=>set("notes",value)}/>
      </div>
      {defaults.loading?<details><summary>{t("المسؤولون عن التحميل","Loading team")} · {people.find(({id})=>id===Number(data.responsible.loading))?.name}</summary>
        <Assignments people={people} values={data.responsible} set={(value)=>set("responsible",value)} t={t} required/></details>:
        <Assignments people={people} values={data.responsible} set={(value)=>set("responsible",value)} t={t} required/>}
      <Table headers={[t("الفتحة","Opening"),t("المقاس مم","Size mm"),t("المكون","Component"),t("المتبقي","Remaining"),t("التحميل الفعلي","Actual loading")]}
        empty={t("لا توجد كميات متبقية.","No remaining quantities.")}
        rows={order.balances.filter((row)=>row.remaining>0).map((row)=>{
          const key=row.order_item_id+":"+row.kind;
          return [key,[row.tag||row.code,<bdi dir="ltr">{row.width_mm??"—"} × {row.height_mm??"—"}</bdi>,display(panelNames,row.kind,t),quantity(row.remaining),
            <Text label={row.code+" · "+display(panelNames,row.kind,t)} type="number" min={0} max={row.remaining} step={1} value={amounts[key]}
              onChange={(value)=>setAmounts({...amounts,[key]:value})}/>]];
        })}/>
      <ErrorMessage error={action.error}/>
      <button type="submit" className="primary" disabled={action.busy||!Object.values(amounts).some((val)=>Number(val)>0)}>{t("حفظ التحميل","Save loading")}</button>
    </form>
  </Dialog>;
}

function Report({endpoint,t,uiLanguage,loading,maintenance,approvals,people,close,apiBase,session,reference,saveNativeReport,shareNativeReport,ctx,path,request,can,reload}) {
  const [draft,setDraft]=useState({classification:"materials",drawings:true,measurement_watermark:false,people:{},locale:uiLanguage});
  const [pdf,setPdf]=useState(null);
  const [error,setError]=useState(null);
  const [busy,setBusy]=useState(false);
  const frame=useRef(null);
  const abort=useRef(null);
  useEffect(()=>()=>abort.current?.abort(),[]);
  useEffect(()=>()=>{if (pdf) URL.revokeObjectURL(pdf.url);},[pdf]);
  const set=(key,value)=>{setDraft({...draft,[key]:value});setPdf(null);setError(null);};
  const title=approvals?t("حالة الاعتمادات","Approval Status"):maintenance?t("تقرير الصيانة","Maintenance Report"):loading?t("أمر تحميل","Loading Order"):
    t("أمر تصنيع / طلب خامات","Manufacturing Order / Material Requisition");
  const kind=approvals?"approvals":maintenance?"maintenance":loading?"loading":"manufacturing";
  const fileName=pdf?.filename||reference+" - "+kind+".pdf";
  async function preview(event) {
    event.preventDefault();
    setBusy(true);setError(null);
    const controller=new AbortController();
    abort.current=controller;
    try {
      const response=await fetch(`${apiBase.replace(/\/$/,"")}/api/project-operations${endpoint}/pdf`,{
        method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${session}`},signal:controller.signal,
        body:JSON.stringify({...draft,kind}),
      });
      if (!response.ok) throw new Error((await response.json().catch(()=>null))?.error || `HTTP ${response.status}`);
      const blob=await response.blob();
      const disposition=response.headers.get("content-disposition")||"";
      const encoded=disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const filename=encoded?decodeURIComponent(encoded):disposition.match(/filename="([^"]+)"/)?.[1];
      if (!controller.signal.aborted) setPdf({blob,url:URL.createObjectURL(blob),filename});
    } catch(cause) {if (!controller.signal.aborted) setError(cause);}
    finally {if (!controller.signal.aborted) setBusy(false);}
  }
  async function output(print) {
    setError(null);
    try {
      if (print) {
        if (window.priceOfferDesktop?.openReportPreview)
          await window.priceOfferDesktop.openReportPreview({bytes:new Uint8Array(await pdf.blob.arrayBuffer()),fileName});
        else if (shareNativeReport) await shareNativeReport(pdf.blob,fileName);
        else if (frame.current?.contentWindow) {frame.current.contentWindow.focus();frame.current.contentWindow.print();}
      } else if (window.priceOfferDesktop?.saveReportFile)
        await window.priceOfferDesktop.saveReportFile({bytes:new Uint8Array(await pdf.blob.arrayBuffer()),fileName,format:"pdf",reportType:"project-operations"});
      else if (saveNativeReport) await saveNativeReport(pdf.blob,fileName);
      else {
        const link=document.createElement("a");
        link.href=pdf.url;
        link.download=fileName;
        link.click();
      }
    } catch(cause) {setError(cause);}
  }
  return <Dialog title={title} t={t} wide onClose={close}>
    <form className="pc-stack" onSubmit={preview}>
      <fieldset className="pc-stack" disabled={busy}>
      <div className="pc-form">
        <Pick label={t("لغة التقرير","Report language")} value={draft.locale} required onChange={(value)=>set("locale",value)}
          items={[["ar",t("العربية","Arabic")],["en",t("الإنجليزية","English")]]}/>
        {!loading&&!maintenance&&!approvals&&<Pick label={t("نوع التقرير","Report type")} value={draft.classification} required
          onChange={(value)=>set("classification",value)} items={[
            ["materials",t("طلب خامات","Material requisition")],["manufacturing",t("أمر تصنيع","Manufacturing order")],
          ]}/>}
      </div>
      {!maintenance&&!approvals&&(loading?null:
        <div className="ops-options">
          <label className="pc-check"><input type="checkbox" checked={draft.drawings} onChange={(event)=>set("drawings",event.target.checked)}/>{t("إدراج الرسومات","Include drawings")}</label>
          <label className="pc-check"><input type="checkbox" checked={draft.measurement_watermark}
            onChange={(event)=>set("measurement_watermark",event.target.checked)}/>{t("علامة مائية لحالة المقاسات","Measurement status watermark")}</label>
        </div>)}
      {!maintenance&&!approvals&&ctx&&<details><summary>{t("توقيعات المشروع","Project signatures")}</summary>
        <ProjectSignatures {...{ctx,path,request,t,can,reload,people}} initialKind={loading?"loading":"manufacturing"} fixedKind/>
      </details>}
      <div className="pc-toolbar">
        <button className="primary" type="submit">{t("معاينة","Preview")}</button>
        <button type="button" disabled={!pdf} onClick={()=>output(false)}>{t("تنزيل PDF","Download PDF")}</button>
        <button type="button" disabled={!pdf} onClick={()=>output(true)}>{t("فتح للطباعة","Open for printing")}</button>
      </div>
      </fieldset>
      <ErrorMessage error={error}/>
    </form>
    {pdf&&!shareNativeReport&&<iframe ref={frame} title={title} className="ops-preview" src={pdf.url}/>}
  </Dialog>;
}
