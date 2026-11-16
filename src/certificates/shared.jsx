import { cloneElement, isValidElement, useEffect, useId, useMemo, useRef, useState } from "react";
import { normalizeSmartNumericClipboardValue, normalizeSmartSearchText } from "../smart-table-clipboard.mjs";

export const certificateApi = "/api/certificates";

export function useCertificateApi(api, session) {
  return useMemo(() => (path, { method = "GET", body, signal } = {}) =>
    api.request(`${certificateApi}${path}`, {
      method,
      signal,
      headers: { Authorization: `Bearer ${session}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), [api, session]);
}

export function queryString(fields) {
  const params = new URLSearchParams(Object.entries(fields).filter(([, value]) => value !== null && value !== undefined && value !== ""));
  return params.size ? `?${params}` : "";
}

export function ReportGroupingChecks({ values, onChange, t }) {
  const checks = [
    ["show_building_subtotals", "إجماليات المباني", "Building subtotals"],
    ["show_unit_subtotals", "إجماليات الوحدات", "Unit subtotals"],
    ["group_work_types", "تجميع حسب نوع الأعمال", "Group by work type"],
    ["show_work_type_subtotals", "إجماليات أنواع الأعمال", "Work type subtotals"],
  ];
  return <div className="pc-report-checks pc-span" role="group" aria-label={t("تجميع التقرير", "Report grouping")}>
    {checks.map(([key,ar,en]) => <label className="pc-check" key={key}>
      <input type="checkbox" checked={Boolean(values[key])} disabled={key === "show_work_type_subtotals" && !values.group_work_types}
        onChange={(event) => onChange(key,event.target.checked)} />{t(ar,en)}
    </label>)}
  </div>;
}

export function useResource(request, path, revision = 0) {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (path === null) return undefined;
    const controller = new AbortController();
    request(path, { signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted) setState({ path, revision, data });
    }).catch((error) => {
      if (!controller.signal.aborted) setState({ path, revision, error });
    });
    return () => controller.abort();
  }, [request, path, revision]);
  if (path === null) return {};
  if (state?.path === path && state.revision === revision) return state;
  return { pending: true };
}

export const numberText = normalizeSmartNumericClipboardValue;
export const searchText = (value) => normalizeSmartSearchText(value)
  .replace(/[٠-٩۰-۹]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹".indexOf(digit) % 10))
  .replace(/\s+/g, " ");

export function localDate() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function newKey() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function optionLabel(option) {
  return option?.label || option?.display_name || option?.name || "";
}

export function locationOptions(locations = []) {
  const byId = new Map(locations.map((location) => [String(location.id), location]));
  return locations.map((location) => {
    if (location.label) return location;
    const names = [location.name || optionLabel(location)];
    const seen = new Set([String(location.id)]);
    let parent = byId.get(String(location.parent_id));
    while (parent && !seen.has(String(parent.id))) {
      seen.add(String(parent.id));
      names.unshift(parent.name || optionLabel(parent));
      parent = byId.get(String(parent.parent_id));
    }
    return { ...location, label: names.join(" / ") };
  });
}

export function Field({ label, children, className = "" }) {
  const generated = useId();
  const isControl = isValidElement(children) && ["input", "select", "textarea"].includes(children.type);
  const id = isControl ? children.props.id || generated : undefined;
  return <div className={`pc-field ${className}`}>
    {isControl ? <><label htmlFor={id}>{label}</label>{cloneElement(children, { id })}</> : <><span>{label}</span>{children}</>}
  </div>;
}

export function ProjectDetailsFields({ draft, onChange, t, creating = false }) {
  return <div className="pc-form">
    {[
      ["name", t("الاسم الرسمي", "Official name"), {required:true,autoFocus:creating}],
      ["alternate_name", t("الاسم باللغة الأخرى", "Name in other language")],
      ["code", t("رمز المشروع", "Project code"), {dir:"ltr",readOnly:!creating,placeholder:t("يُعيّن تلقائيًا", "Assigned automatically")}],
      ["address", t("عنوان المشروع", "Project address")],
      ["contract_ref", t("مرجع العقد / أمر الشراء", "Contract / PO reference")],
      ["contract_date", t("تاريخ العقد", "Contract date"), {type:"date",dir:"ltr"}],
      ["currency", t("رمز العملة", "Currency code"), {dir:"ltr",minLength:3,maxLength:3,pattern:"[A-Za-z]{3}",required:true,readOnly:!creating}],
    ].map(([key,label,props]) => <Field key={key} label={label}>
      <input dir="auto" {...props} value={draft[key] ?? ""} onChange={(event) => onChange(key,event.target.value)} />
    </Field>)}
  </div>;
}

export function Money({ value, locale, currency }) {
  if (value === null || value === undefined || value === "") return <span aria-hidden="true">—</span>;
  const options = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  if (/^[A-Z]{3}$/.test(currency || "")) Object.assign(options, { style: "currency", currency });
  const formatted = new Intl.NumberFormat(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB", options).format(Number(value));
  return <bdi className="pc-money">{formatted}</bdi>;
}

export function Status({ value, t }) {
  const labels = {
    draft: ["مسودة", "Draft"], in_review: ["قيد المراجعة", "In review"],
    submitted: ["قيد المراجعة", "In review"], review: ["قيد المراجعة", "In review"],
    unapproved: ["غير معتمد", "Unapproved"], approved: ["معتمد", "Approved"], issued: ["صادر", "Issued"],
    legacy: ["صادر", "Issued"], historical: ["صادر", "Issued"], imported: ["صادر", "Issued"],
    void: ["ملغى", "Void"], voided: ["ملغى", "Voided"],
    superseded: ["مستبدل", "Superseded"], ready: ["جاهز", "Ready"],
    processing: ["جارٍ الإنشاء", "Processing"], failed: ["فشل الإنشاء", "Rendering failed"],
    pending: ["معلق", "Pending"], received: ["مستلم", "Received"],
    cleared: ["تم التحصيل", "Cleared"], reversed: ["تم العكس", "Reversed"],
  };
  return <span className="pc-status" data-status={value}>{labels[value] ? t(...labels[value]) : value || "—"}</span>;
}

export function Problem({ error, t }) {
  if (!error) return null;
  const conflict = error.message === "This code is already assigned" ? t("هذا الرمز مستخدم بالفعل.", "This code is already assigned.")
    : error.message === "A project already uses that name, address and contract for this customer"
      ? t("يوجد مشروع بهذا الاسم والعنوان والعقد لهذا العميل.", "A project already uses that name, address and contract for this customer.") : null;
  const text = error.status === 401 ? t("انتهت جلسة المستخلصات. سجّل الدخول مجددًا.", "Your certificate session ended. Sign in again.")
    : error.status === 403 ? t("الصلاحية المطلوبة غير متوفرة لهذا السجل.", "Your access does not allow this action for the selected record.")
    : error.status === 409 ? conflict || t("تغير السجل أو الإعدادات أثناء العمل. راجع آخر نسخة قبل المتابعة.", "The record or settings changed. Review the latest version before continuing.")
    : error.message || String(error);
  return <div className="pc-problem" role="alert">{text}</div>;
}

export function Combobox({ label, selected, options, onSelect, onSearch, onAdd, onClear, resetKey, disabled, t, autoFocus }) {
  const id = useId();
  const field = useRef(null);
  const [value, setValue] = useState(optionLabel(selected));
  const [isOpen, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const selectedId = selected?.id;
  const selectedLabel = optionLabel(selected);
  useEffect(() => {
    setValue(selectedLabel);
    setOpen(false);
  }, [selectedId, selectedLabel, resetKey]);
  const normalized = searchText(value);
  const matches = options.filter((option) => !normalized ||
    [optionLabel(option),option.alternate_name,option.code,option.contract_ref,option.address,...(option.search_aliases || [])]
      .some((part) => searchText(part).includes(normalized))).slice(0, 30);
  const canAdd = onAdd && value.trim() && !matches.some((option) => searchText(optionLabel(option)) === normalized);
  const choices = matches.length + (canAdd ? 1 : 0);
  const shown = !disabled && isOpen && choices > 0;
  useEffect(() => {
    if (shown && active >= 0) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, id, shown]);

  function choose(index) {
    const match = matches[index];
    setOpen(false);
    if (match) onSelect(match);
    else if (canAdd) onAdd(value.trim());
  }

  return <div className="pc-combo" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setOpen(false);
      setValue(selectedLabel);
      onSearch?.(selectedLabel);
    }
  }}>
    <label id={`${id}-label`} htmlFor={id}>{label}</label>
    <div className="pc-combo-control">
      <input
        ref={field} id={id} autoFocus={autoFocus} autoComplete="off" disabled={disabled} dir="auto"
        role="combobox" aria-controls={`${id}-choices`} aria-expanded={shown}
        aria-autocomplete="list" aria-activedescendant={shown && active >= 0 ? `${id}-${active}` : undefined}
        value={value}
        onFocus={(event) => { event.target.select(); setOpen(true); onSearch?.(value); }}
        onChange={(event) => { setValue(event.target.value); setActive(-1); setOpen(true); onSearch?.(event.target.value); }}
        onKeyDown={(event) => {
          if (event.key === "Escape") { setOpen(false); setValue(selectedLabel); return; }
          if ((event.key === "ArrowDown" || event.key === "ArrowUp") && choices) {
            event.preventDefault();
            setOpen(true);
            const direction = event.key === "ArrowDown" ? 1 : -1;
            setActive((previous) => (previous < 0 ? direction > 0 ? 0 : choices - 1 : (previous + direction + choices) % choices));
          }
          if (event.key === "Enter" && shown && active >= 0) { event.preventDefault(); choose(active); }
        }}
      />
      {selected && onClear && !disabled && <button type="button" aria-label={t("مسح الاختيار", "Clear selection")} onClick={() => { onClear(); field.current?.focus(); }}>×</button>}
    </div>
    {shown && <div id={`${id}-choices`} className="pc-combo-options" role="listbox" aria-labelledby={`${id}-label`}>
      {matches.map((option, index) => <div key={option.id} id={`${id}-${index}`} role="option" aria-selected={active === index}
        onMouseDown={(event) => event.preventDefault()} onClick={() => choose(index)}>
        <bdi>{optionLabel(option)}</bdi>{(option.code || option.contract_ref || option.address) && <small dir="auto">{option.code || option.contract_ref || option.address}</small>}
      </div>)}
      {canAdd && <div id={`${id}-${matches.length}`} role="option" aria-selected={active === matches.length}
        onMouseDown={(event) => event.preventDefault()} onClick={() => choose(matches.length)}>
        {t("إضافة", "Add")} <bdi>“{value.trim()}”</bdi>
      </div>}
    </div>}
  </div>;
}

export function useDebounce(value, delay = 180) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}

export function Dialog({ title, onClose, children, t, wide = false }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
  return <dialog ref={ref} className={`pc-dialog ${wide ? "pc-dialog-wide" : ""}`} aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header><h2 id={titleId}>{title}</h2><button type="button" onClick={onClose} aria-label={t("إغلاق", "Close")}>×</button></header>
    {children}
  </dialog>;
}
