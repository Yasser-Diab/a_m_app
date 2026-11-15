import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Clipboard, Ellipsis, Maximize2, Minimize2, Plus, Redo2, Search, Undo2 } from "lucide-react";
import { applySmartClipboardGridToRows, fillSmartSelectionDownRows, findSmartCtrlArrowDestination, findSmartTableMatches, insertSmartRowRelative, isSmartFillDownShortcut, parseSmartClipboardGrid, removeSmartRowById, smartSelectionAfterNavigation } from "../smart-table-clipboard.mjs";
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
  return rows.map((row) => ({ ...row, _gridId: String(row.identity || row.id || newKey()) }));
}

export function stripGridFields(rows) {
  return rows.map(({ _gridId, _touched, ...row }) => row);
}

function applies(row, column) { return !column.modes || column.modes.includes(row.mode || "direct"); }

function localizedMode(value) {
  const key = searchText(value);
  return Object.keys(modes).find((mode) => key === mode || modes[mode].some((name) => searchText(name) === key)) || value;
}

function cellValue(row,key,locations) {
  if (key !== "building_unit" && key !== "floor_apartment") return row[key];
  if (Object.hasOwn(row,key)) return row[key];
  const place = row.location || locations.get(String(row.location_id))?.label || "";
  const parts = place.split(/\s*[›/]\s*/).filter(Boolean);
  return key === "building_unit" ? parts[0] || "" : parts.length > 1 ? parts.at(-1) : "";
}

const WorkRow = memo(function WorkRow({ row, rowIndex, columns, t, readOnly, locations, onEdit, onSelectRow, onMenu, selected, error, locale, addition }) {
  const rowLabel = rowIndex + 1;
  return <tr aria-rowindex={rowIndex + 2} className={addition ? "pc-grid-addition" : error ? "pc-row-invalid" : undefined}>
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
      const coord = { "data-row-id": row._gridId, "data-column": key, "aria-label": label };
      let content = null;
      if (kind === "money") content = <Money value={row[key]} locale={locale} />;
      else if (kind === "computedPercent") {
        const percent = Object.hasOwn(row, key) ? value : key === "current_progress" && !row.carried_forward ? row.progress : null;
        content = percent == null || percent === "" ? "—" : <bdi>{numberText(percent)}%</bdi>;
      }
      else if (applicable && readOnly) content = <bdi>{kind === "mode" && modes[value] ? t(...modes[value]) :
          key === "progress" ? `${numberText(value ?? 100)}%` : kind === "number" ? numberText(value ?? "") : value ?? ""}</bdi>;
      else if (applicable && kind === "mode") content = <select {...coord} value={row[key] || "direct"} onChange={(event) => onEdit(row._gridId, key, event.target.value)}>
        {Object.entries(modes).map(([mode, name]) => <option key={mode} value={mode}>{t(...name)}</option>)}
      </select>;
      else if (applicable && kind === "recognition") content = <select {...coord} value={row[key] || "incremental"} onChange={(event) => onEdit(row._gridId, key, event.target.value)}>
        <option value="incremental">{t("عن الفترة", "This period")}</option><option value="cumulative">{t("تراكمي", "Cumulative")}</option>
      </select>;
      else if (applicable && kind === "dimension") content = <select {...coord} dir="ltr" value={row[key] || ""} onChange={(event) => onEdit(row._gridId, key, event.target.value)}>
        <option value="">—</option><option value="mm">mm</option><option value="cm">cm</option><option value="m">m</option>
      </select>;
      else if (applicable) content = <input {...coord} autoComplete="off" inputMode={kind === "number" ? "decimal" : undefined}
        dir={kind === "number" ? "ltr" : "auto"} value={value ?? ""}
        aria-autocomplete={suggestionKeys.has(key) ? "list" : undefined}
        placeholder={key === "progress" && (row.mode !== "lump" || !row.claim_amount) ? "100" : undefined}
        onChange={(event) => onEdit(row._gridId, key, event.target.value)} />;
      return <td key={key} className={`${applicable ? "" : "pc-grid-off"} ${selected?.includes(key) ? "pc-grid-selected" : ""}`}>{content}</td>;
    })}
  </tr>;
});

export default function CertificateGrid({ rows, onChange, readOnly, t, locale, locations = [], suggestions = [], workItems = [], workTypes = [], validation = [], totals, currency, settled }) {
  const grid = useRef(null);
  const currentRows = useRef(rows);
  const additionRow = useRef(null);
  if (!additionRow.current) additionRow.current = emptyLine();
  const nextFocus = useRef(null);
  const resizing = useRef(null);
  const history = useRef({ past: [], future: [] });
  const [historyTick, setHistoryTick] = useState(0);
  const [page, setPage] = useState(0);
  const [selection, setSelection] = useState(null);
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
  const compactColumns = useMemo(() => GRID_COLUMNS.filter((column) => {
    const {key,modes} = column;
    if (["building_unit","floor_apartment","work_type","description","quantity","unit","rate","previous_progress","current_progress","previous","current","cumulative"].includes(key)) return true;
    if (["mode","progress"].includes(key)) return !readOnly;
    if (key === "recognition") return !readOnly;
    return modes ? rows.some((row) => modes.includes(row.mode)) : rows.some((row) => row[key] != null && row[key] !== "");
  }), [readOnly,rows]);
  const columns = fullReadView ? GRID_COLUMNS : compactColumns;
  const editableColumns = columns.filter(({key}) => gridKeys.includes(key)).map(({key}) => key);
  const locationMap = useMemo(() => new Map(locations.map((location) => [String(location.id), location])), [locations]);
  const editable = !readOnly && !sortedView;
  const canAdd = editable && rows.filter((row) => !row.carried_forward).length < maxRows;
  const displayRows = sortedView ? [...rows].sort((a,b) =>
    String(cellValue(a,sortBy,locationMap) || "").localeCompare(String(cellValue(b,sortBy,locationMap) || ""),locale,{numeric:true})) :
    canAdd ? [...rows,additionRow.current] : rows;
  const currentPage = Math.min(page, Math.max(0, Math.ceil(displayRows.length / pageSize) - 1));
  const start = fullScreen ? Math.min(Math.max(0,displayRows.length-1),Math.max(0,Math.floor(viewport.top / virtualHeight)-8)) : currentPage * pageSize;
  const end = fullScreen ? Math.min(displayRows.length,Math.max(start+1,Math.ceil((viewport.top + viewport.height)/virtualHeight)+8)) : start + pageSize;
  const visible = displayRows.slice(start,end);
  const matches = useMemo(() => findSmartTableMatches({ rows: displayRows, columnOrder: gridKeys, searchText: search }), [displayRows, search]);
  const errors = useMemo(() => new Set(validation.map((item) => String(item.line_id || item.id || ""))), [validation]);
  useLayoutEffect(() => { currentRows.current = rows; }, [rows]);

  useLayoutEffect(() => {
    const target = grid.current;
    if (!fullScreen || !target) return;
    function measure() { setViewport({top:target.scrollTop,height:target.clientHeight}); }
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    target.scrollTop = currentPage * pageSize * virtualHeight;
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
    const target = grid.current?.querySelector(`[data-row-id="${CSS.escape(point.rowId)}"][data-column="${CSS.escape(point.columnKey)}"]`);
    if (!target) return;
    target.focus(); target.select?.(); nextFocus.current = null;
  }
  useLayoutEffect(focusPending);

  function focusCell(point,hint) {
    if (!point) return;
    const rowIndex = hint ?? displayRows.findIndex((row) => row._gridId === point.rowId);
    if (rowIndex < 0) return;
    nextFocus.current = point;
    if (fullScreen && grid.current) {
      const targetTop = rowIndex * virtualHeight;
      const {scrollTop,clientHeight} = grid.current;
      if (targetTop < scrollTop || targetTop + virtualHeight * 2 > scrollTop + clientHeight) grid.current.scrollTop = Math.max(0,targetTop-virtualHeight);
      setViewport({top:grid.current.scrollTop,height:clientHeight});
    } else setPage(Math.floor(rowIndex / pageSize));
    requestAnimationFrame(focusPending);
  }

  const change = useCallback((next) => {
    history.current.past = [...history.current.past.slice(-39), currentRows.current];
    history.current.future = [];
    setHistoryTick((value) => value + 1);
    onChange(next);
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

  function range() {
    if (!selection) return null;
    const rowIndex = (point) => displayRows.findIndex((row) => row._gridId === point.rowId);
    const indexes = [rowIndex(selection.anchorCell), rowIndex(selection.focusCell)];
    const keys = [editableColumns.indexOf(selection.anchorCell.columnKey), editableColumns.indexOf(selection.focusCell.columnKey)];
    if ([...indexes,...keys].includes(-1)) return null;
    return { rowStart: Math.min(...indexes), rowEnd: Math.max(...indexes), colStart: Math.min(...keys), colEnd: Math.max(...keys) };
  }

  function paste(clipboard, point) {
    const data = parseSmartClipboardGrid(clipboard);
    const entryRows = rows.filter((row) => !row.carried_forward);
    const intoAddition = point?.rowId === additionRow.current._gridId;
    const index = intoAddition ? entryRows.length : entryRows.findIndex((item) => item._gridId === point?.rowId);
    if (index < 0 || !data.length) return false;
    if (index + data.length > maxRows) {
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
    const edited = new Map(next.rows.map((row) => [row._gridId,row]));
    const priorIds = new Set(rows.map((row) => row._gridId));
    change([...rows.map((row) => edited.get(row._gridId) || row), ...next.rows.filter((row) => !priorIds.has(row._gridId))]);
    if (intoAddition) focusCell(point,rows.length);
    setMessage(""); setSuggestionCell(null);
    return true;
  }

  function rowSelection(id,extend) {
    const first = {rowId:id,columnKey:editableColumns[0]};
    const last = {rowId:id,columnKey:editableColumns.at(-1)};
    setSelection((current) => ({anchorCell:extend && current?.anchorCell ? current.anchorCell : first,focusCell:last}));
  }

  function copySelection(event) {
    const bounds = range();
    if (!bounds || (bounds.rowStart === bounds.rowEnd && bounds.colStart === bounds.colEnd)) return;
    const keys = editableColumns.slice(bounds.colStart,bounds.colEnd+1);
    const text = displayRows.slice(bounds.rowStart,bounds.rowEnd+1).filter((row) => row !== additionRow.current)
      .map((row) => keys.map((key) => String(cellValue(row,key,locationMap) ?? "").replace(/[\t\r\n]+/g," ")).join("\t")).join("\n");
    if (!text) return;
    event.clipboardData.setData("text/plain",text);
    event.preventDefault();
  }

  const suggestionRow = suggestionCell && displayRows.find((row) => row._gridId === suggestionCell.rowId);
  const suggestionsForCell = !editable || !suggestionRow ? [] : (() => {
    const key = suggestionCell.columnKey;
    const typed = searchText(cellValue(suggestionRow,key,locationMap));
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
    }).slice(0,12);
  })();

  function showSuggestions(target) {
    const {rowId,column} = target.dataset;
    if (!editable || !rowId || !suggestionKeys.has(column)) return setSuggestionCell(null);
    const box = target.getBoundingClientRect();
    const width = Math.min(Math.max(box.width,165),window.innerWidth-20);
    const left = Math.max(10,Math.min(locale === "ar" ? box.right-width : box.left,window.innerWidth-width-10));
    const above = window.innerHeight-box.bottom < 220 && box.top > 230;
    setSuggestionIndex(-1);
    setSuggestionCell({rowId,columnKey:column,width,left,...(above ? {bottom:window.innerHeight-box.top+4} : {top:box.bottom+4})});
  }

  function pickSuggestion(value) {
    if (!suggestionCell) return;
    edit(suggestionCell.rowId,suggestionCell.columnKey,value);
    setSuggestionCell(null);
  }

  function onKeyDown(event) {
    if (!editable || event.defaultPrevented || event.nativeEvent.isComposing) return;
    const { rowId, column } = event.target.dataset;
    if (event.key === "Enter" && event.target.dataset.rowSelector) {
      event.preventDefault();
      const id = event.target.dataset.rowSelector;
      const index = displayRows.findIndex((row) => row._gridId === id);
      const next = displayRows[index] === additionRow.current ? displayRows[index] :
        displayRows.slice(index+1).find((row) => !row.carried_forward);
      if (next) focusCell({rowId:next._gridId,columnKey:editableColumns[0]});
      return;
    }
    if (!rowId || !column) return;
    const physical = event.code;
    const control = event.ctrlKey || event.metaKey;
    if (event.key === "Escape" && suggestionsForCell.length) {
      event.preventDefault(); event.stopPropagation(); setSuggestionCell(null); return;
    }
    if (suggestionsForCell.length && !control && !event.shiftKey) {
      if (["ArrowUp","ArrowDown"].includes(event.key)) {
        event.preventDefault();
        const count = suggestionsForCell.length;
        setSuggestionIndex((index) => index < 0 ? (event.key === "ArrowUp" ? count-1 : 0) :
          (index+(event.key === "ArrowUp" ? -1 : 1)+count)%count);
        return;
      }
      if (event.key === "Enter" && suggestionIndex >= 0 && suggestionsForCell[suggestionIndex] != null) {
        event.preventDefault(); pickSuggestion(suggestionsForCell[suggestionIndex]); return;
      }
    }
    if (control && (physical === "KeyZ" || physical === "KeyY")) {
      event.preventDefault(); historyMove(event.shiftKey || physical === "KeyY" ? "future" : "past"); return;
    }
    if (isSmartFillDownShortcut(event)) {
      const next = rows.some((row) => row.carried_forward) ? null :
        fillSmartSelectionDownRows({ rows, range: range(), columnOrder: editableColumns, createRow: emptyLine });
      if (next) { event.preventDefault(); change(next); }
      return;
    }
    const rowIndex = displayRows.findIndex((row) => row._gridId === rowId);
    const columnIndex = editableColumns.indexOf(column);
    const key = event.key;
    if (control && key.startsWith("Arrow")) {
      const physicalKey = locale === "en" ? ({ ArrowLeft: "ArrowRight", ArrowRight: "ArrowLeft" }[key] || key) : key;
      const point = findSmartCtrlArrowDestination({ rows:displayRows, columnOrder:editableColumns, focusCell: { rowId, columnKey: column }, direction:physicalKey });
      if (point) { event.preventDefault(); select(point, event.shiftKey); focusCell(point); }
      return;
    }
    const horizontal = locale === "ar" ? -1 : 1;
    const deltas = { Enter: [event.shiftKey ? -1 : 1, 0], ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -horizontal], ArrowRight: [0, horizontal] };
    const delta = deltas[key];
    if (!delta || (key.startsWith("Arrow") && delta[1] && !event.shiftKey) || (key === "Enter" && event.target.tagName !== "INPUT")) return;
    if (key === "Enter") event.preventDefault();
    let targetIndex = rowIndex + delta[0];
    while (delta[0] && displayRows[targetIndex]?.carried_forward) targetIndex += delta[0];
    const next = displayRows[targetIndex];
    const target = editableColumns[columnIndex + delta[1]];
    const targetColumn = GRID_COLUMNS.find((item) => item.key === target && next && applies(next,item)) ||
      (key === "Enter" && next ? columns.find((item) => gridKeys.includes(item.key) && applies(next,item)) : null);
    if (next && targetColumn) {
      event.preventDefault();
      const point = { rowId: next._gridId, columnKey: targetColumn.key };
      select(point, key !== "Enter" && event.shiftKey);
      focusCell(point);
    }
  }

  function addRow() {
    if (!canAdd) return;
    const row = additionRow.current;
    additionRow.current = emptyLine();
    change([...rows,row]);
    focusCell({rowId:row._gridId,columnKey:"description"},rows.length);
  }

  function toggleFullScreen() {
    if (fullScreen) {
      setPage(Math.floor(Math.max(0,Math.floor(viewport.top/virtualHeight))/pageSize));
      if (grid.current) grid.current.scrollTop = 0;
    }
    setSuggestionCell(null);
    setFullScreen(!fullScreen);
  }

  function moveMatch() {
    if (!matches.length) return;
    const match = matches[matchIndex % matches.length];
    setMatchIndex((value) => value + 1);
    select(match, false);
    focusCell(match);
  }

  function rowAction(action) {
    const index = rows.findIndex((row) => row._gridId === rowMenu);
    if (index < 0) return;
    if (action === "delete") change(removeSmartRowById(rows, rowMenu).rows);
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

  const selectedRange = range();
  const menuSource = rows.find((row) => row._gridId === rowMenu);
  return <section className={`pc-grid-section${fullScreen ? " pc-grid-fullscreen" : ""}`} data-history={historyTick}
    onKeyDown={(event) => { if (event.key === "Escape" && fullScreen && !event.defaultPrevented) toggleFullScreen(); }}>
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
        <button type="button" title={t("تراجع", "Undo")} aria-label={t("تراجع", "Undo")} disabled={!editable || !history.current.past.length} onClick={() => historyMove("past")}><Undo2 size={17} /></button>
        <button type="button" title={t("إعادة", "Redo")} aria-label={t("إعادة", "Redo")} disabled={!editable || !history.current.future.length} onClick={() => historyMove("future")}><Redo2 size={17} /></button>
        {navigator.clipboard?.readText && <button type="button" title={t("لصق", "Paste")} aria-label={t("لصق", "Paste")} disabled={!editable || !selection} onClick={() => navigator.clipboard.readText().then((value) => paste(value, selection.focusCell)).catch(() => {})}><Clipboard size={17} /></button>}
      </>}
      <div className="pc-grid-search"><input aria-label={t("البحث في البنود", "Search rows")} placeholder={t("بحث في البنود", "Search rows")} value={search} onChange={(event) => { setSearch(event.target.value); setMatchIndex(0); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); moveMatch(); } }} />
        <button type="button" aria-label={t("النتيجة التالية", "Next result")} disabled={!matches.length} onClick={moveMatch}><Search size={16} />{search && <bdi>{matches.length}</bdi>}</button></div>
      <select aria-label={t("ترتيب العرض", "Display order")} value={sortedView ? sortBy : ""} onChange={(event) => { setSortBy(event.target.value); setSortedView(Boolean(event.target.value)); setPage(0); }}>
        <option value="">{t("ترتيب الإدخال", "Entry order")}</option><option value="work_type">{t("نوع الأعمال", "Work type")}</option><option value="description">{t("الوصف", "Description")}</option><option value="work_item">{t("رمز البند", "Item code")}</option>
      </select>
    </div>
    {sortedView && !readOnly && <div className="pc-toolbar pc-grid-sort-note"><span>{t("العرض مرتب مؤقتًا.", "This view is sorted temporarily.")}</span><button type="button" onClick={() => { change(displayRows); setSortedView(false); }}>{t("اعتماد الترتيب", "Keep this order")}</button></div>}
    {message && <p className="pc-problem" role="status">{message}</p>}
    <div ref={grid} className="pc-grid-scroll" tabIndex={0} aria-label={t("جدول بنود المستخلص", "Certificate work grid")}
      onKeyDown={onKeyDown}
      onScroll={(event) => {
        if (fullScreen) setViewport({top:event.currentTarget.scrollTop,height:event.currentTarget.clientHeight});
        if (suggestionCell) setSuggestionCell(null);
      }}
      onMouseDown={(event) => { const { rowId, column } = event.target.dataset; if (rowId && column) select({ rowId, columnKey: column }, event.shiftKey); }}
      onFocus={(event) => {
        const {rowId,column} = event.target.dataset;
        showSuggestions(event.target);
        if (rowId && column && !nextFocus.current && !event.nativeEvent.sourceCapabilities) select({rowId,columnKey:column},false);
      }}
      onBlur={() => setSuggestionCell(null)}
      onInput={(event) => showSuggestions(event.target)}
      onCopy={copySelection}
      onPaste={(event) => {
        const {rowId,column,rowSelector} = event.target.dataset;
        const value = event.clipboardData.getData("text/plain");
        const point = rowId ? {rowId,columnKey:column} : rowSelector ? {rowId:rowSelector,columnKey:editableColumns[0]} : selection?.anchorCell;
        if (editable && (/[\t\r\n]/.test(value) || rowSelector) && paste(value,point)) event.preventDefault();
      }}>
      <table className="pc-grid" aria-rowcount={displayRows.length + 1}>
        <colgroup><col style={{width:72}} />{columns.map(({ key, width }) => <col key={key} style={{ width:widths[key] || width || 105 }} />)}</colgroup>
        <thead><tr><th scope="col" className="pc-grid-index">#</th>{columns.map(({key,label,width}) => <th scope="col" key={key}>{t(...label)}
          <button type="button" className="pc-grid-resizer" aria-label={`${t("تغيير عرض العمود","Resize column")} ${t(...label)}`}
            onPointerDown={(event) => {
              event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
              resizing.current = {x:event.clientX,width:widths[key] || width || 105};
            }}
            onPointerMove={(event) => {
              if (!resizing.current) return;
              const change = (event.clientX-resizing.current.x)*(locale === "ar" ? -1 : 1);
              setWidths((current) => ({...current,[key]:Math.max(68,Math.min(650,resizing.current.width+change))}));
            }}
            onLostPointerCapture={() => { resizing.current = null; }}
            onKeyDown={(event) => {
              if (!["ArrowLeft","ArrowRight"].includes(event.key)) return;
              event.preventDefault();
              const delta = (event.key === "ArrowRight" ? 12 : -12)*(locale === "ar" ? -1 : 1);
              setWidths((current) => ({...current,[key]:Math.max(68,Math.min(650,(current[key] || width || 105)+delta))}));
            }} />
        </th>)}</tr></thead>
        <tbody>
        {fullScreen && start > 0 && <tr className="pc-grid-spacer" aria-hidden="true"><td colSpan={columns.length+1} style={{height:start*virtualHeight}} /></tr>}
        {visible.map((row, index) => {
          const absolute = start + index;
          const selected = !sortedView && selectedRange && absolute >= selectedRange.rowStart && absolute <= selectedRange.rowEnd
            ? editableColumns.slice(selectedRange.colStart, selectedRange.colEnd + 1) : null;
          return <WorkRow key={row._gridId} row={row} rowIndex={absolute} columns={columns} t={t} readOnly={!editable || row.carried_forward} locations={locationMap}
            onEdit={edit} onSelectRow={rowSelection} onMenu={setRowMenu} selected={selected} error={errors.has(String(row.id)) || errors.has(String(row.identity))}
            locale={locale} addition={canAdd && row === additionRow.current} />;
        })}
        {fullScreen && end < displayRows.length && <tr className="pc-grid-spacer" aria-hidden="true"><td colSpan={columns.length+1} style={{height:(displayRows.length-end)*virtualHeight}} /></tr>}
        </tbody>
      </table>
      {!displayRows.length && <p className="pc-grid-empty">{t("لا توجد بنود بعد.", "No work rows yet.")}</p>}
    </div>
    {suggestionCell && suggestionsForCell.length > 0 && <div className="pc-grid-suggestions" role="listbox"
      style={{width:suggestionCell.width,left:suggestionCell.left,top:suggestionCell.top,bottom:suggestionCell.bottom}}>
      {suggestionsForCell.map((value,index) => <div role="option" key={value} aria-selected={suggestionIndex === index} dir="auto"
        onMouseDown={(event) => event.preventDefault()} onClick={() => pickSuggestion(value)}>{value}</div>)}
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
