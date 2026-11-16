import { useMemo, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { Combobox, Dialog, Field, localDate, locationOptions, Money, newKey, numberText, optionLabel, Problem, queryString, ReportGroupingChecks, Status, useDebounce, useResource } from "./shared.jsx";
import "./certificates.css";

export function ProjectPicker({ value, onSelect, request, t, disabled }) {
  const [search, setSearch] = useState("");
  const query = useDebounce(search);
  const { data, error } = useResource(request, `/projects${queryString({ q: query })}`);
  return <div className="pc-stack">
    <Combobox label={t("المشروع", "Project")} selected={value} options={data || []} onSelect={onSelect}
      onSearch={setSearch} onClear={() => { onSelect(null); setSearch(""); }} disabled={disabled} t={t} />
    <Problem error={error} t={t} />
  </div>;
}

const categoryLabels = {
  vat: ["ضريبة القيمة المضافة", "VAT"], retention: ["احتجاز الضمان", "Retention"],
  contractor_withholding: ["خصم تحت حساب الضريبة", "Contractor withholding"],
  engineering_stamp: ["دمغة هندسية", "Engineering stamp"], social_insurance: ["تأمينات اجتماعية", "Social insurance"],
  works_insurance: ["تأمين الأعمال", "Works insurance"], other: ["تسوية أخرى", "Other adjustment"],
  advance_recovery: ["استرداد الدفعة المقدمة", "Advance recovery"],
};

export function ProjectSettings({ request, project: startProject, canManage, t, onSaved }) {
  const [choice, setChoice] = useState(startProject || null);
  const [reload, setReload] = useState(0);
  const project = useResource(request, choice?.id ? `/projects/${choice.id}` : null, reload);
  return <section className="pc-panel pc-stack">
    <div className="pc-toolbar"><h2>{t("إعدادات المشروع", "Project settings")}</h2></div>
    <ProjectPicker value={choice} onSelect={setChoice} request={request} t={t} />
    <Problem error={project.error} t={t} />
    {project.pending && <p role="status">{t("جارٍ تحميل الإعدادات…", "Loading settings…")}</p>}
    {project.data && <SettingsForm key={`${choice.id}-${reload}`} project={project.data} request={request} canManage={canManage} t={t} onSaved={async () => {
      setReload((version) => version + 1);
      await onSaved?.();
    }} />}
  </section>;
}

function SettingsForm({ project, request, canManage, t, onSaved }) {
  const profile = project.settings || {};
  const settings = profile.settings || {};
  const [draft, setDraft] = useState(() => {
    const oldGroup = settings.group_by ?? (settings.group_work_types ? "work_type" : "none");
    return {...settings,group_work_types:oldGroup === "work_type",
      show_building_subtotals:settings.show_building_subtotals ?? (settings.show_group_subtotals && oldGroup === "building"),
      show_unit_subtotals:settings.show_unit_subtotals ?? (settings.show_group_subtotals && oldGroup === "unit"),
      show_work_type_subtotals:settings.show_work_type_subtotals ?? (settings.show_group_subtotals && oldGroup === "work_type")};
  });
  const [ruleDraft, setRuleDraft] = useState(() => (profile.rules || []).map((rule) => ({ ...rule, key: newKey() })));
  const [types, setTypes] = useState(() => (settings.work_types || project.work_types || []).map((type) => typeof type === "string" ? type : optionLabel(type)).filter(Boolean).join("\n"));
  const [signatures, setSignatures] = useState(() => (settings.signatures || []).map((person) => ({...person, key: newKey()})));
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState(null);
  const [reason, setReason] = useState("");
  const [effectiveAt, setEffectiveAt] = useState(localDate);

  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const updateRule = (key, field, value) => setRuleDraft((rules) => rules.map((rule) => rule.key === key ? { ...rule, [field]: value } : rule));
  const advanceRule = ruleDraft.find((rule) => rule.category === "advance_recovery");
  const taxRules = ruleDraft.filter((rule) => rule.category !== "advance_recovery" ||
    rule.basis === "running" || rule.amount != null || rule.cap != null);

  function updateAdvanceRate(rate) {
    setRuleDraft((rules) => {
      const index = rules.findIndex((rule) => rule.category === "advance_recovery");
      const replacement = {category:"advance_recovery",basis:"work",sign:"deduction",rate,enabled:rate !== "",
        key:rules[index]?.key || newKey()};
      if (index < 0) return [...rules,replacement];
      return rules.map((rule,position) => position === index ? replacement : rule);
    });
  }
  async function save(event) {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      const workTypes = types.split("\n").map((value) => value.trim()).filter(Boolean);
      await request(`/projects/${project.id}/settings`, { method: "PUT", body: {
        expected_version: profile.latest_version ?? profile.version ?? 0,
        reason, effective_at: effectiveAt,
        rules: ruleDraft.map(({ key, ...rule }) => ({ ...rule, rate: numberText(rule.rate), amount: numberText(rule.amount), cap: numberText(rule.cap) })),
        work_types: workTypes,
        settings: { ...draft, minimum_area: draft.minimum_area === "" || draft.minimum_area == null ? "inherit" : numberText(draft.minimum_area), quantity_precision: draft.quantity_precision === "" ? "inherit" : draft.quantity_precision, count_precision: draft.count_precision === "" ? "inherit" : draft.count_precision, work_types: workTypes,
          signatures: signatures.map(({ name, title }) => ({ name, title })),
        },
      } });
      await onSaved();
    } catch (cause) { setError(cause); } finally { setBusy(false); }
  }

  return <div className="pc-stack">
    <div className="pc-toolbar"><span className="pc-chip">{t("إصدار الإعدادات", "Profile version")} <bdi>&nbsp;{profile.version ?? 0}</bdi></span>
      <span className="pc-caption">{profile.version ? t("قواعد المشروع", "Project rules") : t("القيم الموروثة", "Inherited defaults")}</span></div>
    <fieldset disabled={!canManage || busy}>
      <legend>{t("القياس والعرض", "Measurement and presentation")}</legend>
      <div className="pc-form">
        <Field label={t("الحد الأدنى للمساحة لكل قطعة (م²)", "Per-piece minimum area (m²)")}><input inputMode="decimal" dir="ltr" value={draft.minimum_area ?? ""} onChange={(event) => update("minimum_area", event.target.value)} placeholder={t("موروث", "Inherit")} /></Field>
        <Field label={t("منازل تقريب الكميات", "Quantity decimal places")}><select value={draft.quantity_precision ?? ""} onChange={(event) => update("quantity_precision", event.target.value)}><option value="">{t("موروث", "Inherit")}</option>{[0,1,2,3,4,5,6].map((place) => <option key={place} value={place}>{place}</option>)}</select></Field>
        <Field label={t("منازل تقريب العدد", "Count decimal places")}><select value={draft.count_precision ?? ""} onChange={(event) => update("count_precision", event.target.value)}><option value="">{t("موروث", "Inherit")}</option>{[0,1,2,3,4,5,6].map((place) => <option key={place} value={place}>{place}</option>)}</select></Field>
        <Field label={t("أساس احتساب التحصيلات", "Collection basis")}><select value={draft.collections_basis ?? ""} onChange={(event) => update("collections_basis", event.target.value)}><option value="">{t("موروث", "Inherit")}</option><option value="received">{t("تاريخ الاستلام", "Receipt date")}</option><option value="cleared">{t("تاريخ التحصيل", "Clearance date")}</option></select></Field>
        <Field label={t("الإخراج الافتراضي", "Default output")}><select value={draft.output_mode ?? ""} onChange={(event) => update("output_mode", event.target.value)}><option value="">{t("موروث", "Inherit")}</option><option value="auto">{t("تلقائي", "Automatic")}</option><option value="cover">{t("ملخص وتفاصيل", "Summary and details")}</option><option value="detail">{t("التفاصيل فقط", "Details only")}</option></select></Field>
        <Field label={t("أنواع الأعمال بالترتيب، نوع في كل سطر", "Work types in order, one per line")} className="pc-span"><textarea rows={3} value={types} onChange={(event) => setTypes(event.target.value)} /></Field>
        <ReportGroupingChecks values={draft} t={t} onChange={(key,checked) => {
          if (key === "group_work_types") setDraft((current) => ({...current,[key]:checked,group_by:checked ? "work_type" : "none"}));
          else update(key,checked);
        }} />
      </div>
    </fieldset>
    <fieldset disabled={!canManage || busy}>
      <legend>{t("توقيعات المستخلص", "Certificate signatures")}</legend>
      {signatures.map((person) => <div className="pc-toolbar" key={person.key}>
        <Field label={t("اسم الموقّع", "Signatory name")}><input dir="auto" value={person.name} onChange={(event) => setSignatures((rows) => rows.map((row) => row.key === person.key ? {...row, name: event.target.value} : row))} /></Field>
        <Field label={t("المسمى", "Title")}><input dir="auto" value={person.title} onChange={(event) => setSignatures((rows) => rows.map((row) => row.key === person.key ? {...row, title: event.target.value} : row))} /></Field>
        {canManage && <button type="button" onClick={() => setSignatures((rows) => rows.filter((row) => row.key !== person.key))}>{t("إزالة", "Remove")}</button>}
      </div>)}
      {canManage && signatures.length < 6 && <button type="button" onClick={() => setSignatures((rows) => [...rows, { key: newKey(), name: "", title: "" }])}>{t("إضافة موقّع", "Add signatory")}</button>}
    </fieldset>
    <fieldset disabled={!canManage || busy}>
      <legend>{t("الضرائب والاستقطاعات", "Taxes and deductions")}</legend>
      <div className="pc-advance-settings">
        <Field label={t("نسبة استرداد الدفعة المقدمة تلقائيًا (%)","Automatic advance recovery (%)")}>
          <input dir="ltr" inputMode="decimal" placeholder="0" value={advanceRule?.enabled === false ? "" : advanceRule?.rate ?? ""}
            onChange={(event) => updateAdvanceRate(event.target.value)} />
        </Field>
        <p className="pc-caption">{t("تُخصم النسبة من قيمة أعمال كل مستخلص حتى استرداد رصيد الدفعة بالكامل.",
          "Deduct this percentage of each certificate’s current work value until the advance is recovered.")}</p>
      </div>
      {taxRules.map((rule, index) => <div className="pc-rule pc-stack" key={rule.key}>
        <div className="pc-toolbar"><strong>{t("قاعدة", "Rule")} <bdi>{index + 1}</bdi></strong>
          <label className="pc-check"><input type="checkbox" checked={rule.enabled !== false && rule.enabled !== 0} onChange={(event) => updateRule(rule.key, "enabled", event.target.checked)} />{t("مفعّلة", "Enabled")}</label>
          {canManage && <button type="button" aria-label={t("حذف قاعدة", "Delete rule")} onClick={() => setRuleDraft((rows) => rows.filter((item) => item.key !== rule.key))}><Trash2 size={16} /></button>}
        </div>
        <div className="pc-form">
          <Field label={t("الفئة", "Category")}><select value={rule.category} onChange={(event) => updateRule(rule.key, "category", event.target.value)}>
            {Object.entries(categoryLabels).filter(([value]) => value !== "advance_recovery" || rule.category === value || !advanceRule)
              .map(([value, labels]) => <option key={value} value={value}>{t(...labels)}</option>)}
          </select></Field>
          <Field label={t("اسم القاعدة", "Rule label")}><input dir="auto" value={rule.label || ""} onChange={(event) => updateRule(rule.key, "label", event.target.value)} /></Field>
          <Field label={t("النسبة %", "Rate %")}><input dir="ltr" inputMode="decimal" value={rule.rate ?? ""} onChange={(event) => updateRule(rule.key, "rate", event.target.value)} /></Field>
          <Field label={t("مبلغ ثابت", "Fixed amount")}><input dir="ltr" inputMode="decimal" value={rule.amount ?? ""} onChange={(event) => updateRule(rule.key, "amount", event.target.value)} /></Field>
          <Field label={t("الحد الأقصى", "Cap")}><input dir="ltr" inputMode="decimal" value={rule.cap ?? ""} onChange={(event) => updateRule(rule.key, "cap", event.target.value)} /></Field>
          <Field label={t("أساس الحساب", "Calculation basis")}><select value={rule.basis || "work"} onChange={(event) => updateRule(rule.key, "basis", event.target.value)}><option value="work">{t("قيمة الأعمال", "Work value")}</option><option value="running">{t("الرصيد بعد القواعد السابقة", "Balance after earlier rules")}</option></select></Field>
          <Field label={t("الأثر", "Effect")}><select value={rule.sign || "deduction"} onChange={(event) => updateRule(rule.key, "sign", event.target.value)}><option value="addition">{t("إضافة", "Addition")}</option><option value="deduction">{t("خصم", "Deduction")}</option></select></Field>
        </div>
      </div>)}
      {!taxRules.length && <p className="pc-caption">{t("لم تضاف ضرائب أو استقطاعات إضافية.", "No additional taxes or deductions are listed.")}</p>}
      {canManage && <div><button type="button" onClick={() => setRuleDraft((rows) => [...rows, { key: newKey(), category: "vat", enabled: true, basis: "work", sign: "addition" }])}><Plus size={17} />{t("إضافة قاعدة", "Add rule")}</button></div>}
    </fieldset>
    {canManage && <div><button className="primary" type="button" onClick={() => { setError(null); setConfirm(true); }}><Save size={16} />{t("مراجعة إصدار الإعدادات", "Review settings version")}</button></div>}
    {confirm && <Dialog title={t("حفظ إصدار إعدادات المشروع", "Save project settings version")} onClose={() => { if (!busy) setConfirm(false); }} t={t}>
      <form className="pc-stack" onSubmit={save}>
        <p>{t("سيستخدم تقييم المسودات القواعد النافذة لهذا المشروع بعد حفظ الإصدار.", "Draft valuation will use the rules effective for this project once this version is saved.")}</p>
        <Field label={t("بداية السريان", "Effective date")}><input type="date" required dir="ltr" value={effectiveAt} onChange={(event) => setEffectiveAt(event.target.value)} /></Field>
        <Field label={t("سبب التغيير", "Reason for change")}><textarea required value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
        <Problem error={error} t={t} />
        <button type="submit" className="primary" disabled={busy}>{t("حفظ إصدار", "Save version")}</button>
      </form>
    </Dialog>}
  </div>;
}

const kinds = { receipt: ["تحصيل عادي", "Ordinary receipt"], advance: ["دفعة مقدمة", "Advance receipt"], reversal: ["عكس تحصيل", "Reversal"] };

export function Collections({ request, canEdit, canDelete, locale, t, onAccessChanged }) {
  const [project, setProject] = useState(null);
  const [cutoff, setCutoff] = useState(localDate);
  const [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState(null);
  const [changeError, setChangeError] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const ledger = useResource(request, project ? `/projects/${project.id}/collections${queryString({ cutoff })}` : null, revision);
  const context = useResource(request, project ? `/projects/${project.id}` : null);
  const certificates = useResource(request, project && editor ? `/${queryString({ project_id: project.id, status: "issued" })}` : null);
  const currency = project?.currency || context.data?.currency;
  const locations = useMemo(() => locationOptions(context.data?.locations), [context.data?.locations]);
  const data = ledger.data;
  async function deleteReceipt(receipt) {
    if (deleting || !window.confirm(t("هل تريد حذف هذه الدفعة نهائيًا؟", "Permanently delete this payment?"))) return;
    setChangeError(null);
    setDeleting(true);
    try {
      await request(`/projects/${project.id}/collections/${receipt.id}`, {method:"DELETE"});
      setRevision((current) => current + 1);
    } catch (error) {
      setChangeError(error);
    } finally { setDeleting(false); }
  }
  return <section className="pc-panel pc-stack">
    <div className="pc-toolbar"><h2>{t("التحصيلات", "Collections")}</h2>
      {canEdit && <button type="button" className="primary" disabled={!project} onClick={() => setEditor({ kind: "receipt" })}><Plus size={16} />{t("تسجيل تحصيل", "Record receipt")}</button>}</div>
    <div className="pc-form">
      <ProjectPicker value={project} onSelect={setProject} request={request} t={t} />
      <Field label={t("تاريخ قطع التحصيلات", "Collections cutoff")}><input type="date" dir="ltr" value={cutoff} onChange={(event) => setCutoff(event.target.value)} /></Field>
    </div>
    <Problem error={changeError || ledger.error || context.error} t={t} />
    {ledger.pending && <p role="status">{t("جارٍ تحميل التحصيلات…", "Loading collections…")}</p>}
    {data && <>
      <div className="pc-cards">
        <div><span>{t("التحصيلات المحتسبة", "Recognized collections")}</span><strong><Money value={data.ordinary_collections} locale={locale} currency={currency} /></strong></div>
        <div><span>{t("رصيد غير موزع", "Unapplied balance")}</span><strong><Money value={data.unapplied} locale={locale} currency={currency} /></strong></div>
        <div><span>{t("تاريخ القطع", "Cutoff")}</span><strong><bdi>{data.cutoff || cutoff}</bdi></strong></div>
      </div>
      <LedgerTable data={data} canEdit={canEdit} canDelete={canDelete} deleting={deleting} t={t} locale={locale} currency={currency} locations={locations}
        onReverse={(receipt) => setEditor({ kind: "reversal", receipt })} onDelete={deleteReceipt}
        onFollowup={(action, receipt) => { setChangeError(null); setEditor({ action, receipt }); }} />
    </>}
    {!project && <div className="pc-empty">{t("اختر مشروعًا لعرض تحصيلاته.", "Select a project to see its collections.")}</div>}
    {editor && project && <ReceiptEditor data={editor} project={project} locations={locations} certificates={certificates.data?.items || []} t={t} request={request} currency={currency} onClose={() => setEditor(null)} onSaved={() => {
      setEditor(null); setRevision((current) => current + 1);
    }} onAccessChanged={onAccessChanged} />}
  </section>;
}

function LedgerTable({ data, canEdit, canDelete, deleting, t, locale, currency, locations, onReverse, onFollowup, onDelete }) {
  const reversed = new Set((data.receipts || []).filter((row) => row.kind === "reversal").map((row) => row.reverses_id));
  const allocated = new Map();
  for (const row of data.allocations || []) allocated.set(row.receipt_id, (allocated.get(row.receipt_id) || 0) + row.amount_minor);
  return <>
    <div className="pc-table-scroll"><table className="pc-table"><thead><tr><th>{t("التاريخ", "Date")}</th><th>{t("النوع", "Type")}</th><th>{t("المرجع", "Reference")}</th><th>{t("الحالة", "Status")}</th><th>{t("المبلغ", "Amount")}</th><th>{t("الإجراء", "Action")}</th></tr></thead>
      <tbody>{(data.receipts || []).map((receipt) => <tr key={receipt.id}>
        <td><bdi>{receipt.received_at}</bdi></td><td>{kinds[receipt.kind] ? t(...kinds[receipt.kind]) : receipt.kind}</td><td><bdi>{receipt.reference || "—"}</bdi></td><td><Status t={t} value={receipt.status} /></td>
        <td><Money value={receipt.amount} locale={locale} currency={receipt.currency || currency} /></td><td><div className="pc-toolbar">
          {canEdit && receipt.source !== "payment" && receipt.kind !== "reversal" && !reversed.has(receipt.id) &&
            <button type="button" onClick={() => onFollowup("edit", receipt)}>{t("تعديل الدفعة", "Edit payment")}</button>}
          {canDelete && receipt.source !== "payment" && !reversed.has(receipt.id) &&
            <button type="button" className="danger" disabled={deleting} onClick={() => onDelete(receipt)}>{t("حذف الدفعة", "Delete payment")}</button>}
          {canEdit && !receipt.source && !reversed.has(receipt.id) && receipt.status !== "cleared" && <button type="button" onClick={() => onFollowup("clear", receipt)}>{t("تأكيد التحصيل", "Mark cleared")}</button>}
          {canEdit && !receipt.source && receipt.kind !== "reversal" && !reversed.has(receipt.id) && <>
            {receipt.amount_minor > (allocated.get(receipt.id) || 0) && <button type="button" onClick={() => onFollowup("allocate", receipt)}>{t("توزيع", "Allocate")}</button>}
            <button type="button" onClick={() => onReverse(receipt)}>{t("عكس", "Reverse")}</button>
          </>}
        </div></td>
      </tr>)}</tbody></table>{!data.receipts?.length && <p className="pc-empty">{t("لا توجد تحصيلات مسجلة لهذا التاريخ.", "No receipts are recorded by this cutoff.")}</p>}</div>
    {data.allocations?.length > 0 && <details><summary>{t("تفاصيل توزيع التحصيلات", "Allocation history")}</summary><div className="pc-table-scroll"><table className="pc-table"><thead><tr><th>{t("التحصيل", "Receipt")}</th><th>{t("الموقع", "Location")}</th><th>{t("المستخلص", "Certificate")}</th><th>{t("المبلغ", "Amount")}</th></tr></thead><tbody>{data.allocations.map((row) => <tr key={row.id}>
      <td><bdi>{row.receipt_id}</bdi></td><td>{optionLabel(locations.find((item) => item.id === row.location_id)) || t("على مستوى المشروع", "Project-wide")}</td><td><bdi>{row.certificate_id || "—"}</bdi></td><td><Money value={row.amount} currency={currency} locale={locale} /></td>
    </tr>)}</tbody></table></div></details>}
    {data.advances?.length > 0 && <details><summary>{t("الدفعات المقدمة", "Contract advances")}</summary><div className="pc-table-scroll"><table className="pc-table"><thead><tr><th>{t("التحصيل", "Receipt")}</th><th>{t("أصل الدفعة", "Principal")}</th><th>{t("المسترد", "Recovered")}</th><th>{t("المتبقي", "Outstanding")}</th></tr></thead><tbody>{data.advances.map((row) => <tr key={row.id || row.receipt_id}>
      <td><bdi>{row.reference || row.receipt_id}</bdi></td><td><Money value={row.principal || row.amount} currency={currency} locale={locale} /></td><td><Money value={row.recovered} currency={currency} locale={locale} /></td><td><Money value={row.outstanding} currency={currency} locale={locale} /></td>
    </tr>)}</tbody></table></div></details>}
  </>;
}

export function ReceiptEditor({ data, project, locations = [], certificates = [], t, request, currency, onClose, onSaved, onAccessChanged }) {
  const [commandKey] = useState(newKey);
  const [draft, setDraft] = useState(() => {
    const today = localDate();
    const actionDate = data.receipt?.received_at > today ? data.receipt.received_at : today;
    if (data.action === "edit") {
      const receipt = data.receipt;
      return {kind:receipt.kind,received_at:receipt.received_at,due_at:receipt.due_at || "",cleared_at:receipt.cleared_at || "",
        method:receipt.method || "",reference:receipt.reference || "",evidence:receipt.evidence || "",amount:receipt.amount,
        status:receipt.status,allocations:[]};
    }
    return { kind: data.kind, received_at: actionDate, allocated_at: actionDate, due_at: "", cleared_at: data.action === "clear" ? actionDate : "", method: "", reference: "", evidence: "", amount: data.receipt?.amount ?? "", status: "received", allocations: data.action === "allocate" ? [{ key: newKey(), amount: "" }] : [] };
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const change = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const reverse = draft.kind === "reversal";
  const isEdit = data.action === "edit";
  const followup = isEdit ? null : data.action;
  const allocationEdit = (key, field, value) => change("allocations", draft.allocations.map((row) => row.key === key ? { ...row, [field]: value } : row));
  async function save(event) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const allocations = draft.allocations.map(({ key, amount, ...row }) => ({ ...row, amount: numberText(amount) }));
      const endpoint = `/projects/${project.id}/collections`;
      if (isEdit) {
        const {allocations:_, ...changes} = draft;
        await request(`${endpoint}/${data.receipt.id}`, {method:"PATCH",body:{...changes,amount:numberText(changes.amount)}});
        onSaved();
        return;
      }
      const body = followup
        ? { action: followup, cleared_at: draft.cleared_at, allocated_at: draft.allocated_at, allocations }
        : { ...draft, currency, amount: numberText(draft.amount), reverses_id: data.receipt?.id, allocations };
      await request(followup ? `${endpoint}/${data.receipt.id}/action` : endpoint, { method: "POST", body: { ...body, command_key: commandKey } });
      onSaved();
    } catch (cause) {
      setError(cause);
      if ([401, 403].includes(cause.status)) onAccessChanged?.();
    } finally { setBusy(false); }
  }
  const title = isEdit ? t("تعديل الدفعة", "Edit payment") : followup === "clear" ? t("تأكيد التحصيل", "Mark cleared") : followup === "allocate" ? t("توزيع التحصيل", "Allocate receipt") : reverse ? t("عكس تحصيل", "Reverse receipt") : t("تسجيل تحصيل", "Record collection");
  return <Dialog title={title} t={t} onClose={() => { if (!busy) onClose(); }}>
    <form className="pc-stack" onSubmit={save}>
      {followup === "clear" && <Field label={t("تاريخ التحصيل", "Clearance date")}><input type="date" dir="ltr" value={draft.cleared_at} min={data.receipt.received_at} required onChange={(event) => change("cleared_at", event.target.value)} /></Field>}
      {followup === "allocate" && <Field label={t("تاريخ التوزيع", "Allocation date")}><input type="date" dir="ltr" value={draft.allocated_at} min={data.receipt.received_at} required onChange={(event) => change("allocated_at", event.target.value)} /></Field>}
      {!followup && <div className="pc-form">
        {!reverse && <Field label={t("نوع التحصيل", "Receipt type")}><select value={draft.kind} onChange={(event) => change("kind", event.target.value)}><option value="receipt">{t(...kinds.receipt)}</option><option value="advance">{t(...kinds.advance)}</option></select></Field>}
        <Field label={t("المبلغ", "Amount")}><input value={draft.amount} dir="ltr" inputMode="decimal" required readOnly={reverse} onChange={(event) => change("amount", event.target.value)} /></Field>
        <Field label={reverse ? t("تاريخ العكس", "Reversal date") : t("تاريخ الاستلام", "Received date")}><input type="date" dir="ltr" value={draft.received_at} required onChange={(event) => change("received_at", event.target.value)} /></Field>
        {!reverse && <Field label={t("تاريخ الاستحقاق", "Due date")}><input type="date" dir="ltr" value={draft.due_at} onChange={(event) => change("due_at", event.target.value)} /></Field>}
        <Field label={t("تاريخ التحصيل", "Clearance date")}><input type="date" dir="ltr" value={draft.cleared_at} required={draft.status === "cleared"} onChange={(event) => change("cleared_at", event.target.value)} /></Field>
        <Field label={t("الحالة", "Status")}><select value={draft.status} onChange={(event) => change("status", event.target.value)}>{!reverse && <option value="pending">{t("معلق", "Pending")}</option>}<option value="received">{t("مستلم", "Received")}</option><option value="cleared">{t("تم التحصيل", "Cleared")}</option></select></Field>
        {!reverse && <Field label={t("الطريقة", "Method")}><input dir="auto" value={draft.method} onChange={(event) => change("method", event.target.value)} /></Field>}
        <Field label={t("المرجع", "Reference")}><input dir="auto" value={draft.reference} required={reverse} onChange={(event) => change("reference", event.target.value)} /></Field>
        <Field label={t("مرجع المستند المؤيد", "Supporting evidence reference")}><input dir="auto" value={draft.evidence} onChange={(event) => change("evidence", event.target.value)} /></Field>
      </div>}
      {!isEdit && !reverse && followup !== "clear" && <fieldset>
        <legend>{t("توزيع المبلغ", "Allocations")}</legend>
        {draft.allocations.map((row, index) => <div className="pc-form" key={row.key}>
          <Field label={t("الموقع", "Location")}><select value={row.location_id || ""} onChange={(event) => allocationEdit(row.key, "location_id", event.target.value)}><option value="">{t("المشروع بالكامل", "Project-wide")}</option>{locations.map((location) => <option key={location.id} value={location.id}>{optionLabel(location)}</option>)}</select></Field>
          <Field label={t("المستخلص", "Certificate")}><select value={row.certificate_id || ""} onChange={(event) => allocationEdit(row.key, "certificate_id", event.target.value)}><option value="">{t("بدون مستخلص محدد", "Any certificate")}</option>{certificates.map((certificate) => <option key={certificate.id} value={certificate.id}>{certificate.official_number || certificate.id}</option>)}</select></Field>
          <Field label={`${t("المبلغ", "Amount")} ${index + 1}`}><input value={row.amount} dir="ltr" inputMode="decimal" required onChange={(event) => allocationEdit(row.key, "amount", event.target.value)} /></Field>
          <button type="button" onClick={() => change("allocations", draft.allocations.filter((item) => item.key !== row.key))}>{t("حذف التوزيع", "Remove allocation")}</button>
        </div>)}
        <button type="button" onClick={() => change("allocations", [...draft.allocations, { key: newKey(), amount: "" }])}><Plus size={16} />{t("إضافة توزيع", "Add allocation")}</button>
      </fieldset>}
      <Problem error={error} t={t} />
      <div><button className="primary" type="submit" disabled={busy || followup === "allocate" && !draft.allocations.length}>{followup || isEdit ? t("حفظ التغيير", "Save change") : reverse ? t("تأكيد العكس", "Confirm reversal") : t("حفظ التحصيل", "Save receipt")}</button></div>
    </form>
  </Dialog>;
}

export function Reports({ request, t, locale, onOpen }) {
  const [project, setProject] = useState(null);
  const [workCutoff, setWorkCutoff] = useState(localDate);
  const [collectionCutoff, setCollectionCutoff] = useState(localDate);
  const report = useResource(request, `/reports${queryString({ project_id: project?.id, work_cutoff: workCutoff, collection_cutoff: collectionCutoff })}`);
  const currencyTotals = Object.entries(report.data?.currencies || {});
  return <section className="pc-panel pc-stack">
    <h2>{t("تقارير المستخلصات", "Certificate reports")}</h2>
    <div className="pc-form">
      <ProjectPicker value={project} onSelect={setProject} request={request} t={t} />
      <Field label={t("تاريخ قطع الأعمال", "Work cutoff")}><input type="date" dir="ltr" value={workCutoff} onChange={(event) => setWorkCutoff(event.target.value)} /></Field>
      <Field label={t("تاريخ قطع التحصيلات", "Collections cutoff")}><input type="date" dir="ltr" value={collectionCutoff} onChange={(event) => setCollectionCutoff(event.target.value)} /></Field>
    </div>
    <Problem error={report.error} t={t} />
    {report.pending && <p role="status">{t("جارٍ حساب التقرير…", "Calculating report…")}</p>}
    {currencyTotals.map(([currency, totals]) => <div className="pc-cards" key={currency}>
      <div><span>{t("الأعمال المعتمدة حتى التاريخ", "Certified work to date")}</span><strong><Money value={totals.cumulative} locale={locale} currency={currency} /></strong></div>
      <div><span>{t("التحصيلات المحتسبة", "Recognized collections")}</span><strong><Money value={totals.ordinary_collections ?? totals.collections} locale={locale} currency={currency} /></strong></div>
      <div className="pc-payable"><span>{t("الرصيد المستحق", "Outstanding balance")}</span><strong><Money value={totals.current_payable ?? totals.payable ?? totals.balance ?? totals.cumulative_payable} locale={locale} currency={currency} /></strong></div>
    </div>)}
    {report.data && <div className="pc-table-scroll"><table className="pc-table"><thead><tr><th>{t("المشروع", "Project")}</th><th>{t("الأعمال المعتمدة", "Certified work")}</th><th>{t("التحصيلات المحتسبة", "Recognized collections")}</th><th>{t("الرصيد المستحق", "Outstanding balance")}</th></tr></thead>
      <tbody>{(report.data.items || []).map((item) => <tr key={item.project_id}>
        <th scope="row"><button type="button" className="pc-name" onClick={() => onOpen({ id: item.project_id, name: item.project_name, currency: item.currency })}><bdi>{item.project_name}</bdi></button></th>
        <td><Money value={item.cumulative} locale={locale} currency={item.currency} /></td><td><Money value={item.ordinary_collections} locale={locale} currency={item.currency} /></td>
        <td><Money value={item.cumulative_payable} locale={locale} currency={item.currency} /></td>
      </tr>)}</tbody></table>{!report.data.items?.length && <p className="pc-empty">{t("لا توجد نتائج لهذا النطاق.", "No results for this scope.")}</p>}</div>}
  </section>;
}
