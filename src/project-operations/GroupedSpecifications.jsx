import {useEffect,useId,useMemo,useRef,useState} from "react";
import {Field,queryString,useResource} from "../certificates/shared.jsx";
import {ErrorMessage,Page,Pick,SystemPick,Table} from "./shared.jsx";
import {SpecificationError,applySpecificationEdits,editSpecification,resolveSpecificationEdits} from "./specification-edits.jsx";
import {technicalText,fieldOptions,coatingValue,configurationTags,perimeterText,hasTrim,partMeasurementAvailable,commonAvailable} from "./terminology.js";
import {SelectionStatus,TableSearchPanel} from '../table-tools.jsx';
import {tableReplacementCandidates} from '../table-tools.mjs';
import {findSmartTableMatches,normalizeSmartNumericClipboardValue,normalizeSmartSearchText} from '../smart-table-clipboard.mjs';

const measurementFields=[
  ["tag","رقم الفتحة","Opening tag"],["quantity","العدد","Count"],
  ["width_mm","العرض (مم)","Width (mm)"],["height_mm","الارتفاع (مم)","Height (mm)"],
];
const labels={
  opening_description:["وصف الفتحة","Opening description"],
  category:["نوع العمل","Work type"],system:["طريقة الفتح / النظام","Opening / system"],
  profile:["نوع القطاع","Profile"],color:["اللون","Colour"],finish:["نوع التشطيب","Finish"],
  infill:["تكوين الزجاج / الحشو","Glass composition / infill"],glass_thickness:["سمك الزجاج (مم)","Glass thickness (mm)"],
  coating_direction:["اتجاه العاكس","Coating direction"],georgian:["جورجيا","Georgian bars"],
  interlock_right:["التسكيك يمين","Right interlock"],interlock_left:["التسكيك شمال","Left interlock"],
  rubber_bar:["جلدة التثبيت","Rubber glazing gasket"],perimeter:["البرور","Perimeter trims"],
};
const sides={right:["يمين","Right"],left:["شمال","Left"],top:["علوي","Top"],bottom:["سفلي","Bottom"]};
const LOOKUP_FIELDS=["fixed_panels","fixed_position","tilt_fixed","top_fixed_height","bottom_fixed_height",
  "perimeter","trim_type","trim_size_cm","rubber_bar",
  "interlock_right_mm","interlock_left_mm","reflective","georgian","georgian_configuration",
  "layers","outside_glass","outside_thickness","spacer_thickness","cavity","inside_glass","inside_thickness","interlayer"];
const CORE_FIELDS=["profile","color","finish","glass_type","infill","glass_thickness","glass_color","glazing","coating_direction"];
const LOCK_FIELDS=["leaves","hinge_side","opening_direction","frames_per_opening","lock_right","lock_left","central_lock_handle","screen","screen_type","screen_leaves","hinge","lock","handle","roller"];
const VENT_FIELDS=["vent_opening","vent_position","vent_size","vent_width","vent_height","vent_direction"];

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
  const [measurementCell,setMeasurementCell]=useState(null);
  const [searchOpen,setSearchOpen]=useState(false),[search,setSearch]=useState(''),[searchIndex,setSearchIndex]=useState(0);
  const measurements=useRef(null);
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
  const fields=useMemo(()=>new Map([...catalogue.common.filter(field=>commonAvailable(category,field.key)),...(category?.fields||[]),...(system?.fields||[]),
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
    return partMeasurementAvailable(field,activeTags,item.technical)&&hasTrim(key,item.technical)&&(!field.populatedOnly||item.technical[key]!=null&&item.technical[key]!=="")&&(!tags||tags.split(" ").some((tag)=>activeTags.has(tag)))&&
      (!depends||Boolean(dependency)&&!["لا","بدون","لا ينطبق","no","none","n/a"].includes(String(dependency).toLowerCase()))&&
      (!field.minLeaves||Number(item.technical.leaves)>=field.minLeaves);
  };
  const visible=(key)=>displayed.some((item)=>applies(item,key));
  const partFields=['panel_measurement_basis','fixed_width_mm','fixed_height_mm','leaf_width_mm','leaf_height_mm'];
  const measuredFields=[...measurementFields,...partFields.filter(key=>displayed.some(item=>{
    const field=fields.get(key),specific=catalogue.categories.find(cat=>cat.id===item.category)?.systems.find(entry=>entry.id===item.system);
    return field&&partMeasurementAvailable(field,configurationTags(specific,item.technical),item.technical);
  })).map(key=>[key,label(key)])];
  const change=(targets,key,value,shared=false)=>{
    setPatches((previous)=>{
      const next={...previous};
      for (const item of targets) {
        if(shared&&item.specification_overrides?.includes(key))continue;
        next[item.id]=editSpecification(item,next[item.id],key,value,shared);
      }
      return next;
    });
    setMessage("");
  };
  const changeShared=(key,value)=>change(items,key,value,true);
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
  const searchKeys=['opening_description',...measuredFields.map(([key])=>key)];
  const searchValue=(item,key)=>key==='opening_description'?(item.opening_description||item.commercial.description):technicalText(item.technical[key]??'',uiLanguage);
  const searchResults=findSmartTableMatches({rows:displayed.map(item=>({_gridId:String(item.id),...Object.fromEntries(searchKeys.map(key=>[key,searchValue(item,key)]))})),columnOrder:searchKeys,searchText:search})
    .map(match=>({...match,replaceable:editAllowed&&!busy&&(!partFields.includes(match.columnKey)||applies(displayed[match.rowIndex],match.columnKey))}));
  const searchState=(item,key)=>searchOpen&&searchResults.some(match=>match.rowId===String(item.id)&&match.columnKey===key);
  const jumpSearch=(match,index)=>{
    if(!match)return;setSearchIndex(index);setPage(Math.floor(match.rowIndex/limit)+1);
    requestAnimationFrame(()=>{const target=measurements.current?.querySelector(`[data-opening-id="${match.rowId}"][data-field="${match.columnKey}"]`);(target?.matches('input,textarea,select')?target:target?.querySelector('input,select,textarea'))?.focus({preventScroll:true});target?.scrollIntoView({block:'nearest',inline:'nearest'});});
  };
  function replaceSearch(query,replacement,currentMatch=null){
    if(!editAllowed||busy)return;
    const candidates=tableReplacementCandidates({rows:displayed,columns:searchKeys,query,replacement,current:currentMatch,valueFor:searchValue,idFor:item=>item.id});
    let count=0,skipped=0;const next={...patches};
    for(const {row,key,value} of candidates){
      if(partFields.includes(key)&&!applies(row,key)){skipped++;continue;}
      let entered=value;
      if(key==='panel_measurement_basis'){
        entered=value===''?'':['Fixed panel','Operable leaf'].find(option=>[option,technicalText(option,uiLanguage)].some(label=>normalizeSmartSearchText(label)===normalizeSmartSearchText(value)));
        if(entered==null){skipped++;continue;}
      }else if(!['opening_description','tag'].includes(key)){
        entered=normalizeSmartNumericClipboardValue(value);
        if(entered!==''&&(!/^\d+(?:\.\d*)?$/.test(entered)||!Number.isFinite(Number(entered))||key==='quantity'&&!Number.isInteger(Number(entered)))){skipped++;continue;}
      }
      if(String(key==='opening_description'?row.opening_description??'':row.technical[key]??'')===String(entered))continue;
      next[row.id]=editSpecification(items.find(item=>item.id===row.id),next[row.id],key,entered);count++;
    }
    if(count)setPatches(next);
    setMessage(t(`تم الاستبدال في ${count} خلية${skipped?`؛ تعذر استبدال ${skipped}`:''}.`,`Replaced ${count} cells${skipped?`; skipped ${skipped} invalid cells`:''}.`));
  }
  const controls=(keys)=>keys.flatMap((key)=>{
    const matching=displayed.filter((item)=>applies(item,key));
    if (!matching.length) return [];
    const ids=new Set(matching.map(({id})=>id));
    const field=fields.get(key);
    const choices=fieldOptions(field,{leaves:current('leaves').value,glazing:current("glazing").value||
      (system?.tags?.includes("insulated")?"Double":"")});
    return [<QuickField key={key} field={{...field,options:choices}} name={label(key)} t={t} locale={uiLanguage}
      current={together(matching,(item)=>item?.technical[key])}
      change={(_,value)=>change(items.filter(({id})=>ids.has(id)),key,value,true)}/>];
  });
  return <section className="ops-quick-spec pc-stack" aria-label={t("استمارة المواصفات","Specifications form")}>
    <ErrorMessage error={groupList.error||group.error}/>
    {groups.length>1&&<Pick label={t("مجموعة الفتحات","Opening group")} value={groupId} items={groups.map(({id,description,category,system,count})=>
      [id,`${catalogue.categories.find(cat=>cat.id===category)?.systems.find(entry=>entry.id===system)?.[uiLanguage]||description.replace(/\s+/g," ").slice(0,130)||t("بند بدون وصف","Untitled item")} · ${count}`])}
      onChange={(value)=>{if (value) {setChosen(Number(value));setPage(1);setProblem(null);setMessage("");}}}/>}
    {data&&<form className="pc-stack" onSubmit={(event)=>{event.preventDefault();if (edited.length&&!busy) save();}}>
      <div className="ops-quick-heading">
        <div><h3>{t("المواصفات المشتركة","Shared specifications")}</h3>
          <p dir="auto">{system?.[uiLanguage]||data.description}</p>
          {items.length>1&&<small>{t(`المواصفات مشتركة بين ${items.length} فتحات من نفس النوع وطريقة الفتح. تعديلات الفتحة المنفردة محفوظة.`,
            `Specifications are shared by ${items.length} openings of this type and operating system. Individual exceptions are preserved.`)}</small>}
        </div>
        {editAllowed&&<button type="submit" className="primary" disabled={busy||!edited.length}>{t("حفظ","Save")}</button>}
      </div>
      <SpecificationError error={problem} {...{patches,t,busy}} labels={label} resolve={(keep)=>{
        const next=resolveSpecificationEdits(patches,problem.payload.specification_conflicts,keep);
        setPatches(next);save(next);
      }}/>
      {message&&<p role="status">{message}</p>}
      <fieldset className="ops-paper-fields" disabled={!editAllowed||busy}>
        <legend>{category?.id==='maintenance'?t("نوع الصيانة ومكان التنفيذ","Maintenance service and location"):t("القطاع واللون والزجاج","Profile, finish & glass")}</legend>
        <div className="pc-form">
          <Pick label={label("category")} value={current("category").value} onChange={(value)=>changeShared("category",value)}
            placeholder={current("category").mixed?t("قيم مختلفة","Different values"):t("اختر النوع","Select type")}
            items={catalogue.categories.map((item)=>[item.id,item[uiLanguage]])}/>
          <SystemPick label={label("system")} t={t} value={current("system").value} onChange={(value)=>changeShared("system",value)}
            placeholder={current("system").mixed?t("قيم مختلفة","Different values"):t("اختر النظام","Select system")}
            items={(category?.systems||[]).map((item)=>[item.id,item[uiLanguage]])}/>
          {controls(category?.id==='maintenance'?['maintenance_mode','service_component','replacement_spec','service_findings','screen_material','glass_type','infill','glass_thickness']:CORE_FIELDS)}
        </div>
      </fieldset>
      {LOCK_FIELDS.some(visible)&&<fieldset className="ops-paper-fields" disabled={!editAllowed||busy}>
        <legend>{t("الضلف والأقفال والسلك","Leaves, locks & screens")}</legend>
        <div className="pc-form">{controls(LOCK_FIELDS)}</div>
      </fieldset>}
      {VENT_FIELDS.some(visible)&&<fieldset className="ops-paper-fields" disabled={!editAllowed||busy}>
        <legend>{t("الشفاط","Vent")}</legend><div className="pc-form">{controls(VENT_FIELDS)}</div>
      </fieldset>}
      {LOOKUP_FIELDS.some(visible)&&<details className="ops-paper-details">
        <summary>{t("تفاصيل الفتح والزجاج والتسكيك","Opening, glass & interlock details")}</summary>
        <fieldset className="ops-paper-fields" disabled={!editAllowed||busy}><div className="pc-form">{controls(LOOKUP_FIELDS)}</div></fieldset>
      </details>}
      <section ref={measurements} className="ops-quick-measurements pc-stack" onKeyDown={event=>{if((event.ctrlKey||event.metaKey)&&event.code==='KeyF'){event.preventDefault();event.stopPropagation();setSearchOpen(true);}}}>
        <div className="pc-toolbar"><h3>{t("المقاسات لكل فتحة","Opening measurements")}</h3><button type="button" onClick={()=>setSearchOpen(true)}>{t('بحث واستبدال','Find and replace')} <kbd>Ctrl+F</kbd></button></div>
        <Table headers={[t("وصف الفتحة","Opening description"),...measuredFields.map(([key])=>label(key)),t("الموقع","Location")]}
          rows={displayed.slice((currentPage-1)*limit,currentPage*limit).map((item)=>[item.id,[
            <div className="ops-opening-description"><textarea data-opening-id={item.id} data-field="opening_description" data-search-hit={searchState(item,'opening_description')} aria-label={t("وصف الفتحة","Opening description")} dir="auto" rows={2}
              disabled={!editAllowed||busy} value={item.opening_description||item.commercial.description}
              onChange={event=>change([items.find(row=>row.id===item.id)],'opening_description',event.target.value)}/>
              <button type="button" className="pc-name" onClick={()=>openItem(item.id)}>{t("التفاصيل","Details")}{item.specification_overrides?.length?t(" · مواصفات خاصة"," · Exceptions"):''}</button></div>,
            ...measuredFields.map(([key])=>key==='panel_measurement_basis'?<div data-opening-id={item.id} data-field={key} data-search-hit={searchState(item,key)}><Pick disabled={!editAllowed||busy||!applies(item,key)} label={item.description+' · '+label(key)} value={item.technical[key]} items={['Fixed panel','Operable leaf'].map(value=>[value,technicalText(value,uiLanguage)])} onChange={value=>change([items.find(row=>row.id===item.id)],key,value)}/></div>:
              <input data-opening-id={item.id} data-field={key} data-search-hit={searchState(item,key)} type={key==="tag"?"text":"number"} aria-label={item.description+" · "+label(key)}
              title={label(key)} disabled={!editAllowed||busy||partFields.includes(key)&&!applies(item,key)} value={item.technical[key]??""} min={0}
              step={key==="quantity"?1:"any"} dir={key==="tag"?"auto":"ltr"}
              onFocus={()=>setMeasurementCell({id:item.id,key})}
              onChange={(event)=>change([items.find(({id})=>id===item.id)],key,event.target.value)}/>),
            <bdi>{[item.technical.building,item.technical.floor,item.technical.room].filter(Boolean).join(" / ")||"—"}</bdi>,
          ]])}/>
        <Page data={{page:currentPage,total:items.length,limit}} onPage={setPage} t={t}/>
        <SelectionStatus uiLanguage={uiLanguage} values={measurementCell?[displayed.find(item=>item.id===measurementCell.id)?.technical[measurementCell.key]]:[]}/>
        {searchOpen&&<TableSearchPanel ownerRef={measurements} uiLanguage={uiLanguage} initialQuery={search} results={searchResults} currentIndex={searchIndex} columnLabel={label} onSearchChange={setSearch} onClose={()=>setSearchOpen(false)}
          onJump={jumpSearch} onPrevious={()=>{const index=(searchIndex-1+searchResults.length)%searchResults.length;jumpSearch(searchResults[index],index);}} onNext={()=>{const index=(searchIndex+1)%searchResults.length;jumpSearch(searchResults[index],index);}}
          onReplace={editAllowed?replaceSearch:undefined} onReplaceAll={editAllowed?(query,replacement)=>replaceSearch(query,replacement):undefined}/>}
      </section>
    </form>}
    {!data&&!groupList.pending&&!group.pending&&!groups.length&&!groupList.error&&<p>{t("لا توجد بنود في هذا الجدول.","This BOQ has no active items.")}</p>}
  </section>;
}
