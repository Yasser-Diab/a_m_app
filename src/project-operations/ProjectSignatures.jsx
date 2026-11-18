import {useState} from "react";
import {Pick,Suggest,Text,ErrorMessage,useAction} from "./shared.jsx";

export default function ProjectSignatures({ctx,path,request,t,can,reload,people=[],initialKind="manufacturing",fixedKind=false}) {
  const defaults=()=>Object.fromEntries(["manufacturing","loading","maintenance"].map(kind=>[kind,
    ctx.operations.details.report_signatures?.[kind]??people.filter(person=>[kind,"all",...(kind==="maintenance"?[]:["both"])].includes(person.signature_usage))
      .map(person=>({name:person.name,title:person.signature_label||person.position,company:person.company,side:person.side||"company"}))]));
  const [draft,setDraft]=useState(defaults),[kind,setKind]=useState(initialKind),[version,setVersion]=useState(ctx.operations.version),[saved,setSaved]=useState(false);
  const action=useAction(request,result=>{setVersion(result.version);setSaved(true);reload();});
  const update=(index,key,value)=>{setSaved(false);setDraft(current=>({...current,[kind]:current[kind].map((person,i)=>i===index?{...person,[key]:value}:person)}));};
  return <section className="ops-section pc-stack" aria-label={t("توقيعات تقارير المشروع","Project report signatures")}>
    <h3>{t("توقيعات تقارير المشروع","Project report signatures")}</h3>
    <p className="pc-caption">{t("تُحفظ لهذا المشروع وتُستخدم في أوامر التشغيل والتحميل. يمكن إدخال الاسم أو الصفة فقط.","Saved for this project and reused on its work and loading orders. A name or title alone is sufficient.")}</p>
    {!fixedKind&&<Pick label={t("التقرير","Report")} value={kind} required placeholder="" onChange={setKind} items={[
      ["manufacturing",t("أوامر التشغيل / طلب الخامات","Work orders / material requisitions")],["loading",t("أوامر التحميل","Loading orders")],["maintenance",t("أوامر الصيانة","Maintenance orders")]]}/>}
    <fieldset className="pc-stack" disabled={!can("edit")||action.busy}>
      {draft[kind].map((person,index)=><div className="pc-form" key={index}>
        <Suggest label={t("الاسم","Name")+" "+(index+1)} value={person.name} onChange={value=>update(index,"name",value)} items={people.map(person=>[person.id,person.name])}/>
        <Suggest label={t("الصفة / الوظيفة","Title / position")+" "+(index+1)} value={person.title} onChange={value=>update(index,"title",value)}
          items={people.filter(person=>person.position).map(person=>[person.id,person.position])}/>
        <Text label={t("الجهة","Company")+" "+(index+1)} value={person.company} onChange={value=>update(index,"company",value)}/>
        <Pick label={t("الطرف","Side")+" "+(index+1)} value={person.side} onChange={value=>update(index,"side",value)} placeholder=""
          items={[["company",t("الشركة","Company")],["client",t("العميل / الاستشاري","Client / consultant")]]}/>
        <button type="button" onClick={()=>{setSaved(false);setDraft(current=>({...current,[kind]:current[kind].filter((_,i)=>i!==index)}));}}>{t("إزالة التوقيع","Remove signature")}</button>
      </div>)}
      {can("edit")&&<button type="button" onClick={()=>{setSaved(false);setDraft(current=>({...current,[kind]:[...current[kind],{name:"",title:"",company:"",side:"company"}]}));}}>{t("إضافة توقيع","Add signature")}</button>}
    </fieldset><ErrorMessage error={action.error}/>
    <div className="pc-toolbar">{can("edit")&&<button type="button" className="primary" disabled={action.busy}
      onClick={()=>action.run(path+"/signatures","PATCH",{version,kind,signatures:draft[kind]})}>{t("حفظ توقيعات المشروع","Save project signatures")}</button>}
      <button type="button" onClick={()=>{setDraft(defaults());setVersion(ctx.operations.version);setSaved(false);}}>{t("تحميل التوقيعات المحفوظة","Reload saved signatures")}</button>
      {saved&&<span role="status">{t("تم حفظ التوقيعات للمشروع.","Project signatures saved.")}</span>}</div>
  </section>;
}
