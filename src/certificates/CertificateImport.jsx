import { useMemo, useState } from "react";
import { GRID_COLUMNS } from "./CertificateGrid.jsx";
import { Dialog, Field, Money, optionLabel, Problem, queryString, useResource } from "./shared.jsx";

const importableKeys = new Set(["building_unit","floor_apartment","work_type","work_item","description","mode","width","height","dimension_unit","count","quantity","unit","rate","agreed_amount","progress","note"]);
const mappings = GRID_COLUMNS.filter((item) => importableKeys.has(item.key));
const amountField = { key: "amount", label: ["القيمة المسجلة", "Recorded amount"] };
const locationField = { key: "location", label: ["اسم الموقع", "Location name"] };

function splitSource(value) {
  const delim = value.includes("\t") ? "\t" : ",";
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const text = value.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  for (let index = 0; index <= text.length; index += 1) {
    const character = text[index];
    if (character === '"' && delim === "," && (quoted || !cell)) {
      if (quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === undefined || (!quoted && (character === "\n" || character === delim))) {
      row.push(cell.trim()); cell = "";
      if (character !== delim) { rows.push(row); row = []; }
    } else cell += character;
  }
  if (quoted) throw new Error("Invalid CSV quoting");
  return rows;
}

export default function CertificateImport({ certificate, request, t, locale, onClose, onCommit, canImport, canAddLocation, locations, currency }) {
  const [source, setSource] = useState("measurements");
  const [sourceId, setSourceId] = useState("");
  const [pasted, setPasted] = useState("");
  const [fileRows, setFileRows] = useState(null);
  const [fileName, setFileName] = useState("");
  const [firstRowHeader, setFirstRowHeader] = useState(true);
  const [amountType, setAmountType] = useState("");
  const [quantityUnit, setQuantityUnit] = useState("");
  const [dimensionUnit, setDimensionUnit] = useState("");
  const [defaultMode, setDefaultMode] = useState("");
  const [mapping, setMapping] = useState({});
  const [stage, setStage] = useState(null);
  const [excluded, setExcluded] = useState({});
  const [resolutions, setResolutions] = useState({});
  const [newLocations, setNewLocations] = useState([]);
  const [replace, setReplace] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const candidates = useResource(request, source === "measurements" ? null : `/projects/${certificate.project_id}/sources${queryString({ certificate_id: certificate.id,account_id:certificate.header?.account_id||'base' })}`);
  const sources = (candidates.data?.[source] || []).filter((item) => source !== "certificates" || Number(item.id) !== Number(certificate.id));
  const record = sources.find((item) => String(item.id) === sourceId);
  const table = useMemo(() => {
    if (fileRows) return { rows: fileRows };
    if (!pasted.trim()) return { rows: [] };
    try { return { rows: splitSource(pasted) }; }
    catch (cause) { return { rows: [], error: cause }; }
  }, [fileRows, pasted]);
  const sample = table.rows.slice(firstRowHeader ? 1 : 0, (firstRowHeader ? 1 : 0) + 4);
  const columnCount = table.rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  const labels = Array.from({ length: columnCount }, (_, index) => (firstRowHeader ? table.rows[0]?.[index] : "") || `${t("عمود", "Column")} ${index + 1}`);
  const useful = [...mappings, locationField, ...(amountType ? [amountField] : [])];
  const stagedRows = stage?.rows || [];
  const labelsByKey = Object.fromEntries(useful.map((item) => [item.key, item.label]));
  const knownWork = new Set((certificate.lines || []).filter((row) => !row.carried_forward).map((row) => row.identity));
  const locationChoices = [...locations, ...newLocations];

  async function handleFile(file) {
    if (!file) return;
    setError(null); setStage(null); setFileName(file.name); setBusy(true);
    try {
      if (/\.xlsx$/i.test(file.name)) {
        const ExcelJS = (await import("exceljs/dist/exceljs.min.js")).default;
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(await file.arrayBuffer());
        const sheet = workbook.worksheets[0];
        if (!sheet) throw new Error(t("لا توجد ورقة عمل في الملف.", "The file contains no worksheet."));
        const rows = [];
        sheet.eachRow({ includeEmpty: true }, (row) => rows.push(Array.from({ length: row.cellCount }, (_, index) => {
          const cell = row.getCell(index + 1);
          const result = cell.result ?? cell.value;
          return result === null || result === undefined ? "" : typeof result === "number" ? result : cell.text;
        })));
        setFileRows(rows);
      } else setFileRows(splitSource(await file.text()));
      setMapping({});
    } catch (cause) { setFileRows(null); setError(cause); }
    finally { setBusy(false); }
  }

  async function prepare(event) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      let rows = table.rows.slice(firstRowHeader ? 1 : 0);
      let chosenMapping = Object.fromEntries(Object.entries(mapping).filter(([, value]) => value !== "").map(([key, value]) => [key, Number(value)]));
      let label = fileName || "Pasted measurements";
      if (source !== "measurements") {
        rows = (record?.lines || []).filter((line) => line.mode !== "adjustment").map((line) => ({
          ...line, quantity: line.mode === "direct" ? 0 : undefined,
          count: ["area", "linear", "count"].includes(line.mode) ? 0 : undefined,
          amount: line.mode === "lump" ? 0 : undefined, progress: undefined,
        }));
        chosenMapping = Object.fromEntries([...mappings, locationField, amountField, { key: "identity" }].map(({ key }) => [key, key]));
        label = record?.label || source;
      }
      if (!rows.length) throw new Error(t("حدد مصدرًا يحتوي على بنود.", "Select a source containing work rows."));
      if (source === "measurements" && !Object.keys(chosenMapping).length) throw new Error(t("اربط حقول المستخلص بأعمدة المصدر أولًا.", "Map certificate fields to source columns first."));
      const result = await request(`/${certificate.id}/import/stage`, { method: "POST", body: {
        rows, mapping: chosenMapping, source_label: label, source_id: record?.id ? `${source}:${record.id}` : undefined, amount_type: source === "measurements" ? amountType : "current",
        quantity_unit: quantityUnit, dimension_unit: dimensionUnit, default_mode: defaultMode,
      } });
      setStage(result); setExcluded({}); setResolutions({}); setReplace({});
    } catch (cause) { setError(cause); } finally { setBusy(false); }
  }

  async function commit() {
    setBusy(true); setError(null);
    try {
      const excludeIds = Object.keys(excluded).filter((key) => excluded[key]?.exclude);
      const reasons = Object.fromEntries(excludeIds.map((key) => [key, excluded[key].reason]));
      if (excludeIds.some((key) => !reasons[key]?.trim())) throw new Error(t("اكتب سبب استبعاد كل بند.", "Enter a reason for each excluded row."));
      const result = await request(`/${certificate.id}/import/commit`, { method: "POST", body: {
        batch_id: stage.batch_id, version: certificate.version, exclude_ids: excludeIds, exclusion_reasons: reasons,
        resolutions: Object.entries(resolutions).map(([id, line]) => ({ id, line })), replace_ids: Object.keys(replace).filter((key) => replace[key]),
      } });
      onCommit(result.certificate || result);
    } catch (cause) { setError(cause); } finally { setBusy(false); }
  }

  function resolve(id, field, value) {
    setResolutions((current) => ({ ...current, [id]: { ...current[id], [field]: value } }));
  }

  function linkLocation(id, label, value) {
    const match = stagedRows.filter((candidate) => label && candidate.line?.location === label).map((candidate) => candidate.id);
    setResolutions((current) => ({ ...current, ...Object.fromEntries([...new Set([id, ...match])].map((key) => [key, {
      ...current[key], location_id: value === "project" ? null : Number(value) || null, project_wide: value === "project",
    }])) }));
  }

  async function createLocation(id, name) {
    setBusy(true); setError(null);
    try {
      const location = await request(`/projects/${certificate.project_id}/locations`, { method: "POST", body: { name, kind: "building" } });
      setNewLocations((current) => [...current, location]);
      linkLocation(id, name, location.id);
    } catch (cause) { setError(cause); } finally { setBusy(false); }
  }

  return <Dialog title={t("استخراج بنود للمسودة", "Extract work rows into the draft")} onClose={() => { if (!busy) onClose(); }} t={t} wide>
    <Problem error={error || candidates.error || table.error} t={t} />
    {!stage ? <form className="pc-stack" onSubmit={prepare}>
      <Field label={t("المصدر", "Source")}><select value={source} onChange={(event) => { setSource(event.target.value); setSourceId(""); }}>
        {canImport && <option value="measurements">{t("قياسات من ملف أو الحافظة", "Measurements from file or clipboard")}</option>}
        <option value="certificates">{t("بنود مستخلص سابق", "Prior certificate work")}</option><option value="quotations">{t("عرض سعر أو جدول كميات", "Quotation or bill of quantities")}</option>
        <option value="invoices">{t("بنود فاتورة", "Invoice work")}</option>
      </select></Field>
      {source !== "measurements" ? <>
        <Field label={t("السجل المصدر", "Source record")}><select value={sourceId} required onChange={(event) => setSourceId(event.target.value)}>
          <option value="">{t("اختر سجلًا", "Select a record")}</option>{sources.map((item) => <option key={item.id} value={item.id}>{item.label || item.official_number || item.id}</option>)}
        </select></Field>
        {(record?.lines || []).length > 0 && <p>{record.lines.length} {t("بند متاح للربط. أدخل مطالبة الفترة الحالية بعد الاستخراج.", "work rows available to link. Enter the current claim after extraction.")}</p>}
      </> : <>
        <div className="pc-form">
          <Field label={t("ملف قياسات (CSV أو TSV أو XLSX)", "Measurement file (CSV, TSV, or XLSX)")}><input type="file" accept=".csv,.tsv,.txt,.xlsx" onChange={(event) => handleFile(event.target.files?.[0])} /></Field>
          <label className="pc-check"><input type="checkbox" checked={firstRowHeader} onChange={(event) => { setFirstRowHeader(event.target.checked); setMapping({}); }} />{t("السطر الأول عناوين أعمدة", "First row contains headers")}</label>
          <Field label={t("نوع القيمة المصدرية", "Source amount meaning")}><select value={amountType} onChange={(event) => setAmountType(event.target.value)}><option value="">{t("لا توجد قيمة مالية مصدرية", "No source financial value")}</option><option value="current">{t("قيمة الفترة", "Current period amount")}</option><option value="cumulative">{t("قيمة تراكمية", "Cumulative amount")}</option></select></Field>
          <Field label={t("وحدة الأبعاد الافتراضية", "Default dimension unit")}><select value={dimensionUnit} onChange={(event) => setDimensionUnit(event.target.value)}><option value="">—</option><option value="mm">mm</option><option value="cm">cm</option><option value="m">m</option></select></Field>
          <Field label={t("وحدة الكمية الافتراضية", "Default quantity unit")}><input value={quantityUnit} dir="auto" onChange={(event) => setQuantityUnit(event.target.value)} /></Field>
          <Field label={t("طريقة الإدخال الافتراضية", "Default entry mode")}><select value={defaultMode} onChange={(event) => setDefaultMode(event.target.value)}><option value="">—</option><option value="area">{t("مساحة", "Measured area")}</option><option value="linear">{t("طول", "Measured linear")}</option><option value="direct">{t("كمية مباشرة", "Direct quantity")}</option><option value="count">{t("عدد", "Count")}</option><option value="lump">{t("مقطوعية", "Lump sum")}</option></select></Field>
        </div>
        <Field label={t("أو الصق صفوف الجدول", "Or paste spreadsheet rows")}><textarea value={pasted} rows={5} dir="auto" onChange={(event) => { setPasted(event.target.value); setFileRows(null); setFileName(""); setMapping({}); }} /></Field>
        {sample.length > 0 && <div className="pc-table-scroll"><table className="pc-table"><thead><tr>{labels.map((label, index) => <th key={index}>{label}</th>)}</tr></thead><tbody>{sample.map((row, index) => <tr key={index}>{labels.map((_, column) => <td key={column}><bdi>{row[column]}</bdi></td>)}</tr>)}</tbody></table></div>}
        {labels.length > 0 && <fieldset><legend>{t("ربط الأعمدة", "Column mapping")}</legend><div className="pc-form">{useful.map(({ key, label }) => <Field key={key} label={t(...label)}><select value={mapping[key] ?? ""} onChange={(event) => setMapping((current) => ({ ...current, [key]: event.target.value }))} required={key === "amount" && Boolean(amountType)}><option value="">—</option>{labels.map((name, index) => <option key={index} value={index}>{name}</option>)}</select></Field>)}</div></fieldset>}
      </>}
      <div><button type="submit" className="primary" disabled={busy}>{t("معاينة الربط", "Preview mapping")}</button></div>
    </form> : <div className="pc-stack">
      <div className="pc-toolbar"><span className="pc-chip">{t("بنود مقروءة", "Recognized rows")} <bdi>&nbsp;{stage.recognized ?? stagedRows.length}</bdi></span><span className="pc-chip">{t("صفوف فارغة متجاوزة", "Blank rows skipped")} <bdi>&nbsp;{stage.skipped ?? 0}</bdi></span></div>
      <div className="pc-table-scroll"><table className="pc-table"><thead><tr><th>{t("البند", "Work row")}</th><th>{t("الموقع", "Location")}</th><th>{t("القيمة", "Amount")}</th><th>{t("المراجعة", "Review")}</th><th>{t("الاستبعاد", "Exclusion")}</th></tr></thead><tbody>{stagedRows.map(({ id, line, validation }, index) => <tr key={id}>
        <td><bdi>{line?.description || line?.work_item || index + 1}</bdi></td><td><bdi>{line?.location || line?.location_id || "—"}</bdi></td><td><Money value={line?.claim_amount ?? line?.adjustment_amount} locale={locale} currency={currency} /></td>
        <td><div className="pc-stack">{(validation || []).map((item, problemIndex) => <div className="pc-stack" key={problemIndex}>
          <span>{labelsByKey[item.field] && <strong>{t(...labelsByKey[item.field])} </strong>}{item.message || item}</span>
          {item.field === "location" ? <>
            <select aria-label={t("ربط الموقع", "Link location")} value={resolutions[id]?.project_wide ? "project" : resolutions[id]?.location_id || ""} onChange={(event) => linkLocation(id, line.location, event.target.value)}>
              <option value="">—</option><option value="project">{t("على مستوى المشروع", "Project-wide")}</option>{locationChoices.map((location) => <option key={location.id} value={location.id}>{optionLabel(location)}</option>)}
            </select>
            {canAddLocation && !resolutions[id]?.location_id && line.location && <button type="button" disabled={busy} onClick={() => createLocation(id, line.location)}>{t("إنشاء موقع وربط البنود المطابقة", "Create location and link matching rows")}</button>}
          </> : item.field === "dimension_unit" ? <select aria-label={t("وحدة الأبعاد", "Dimension unit")} value={resolutions[id]?.dimension_unit || ""} onChange={(event) => resolve(id, "dimension_unit", event.target.value)}>
            <option value="">—</option><option value="mm">mm</option><option value="cm">cm</option><option value="m">m</option>
          </select> : (item.field === "description" || item.field === "unit") && <input dir="auto" aria-label={t(...labelsByKey[item.field])} value={resolutions[id]?.[item.field] || ""} onChange={(event) => resolve(id, item.field, event.target.value)} />}
        </div>)}</div></td>
        <td><label className="pc-check"><input type="checkbox" checked={Boolean(excluded[id]?.exclude)} onChange={(event) => setExcluded((value) => ({ ...value, [id]: { ...value[id], exclude: event.target.checked } }))} />{t("استبعاد", "Exclude")}</label>
          {excluded[id]?.exclude && <input aria-label={t("سبب الاستبعاد", "Exclusion reason")} placeholder={t("سبب الاستبعاد", "Exclusion reason")} dir="auto" value={excluded[id]?.reason || ""} onChange={(event) => setExcluded((value) => ({ ...value, [id]: { ...value[id], reason: event.target.value } }))} />}
          {knownWork.has(line?.identity) && !excluded[id]?.exclude && <label className="pc-check"><input type="checkbox" checked={Boolean(replace[id])} onChange={(event) => setReplace((current) => ({ ...current, [id]: event.target.checked }))} />{t("تحديث البند الموجود", "Refresh matching draft row")}</label>}</td>
      </tr>)}</tbody></table></div>
      <p className="pc-caption">{t("راجع التحذيرات واربط المواقع أو استبعد البنود قبل الإضافة. تبقى البنود المتطابقة كما هي ما لم تختر تحديثها.", "Resolve warnings or exclude rows before adding. Matching draft rows are preserved unless you choose to refresh them.")}</p>
      <div className="pc-toolbar"><button type="button" className="primary" onClick={commit} disabled={busy || !stagedRows.length}>{t("إضافة البنود إلى المسودة", "Add rows to the draft")}</button><button type="button" onClick={() => setStage(null)} disabled={busy}>{t("تعديل الربط", "Edit mapping")}</button></div>
    </div>}
  </Dialog>;
}
