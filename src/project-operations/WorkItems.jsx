import {useEffect,useId,useState} from "react";
import {Dialog,Field,localDate,newKey,useDebounce,useResource} from "../certificates/shared.jsx";
import {ErrorMessage,Page,Pick,SystemPick,Table,Text,display,options,panelNames,quantity,states,useAction,usePaged} from "./shared.jsx";
import SpecificationGrid from "./SpecificationGrid.jsx";
import GroupedSpecifications from "./GroupedSpecifications.jsx";
import SourceRefresh from './SourceRefresh.jsx';
import {technicalText,fieldOptions,coatingValue,configurationTags,perimeterText,openingDefaults,hasTrim,partMeasurementAvailable} from "./terminology.js";

const commonParts={
  measurement:["المقاسات","Measurements"],profile:["نظام القطاعات","Profile system"],glass:["الزجاج","Glass"],
  accessories:["الإكسسوارات","Accessories"],finish:["التشطيب","Finish"],details:["التفاصيل الفنية","Technical details"],drawing:["المخططات","Drawings"],
};
const directions={right:["يمين","Right"],left:["يسار","Left"],top:["أعلى","Top"],bottom:["أسفل","Bottom"]};
const commercialFields=[
  ["description","الوصف","Description"],["unit","وحدة العقد","Contractual unit"],["quantity","كمية العقد","Contractual quantity","number"],
  ["rate","سعر الوحدة","Unit rate","number"],["width_mm","عرض العقد مم","Contract width (mm)","number"],
  ["height_mm","ارتفاع العقد مم","Contract height (mm)","number"],["depth_mm","عمق العقد مم","Contract depth (mm)","number"],
  ["profile","مواصفة القطاعات","Profile specification"],["glass","مواصفة الزجاج","Glass specification"],["finish","التشطيب","Finish"],
];
const valid=(value)=>Boolean(value && !["لا","بدون","لا ينطبق","none","no","n/a"].includes(String(value).toLowerCase()));

function DynamicField({field,value,change,t,locale,spec={}}) {
  const list=useId();
  const {key,type}=field;
  const name=field[locale];
  if (field.key==="coating_direction") return <Pick label={name} value={coatingValue(value)} onChange={(next)=>change(key,next)}
    items={fieldOptions(field,spec).map((option)=>[option,technicalText(option,locale)])}/>;
  if (type==="boolean") return <Pick label={name} value={value==null?"":String(value)} onChange={(next)=>change(key,next===""?null:next==="true")}
    items={[["true",t("نعم","Yes")],["false",t("لا","No")]]}/>;
  if (type==="sides") {
    const sides=Array.isArray(value)?value:[];
    return <fieldset><legend>{name}</legend><div className="ops-options">
      <label className="pc-check"><input type="checkbox" checked={sides.length===4} onChange={(event)=>change(key,event.target.checked?Object.keys(directions):[])}/>
        {key==="perimeter"?t("ببار كامل","Full perimeter trim"):t("المحيط بالكامل","Full perimeter")}</label>
      {Object.entries(directions).map(([side,title])=><label key={side} className="pc-check">
        <input type="checkbox" checked={sides.includes(side)} onChange={(event)=>change(key,event.target.checked?[...sides,side]:sides.filter((entry)=>entry!==side))}/>
        {t(...title)}</label>)}
    </div>{key==="perimeter"&&<output>{perimeterText(sides,locale)}</output>}</fieldset>;
  }
  return <><Field label={name}>
    <input type={type==="number"?"number":type==="date"?"date":"text"} value={technicalText(value,locale)??""} min={type==="number"?0:undefined}
      step={type==="number"?"any":undefined} dir={type==="number"?"ltr":"auto"} list={field.options?.length?list:undefined}
      onChange={(event)=>change(key,field.options?.find((option)=>technicalText(option,locale)===event.target.value)||event.target.value)}/>
  </Field>{field.options?.length>0&&<datalist id={list}>{field.options.map((entry)=><option key={entry} value={technicalText(entry,locale)}/>)}</datalist>}</>;
}

function Subframe({value={},change,t}) {
  const sides=value?.sides||{};
  const setSide=(side,enabled)=>{
    const next={...sides};
    if (enabled) next[side]={}; else delete next[side];
    change({...value,sides:next});
  };
  return <fieldset><legend>{t("الساب فريم","Sub-frame")}</legend>
    <div className="ops-options">{Object.entries(directions).map(([side,title])=>
      <label key={side} className="pc-check"><input type="checkbox" checked={Boolean(sides[side])} onChange={(event)=>setSide(side,event.target.checked)}/>{t(...title)}</label>)}
    </div>
    {Object.keys(sides).length>0&&<div className="pc-stack">
      <Pick label={t("حالة خصم الساب فريم","Sub-frame deduction status")} required value={value.status}
        onChange={(status)=>change({...value,status})} items={[["deducted",t("مخصوم بالفعل","Already deducted")],["not_deducted",t("غير مخصوم","Not deducted")]]}/>
      {Object.entries(sides).map(([side,measure])=><div className="pc-form" key={side}>
        <strong>{t(...directions[side])}</strong>
        {[["width","عرض القطاع مم","Section width (mm)"],["depth","عمق القطاع مم","Section depth (mm)"],
          ...(value.status==="not_deducted"?[["deduction","الخصم الفعلي مم","Deduction (mm)"]]:[])].map(([key,ar,en])=>
          <Text key={key} type="number" min={0.01} step="any" label={t(ar,en)} value={measure[key]} required
            onChange={(input)=>change({...value,sides:{...sides,[side]:{...measure,[key]:input}}})}/>)}
      </div>)}
    </div>}
  </fieldset>;
}

function dimensions(spec) {
  if (!Number(spec.width_mm)||!Number(spec.height_mm)) return null;
  const frame=spec.subframe;
  const sides=frame?.sides||{};
  if (!Object.keys(sides).length || frame.status==="deducted") return [spec.width_mm,spec.height_mm];
  if (frame.status!=="not_deducted" || Object.values(sides).some((side)=>!Number(side.deduction))) return null;
  const deduction=(key)=>Number(sides[key]?.deduction||0);
  const net=[Number(spec.width_mm)-deduction("right")-deduction("left"),Number(spec.height_mm)-deduction("top")-deduction("bottom")];
  return net.every((value)=>value>0)?net:null;
}

function SpecEditor({draft,change,catalogue,t,locale,nested=false}) {
  const spec=openingDefaults(draft.category,draft.technical||{});
  const category=catalogue.categories.find(({id})=>id===draft.category);
  const system=category?.systems.find(({id})=>id===draft.system);
  const tags=configurationTags(system,spec);
  const selectCategory=(id)=>change({...draft,category:id,system:""});
  const set=(key,value)=>change({...draft,technical:{...spec,[key]:value}});
  const specific=[...(category?.fields||[]),...(system?.fields||[])].filter((field)=>{
    const required=catalogue.conditional[draft.category]?.[field.key];
    const dependency=catalogue.dependencies[draft.category]?.[field.key];
    return partMeasurementAvailable(field,tags,spec)&&hasTrim(field.key,spec)&&(!field.populatedOnly||spec[field.key]!=null&&spec[field.key]!=="")&&(!required||required.split(" ").some((tag)=>tags.has(tag))) && (!dependency||valid(spec[dependency]))
      && (!field.minLeaves||Number(spec.leaves)>=field.minLeaves);
  });
  const opening=["windows","doors"].includes(draft.category);
  const preview=dimensions(spec);
  const input=(field)=><DynamicField key={field.key} field={field} value={spec[field.key]} change={set} t={t} locale={locale}
    spec={{...spec,glazing:spec.glazing||(system?.tags?.includes("insulated")?"Double":"")}}/>;
  return <div className="ops-fields">
    <div className="pc-form">
      <Pick label={t("الفئة","Work category")} value={draft.category} onChange={selectCategory} required
        items={catalogue.categories.filter(({id})=>!nested||["windows","doors"].includes(id)).map((cat)=>[cat.id,cat[locale]])}/>
      <SystemPick label={t("طريقة الفتح / النظام","Opening / system")} t={t} value={draft.system} required onChange={(next)=>change({...draft,system:next})}
        items={(category?.systems||[]).map((item)=>[item.id,item[locale]])}/>
    </div>
    {system&&<>
      <fieldset><legend>{t("الموقع والمقاسات والخامات","Location, measurements and materials")}</legend>
        <div className="pc-form">{catalogue.common.map(input)}</div>
      </fieldset>
      <fieldset><legend>{t("تفاصيل التكوين","Configuration details")}</legend><div className="pc-form">{specific.map(input)}</div></fieldset>
      {opening&&<>
        <Subframe value={spec.subframe} change={(value)=>set("subframe",value)} t={t}/>
        <div className="pc-form">
          <Pick label={t("الربر بار","Rubber bar")} value={spec.rubber_bar==null?"":String(spec.rubber_bar)}
            onChange={(val)=>set("rubber_bar",val===""?null:val==="true")}
            items={[["true",t("مطلوب","Required")],["false",t("غير مطلوب","Not required")]]}/>
          <div><strong>{t("مقاس التصنيع مم","Manufacturing dimensions (mm)")}</strong><p><bdi>{preview?preview.join(" × "):"—"}</bdi></p></div>
        </div>
      </>}
      {!nested&&draft.category==="curtain_walls"&&valid(spec.opening_unit)&&
        <fieldset><legend>{t("وحدة الفتح المدمجة","Integrated opening unit")}</legend>
          <SpecEditor nested t={t} locale={locale} catalogue={catalogue}
            draft={{...spec.integrated,technical:spec.integrated?.spec||{}}}
            change={({category,system,technical})=>set("integrated",{category,system,spec:technical})}/>
        </fieldset>}
      {!nested&&<details><summary>{t("تحديد عدد الألواح لكل فتحة عند الحاجة","Specify panels per opening when needed")}</summary>
        <div className="pc-form ops-spec-fields">{options(panelNames,t).map(([key,name])=><Text key={key} label={name} type="number" min={0} step={1}
          value={spec.panel_counts?.[key]} onChange={(next)=>set("panel_counts",{...spec.panel_counts,[key]:next})}/>)}</div>
      </details>}
    </>}
  </div>;
}

function Commercial({values,setValues,t}) {
  return <div className="pc-form">
    {commercialFields.map(([key,ar,en,type])=><Text key={key} label={t(ar,en)} type={type} min={0} step="any"
      required={["description","unit","rate","quantity"].includes(key)} value={values[key]}
      onChange={(next)=>setValues({...values,[key]:next})}/>)}
    <Pick label={t("طريقة وحدة الفاتورة","Invoice unit")} value={values.unit_code} onChange={(next)=>setValues({...values,unit_code:next})}
      items={[["sqm","m²"],["lm","l.m"],["count",t("عدد","Pcs")],["fixed",t("مقطوعية","Lump sum")]]}/>
    <label className="pc-check"><input type="checkbox" checked={Boolean(values.removed)} onChange={(event)=>setValues({...values,removed:event.target.checked})}/>
      {t("إلغاء البند","Remove the item")}</label>
  </div>;
}

function ItemDialog({mode,item,close,request,path,catalogue,uiLanguage,t,can,reload,apiBase,session,boqId}) {
  const [draft,setDraft]=useState(()=>({...item,technical:item?.technical||{},values:item?.commercial||{},reason:"",remember:false}));
  const [view,setView]=useState("technical");
  const action=useAction(request,()=>{close();reload();});
  const change=(key,value)=>setDraft((current)=>({...current,[key]:value}));
  function submit(event) {
    event.preventDefault();
    if (mode==="new") action.run(path+"/items","POST",{...draft,source_document_id:boqId});
    else action.run(path+"/items/"+item.id,"PATCH",draft);
  }
  const flags=[["technical","المواصفات","Specifications"],["commercial","تعديل العقد","BOQ revision"],
    ["approvals","اعتمادات التصنيع","Manufacturing approvals"],["drawings","الرسومات","Drawings"],["confirmation","تأكيد الكمية","Confirm quantity"]];
  return <Dialog t={t} wide title={mode==="new"?t("اقتراح بند جديد","Propose new item"):item.description} onClose={close}>
    {mode!=="new"&&<nav className="pc-tabs">{flags.map(([id,ar,en])=><button type="button" key={id}
      aria-pressed={view===id} onClick={()=>setView(id)}>{t(ar,en)}</button>)}</nav>}
    {(view==="technical")&&<form className="pc-stack" onSubmit={submit}>
      <fieldset disabled={!can("edit")||action.busy||mode!=="new"&&!item.active}>
        {mode==='new'?<Text label={t("كود البند","Item code")} value={draft.code} required onChange={value=>change('code',value)}/>:
          <><Text label={t("وصف الفتحة","Opening description")} value={draft.opening_description||draft.commercial.description} onChange={value=>change('opening_description',value)}/>
          {item.specification_overrides?.length>0&&<label className="pc-check"><input type="checkbox" checked={Boolean(draft.reset_overrides)} onChange={event=>change('reset_overrides',event.target.checked)}/>
            {t("استخدام المواصفات المشتركة وإلغاء استثناءات هذه الفتحة","Use shared specifications and clear this opening’s exceptions")}</label>}</>}
        <SpecEditor draft={draft} change={setDraft} catalogue={catalogue} locale={uiLanguage} t={t}/>
        {mode!=="new"&&<label className="pc-check"><input type="checkbox" checked={draft.remember}
          onChange={(event)=>change("remember",event.target.checked)}/>{t("تذكّر مواصفات هذا العميل","Remember customer defaults")}</label>}
        {mode==="new"&&<><Commercial values={draft.values} setValues={(value)=>change("values",value)} t={t}/>
          <Text label={t("سبب الإضافة","Reason for addition")} value={draft.reason} required onChange={(value)=>change("reason",value)}/></>}
      </fieldset>
      <ErrorMessage error={action.error}/>
      {can("edit")&&(mode==="new"||Boolean(item.active))&&<div><button type="submit" className="primary" disabled={action.busy}>
        {mode==="new"?t("إرسال للاعتماد","Submit for approval"):t("حفظ المواصفات","Save specifications")}</button></div>}
    </form>}
    {view==="commercial"&&<ChangeForm {...{item,request,path,t,can,reload}} onSaved={close}/>}
    {view==="approvals"&&<Approvals {...{item,request,path,t,can,reload}}/>}
    {view==="drawings"&&<Drawings {...{item,request,path,t,can,reload,apiBase,session}}/>}
    {view==="confirmation"&&<Confirm {...{item,request,path,t,can,reload}}/>}
  </Dialog>;
}

function ChangeForm({item,request,path,t,can,onSaved,reload,returned}) {
  const [value,setValue]=useState(returned?.proposed||item.commercial);
  const [reason,setReason]=useState("");
  const action=useAction(request,()=>{onSaved?.();reload();});
  return <form className="pc-stack" onSubmit={(event)=>{
    event.preventDefault();action.run(path+"/items/"+item.id+"/changes","POST",{values:value,reason,previous_change_id:returned?.id});
  }}>
    {item.original&&<details><summary>{t("قيم جدول الكميات الأصلي","Original BOQ values")}</summary>
      <Values value={item.original} t={t}/></details>}
    <fieldset disabled={!can("edit")||action.busy}>
      <Commercial values={value} setValues={setValue} t={t}/>
      <Text label={t("سبب التعديل","Reason for revision")} value={reason} required onChange={setReason}/>
    </fieldset>
    <ErrorMessage error={action.error}/>
    {can("edit")&&<div><button type="submit" className="primary" disabled={action.busy}>{t("إرسال للاعتماد","Submit for approval")}</button></div>}
  </form>;
}

function Approvals({item,path,t,request,can,reload}) {
  const [parts,setParts]=useState(()=>Object.fromEntries(item.approvals.map((part)=>[part.part,part])));
  const action=useAction(request,reload);
  const update=(key,field,value)=>setParts({...parts,[key]:{...parts[key],[field]:value}});
  return <form className="pc-stack" onSubmit={(event)=>{
    event.preventDefault();
    action.run(path+"/items/"+item.id+"/approvals","POST",{version:item.version,parts:Object.fromEntries(Object.entries(parts).filter(([,part])=>part.decision))});
  }}>
    <fieldset disabled={!can("release")||action.busy}><legend>{t("اعتمادات الإصدار الحالي","Approvals for this version")}</legend>
      {Object.entries(commonParts).map(([key,title])=><div className="pc-form" key={key}>
        <strong>{t(...title)}</strong>
        <Pick label={t("قرار الاعتماد","Decision")} value={parts[key]?.decision} onChange={(value)=>update(key,"decision",value)}
          items={[["approved",t("معتمد","Approved")],["unapproved",t("غير معتمد","Unapproved")],["na",t("غير منطبق","Not applicable")]]}/>
        <Text label={t("المرجع أو السبب","Reference or reason")} value={parts[key]?.reference} required={parts[key]?.decision==="na"}
          onChange={(value)=>update(key,"reference",value)}/>
      </div>)}
    </fieldset>
    <ErrorMessage error={action.error}/>
    {can("release")&&<button type="submit" className="primary" disabled={action.busy}>{t("حفظ الاعتمادات","Save approvals")}</button>}
  </form>;
}

function Drawings({item,path,t,request,can,reload,apiBase,session}) {
  const [capture,setCapture]=useState(null);
  const [preview,setPreview]=useState(null);
  const [assetError,setAssetError]=useState(null);
  const action=useAction(request,reload);
  useEffect(()=>()=>{if (preview) URL.revokeObjectURL(preview.url);},[preview]);
  const open=async(row)=>{
    setAssetError(null);
    try {
      const response=await fetch(apiBase.replace(/\/$/,"")+"/api/project-operations"+path+"/drawings/"+row.id,{
        headers:{Authorization:`Bearer ${session}`},
      });
      if (!response.ok) throw new Error(t("تعذرت معاينة الرسم","Could not open the drawing"));
      setPreview({...row,url:URL.createObjectURL(await response.blob())});
    } catch(cause){setAssetError(cause);}
  };
  function submit(event) {
    event.preventDefault();
    if (!capture) return;
    const file=capture;
    const reader=new FileReader();
    reader.onload=()=>action.run(path+"/items/"+item.id+"/drawings","POST",{name:file.name,mime:file.type,base64:String(reader.result).split(",")[1]});
    reader.onerror=()=>setAssetError(reader.error);
    reader.readAsDataURL(file);
  }
  return <>
    <Table headers={[t("الرسم","Drawing"),t("إصدار البند","Item version"),t("الإجراء","Action")]} empty={t("لم ترفق رسومات.","No drawings attached.")}
      rows={item.drawings.map((drawing)=>[drawing.id,[
        <button type="button" onClick={()=>open(drawing)}>{drawing.name}</button>,drawing.item_version,
        drawing.removed_at?t("مؤرشف","Archived"):can("edit")&&<button type="button" onClick={()=>
          action.run(path+"/drawings/"+drawing.id,"DELETE")}>{t("أرشفة","Archive")}</button>,
      ]])}/>
    {can("edit")&&<form className="pc-toolbar" onSubmit={submit}>
      <Field label={t("رسم أو مخطط","Drawing or sketch")}><input type="file" accept="image/png,image/jpeg,image/webp,application/pdf"
        onChange={(event)=>setCapture(event.target.files?.[0]||null)}/></Field>
      <button type="submit" disabled={action.busy||!capture}>{t("إرفاق","Attach")}</button>
    </form>}
    <ErrorMessage error={assetError||action.error}/>
    {preview&&<Dialog t={t} wide title={preview.name} onClose={()=>setPreview(null)}><div className="ops-drawing">
      {preview.mime==="application/pdf"?<iframe className="ops-preview" title={preview.name} src={preview.url}/>:
        <img src={preview.url} alt={preview.name}/>}
    </div></Dialog>}
  </>;
}

function Confirm({item,path,request,can,t,reload}) {
  const [form,setForm]=useState(()=>({stage:"installed",confirmed_on:localDate(),command_key:newKey()}));
  const change=(key,value)=>setForm({...form,[key]:value});
  const action=useAction(request,reload);
  return <form className="pc-stack" onSubmit={(event)=>{event.preventDefault();action.run(path+"/items/"+item.id+"/confirm","POST",form);}}>
    <fieldset disabled={!can("load")||action.busy}><legend>{t("تأكيد الكمية بوحدة العقد","Confirm quantity in the contractual unit")}</legend>
      <div className="pc-form">
        <Pick label={t("المرحلة","Stage")} value={form.stage} required onChange={(val)=>change("stage",val)}
          items={[["installed",t("تم التركيب","Installed")],...(can("finance")?[["claimable",t("مستحق المطالبة","Claimable")]]:[])]}/>
        <Text type="number" min={0.001} step="any" label={item.commercial.unit} value={form.quantity} required onChange={(value)=>change("quantity",value)}/>
        <Text type="date" label={t("التاريخ","Date")} value={form.confirmed_on} required onChange={(value)=>change("confirmed_on",value)}/>
      </div>
    </fieldset>
    <ErrorMessage error={action.error}/>
    {can("load")&&<button type="submit" className="primary" disabled={action.busy}>{t("تأكيد الكمية","Confirm quantity")}</button>}
  </form>;
}

export function WorkItems(props) {
  const {request,path,catalogue,uiLanguage,t,can,revision,ctx,reload,onOpenDocument,preferred}=props;
  const [id,setId]=useState(null);
  const [search,setSearch]=useState("");
  const [category,setCategory]=useState("");
  const [spreadsheet,setSpreadsheet]=useState(true);
  const [visitedSheet,setVisitedSheet]=useState(true);
  const [boqId,setBoqId]=useState(()=>{
    const chosen=preferred&&[...ctx.boqs,...ctx.linked_boqs].find(({id})=>id===preferred.id);
    return String(chosen?.id||ctx.operations.boq_id);
  });
  const q=useDebounce(search);
  const list=usePaged(request,spreadsheet?path+"/items":null,{q,category,boq_id:boqId},revision);
  const item=useResource(request,Number.isSafeInteger(id)?path+"/items/"+id:null,revision);
  const attach=useAction(request,reload);
  const sources=new Map([...ctx.boqs,...ctx.linked_boqs].map((source)=>[source.id,source]));
  const source=sources.get(Number(boqId));
  const linked=ctx.linked_boqs.some(({id})=>id===Number(boqId));
  const documentName=(doc)=>(doc.document_type==="invoice"?t("فاتورة","Invoice"):t("عرض سعر","Quotation"))+
    " "+(doc.operation_no||doc.document_no);
  return <>
    <div className="ops-document-bar">
      {sources.size>1?<Pick label={t("الفاتورة أو عرض السعر","Invoice or quotation")} value={boqId} required
        onChange={(value)=>{if (value) {setBoqId(value);list.setPage(1);}}}
        items={[...sources.values()].map((doc)=>[doc.id,documentName(doc)+(doc.title?" · "+doc.title:"")])}/>:
        source&&<strong><bdi>{documentName(source)}</bdi></strong>}
      {source&&<button type="button" className="pc-name" onClick={()=>onOpenDocument(source,ctx.customer)}>{t("فتح الأصل","Open source")}</button>}
      {linked&&<button type="button" onClick={()=>{setSpreadsheet(!spreadsheet);setVisitedSheet(true);}}>
        {spreadsheet?t("المواصفات المشتركة","Shared specifications"):t("جدول الفتحات","Opening worksheet")}</button>}
      {linked&&spreadsheet&&can("edit")&&<button type="button" onClick={()=>setId("new")}>{t("بند إضافي","Propose an extra item")}</button>}
    </div>
    {linked&&<SourceRefresh {...props} documentId={Number(boqId)}/>}
    {!linked&&can("edit")&&<div><button type="button" className="primary" disabled={attach.busy}
      onClick={()=>attach.run(path+"/boqs","POST",{boq_id:Number(boqId)})}>{t("فتح استمارة المواصفات","Open specifications form")}</button></div>}
    <ErrorMessage error={list.error||item.error||attach.error}/>
    <div hidden={!linked||spreadsheet}>
      <GroupedSpecifications key={boqId+':'+(source?.import_fingerprint||'')} {...props} boqId={linked?boqId:null} openItem={setId}/>
    </div>
    {visitedSheet&&<div hidden={!linked||!spreadsheet} className="pc-stack">
      <div className="pc-form">
        <Text label={t("بحث عن بند","Find an item")} value={search} onChange={(next)=>{setSearch(next);list.setPage(1);}}/>
        <Pick label={t("الفئة","Category")} value={category} placeholder={t("كل الفئات","All categories")}
          onChange={(next)=>{setCategory(next);list.setPage(1);}} items={catalogue.categories.map((cat)=>[cat.id,cat[uiLanguage]])}/>
      </div>
      <SpecificationGrid key={boqId+':'+(source?.import_fingerprint||'')} {...props} items={linked?list.data?.items||[]:[]} openItem={setId}
        pageKey={JSON.stringify([boqId,q,category,list.data?.page])} pagination={<Page data={list.data} onPage={list.setPage} t={t}/>}/>
    </div>}
    {(id==="new"||item.data)&&<ItemDialog {...props} key={id+":"+(item.data?.version||0)} mode={id==="new"?"new":"edit"}
      item={item.data} boqId={boqId} close={()=>setId(null)}/>}
  </>;
}

function Values({value,t}) {
  if (!value) return <p>{t("بند جديد","New item")}</p>;
  return <dl>{commercialFields.filter(([key])=>value[key]!=null&&value[key]!=="").map(([key,ar,en])=>
    <div key={key}><dt>{t(ar,en)}</dt><dd><bdi>{value[key]}</bdi></dd></div>)}
    {value.removed&&<div><dt>{t("التغيير","Change")}</dt><dd>{t("إلغاء البند","Item removed")}</dd></div>}</dl>;
}

export function Changes({request,path,t,can,revision,reload,onOpenDocument,ctx}) {
  const [status,setStatus]=useState("");
  const [selected,setSelected]=useState(null);
  const [review,setReview]=useState({status:"approved",note:""});
  const [resubmit,setResubmit]=useState(false);
  const list=usePaged(request,path+"/changes",{status},revision);
  const change=list.data?.items.find(({id})=>id===selected);
  const adjustment=useResource(request,can("finance")&&change?.adjustment_id?path+"/changes/"+selected+"/adjustment":null,revision);
  const action=useAction(request,reload);
  return <>
    <h3>{t("تعديلات بنود العقد","Contract item variations")}</h3>
    <Pick label={t("الحالة","Status")} value={status} onChange={(value)=>{setStatus(value);list.setPage(1);}}
      items={options({pending:states.pending,approved:states.approved,rejected:states.rejected,returned:states.returned},t)}
      placeholder={t("كل الحالات","All statuses")}/>
    <ErrorMessage error={list.error||action.error}/>
    <Table headers={[t("البند","Item"),t("الحالة","Status"),t("المرسل","Submitted by"),t("تاريخ الإرسال","Submitted"),t("المعتمد","Reviewer")]}
      empty={t("لا توجد تعديلات.","No revisions.")}
      rows={(list.data?.items||[]).map((row)=>[row.id,[
        <button type="button" className="pc-name" onClick={()=>{setSelected(row.id);setResubmit(false);}}>{row.description}</button>,
        display(states,row.status,t),row.submitter,<bdi>{row.submitted_at}</bdi>,row.reviewer||"—",
      ]])}/>
    <Page data={list.data} onPage={list.setPage} t={t}/>
    {change&&<Dialog t={t} wide title={t("مراجعة التعديل","Review revision")+" #"+change.id} onClose={()=>setSelected(null)}>
      {resubmit?<ChangeForm returned={change} item={{id:change.item_id,commercial:change.prior,original:null}} {...{request,path,t,can,reload}}
        onSaved={()=>setSelected(null)}/>:<>
        <p>{change.reason}</p>
        <div className="ops-record-diff">
          <section className="ops-section"><h3>{t("القيم السابقة","Prior values")}</h3><Values value={change.prior} t={t}/></section>
          <section className="ops-section"><h3>{t("القيم المقترحة","Proposed values")}</h3><Values value={change.proposed} t={t}/></section>
        </div>
        {change.review_note&&<p>{change.review_note}</p>}
        {change.status==="pending"&&can("approve")&&<form className="pc-stack" onSubmit={(event)=>{
          event.preventDefault();action.run(path+"/changes/"+change.id+"/review","POST",review);
        }}>
          <Pick label={t("القرار","Decision")} value={review.status} onChange={(value)=>setReview({...review,status:value})}
            items={options({approved:states.approved,rejected:states.rejected,returned:states.returned},t)} required/>
          <Text label={t("ملاحظات المراجعة","Review note")} value={review.note} onChange={(value)=>setReview({...review,note:value})} required={review.status!=="approved"}/>
          <button type="submit" className="primary" disabled={action.busy}>{t("تسجيل القرار","Record decision")}</button>
        </form>}
        {change.status==="returned"&&can("edit")&&<button type="button" onClick={()=>setResubmit(true)}>{t("تعديل وإعادة إرسال","Revise and resubmit")}</button>}
        {change.status==="approved"&&can("finance")&&<div className="pc-toolbar">
          {!change.adjustment_id?<button type="button" onClick={()=>action.run(path+"/changes/"+change.id+"/adjustment","POST",{})}
            disabled={action.busy}>{t("إعداد مسودة تسوية مرتبطة","Prepare linked draft adjustment")}</button>:<>
            {adjustment.data&&<>
              <button type="button" onClick={()=>onOpenDocument({...adjustment.data,document_type:"invoice"},ctx.customer)}>
                {t("فتح التسوية","Open adjustment")} <bdi>{adjustment.data.operation_no}</bdi>
              </button>
              <bdi>{quantity(adjustment.data.total)} {ctx.project.currency}</bdi>
              {adjustment.data.status==="draft"&&<button type="button" className="primary" disabled={action.busy}
                onClick={()=>action.run(path+"/changes/"+change.id+"/post","POST",{})}>{t("اعتماد وترحيل","Approve and post")}</button>}
              {adjustment.data.status==="approved"&&<span className="pc-chip">{t("تم الترحيل","Posted")}</span>}
            </>}
          </>}
        </div>}
        <ErrorMessage error={action.error||adjustment.error}/>
      </>}
    </Dialog>}
  </>;
}
