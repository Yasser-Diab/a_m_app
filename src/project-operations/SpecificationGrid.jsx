import {useCallback,useEffect,useId,useLayoutEffect,useMemo,useRef,useState} from "react";
import {createPortal} from "react-dom";
import ApprovalReview from './ApprovalReview.jsx';
import {Copy,Filter,Maximize2,Minimize2,Save,Search} from "lucide-react";
import {
  expandSmartClipboardGrid,fillSmartSelectionDownRows,isSmartFillDownShortcut,
  normalizeSmartNumericClipboardValue,parseSmartClipboardGrid,findSmartTableMatches,findSmartCtrlArrowDestination,
} from "../smart-table-clipboard.mjs";
import {SpecificationError,applySpecificationEdits,editSpecification,resolveSpecificationEdits} from "./specification-edits.jsx";
import {technicalText,fieldOptions,configurationTags,perimeterText,hasTrim,partMeasurementAvailable,commonAvailable} from "./terminology.js";
import {ColumnFilter,SelectionStatus,TableSearchPanel,SearchMatchText} from '../table-tools.jsx';
import {tableReplacementCandidates,offsetIndex} from '../table-tools.mjs';

import {storageLengthUnit,convertLength,lengthLabel} from './length-units.mjs';
const mainKeys=["opening_description","tag","category","system","quantity","width_mm","height_mm","profile","color","infill","trim_type","trim_size_cm"];
const special={
  opening_description:{ar:"وصف الفتحة",en:"Opening description"},
  category:{ar:"نوع البند",en:"Work type"},
  system:{ar:"النظام / القطاع",en:"System"},
  rubber_bar:{ar:"جلدة التثبيت",en:"Rubber glazing gasket",type:"boolean"},
};
const sides={right:["يمين","Right"],left:["يسار","Left"],top:["أعلى","Top"],bottom:["أسفل","Bottom"]};
const missing=(value)=>value==null||value==="";
const enabled=(value)=>Boolean(value&&!["لا","بدون","لا ينطبق","none","no","n/a"].includes(String(value).toLowerCase()));

export function fieldAvailable(catalogue,row,key) {
  const category=catalogue.categories.find(({id})=>id===row.category);
  if(!commonAvailable(category,key))return false;
  if(['trim_type','trim_size_cm'].includes(key)&&row.category==='maintenance')return false;
  if (mainKeys.includes(key)&&!(row.category==='maintenance'&&catalogue.conditional.maintenance?.[key])) return true;
  const system=category?.systems.find(({id})=>id===row.system);
  if (key==="rubber_bar") return ["windows","doors"].includes(row.category);
  const part=category?.fields.find((field)=>field.key===key)||system?.fields.find((field)=>field.key===key);
  if (!part) return catalogue.common.some((field)=>field.key===key);
  const tags=catalogue.conditional[row.category]?.[key];
  const activeTags=configurationTags(system,row.technical);
  const depends=catalogue.dependencies[row.category]?.[key];
  return partMeasurementAvailable(part,activeTags,row.technical)&&hasTrim(key,row.technical)&&(!part.populatedOnly||row.technical[key]!=null&&row.technical[key]!=="")&&(!tags||tags.split(" ").some((tag)=>activeTags.has(tag)))
    && (!depends||enabled(row.technical[depends])) && (!part.minLeaves||Number(row.technical.leaves)>=part.minLeaves);
}

function optionPairs(row,key,field,catalogue,locale,t) {
  if (key==="category") return catalogue.categories.map((choice)=>[choice.id,choice[locale]]);
  if (key==="system") return (catalogue.categories.find(({id})=>id===row.category)?.systems||[])
    .map((choice)=>[choice.id,choice[locale]]);
  if (field.type==="boolean") return [[true,t("نعم","Yes")],[false,t("لا","No")]];
  const system=catalogue.categories.find(({id})=>id===row.category)?.systems.find(({id})=>id===row.system);
  return fieldOptions(field,{...row.technical,glazing:row.technical.glazing||(system?.tags?.includes("insulated")?"Double":"")})
    .map((value)=>[value,technicalText(value,locale)]);
}

export default function SpecificationGrid({items,catalogue,uiLanguage:locale,t,can,request,path,reload,openItem,pageKey,pagination,fullscreen=false,onFullscreenChange,loading=false,loadError,ctx}) {
  const [patches,setPatches]=useState({});
  const [lengthUnits,setLengthUnits]=useState(()=>{try{return JSON.parse(localStorage.getItem('operationsLengthUnitsV1'))||{};}catch{return {};}});
  useEffect(()=>{localStorage.setItem('operationsLengthUnitsV1',JSON.stringify(lengthUnits));},[lengthUnits]);
  const [selected,setSelected]=useState(null);
  const [editing,setEditing]=useState(null);
  const [additional,setAdditional]=useState([]);
  const [columnQuery,setColumnQuery]=useState("");
  const [wholeTable,setWholeTable]=useState(false),[filters,setFilters]=useState({}),[columnMenu,setColumnMenu]=useState(null);
  const [columnTypeKey,setColumnTypeKey]=useState(null);
  const [searchOpen,setSearchOpen]=useState(false),[searchText,setSearchText]=useState(''),[searchIndex,setSearchIndex]=useState(0);
  const [sort,setSort]=useState(null),[contextMenu,setContextMenu]=useState(null);
  const [widths,setWidths]=useState(()=>{try{return JSON.parse(localStorage.getItem('operationsGridWidthsV1'))||{};}catch{return {};}});
  const fieldList=useId(),cut=useRef(null),lengthClipboard=useRef(null),previousLayout=useRef(null),contextRoot=useRef(null);
  const [viewport,setViewport]=useState({top:0,height:600}),[heightTick,setHeightTick]=useState(0);
  const scroll=useRef(null),heights=useRef(new Map()),pendingFocus=useRef(null),fullAnchor=useRef(null);
  const [remember,setRemember]=useState(true);
  const [message,setMessage]=useState("");
  const [problem,setProblem]=useState(null);
  const [affectedOrders,setAffectedOrders]=useState([]),[approvalOrder,setApprovalOrder]=useState(null);
  const [busy,setBusy]=useState(false);
  const history=useRef([]);
  const redo=useRef([]);
  const grid=useRef(null);
  const dragging=useRef(false);
  const editAllowed=can("edit");
  const allRecords=useMemo(()=>items.map(item=>patches[item.id]?applySpecificationEdits(item,patches[item.id]):item),[items,patches]);
  const value=(row,key)=>key==='opening_description'?(row.opening_description||row.commercial.description):key==="category"||key==="system"?row[key]:row.technical[key];
  const filterValue=(row,key)=>String(value(row,key)??'');
  const records=useMemo(()=>{const list=allRecords.filter(row=>Object.entries(filters).every(([key,values])=>values.includes(filterValue(row,key))));if(sort)list.sort((a,b)=>filterValue(a,sort.key).localeCompare(filterValue(b,sort.key),locale,{numeric:true})*sort.direction);return list;},[allRecords,filters,sort,locale]);
  const virtual=fullscreen&&records.length>200;
  const offsets=useMemo(()=>{const result=[0];for(const row of records)result.push(result.at(-1)+(heights.current.get(row.id)||64));return result;},[items,filters,sort,patches,heightTick]);
  const virtualStart=virtual?Math.max(0,offsetIndex(offsets,viewport.top)-8):0;
  const virtualEnd=virtual?Math.min(records.length,offsetIndex(offsets,viewport.top+viewport.height)+10):records.length;
  const definitions=useMemo(()=>new Map([
    ...catalogue.common.map((field)=>[field.key,field]),
    ...catalogue.categories.flatMap((category)=>[...category.fields,...category.systems.flatMap((system)=>system.fields)]
      .map((field)=>[field.key,field])),
    ...Object.entries(special),
  ]),[catalogue]);
  const selectedTypeKey=selected?JSON.stringify([...new Set(records.slice(Math.min(selected.start.row,selected.focus.row),Math.max(selected.start.row,selected.focus.row)+1).map(row=>row.category+':'+row.system))].sort()):null;
  // Let the double-click finish before moving columns, and keep the editor's cell stable.
  useEffect(()=>{if(editing)return;const timer=setTimeout(()=>setColumnTypeKey(selectedTypeKey),550);return()=>clearTimeout(timer);},[selectedTypeKey,Boolean(editing)]);
  const driverRows=useMemo(()=>{const types=columnTypeKey?new Set(JSON.parse(columnTypeKey)):null;return types?records.filter(row=>types.has(row.category+':'+row.system)):records;},[records,columnTypeKey]);
  const essentials=new Set(['maintenance_mode','service_component','replacement_spec','service_findings','leaves','fixed_panels','screen','glazing','glass_type','hinge_side','opening_direction','lock_right','lock_left','central_lock_handle','vent_opening','panel_measurement_basis']);
  const automatic=useMemo(()=>[...definitions].filter(([key,field])=>driverRows.some(row=>fieldAvailable(catalogue,row,key)&&
    (essentials.has(key)||field.panelBasis||enabled(row.technical[key])||catalogue.dependencies[row.category]?.[key]&&enabled(row.technical[catalogue.dependencies[row.category][key]]))))
    .map(([key])=>key),[definitions,driverRows,catalogue]);
  const whole=useMemo(()=>[...definitions.keys()].filter(key=>mainKeys.includes(key)||catalogue.common.some(field=>field.key===key)||
    allRecords.some(row=>catalogue.categories.find(category=>category.id===row.category)?.fields.some(field=>field.key===key)||
      catalogue.categories.find(category=>category.id===row.category)?.systems.find(system=>system.id===row.system)?.fields.some(field=>field.key===key))),[definitions,allRecords,catalogue]);
  const columns=useMemo(()=>[...new Set([...mainKeys,...additional,...(wholeTable?whole:automatic),...Object.keys(filters)])],[additional,wholeTable,whole,automatic,filters]);
  const picker=useMemo(()=>[...definitions.entries()].filter(([key])=>!columns.includes(key))
    .filter(([key])=>driverRows.some((row)=>fieldAvailable(catalogue,row,key)))
    .sort(([,a],[,b])=>a[locale].localeCompare(b[locale],locale)),[definitions,columns,driverRows,catalogue,locale]);
  const definitionFor=(row,key)=>special[key]||catalogue.categories.find(category=>category.id===row.category)?.systems.find(system=>system.id===row.system)?.fields.find(field=>field.key===key)||
    catalogue.categories.find(category=>category.id===row.category)?.fields.find(field=>field.key===key)||definitions.get(key);
  const storageUnit=(key,row)=>storageLengthUnit(key,row?definitionFor(row,key):definitions.get(key));
  const displayUnit=key=>['cm','mm','m'].includes(lengthUnits[key])?lengthUnits[key]:'cm';
  const columnName=key=>storageUnit(key)?lengthLabel(definitions.get(key)[locale],displayUnit(key),locale):definitions.get(key)[locale];
  const displayValue=(row,key)=>storageUnit(key,row)?convertLength(value(row,key),storageUnit(key,row),displayUnit(key)):value(row,key);
  const names=(row,key)=>{const choices=optionPairs(row,key,definitionFor(row,key),catalogue,locale,t),unit=storageUnit(key,row);return unit?choices.map(([id,label])=>[convertLength(id,unit,displayUnit(key)),convertLength(label,unit,displayUnit(key))]):choices;};
  const show=(row,key)=>{
    const stored=displayValue(row,key);
    if (key==="perimeter") return perimeterText(stored,locale);
    if (Array.isArray(stored)) return stored.map((side)=>sides[side]?.[locale==="ar"?0:1]||side).join(", ");
    return names(row,key).find(([id])=>id===stored)?.[1]??technicalText(stored,locale)??"";
  };
  const editable=(row,key)=>editAllowed&&!busy&&Boolean(row?.active)&&fieldAvailable(catalogue,row,key)
    && (key!=="system"||Boolean(row.category));
  useEffect(()=>{
    const end=()=>{dragging.current=false;};
    window.addEventListener("pointerup",end);
    return ()=>window.removeEventListener("pointerup",end);
  },[]);
  useEffect(()=>{setSelected(null);setEditing(null);setColumnTypeKey(null);},[pageKey]);
  useEffect(()=>{localStorage.setItem('operationsGridWidthsV1',JSON.stringify(widths));},[widths]);
  useEffect(()=>{if(!contextMenu)return;contextRoot.current?.querySelector('button')?.focus();const close=event=>{if(!contextRoot.current?.contains(event.target))setContextMenu(null);};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);},[contextMenu]);
  const layoutKey=columns.join('|'),rowKey=records.map(row=>row.id).join('|');
  useLayoutEffect(()=>{
    const previous=previousLayout.current;previousLayout.current={columns,ids:records.map(row=>row.id)};
    if(!previous||!selected)return;
    const map=point=>({row:records.findIndex(row=>row.id===previous.ids[point.row]),col:columns.indexOf(previous.columns[point.col])});
    const start=map(selected.start),focus=map(selected.focus);
    if([start.row,start.col,focus.row,focus.col].some(index=>index<0)){setSelected(null);setEditing(null);return;}
    if(start.row!==selected.start.row||start.col!==selected.start.col||focus.row!==selected.focus.row||focus.col!==selected.focus.col)
      setSelected({start,focus});
  },[layoutKey,rowKey]);
  const point=(target)=>{
    const cell=target.closest("[data-ops-cell]");
    if (!cell||!grid.current?.contains(cell)) return null;
    const row=records.findIndex(({id})=>id===Number(cell.dataset.row));
    const col=columns.indexOf(cell.dataset.column);
    return row>=0&&col>=0?{row,col}:null;
  };
  const same=(a,b)=>a?.row===b?.row&&a?.col===b?.col;
  const activePoint=selected?.focus;
  const range=selected&&{
    rowStart:Math.min(selected.start.row,selected.focus.row),rowEnd:Math.max(selected.start.row,selected.focus.row),
    colStart:Math.min(selected.start.col,selected.focus.col),colEnd:Math.max(selected.start.col,selected.focus.col),
  };
  const active=activePoint&&records[activePoint.row];
  const setFullscreen=next=>{if(next&&active)fullAnchor.current={id:active.id,key:columns[activePoint.col]};onFullscreenChange?.(next);};
  const focus=(p,reveal=true)=>{
    const row=records[p.row];
    if (!row)return;
    const cell=grid.current?.querySelector(`[data-row="${row.id}"][data-column="${columns[p.col]}"]`);
    if(cell){cell.focus({preventScroll:true});if(reveal)cell.scrollIntoView({block:'nearest',inline:'nearest'});pendingFocus.current=null;}
    else if(virtual&&scroll.current){pendingFocus.current={id:row.id,key:columns[p.col]};scroll.current.scrollTop=Math.max(0,offsets[p.row]-48);setViewport({top:scroll.current.scrollTop,height:scroll.current.clientHeight});}
  };
  useLayoutEffect(()=>{
    const target=pendingFocus.current;if(!target)return;
    const cell=grid.current?.querySelector(`[data-row="${target.id}"][data-column="${target.key}"]`);
    if(cell){cell.focus();cell.scrollIntoView({block:'nearest',inline:'nearest'});pendingFocus.current=null;}
  },[virtualStart,virtualEnd,rowKey,layoutKey]);
  useLayoutEffect(()=>{
    if(!fullscreen||loading||!fullAnchor.current)return;
    const anchor=fullAnchor.current,p={row:records.findIndex(row=>row.id===anchor.id),col:columns.indexOf(anchor.key)};
    fullAnchor.current=null;if(p.row>=0&&p.col>=0)focus(p);
  },[fullscreen,loading,rowKey]);
  useLayoutEffect(()=>{
    const target=scroll.current;if(!fullscreen||!target)return;
    const measure=()=>setViewport({top:target.scrollTop,height:target.clientHeight}),observer=new ResizeObserver(measure);
    observer.observe(target);measure();const previous=document.body.style.overflow;document.body.style.overflow='hidden';
    return()=>{observer.disconnect();document.body.style.overflow=previous;};
  },[fullscreen]);
  useLayoutEffect(()=>{
    const target=scroll.current;
    if(fullscreen&&target)setViewport({top:target.scrollTop,height:target.clientHeight});
  },[fullscreen,virtual,rowKey]);
  useEffect(()=>{
    if(!virtual)return;let frame;
    const observer=new ResizeObserver(entries=>{let changed=false;for(const entry of entries){const id=Number(entry.target.dataset.opsRow),height=entry.target.getBoundingClientRect().height;
      if(height>0&&Math.abs((heights.current.get(id)||64)-height)>1){heights.current.set(id,height);changed=true;}}
      if(changed){cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>setHeightTick(value=>value+1));}});
    grid.current?.querySelectorAll('tr[data-ops-row]').forEach(row=>observer.observe(row));return()=>{observer.disconnect();cancelAnimationFrame(frame);};
  },[virtual,virtualStart,virtualEnd,rowKey,layoutKey]);
  const select=(p,extend=false,reveal=true)=>{setSelected((old)=>({start:extend&&old?old.start:p,focus:p}));focus(p,reveal);};
  function normalize(row,key,raw) {
    if (missing(raw)) return "";
    const type=definitionFor(row,key).type,unit=storageUnit(key,row);
    if(unit){const text=String(raw),normalized=/[x×]/.test(text)?text.split(/([x×])/).map(part=>/[x×]/.test(part)?part:normalizeSmartNumericClipboardValue(part)).join(''):normalizeSmartNumericClipboardValue(raw);if(type!=='number'&&!/^[+\-\d.eEx×]+$/.test(normalized))return raw;return convertLength(normalized,displayUnit(key),unit);}
    if (type==="number") return normalizeSmartNumericClipboardValue(raw);
    if (type==="sides") return String(raw).split(/[,،]/).map((part)=>part.trim())
      .map((part)=>Object.entries(sides).find(([side,labels])=>side===part||labels.includes(part))?.[0]).filter(Boolean);
    const text=String(raw).trim().toLocaleLowerCase();
    const match=names(row,key).find(([id,label])=>String(id).toLowerCase()===text||String(label).toLocaleLowerCase()===text);
    if (["category","system"].includes(key)||type==="boolean") {
      if (!match) throw new Error(t("اختر قيمة معروفة في عمود ","Choose a listed value in ")+definitions.get(key)[locale]);
      return match[0];
    }
    return raw;
  }
  function write(cells) {
    const next={...patches};
    const changed=new Map();
    try {
      for (const {p,raw,typed} of cells) {
        const row=changed.get(p.row)||records[p.row], key=columns[p.col];
        if (!editable(row,key)) continue;
        const entered=typed?raw:normalize(row,key,raw);
        if (JSON.stringify(entered)===JSON.stringify(value(row,key)??"")) continue;
        const original=items.find(item=>item.id===row.id);
        if(['opening_description','system'].includes(key)){
          const description=key==='opening_description'?entered:row.opening_description||row.commercial.description;
          const system=key==='system'?entered:row.system;
          const saved=ctx?.specification_defaults?.find(template=>template.description===description&&(!row.category||template.category===row.category)&&(!system||template.system===system));
          if(saved){
            if(!row.category)next[row.id]=editSpecification(original,next[row.id],'category',saved.category);
            if(!system)next[row.id]=editSpecification(original,next[row.id],'system',saved.system);
            for(const [name,input] of Object.entries(saved.technical))
              if(!Object.hasOwn(next[row.id]?.technical||{},name))next[row.id]=editSpecification(original,next[row.id],name,input);
          }
        }
        next[row.id]=editSpecification(original,next[row.id],key,entered);
        changed.set(p.row,applySpecificationEdits(original,next[row.id]));
      }
    } catch(error) {setProblem(error);return false;}
    if (!changed.size) return true;
    history.current=[...history.current.slice(-29),patches];
    redo.current=[];
    setPatches(next);setProblem(null);setMessage("");
    return true;
  }
  function fill() {
    if (!range) return;
    const target=range.rowStart===range.rowEnd&&range.rowStart>0?{...range,rowStart:range.rowStart-1}:range;
    const flat=records.map((row)=>Object.fromEntries(columns.map((key)=>[key,value(row,key)])));
    const result=fillSmartSelectionDownRows({rows:flat,range:target,columnOrder:columns});
    if (!result) return;
    const cells=[];
    for (let row=target.rowStart+1;row<=target.rowEnd;row++)
      for (let col=target.colStart;col<=target.colEnd;col++) cells.push({p:{row,col},raw:result[row][columns[col]],typed:true});
    write(cells);
  }
  function clipboard(event,paste) {
    if (editing||!range) return;
    event.preventDefault();
    if (!paste) {
      const values=records.slice(range.rowStart,range.rowEnd+1).map((row)=>
        columns.slice(range.colStart,range.colEnd+1).map((key)=>String(show(row,key)).replace(/[\t\r\n]/g," ")).join("\t"));
      event.clipboardData.setData("text/plain",values.join("\n"));
      const units=records.slice(range.rowStart,range.rowEnd+1).map(row=>columns.slice(range.colStart,range.colEnd+1).map(key=>({value:value(row,key),unit:storageUnit(key,row)})));lengthClipboard.current={text:values.join('\n'),units};event.clipboardData.setData('application/x-easy-commercial-lengths',JSON.stringify(units));
      if(event.type==='cut')cut.current={text:values.join('\n'),cells:records.slice(range.rowStart,range.rowEnd+1).flatMap(row=>columns.slice(range.colStart,range.colEnd+1).map(key=>({id:row.id,key,value:value(row,key)})))};
      return;
    }
    const block=expandSmartClipboardGrid(parseSmartClipboardGrid(event.clipboardData.getData("text/plain")),range);
    let sourceUnits=[];try{sourceUnits=expandSmartClipboardGrid(JSON.parse(event.clipboardData.getData('application/x-easy-commercial-lengths')||(lengthClipboard.current?.text===event.clipboardData.getData('text/plain')?JSON.stringify(lengthClipboard.current.units):'[]')),range);}catch{}
    const cells=block.flatMap((line,ri)=>line.map((raw,ci)=>{const p={row:range.rowStart+ri,col:range.colStart+ci},source=sourceUnits[ri]?.[ci],target=records[p.row]&&storageUnit(columns[p.col],records[p.row]);return source?.unit&&target?{p,raw:convertLength(source.value,source.unit,target),typed:true}:{p,raw};}))
      .filter(({p})=>p.row<records.length&&p.col<columns.length);
    if (block.length&&block.length>records.length-range.rowStart) {
      setProblem(new Error(t("عدد الصفوف الملصقة أكبر من الصفوف المتاحة في هذه الصفحة.","The paste contains more rows than this page has available.")));
      return;
    }
    const move=cut.current?.text===event.clipboardData.getData('text/plain')?cut.current:null;
    if(move&&move.cells.every(cell=>records.some(row=>row.id===cell.id))){
      const destinations=new Set(cells.map(({p})=>records[p.row].id+':'+columns[p.col]));
      for(const cell of move.cells)if(!destinations.has(cell.id+':'+cell.key)){
        const ri=records.findIndex(row=>row.id===cell.id),ci=columns.indexOf(cell.key);
        if(ci>=0&&JSON.stringify(value(records[ri],cell.key))===JSON.stringify(cell.value))cells.push({p:{row:ri,col:ci},raw:'',typed:true});
      }
    }
    if(write(cells)&&move)cut.current=null;
  }
  function start(p,initial) {
    const row=records[p.row],key=columns[p.col];
    if (editable(row,key)) setEditing({p,text:initial??String(definitionFor(row,key).type==='sides'?(value(row,key)||[]).join(','):show(row,key)),fresh:initial===undefined,index:-1});
  }
  function commit(p,text,advance,refocus=true) {
    const successful=write([{p,raw:text}]);
    if (successful||!refocus) setEditing(null);
    if (successful&&refocus) select(advance||p);
  }
  function keyboard(event) {
    if (event.isComposing) return;
    if((event.ctrlKey||event.metaKey)&&event.code==='KeyF'){event.preventDefault();event.stopPropagation();setEditing(null);setSearchOpen(true);return;}
    if(editing)return;
    if (event.key==="Escape"&&fullscreen) {event.stopPropagation();setFullscreen(false);return;}
    const p=point(event.target);
    if (!p) return;
    const command=event.ctrlKey||event.metaKey;
    const rtl=locale==="ar"?-1:1;
    const movement={ArrowUp:[-1,0],ArrowDown:[1,0],ArrowLeft:[0,-rtl],ArrowRight:[0,rtl],Enter:[1,0]};
    if(command&&event.code==='KeyA'){event.preventDefault();if(records.length)setSelected({start:{row:0,col:0},focus:{row:records.length-1,col:columns.length-1}});return;}
    if(event.key==='Home'||event.key==='End'){event.preventDefault();select({row:command?(event.key==='Home'?0:records.length-1):p.row,col:event.key==='Home'?0:columns.length-1},event.shiftKey);return;}
    if (command&&event.code==="KeyS"&&editAllowed) {
      event.preventDefault();
      if (!busy&&Object.keys(patches).length) save(false);
      return;
    }
    if (isSmartFillDownShortcut(event)&&editAllowed) {event.preventDefault();fill();return;}
    if(command&&(event.code==='KeyY'||event.shiftKey&&event.code==='KeyZ')){event.preventDefault();if(redo.current.length){history.current.push(patches);setPatches(redo.current.pop());}return;}
    if (command&&event.code==="KeyZ"&&history.current.length) {event.preventDefault();redo.current.push(patches);setPatches(history.current.pop());return;}
    if (event.key==="Delete"&&range&&editAllowed) {
      event.preventDefault();
      const cells=[];
      for(let row=range.rowStart;row<=range.rowEnd;row++)
        for(let col=range.colStart;col<=range.colEnd;col++) cells.push({p:{row,col},raw:"",typed:true});
      write(cells);return;
    }
    if (movement[event.key]) {
      event.preventDefault();
      const [dy,dx]=movement[event.key];
      if(command&&event.key.startsWith('Arrow')){
        const next=findSmartCtrlArrowDestination({rows:records.map(row=>({_gridId:String(row.id),...Object.fromEntries(columns.map(key=>[key,value(row,key)]))})),columnOrder:columns,
          focusCell:{rowId:String(records[p.row].id),columnKey:columns[p.col]},direction:locale==='ar'?event.key:({ArrowLeft:'ArrowRight',ArrowRight:'ArrowLeft'}[event.key]||event.key)});
        if(next)select({row:records.findIndex(row=>String(row.id)===next.rowId),col:columns.indexOf(next.columnKey)},event.shiftKey);return;
      }
      select({row:Math.max(0,Math.min(records.length-1,p.row+dy)),col:Math.max(0,Math.min(columns.length-1,p.col+dx))},
        event.shiftKey&&event.key!=="Enter");
      return;
    }
    if (!command&&!event.altKey&&editable(records[p.row],columns[p.col])&&(event.key==="F2"||event.key.length===1)) {
      event.preventDefault();start(p,event.key==="F2"?undefined:event.key);
    }
  }
  async function save(applyMatches,source=patches) {
    if (applyMatches&&!window.confirm(t(
      "تطبيق مواصفات هذا الصف على نفس النوع وطريقة الفتح مع الحفاظ على استثناءات الفتحات؟",
      "Apply this row’s specifications to the same opening type and system, preserving individual exceptions?",
    ))) return;
    setBusy(true);setMessage("");setProblem(null);
    try {
      const result=Object.keys(source).length||applyMatches?await request(path+"/specifications",{method:"POST",
        body:{rows:Object.values(source),remember,source_id:applyMatches?active?.id:undefined,apply_matches:applyMatches}}):{saved:0};
      setPatches({});history.current=[];redo.current=[];
      setAffectedOrders(result.affected_orders||[]);
      setMessage(applyMatches?t(`تم تحديث ${result.applied} من البنود المطابقة.`,`${result.applied} matching items updated.`)
        :t(`تم حفظ ${result.saved} من الصفوف.`,`${result.saved} rows saved.`));
      reload();
    } catch(error) {setProblem(error);}
    finally {setBusy(false);}
  }
  const waiting=Object.keys(patches).length;
  const searchResults=useMemo(()=>!searchOpen||!searchText.trim()?[]:findSmartTableMatches({rows:records.map(row=>({_gridId:String(row.id),...Object.fromEntries(columns.map(key=>[key,show(row,key)]))})),columnOrder:columns,searchText})
    .map(match=>({...match,replaceable:editable(records[match.rowIndex],match.columnKey)&&definitionFor(records[match.rowIndex],match.columnKey).type!=='sides'})),[searchOpen,searchText,records,columns,catalogue,locale,editAllowed,busy,lengthUnits]);
  const currentMatch=searchResults[Math.max(0,Math.min(searchIndex,searchResults.length-1))];
  const changeSearch=useCallback(text=>{setSearchText(text);setSearchIndex(0);},[]);
  const jump=(match,index)=>{setSearchIndex(index);select({row:match.rowIndex,col:columns.indexOf(match.columnKey)});};
  const stepSearch=delta=>{if(searchResults.length){const index=(searchIndex+delta+searchResults.length)%searchResults.length;jump(searchResults[index],index);}};
  function replaceSearch(query,replacement,current=null){
    const candidates=tableReplacementCandidates({rows:records,columns,query,replacement,current,valueFor:show,idFor:row=>row.id});
    const cells=[];let skipped=0;
    for(const {row,rowIndex,key,value:nextValue} of candidates){
      if(!editable(row,key)||definitionFor(row,key).type==='sides'){skipped++;continue;}
      try{const next=normalize(row,key,nextValue);if(definitionFor(row,key).type==='number'&&next!==''&&(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(String(next))||!Number.isFinite(Number(next)))){skipped++;continue;}
        if(String(value(row,key)??'')!==String(next))cells.push({p:{row:rowIndex,col:columns.indexOf(key)},raw:next,typed:true});
      }catch{skipped++;}
    }
    if(cells.length)write(cells);
    setMessage(t(`تم الاستبدال في ${cells.length} خلية${skipped?`؛ تعذر استبدال ${skipped}`:''}.`,`Replaced ${cells.length} cells${skipped?`; skipped ${skipped} unavailable or invalid cells`:''}.`));
  }
  const width=key=>Math.max(70,Math.min(900,Number(widths[key])||(key==='opening_description'?270:key==='infill'?220:130)));
  const resize=(event,key)=>{event.preventDefault();event.stopPropagation();const start=event.clientX,initial=width(key),pointer=event.pointerId,node=event.currentTarget;node.setPointerCapture(pointer);
    const move=event=>setWidths(previous=>({...previous,[key]:Math.max(70,Math.min(900,initial+(event.clientX-start)*(locale==='ar'?-1:1)))}));
    const stop=()=>{node.removeEventListener('pointermove',move);node.removeEventListener('pointerup',stop);node.removeEventListener('pointercancel',stop);};
    node.addEventListener('pointermove',move);node.addEventListener('pointerup',stop);node.addEventListener('pointercancel',stop);};
  async function menuAction(kind){
    setContextMenu(null);
    if(kind==='details'){if(active)openItem(active.id);return;}
    if(kind==='new'){openItem('new');return;}
    try{
      if(kind==='paste'){const text=await navigator.clipboard.readText();clipboard({preventDefault(){},clipboardData:{getData:()=>text}},true);}
      else{let text='';clipboard({type:kind,preventDefault(){},clipboardData:{setData:(type,value)=>{if(type==='text/plain')text=value;}}},false);await navigator.clipboard.writeText(text);}
    }catch(error){setProblem(error);}
  }
  return <section className={`ops-spec-grid pc-stack${fullscreen?" ops-grid-full":""}`} aria-label={t("جدول مواصفات البنود","BOQ specification worksheet")}>
    {editAllowed&&affectedOrders.length>0&&<div className="pc-toolbar ops-approval-followup"><span>{t('أوامر تحتاج مراجعة التعديلات','Orders with changes to review')}</span>{affectedOrders.map(order=><button key={order.id} type="button" disabled={!can('release')} onClick={()=>setApprovalOrder(order)}>{order.reference}</button>)}</div>}
    {approvalOrder&&<ApprovalReview endpoint={path+'/orders/'+approvalOrder.id} {...{request,t}} close={()=>setApprovalOrder(null)} saved={()=>{setAffectedOrders(list=>list.filter(order=>order.id!==approvalOrder.id));reload();}}/>}
    <div className="pc-toolbar ops-grid-tools">
      <button type="button" aria-pressed={wholeTable} onClick={()=>{setWholeTable(!wholeTable);setSelected(null);setEditing(null);}}>{wholeTable?t('أعمدة حسب التحديد','Columns for selection'):t('جميع الأعمدة','All columns')}</button>
      <button type="button" onClick={()=>setSearchOpen(true)}><Search size={15}/>{t('بحث في الجدول','Search Table')} <kbd>Ctrl+F</kbd></button>
      {editAllowed&&<>
        <button type="button" className="primary" disabled={!waiting||busy} onClick={()=>save(false)}><Save size={15}/>
          {t("حفظ المواصفات","Save specifications")}{waiting>0&&<bdi>({waiting})</bdi>}</button>
        <button type="button" disabled={busy||!range||range.rowEnd===0} onClick={fill}>{t("نسخ للأسفل","Fill down")} <kbd>Ctrl+D</kbd></button>
        <button type="button" disabled={busy||!active?.active||!active?.system} onClick={()=>save(true)}><Copy size={15}/>
          {t("تطبيق على نفس النوع والنظام","Apply to matching opening types")}</button>
        <label className="pc-check"><input type="checkbox" checked={remember} onChange={(event)=>setRemember(event.target.checked)}/>
          {t("تذكّر مواصفات هذا العميل","Remember customer defaults")}</label>
      </>}
      {!wholeTable&&<label className="ops-add-field">{t('إضافة عمود للتحديد','Add a column for selection')}
        <input list={fieldList} value={columnQuery} placeholder={t('ابحث عن اسم الحقل','Search field name')} onChange={event=>{
          const text=event.target.value,match=picker.find(([key,field])=>field[locale]===text||key===text);if(match){setAdditional(old=>[...new Set([...old,match[0]])]);setColumnQuery('');}else setColumnQuery(text);
        }}/><datalist id={fieldList}>{picker.map(([key,field])=><option key={key} value={field[locale]}/>)}</datalist></label>}
      {Object.keys(filters).length>0&&<button type="button" onClick={()=>{setFilters({});setSelected(null);}}>{t('إزالة جميع الفلاتر','Clear all filters')} ({Object.keys(filters).length})</button>}
      <button type="button" disabled={!active} onClick={()=>active&&openItem(active.id)}>{t('تفاصيل الفتحة','Opening details')}</button>
      <button type="button" aria-label={fullscreen?t("إنهاء ملء الشاشة","Exit full screen"):t("ملء الشاشة","Full screen")}
        title={fullscreen?t("إنهاء ملء الشاشة","Exit full screen"):t("ملء الشاشة","Full screen")} onClick={()=>setFullscreen(!fullscreen)}>
        {fullscreen?<Minimize2 size={16}/>:<Maximize2 size={16}/>}</button>
    </div>
    <SpecificationError error={problem} {...{patches,t,busy}} labels={(key)=>definitions.get(key)?.[locale]} resolve={(keep)=>{
      const next=resolveSpecificationEdits(patches,problem.payload.specification_conflicts,keep);
      setPatches(next);save(false,next);
    }}/>{message&&<p role="status" className="pc-caption">{message}</p>}
    {loading&&<p role="status">{t('جار تحميل جميع الصفوف…','Loading all rows…')}</p>}
    {loadError&&<p className="pc-problem" role="alert">{loadError.message}<button type="button" onClick={reload}>{t('إعادة المحاولة','Retry')}</button></p>}
    <div ref={scroll} className="pc-table-scroll ops-spec-scroll" onScroll={event=>{if(virtual)setViewport({top:event.currentTarget.scrollTop,height:event.currentTarget.clientHeight});}}>
      <table className="pc-table ops-grid-table" style={{width:52+columns.reduce((sum,key)=>sum+width(key),0)}} ref={grid} role="grid" aria-rowcount={records.length+1} aria-busy={Boolean(loading)} onKeyDown={keyboard}
        onContextMenu={event=>{if(editing||!range)return;event.preventDefault();setContextMenu({left:Math.min(event.clientX,window.innerWidth-255),top:Math.min(event.clientY,window.innerHeight-260)});}}
        onCopy={(event)=>clipboard(event,false)} onCut={event=>clipboard(event,false)} onPaste={(event)=>clipboard(event,true)}
        onPointerDown={(event)=>{
          if (event.button!==0||event.target.closest("button,input")) return;
          const next=point(event.target);
          if (next) {dragging.current=true;select(next,event.shiftKey,false);}
        }} onPointerOver={(event)=>{
          if (!dragging.current||!(event.buttons&1)) return;
          const next=point(event.target);
          if (next&&!same(next,selected?.focus)) select(next,true);
        }} onDoubleClick={(event)=>{const p=point(event.target);if (p) start(p);}}>
        <colgroup><col style={{width:52}}/>{columns.map(key=><col key={key} style={{width:width(key)}}/>)}</colgroup>
        <thead><tr><th scope="col">#</th>
          {columns.map((key)=><th key={key} scope="col"><div className="ops-column-heading"><button type="button" className="pc-name" title={t('ترتيب','Sort')} onClick={()=>{setSort(sort?.key===key&&sort.direction===-1?null:{key,direction:sort?.key===key?-sort.direction:1});setSelected(null);}}>
            {columnName(key)}{sort?.key===key?(sort.direction===1?' ↑':' ↓'):''}</button>
            {storageUnit(key)&&<select className="ops-length-unit" aria-label={t('وحدة ','Unit for ')+definitions.get(key)[locale]} title={t('وحدة الإدخال والعرض','Input and display unit')} value={displayUnit(key)} onPointerDown={event=>event.stopPropagation()} onChange={event=>{if(editing)commit(editing.p,editing.text,null,false);setLengthUnits(old=>({...old,[key]:event.target.value}));}}>{['cm','mm','m'].map(unit=><option key={unit} value={unit}>{unit}</option>)}</select>}
            <button type="button" aria-label={t('تصفية ','Filter ')+definitions.get(key)[locale]} aria-pressed={Boolean(filters[key])} onClick={event=>{const rect=event.currentTarget.getBoundingClientRect();setColumnMenu({key,position:{left:Math.max(8,Math.min(rect.left,window.innerWidth-295)),top:Math.min(rect.bottom,window.innerHeight-350)}});}}><Filter size={12}/></button></div>
            <span role="separator" aria-label={t('عرض عمود ','Width of ')+definitions.get(key)[locale]} className="ops-column-resize" onPointerDown={event=>resize(event,key)}/></th>)}</tr></thead>
        <tbody>{virtual&&virtualStart>0&&<tr className="ops-grid-spacer" aria-hidden="true"><td colSpan={columns.length+1} style={{height:offsets[virtualStart]}}/></tr>}
        {records.slice(virtualStart,virtualEnd).map((row,index)=>{const r=virtualStart+index;return <tr key={row.id} data-ops-row={row.id} aria-rowindex={r+2} className={activePoint?.row===r?'table-active-row':''}>
          <th scope="row"><button type="button" className="pc-name" title={row.description} onClick={event=>{setSelected({start:event.shiftKey&&selected?selected.start:{row:r,col:0},focus:{row:r,col:columns.length-1}});}} onDoubleClick={()=>openItem(row.id)}>{r+1}</button></th>
          {columns.map((key,c)=>{
            const p={row:r,col:c};
            const marked=range&&r>=range.rowStart&&r<=range.rowEnd&&c>=range.colStart&&c<=range.colEnd;
            const allowed=editable(row,key);
            return <td key={key} role="gridcell" aria-selected={Boolean(marked)} aria-readonly={!allowed} data-ops-cell
              data-row={row.id} data-column={key} tabIndex={same(p,activePoint)||!selected&&r===0&&c===0?0:-1}
              onFocus={()=>{if (!selected) setSelected({start:p,focus:p});}} className={(key==='opening_description'?'ops-description':!allowed?"ops-grid-readonly":"")+
                (searchOpen&&currentMatch?.rowId===String(row.id)&&currentMatch?.columnKey===key?' table-search-current':'')}>
              {same(editing?.p,p)?<CellEdit {...{editing,setEditing,t,locale}} fieldType={definitionFor(row,key).type} suggestions={names(row,key)}
                commit={(text,advance,restore)=>commit(p,text,advance,restore)}
                cancel={()=>{setEditing(null);focus(p);}}
                next={r<records.length-1?{row:r+1,col:c}:p} right={c<columns.length-1?{row:r,col:c+1}:p}/>:<><bdi className="table-search-text"><SearchMatchText value={show(row,key)} query={searchOpen?searchText:''}
                  active={currentMatch?.rowId===String(row.id)&&currentMatch?.columnKey===key}/></bdi>
                  {key==='opening_description'&&Boolean(row.defaults_applied)&&<small>{row.defaults_applied===2?t('مواصفات المشروع المحفوظة · قابلة للتعديل','Saved project defaults · editable'):t('مواصفات العميل المحفوظة · قابلة للتعديل','Saved customer defaults · editable')}</small>}</>}
            </td>;
          })}
        </tr>;})}
        {virtual&&virtualEnd<records.length&&<tr className="ops-grid-spacer" aria-hidden="true"><td colSpan={columns.length+1} style={{height:offsets.at(-1)-offsets[virtualEnd]}}/></tr>}</tbody>
      </table>
    </div>
    {!records.length&&<p>{t('لا توجد صفوف تطابق الفلاتر.','No rows match the filters.')}</p>}
    {columnMenu&&<ColumnFilter key={columnMenu.key} t={t} zIndex={270010} column={columnName(columnMenu.key)} position={columnMenu.position}
      values={[...new Map(allRecords.map(row=>[filterValue(row,columnMenu.key),{value:filterValue(row,columnMenu.key),label:show(row,columnMenu.key)}])).values()]}
      selected={filters[columnMenu.key]} onClose={()=>setColumnMenu(null)} onApply={values=>{setFilters(previous=>{const next={...previous};if(values)next[columnMenu.key]=values;else delete next[columnMenu.key];return next;});setSelected(null);setColumnMenu(null);}}/>}
    {searchOpen&&<TableSearchPanel ownerRef={grid} uiLanguage={locale} initialQuery={searchText} results={searchResults} currentIndex={searchIndex} columnLabel={columnName}
      onReplace={editAllowed?replaceSearch:undefined} onReplaceAll={editAllowed?(query,replacement)=>replaceSearch(query,replacement):undefined}
      onSearchChange={changeSearch} onClose={()=>{setSearchOpen(false);if(activePoint)focus(activePoint);}} onPrevious={()=>stepSearch(-1)} onNext={()=>stepSearch(1)} onJump={jump}/>}
    {contextMenu&&createPortal(<div ref={contextRoot} className="ops-grid-menu" role="menu" style={contextMenu} onKeyDown={event=>{if(event.key==='Escape')setContextMenu(null);}}>
      <button type="button" role="menuitem" onClick={()=>menuAction('copy')}>{t('نسخ التحديد','Copy selection')}</button>
      {editAllowed&&<><button type="button" role="menuitem" onClick={()=>menuAction('cut')}>{t('قص التحديد','Cut selection')}</button><button type="button" role="menuitem" onClick={()=>menuAction('paste')}>{t('لصق','Paste')}</button>
        <button type="button" role="menuitem" onClick={()=>menuAction('new')}>{t('اقتراح فتحة إضافية','Propose an additional opening')}</button></>}
      <button type="button" role="menuitem" onClick={()=>menuAction('details')}>{t('تفاصيل الفتحة','Opening details')}</button><button type="button" onClick={()=>setContextMenu(null)}>{t('إلغاء','Cancel')}</button>
    </div>,document.body)}
    <SelectionStatus uiLanguage={locale} values={range?records.slice(range.rowStart,range.rowEnd+1).flatMap(row=>columns.slice(range.colStart,range.colEnd+1).map(key=>displayValue(row,key))):[]}/>
    {fullscreen?<small><bdi>{records.length}</bdi> {t('صفوف','rows')}</small>:pagination}
  </section>;
}

function CellEdit({editing,setEditing,suggestions,commit,cancel,next,right,t,locale,fieldType}) {
  const done=useRef(false);
  const input=useRef(null);
  const [position,setPosition]=useState(null);
  const needle=editing.fresh?"":editing.text.toLocaleLowerCase();
  const options=suggestions.filter(([,label])=>String(label).toLocaleLowerCase().includes(needle)).slice(0,14);
  const hasOptions=options.length>0;
  useLayoutEffect(()=>{
    if (!hasOptions) return;
    function reposition() {
      const rect=input.current?.getBoundingClientRect();
      if (!rect) return;
      const width=Math.min(280,window.innerWidth-16);
      const left=Math.max(8,Math.min(window.innerWidth-width-8,locale==="ar"?rect.right-width:rect.left));
      const above=window.innerHeight-rect.bottom<210 && rect.top>210;
      setPosition({left,width,top:above?undefined:rect.bottom,bottom:above?window.innerHeight-rect.top:undefined});
    }
    reposition();
    window.addEventListener("scroll",reposition,true);
    window.addEventListener("resize",reposition);
    return ()=>{window.removeEventListener("scroll",reposition,true);window.removeEventListener("resize",reposition);};
  },[hasOptions,locale]);
  function finish(text,advance,restore=true) {
    done.current=true;
    commit(text,advance,restore);
  }
  if(fieldType==='sides'){
    const checked=editing.text.split(',').filter(side=>Object.hasOwn(sides,side));
    return <div className="ops-side-editor" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget)&&!done.current)finish(editing.text,null,false);}}
      onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();done.current=true;cancel();}}}>
      <label><input autoFocus type="checkbox" checked={checked.length===4} onChange={event=>setEditing({...editing,text:event.target.checked?Object.keys(sides).join(','):''})}/>{t('الكل','All sides')}</label>
      {Object.entries(sides).map(([side,labels])=><label key={side}><input type="checkbox" checked={checked.includes(side)} onChange={event=>setEditing({...editing,text:(event.target.checked?[...checked,side]:checked.filter(value=>value!==side)).join(',')})}/>{t(...labels)}</label>)}
      <button type="button" onClick={()=>finish(editing.text,next)}>{t('تم','Done')}</button><button type="button" onClick={()=>{done.current=true;cancel();}}>{t('إلغاء','Cancel')}</button>
    </div>;
  }
  return <div className="ops-cell-editor">
    <input ref={input} autoFocus aria-label={t("قيمة الخلية","Cell value")} value={editing.text} dir="auto"
      onFocus={(event)=>{if (editing.fresh) event.target.select();}}
      onChange={(event)=>{done.current=false;setEditing({...editing,text:event.target.value,fresh:false,index:-1});}}
      onBlur={()=>{if (!done.current) finish(editing.text,null,false);}}
      onKeyDown={(event)=>{
        if (event.key==="Escape") {event.preventDefault();event.stopPropagation();done.current=true;cancel();return;}
        if (options.length&&["ArrowDown","ArrowUp"].includes(event.key)) {
          event.preventDefault();
          const index=editing.index<0?(event.key==="ArrowDown"?0:options.length-1):
            (editing.index+(event.key==="ArrowDown"?1:-1)+options.length)%options.length;
          setEditing({...editing,index});return;
        }
        if (event.key==="Enter"||event.key==="Tab") {
          event.preventDefault();
          const option=options[editing.index];
          finish(option?String(option[0]):editing.text,event.key==="Enter"?next:right);
        }
      }}/>
    {hasOptions&&position&&createPortal(<div className="ops-cell-options" dir={locale==="ar"?"rtl":"ltr"}
      style={position} aria-label={t("الاقتراحات","Suggestions")}>
      {options.map(([value,label],index)=><button type="button" tabIndex={-1} key={String(value)} aria-current={index===editing.index}
        onMouseDown={(event)=>event.preventDefault()} onClick={()=>finish(String(value))}>{label}</button>)}
    </div>,document.body)}
  </div>;
}
