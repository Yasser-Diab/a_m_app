import {useEffect,useId,useMemo,useState} from "react";
import {Field,queryString,useResource} from "../certificates/shared.jsx";
import {ErrorMessage,Page,Pick,Table} from "./shared.jsx";
import {SpecificationError,applySpecificationEdits,editSpecification,resolveSpecificationEdits} from "./specification-edits.jsx";
import {technicalText,fieldOptions,coatingValue,configurationTags,perimeterText} from "./terminology.js";

const measurementFields=[
  ["tag","رقم الفتحة","Opening tag"],["quantity","العدد","Count"],
  ["width_mm","العرض (مم)","Width (mm)"],["height_mm","الارتفاع (مم)","Height (mm)"],
];
const labels={
  category:["نوع العمل","Work type"],system:["طريقة الفتح / النظام","Opening / system"],
  profile:["نوع القطاع","Profile"],color:["اللون","Colour"],finish:["نوع التشطيب","Finish"],
  infill:["تكوين الزجاج / الحشو","Glass composition / infill"],glass_thickness:["سمك الزجاج (مم)","Glass thickness (mm)"],
  coating_direction:["اتجاه العاكس","Coating direction"],georgian:["جورجيا","Georgian bars"],
  interlock_right:["التسكيك يمين","Right interlock"],interlock_left:["التسكيك شمال","Left interlock"],
  rubber_bar:["جلدة التثبيت","Rubber glazing gasket"],perimeter:["البرور","Perimeter trims"],
};
const sides={right:["يمين","Right"],left:["شمال","Left"],top:["علوي","Top"],bottom:["سفلي","Bottom"]};
const LOOKUP_FIELDS=["hinge_side","opening_direction","fixed_position","tilt_fixed","top_fixed_height","bottom_fixed_height",
  "vent_opening","vent_position","vent_width","vent_height","vent_direction","perimeter","rubber_bar","interlock_right","interlock_left",
  "interlock_right_mm","interlock_left_mm","reflective","georgian","georgian_configuration",
  "layers","outside_glass","outside_thickness","spacer_thickness","cavity","inside_glass","inside_thickness","interlayer"];
const CORE_FIELDS=["profile","color","finish","glass_type","infill","glass_thickness","glass_color","glazing","coating_direction"];
const LOCK_FIELDS=["leaves","frames_per_opening","lock_right","lock_left","central_lock_handle","screen","screen_type","screen_leaves","hinge","lock","handle","roller"];

function together(rows,get) {
  const sample=get(rows[0])??"";
  const mixed=rows.some((item)=>JSON.stringify(get(item)??"")!==JSON.stringify(sample));
  return {mixed,value:mixed?"":sample};
}

function QuickField({field,name,current,change,t,locale}) {
  const list=useId();
  const placeholder=current.mixed?t("قيم مختلفة","Different values"):"";
  if (field.type==="boolean") return <Pick label={name} value={typeof current.value==="boolean"?String(current.value):""}
    placeholder={placeholder||"—"} items={[["true",t("نعم","Yes")],["false",t("لا","No")]]}
    onChange={(value)=>change(field.key,value===""?null:value==="true")}/>;
  if (field.type==="sides") return <fieldset className="ops-sides"><legend>{name}</legend>
    {current.mixed&&<span>{placeholder}</span>}
    <div className="ops-options">{Object.entries(sides).map(([side,text])=>{
      const selection=Array.isArray(current.value)?current.value:[];
      return <label key={side} className="pc-check"><input type="checkbox" checked={selection.includes(side)}
        onChange={(event)=>change(field.key,event.target.checked?[...selection,side]:selection.filter((id)=>id!==side))}/>{t(...text)}</label>;
    })}</div>
    {field.key==="perimeter"&&!current.mixed&&<output>{perimeterText(current.value,locale)}</output>}
  </fieldset>;
  if (field.key==="coating_direction") return <Pick label={name} value={coatingValue(current.value)} placeholder={placeholder||"—"}
    items={field.options.map((option)=>[option,technicalText(option,locale)])} onChange={(value)=>change(field.key,value)}/>;
  return <><Field label={name}>
    <input type={field.type==="number"?"number":"text"} min={field.type==="number"?0:undefined} step="any"
      list={field.options?.length?list:undefined}
      dir={field.type==="number"?"ltr":"auto"} placeholder={placeholder} value={technicalText(current.value,locale)}
      onChange={(event)=>change(field.key,field.options?.find((option)=>technicalText(option,locale)===event.target.value)||event.target.value)}/>
    </Field>{field.options?.length>0&&<datalist id={list}>{field.options.map((option)=><option key={option} value={technicalText(option,locale)}/>)}</datalist>}</>;
}

export default function GroupedSpecifications({request,path,boqId,revision,catalogue,uiLanguage,t,can,reload,openItem}) {
  const url=path+"/specification-groups";
  const [chosen,setChosen]=useState(null);
  const [cached,setCached]=useState(null);
  const [patches,setPatches]=useState({});
  const [page,setPage]=useState(1);
  const [busy,setBusy]=useState(false);
  const [problem,setProblem]=useState(null);
  const [message,setMessage]=useState("");
  const groupList=useResource(request,boqId?url+queryString({boq_id:boqId}):null,revision);
  const [groupCache,setGroupCache]=useState(null);
  useEffect(()=>{if (groupList.data) setGroupCache({boqId,data:groupList.data});},[boqId,groupList.data]);
  const groups=groupList.data||(groupCache&&groupCache.boqId===boqId?groupCache.data:[]);
  const groupId=groups.some(({id})=>id===chosen)?chosen:groups[0]?.id;
  const group=useResource(request,groupId?url+queryString({boq_id:boqId,item_id:groupId}):null,revision);
  useEffect(()=>{if (group.data) setCached({groupId,data:group.data});},[groupId,group.data]);
  const data=group.data||(cached&&cached.groupId===groupId?cached.data:null);
  const items=data?.rows||[];
  const displayed=items.map((item)=>applySpecificationEdits(item,patches[item.id]));
  const current=(key)=>together(displayed,(item)=>key==="category"||key==="system"?item?.[key]:item?.technical[key]);
  const category=catalogue.categories.find(({id})=>id===current("category").value);
  const system=category?.systems.find(({id})=>id===current("system").value);
  const fields=useMemo(()=>new Map([...catalogue.common,...(category?.fields||[]),...(system?.fields||[]),
    ...(["windows","doors"].includes(category?.id)?[{key:"rubber_bar",type:"boolean"}]:[])].map((field)=>[field.key,field])),
  [catalogue,category,system]);
  const label=(key)=>{
    const field=fields.get(key);
    const pair=labels[key]||measurementFields.find(([name])=>name===key)?.slice(1);
    return pair?t(...pair):field?.[uiLanguage]||key;
  };
  const applies=(item,key)=>{
    const field=fields.get(key);
    if (!field) return false;
    const tags=catalogue.conditional[item.category]?.[key];
    const depends=catalogue.dependencies[item.category]?.[key];
    const specific=catalogue.categories.find(({id})=>id===item.category)?.systems.find(({id})=>id===item.system);
    const activeTags=configurationTags(specific,item.technical);
    const dependency=item.technical[depends];
    return (!tags||tags.split(" ").some((tag)=>activeTags.has(tag)))&&
      (!depends||Boolean(dependency)&&!["لا","بدون","لا ينطبق","no","none","n/a"].includes(String(dependency).toLowerCase()))&&
      (!field.minLeaves||Number(item.technical.leaves)>=field.minLeaves);
  };
  const visible=(key)=>displayed.some((item)=>applies(item,key));
  const change=(targets,key,value)=>{
    setPatches((previous)=>{
      const next={...previous};
      for (const item of targets) next[item.id]=editSpecification(item,next[item.id],key,value);
      return next;
    });
    setMessage("");
  };
  const changeShared=(key,value)=>change(items,key,value);
  const edited=items.filter(({id})=>patches[id]).map(({id})=>patches[id]);
  async function save(source=patches) {
    const work=items.map(({id})=>source[id]).filter(Boolean);
    setBusy(true);setProblem(null);setMessage("");
    try {
      if (work.length) await request(path+"/specifications",{method:"POST",body:{rows:work}});
      setPatches((previous)=>Object.fromEntries(Object.entries(previous).filter(([id])=>!items.some((item)=>item.id===Number(id)))));
      setMessage(work.length?t("تم حفظ المواصفات والمقاسات.","Specifications and measurements saved."):"");
      reload();
    } catch(error) {setProblem(error);}
    finally {setBusy(false);}
  }
  const limit=12;
  const pageCount=Math.max(1,Math.ceil(items.length/limit));
  const currentPage=Math.min(page,pageCount);
  const editAllowed=can("edit");
  const controls=(keys)=>keys.flatMap((key)=>{
    const matching=displayed.filter((item)=>applies(item,key));
    if (!matching.length) return [];
    const ids=new Set(matching.map(({id})=>id));
    const field=fields.get(key);
    const choices=field.key==="coating_direction"?fieldOptions(field,{glazing:current("glazing").value||
      (system?.tags?.includes("insulated")?"Double":"")}):field.options;
    return [<QuickField key={key} field={{...field,options:choices}} name={label(key)} t={t} locale={uiLanguage}
      current={together(matching,(item)=>item?.technical[key])}
      change={(_,value)=>change(items.filter(({id})=>ids.has(id)),key,value)}/>];
  });
  return <section className="ops-quick-spec pc-stack" aria-label={t("استمارة المواصفات","Specifications form")}>
    <ErrorMessage error={groupList.error||group.error}/>
    {groups.length>1&&<Pick label={t("البند","BOQ item")} value={groupId} items={groups.map(({id,description,count})=>
      [id,`${description.replace(/\s+/g," ").slice(0,130)||t("بند بدون وصف","Untitled item")} · ${count}`])}
      onChange={(value)=>{if (value) {setChosen(Number(value));setPage(1);setProblem(null);setMessage("");}}}/>}
    {data&&<form className="pc-stack" onSubmit={(event)=>{event.preventDefault();if (edited.length&&!busy) save();}}>
      <div className="ops-quick-heading">
        <div><h3>{t("المواصفات المشتركة","Shared specifications")}</h3>
          <p dir="auto">{data.description}</p>
          {items.length>1&&<small>{t(`تعديل المواصفات هنا يطبق على ${items.length} صفوف بنفس الوصف.`,
            `Changes here apply to the ${items.length} rows with this description.`)}</small>}
        </div>
        {editAllowed&&<button type="submit" className="primary" disabled={busy||!edited.length}>{t("حفظ","Save")}</button>}
      </div>
      <SpecificationError error={problem} {...{patches,t,busy}} labels={label} resolve={(keep)=>{
        const next=resolveSpecificationEdits(patches,problem.payload.specification_conflicts,keep);
        setPatches(next);save(next);
      }}/>
      {message&&<p role="status">{message}</p>}
      <fieldset className="ops-paper-fields" disabled={!editAllowed||busy}>
        <legend>{t("القطاع واللون والزجاج","Profile, finish & glass")}</legend>
        <div className="pc-form">
          <Pick label={label("category")} value={current("category").value} onChange={(value)=>changeShared("category",value)}
            placeholder={current("category").mixed?t("قيم مختلفة","Different values"):t("اختر النوع","Select type")}
            items={catalogue.categories.map((item)=>[item.id,item[uiLanguage]])}/>
          <Pick label={label("system")} value={current("system").value} onChange={(value)=>changeShared("system",value)}
            placeholder={current("system").mixed?t("قيم مختلفة","Different values"):t("اختر النظام","Select system")}
            items={(category?.systems||[]).map((item)=>[item.id,item[uiLanguage]])}/>
          {controls(CORE_FIELDS)}
        </div>
      </fieldset>
      {LOCK_FIELDS.some(visible)&&<fieldset className="ops-paper-fields" disabled={!editAllowed||busy}>
        <legend>{t("الضلف والأقفال والسلك","Leaves, locks & screens")}</legend>
        <div className="pc-form">{controls(LOCK_FIELDS)}</div>
      </fieldset>}
      {LOOKUP_FIELDS.some(visible)&&<details className="ops-paper-details">
        <summary>{t("تفاصيل الفتح والزجاج والتسكيك","Opening, glass & interlock details")}</summary>
        <fieldset className="ops-paper-fields" disabled={!editAllowed||busy}><div className="pc-form">{controls(LOOKUP_FIELDS)}</div></fieldset>
      </details>}
      <section className="ops-quick-measurements pc-stack">
        <h3>{t("المقاسات لكل فتحة","Opening measurements")}</h3>
        <Table headers={[t("البند","Item"),...measurementFields.map(([key])=>label(key)),t("الموقع","Location")]}
          rows={displayed.slice((currentPage-1)*limit,currentPage*limit).map((item)=>[item.id,[
            <button type="button" className="pc-name" title={t("عرض تفاصيل الفتحة","Open item details")} onClick={()=>openItem(item.id)}>{item.code}</button>,
            ...measurementFields.map(([key])=><input type={key==="tag"?"text":"number"} aria-label={item.code+" · "+label(key)}
              title={label(key)} disabled={!editAllowed||busy} value={item.technical[key]??""} min={0}
              step={key==="quantity"?1:"any"} dir={key==="tag"?"auto":"ltr"}
              onChange={(event)=>change([items.find(({id})=>id===item.id)],key,event.target.value)}/>),
            <bdi>{[item.technical.building,item.technical.floor,item.technical.room].filter(Boolean).join(" / ")||"—"}</bdi>,
          ]])}/>
        <Page data={{page:currentPage,total:items.length,limit}} onPage={setPage} t={t}/>
      </section>
    </form>}
    {!data&&!groupList.pending&&!group.pending&&!groups.length&&!groupList.error&&<p>{t("لا توجد بنود في هذا الجدول.","This BOQ has no active items.")}</p>}
  </section>;
}
