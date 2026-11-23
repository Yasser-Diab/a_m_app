import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Filter,Maximize2,Minimize2} from 'lucide-react';
import {ColumnFilter,SelectionStatus,TableSearchPanel,SearchMatchText} from '../table-tools.jsx';
import {expandSmartClipboardGrid,parseSmartClipboardGrid,normalizeSmartNumericClipboardValue,findSmartTableMatches,findSmartCtrlArrowDestination} from '../smart-table-clipboard.mjs';
import {tableReplacementCandidates,offsetIndex} from '../table-tools.mjs';

export default function ShipmentGrid({parts,amounts,onChange,onInsert,t,disabled=false}){
  const locale=t('ar','en'),owner=useRef(null),table=useRef(null),scroll=useRef(null),drag=useRef(false),past=useRef([]),future=useRef([]),cut=useRef(null),menuRoot=useRef(null),didFocus=useRef(false);
  const [selection,select]=useState(null),[editing,edit]=useState(null),[full,setFull]=useState(false),[filters,setFilters]=useState({}),[menu,setMenu]=useState(null),[filter,setFilter]=useState(null);
  const [searchOpen,openSearch]=useState(false),[query,setQuery]=useState(''),[matchIndex,setMatch]=useState(0),[message,setMessage]=useState(''),[sort,setSort]=useState(null);
  const [widths,setWidths]=useState(()=>{try{return JSON.parse(localStorage.getItem('shipmentGridWidthsV1'))||{};}catch{return {};}});
  const [viewport,setViewport]=useState({top:0,height:550}),[heightTick,setHeightTick]=useState(0),heights=useRef(new Map());
  const columns=[['description',t('وصف الفتحة','Opening description'),280],['size',t('المقاس مم','Size mm'),135],['component',t('المكون','Component'),160],
    ['unit',t('الوحدة','Unit'),90],['required',t('المطلوب','Required'),100],['loaded',t('المحمّل سابقًا','Previously loaded'),120],['actual',t('تحميل هذه السيارة','On this vehicle'),140]];
  const keys=columns.map(column=>column[0]),labels=Object.fromEntries(columns.map(column=>column.slice(0,2)));
  const base=parts.map(part=>({...part,id:part.part_id,_gridId:part.part_id,actual:amounts[part.part_id]??''}));
  const baseById=new Map(base.map(row=>[row.id,row]));
  const visible=base.filter(row=>Object.entries(filters).every(([key,values])=>values.includes(String(row[key]??''))));
  if(sort)visible.sort((a,b)=>String(a[sort.key]??'').localeCompare(String(b[sort.key]??''),locale,{numeric:true})*sort.direction);
  const records=[],groups=new Map();
  for(const part of visible){const group=part.order_item_id||'general';if(!groups.has(group))groups.set(group,[]);groups.get(group).push(part);}
  for(const [group,children] of groups){records.push({id:'group:'+group,group,order_item_id:children[0].order_item_id,description:children[0].order_item_id?children[0].description:t('بنود عامة للأمر','General order items'),parent:true},...children);}
  const range=selection&&{rowStart:Math.min(selection.start.row,selection.focus.row),rowEnd:Math.max(selection.start.row,selection.focus.row),colStart:Math.min(selection.start.col,selection.focus.col),colEnd:Math.max(selection.start.col,selection.focus.col)};
  const focus=selection?.focus,allowed=row=>!disabled&&!row?.parent&&row?.remaining>0;
  const offsets=useMemo(()=>{const list=[0];for(const row of records)list.push(list.at(-1)+(heights.current.get(row.id)||(row.parent?40:55)));return list;},[parts,amounts,filters,sort,heightTick]);
  const virtual=full&&records.length>200,start=virtual?Math.max(0,offsetIndex(offsets,viewport.top)-8):0,end=virtual?Math.min(records.length,offsetIndex(offsets,viewport.top+viewport.height)+10):records.length;
  useEffect(()=>{localStorage.setItem('shipmentGridWidthsV1',JSON.stringify(widths));},[widths]);
  useEffect(()=>{const stop=()=>drag.current=false;window.addEventListener('pointerup',stop);return()=>window.removeEventListener('pointerup',stop);},[]);
  useEffect(()=>{if(!menu)return;const close=event=>{if(!menuRoot.current?.contains(event.target))setMenu(null);};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);},[menu]);
  useLayoutEffect(()=>{if(!virtual||!table.current)return;let frame;const observer=new ResizeObserver(entries=>{let changed=false;for(const entry of entries){const id=entry.target.dataset.shipRow,value=entry.target.getBoundingClientRect().height;if(Math.abs((heights.current.get(id)||0)-value)>1){heights.current.set(id,value);changed=true;}}if(changed){cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>setHeightTick(x=>x+1));}});table.current.querySelectorAll('[data-ship-row]').forEach(row=>observer.observe(row));return()=>{observer.disconnect();cancelAnimationFrame(frame);};},[virtual,start,end,parts,amounts,filters,sort,widths]);
  function apply(changes,remember=true){
    const next={...amounts};let changed=false;
    for(const [id,raw] of changes){const row=baseById.get(id);if(!allowed(row))continue;const value=raw===''?'':normalizeSmartNumericClipboardValue(raw),n=value===''?0:Number(value);
      if(!Number.isFinite(n)||n<0||n>row.remaining||!row.custom&&!Number.isInteger(n)){setMessage(t('أدخل كمية صحيحة لا تتجاوز المتبقي.','Enter a valid quantity within the remaining balance.'));return false;}
      if(String(next[id]??'')!==String(value)){next[id]=value;changed=true;}}
    if(changed){if(remember){past.current.push(amounts);past.current=past.current.slice(-40);future.current=[];}onChange(next);setMessage('');}return true;
  }
  function navigate(point,extend=false){
    point={row:Math.max(0,Math.min(records.length-1,point.row)),col:Math.max(0,Math.min(keys.length-1,point.col))};select(old=>({start:extend&&old?old.start:point,focus:point}));
    const id=records[point.row]?.id;if(!id)return;
    if(virtual&&scroll.current){const top=offsets[point.row],bottom=offsets[point.row+1],view=scroll.current;if(top<view.scrollTop)view.scrollTop=top;else if(bottom>view.scrollTop+view.clientHeight-40)view.scrollTop=bottom-view.clientHeight+40;setViewport({top:view.scrollTop,height:view.clientHeight});}
    requestAnimationFrame(()=>{const cell=[...(table.current?.querySelectorAll('[data-ship-cell]')||[])].find(cell=>cell.dataset.id===id&&cell.dataset.key===keys[point.col]);cell?.focus({preventScroll:true});cell?.scrollIntoView({block:'nearest',inline:'nearest'});});
  }
  const point=node=>{const cell=node.closest('[data-ship-cell]');return cell?{row:records.findIndex(row=>row.id===cell.dataset.id),col:keys.indexOf(cell.dataset.key)}:null;};
  function clear(){if(range&&range.colEnd>=keys.indexOf('actual')&&window.confirm(t('إلغاء كميات التحميل المحددة لهذه السيارة؟','Clear the selected quantities for this vehicle?')))apply(records.slice(range.rowStart,range.rowEnd+1).map(row=>[row.id,'']));}
  function fill(){if(!range||range.colEnd<keys.indexOf('actual'))return;const source=range.rowStart===range.rowEnd?range.rowStart-1:range.rowStart;if(source<0)return;const first=records[source];if(!first||first.parent)return;apply(records.slice(source+1,range.rowEnd+1).map(row=>[row.id,first.actual??'']));}
  function clipboard(event,paste=false){
    if(editing||!range)return;event.preventDefault();
    if(!paste){const text=records.slice(range.rowStart,range.rowEnd+1).map(row=>keys.slice(range.colStart,range.colEnd+1).map(key=>String(row[key]??'').replace(/[\r\n\t]/g,' ')).join('\t')).join('\n');event.clipboardData.setData('text/plain',text);if(event.type==='cut')cut.current={text,ids:records.slice(range.rowStart,range.rowEnd+1).filter(allowed).map(row=>row.id)};return;}
    const text=event.clipboardData.getData('text/plain'),block=expandSmartClipboardGrid(parseSmartClipboardGrid(text),range),changes=[];
    block.forEach((line,r)=>line.forEach((value,c)=>{const row=records[range.rowStart+r];if(row&&keys[range.colStart+c]==='actual')changes.push([row.id,value]);}));
    if(cut.current?.text===text){const ids=new Set(changes.map(([id])=>id)),visibleIds=new Set(visible.map(row=>row.id));cut.current.ids.filter(id=>!ids.has(id)&&visibleIds.has(id)).forEach(id=>changes.push([id,'']));}
    if(apply(changes))cut.current=null;
  }
  function keyboard(event){
    const command=event.ctrlKey||event.metaKey;
    if(command&&event.code==='KeyF'){event.preventDefault();event.stopPropagation();openSearch(true);return;}
    if(event.target.closest('input,textarea,select')&&!event.target.closest('[data-ship-cell]'))return;
    if(editing)return;
    if(command&&event.code==='KeyD'){event.preventDefault();fill();return;}
    if(command&&(event.code==='KeyZ'||event.code==='KeyY')){event.preventDefault();if(disabled)return;const undo=event.code==='KeyZ'&&!event.shiftKey,source=undo?past:future,target=undo?future:past;if(source.current.length){target.current.push(amounts);onChange(source.current.pop());}return;}
    if(event.key==='Delete'){event.preventDefault();clear();return;}
    if(event.key==='Escape'){if(full){event.preventDefault();event.stopPropagation();setFull(false);}setMenu(null);return;}
    if(!records.length)return;const p=focus||{row:0,col:0},ar=locale==='ar';
    if(command&&event.key.startsWith('Arrow')){event.preventDefault();const next=findSmartCtrlArrowDestination({rows:records.map(row=>({...row,_gridId:row.id})),columnOrder:keys,focusCell:{rowId:records[p.row].id,columnKey:keys[p.col]},direction:ar?event.key:event.key==='ArrowLeft'?'ArrowRight':event.key==='ArrowRight'?'ArrowLeft':event.key});if(next)navigate({row:next.rowIndex,col:next.columnIndex},event.shiftKey);return;}
    const move={ArrowDown:[1,0],ArrowUp:[-1,0],ArrowLeft:[0,ar?1:-1],ArrowRight:[0,ar?-1:1],Enter:[event.shiftKey?-1:1,0],Tab:[0,event.shiftKey?-1:1]};
    if(move[event.key]){event.preventDefault();const [dy,dx]=move[event.key];navigate({row:p.row+dy,col:p.col+dx},event.shiftKey&&event.key!=='Enter'&&event.key!=='Tab');return;}
    if(event.key==='End'||event.key==='Home'){event.preventDefault();navigate({row:command?(event.key==='End'?records.length-1:0):p.row,col:event.key==='End'?keys.length-1:0},event.shiftKey);return;}
    if(!command&&!event.altKey&&allowed(records[p.row])&&keys[p.col]==='actual'&&(event.key==='F2'||/^[\d.,-]$/.test(event.key))){event.preventDefault();edit({id:records[p.row].id,value:event.key==='F2'?String(records[p.row].actual??''):event.key});}
  }
  const matches=findSmartTableMatches({rows:visible,columnOrder:keys,searchText:query}).map(match=>({...match,replaceable:match.columnKey==='actual'&&allowed(baseById.get(match.rowId))})),current=matches[Math.min(matchIndex,Math.max(0,matches.length-1))];
  function jump(match,index){setMatch(index);const row=records.findIndex(row=>row.id===match?.rowId);if(row>=0)navigate({row,col:keys.indexOf(match.columnKey)});}
  function replace(text,replacement,match){const changes=tableReplacementCandidates({rows:visible,columns:keys,query:text,replacement,current:match}).filter(cell=>cell.key==='actual').map(cell=>[cell.row._gridId,cell.value]);apply(changes);}
  function resize(event,key){event.preventDefault();const x=event.clientX,initial=widths[key]||columns.find(col=>col[0]===key)[2],node=event.currentTarget;node.setPointerCapture(event.pointerId);const move=e=>setWidths(old=>({...old,[key]:Math.max(70,Math.min(900,initial+(e.clientX-x)*(locale==='ar'?-1:1)))}));const end=()=>{node.removeEventListener('pointermove',move);node.removeEventListener('pointerup',end);};node.addEventListener('pointermove',move);node.addEventListener('pointerup',end);}
  async function menuAction(action){setMenu(null);if(action==='insert'){onInsert?.(records[focus?.row]?.order_item_id||null);return;}if(action==='clear'){clear();return;}if(action==='fill'){fill();return;}try{if(action==='paste'){const text=cut.current?.text||await navigator.clipboard.readText();clipboard({preventDefault(){},clipboardData:{getData:()=>text}},true);}else{let text='';clipboard({type:action,preventDefault(){},clipboardData:{setData:(_,value)=>text=value}});await navigator.clipboard.writeText(text);}}catch(error){setMessage(error.message);}}
  const selectedValues=range?records.slice(range.rowStart,range.rowEnd+1).flatMap(row=>keys.slice(range.colStart,range.colEnd+1).map(key=>row[key])):[];
  useEffect(()=>{if(!didFocus.current&&parts.length){didFocus.current=true;const row=records.findIndex(allowed);if(row>=0)navigate({row,col:keys.indexOf('actual')});}},[parts.length]);
  useLayoutEffect(()=>{if(scroll.current)setViewport({top:scroll.current.scrollTop,height:scroll.current.clientHeight});},[full]);
  return <div className={'ops-spec-grid pc-stack'+(full?' ops-grid-full':'')} ref={owner} aria-label={t('جدول تأكيد الشحنة','Shipment entry table')} onKeyDown={keyboard}>
    <div className="pc-toolbar ops-grid-tools"><button type="button" onClick={()=>openSearch(true)}>{t('بحث واستبدال','Find and replace')} · Ctrl+F</button>
      {onInsert&&<button type="button" disabled={disabled} onClick={()=>onInsert(records[focus?.row]?.order_item_id||null)}>{t('إضافة جزء للفتحة','Add opening part')}</button>}
      <button type="button" disabled={disabled||!range} onClick={fill}>{t('نسخ للأسفل','Fill down')} · Ctrl+D</button>
      <button type="button" disabled={disabled||!past.current.length} onClick={()=>{future.current.push(amounts);onChange(past.current.pop());}}>{t('تراجع','Undo')}</button>
      <button type="button" disabled={disabled||!future.current.length} onClick={()=>{past.current.push(amounts);onChange(future.current.pop());}}>{t('إعادة','Redo')}</button>
      {!!Object.keys(filters).length&&<button type="button" onClick={()=>{setFilters({});select(null);}}>{t('إزالة جميع الفلاتر','Clear all filters')}</button>}
      <button type="button" onClick={()=>setFull(!full)} aria-label={full?t('إنهاء ملء الشاشة','Exit full screen'):t('ملء الشاشة','Full screen')}>{full?<Minimize2 size={16}/>:<Maximize2 size={16}/>}</button></div>
    {message&&<p role="alert">{message}</p>}
    <div className="pc-table-scroll ops-spec-scroll" ref={scroll} onScroll={event=>setViewport({top:event.currentTarget.scrollTop,height:event.currentTarget.clientHeight})}>
      <table ref={table} className="pc-table ops-grid-table" role="grid" aria-rowcount={records.length+1} style={{width:60+columns.reduce((sum,[key,,width])=>sum+(widths[key]||width),0)}}
        onCopy={event=>clipboard(event)} onCut={event=>clipboard(event)} onPaste={event=>clipboard(event,true)}
        onContextMenu={event=>{if(!editing&&range){event.preventDefault();setMenu({left:Math.min(event.clientX,window.innerWidth-240),top:Math.min(event.clientY,window.innerHeight-260)});}}}
        onPointerDown={event=>{if(event.button||event.target.closest('button,input'))return;const p=point(event.target);if(p){drag.current=true;select(old=>({start:event.shiftKey&&old?old.start:p,focus:p}));}}}
        onPointerOver={event=>{if(drag.current&&event.buttons&1){const p=point(event.target);if(p)select(old=>({start:old?.start||p,focus:p}));}}}>
        <colgroup><col style={{width:60}}/>{columns.map(([key,,width])=><col key={key} style={{width:widths[key]||width}}/>)}</colgroup>
        <thead><tr><th><input type="checkbox" aria-label={t('تحميل كل المكونات المعروضة','Load all visible parts')} checked={visible.some(allowed)&&visible.filter(allowed).every(part=>Number(amounts[part.id])>=part.remaining)} disabled={disabled||!visible.some(allowed)} onChange={event=>apply(visible.filter(allowed).map(part=>[part.id,event.target.checked?part.remaining:'']))}/></th>{columns.map(([key,label])=><th key={key}><div className="ops-column-heading"><button type="button" className="pc-name" onClick={()=>{setSort(sort?.key===key&&sort.direction===-1?null:{key,direction:sort?.key===key?-sort.direction:1});select(null);}}>{label}</button>
          <button type="button" aria-label={t('تصفية ','Filter ')+label} onClick={event=>{const rect=event.currentTarget.getBoundingClientRect();setFilter({key,position:{left:Math.max(8,Math.min(rect.left,window.innerWidth-300)),top:Math.min(rect.bottom,window.innerHeight-360)}});}}><Filter size={13}/></button></div><span role="separator" className="ops-column-resize" aria-label={t('عرض عمود ','Width of ')+label} onPointerDown={event=>resize(event,key)}/></th>)}</tr></thead>
        <tbody>{virtual&&start>0&&<tr aria-hidden="true" className="ops-grid-spacer"><td colSpan={8} style={{height:offsets[start]}}/></tr>}
          {records.slice(start,end).map((row,index)=>{const r=start+index,children=row.parent?visible.filter(part=>(part.order_item_id||'general')===row.group&&part.remaining>0):[row];const checked=children.length>0&&children.every(part=>Number(amounts[part.id])>=part.remaining);
            return <tr key={row.id} data-ship-row={row.id} className={(focus?.row===r?'table-active-row ':'')+(row.parent?'group':'')}><th><input type="checkbox" aria-label={(row.parent?t('تحميل الفتحة ','Load opening '):t('تحميل ','Load '))+row.description+(row.parent?'':' · '+row.component)} ref={node=>{if(node)node.indeterminate=Boolean(row.parent&&!checked&&children.some(part=>Number(amounts[part.id])>0));}} checked={row.parent?checked:Number(amounts[row.id])>0} disabled={disabled||!children.some(part=>part.remaining>0)} onChange={event=>apply(children.map(part=>[part.id,event.target.checked?part.remaining:'']))}/></th>
            {columns.map(([key],c)=>{const selected=range&&r>=range.rowStart&&r<=range.rowEnd&&c>=range.colStart&&c<=range.colEnd;return <td key={key} role="gridcell" data-ship-cell data-id={row.id} data-key={key} aria-selected={Boolean(selected)} aria-readonly={key!=='actual'||!allowed(row)} tabIndex={focus?.row===r&&focus?.col===c||!focus&&r===0&&c===0?0:-1}
              className={(key!=='actual'||!allowed(row)?'ops-grid-readonly ':'')+(current?.rowId===row.id&&current.columnKey===key?'table-search-current':'')}
              onFocus={()=>{if(!selection)select({start:{row:r,col:c},focus:{row:r,col:c}});}} onDoubleClick={()=>{if(key==='actual'&&allowed(row))edit({id:row.id,value:String(row.actual??'')});}}>
              {editing?.id===row.id&&key==='actual'?<input autoFocus inputMode="decimal" aria-label={t('تحميل هذه السيارة','On this vehicle')} value={editing.value} onChange={event=>edit({...editing,value:event.target.value})} onBlur={()=>{apply([[row.id,editing.value]]);edit(null);}} onKeyDown={event=>{if(event.key==='Enter'||event.key==='Tab'){event.preventDefault();event.stopPropagation();if(apply([[row.id,editing.value]])){edit(null);navigate({row:r+1,col:c});}}if(event.key==='Escape'){event.preventDefault();event.stopPropagation();edit(null);}}}/>:
                <bdi className="table-search-text">{key==='size'&&!row.parent&&row.order_item_id?<span className="ops-dimension-pair" dir={locale==='ar'?'rtl':'ltr'}><bdi dir="ltr"><SearchMatchText value={row.width_mm??'—'} query={searchOpen?query:''}/></bdi><span>×</span><bdi dir="ltr"><SearchMatchText value={row.height_mm??'—'} query={searchOpen?query:''}/></bdi></span>:<SearchMatchText value={row[key]??''} query={searchOpen?query:''} active={current?.rowId===row.id&&current.columnKey===key}/>}</bdi>}</td>;})}</tr>;
          })}{virtual&&end<records.length&&<tr aria-hidden="true" className="ops-grid-spacer"><td colSpan={8} style={{height:offsets.at(-1)-offsets[end]}}/></tr>}</tbody>
      </table></div><SelectionStatus values={selectedValues} uiLanguage={locale}/>
    {filter&&<ColumnFilter t={t} portalRoot={owner.current?.closest('dialog[open]')} column={labels[filter.key]} position={filter.position} zIndex={270010} values={[...new Set(base.map(row=>String(row[filter.key]??'')))].map(value=>({value,label:value}))} selected={filters[filter.key]} onClose={()=>setFilter(null)} onApply={values=>{setFilters(old=>{const next={...old};if(values)next[filter.key]=values;else delete next[filter.key];return next;});select(null);edit(null);setFilter(null);}}/>}
    {searchOpen&&<TableSearchPanel initialQuery={query} results={matches} currentIndex={matchIndex} columnLabel={key=>labels[key]} uiLanguage={locale} ownerRef={owner} onSearchChange={value=>{setQuery(value);setMatch(0);}} onClose={()=>openSearch(false)} onJump={jump} onPrevious={()=>{const next=(matchIndex-1+matches.length)%matches.length;if(matches.length)jump(matches[next],next);}} onNext={()=>{const next=(matchIndex+1)%matches.length;if(matches.length)jump(matches[next],next);}} onReplace={replace} onReplaceAll={(text,replacement)=>replace(text,replacement)}/>}
    {menu&&createPortal(<div ref={menuRoot} className="pc-grid-context-menu" role="menu" style={{position:'fixed',...menu,zIndex:270030}}>{[['copy',t('نسخ','Copy')],['cut',t('قص الكميات','Cut quantities')],['paste',t('لصق الخلايا المقصوصة','Paste cut cells')],['fill',t('نسخ للأسفل','Fill down')],...(onInsert?[['insert',t('إضافة جزء للفتحة','Add opening part')]]:[]),['clear',t('إلغاء كميات التحميل المحددة','Clear selected loading')]].map(([action,label])=><button type="button" role="menuitem" key={action} onClick={()=>menuAction(action)}>{label}</button>)}<button type="button" onClick={()=>setMenu(null)}>{t('إلغاء','Cancel')}</button></div>,owner.current?.closest('dialog[open]')||document.body)}
  </div>;
}
