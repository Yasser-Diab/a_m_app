import {useCallback,useEffect,useId,useMemo,useRef,useState} from "react";
import {Field,queryString,useResource} from "../certificates/shared.jsx";
import {TableSearchPanel} from '../table-tools.jsx';
import {tableReplacementCandidates} from '../table-tools.mjs';
import {findSmartTableMatches,normalizeSmartNumericClipboardValue} from '../smart-table-clipboard.mjs';

export function useOperationsApi(api,session) {
  return useMemo(()=>(path,{method="GET",body,signal}={})=>api.request("/api/project-operations"+path,{
    method,signal,headers:{Authorization:`Bearer ${session}`},...(body===undefined?{}:{body:JSON.stringify(body)}),
  }),[api,session]);
}

export function useAction(request,onSaved) {
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState(null);
  const run=useCallback(async(path,method,body)=>{
    setBusy(true);setError(null);
    try {
      const result=await request(path,{method,body});
      onSaved?.(result);
      return result;
    } catch(cause) {setError(cause);}
    finally {setBusy(false);}
  },[request,onSaved]);
  return {run,busy,error};
}

export function ErrorMessage({error}) {
  return error?<p className="pc-problem" role="alert">{error.message || String(error)}</p>:null;
}

export function Text({label,value,onChange,type="text",required=false,placeholder,min,max,step}) {
  return <Field label={label}><input type={type} value={value??""} required={required} placeholder={placeholder}
    dir={type==="text"?"auto":"ltr"} min={min} max={max} step={step} onChange={(event)=>onChange(event.target.value)} /></Field>;
}

export function DimensionPair({values,locale}) {
  return <span className="ops-dimension-pair" dir={locale==='ar'?'rtl':'ltr'}>{values.map((value,index)=><span key={index} className="ops-dimension-part">
    {index>0&&<span>×</span>}<bdi dir="ltr">{value??'—'}</bdi>
  </span>)}</span>;
}

export function Pick({label,value,onChange,items,required=false,placeholder="—",disabled=false}) {
  return <Field label={label}><select value={value??""} required={required} disabled={disabled} onChange={(event)=>onChange(event.target.value)} dir="auto">
    <option value="">{placeholder}</option>{items.map(([key,title])=><option key={key} value={key}>{title}</option>)}
  </select></Field>;
}

export function SystemPick({t,items,...props}){
  const [search,setSearch]=useState('');
  useEffect(()=>setSearch(''),[items[0]?.[0]]);
  const normalized=text=>String(text).normalize('NFKD').replace(/[\u064b-\u065f]/g,'').replace(/[أإآ]/g,'ا').toLocaleLowerCase();
  const filtered=items.filter(([id,title])=>String(id)===String(props.value)||normalized(title).includes(normalized(search)));
  const choiceKey=items.map(([id])=>id).join('|');
  useEffect(()=>setSearch(''),[choiceKey]);
  return <div className="ops-system-pick"><Text label={t('بحث في طرق الفتح','Search operating types')} value={search} onChange={setSearch}/>
    <Pick {...props} items={filtered}/><small>{t(`${filtered.length} طريقة متاحة`,`${filtered.length} operating types available`)}</small></div>;
}

export function Suggest({label,value,onChange,items=[],required=false}) {
  const id=useId();
  return <><Field label={label}><input value={value??""} onChange={(event)=>onChange(event.target.value)} list={id} dir="auto" required={required}/></Field>
    <datalist id={id}>{items.map(([key,text])=><option key={key} value={text}/>)}</datalist></>;
}

export function Page({data,onPage,t}) {
  if (!data || data.total<=data.limit) return null;
  return <div className="pc-pagination">
    <button type="button" disabled={data.page===1} onClick={()=>onPage(data.page-1)}>{t("السابق","Previous")}</button>
    <span dir="ltr">{(data.page-1)*data.limit+1}–{Math.min(data.total,data.page*data.limit)} / {data.total}</span>
    <button type="button" disabled={data.page*data.limit>=data.total} onClick={()=>onPage(data.page+1)}>{t("التالي","Next")}</button>
  </div>;
}

export function Table({headers,rows,empty,cellClassName}) {
  if (!rows.length) return <p className="pc-empty">{empty}</p>;
  return <div className="pc-table-scroll"><table className="pc-table">
    <thead><tr>{headers.map((title,index)=><th key={index} scope="col">{title}</th>)}</tr></thead>
    <tbody>{rows.map(([key,cells])=><tr key={key} data-table-row={key}>{cells.map((cell,index)=><td key={index} data-table-column={index} className={cellClassName?.(key,index)}>{cell}</td>)}</tr>)}</tbody>
  </table></div>;
}

// Native-input entry tables use the same find/replace panel as the worksheets.
export function SearchableTable({records,columns,onChanges,t,...table}) {
  const owner=useRef(null),[open,setOpen]=useState(false),[query,setQuery]=useState(''),[index,setIndex]=useState(0),[message,setMessage]=useState('');
  const keys=columns.map(column=>column.key),labels=Object.fromEntries(columns.map(column=>[column.key,column.label]));
  const matches=findSmartTableMatches({rows:records,columnOrder:keys,searchText:query}).map(match=>({...match,
    replaceable:Boolean(onChanges&&columns.find(column=>column.key===match.columnKey)?.editable)}));
  const safeIndex=Math.min(index,Math.max(0,matches.length-1)),current=matches[safeIndex];
  const hits=new Set(open?matches.map(match=>match.rowId+':'+match.columnKey):[]);
  function jump(match,nextIndex) {
    setIndex(nextIndex);if(!match)return;
    requestAnimationFrame(()=>{const row=[...owner.current.querySelectorAll('[data-table-row]')].find(node=>node.dataset.tableRow===String(match.rowId));
      const cell=row?.querySelector(`[data-table-column="${keys.indexOf(match.columnKey)}"]`),input=cell?.querySelector('input,textarea,select');
      (input||cell)?.scrollIntoView({block:'nearest',inline:'nearest'});input?.focus({preventScroll:true});});
  }
  function replace(text,replacement,match=null) {
    const changes=[];let count=0,skipped=0;
    for(const candidate of tableReplacementCandidates({rows:records,columns:keys,query:text,replacement,current:match})) {
      const column=columns.find(column=>column.key===candidate.key);if(!column.editable)continue;
      let value=candidate.value;
      if(column.type==='number'&&value.trim()!=='') {
        value=normalizeSmartNumericClipboardValue(value);const number=Number(value),maximum=typeof column.max==='function'?column.max(candidate.row):column.max;
        if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)||!Number.isFinite(number)||column.integer&&!Number.isInteger(number)||column.min!=null&&number<column.min||maximum!=null&&number>maximum){skipped++;continue;}
      }
      if(String(candidate.row[candidate.key]??'')===value)continue;
      changes.push({rowId:candidate.row._gridId,key:candidate.key,value});count+=candidate.replacements;
    }
    if(changes.length)onChanges(changes);
    setMessage(t(`تم استبدال ${count} تطابق.`,`${count} matches replaced.`)+(skipped?t(` تم تجاوز ${skipped} قيمة غير صالحة.`,` ${skipped} invalid values skipped.`):''));
  }
  return <div ref={owner} onKeyDown={event=>{if((event.ctrlKey||event.metaKey)&&event.code==='KeyF'){event.preventDefault();event.stopPropagation();setOpen(true);}}}>
    <div className="pc-toolbar"><button type="button" onClick={()=>setOpen(true)}>{t('بحث واستبدال','Find and replace')} · Ctrl+F</button></div>
    <Table {...table} cellClassName={(id,column)=>open&&current?.rowId===String(id)&&current.columnKey===keys[column]?'table-search-current':hits.has(String(id)+':'+keys[column])?'table-search-hit':undefined}/>
    {message&&<small role="status">{message}</small>}
    {open&&<TableSearchPanel initialQuery={query} results={matches} currentIndex={safeIndex} columnLabel={key=>labels[key]} uiLanguage={t('ar','en')} ownerRef={owner}
      onSearchChange={value=>{setQuery(value);setIndex(0);}} onClose={()=>setOpen(false)} onJump={jump}
      onPrevious={()=>{const next=(safeIndex-1+matches.length)%matches.length;if(matches.length)jump(matches[next],next);}}
      onNext={()=>{const next=(safeIndex+1)%matches.length;if(matches.length)jump(matches[next],next);}}
      onReplace={onChanges?replace:undefined} onReplaceAll={onChanges?(text,replacement)=>replace(text,replacement):undefined}/>}
  </div>;
}

export const panelNames = {frames:["حلوق","Frames"],screens:["ضلف سلك","Flyscreen leaves"],sliding:["ضلف جرار","Sliding leaves"],hinged:["ضلف مفصلي","Hinged leaves"],
  sliding_blades:["سكينة جرار","Sliding blades"],
  fixed:["ثوابت","Fixed panels"],other:["ضلف أخرى","Other leaves"],items:["وحدات","Items"]};
export const stages={survey:["رفع المقاسات","Measurement survey"],receipt:["استلام الخامات","Material receipt"],
  cutting:["قص وتجهيز","Cutting and preparation"],assembly:["تجميع","Assembly"],glazing:["تركيب الزجاج","Glass installation"],
  pre_shipment:["قبل الشحن","Pre-shipment"],installation:["بعد التركيب","Post-installation"],handover:["استلام نهائي","Final handover"]};
export const results={passed:["اجتاز","Passed"],failed:["لم يجتز","Failed"],hold:["معلق","On hold"],reinspect:["إعادة فحص","Reinspection required"]};
export const states={draft:["مسودة","Draft"],pending:["بانتظار الاعتماد","Pending"],approved:["معتمد","Approved"],
  rejected:["مرفوض","Rejected"],returned:["أعيد للتعديل","Returned for revision"],released:["تم الإفراج","Released"],
  shipped:["تم الشحن","Shipped"],closed:["مغلق","Closed"],na:["غير منطبق","Not applicable"]};
export const assignmentRoles={loading:["مسؤول التحميل","Loading lead"],engineer:["مهندس المشروع","Project engineer"],
  reviewer:["مسؤول الاستلام","Receiving representative"],approver:["مسؤول الاعتماد","Approver"]};
export const options=(messages,t)=>Object.entries(messages).map(([key,labels])=>[key,t(...labels)]);
export const display=(messages,key,t)=>messages[key]?t(...messages[key]):key || "—";
export const quantity=(value)=>value==null?"—":new Intl.NumberFormat("en-US",{maximumFractionDigits:4}).format(value);

export function usePaged(request,path,query,revision) {
  const [page,setPage]=useState(1);
  const state=useResource(request,path?`${path}${queryString({...query,page})}`:null,revision);
  return {...state,setPage};
}
