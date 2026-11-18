import {ErrorMessage} from "./shared.jsx";
import {openingDefaults} from './terminology.js';

export function editSpecification(item,previous,key,next) {
  const patch=previous||{id:item.id,version:item.version,base:{technical:{}},technical:{}};
  if (key==="category"||key==="system") {
    const fields=key==="category"?{category:next,system:""}:{system:next};
    const base={...patch.base};
    for (const name of Object.keys(fields))
      if (!Object.hasOwn(base,name)) base[name]=item[name]??null;
    return {...patch,...fields,base};
  }
  const base={...patch.base,technical:{...patch.base.technical}};
  if (!Object.hasOwn(base.technical,key)) base.technical[key]=item.technical[key]??null;
  return {...patch,base,technical:{...patch.technical,[key]:next}};
}

export function applySpecificationEdits(item,patch) {
  return {...item,category:patch?.category??item.category,system:patch?.system??item.system,
    technical:openingDefaults(patch?.category??item.category,{...item.technical,...patch?.technical})};
}

export function resolveSpecificationEdits(patches,conflicts,keepMine) {
  const result={...patches};
  for (const {id,fields} of conflicts) {
    const previous=result[id];
    if (!previous) continue;
    const patch={...previous,technical:{...previous.technical},base:{...previous.base,technical:{...previous.base.technical}}};
    for (const {key,current,technical} of fields) {
      if (keepMine) (technical?patch.base.technical:patch.base)[key]=current;
      else delete (technical?patch.technical:patch)[key];
    }
    if (!keepMine&&"category" in previous&&fields.some(({technical})=>!technical)) {
      delete patch.category;
      delete patch.system;
    }
    if ("category" in patch||"system" in patch||Object.keys(patch.technical).length) result[id]=patch;
    else delete result[id];
  }
  return result;
}

export function SpecificationError({error,patches,labels,t,busy,resolve}) {
  const changes=error?.payload?.specification_conflicts;
  if (!changes?.length) return <ErrorMessage error={error}/>;
  const format=(value)=>value==null||value===""?"—":typeof value==="boolean"?
    (value?t("نعم","Yes"):t("لا","No")):Array.isArray(value)?value.join(", "):String(value);
  return <div className="ops-conflict pc-stack" role="alert">
    <strong>{t("تغيّرت بعض القيم أثناء التعديل. تعديلاتك ما زالت موجودة.","Some of these values changed while you were editing. Your edits are still here.")}</strong>
    <details><summary>{t("عرض القيم المختلفة","Compare changed values")}</summary>
      <ul>{changes.flatMap(({id,code,fields})=>fields.map(({key,current,technical})=>{
        const yours=(technical?patches[id]?.technical:patches[id])?.[key];
        return <li key={id+":"+key}><bdi>{code}</bdi> · {labels?.(key)||key}
          {" · "}{t("المحفوظ","Saved")} <bdi>{format(current)}</bdi>
          {" · "}{t("تعديلك","Yours")} <bdi>{format(yours)}</bdi></li>;
      }))}</ul>
    </details>
    <div className="pc-toolbar">
      <button type="button" disabled={busy} onClick={()=>resolve(true)}>{t("حفظ تعديلاتي","Save my edits")}</button>
      <button type="button" disabled={busy} onClick={()=>resolve(false)}>{t("استخدام القيم المحفوظة","Use saved values")}</button>
    </div>
  </div>;
}
