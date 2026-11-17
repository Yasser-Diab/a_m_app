import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClipboardList, Eye, Plus, RefreshCw, Save, Settings2, Trash2 } from "lucide-react";
import CertificateGrid, { hydrateLines, stripGridFields } from "./CertificateGrid.jsx";
import CertificateImport from "./CertificateImport.jsx";
import { ProjectSettings } from "./CertificateOperations.jsx";
import CertificatePreview from "./CertificatePreview.jsx";
import { Combobox, Dialog, Field, localDate, locationOptions, Money, newKey, numberText, optionLabel, Problem, ProjectDetailsFields, queryString, Status, useDebounce, useResource } from "./shared.jsx";

const typeLabels = { progress: ["دوري", "Progress"], final: ["ختامي", "Final"], correction: ["تصحيح", "Correction"], void: ["إلغاء", "Void"], reopen: ["إعادة فتح", "Reopening"] };
const optionalFields = {
  customer_code: ["رمز العميل", "Customer code"], customer_address: ["عنوان العميل", "Customer address"], customer_tax_no: ["رقم التسجيل الضريبي", "Tax registration"], customer_contact: ["جهة الاتصال", "Customer contact"],
  project_code: ["رمز المشروع", "Project code"], project_address: ["عنوان المشروع", "Project address"], location: ["الموقع", "Location"], contract_ref: ["مرجع العقد", "Contract reference"], contract_date: ["تاريخ العقد", "Contract date"], currency: ["العملة", "Currency"], notes: ["الملاحظات", "Notes"],
};
const numericLineFields = ["width", "height", "count", "quantity", "rate", "agreed_amount", "progress", "claim_amount", "adjustment_amount", "override_quantity"];
const actionLabels = {
  submit: ["إرسال للمراجعة", "Submit for review"], approve: ["اعتماد المستخلص", "Approve certificate"], return: ["إرجاع إلى المسودة", "Return to draft"], issue: ["إصدار المستخلص", "Issue certificate"],
  revise: ["إنشاء تصحيح", "Create correction"], void: ["طلب إلغاء", "Request void"], reopen: ["طلب إعادة فتح", "Request reopening"],
  recover_advance:["تصحيح استرداد الدفعة المقدمة","Correct advance recovery"],
};
const approvalRequired = new Set(["approve", "issue", "return", "revise", "void", "reopen","recover_advance"]);
const needsReason = new Set(["return", "revise", "void", "reopen","recover_advance"]);
const normalizeSaved = (item) => item?.certificate || item;

export default function CertificateEditor({ initial, request, apiBase, session, access, t, locale, defaultReportLanguage, onChange, onAccessChanged, saveNativeReport, shareNativeReport, dirtyRef, onBackToSearch, onDeleted }) {
  const [record, setRecord] = useState(initial || null);
  const [editing, setEditing] = useState(!initial || initial.status === "draft");
  const [customer, setCustomer] = useState(initial?.customer || (initial?.project?.customer_id ? { id: initial.project.customer_id, display_name: initial.project.customer_name } : null));
  const [project, setProject] = useState(initial?.project || null);
  const [header, setHeader] = useState(initial?.header || { type: "progress", work_to: localDate(), collection_cutoff: localDate(), locale: defaultReportLanguage === "en" ? "en" : "ar", output_mode: "" });
  const [rows, setRows] = useState(() => initial ? hydrateLines(initial.lines) : []);
  const [gridGeneration, setGridGeneration] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState(null);
  const [statusText, setStatusText] = useState("");
  const [claimReview, setClaimReview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [master, setMaster] = useState(null);
  const [pendingScope, setPendingScope] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showReview, setShowReview] = useState(Boolean(initial && initial.status !== "draft"));
  const [preview, setPreview] = useState(null);
  const [importDraft, setImportDraft] = useState(null);
  const [action, setAction] = useState(null);
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [actionReason, setActionReason] = useState("");
  const commands = useRef(new Map());
  const refreshRules = useRef(false);
  const [projectRevision, setProjectRevision] = useState(0);
  const [customerSearch, setCustomerSearch] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const customerQuery = useDebounce(customerSearch);
  const projectQuery = useDebounce(projectSearch);
  const can = (key) => access?.capabilities?.includes(key);
  const isDraft = !record || ["draft", "in_review", "unapproved"].includes(record.status);
  const canEdit = isDraft && Boolean(record ? can("edit_draft") : can("create"));
  const canWrite = canEdit && editing;
  const canMaster = canWrite && can("create_master");
  const historical = record?.legacy === true;
  const customers = useResource(request, canWrite && !record ? `/customers${queryString({ q: customerQuery })}` : null, projectRevision);
  const projects = useResource(request, canWrite && !record && customer?.id ? `/projects${queryString({ customer_id: customer.id, q: projectQuery })}` : null, projectRevision);
  const context = useResource(request, project?.id ? `/projects/${project.id}${queryString({ work_to: header.work_to })}` : null, projectRevision);
  const suggested = useResource(request, canWrite && project?.id ? `/projects/${project.id}/entry-suggestions` : null, projectRevision);
  const operationItems=useResource(request,can("ops_view")&&project?.id?
    `/projects/${project.id}/operational-quantities${queryString({work_to:header.work_to})}`:null,projectRevision);
  const locations = useMemo(() => locationOptions(context.data?.locations), [context.data?.locations]);
  const validation = error?.payload?.validation || record?.validation || [];
  const activeLocation = locations.find((entry) => String(entry.id) === String(header.location_id));
  const currency = project?.currency || header.currency || "EGP";

  useEffect(() => { dirtyRef.current = dirty; return () => { dirtyRef.current = false; }; }, [dirty, dirtyRef]);
  useEffect(() => {
    if (record?.status !== "issued" || !["processing", "pending"].includes(record.pdf_status)) return undefined;
    let cancelled = false;
    const timer = setInterval(() => request(`/${record.id}`).then((result) => {
      if (!cancelled) setRecord(normalizeSaved(result));
    }).catch(() => {}), 3500);
    return () => { cancelled = true; clearInterval(timer); };
  }, [record?.id, record?.pdf_status, record?.status, request]);

  const changeHeader = (key, value) => {
    setHeader((current) => ({...current,[key]:value,...(key==="work_to"&&
      (!current.collection_cutoff||current.collection_cutoff===current.work_to)?{collection_cutoff:value}:{})}));
    setDirty(true);setStatusText("");
  };
  const changeRows = useCallback((next) => { setRows(next); setDirty(true); setStatusText(""); }, []);

  function refreshContext() { setProjectRevision((current) => current + 1); }

  function scopeChange(nextCustomer, nextProject) {
    if ((customer?.id && customer.id !== nextCustomer?.id || project?.id && project.id !== nextProject?.id) && rows.some((row) => row.description || row.work_item || row.location_id || row.quantity || row.width || row.claim_amount)) {
      setPendingScope({ customer: nextCustomer, project: nextProject });
      return;
    }
    applyScope(nextCustomer, nextProject);
  }

  function applyScope(nextCustomer, nextProject) {
    const different = project?.id !== nextProject?.id;
    setCustomer(nextCustomer); setProject(nextProject); setPendingScope(null);
    if (different) {
      setRows((current) => current.map(({ work_item_id, ops_item_id, source, location, ...line }) => ({ ...line, location_id: "", location_name: "" })));
      setGridGeneration((current) => current + 1);
    }
    setHeader((current) => different ? { ...current, contract_ref: nextProject?.contract_ref || "", location_id: "", output_mode: "" } : current);
    setProjectSearch(""); setDirty(true);
  }

  function updateScopeLocations(location) {
    const conflicts = rows.filter((row) => row.location_id && location?.id && String(row.location_id) !== String(location.id));
    if (conflicts.length && !window.confirm(t("تغيير نطاق المستخلص سيعيد تعيين المواقع المختلفة في البنود. هل تريد المتابعة؟", "Changing the certificate scope will reassign rows with different locations. Continue?"))) return;
    if (conflicts.length) changeRows(rows.map((row) => conflicts.includes(row) ? { ...row, location_id: location.id, location_name: "" } : row));
    changeHeader("location_id", location?.id || "");
  }

  function showError(cause) {
    setError(cause);
    if ([401, 403].includes(cause.status)) onAccessChanged?.();
  }

  function applySaved(data, keepGrid = true) {
    const result = normalizeSaved(data);
    if (result.status === "draft" && result.id !== record?.id) setEditing(true);
    setRecord(result); setHeader(result.header || header); setRows(hydrateLines(result.lines));
    setCustomer(result.customer || customer); setProject(result.project || project);
    setDirty(false); setError(null); onChange?.(result);
    if (!keepGrid) setGridGeneration((current) => current + 1);
    refreshRules.current = false;
    return result;
  }

  function payloadLines() {
    return stripGridFields(rows.filter((line) => !line.carried_forward && [line.location_id,line.building_unit,line.floor_apartment,line.work_type,line.work_item,line.description,line.note,...numericLineFields.map((field) => line[field])].some((value) => value !== "" && value !== null && value !== undefined))).map((line) => ({
      ...line, height: line.mode === "linear" ? null : line.height,
      ...Object.fromEntries(numericLineFields.filter((key) => !(key === "height" && line.mode === "linear")).map((field) => [field, numberText(line[field])])),
    }));
  }

  async function reviewClaims() {
    const data=await request(`/projects/${project.id}/operational-quantities`,{
      method:"POST",body:{header,lines:payloadLines(),revision_id:record?.id},
    });
    setClaimReview({data,header,rows});
  }

  async function save({ announce = true, refreshProjectRules = false } = {}) {
    if (record && !dirty && !refreshProjectRules) return record;
    if (!project?.id) throw new Error(t("اختر العميل والمشروع أولًا.", "Select a customer and project first."));
    setError(null);
    const body = { header, lines: can("edit_draft") ? payloadLines() : [] };
    const result = await request(record ? `/${record.id}` : "/", record
      ? { method: "PUT", body: { ...body, version:record.version, ...(refreshRules.current||refreshProjectRules ? {refresh_rules:true} : {}) } }
      : { method: "POST", body: { ...body, project_id: project.id } });
    const saved = applySaved(result);
    if (announce) setStatusText(t("تم حفظ المسودة وحساب القيم.", "Draft saved and amounts calculated."));
    return saved;
  }

  async function run(operation) {
    setBusy(true); setError(null); setStatusText("");
    try { await operation(); } catch (cause) { showError(cause); } finally { setBusy(false); }
  }

  async function workflow(nextAction, reason = "") {
    await run(async () => {
      const target = dirty && canWrite ? await save({ announce: false }) : record;
      if (!target) return;
      const slot = `${target.id}-${target.version}-${nextAction}`;
      if (!commands.current.has(slot)) commands.current.set(slot, newKey());
      const result = await request(`/${target.id}/action`, { method: "POST", body: { version: target.version,
        action:nextAction==="recover_advance"?"revise":nextAction,recover_advance:nextAction==="recover_advance",reason,command_key:commands.current.get(slot) } });
      const refreshed = applySaved(result, !["revise", "void", "reopen","recover_advance"].includes(nextAction));
      setAction(null); setActionReason(""); setShowReview(refreshed.status !== "draft");
    });
  }

  function showAction(nextAction) {
    if (approvalRequired.has(nextAction)) { setAction(nextAction); setActionReason(nextAction==="recover_advance"?
      t(`تطبيق استرداد الدفعة المقدمة بنسبة ${record.advance_recovery_correction.rate}%`,`Apply ${record.advance_recovery_correction.rate}% advance recovery`):""); }
    else workflow(nextAction);
  }

  async function remove(filesOnly) {
    await run(async () => {
      await request(`/${record.id}${filesOnly ? "/documents" : ""}`,{method:"DELETE",body:{version:record.version}});
      setDeleteDialog(false);
      if (filesOnly) {
        applySaved(await request(`/${record.id}`),false);
        setStatusText(t("تم حذف ملفات PDF المؤرشفة.", "Archived PDF files deleted."));
      } else onDeleted?.();
    });
  }

  const availableActions = record?.status === "draft" ? ["approve", "submit"]
    : record?.status === "unapproved" ? ["approve"]
    : ["in_review", "submitted", "review"].includes(record?.status) ? ["approve", "return"]
    : record?.status === "approved" ? historical ? ["revise", "void"] : ["issue", "revise", ...(record.can_return_legacy_approval ? ["return"] : [])]
    : ["issued", "historical"].includes(record?.status) ? ["revise", "void", ...(record.type === "final" ? ["reopen"] : [])] : [];
  const permissionFor = (operation) => ["revise", "void", "reopen"].includes(operation) ? "revise" : operation === "return" ? "approve" : operation;
  const showDocument = can("export");

  function openDocument() {
    run(async () => {
      const selected = dirty || !record ? await save({ announce: false }) : record;
      setPreview(selected);
    });
  }

  function openImport() {
    run(async () => setImportDraft(await save({ announce: false })));
  }

  return <section className="pc-panel pc-editor">
    <div className="pc-toolbar">
      <h2>{record ? <>{t("مستخلص", "Certificate")} <bdi>{record.certificate_number ?? record.official_number ?? record.legacy_number}</bdi></> : t("مستخلص جديد", "New certificate")}</h2>
      {record && <><Status value={record.status} t={t} />{record.revision > 1 && <span className="pc-chip">{t("المراجعة", "Revision")} <bdi>&nbsp;{record.revision}</bdi></span>}</>}
      {record?.pdf_status && <Status value={record.pdf_status} t={t} />}
      {onBackToSearch && <button type="button" onClick={onBackToSearch}>{t("العودة إلى البحث", "Back to search")}</button>}
      {record && canEdit && !editing && <button type="button" onClick={() => setEditing(true)}>{t("تعديل المستخلص", "Edit certificate")}</button>}
      {record && access?.can_delete_documents && <button type="button" className="danger" disabled={busy}
        onClick={() => { setError(null); setDeleteDialog(true); }}><Trash2 size={16}/>{t("حذف", "Delete")}</button>}
      {showDocument && <button type="button" onClick={openDocument} disabled={busy || !project || !record && !canWrite}><Eye size={17} />{t("معاينة وتصدير", "Preview and export")}</button>}
      {dirty && <span className="pc-caption" role="status">{t("تعديلات غير محفوظة", "Unsaved changes")}</span>}
    </div>
    {record?.advance_recovery_correction&&<div className="pc-toolbar" role="status">
      <p>{t("لم تُحتسب نسبة استرداد الدفعة المقدمة في المستخلص المعتمد.","The approved certificate is missing its advance recovery.")}
        {" "}<Money value={record.advance_recovery_correction.amount} currency={currency} locale={locale}/></p>
      <button type="button" className="primary" disabled={busy} onClick={()=>showAction("recover_advance")}>{t(...actionLabels.recover_advance)}</button>
    </div>}
    {availableActions.length > 0 && <div className="pc-toolbar">
      {availableActions.filter((operation) => can(permissionFor(operation))).map((operation) => <button type="button" key={operation}
        className={operation === "issue" || operation === "approve" || operation === "submit" ? "primary" : undefined} disabled={busy} onClick={() => showAction(operation)}>{t(...actionLabels[operation])}</button>)}
      {!availableActions.some((operation) => can(permissionFor(operation))) && <span className="pc-caption">{t("يتطلب الانتقال التالي صلاحية سير عمل إضافية.", "The next action requires an additional workflow permission.")}</span>}
    </div>}
    <Problem error={error || customers.error || projects.error || context.error} t={t} />
    {statusText && <p className="pc-caption" role="status">{statusText}</p>}
    <div className="pc-form">
      {canWrite && !record ? <>
        <div className="pc-stack"><Combobox label={t("العميل", "Customer")} options={customers.data || []} selected={customer} onSelect={(next) => scopeChange(next, null)}
          onSearch={setCustomerSearch} onClear={() => scopeChange(null, null)} onAdd={canMaster ? (name) => setMaster({ type: "customer", name }) : undefined} t={t} />
          {canMaster && <button type="button" onClick={() => setMaster({ type: "customer", name: customerSearch })}><Plus size={15} />{t("إضافة عميل", "Add customer")}</button>}</div>
        <div className="pc-stack"><Combobox label={t("المشروع", "Project")} options={projects.data || []} selected={project} resetKey={customer?.id}
          onSelect={(next) => scopeChange(customer, next)} onSearch={setProjectSearch} onClear={() => scopeChange(customer, null)} disabled={!customer}
          onAdd={canMaster && (access.all_projects || access.allow_project_creation) ? (name) => setMaster({ type: "project", name }) : undefined} t={t} />
          {canMaster && (access.all_projects || access.allow_project_creation) && <button type="button" disabled={!customer} onClick={() => setMaster({ type: "project", name: projectSearch })}><Plus size={15} />{t("إضافة مشروع", "Add project")}</button>}</div>
      </> : <>
        <Field label={t("العميل", "Customer")}><input value={optionLabel(customer)} readOnly dir="auto" /></Field>
        <Field label={t("المشروع", "Project")}><input value={optionLabel(project)} readOnly dir="auto" /></Field>
      </>}
      <Field label={t("العقد / أمر الشراء", "Contract / PO")}><input dir="auto" readOnly={!canWrite} value={header.contract_ref ?? project?.contract_ref ?? ""} onChange={(event) => changeHeader("contract_ref", event.target.value)} /></Field>
      <Field label={t("نوع المستخلص", "Certificate type")}><select value={header.type || record?.type || "progress"} disabled={!canWrite || !["progress", "final"].includes(header.type)} onChange={(event) => changeHeader("type", event.target.value)}>
        {Object.entries(typeLabels).map(([value, names]) => <option key={value} value={value} disabled={!historical && !["progress", "final", header.type].includes(value)}>{t(...names)}</option>)}
      </select></Field>
      <Field label={t("بداية فترة الأعمال", "Work period start")}><input type="date" dir="ltr" readOnly={!canWrite} value={header.work_from || ""} onChange={(event) => changeHeader("work_from", event.target.value)} /></Field>
      <Field label={t("تاريخ قطع الأعمال", "Work cutoff")}><input type="date" dir="ltr" readOnly={!canWrite} value={header.work_to || ""} onChange={(event) => changeHeader("work_to", event.target.value)} /></Field>
      <Field label={t("تاريخ قطع التحصيلات", "Collections cutoff")}><input type="date" dir="ltr" readOnly={!canWrite} value={header.collection_cutoff || ""} onChange={(event) => changeHeader("collection_cutoff", event.target.value)} /></Field>
      {header.location_id && (canWrite ?
        <Combobox label={t("نطاق الموقع", "Location scope")} options={locations} selected={activeLocation} disabled={!project || Boolean(record?.revises_id)}
          onSelect={updateScopeLocations} onClear={() => updateScopeLocations(null)} t={t} />
        : <Field label={t("نطاق الموقع", "Location scope")}><input readOnly dir="auto" value={header.location || optionLabel(activeLocation)} /></Field>)}
      <Field label={t("عنوان مختصر", "Short description")}><input dir="auto" readOnly={!canWrite} value={header.title || ""} onChange={(event) => changeHeader("title", event.target.value)} /></Field>
      <Field label={t("ملاحظات المستخلص", "Certificate notes")}><input dir="auto" readOnly={!canWrite} value={header.notes || ""} onChange={(event) => changeHeader("notes", event.target.value)} /></Field>
    </div>
    <div className="pc-toolbar">
      {project && <button type="button" onClick={() => setSettingsOpen(true)}><Settings2 size={16} />{t("إعدادات المشروع", "Project settings")}</button>}
      {record?.baseline && <span className="pc-caption">{t("المرجع السابق", "Prior baseline")} <bdi>{record.baseline.official_number} · {record.baseline.work_to}</bdi></span>}
      {project && <span className="pc-caption">{t("إصدار القواعد", "Rules version")} <bdi>{record?.rule_version ?? context.data?.settings?.version ?? "—"}</bdi></span>}
      {record&&canWrite&&can("manage_settings")&&<button type="button" disabled={busy}
        onClick={()=>run(()=>save({refreshProjectRules:true}))}>{t("تطبيق إعدادات المشروع الحالية","Apply current project settings")}</button>}
    </div>
    <CertificateGrid key={`${record?.id || "new"}-${gridGeneration}`} rows={rows} onChange={changeRows} readOnly={!canWrite || !can("edit_draft") || busy || header.recover_advance} t={t} locale={locale}
      locations={locations} suggestions={suggested.data || []}
      operationItems={operationItems.data || []}
      workItems={context.data?.work_items || []} workTypes={context.data?.work_types || []}
      validation={validation} totals={record?.totals} currency={currency} settled={Boolean(record) && !dirty} />
    {(operationItems.data?.length>0 || record?.operational_quantities?.length>0)&&
      <OperationalQuantities quantities={(claimReview?.header===header&&claimReview?.rows===rows?claimReview.data:null)
        ||record?.operational_quantities||operationItems.data} t={t}
        onReview={canWrite&&dirty?()=>run(reviewClaims):null} busy={busy}/>}
    <div className="pc-toolbar">
      {canWrite && <button type="button" className="primary" onClick={() => run(() => save())} disabled={busy || !project || record && !dirty}><Save size={17} />{t("حفظ المسودة", "Save draft")}</button>}
      {canWrite && !historical && record?.status !== "in_review" && can("edit_draft") && can("import") && <button type="button" onClick={openImport} disabled={!project || busy}><ClipboardList size={17} />{t("استخراج / استيراد", "Extract / import")}</button>}
      {record && <button type="button" onClick={() => setShowReview((current) => !current)} aria-expanded={showReview}>{t("مراجعة الحساب", "Calculation review")}</button>}
      {record?.pdf_status === "failed" && can("issue") && <button type="button" onClick={() => run(async () => {
        await request(`/${record.id}/render`, { method: "POST", body: {} });
        setRecord(normalizeSaved(await request(`/${record.id}`)));
      })} disabled={busy}><RefreshCw size={17} />{t("إعادة إنشاء PDF", "Retry PDF rendering")}</button>}
      {error?.status === 409 && record && <button type="button" onClick={() => {
        if (!dirty || window.confirm(t("سيستبدل التحميل التعديلات غير المحفوظة. هل تريد المتابعة؟", "Reloading will replace unsaved edits. Continue?"))) run(async () => applySaved(await request(`/${record.id}`), false));
      }} disabled={busy}><RefreshCw size={17} />{t("تحميل أحدث نسخة", "Reload latest version")}</button>}
    </div>
    {validation.length > 0 && <details open={error?.status === 422 || undefined}>
      <summary>{t("ملاحظات التحقق", "Validation messages")} <bdi>({validation.length})</bdi></summary>
      <ul>{validation.map((item, index) => <li key={index}>{item.line_id && <>{t("بند", "Row")} {rows.findIndex((line) => line.id === item.line_id) + 1} · </>}{item.message || String(item)}</li>)}</ul>
    </details>}
    {showReview && record && <CalculationReview record={record} currency={currency} t={t} locale={locale} dirty={dirty} />}
    {isDraft && <details><summary>{t("خيارات الإخراج", "Output options")}</summary>
      <div className="pc-form">
        <Field label={t("لغة المستند", "Document language")}><select disabled={!canWrite} value={header.locale || "ar"} onChange={(event) => changeHeader("locale", event.target.value)}><option value="ar">العربية</option><option value="en">English</option></select></Field>
        <Field label={t("طريقة الإخراج", "Output layout")}><select disabled={!canWrite} value={header.output_mode || ""} onChange={(event) => changeHeader("output_mode", event.target.value)}>
          <option value="">{t("إعداد المشروع", "Project default")}</option><option value="auto">{t("تلقائي", "Automatic")}</option><option value="cover">{t("ملخص وتفاصيل", "Summary and details")}</option><option value="detail">{t("التفاصيل فقط", "Details only")}</option>
        </select></Field>
        <fieldset className="pc-span" disabled={!canWrite}><legend>{t("الحقول الاختيارية في المستند", "Optional document fields")}</legend>
          <div className="pc-choice-grid">{Object.entries(optionalFields).map(([key, labels]) => <label className="pc-check" key={key}><input type="checkbox" checked={header.optional_fields?.[key] !== false} onChange={(event) => changeHeader("optional_fields", { ...header.optional_fields, [key]: event.target.checked })} />{t(...labels)}</label>)}</div>
        </fieldset>
      </div>
    </details>}
    {record?.history?.length > 0 && <details><summary>{t("سجل التدقيق", "Audit history")}</summary><div className="pc-table-scroll"><table className="pc-table"><thead><tr><th>{t("التاريخ", "Date")}</th><th>{t("المستخدم", "Actor")}</th><th>{t("الإجراء", "Action")}</th><th>{t("السبب", "Reason")}</th></tr></thead><tbody>{record.history.map((event) => <tr key={event.id}><td><bdi>{event.created_at}</bdi></td><td>{event.actor || event.actor_id || "—"}</td><td>{actionLabels[event.action] ? t(...actionLabels[event.action]) : event.action}</td><td>{event.reason}</td></tr>)}</tbody></table></div></details>}
    {master && <MasterEditor key={master.type} master={master} project={project} customer={customer} locations={locations} t={t} request={request} onClose={() => setMaster(null)} onSaved={(saved, continueToProject) => {
      refreshContext();
      setMaster(continueToProject ? { type: "project", name: "" } : null);
      if (master.type === "customer") scopeChange(saved, null);
      if (master.type === "project") scopeChange(customer, saved);
      if (master.type === "location") master.after?.(saved);
    }} canCreateProject={access.all_projects || access.allow_project_creation} />}
    {pendingScope && <Dialog t={t} title={t("مراجعة تغيير المشروع", "Review scope change")} onClose={() => setPendingScope(null)}>
      <p>{t("ستبقى الأوصاف والقياسات. ستحتاج إلى اختيار المواقع ومراجع البنود مرة أخرى في النطاق الجديد.", "Descriptions and measurements will stay. Locations and linked work references will need to be selected again in the new scope.")}</p>
      <div className="pc-toolbar"><button type="button" onClick={() => setPendingScope(null)}>{t("الاحتفاظ بالمسودة الحالية", "Keep current draft")}</button>
        <button type="button" className="primary" onClick={() => applyScope(pendingScope.customer, pendingScope.project)}>{t("تأكيد تغيير النطاق", "Confirm scope change")}</button></div>
    </Dialog>}
    {settingsOpen && <Dialog title={t("إعدادات المستخلص للمشروع", "Project certificate settings")} onClose={() => setSettingsOpen(false)} t={t} wide>
      <ProjectSettings request={request} project={project} canManage={can("manage_settings")} t={t} onProjectSaved={(saved) => {
        if (saved.id === project?.id) {
          setProject((current) => ({...current,...saved}));
          refreshContext();
          onChange?.();
        }
      }} onSaved={() => {
        refreshContext();
        if (canWrite && !historical) { refreshRules.current = true; setDirty(true); }
      }} />
    </Dialog>}
    {deleteDialog && <Dialog title={t("حذف المستخلص أو ملفاته", "Delete certificate or its files")} onClose={() => { if (!busy) setDeleteDialog(false); }} t={t}>
      <p>{t("حذف المستخلص نهائيًا يحذف كل مراجعاته وملفات PDF المؤرشفة. تبقى الدفعات المسجلة في حساب العميل.",
        "Permanently deleting this certificate removes its revisions and archived PDFs. Recorded payments stay in the customer account.")}</p>
      <Problem error={error} t={t} />
      <div className="pc-toolbar">
        {record.pdf_status && <button type="button" className="danger" disabled={busy} onClick={() => remove(true)}>{t("حذف ملفات PDF فقط", "Delete archived PDFs only")}</button>}
        <button type="button" className="danger" disabled={busy} onClick={() => remove(false)}>{t("حذف المستخلص نهائيًا", "Permanently delete certificate")}</button>
      </div>
    </Dialog>}
    {action && <Dialog title={t(...actionLabels[action])} onClose={() => { if (!busy) setAction(null); }} t={t}>
      <form className="pc-stack" onSubmit={(event) => { event.preventDefault(); workflow(action, actionReason); }}>
        {action === "approve" && <p>{t("يؤدي الاعتماد إلى قفل هذا المستخلص. تُسجل التغييرات اللاحقة في مستخلص تصحيح.", "Approval locks this certificate. Later changes are recorded in a correction.")}</p>}
        {action === "issue" && <p>{t("سيتم تخصيص رقم رسمي وحفظ البيانات المعتمدة وإعداد النسخة المؤرشفة.", "Issuance assigns an official number, freezes the approved data, and prepares the archived document.")}</p>}
        {action === "recover_advance" && <p>{t("يُنشئ هذا تصحيحًا لاسترداد الدفعة المقدمة مع الاحتفاظ بالكميات وتواريخ المستخلص المعتمد. راجع التصحيح ثم اعتمده.",
          "This creates an advance recovery correction using the approved quantities and dates. Review and approve the correction.")}</p>}
        {needsReason.has(action) && <Field label={t("السبب", "Reason")}><textarea required rows={3} dir="auto" value={actionReason} onChange={(event) => setActionReason(event.target.value)} /></Field>}
        <Problem error={error} t={t} />
        <div><button type="submit" className="primary" disabled={busy}>{t("تأكيد", "Confirm")}</button></div>
      </form>
    </Dialog>}
    {importDraft && <CertificateImport certificate={importDraft} request={request} t={t} locale={locale} currency={currency} canImport={can("import")} canAddLocation={canMaster} locations={locations} onClose={() => { setImportDraft(null); refreshContext(); }} onCommit={(result) => {
      applySaved(result, false); setImportDraft(null); refreshContext(); setStatusText(t("تم تحديث المسودة من المصدر المحدد.", "Draft updated from the selected source."));
    }} />}
    {preview && <CertificatePreview certificate={preview} apiBase={apiBase} session={session} t={t} canInternal={can("view_collections")} onClose={() => setPreview(null)} onAccessChanged={onAccessChanged} saveNativeReport={saveNativeReport} shareNativeReport={shareNativeReport} />}
  </section>;
}

function OperationalQuantities({quantities,t,onReview,busy}) {
  const warningLabels={
    excess:["يتجاوز المؤكد","Exceeds confirmed quantity"],
    duplicate:["احتمال تكرار المطالبة","Possible duplicate claim"],
    loaded_unclaimed:["محمل ولم يطالب به","Loaded and unclaimed"],
    incomplete:["لم تؤكد الكمية المنفذة / المستحقة","Installation / claimable quantity pending"],
    unit_mismatch:["وحدة البند مختلفة عن وحدة العقد","Unit differs from contractual unit"],
    loading_excess:["المطالبة تتجاوز التحميل المسجل","Claim exceeds recorded loading"],
  };
  const rows=quantities.filter((row)=>row.current||row.loaded||row.unclaimed||row.previous||Object.values(row.warning).some(Boolean));
  if (!rows.length&&!onReview) return null;
  return <details open={rows.some((row)=>row.current&&Object.values(row.warning).some(Boolean))||undefined}>
    <summary>{t("مراجعة كميات عمليات المشروع","Operational quantity reconciliation")}</summary>
    {onReview&&<div className="pc-toolbar"><button type="button" disabled={busy} onClick={onReview}>
      {t("مقارنة الكميات المدخلة","Compare entered quantities")}</button></div>}
    {rows.length>0&&<div className="pc-table-scroll"><table className="pc-table">
      <thead><tr>{[t("البند","Item"),t("الوحدة","Unit"),t("التحميل","Loaded panels"),t("التركيب المؤكد","Confirmed installed"),
        t("الكمية المستحقة المؤكدة","Confirmed claimable"),
        t("المطالب سابقًا","Previously claimed"),t("الحالي","Current claim"),t("غير مطالب به","Unclaimed"),t("تنبيهات","Warnings")]
        .map((name)=><th key={name}>{name}</th>)}</tr></thead>
      <tbody>{rows.map((row)=><tr key={row.id}><th scope="row">{row.code}</th><td>{row.unit}</td>
        {[row.loaded,row.installed,row.claimable,row.previous,row.current,row.unclaimed].map((value,index)=><td key={index}><bdi>{value}</bdi></td>)}
        <td>{Object.entries(row.warning).filter(([,value])=>value).map(([key,value])=><div key={key}>
          {t(...warningLabels[key])}{typeof value==="number"&&<> · <bdi>{value}</bdi></>}</div>)}</td></tr>)}</tbody>
    </table></div>}
  </details>;
}

function CalculationReview({ record, currency, t, locale, dirty }) {
  const totals = record.totals || {};
  const items = [
    ["previous", "الأعمال المعتمدة سابقًا", "Previous certified work"], ["current", "أعمال الفترة", "Current work"], ["cumulative", "الأعمال التراكمية", "Certified to date"],
    ["current_payable", "مستحق الفترة", "Current payable"], ["cumulative_payable", "الرصيد التراكمي", "Cumulative payable"],
  ];
  return <section className="pc-stack" aria-label={t("مراجعة الحساب", "Calculation review")}>
    {dirty && <p className="pc-caption">{t("تعكس هذه الأرقام آخر حسبة محفوظة.", "Amounts reflect the last saved calculation.")}</p>}
    <div className="pc-cards">{items.map(([key, ar, en]) => <div key={key} className={key.includes("payable") ? "pc-payable" : undefined}><span>{t(ar, en)}</span><strong><Money value={totals[key]} currency={currency} locale={locale} /></strong></div>)}</div>
    {totals.groups?.length > 0 && <div className="pc-table-scroll"><table className="pc-table"><thead><tr><th>{t("نوع الأعمال", "Work type")}</th>{record.baseline && <th>{t("قيمة آخر فترة", "Last period value")}</th>}<th>{t("السابق", "Previous")}</th><th>{t("الحالي", "Current")}</th><th>{t("التراكمي", "Cumulative")}</th></tr></thead><tbody>{totals.groups.map((group, index) => <tr key={index}>
      <th scope="row"><bdi>{group.work_type}</bdi></th>{record.baseline && <td><Money value={group.last_current} currency={currency} locale={locale} /></td>}<td><Money value={group.previous} currency={currency} locale={locale} /></td><td><Money value={group.current} currency={currency} locale={locale} /></td><td><Money value={group.cumulative} currency={currency} locale={locale} /></td>
    </tr>)}</tbody></table></div>}
    {totals.components?.length > 0 && <div className="pc-table-scroll"><table className="pc-table"><thead><tr><th>{t("العنصر المالي", "Financial component")}</th><th>{t("أساس الحساب", "Calculation basis")}</th><th>{t("القيمة", "Amount")}</th></tr></thead><tbody>{totals.components.map((item, index) => <tr key={index}><th scope="row">{item.label || item.category}</th><td><Money value={item.base ?? item.basis_amount} currency={currency} locale={locale} /></td><td><Money value={item.amount ?? item.current} currency={currency} locale={locale} /></td></tr>)}</tbody></table></div>}
  </section>;
}

function MasterEditor({ master, project, customer, locations, t, request, onClose, onSaved, canCreateProject }) {
  const [draft, setDraft] = useState(() => ({ name: master.name || "", kind: "building", category: "corporate", currency: project?.currency || "EGP" }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const types = { customer: ["إضافة عميل", "Add customer"], project: ["إضافة مشروع", "Add project"], location: ["إضافة مبنى أو وحدة", "Add building or unit"] };
  const change = (key,value) => setDraft((current) => ({...current,[key]:value}));
  const input = (key, label, props = {}) => <Field label={label}><input dir="auto" {...props} value={draft[key] || ""} onChange={(event) => change(key,event.target.value)} /></Field>;
  async function save(event) {
    event.preventDefault(); setBusy(true); setError(null);
    const next = event.nativeEvent.submitter?.value === "project";
    try {
      const route = master.type === "location" ? `/projects/${project.id}/locations` : `/${master.type === "customer" ? "customers" : "projects"}`;
      const saved = await request(route, { method: "POST", body: { ...draft, name: draft.name.trim(), ...(master.type === "project" ? { customer_id: customer.id } : {}) } });
      onSaved(saved[master.type] || saved, next);
    } catch (cause) { setError(cause); } finally { setBusy(false); }
  }
  return <Dialog title={t(...types[master.type])} onClose={() => { if (!busy) onClose(); }} t={t}>
    <form className="pc-stack" onSubmit={save}>
      {master.type === "project" ? <ProjectDetailsFields draft={draft} onChange={change} t={t} creating /> : <div className="pc-form">
        {input("name", t("الاسم الرسمي", "Official name"), { required: true, autoFocus: true })}
        {master.type !== "location" && input("alternate_name", t("الاسم باللغة الأخرى", "Name in other language"))}
        {master.type === "customer" ? input("code", t("رمز العميل", "Customer code"), {dir:"ltr",placeholder:t("يُعيّن تلقائيًا", "Assigned automatically")})
          : input("code", t("الرمز", "Code"))}
        {master.type !== "location" && input("address", t("العنوان", "Address"))}
        {master.type === "customer" && <>
          <Field label={t("نوع العميل", "Customer type")}><select value={draft.category} onChange={(event) => setDraft((value) => ({ ...value, category: event.target.value }))}><option value="corporate">{t("شركة", "Company")}</option><option value="retail">{t("فرد", "Individual")}</option></select></Field>
          {input("tax_no", t("رقم التسجيل الضريبي", "Tax registration number"))}
          {input("print_contact", t("جهة الاتصال على المستند", "Contact for printing"))}
        </>}
        {master.type === "location" && <>
          <Field label={t("نوع الموقع", "Location kind")}><select value={draft.kind} onChange={(event) => setDraft((value) => ({ ...value, kind: event.target.value }))}>
            <option value="building">{t("مبنى", "Building")}</option><option value="block">{t("بلوك", "Block")}</option><option value="floor">{t("طابق", "Floor")}</option><option value="unit">{t("وحدة", "Unit")}</option><option value="site">{t("موقع", "Site")}</option><option value="other">{t("أخرى", "Other")}</option>
          </select></Field>
          <Field label={t("الموقع الأعلى", "Parent location")}><select value={draft.parent_id || ""} onChange={(event) => setDraft((value) => ({ ...value, parent_id: event.target.value }))}><option value="">—</option>{locations.map((location) => <option key={location.id} value={location.id}>{optionLabel(location)}</option>)}</select></Field>
        </>}
      </div>}
      <Problem error={error} t={t} />
      <div className="pc-toolbar"><button type="submit" className="primary" disabled={busy}>{t("حفظ واستخدام", "Save and use")}</button>
        {master.type === "customer" && canCreateProject && <button type="submit" value="project" disabled={busy}>{t("حفظ وإضافة مشروع", "Save and add project")}</button>}</div>
    </form>
  </Dialog>;
}
