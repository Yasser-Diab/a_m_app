import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Clipboard, Ellipsis, Filter, Maximize2, Minimize2, Plus, Redo2, Search, Undo2 } from "lucide-react";
import {createPortal} from 'react-dom';
import { applySmartClipboardGridToRows,expandSmartClipboardGrid, fillSmartSelectionDownRows, findSmartCtrlArrowDestination, findSmartTableMatches, insertSmartRowRelative, isSmartFillDownShortcut, parseSmartClipboardGrid, smartSelectionAfterNavigation } from "../smart-table-clipboard.mjs";
import {ColumnFilter,SelectionStatus,TableSearchPanel,SearchMatchText} from '../table-tools.jsx';
import {mergeVisibleRows,reorderVisibleRows,offsetIndex,tableReplacementCandidates} from '../table-tools.mjs';
import {normalizeSmartNumericClipboardValue} from '../smart-table-clipboard.mjs';
import { Dialog, Field, Money, newKey, numberText, searchText } from "./shared.jsx";

export const GRID_COLUMNS = [
  { key: "building_unit", label: ["المبنى", "Building"], width: 128 },
  { key: "floor_apartment", label: ["الوحدة / الشقة", "Unit / apartment"], width: 128 },
  { key: "work_type", label: ["نوع الأعمال", "Work type"], width: 145 },
  { key: "work_item", label: ["البند / الرمز", "Item / code"], width: 125 },
  { key: "description", label: ["الأعمال", "Works"], width: 275 },
  { key: "mode", label: ["طريقة الإدخال", "Entry mode"], kind: "mode", width: 145 },
  { key: "width", label: ["العرض / الطول", "Width / length"], kind: "number", modes: ["area", "linear"] },
  { key: "height", label: ["الارتفاع", "Height"], kind: "number", modes: ["area"] },
  { key: "dimension_unit", label: ["وحدة الأبعاد", "Dimension unit"], kind: "dimension", modes: ["area", "linear"] },
  { key: "count", label: ["العدد", "Count"], kind: "number", modes: ["area", "linear", "count"] },
  { key: "quantity", label: ["الكمية", "Quantity"], kind: "number", modes: ["direct", "adjustment"] },
  { key: "unit", label: ["وحدة القياس", "Measure unit"], modes: ["area", "linear", "count", "direct", "adjustment"] },
  { key: "rate", label: ["السعر", "Rate"], kind: "number", modes: ["area", "linear", "count", "direct", "adjustment"] },
  { key: "agreed_amount", label: ["المبلغ المتفق عليه", "Agreed amount"], kind: "number", modes: ["lump"], width: 130 },
  { key: "recognition", label: ["أساس التقييم", "Recognition"], kind: "recognition", modes: ["area", "linear", "count", "direct", "lump"], width: 130 },
  { key: "progress", label: ["نسبة الإنجاز المدخلة %", "Entered progress %"], kind: "number", modes: ["area", "linear", "count", "direct", "lump"] },
  { key: "claim_amount", label: ["المبلغ المطالب به", "Claim amount"], kind: "number", modes: ["lump"], width: 135 },
  { key: "adjustment_amount", label: ["قيمة التسوية", "Adjustment amount"], kind: "number", modes: ["adjustment"], width: 130 },
  { key: "reason", label: ["سبب التسوية", "Adjustment reason"], modes: ["adjustment"], width: 150 },
  { key: "note", label: ["ملاحظة للعميل", "Customer note"], width: 155 },
  { key: "previous_progress", label: ["الإنجاز السابق %", "Previous progress %"], kind: "computedPercent" },
  { key: "current_progress", label: ["الإنجاز الحالي %", "Current progress %"], kind: "computedPercent" },
  { key: "previous", label: ["القيمة السابقة", "Previous value"], kind: "money" },
  { key: "current", label: ["القيمة الحالية", "Current value"], kind: "money" },
  { key: "cumulative", label: ["التراكمي", "Cumulative"], kind: "money" },
];

const modes = {
  area: ["مساحة بالأبعاد", "Measured area"], linear: ["طول بالأبعاد", "Measured linear"],
  count: ["بالعدد", "Count"], direct: ["كمية مباشرة", "Direct quantity"],
  lump: ["مقطوعية", "Lump sum"], adjustment: ["تسوية معتمدة", "Approved adjustment"],
};
const gridKeys = GRID_COLUMNS.filter(({ kind }) => !["money", "computedPercent"].includes(kind)).map(({ key }) => key);
const pageSize = 36;
const virtualHeight = 52;
const maxRows = 2500;
const suggestionKeys = new Set(["building_unit","floor_apartment","work_type","work_item","description","unit"]);

export function emptyLine() {
  return { _gridId: newKey(), identity: newKey(), mode: "direct", recognition: "incremental", dimension_unit: "cm" };
}

export function hydrateLines(rows = []) {
  return rows.map((row) => ({ ...row, ...(row.carried_forward?{recognition:"cumulative",progress:row.cumulative_progress??row.previous_progress??row.progress}:{}),
    _gridId: String(row.identity || row.id || newKey()) }));
}

export function stripGridFields(rows) {
  return rows.map(({ _gridId, _touched, ...row }) => row);
}

function applies(row, column) { return !column.modes || column.modes.includes(row.mode || "direct"); }

function localizedMode(value) {
  const key = searchText(value);
  return Object.keys(modes).find((mode) => key === mode || modes[mode].some((name) => searchText(name) === key)) || value;
}

function cellChoices(kind, t) {
  if (kind === "mode") return Object.entries(modes).map(([key,label]) => ({key,label:t(...label)}));
  if (kind === "recognition") return [{key:"incremental",label:t("عن الفترة","This period")},{key:"cumulative",label:t("تراكمي","Cumulative")}];
  if (kind === "dimension") return [{key:"",label:"—"},...[["mm","مم"],["cm","سم"],["m","م"]].map(([key,arabic]) => ({key,label:t(arabic,key)}))];
  return null;
}

function cellValue(row,key,locations) {
  if (key !== "building_unit" && key !== "floor_apartment") return row[key];
  if (Object.hasOwn(row,key)) return row[key];
  const place = row.location || locations.get(String(row.location_id))?.label || "";
  const parts = place.split(/\s*[›/]\s*/).filter(Boolean);
  return key === "building_unit" ? parts[0] || "" : parts.length > 1 ? parts.at(-1) : "";
}

const WorkRow = memo(function WorkRow({ row, rowIndex, columns, t, readOnly, locations, editor, focus, onInput, onSelectRow, onMenu, selected, error, locale, addition,cutKeys,query='',currentSearchColumn }) {
  const rowLabel = rowIndex + 1;
  return <tr data-grid-row={row._gridId} aria-rowindex={rowIndex + 2} className={[addition?'pc-grid-addition':'',error?'pc-row-invalid':'',focus?'pc-active-row':''].join(' ')}>
    <th scope="row" className="pc-grid-index"><div className="pc-grid-row-buttons">
      <button type="button" data-row-selector={row._gridId} onClick={(event) => onSelectRow(row._gridId,event.shiftKey)}
        aria-label={addition ? t("صف الإضافة", "New data row") : `${t("تحديد الصف", "Select row")} ${rowLabel}`}>{addition ? "+" : rowLabel}</button>
      {!readOnly && !addition && <button type="button" onClick={() => onMenu(row._gridId)} aria-label={`${t("خيارات البند", "Row actions")} ${rowLabel}`}><Ellipsis size={15} /></button>}
    </div></th>
    {columns.map((column) => {
      const { key, kind } = column;
      const applicable = applies(row, column) || (readOnly && key === "quantity" && row.billed_quantity != null);
      const value = readOnly && key === "quantity" ? row.billed_quantity ?? row.quantity : cellValue(row,key,locations);
      const label = `${t(...column.label)} · ${rowIndex + 1}`;
      const active = editor?.columnKey === key;
      const choices = cellChoices(kind,t);
      const display = choices?.find((item) => item.key === (value ?? (kind === "mode" ? "direct" : kind === "recognition" ? "incremental" : "")))?.label ?? value;
      let content = null;
      if (kind === "money") content = <Money value={row[key]} locale={locale} />;
      else if (kind === "computedPercent") {
        const percent = Object.hasOwn(row, key) ? value : key === "current_progress" && !row.carried_forward ? row.progress : null;
        content = percent == null || percent === "" ? "—" : <bdi>{numberText(percent)}%</bdi>;
      }
      else if (applicable && active && !readOnly) content = <input data-cell-editor="true" aria-label={label} autoComplete="off"
        readOnly={Boolean(choices)} aria-haspopup={choices ? "listbox" : undefined} inputMode={kind === "number" ? "decimal" : undefined}
        dir={kind === "number" ? "ltr" : "auto"} value={choices ? display ?? "" : editor.value}
        aria-autocomplete={suggestionKeys.has(key) ? "list" : undefined} onChange={(event) => onInput(event.target.value)} />;
      else if (applicable) content = <bdi className="pc-grid-cell-value table-search-text"><SearchMatchText value={key === "progress" && readOnly ? `${numberText(value ?? 100)}%` :
        kind === "number" ? numberText(display ?? "") : display ?? ""} query={query} active={currentSearchColumn===key}/></bdi>;
      return <td key={key} data-row-id={row._gridId} data-column={key} aria-label={label} aria-selected={Boolean(selected?.includes(key))}
        tabIndex={focus === key ? 0 : -1}
        className={`${applicable ? "" : "pc-grid-off"} ${selected?.includes(key) ? "pc-grid-selected" : ""} ${cutKeys?.has(key)?'pc-grid-cut':''} ${currentSearchColumn===key?'table-search-current':''}`}>{content}</td>;
    })}
  </tr>;
});

export default function CertificateGrid({ rows, onChange, readOnly, t, locale, locations = [], suggestions = [], workItems = [], workTypes = [], operationItems = [], validation = [], totals, currency, settled,storageKey='certificateGridColumnWidthsV1' }) {
  const grid = useRef(null);
  const currentRows = useRef(rows);
  const additionRow = useRef(null);
  if (!additionRow.current) additionRow.current = emptyLine();
  const nextFocus = useRef(null);
  const pointerSelection = useRef(null);
  const editing = useRef(null);
  const resizing = useRef(null);
  const forcedVisible=useRef(new Set()),clipboard=useRef(null),contextRoot=useRef(null),heights=useRef(new Map());
  const history = useRef({ past: [], future: [] });
  const [historyTick, setHistoryTick] = useState(0);
  const [page, setPage] = useState(0);
  const [selection, setSelection] = useState(null);
  const [editor, setEditor] = useState(null);
  const [search, setSearch] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [rowMenu, setRowMenu] = useState(null);
  const [sortBy, setSortBy] = useState("");
  const [sortedView, setSortedView] = useState(false);
  const [fullReadView, setFullReadView] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const [viewport, setViewport] = useState({top:0,height:520});
  const [widths, setWidths] = useState({});
  const [suggestionCell, setSuggestionCell] = useState(null);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const [message, setMessage] = useState("");
  const [filters,setFilters]=useState({}),[columnMenu,setColumnMenu]=useState(null),[searchOpen,setSearchOpen]=useState(false);
  const [contextMenu,setContextMenu]=useState(null),[deleting,setDeleting]=useState(null),[clipboardTick,setClipboardTick]=useState(0),[heightTick,setHeightTick]=useState(0);
  useEffect(()=>{try{const saved=JSON.parse(localStorage.getItem(storageKey)||'{}');setWidths(Object.fromEntries(Object.entries(saved).filter(([,value])=>Number.isFinite(value)&&value>=68&&value<=1200)));}catch{setWidths({});}},[storageKey]);
  useEffect(()=>{if(Object.keys(widths).length)localStorage.setItem(storageKey,JSON.stringify(widths));},[widths,storageKey]);
  const compactColumns = useMemo(() => GRID_COLUMNS.filter((column) => {
    const {key,modes} = column;
    if (["building_unit","floor_apartment","work_type","description","quantity","unit","rate","previous_progress","current_progress","previous","current","cumulative"].includes(key)) return true;
    if (["mode","progress"].includes(key)) return !readOnly;
    if (key === "recognition") return !readOnly;
    return modes ? rows.some((row) => modes.includes(row.mode)) : rows.some((row) => row[key] != null && row[key] !== "");
  }), [readOnly,rows]);
  const columns = fullReadView ? GRID_COLUMNS : compactColumns;
  const selectionColumns = columns.map(({key}) => key);
  const editableColumns = columns.filter(({key}) => gridKeys.includes(key)).map(({key}) => key);
  const locationMap = useMemo(() => new Map(locations.map((location) => [String(location.id), location])), [locations]);
  const editable = !readOnly && !sortedView;
  const canAdd = editable && rows.length < maxRows;
  const filteredRows=useMemo(()=>rows.filter(row=>forcedVisible.current.has(row._gridId)||Object.entries(filters).every(([key,values])=>values.includes(String(cellValue(row,key,locationMap)??'')))),[rows,filters,locationMap]);
  const viewRows=useMemo(()=>sortedView?[...filteredRows].sort((a,b)=>String(cellValue(a,sortBy,locationMap)||'').localeCompare(String(cellValue(b,sortBy,locationMap)||''),locale,{numeric:true})):filteredRows,[filteredRows,sortedView,sortBy,locale,locationMap]);
  const displayRows=useMemo(()=>canAdd?[...viewRows,additionRow.current]:viewRows,[viewRows,canAdd]);
  const offsets=useMemo(()=>{const result=[0];for(const row of displayRows)result.push(result.at(-1)+(heights.current.get(row._gridId)||virtualHeight));return result;},[displayRows,heightTick]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(displayRows.length / pageSize) - 1));
  const start = fullScreen ? Math.max(0,offsetIndex(offsets,viewport.top)-8) : currentPage * pageSize;
  const end = fullScreen ? Math.min(displayRows.length,offsetIndex(offsets,viewport.top+viewport.height)+10) : start + pageSize;
  const visible = displayRows.slice(start,end);
  const displayedValue=(row,key)=>{
    const column=columns.find(column=>column.key===key),raw=cellValue(row,key,locationMap);
    const choices=cellChoices(column?.kind,t);
    if(choices)return choices.find(choice=>choice.key===raw)?.label??raw??'';
    return column?.kind==='number'?numberText(raw??''):raw??'';
  };
  const matches = useMemo(() => findSmartTableMatches({rows:viewRows.map(row=>({_gridId:row._gridId,...Object.fromEntries(columns.map(column=>[column.key,displayedValue(row,column.key)]))})),
    columnOrder:selectionColumns,searchText:search}).map(match=>({...match,replaceable:editable&&gridKeys.includes(match.columnKey)&&applies(viewRows[match.rowIndex],columns.find(column=>column.key===match.columnKey))})),
  [viewRows,search,columns,editable,locationMap,t]);
  const currentMatch=matches[Math.max(0,Math.min(matchIndex,matches.length-1))];
  const errors = useMemo(() => new Set(validation.map((item) => String(item.line_id || item.id || ""))), [validation]);
  useLayoutEffect(() => { currentRows.current = rows; }, [rows]);
  useLayoutEffect(()=>{heights.current.clear();setHeightTick(value=>value+1);},[widths,fullReadView]);
  useLayoutEffect(()=>{
    const root=grid.current;if(!root)return;let frame;
    const observer=new ResizeObserver(entries=>{let changed=false;for(const entry of entries){const id=entry.target.dataset.gridRow,height=entry.target.getBoundingClientRect().height;
      if(Math.abs((heights.current.get(id)||virtualHeight)-height)>.5){heights.current.set(id,height);changed=true;}}
      if(changed){cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>setHeightTick(value=>value+1));}});
    root.querySelectorAll('tr[data-grid-row]').forEach(row=>observer.observe(row));return()=>{observer.disconnect();cancelAnimationFrame(frame);};
  },[rows,start,end,columns,fullScreen,widths]);
  useEffect(()=>{const end=()=>{pointerSelection.current=null;};window.addEventListener('pointerup',end);return()=>window.removeEventListener('pointerup',end);},[]);
  useEffect(()=>{if(!contextMenu)return;const close=event=>{if(!contextRoot.current?.contains(event.target))setContextMenu(null);};document.addEventListener('pointerdown',close,true);return()=>document.removeEventListener('pointerdown',close,true);},[contextMenu]);

  useLayoutEffect(() => {
    const target = grid.current;
    if (!fullScreen || !target) return;
    function measure() { setViewport({top:target.scrollTop,height:target.clientHeight}); }
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    const activeIndex=selection?.focusCell?displayRows.findIndex(row=>row._gridId===selection.focusCell.rowId):-1;
    target.scrollTop = offsets[activeIndex>=0?activeIndex:currentPage * pageSize]||0;
    if(selection?.focusCell){nextFocus.current=selection.focusCell;requestAnimationFrame(focusPending);}
    measure();
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { observer.disconnect(); document.body.style.overflow = oldOverflow; };
  }, [fullScreen]);

  useEffect(() => {
    if (!suggestionCell) return;
    const close = () => setSuggestionCell(null);
    window.addEventListener("resize",close);
    return () => window.removeEventListener("resize",close);
  }, [suggestionCell]);

  function focusPending() {
    const point = nextFocus.current;
    if (!point) return;
    const cell = grid.current?.querySelector(`[data-row-id="${CSS.escape(point.rowId)}"][data-column="${CSS.escape(point.columnKey)}"]`);
    const target = point.edit ? cell?.querySelector('input') : cell;
    if (!target) return;
    target.focus({preventScroll:true});
    cell.scrollIntoView({block:'nearest',inline:'nearest'});
    if (point.edit && !target.readOnly) {
      if (point.typing) target.setSelectionRange(target.value.length,target.value.length);
      else target.select();
    }
    nextFocus.current = null;
  }
  useLayoutEffect(focusPending);

  function focusCell(point,hint) {
    if (!point) return;
    const rowIndex = hint ?? displayRows.findIndex((row) => row._gridId === point.rowId);
    if (rowIndex < 0) return;
    nextFocus.current = point;
    if (fullScreen && grid.current) {
      const targetTop = offsets[rowIndex]??rowIndex*virtualHeight,targetBottom=offsets[rowIndex+1]??targetTop+virtualHeight;
      const {scrollTop,clientHeight} = grid.current;
      if(targetTop<scrollTop)grid.current.scrollTop=targetTop;
      else if(targetBottom>scrollTop+clientHeight)grid.current.scrollTop=Math.max(0,targetBottom-clientHeight);
      setViewport({top:grid.current.scrollTop,height:clientHeight});
    } else setPage(Math.floor(rowIndex / pageSize));
    requestAnimationFrame(focusPending);
  }

  const change = useCallback((next) => {
    history.current.past = [...history.current.past.slice(-39), currentRows.current];
    history.current.future = [];
    setHistoryTick((value) => value + 1);
    const previous=new Map(currentRows.current.map(row=>[row._gridId,row]));
    onChange(next.map(row=>{
      const before=previous.get(row._gridId);
      return before?.carried_forward&&gridKeys.some(key=>row[key]!==before[key])
        ? {...row,carried_forward:false,recognition:"cumulative"}:row;
    }));
  }, [onChange]);

  function historyMove(direction) {
    const other = direction === "past" ? "future" : "past";
    const next = history.current[direction].pop();
    if (!next) return;
    history.current[other].push(rows);
    setHistoryTick((value) => value + 1);
    onChange(next);
  }

  const edit = useCallback((rowId, key, value, extra = {}) => {
    const patch = (row) => {
      const locationPatch = ["building_unit","floor_apartment"].includes(key) ? {
        building_unit:cellValue(row,"building_unit",locationMap), floor_apartment:cellValue(row,"floor_apartment",locationMap),
        location_id:null,
      } : {};
      return {...row,...locationPatch,[key]:value,...extra};
    };
    if (rowId === additionRow.current._gridId) {
      if (!String(value ?? "").trim()) return;
      const newRow = patch(additionRow.current);
      additionRow.current = emptyLine();
      change([...currentRows.current,newRow]);
    } else change(currentRows.current.map((row) => row._gridId === rowId ? patch(row) : row));
  }, [change,locationMap]);

  function select(point, extend) {
    setSelection((current) => smartSelectionAfterNavigation({ selection: current, destination: point, extendSelection: extend }));
  }

  function range(order = selectionColumns) {
    if (!selection) return null;
    const rowIndex = (point) => displayRows.findIndex((row) => row._gridId === point.rowId);
    const indexes = [rowIndex(selection.anchorCell), rowIndex(selection.focusCell)];
    let keys = [order.indexOf(selection.anchorCell.columnKey), order.indexOf(selection.focusCell.columnKey)];
    if(order===editableColumns){const edges=[selectionColumns.indexOf(selection.anchorCell.columnKey),selectionColumns.indexOf(selection.focusCell.columnKey)];
      const selected=selectionColumns.slice(Math.min(...edges),Math.max(...edges)+1).filter(key=>order.includes(key));keys=[order.indexOf(selected[0]),order.indexOf(selected.at(-1))];}
    if ([...indexes,...keys].includes(-1)) return null;
    return { rowStart: Math.min(...indexes), rowEnd: Math.max(...indexes), colStart: Math.min(...keys), colEnd: Math.max(...keys) };
  }

  function paste(text, point) {
    let data = parseSmartClipboardGrid(text);
    const entryRows = viewRows;
    const bounds=range(editableColumns);
    if(bounds&&displayRows.slice(bounds.rowStart,bounds.rowEnd+1).some(row=>row._gridId===point?.rowId)){
      data=expandSmartClipboardGrid(data,bounds);point={rowId:displayRows[bounds.rowStart]._gridId,columnKey:editableColumns[bounds.colStart]};
    }
    const intoAddition = point?.rowId === additionRow.current._gridId;
    const index = intoAddition ? entryRows.length : entryRows.findIndex((item) => item._gridId === point?.rowId);
    if (index < 0 || !data.length) return false;
    if (rows.length+Math.max(0,index+data.length-entryRows.length) > maxRows) {
      setMessage(t("يمكن إدخال 2500 بند بحد أقصى في المستخلص.", "A certificate supports up to 2,500 work rows."));
      return true;
    }
    let firstNew = intoAddition ? additionRow.current : null;
    const next = applySmartClipboardGridToRows({ rows:entryRows, startRow: index, startKey: point.columnKey,
      columnOrder: editableColumns, grid: data, createRow: () => {
        const row = firstNew || emptyLine();
        firstNew = null;
        return row;
      }, normalizeValue(value, key) {
        const kind = GRID_COLUMNS.find((column) => column.key === key)?.kind;
        if (key === "mode") return localizedMode(value);
        return kind === "number" ? numberText(value) : value;
      } });
    if (!next) return false;
    data.forEach((values,offset) => {
      const affected = editableColumns.slice(next.startColumn,next.startColumn+values.length);
      if (affected.includes("building_unit") || affected.includes("floor_apartment")) {
        const row = next.rows[index+offset];
        next.rows[index+offset] = {...row,building_unit:cellValue(row,"building_unit",locationMap),
          floor_apartment:cellValue(row,"floor_apartment",locationMap),location_id:null};
      }
    });
    if (intoAddition) additionRow.current = emptyLine();
    const destinations=new Set();data.forEach((values,offset)=>editableColumns.slice(next.startColumn,next.startColumn+values.length)
      .forEach(key=>destinations.add(next.rows[index+offset]._gridId+'\0'+key)));
    let result=mergeVisibleRows(rows,next.rows);
    const cut=clipboard.current;
    if(cut?.kind==='cut'&&cut.text===text){
      const visibleIds=new Set(viewRows.map(row=>row._gridId));
      if(cut.cells.every(cell=>visibleIds.has(cell.id))){
        const pending=new Map();for(const cell of cut.cells){if(destinations.has(cell.id+'\0'+cell.key))continue;
          const row=rows.find(row=>row._gridId===cell.id);if(String(cellValue(row,cell.key,locationMap)??'')!==cell.value)continue;
          const patch=pending.get(cell.id)||{};patch[cell.key]='';pending.set(cell.id,patch);}
        result=result.map(row=>pending.has(row._gridId)?{...row,...pending.get(row._gridId)}:row);
      }
      clipboard.current=null;setClipboardTick(value=>value+1);
    }
    const oldIds=new Set(rows.map(row=>row._gridId));result.forEach(row=>{if(!oldIds.has(row._gridId))forcedVisible.current.add(row._gridId);});
    change(result);
    if (intoAddition) focusCell(point,rows.length);
    setMessage(""); setSuggestionCell(null);
    return true;
  }

  function rowSelection(id,extend) {
    const first = {rowId:id,columnKey:selectionColumns[0]};
    const last = {rowId:id,columnKey:selectionColumns.at(-1)};
    setSelection((current) => ({anchorCell:extend && current?.anchorCell ? current.anchorCell : first,focusCell:last}));
  }

  function copySelection(event) {
    const bounds = range();
    if (!bounds || event.target.matches('[data-cell-editor]')) return;
    const keys = selectionColumns.slice(bounds.colStart,bounds.colEnd+1);
    const text = displayRows.slice(bounds.rowStart,bounds.rowEnd+1).filter((row) => row !== additionRow.current)
      .map((row) => keys.map((key) => String(cellValue(row,key,locationMap) ?? "").replace(/[\t\r\n]+/g," ")).join("\t")).join("\n");
    if (!text) return;
    clipboard.current={kind:event.type==='cut'?'cut':'copy',text,cells:displayRows.slice(bounds.rowStart,bounds.rowEnd+1).filter(row=>row!==additionRow.current)
      .flatMap(row=>keys.filter(key=>gridKeys.includes(key)).map(key=>({id:row._gridId,key,value:String(cellValue(row,key,locationMap)??'')})))};
    setClipboardTick(value=>value+1);
    event.clipboardData.setData("text/plain",text);
    event.preventDefault();
  }

  function pointFrom(target) {
    const cell = target.closest?.('td[data-row-id][data-column]');
    return cell ? {rowId:cell.dataset.rowId,columnKey:cell.dataset.column} : null;
  }

  function beginEditing(point, typed) {
    const row = point && displayRows.find((item) => item._gridId === point.rowId);
    const column = row && columns.find((item) => item.key === point.columnKey);
    if (!editable || !row || !column || !gridKeys.includes(column.key) || !applies(row,column)) return false;
    const choices = cellChoices(column.kind,t);
    const value = String(cellValue(row,column.key,locationMap) ?? "");
    const active = {...point,value:choices ? value : typed ?? value,initial:value,choices};
    editing.current = active;
    setEditor(active);
    select(point,false);
    focusCell({...point,edit:true,typing:typed != null});
    return true;
  }

  function updateEditor(value) {
    if (!editing.current) return;
    const active = {...editing.current,value};
    editing.current = active;
    setEditor(active);
    setSuggestionIndex(-1);
  }

  function finishEditing({commit = true, restore = false, value} = {}) {
    const active = editing.current;
    if (!active) return false;
    editing.current = null;
    setEditor(null);
    setSuggestionCell(null);
    const next = value ?? active.value;
    const added = commit && active.rowId === additionRow.current._gridId && Boolean(String(next).trim()) && next !== active.initial;
    if (commit && next !== active.initial) edit(active.rowId,active.columnKey,next);
    if (restore) focusCell({rowId:active.rowId,columnKey:active.columnKey});
    return added;
  }

  const suggestionRow = suggestionCell && displayRows.find((row) => row._gridId === suggestionCell.rowId);
  const suggestionsForCell = !editable || !suggestionRow || !editor ? [] : editor.choices ?? (() => {
    const key = editor.columnKey;
    const typed = searchText(editor.value);
    const contextKey = key === "floor_apartment" ? "building_unit" : key === "building_unit" ? "floor_apartment" : "";
    const context = contextKey && searchText(cellValue(suggestionRow,contextKey,locationMap));
    const catalog = locations.map((location) => ({location:location.label}));
    const library = [...suggestions,...rows.filter((entry) => entry._gridId !== suggestionRow._gridId),...catalog,...workItems];
    const scoped = context ? library.filter((entry) => searchText(cellValue(entry,contextKey,locationMap)) === context) : [];
    const extra = key === "work_type" ? workTypes.map((item) => typeof item === "string" ? item : item.label || item.name) :
      key === "unit" ? ["m²","m","pcs","kg"] : [];
    const seen = new Set();
    return [...(scoped.length ? scoped : library).map((entry) => cellValue(entry,key,locationMap)),...extra].filter((value) => {
      const normalized = searchText(value);
      if (!normalized || seen.has(normalized) || !normalized.includes(typed)) return false;
      seen.add(normalized);
      return true;
    }).slice(0,12).map((value) => ({key:value,label:value}));
  })();

  function showSuggestions(target) {
    const active = editing.current;
    if (!target.matches('[data-cell-editor]') || !active || (!active.choices && !suggestionKeys.has(active.columnKey))) return;
    const box = target.getBoundingClientRect();
    const width = Math.min(Math.max(box.width,165),window.innerWidth-20);
    const left = Math.max(10,Math.min(locale === "ar" ? box.right-width : box.left,window.innerWidth-width-10));
    const above = window.innerHeight-box.bottom < 220 && box.top > 230;
    setSuggestionIndex(-1);
    setSuggestionCell({rowId:active.rowId,width,left,...(above ? {bottom:window.innerHeight-box.top+4} : {top:box.bottom+4})});
  }

  function onCellPointerDown(event) {
    if (event.button !== 0 || event.pointerType === "touch" || event.target.matches('[data-cell-editor]')) return;
    const selector=event.target.closest('[data-row-selector]');
    if(selector){finishEditing();pointerSelection.current={pointerId:event.pointerId,rows:true,moved:false};rowSelection(selector.dataset.rowSelector,event.shiftKey);return;}
    const point = pointFrom(event.target);
    if (!point) return;
    event.preventDefault();
    finishEditing();
    pointerSelection.current = {pointerId:event.pointerId,point,moved:false};
    select(point,event.shiftKey);
    event.target.closest('td').focus();
  }

  function extendPointerSelection(event) {
    const drag = pointerSelection.current;
    if (!drag || event.pointerId !== drag.pointerId || !(event.buttons & 1)) return;
    if(drag.rows){const row=event.target.closest('tr[data-grid-row]');if(row){rowSelection(row.dataset.gridRow,true);drag.moved=true;}return;}
    const point = pointFrom(event.target);
    if (!point || (point.rowId === drag.point.rowId && point.columnKey === drag.point.columnKey)) return;
    drag.point = point;
    drag.moved = true;
    select(point,true);
    event.target.closest('td').focus({preventScroll:true});
  }

  function onKeyDown(event) {
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    const key = event.key;
    const control = event.ctrlKey || event.metaKey;
    if(control&&(event.code==='KeyF'||key.toLowerCase()==='f')){event.preventDefault();event.stopPropagation();finishEditing();setSearchOpen(true);return;}
    if(!editing.current&&editable&&key==='Delete'){event.preventDefault();askDelete();return;}
    if (key === "Enter" && event.target.dataset.rowSelector) {
      event.preventDefault();
      const index = displayRows.findIndex((row) => row._gridId === event.target.dataset.rowSelector);
      const next = displayRows[index] === additionRow.current ? displayRows[index] :
        displayRows[index+1];
      if (next) {
        const point = {rowId:next._gridId,columnKey:selectionColumns[0]};
        select(point,false);
        focusCell(point);
      }
      return;
    }
    const point = pointFrom(event.target) || (event.target === grid.current ? selection?.focusCell : null);
    if (!point) return;
    const active = event.target.matches('[data-cell-editor]') ? editing.current : null;
    if (active && key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      finishEditing({commit:Boolean(suggestionsForCell.length),restore:true});
      return;
    }
    if (active && suggestionsForCell.length && !control && !event.shiftKey) {
      if (key === "ArrowUp" || key === "ArrowDown") {
        event.preventDefault();
        const count = suggestionsForCell.length;
        setSuggestionIndex((index) => index < 0 ? (key === "ArrowUp" ? count-1 : 0) : (index+(key === "ArrowUp" ? -1 : 1)+count)%count);
        return;
      }
      if (key === "Enter" && suggestionIndex >= 0) {
        event.preventDefault();
        finishEditing({value:suggestionsForCell[suggestionIndex].key,restore:true});
        return;
      }
    }
    if (active && key !== "Enter" && key !== "Tab" && key !== "ArrowDown" && key !== "ArrowUp") return;
    if (!active && editable && control && (event.code === "KeyZ" || event.code === "KeyY")) {
      event.preventDefault(); historyMove(event.shiftKey || event.code === "KeyY" ? "future" : "past"); return;
    }
    if (!active && editable && isSmartFillDownShortcut(event)) {
      event.preventDefault();
      const next = fillSmartSelectionDownRows({rows:viewRows,range:range(editableColumns),columnOrder:editableColumns,createRow:emptyLine});
      if (next) { event.preventDefault(); change(mergeVisibleRows(rows,next)); }
      return;
    }
    if (!active && !control && !event.altKey && (key === "F2" || key.length === 1)) {
      if (beginEditing(point,key === "F2" ? undefined : key)) event.preventDefault();
      return;
    }
    if (!active && control && key.startsWith("Arrow")) {
      const physicalKey = locale === "en" ? ({ArrowLeft:"ArrowRight",ArrowRight:"ArrowLeft"}[key] || key) : key;
      const destination = findSmartCtrlArrowDestination({rows:displayRows,columnOrder:selectionColumns,focusCell:point,direction:physicalKey});
      if (destination) { event.preventDefault(); select(destination,event.shiftKey); focusCell(destination); }
      return;
    }
    const horizontal = locale === "ar" ? -1 : 1;
    const delta = {Enter:[event.shiftKey ? -1 : 1,0],Tab:[0,event.shiftKey ? -1 : 1],
      ArrowUp:[-1,0],ArrowDown:[1,0],ArrowLeft:[0,-horizontal],ArrowRight:[0,horizontal]}[key];
    if (!delta || (key === "Tab" && !active)) return;
    const rowIndex = displayRows.findIndex((row) => row._gridId === point.rowId);
    const targetIndex = rowIndex + delta[0];
    const targetColumn = selectionColumns[selectionColumns.indexOf(point.columnKey)+delta[1]];
    if (active) {
      const added = finishEditing();
      const destination = added && targetIndex === displayRows.length ? additionRow.current : displayRows[targetIndex];
      if (destination && targetColumn) {
        event.preventDefault();
        const target = {rowId:destination._gridId,columnKey:targetColumn};
        select(target,false);
        focusCell(target,targetIndex);
      } else if (key !== "Tab") {
        event.preventDefault();
        focusCell(point);
      }
      return;
    }
    event.preventDefault();
    if (key === "Enter" && displayRows[rowIndex] === additionRow.current) {
      beginEditing(point);
      return;
    }
    if (displayRows[targetIndex] && targetColumn) {
      const target = {rowId:displayRows[targetIndex]._gridId,columnKey:targetColumn};
      select(target,key !== "Enter" && event.shiftKey);
      focusCell(target,targetIndex);
    }
  }

  function addRow() {
    if (!canAdd) return;
    const row = additionRow.current;
    additionRow.current = emptyLine();
    change([...rows,row]);
    const point = {rowId:row._gridId,columnKey:"description"};
    select(point,false);
    focusCell(point,rows.length);
  }

  function toggleFullScreen() {
    if (fullScreen) {
      setPage(Math.floor(offsetIndex(offsets,viewport.top)/pageSize));
      if (grid.current) grid.current.scrollTop = 0;
    }
    setSuggestionCell(null);
    setFullScreen(!fullScreen);
  }

  function moveMatch(step=1,index) {
    if (!matches.length) return;
    const selected=index??((matchIndex+step+matches.length)%matches.length),match=matches[selected];
    setMatchIndex(selected);
    select(match, false);
    focusCell(match);
  }

  function replaceSearch(query,replacement,current=null){
    if(!editable)return;
    const candidates=tableReplacementCandidates({rows:viewRows,columns:selectionColumns,query,replacement,current,valueFor:displayedValue});
    const patches=new Map();let count=0,skipped=0;
    for(const candidate of candidates){
      const {row,key}=candidate,column=columns.find(column=>column.key===key);
      if(!gridKeys.includes(key)||!applies(row,column)){skipped++;continue;}
      let value=candidate.value;
      const choices=cellChoices(column.kind,t);
      if(choices){const choice=choices.find(choice=>searchText(choice.key)===searchText(value)||searchText(choice.label)===searchText(value));if(!choice){skipped++;continue;}value=choice.key;}
      if(column.kind==='number'){value=normalizeSmartNumericClipboardValue(value);if(value!==''&&(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)||!Number.isFinite(Number(value)))){skipped++;continue;}}
      if(String(cellValue(row,key,locationMap)??'')===String(value))continue;
      const patch=patches.get(row._gridId)||{};
      if(['building_unit','floor_apartment'].includes(key)&&!Object.hasOwn(patch,'location_id'))Object.assign(patch,{building_unit:cellValue(row,'building_unit',locationMap),floor_apartment:cellValue(row,'floor_apartment',locationMap),location_id:null});
      patch[key]=value;patches.set(row._gridId,patch);count++;
    }
    if(count)change(currentRows.current.map(row=>patches.has(row._gridId)?{...row,...patches.get(row._gridId)}:row));
    setMessage(t(`تم الاستبدال في ${count} خلية${skipped?`؛ تعذر استبدال ${skipped}`:''}.`,`Replaced ${count} cells${skipped?`; skipped ${skipped} unavailable or invalid cells`:''}.`));
  }

  function rowAction(action) {
    const index = rows.findIndex((row) => row._gridId === rowMenu);
    if (index < 0) return;
    if (action === "delete") {askDelete([rowMenu]);return;}
    else if (["above","below","copy"].includes(action) && canAdd) {
      const source = rows[index];
      change(insertSmartRowRelative({ rows, targetRowId: rowMenu, placement: action === "above" ? "above" : "below",
        createRow: action === "copy" ? () => ({ ...source, id: undefined, _gridId: newKey(), identity: newKey(), previous: undefined, current: undefined, cumulative: undefined }) : emptyLine }).rows);
    } else if (action === "up" || action === "down") {
      const destination = index + (action === "up" ? -1 : 1);
      if (destination >= 0 && destination < rows.length) {
        const next = [...rows];
        [next[index], next[destination]] = [next[destination], next[index]];
        change(next);
      }
    }
    setRowMenu(null);
  }

  function selectedRowIds(){const bounds=range();return bounds?displayRows.slice(bounds.rowStart,bounds.rowEnd+1).filter(row=>row!==additionRow.current).map(row=>row._gridId):[];}
  function askDelete(ids=selectedRowIds()){
    if(!editable||!ids.length)return;setDeleting(ids);setContextMenu(null);setRowMenu(null);
  }
  function deleteSelected(){const ids=new Set(deleting);change(rows.filter(row=>!ids.has(row._gridId)));setDeleting(null);setSelection(null);}
  function insertAbove(){
    const ids=selectedRowIds(),first=ids[0]||selection?.focusCell.rowId,index=rows.findIndex(row=>row._gridId===first),count=Math.max(1,ids.length);
    if(!canAdd||rows.length+count>maxRows)return;
    const added=Array.from({length:count},emptyLine);added.forEach(row=>forcedVisible.current.add(row._gridId));
    const at=index<0?rows.length:index;change([...rows.slice(0,at),...added,...rows.slice(at)]);
    setSelection({anchorCell:{rowId:added[0]._gridId,columnKey:selectionColumns[0]},focusCell:{rowId:added.at(-1)._gridId,columnKey:selectionColumns.at(-1)}});
    focusCell({rowId:added[0]._gridId,columnKey:'description'},Math.max(0,displayRows.findIndex(row=>row._gridId===first)));setContextMenu(null);
  }
  function cutFromMenu(){let text='';copySelection({type:'cut',target:grid.current,clipboardData:{setData:(_type,value)=>{text=value;}},preventDefault(){}});
    if(text)navigator.clipboard?.writeText(text).catch(()=>{});setContextMenu(null);}
  function openContext(event){
    if(!editable||event.target.matches('[data-cell-editor]'))return;
    const point=pointFrom(event.target),row=event.target.closest('tr[data-grid-row]');if(!row)return;
    event.preventDefault();finishEditing();const bounds=range(),index=displayRows.findIndex(item=>item._gridId===row.dataset.gridRow);
    if(!bounds||index<bounds.rowStart||index>bounds.rowEnd)point?select(point,false):rowSelection(row.dataset.gridRow,false);
    setContextMenu({left:Math.max(8,Math.min(event.clientX,window.innerWidth-275)),top:Math.max(8,Math.min(event.clientY,window.innerHeight-320))});
  }
  const closeFilter=useCallback(()=>setColumnMenu(null),[]);
  const filterValues=columnMenu?[...new Set(rows.map(row=>String(cellValue(row,columnMenu.key,locationMap)??'')))].sort((a,b)=>a.localeCompare(b,locale,{numeric:true})).map(value=>({value,label:cellChoices(GRID_COLUMNS.find(col=>col.key===columnMenu.key)?.kind,t)?.find(choice=>choice.key===value)?.label??value})):[];

  const selectedRange = range();
  const selectedValues=useMemo(()=>selectedRange?displayRows.slice(selectedRange.rowStart,selectedRange.rowEnd+1).filter(row=>row!==additionRow.current)
    .flatMap(row=>selectionColumns.slice(selectedRange.colStart,selectedRange.colEnd+1).map(key=>cellValue(row,key,locationMap))):[],[displayRows,selection,columns,locationMap]);
  const cutMap=useMemo(()=>{const result=new Map();for(const cell of clipboard.current?.kind==='cut'?clipboard.current.cells:[]){const keys=result.get(cell.id)||new Set();keys.add(cell.key);result.set(cell.id,keys);}return result;},[clipboardTick]);
  const tableWidth=72+columns.reduce((sum,col)=>sum+(widths[col.key]||col.width||105),0);
  const menuSource = rows.find((row) => row._gridId === rowMenu);
  return <section className={`pc-grid-section${fullScreen ? " pc-grid-fullscreen" : ""}`} data-history={historyTick}
    onKeyDown={(event) => { if(event.key==='Escape'&&contextMenu){event.preventDefault();setContextMenu(null);}
      else if (event.key === "Escape" && fullScreen && !event.defaultPrevented) toggleFullScreen(); }}>
    <div className="pc-toolbar pc-grid-toolbar">
      <h3>{t("بنود الأعمال", "Work rows")}</h3>
      <button type="button" aria-pressed={fullReadView} onClick={() => { setFullReadView(!fullReadView); setSuggestionCell(null); }}>
        {fullReadView ? t("عرض مختصر", "Compact view") : t("جميع الأعمدة", "All columns")}
      </button>
      <button type="button" aria-pressed={fullScreen} onClick={toggleFullScreen}>
        {fullScreen ? <Minimize2 size={17}/> : <Maximize2 size={17}/>}
        {fullScreen ? t("إنهاء ملء الشاشة","Exit full screen") : t("ملء الشاشة","Full screen")}
      </button>
      {!readOnly && <>
        <button type="button" onClick={addRow} disabled={!canAdd}><Plus size={16} />{t("بند", "Add row")}</button>
        <button type="button" disabled={!editable||!selectedRowIds().length} onClick={()=>askDelete()}>{t('حذف الصفوف','Delete rows')}</button>
        <button type="button" title={t("تراجع", "Undo")} aria-label={t("تراجع", "Undo")} disabled={!editable || !history.current.past.length} onClick={() => historyMove("past")}><Undo2 size={17} /></button>
        <button type="button" title={t("إعادة", "Redo")} aria-label={t("إعادة", "Redo")} disabled={!editable || !history.current.future.length} onClick={() => historyMove("future")}><Redo2 size={17} /></button>
        {navigator.clipboard?.readText && <button type="button" title={t("لصق", "Paste")} aria-label={t("لصق", "Paste")} disabled={!editable || !selection} onClick={() => navigator.clipboard.readText().then((value) => paste(value, selection.focusCell)).catch(() => {})}><Clipboard size={17} /></button>}
      </>}
      <button type="button" onClick={()=>setSearchOpen(true)}><Search size={16}/>{t('بحث في الجدول','Find in table')} <kbd>Ctrl+F</kbd></button>
      <select aria-label={t("ترتيب العرض", "Display order")} value={sortedView ? sortBy : ""} onChange={(event) => { setSortBy(event.target.value); setSortedView(Boolean(event.target.value)); setPage(0); }}>
        <option value="">{t("ترتيب الإدخال", "Entry order")}</option><option value="work_type">{t("نوع الأعمال", "Work type")}</option><option value="description">{t("الوصف", "Description")}</option><option value="work_item">{t("رمز البند", "Item code")}</option>
      </select>
    </div>
    {sortedView && !readOnly && <div className="pc-toolbar pc-grid-sort-note"><span>{t("العرض مرتب مؤقتًا.", "This view is sorted temporarily.")}</span><button type="button" onClick={() => { change(reorderVisibleRows(rows,viewRows)); setSortedView(false); }}>{t("اعتماد الترتيب", "Keep this order")}</button></div>}
    {!!Object.keys(filters).length&&<div className="pc-toolbar"><span>{t('الصفوف الظاهرة','Visible rows')}: <bdi>{viewRows.length} / {rows.length}</bdi></span>
      <button type="button" onClick={()=>{setFilters({});setPage(0);setSelection(null);forcedVisible.current.clear();}}>{t('إزالة كل التصفيات','Clear all filters')}</button></div>}
    {message && <p className="pc-problem" role="status">{message}</p>}
    <div ref={grid} className="pc-grid-scroll" tabIndex={0} aria-label={t("جدول بنود المستخلص", "Certificate work grid")}
      onKeyDown={onKeyDown}
      onScroll={(event) => {
        if (fullScreen) setViewport({top:event.currentTarget.scrollTop,height:event.currentTarget.clientHeight});
        if (suggestionCell) setSuggestionCell(null);
      }}
      onPointerDown={onCellPointerDown}
      onPointerMove={extendPointerSelection}
      onContextMenu={openContext}
      onClick={(event) => {
        if (event.nativeEvent.pointerType !== "touch") return;
        const point = pointFrom(event.target);
        if (point && !editing.current) select(point,false);
      }}
      onDoubleClick={(event) => {
        if (!pointerSelection.current?.moved && !editing.current) beginEditing(pointFrom(event.target));
      }}
      onFocus={(event) => showSuggestions(event.target)}
      onBlur={(event) => {
        if (event.target.matches('[data-cell-editor]')) finishEditing();
      }}
      onCopy={copySelection}
      onCut={event=>{if(editable)copySelection(event);}}
      onPaste={(event) => {
        const {rowSelector} = event.target.dataset;
        const value = event.clipboardData.getData("text/plain");
        const point = pointFrom(event.target) || (rowSelector ? {rowId:rowSelector,columnKey:editableColumns[0]} : selection?.focusCell);
        if (editable && gridKeys.includes(point?.columnKey) && (!editing.current || /[\t\r\n]/.test(value))) {
          if (editing.current) finishEditing({commit:false,restore:true});
          if (paste(value,point)) event.preventDefault();
        }
      }}>
      <table className="pc-grid" role="grid" style={{width:tableWidth,minWidth:tableWidth,maxWidth:tableWidth}} aria-multiselectable="true" aria-rowcount={displayRows.length + 1}>
        <colgroup><col style={{width:72}} />{columns.map(({ key, width }) => <col key={key} style={{ width:widths[key] || width || 105 }} />)}</colgroup>
        <thead><tr><th scope="col" className="pc-grid-index">#</th>{columns.map(({key,label,width}) => <th scope="col" key={key}>{t(...label)}
          <button type="button" className={`pc-grid-filter${filters[key]?' active':''}`} aria-label={t('تصفية ','Filter ')+t(...label)} onClick={event=>{
            const rect=event.currentTarget.getBoundingClientRect();finishEditing();setColumnMenu({key,left:Math.max(8,Math.min(rect.left,window.innerWidth-340)),top:Math.max(8,Math.min(rect.bottom,window.innerHeight-470))});
          }}><Filter size={12}/></button>
          <button type="button" className="pc-grid-resizer" aria-label={`${t("تغيير عرض العمود","Resize column")} ${t(...label)}`}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              resizing.current = {key,pointerId:event.pointerId,x:event.clientX,width:widths[key] || width || 105};
            }}
            onPointerMove={(event) => {
              const drag = resizing.current;
              if (!drag || drag.pointerId !== event.pointerId || drag.key !== key) return;
              const change = (event.clientX-drag.x)*(locale === "ar" ? -1 : 1);
              const next = Math.max(68,Math.min(1200,drag.width+change));
              setWidths((current) => ({...current,[key]:next}));
            }}
            onLostPointerCapture={(event) => {
              if (resizing.current?.pointerId === event.pointerId) resizing.current = null;
            }}
            onKeyDown={(event) => {
              if (!["ArrowLeft","ArrowRight"].includes(event.key)) return;
              event.preventDefault();
              const delta = (event.key === "ArrowRight" ? 12 : -12)*(locale === "ar" ? -1 : 1);
              setWidths((current) => ({...current,[key]:Math.max(68,Math.min(1200,(current[key] || width || 105)+delta))}));
            }} />
        </th>)}</tr></thead>
        <tbody>
        {fullScreen && start > 0 && <tr className="pc-grid-spacer" aria-hidden="true"><td colSpan={columns.length+1} style={{height:offsets[start]}} /></tr>}
        {visible.map((row, index) => {
          const absolute = start + index;
          const selected = selectedRange && absolute >= selectedRange.rowStart && absolute <= selectedRange.rowEnd
            ? selectionColumns.slice(selectedRange.colStart, selectedRange.colEnd + 1) : null;
          return <WorkRow key={row._gridId} row={row} rowIndex={absolute} columns={columns} t={t} readOnly={!editable} locations={locationMap}
            editor={editor?.rowId === row._gridId ? editor : null}
            focus={selection?.focusCell.rowId === row._gridId ? selection.focusCell.columnKey : null}
            onInput={updateEditor} onSelectRow={rowSelection} onMenu={setRowMenu} selected={selected} cutKeys={cutMap.get(row._gridId)} error={errors.has(String(row.id)) || errors.has(String(row.identity))}
            locale={locale} addition={canAdd && row === additionRow.current} query={searchOpen?search:''}
            currentSearchColumn={searchOpen&&currentMatch?.rowId===row._gridId?currentMatch.columnKey:null}/>;
        })}
        {fullScreen && end < displayRows.length && <tr className="pc-grid-spacer" aria-hidden="true"><td colSpan={columns.length+1} style={{height:offsets.at(-1)-offsets[end]}} /></tr>}
        </tbody>
      </table>
      {!displayRows.length && <p className="pc-grid-empty">{t("لا توجد بنود بعد.", "No work rows yet.")}</p>}
    </div>
    <SelectionStatus values={selectedValues} uiLanguage={locale}/>
    {searchOpen&&<TableSearchPanel initialQuery={search} results={matches} currentIndex={matchIndex} columnLabel={key=>t(...GRID_COLUMNS.find(col=>col.key===key).label)}
      ownerRef={grid} onReplace={editable?(query,replacement,match)=>replaceSearch(query,replacement,match):undefined} onReplaceAll={editable?replaceSearch:undefined}
      onSearchChange={setSearch} onClose={()=>{setSearchOpen(false);if(selection?.focusCell)focusCell(selection.focusCell);}} onPrevious={()=>moveMatch(-1)} onNext={()=>moveMatch(1)} onJump={(_match,index)=>moveMatch(0,index)} uiLanguage={locale}/>}
    {columnMenu&&<ColumnFilter column={t(...GRID_COLUMNS.find(col=>col.key===columnMenu.key).label)} values={filterValues} selected={filters[columnMenu.key]}
      t={t} position={{left:columnMenu.left,top:columnMenu.top}} onClose={closeFilter} onApply={values=>{
        setFilters(previous=>{const next={...previous};if(values)next[columnMenu.key]=values;else delete next[columnMenu.key];return next;});
        forcedVisible.current.clear();setColumnMenu(null);setSelection(null);setPage(0);if(grid.current)grid.current.scrollTop=0;
      }}/>}
    {contextMenu&&createPortal(<section ref={contextRoot} className="pc-grid-context-menu" role="menu" aria-label={t('إجراءات التحديد','Selection actions')}
      style={contextMenu} dir={locale==='ar'?'rtl':'ltr'} onKeyDown={event=>{if(event.key==='Escape')setContextMenu(null);}}>
      <button type="button" role="menuitem" className="danger" onClick={()=>askDelete()}>{t('حذف الصفوف المحددة','Delete selected rows')} <bdi>({selectedRowIds().length})</bdi></button>
      {clipboard.current?.kind==='cut'&&<button type="button" role="menuitem" onClick={()=>{paste(clipboard.current.text,selection?.focusCell);setContextMenu(null);}}>{t('لصق الخلايا المقصوصة','Paste cut cells')}</button>}
      <button type="button" role="menuitem" onClick={cutFromMenu}>{t('قص النطاق','Cut range')}</button>
      <button type="button" role="menuitem" disabled={!canAdd} onClick={insertAbove}>{t('إدراج أعلى التحديد','Insert above selection')} <bdi>({Math.max(1,selectedRowIds().length)})</bdi></button>
      <button type="button" role="menuitem" onClick={()=>setContextMenu(null)}>{t('إلغاء','Cancel')}</button>
    </section>,document.body)}
    {deleting&&<Dialog title={t('حذف الصفوف المحددة','Delete selected rows')} onClose={()=>setDeleting(null)} t={t}>
      <p>{t(`حذف ${deleting.length} من الصفوف المحددة بالكامل؟`,`Delete ${deleting.length} selected rows completely?`)}</p>
      <div className="pc-toolbar"><button type="button" className="danger" onClick={deleteSelected}>{t('تأكيد الحذف','Confirm deletion')}</button>
        <button type="button" onClick={()=>setDeleting(null)}>{t('إلغاء','Cancel')}</button></div></Dialog>}
    {suggestionCell && suggestionsForCell.length > 0 && <div className="pc-grid-suggestions" role="listbox"
      style={{width:suggestionCell.width,left:suggestionCell.left,top:suggestionCell.top,bottom:suggestionCell.bottom}}>
      {suggestionsForCell.map(({key,label},index) => <div role="option" key={key} aria-selected={suggestionIndex === index} dir="auto"
        onMouseDown={(event) => event.preventDefault()} onClick={() => finishEditing({value:key,restore:true})}>{label}</div>)}
    </div>}
    <div className="pc-grid-footer">
      {fullScreen ? <span><bdi>{rows.length}</bdi> {t("صفوف","rows")}</span> : <div className="pc-pagination">
        <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t("السابق", "Previous")}</button>
        <span><bdi>{displayRows.length ? start + 1 : 0}–{Math.min(start + pageSize,displayRows.length)} / {displayRows.length}</bdi></span>
        <button type="button" disabled={start + pageSize >= displayRows.length} onClick={() => setPage(currentPage + 1)}>{t("التالي", "Next")}</button>
      </div>}
      <div><strong>{t("إجمالي أعمال الفترة", "Current work subtotal")}</strong> <Money value={settled ? totals?.current : null} locale={locale} currency={currency} />{!settled && <small>{t(" يتحدث عند الحفظ", " Updates on save")}</small>}</div>
    </div>
    {menuSource && <Dialog title={t("خيارات البند", "Work row options")} onClose={() => setRowMenu(null)} t={t}>
      {operationItems.length>0&&<Field label={t("ربط ببند من عمليات المشروع","Link operational item")}>
        <select value={menuSource.ops_item_id || ""} onChange={(event)=>{
          edit(rowMenu,"ops_item_id",event.target.value||null);
          setRowMenu(null);
        }}>
          <option value="">—</option>{operationItems.map(({id,code,description})=><option key={id} value={id}>{code} · {description}</option>)}
        </select>
      </Field>}
      {workItems.length > 0 && <Field label={t("ربط ببند معتمد", "Link approved work item")}><select defaultValue="" onChange={(event) => {
        const item = workItems.find((value) => String(value.id) === event.target.value);
        if (item) {
          edit(rowMenu, "work_item", item.work_item || item.code || item.name, { work_item_id: item.id, work_type: item.work_type || menuSource.work_type, description: item.description || menuSource.description, unit: item.unit || menuSource.unit, rate: item.rate ?? menuSource.rate });
          setRowMenu(null);
        }
      }}><option value="">—</option>{workItems.map((item) => <option key={item.id} value={item.id}>{item.work_item || item.code || item.name} {item.description}</option>)}</select></Field>}
      {menuSource.mode === "adjustment" && rows.some((row) => row.carried_forward) && <Field label={t("البند المعتمد سابقًا", "Previously certified work")}><select value={menuSource.identity || ""} onChange={(event) => {
        const prior = rows.find((candidate) => candidate.carried_forward && candidate.identity === event.target.value);
        if (prior) edit(rowMenu, "identity", prior.identity, { work_type:prior.work_type, work_item:prior.work_item,
          description:prior.description, location_id:prior.location_id, building_unit:cellValue(prior,"building_unit",locationMap),
          floor_apartment:cellValue(prior,"floor_apartment",locationMap) });
      }}><option value="">—</option>{rows.filter((row) => row.carried_forward).map((row) => <option key={row._gridId} value={row.identity}>{row.description || row.work_item}</option>)}</select></Field>}
      {["area", "linear"].includes(menuSource.mode) && <div className="pc-form">
        <Field label={t("الكمية الهندسية", "Geometric quantity")}><bdi>{menuSource.geometric_quantity ?? "—"}</bdi></Field>
        <Field label={t("الكمية المحتسبة", "Billed quantity")}><bdi>{menuSource.billed_quantity ?? "—"}</bdi></Field>
        <Field label={t("تجاوز الكمية المحتسبة", "Billed quantity override")}><input inputMode="decimal" dir="ltr" value={menuSource.override_quantity ?? ""} onChange={(event) => edit(rowMenu, "override_quantity", event.target.value)} /></Field>
        <Field label={t("سبب التجاوز", "Override reason")}><input dir="auto" value={menuSource.reason || ""} onChange={(event) => edit(rowMenu, "reason", event.target.value)} /></Field>
      </div>}
      <div className="pc-toolbar">
        <button type="button" onClick={() => rowAction("up")}><ArrowUp size={16} />{t("تحريك لأعلى", "Move up")}</button>
        <button type="button" onClick={() => rowAction("down")}><ArrowDown size={16} />{t("تحريك لأسفل", "Move down")}</button>
        <button type="button" onClick={() => rowAction("above")}>{t("إدراج أعلى", "Insert above")}</button>
        <button type="button" onClick={() => rowAction("below")}>{t("إدراج أسفل", "Insert below")}</button>
        <button type="button" onClick={() => rowAction("copy")}>{t("تكرار", "Repeat row")}</button>
        <button type="button" className="danger" onClick={() => rowAction("delete")}>{t("حذف البند", "Delete row")}</button>
      </div>
    </Dialog>}
  </section>;
}
