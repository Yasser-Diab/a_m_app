import {useEffect,useLayoutEffect,useMemo,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {Copy,Maximize2,Minimize2,Save} from "lucide-react";
import {
  expandSmartClipboardGrid,fillSmartSelectionDownRows,isSmartFillDownShortcut,
  normalizeSmartNumericClipboardValue,parseSmartClipboardGrid,
} from "../smart-table-clipboard.mjs";
import {SpecificationError,applySpecificationEdits,editSpecification,resolveSpecificationEdits} from "./specification-edits.jsx";
import {technicalText,fieldOptions,configurationTags,perimeterText,hasTrim} from "./terminology.js";
import {SelectionStatus} from '../table-tools.jsx';

const mainKeys=["tag","category","system","quantity","width_mm","height_mm","profile","color","infill"];
const lockColumns=["leaves","lock_right","lock_left","central_lock_handle"];
const special={
  category:{ar:"نوع البند",en:"Work type"},
  system:{ar:"النظام / القطاع",en:"System"},
  rubber_bar:{ar:"جلدة التثبيت",en:"Rubber glazing gasket",type:"boolean"},
};
const sides={right:["يمين","Right"],left:["يسار","Left"],top:["أعلى","Top"],bottom:["أسفل","Bottom"]};
const missing=(value)=>value==null||value==="";
const enabled=(value)=>Boolean(value&&!["لا","بدون","لا ينطبق","none","no","n/a"].includes(String(value).toLowerCase()));

function fieldAvailable(catalogue,row,key) {
  if (mainKeys.includes(key)) return true;
  const category=catalogue.categories.find(({id})=>id===row.category);
  const system=category?.systems.find(({id})=>id===row.system);
  if (key==="rubber_bar") return ["windows","doors"].includes(row.category);
  const part=category?.fields.find((field)=>field.key===key)||system?.fields.find((field)=>field.key===key);
  if (!part) return catalogue.common.some((field)=>field.key===key);
  const tags=catalogue.conditional[row.category]?.[key];
  const activeTags=configurationTags(system,row.technical);
  const depends=catalogue.dependencies[row.category]?.[key];
  return hasTrim(key,row.technical)&&(!part.populatedOnly||row.technical[key]!=null&&row.technical[key]!=="")&&(!tags||tags.split(" ").some((tag)=>activeTags.has(tag)))
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

export default function SpecificationGrid({items,catalogue,uiLanguage:locale,t,can,request,path,reload,openItem,pageKey,pagination}) {
  const [patches,setPatches]=useState({});
  const [selected,setSelected]=useState(null);
  const [editing,setEditing]=useState(null);
  const [additional,setAdditional]=useState([]);
  const [columnQuery,setColumnQuery]=useState("");
  const [fullscreen,setFullscreen]=useState(false);
  const [remember,setRemember]=useState(true);
  const [message,setMessage]=useState("");
  const [problem,setProblem]=useState(null);
  const [busy,setBusy]=useState(false);
  const history=useRef([]);
  const grid=useRef(null);
  const dragging=useRef(false);
  const editAllowed=can("edit");
  const records=items.map((item)=>applySpecificationEdits(item,patches[item.id]));
  const definitions=useMemo(()=>new Map([
    ...catalogue.common.map((field)=>[field.key,field]),
    ...catalogue.categories.flatMap((category)=>[...category.fields,...category.systems.flatMap((system)=>system.fields)]
      .map((field)=>[field.key,field])),
    ...Object.entries(special),
  ]),[catalogue]);
  const columns=[...mainKeys,...additional];
  const picker=[...definitions.entries()].filter(([key])=>!mainKeys.includes(key))
    .filter(([key])=>records.some((row)=>fieldAvailable(catalogue,row,key)))
    .filter(([,field])=>field[locale].toLocaleLowerCase().includes(columnQuery.toLocaleLowerCase()))
    .sort(([,a],[,b])=>a[locale].localeCompare(b[locale],locale));
  const names=(row,key)=>optionPairs(row,key,definitions.get(key),catalogue,locale,t);
  const value=(row,key)=>key==="category"||key==="system"?row[key]:row.technical[key];
  const show=(row,key)=>{
    const stored=value(row,key);
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
  useEffect(()=>{setSelected(null);setEditing(null);},[pageKey]);
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
  const focus=(p)=>{
    const row=records[p.row];
    if (row) grid.current?.querySelector(`[data-row="${row.id}"][data-column="${columns[p.col]}"]`)?.focus();
  };
  const select=(p,extend=false)=>{setSelected((old)=>({start:extend&&old?old.start:p,focus:p}));focus(p);};
  function normalize(row,key,raw) {
    if (missing(raw)) return "";
    const type=definitions.get(key).type;
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
        const original=items[p.row];
        next[row.id]=editSpecification(original,next[row.id],key,entered);
        changed.set(p.row,applySpecificationEdits(original,next[row.id]));
      }
    } catch(error) {setProblem(error);return false;}
    if (!changed.size) return true;
    history.current=[...history.current.slice(-29),patches];
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
      return;
    }
    const block=expandSmartClipboardGrid(parseSmartClipboardGrid(event.clipboardData.getData("text/plain")),range);
    const cells=block.flatMap((line,ri)=>line.map((raw,ci)=>({p:{row:range.rowStart+ri,col:range.colStart+ci},raw})))
      .filter(({p})=>p.row<records.length&&p.col<columns.length);
    if (block.length&&block.length>records.length-range.rowStart) {
      setProblem(new Error(t("عدد الصفوف الملصقة أكبر من الصفوف المتاحة في هذه الصفحة.","The paste contains more rows than this page has available.")));
      return;
    }
    write(cells);
  }
  function start(p,initial) {
    const row=records[p.row],key=columns[p.col];
    if (editable(row,key)) setEditing({p,text:initial??String(show(row,key)),fresh:initial===undefined,index:-1});
  }
  function commit(p,text,advance,refocus=true) {
    const successful=write([{p,raw:text}]);
    if (successful||!refocus) setEditing(null);
    if (successful&&refocus) select(advance||p);
  }
  function keyboard(event) {
    if (event.isComposing||editing) return;
    if (event.key==="Escape"&&fullscreen) {event.stopPropagation();setFullscreen(false);return;}
    const p=point(event.target);
    if (!p) return;
    const command=event.ctrlKey||event.metaKey;
    const rtl=locale==="ar"?-1:1;
    const movement={ArrowUp:[-1,0],ArrowDown:[1,0],ArrowLeft:[0,-rtl],ArrowRight:[0,rtl],Enter:[1,0]};
    if (command&&event.code==="KeyS"&&editAllowed) {
      event.preventDefault();
      if (!busy&&Object.keys(patches).length) save(false);
      return;
    }
    if (isSmartFillDownShortcut(event)&&editAllowed) {event.preventDefault();fill();return;}
    if (command&&event.code==="KeyZ"&&history.current.length) {event.preventDefault();setPatches(history.current.pop());return;}
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
      "تطبيق مواصفات هذا الصف على جميع البنود ذات الوصف المطابق في جدول الكميات؟",
      "Apply this row’s specifications to every item with the exact same BOQ description?",
    ))) return;
    setBusy(true);setMessage("");setProblem(null);
    try {
      const result=Object.keys(source).length||applyMatches?await request(path+"/specifications",{method:"POST",
        body:{rows:Object.values(source),remember,source_id:applyMatches?active?.id:undefined,apply_matches:applyMatches}}):{saved:0};
      setPatches({});history.current=[];
      setMessage(applyMatches?t(`تم تحديث ${result.applied} من البنود المطابقة.`,`${result.applied} matching items updated.`)
        :t(`تم حفظ ${result.saved} من الصفوف.`,`${result.saved} rows saved.`));
      reload();
    } catch(error) {setProblem(error);}
    finally {setBusy(false);}
  }
  const waiting=Object.keys(patches).length;
  return <section className={`ops-spec-grid pc-stack${fullscreen?" ops-grid-full":""}`} aria-label={t("جدول مواصفات البنود","BOQ specification worksheet")}>
    <div className="pc-toolbar ops-grid-tools">
      {editAllowed&&<>
        <button type="button" className="primary" disabled={!waiting||busy} onClick={()=>save(false)}><Save size={15}/>
          {t("حفظ المواصفات","Save specifications")}{waiting>0&&<bdi>({waiting})</bdi>}</button>
        <button type="button" disabled={busy||!range||range.rowEnd===0} onClick={fill}>{t("نسخ للأسفل","Fill down")} <kbd>Ctrl+D</kbd></button>
        <button type="button" disabled={busy||!active?.active||!active?.system} onClick={()=>save(true)}><Copy size={15}/>
          {t("تطبيق على نفس الوصف","Apply to matching descriptions")}</button>
        <label className="pc-check"><input type="checkbox" checked={remember} onChange={(event)=>setRemember(event.target.checked)}/>
          {t("تذكّر مواصفات هذا العميل","Remember customer defaults")}</label>
      </>}
      <button type="button" aria-pressed={lockColumns.every((key)=>additional.includes(key))} onClick={()=>{
        setAdditional((old)=>lockColumns.every((key)=>old.includes(key))?old.filter((key)=>!lockColumns.includes(key)):
          [...new Set([...old,...lockColumns])]);
        setSelected(null);
      }}>{t("الضلف والأقفال","Leaves & locks")}</button>
      <details className="ops-column-picker"><summary>{t("أعمدة إضافية","More columns")}</summary>
        <input value={columnQuery} placeholder={t("اسم العمود","Column name")} aria-label={t("اسم العمود","Column name")} onChange={(event)=>setColumnQuery(event.target.value)}/>
        <div className="ops-options">
        {picker.map(([key,field])=><label key={key} className="pc-check">
          <input type="checkbox" checked={additional.includes(key)} onChange={(event)=>{
            setAdditional((old)=>event.target.checked?[...old,key]:old.filter((entry)=>entry!==key));setSelected(null);
          }}/>{field[locale]}</label>)}</div></details>
      <button type="button" aria-label={fullscreen?t("إنهاء ملء الشاشة","Exit full screen"):t("ملء الشاشة","Full screen")}
        title={fullscreen?t("إنهاء ملء الشاشة","Exit full screen"):t("ملء الشاشة","Full screen")} onClick={()=>setFullscreen(!fullscreen)}>
        {fullscreen?<Minimize2 size={16}/>:<Maximize2 size={16}/>}</button>
    </div>
    <SpecificationError error={problem} {...{patches,t,busy}} labels={(key)=>definitions.get(key)?.[locale]} resolve={(keep)=>{
      const next=resolveSpecificationEdits(patches,problem.payload.specification_conflicts,keep);
      setPatches(next);save(false,next);
    }}/>{message&&<p role="status" className="pc-caption">{message}</p>}
    <div className="pc-table-scroll ops-spec-scroll">
      <table className="pc-table ops-grid-table" ref={grid} role="grid" onKeyDown={keyboard}
        onCopy={(event)=>clipboard(event,false)} onPaste={(event)=>clipboard(event,true)}
        onPointerDown={(event)=>{
          if (event.button!==0||event.target.closest("button,input")) return;
          const next=point(event.target);
          if (next) {dragging.current=true;select(next,event.shiftKey);}
        }} onPointerOver={(event)=>{
          if (!dragging.current||!(event.buttons&1)) return;
          const next=point(event.target);
          if (next&&!same(next,selected?.focus)) select(next,true);
        }} onDoubleClick={(event)=>{const p=point(event.target);if (p) start(p);}}>
        <thead><tr><th scope="col">{t("البند","Item")}</th><th scope="col">{t("وصف البند","BOQ description")}</th>
          {columns.map((key)=><th key={key} scope="col">{definitions.get(key)[locale]}</th>)}</tr></thead>
        <tbody>{records.map((row,r)=><tr key={row.id} className={activePoint?.row===r?'table-active-row':''}>
          <th scope="row"><button type="button" className="pc-name" onClick={()=>openItem(row.id)}>{row.code}</button></th>
          <td className="ops-description" title={row.commercial.description}>
            <bdi>{row.commercial.description}</bdi>
            {Boolean(row.defaults_applied)&&<small>{t("مواصفات العميل المحفوظة · قابلة للتعديل","Saved customer defaults · editable")}</small>}
          </td>
          {columns.map((key,c)=>{
            const p={row:r,col:c};
            const marked=range&&r>=range.rowStart&&r<=range.rowEnd&&c>=range.colStart&&c<=range.colEnd;
            const allowed=editable(row,key);
            return <td key={key} role="gridcell" aria-selected={Boolean(marked)} aria-readonly={!allowed} data-ops-cell
              data-row={row.id} data-column={key} tabIndex={same(p,activePoint)||!selected&&r===0&&c===0?0:-1}
              onFocus={()=>{if (!selected) setSelected({start:p,focus:p});}} className={!allowed?"ops-grid-readonly":""}>
              {same(editing?.p,p)?<CellEdit {...{editing,setEditing,t,locale}} suggestions={names(row,key)}
                commit={(text,advance,restore)=>commit(p,text,advance,restore)}
                cancel={()=>{setEditing(null);focus(p);}}
                next={r<records.length-1?{row:r+1,col:c}:p} right={c<columns.length-1?{row:r,col:c+1}:p}/>:<bdi>{show(row,key)}</bdi>}
            </td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>
    <SelectionStatus uiLanguage={locale} values={range?records.slice(range.rowStart,range.rowEnd+1).flatMap(row=>columns.slice(range.colStart,range.colEnd+1).map(key=>value(row,key))):[]}/>
    {pagination}
  </section>;
}

function CellEdit({editing,setEditing,suggestions,commit,cancel,next,right,t,locale}) {
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
