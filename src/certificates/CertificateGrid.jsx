import { memo, useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Clipboard, Plus, Redo2, Search, Undo2 } from "lucide-react";
import { applySmartClipboardGridToRows, fillSmartSelectionDownRows, findSmartCtrlArrowDestination, findSmartTableMatches, insertSmartRowRelative, isSmartFillDownShortcut, parseSmartClipboardGrid, removeSmartRowById, smartSelectionAfterNavigation } from "../smart-table-clipboard.mjs";
import { Combobox, Dialog, Field, Money, newKey, numberText, optionLabel, searchText } from "./shared.jsx";

export const GRID_COLUMNS = [
  { key: "location_id", label: ["الموقع", "Location"], kind: "location", width: 175 },
  { key: "work_type", label: ["نوع الأعمال", "Work type"], width: 145 },
  { key: "work_item", label: ["البند / الرمز", "Item / code"], width: 125 },
  { key: "description", label: ["الوصف", "Description"], width: 220 },
  { key: "mode", label: ["طريقة الإدخال", "Entry mode"], kind: "mode", width: 145 },
  { key: "width", label: ["العرض / الطول", "Width / length"], kind: "number", modes: ["area", "linear"] },
  { key: "height", label: ["الارتفاع", "Height"], kind: "number", modes: ["area"] },
  { key: "dimension_unit", label: ["وحدة الأبعاد", "Dimension unit"], kind: "dimension", modes: ["area", "linear"] },
  { key: "count", label: ["العدد", "Count"], kind: "number", modes: ["area", "linear", "count"] },
  { key: "quantity", label: ["الكمية", "Quantity"], kind: "number", modes: ["direct", "adjustment"] },
  { key: "unit", label: ["الوحدة", "Unit"], modes: ["area", "linear", "count", "direct", "adjustment"] },
  { key: "rate", label: ["السعر", "Rate"], kind: "number", modes: ["area", "linear", "count", "direct", "adjustment"] },
  { key: "agreed_amount", label: ["المبلغ المتفق عليه", "Agreed amount"], kind: "number", modes: ["lump"], width: 130 },
  { key: "recognition", label: ["أساس التقييم", "Recognition"], kind: "recognition", modes: ["area", "linear", "count", "direct", "lump"], width: 130 },
  { key: "progress", label: ["نسبة الإنجاز %", "Progress %"], kind: "number", modes: ["lump"] },
  { key: "claim_amount", label: ["المبلغ المطالب به", "Claim amount"], kind: "number", modes: ["lump"], width: 135 },
  { key: "adjustment_amount", label: ["قيمة التسوية", "Adjustment amount"], kind: "number", modes: ["adjustment"], width: 130 },
  { key: "reason", label: ["سبب التسوية", "Adjustment reason"], modes: ["adjustment"], width: 150 },
  { key: "note", label: ["ملاحظة للعميل", "Customer note"], width: 155 },
  { key: "previous", label: ["السابق", "Previous"], kind: "money" },
  { key: "current", label: ["الحالي", "Current"], kind: "money" },
  { key: "cumulative", label: ["التراكمي", "Cumulative"], kind: "money" },
];

const modes = {
  area: ["مساحة بالأبعاد", "Measured area"], linear: ["طول بالأبعاد", "Measured linear"],
  count: ["بالعدد", "Count"], direct: ["كمية مباشرة", "Direct quantity"],
  lump: ["مقطوعية", "Lump sum"], adjustment: ["تسوية معتمدة", "Approved adjustment"],
};
const gridKeys = GRID_COLUMNS.filter(({ kind }) => kind !== "money").map(({ key }) => key);
const pageSize = 36;

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

const WorkRow = memo(function WorkRow({ row, rowIndex, columns, t, readOnly, locations, onEdit, onLocation, onMenu, selected, error, locale, workTypeList }) {
  return <tr aria-rowindex={rowIndex + 2} className={error ? "pc-row-invalid" : undefined}>
    <th scope="row" className="pc-grid-index"><button type="button" onClick={() => onMenu(row._gridId)} disabled={readOnly} aria-label={`${t("خيارات البند", "Row actions")} ${rowIndex + 1}`}>{rowIndex + 1}</button></th>
    {columns.map((column) => {
      const { key, kind } = column;
      const applicable = applies(row, column);
      const label = `${t(...column.label)} · ${rowIndex + 1}`;
      const coord = { "data-row-id": row._gridId, "data-column": key, "aria-label": label };
      let content = null;
      if (kind === "money") content = <Money value={row[key]} locale={locale} />;
      else if (applicable && readOnly) content = <bdi>{kind === "mode" && modes[row[key]] ? t(...modes[row[key]]) : kind === "location" ? optionLabel(locations.get(String(row[key]))) || row.location || row.location_name || "—" : row[key] ?? ""}</bdi>;
      else if (applicable && kind === "location") content = <button className="pc-grid-location" type="button" {...coord} onClick={() => onLocation(row._gridId)}>
        {optionLabel(locations.get(String(row.location_id))) || row.location_name || t("على مستوى المشروع", "Project-wide")}
      </button>;
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
        list={key === "work_type" ? workTypeList : undefined} dir={kind === "number" ? "ltr" : "auto"} value={row[key] ?? ""} onChange={(event) => onEdit(row._gridId, key, event.target.value)} />;
      return <td key={key} className={`${applicable ? "" : "pc-grid-off"} ${selected?.includes(key) ? "pc-grid-selected" : ""}`}>{content}</td>;
    })}
  </tr>;
});

export default function CertificateGrid({ rows, onChange, readOnly, t, locale, locations = [], workItems = [], workTypes = [], canAddLocation, onAddLocation, validation = [], totals, currency, settled }) {
  const grid = useRef(null);
  const currentRows = useRef(rows);
  const workTypeList = useId();
  const nextFocus = useRef(null);
  const history = useRef({ past: [], future: [] });
  const [historyTick, setHistoryTick] = useState(0);
  const [page, setPage] = useState(0);
  const [selection, setSelection] = useState(null);
  const [search, setSearch] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [rowMenu, setRowMenu] = useState(null);
  const [locationRow, setLocationRow] = useState(null);
  const [sortBy, setSortBy] = useState("");
  const [sortedView, setSortedView] = useState(false);
  const locationMap = useMemo(() => new Map(locations.map((location) => [String(location.id), location])), [locations]);
  const locationByName = useMemo(() => {
    const result = new Map();
    for (const location of locations) for (const label of new Set([optionLabel(location), location.name, location.code].filter(Boolean))) {
      const key = searchText(label);
      if (!result.has(key)) result.set(key, location.id);
      else if (result.get(key) !== location.id) result.set(key, null);
    }
    return result;
  }, [locations]);
  const displayRows = useMemo(() => sortedView ? [...rows].sort((a, b) => String(a[sortBy] || "").localeCompare(String(b[sortBy] || ""), locale, { numeric: true })) : rows, [locale, rows, sortBy, sortedView]);
  const editable = !readOnly && !sortedView;
  const currentPage = Math.min(page, Math.max(0, Math.ceil(displayRows.length / pageSize) - 1));
  const start = currentPage * pageSize;
  const visible = displayRows.slice(start, start + pageSize);
  const matches = useMemo(() => findSmartTableMatches({ rows: displayRows, columnOrder: gridKeys, searchText: search }), [displayRows, search]);
  const errors = useMemo(() => new Set(validation.map((item) => String(item.line_id || item.id || ""))), [validation]);
  useLayoutEffect(() => { currentRows.current = rows; }, [rows]);

  function focusCell(point) {
    if (!point) return;
    const rowIndex = displayRows.findIndex((row) => row._gridId === point.rowId);
    if (rowIndex < 0) return;
    setPage(Math.floor(rowIndex / pageSize));
    nextFocus.current = point;
    requestAnimationFrame(() => {
      if (nextFocus.current !== point) return;
      const target = grid.current?.querySelector(`[data-row-id="${CSS.escape(point.rowId)}"][data-column="${CSS.escape(point.columnKey)}"]`);
      target?.focus();
      target?.select?.();
      if (target) nextFocus.current = null;
    });
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
    change(currentRows.current.map((row) => row._gridId === rowId ? { ...row, [key]: value, ...extra } : row));
  }, [change]);

  function select(point, extend) {
    setSelection((current) => smartSelectionAfterNavigation({ selection: current, destination: point, extendSelection: extend }));
  }

  function range() {
    if (!selection) return null;
    const rowIndex = (point) => rows.findIndex((row) => row._gridId === point.rowId);
    const indexes = [rowIndex(selection.anchorCell), rowIndex(selection.focusCell)];
    const keys = [gridKeys.indexOf(selection.anchorCell.columnKey), gridKeys.indexOf(selection.focusCell.columnKey)];
    return { rowStart: Math.min(...indexes), rowEnd: Math.max(...indexes), colStart: Math.min(...keys), colEnd: Math.max(...keys) };
  }

  function paste(clipboard, point) {
    const data = parseSmartClipboardGrid(clipboard);
    const index = rows.findIndex((item) => item._gridId === point?.rowId);
    if (index < 0 || !data.length) return false;
    const next = applySmartClipboardGridToRows({ rows, startRow: index, startKey: point.columnKey,
      columnOrder: gridKeys, grid: data, createRow: emptyLine, normalizeValue(value, key) {
        const kind = GRID_COLUMNS.find((column) => column.key === key)?.kind;
        if (key === "mode") return localizedMode(value);
        if (key === "location_id") return locationMap.has(String(value)) ? value : locationByName.get(searchText(value)) ?? "";
        return kind === "number" ? numberText(value) : value;
      } });
    if (!next) return false;
    if (next.startColumn === 0) {
      for (const [offset, pasted] of data.entries()) {
        const row = next.rows[index + offset];
        row.location_name = row.location_id ? "" : pasted[0];
      }
    }
    change(next.rows);
    return true;
  }

  function onKeyDown(event) {
    if (!editable) return;
    const { rowId, column } = event.target.dataset;
    if (!rowId || !column) return;
    const physical = event.code;
    const control = event.ctrlKey || event.metaKey;
    if (control && (physical === "KeyZ" || physical === "KeyY")) {
      event.preventDefault(); historyMove(event.shiftKey || physical === "KeyY" ? "future" : "past"); return;
    }
    if (isSmartFillDownShortcut(event)) {
      const next = fillSmartSelectionDownRows({ rows, range: range(), columnOrder: gridKeys, createRow: emptyLine });
      if (next) { event.preventDefault(); change(next); }
      return;
    }
    const rowIndex = rows.findIndex((row) => row._gridId === rowId);
    const columnIndex = gridKeys.indexOf(column);
    const key = event.key;
    if (control && key.startsWith("Arrow")) {
      const physicalKey = locale === "en" ? ({ ArrowLeft: "ArrowRight", ArrowRight: "ArrowLeft" }[key] || key) : key;
      const point = findSmartCtrlArrowDestination({ rows, columnOrder: gridKeys, focusCell: { rowId, columnKey: column }, direction: physicalKey });
      if (point) { event.preventDefault(); select(point, event.shiftKey); focusCell(point); }
      return;
    }
    const horizontal = locale === "ar" ? -1 : 1;
    const deltas = { Enter: [event.shiftKey ? -1 : 1, 0], ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -horizontal], ArrowRight: [0, horizontal] };
    const delta = deltas[key];
    if (!delta || (key.startsWith("Arrow") && !event.shiftKey) || (key === "Enter" && event.target.tagName !== "INPUT")) return;
    const next = rows[rowIndex + delta[0]];
    const target = gridKeys[columnIndex + delta[1]];
    const targetColumn = GRID_COLUMNS.find((item) => item.key === target);
    if (next && targetColumn && applies(next, targetColumn)) {
      event.preventDefault();
      const point = { rowId: next._gridId, columnKey: target };
      select(point, key !== "Enter" && event.shiftKey);
      focusCell(point);
    }
  }

  function addRow() {
    if (sortedView) setSortedView(false);
    change([...rows, emptyLine()]);
    setPage(Math.floor(rows.length / pageSize));
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
    else if (action === "above" || action === "below" || action === "copy") {
      const source = rows[index];
      change(insertSmartRowRelative({ rows, targetRowId: rowMenu, placement: action === "above" ? "above" : "below",
        createRow: action === "copy" ? () => ({ ...source, id: undefined, _gridId: newKey(), identity: newKey(), previous: undefined, current: undefined, cumulative: undefined }) : emptyLine }).rows);
    } else {
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
  const selectedLocationRow = rows.find((row) => row._gridId === locationRow);
  const menuSource = rows.find((row) => row._gridId === rowMenu);
  return <section className="pc-grid-section" data-history={historyTick}>
    {workTypes.length > 0 && <datalist id={workTypeList}>{workTypes.map((name, index) => <option key={index} value={typeof name === "string" ? name : optionLabel(name)} />)}</datalist>}
    <div className="pc-toolbar pc-grid-toolbar">
      <h3>{t("بنود الأعمال", "Work rows")}</h3>
      {!readOnly && <>
        <button type="button" onClick={addRow}><Plus size={16} />{t("بند", "Add row")}</button>
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
    <div ref={grid} className="pc-grid-scroll" tabIndex={0} aria-label={t("جدول بنود المستخلص", "Certificate work grid")}
      onKeyDown={onKeyDown}
      onMouseDown={(event) => { const { rowId, column } = event.target.dataset; if (rowId && column) select({ rowId, columnKey: column }, event.shiftKey); }}
      onFocus={(event) => { const { rowId, column } = event.target.dataset; if (rowId && column && !nextFocus.current && !event.nativeEvent.sourceCapabilities) select({ rowId, columnKey: column }, false); }}
      onPaste={(event) => { const { rowId, column } = event.target.dataset; const value = event.clipboardData.getData("text/plain"); if (editable && /[\t\r\n]/.test(value) && paste(value, { rowId, columnKey: column })) event.preventDefault(); }}>
      <table className="pc-grid" aria-rowcount={rows.length + 1}>
        <colgroup><col style={{ width: 47 }} />{GRID_COLUMNS.map(({ key, width }) => <col key={key} style={{ width: width || 105 }} />)}</colgroup>
        <thead><tr><th scope="col" className="pc-grid-index">#</th>{GRID_COLUMNS.map(({ key, label }) => <th scope="col" key={key}>{t(...label)}</th>)}</tr></thead>
        <tbody>{visible.map((row, index) => {
          const absolute = start + index;
          const selected = !sortedView && selectedRange && absolute >= selectedRange.rowStart && absolute <= selectedRange.rowEnd
            ? gridKeys.slice(selectedRange.colStart, selectedRange.colEnd + 1) : null;
          return <WorkRow key={row._gridId} row={row} rowIndex={absolute} columns={GRID_COLUMNS} t={t} readOnly={!editable || row.carried_forward} locations={locationMap}
            onEdit={edit} onLocation={setLocationRow} onMenu={setRowMenu} selected={selected} error={errors.has(String(row.id)) || errors.has(String(row.identity))} locale={locale} workTypeList={workTypeList} />;
        })}</tbody>
      </table>
      {!rows.length && <p className="pc-grid-empty">{t("لا توجد بنود بعد.", "No work rows yet.")}</p>}
    </div>
    <div className="pc-grid-footer">
      <div className="pc-pagination">
        <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t("السابق", "Previous")}</button>
        <span><bdi>{rows.length ? start + 1 : 0}–{Math.min(start + pageSize, rows.length)} / {rows.length}</bdi></span>
        <button type="button" disabled={start + pageSize >= rows.length} onClick={() => setPage(currentPage + 1)}>{t("التالي", "Next")}</button>
      </div>
      <div><strong>{t("إجمالي أعمال الفترة", "Current work subtotal")}</strong> <Money value={settled ? totals?.current : null} locale={locale} currency={currency} />{!settled && <small>{t(" يتحدث عند الحفظ", " Updates on save")}</small>}</div>
    </div>
    {selectedLocationRow && <Dialog title={t("موقع البند", "Row location")} onClose={() => { setLocationRow(null); focusCell({ rowId: locationRow, columnKey: "location_id" }); }} t={t}>
      <Combobox label={t("الموقع", "Location")} t={t} options={locations} autoFocus selected={locationMap.get(String(selectedLocationRow.location_id))} onSelect={(location) => {
        edit(locationRow, "location_id", location.id, { location_name: "" }); setLocationRow(null); focusCell({ rowId: locationRow, columnKey: "location_id" });
      }} onAdd={canAddLocation ? (name) => {
        const rowId = locationRow;
        setLocationRow(null);
        onAddLocation(name, (location) => { edit(rowId, "location_id", location.id, { location_name: "" }); focusCell({ rowId, columnKey: "location_id" }); });
      } : undefined} />
      <button type="button" onClick={() => { edit(locationRow, "location_id", "", { location_name: "" }); setLocationRow(null); focusCell({ rowId: locationRow, columnKey: "location_id" }); }}>{t("على مستوى المشروع", "Project-wide")}</button>
    </Dialog>}
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
        if (prior) edit(rowMenu, "identity", prior.identity, { work_type: prior.work_type, work_item: prior.work_item, description: prior.description, location_id: prior.location_id });
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
