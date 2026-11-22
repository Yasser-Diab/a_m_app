import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {X} from 'lucide-react';
import {selectionStatistics} from './table-tools.mjs';
import {findSmartSearchMatchRanges,normalizeSmartSearchText} from './smart-table-clipboard.mjs';
import './table-tools.css';

export function SelectionStatus({values,uiLanguage='ar'}){
  const result=useMemo(()=>selectionStatistics(values),[values]),t=(ar,en)=>uiLanguage==='ar'?ar:en;
  const number=value=>new Intl.NumberFormat('en-US',{minimumFractionDigits:4,maximumFractionDigits:4}).format(Object.is(value,-0)?0:value);
  return <div className="table-selection-status" role="status" aria-label={t('إحصاء التحديد','Selection statistics')}>
    <span>{t('عدد الخلايا','Cells')}: <bdi>{result.count}</bdi></span>{result.numericCount>0&&<>
      <span>{t('الخلايا الرقمية','Numbers')}: <bdi>{result.numericCount}</bdi></span><span>{t('المجموع','Sum')}: <bdi dir="ltr">{number(result.sum)}</bdi></span>
      <span>{t('المتوسط','Average')}: <bdi dir="ltr">{number(result.average)}</bdi></span></>}
  </div>;
}

export function SearchMatchText({value,query,active=false}){
  const text=String(value??''),ranges=findSmartSearchMatchRanges(text,query);
  if(!ranges.length)return text;
  const parts=[];let cursor=0;
  ranges.forEach(({start,end},index)=>{parts.push(text.slice(cursor,start),<mark className={active&&index===0?'current-search-text':undefined} key={start}>{text.slice(start,end)}</mark>);cursor=end;});
  parts.push(text.slice(cursor));return parts;
}

export function TableSearchPanel({initialQuery,results,currentIndex,columnLabel,onSearchChange,onClose,onPrevious,onNext,onJump,onReplace,onReplaceAll,uiLanguage='ar',zIndex=800000,ownerRef}){
  const [query,setQuery]=useState(initialQuery||''),[replacement,setReplacement]=useState(''),[listPage,setListPage]=useState(0);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const panel=useRef(null),input=useRef(null),refocusAfterReplace=useRef(false),searchChange=useRef(onSearchChange),t=(ar,en)=>uiLanguage==='ar'?ar:en;
  const [size]=useState(()=>{try{return JSON.parse(localStorage.getItem('tableFindPanelSizeV1'))||{};}catch{return {};}});
  useEffect(()=>{input.current?.focus({preventScroll:true});input.current?.select();},[]);
  useLayoutEffect(()=>{if(!busy&&refocusAfterReplace.current){refocusAfterReplace.current=false;input.current?.focus({preventScroll:true});}},[busy]);
  useLayoutEffect(()=>{searchChange.current=onSearchChange;},[onSearchChange]);
  useEffect(()=>{const timer=setTimeout(()=>searchChange.current(query),120);return()=>clearTimeout(timer);},[query]);
  useEffect(()=>setListPage(Math.floor(Math.max(0,currentIndex)/100)),[currentIndex]);
  useEffect(()=>{
    let timer;const observer=new ResizeObserver(()=>{clearTimeout(timer);timer=setTimeout(()=>{
      if(panel.current){const {width,height}=panel.current.getBoundingClientRect();localStorage.setItem('tableFindPanelSizeV1',JSON.stringify({width,height}));}
    },150);});observer.observe(panel.current);return()=>{observer.disconnect();clearTimeout(timer);};
  },[]);
  useEffect(()=>{
    const owner=ownerRef?.current;if(!owner)return;
    let frame;const check=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(!owner.isConnected||owner.closest('[hidden]')||!owner.getClientRects().length)onClose();});};
    const observer=new MutationObserver(check);for(let node=owner;node;node=node.parentElement)observer.observe(node,{attributes:true,attributeFilter:['hidden','class','style']});
    return()=>{observer.disconnect();cancelAnimationFrame(frame);};
  },[ownerRef,onClose]);
  const safeIndex=Math.max(0,Math.min(currentIndex,results.length-1));
  const searching=normalizeSmartSearchText(query)!==normalizeSmartSearchText(initialQuery);
  const current=results[safeIndex],ready=Boolean(query.trim()&&results.length&&!busy&&!searching);
  const restore=()=>requestAnimationFrame(()=>input.current?.focus({preventScroll:true}));
  const navigate=callback=>{callback();restore();};
  async function replace(all){
    if(!ready)return;setBusy(true);setError('');
    try{await(all?onReplaceAll?.(query,replacement):onReplace?.(query,replacement,current));}
    catch(cause){setError(cause.message||String(cause));}
    finally{refocusAfterReplace.current=true;setBusy(false);}
  }
  const page=Math.min(listPage,Math.max(0,Math.ceil(results.length/100)-1)),start=page*100;
  return createPortal(<section ref={panel} className="smart-table-search-panel table-find-panel" dir={uiLanguage==='ar'?'rtl':'ltr'}
    style={{zIndex,width:size.width?Math.min(size.width,window.innerWidth-24):undefined,height:size.height?Math.min(size.height,window.innerHeight-24):undefined}}
    role="dialog" aria-busy={busy||searching} aria-label={t('بحث في الجدول','Search Table')} onKeyDown={event=>{if(event.key==='Escape'&&!busy){event.preventDefault();event.stopPropagation();onClose();}}}>
    <div className="smart-search-head"><strong>{t('بحث في الجدول','Search Table')}</strong><button type="button" aria-label={t('إغلاق البحث','Close search')} onClick={onClose}><X size={16}/></button></div>
    <input ref={input} data-smart-search-input="true" aria-label={t('النص أو الرقم المطلوب','Text or number to find')} placeholder={t('اكتب النص أو الرقم المطلوب…','Type the text or number to find…')} value={query} disabled={busy} onChange={event=>{setQuery(event.target.value);setListPage(0);}}
      onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();if(!searching)navigate(event.shiftKey?onPrevious:onNext);}}}/>
    <label className="smart-search-replace-field"><span>{t('استبدال بـ:','Replace with:')}</span><input aria-label={t('النص البديل','Replacement text')} value={replacement} disabled={busy||!onReplace&&!onReplaceAll} onChange={event=>setReplacement(event.target.value)}
      onKeyDown={event=>{if(event.key==='Enter'&&onReplace){event.preventDefault();replace(false);}}}/></label>
    <div className="smart-search-actions"><span aria-live="polite"><bdi>{results.length?safeIndex+1:0} / {results.length}</bdi></span>
      <button type="button" disabled={!results.length||busy||searching} onClick={()=>navigate(onPrevious)}>{t('السابق','Previous')}</button><button type="button" disabled={!results.length||busy||searching} onClick={()=>navigate(onNext)}>{t('التالي','Next')}</button>
      <button type="button" disabled={!ready||!onReplace||current?.replaceable===false} onClick={()=>replace(false)}>{t('استبدال','Replace')}</button>
      <button type="button" className="primary" disabled={!ready||!onReplaceAll||results.every(result=>result.replaceable===false)} onClick={()=>replace(true)}>{t('استبدال الكل','Replace All')}</button></div>
    {error&&<p role="alert" className="pc-problem">{error}</p>}
    <div className="smart-search-results" role="list">{results.slice(start,start+100).map((result,index)=><article key={result.rowId+':'+result.columnKey}
      className={start+index===safeIndex?'current-result':''} role="listitem"><div><strong>{t('الصف','Row')} <bdi>{result.visibleRowNumber}</bdi> · {columnLabel(result.columnKey)}{result.occurrenceCount>1?` · ${result.occurrenceCount} ${t('تطابق','matches')}`:''}</strong>
        <span className="smart-search-result-value" dir="auto"><SearchMatchText value={result.value} query={query} active={start+index===safeIndex}/></span></div><button type="button" disabled={busy||searching} onClick={()=>navigate(()=>onJump(result,start+index))}>{t('انتقال','Go')}</button></article>)}</div>
    {results.length>100&&<div className="smart-search-actions"><button type="button" disabled={!page} onClick={()=>setListPage(page-1)}>{t('النتائج السابقة','Previous results')}</button>
      <bdi>{start+1}–{Math.min(start+100,results.length)}</bdi><button type="button" disabled={start+100>=results.length} onClick={()=>setListPage(page+1)}>{t('نتائج أكثر','More results')}</button></div>}
  </section>,ownerRef?.current?.closest('dialog[open]')||document.body);
}

export function ColumnFilter({column,values,selected,onApply,onClose,t,position,zIndex}){
  const [query,setQuery]=useState(''),[checked,setChecked]=useState(()=>new Set(selected||values.map(value=>value.value)));
  const root=useRef(null),visible=values.filter(value=>String(value.label).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  useEffect(()=>{const close=event=>{if(!root.current?.contains(event.target))onClose();};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);},[onClose]);
  return createPortal(<section ref={root} className="table-column-filter" role="dialog" aria-label={column} style={{...position,zIndex}}
    onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();onClose();}}}>
    <strong>{column}</strong><input autoFocus aria-label={t('بحث في القيم','Search values')} value={query} onChange={event=>setQuery(event.target.value)}/>
    <label><input type="checkbox" checked={visible.every(value=>checked.has(value.value))} onChange={event=>setChecked(previous=>{
      const next=new Set(previous);visible.forEach(value=>event.target.checked?next.add(value.value):next.delete(value.value));return next;
    })}/>{t('تحديد الكل','Select all')}</label><div className="table-filter-values">{visible.map(({value,label})=><label key={value}>
      <input type="checkbox" checked={checked.has(value)} onChange={event=>setChecked(previous=>{const next=new Set(previous);event.target.checked?next.add(value):next.delete(value);return next;})}/><bdi>{label||t('(فارغ)','(Blank)')}</bdi></label>)}</div>
    <div className="pc-toolbar"><button type="button" className="primary" onClick={()=>onApply(checked.size===values.length?null:[...checked])}>{t('تطبيق','Apply')}</button>
      <button type="button" onClick={()=>onApply(null)}>{t('إزالة التصفية','Clear filter')}</button><button type="button" onClick={onClose}>{t('إلغاء','Cancel')}</button></div>
  </section>,document.body);
}
