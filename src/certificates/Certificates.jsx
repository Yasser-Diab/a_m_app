import { useCallback, useEffect, useRef, useState } from "react";
import { BarChart3, ClipboardList, Plus, Settings2, WalletCards } from "lucide-react";
import CertificateEditor from "./CertificateEditor.jsx";
import { Collections, ProjectPicker, ProjectSettings, Reports } from "./CertificateOperations.jsx";
import { Field, Money, Problem, queryString, Status, useCertificateApi, useDebounce, useResource } from "./shared.jsx";
import "./certificates.css";

const statuses = ["unapproved", "draft", "in_review", "approved", "issued"];
const pageSize = 25;

function directCertificateId() {
  if (location.pathname.split("/").filter(Boolean)[0]?.toLowerCase() !== "progress-certificates") return null;
  const value = new URLSearchParams(location.search).get("id");
  return /^[1-9]\d{0,12}$/.test(value || "") ? value : null;
}

export default function ProgressCertificates({ api, apiBase, session, access, uiLanguage, defaultReportLanguage, refreshKey, onAccessChanged, saveNativeReport, shareNativeReport }) {
  const request = useCertificateApi(api, session);
  const t = useCallback((ar, en) => uiLanguage === "en" ? en : ar, [uiLanguage]);
  const [tab, setTab] = useState("open");
  const [editor, setEditor] = useState(() => ({ id: directCertificateId(), record: null, generation: 0, mounted: Boolean(directCertificateId()) }));
  const [editorBusy, setEditorBusy] = useState(false);
  const [listVersion, setListVersion] = useState(0);
  const [listProject, setListProject] = useState(null);
  const dirtyRef = useRef(false);
  const detailsRef = useRef(null);
  const searchRef = useRef(null);
  const can = (value) => access?.capabilities?.includes(value);
  const certificate = useResource(request, editor.id && !editor.record ? `/${editor.id}` : null, editor.generation);
  const available = [
    { id: "open", title: ["عرض المستخلص", "Open Certificates"], Icon: ClipboardList },
    { id: "new", title: ["مستخلص جديد", "New certificate"], Icon: Plus, hidden: !can("create") },
    { id: "collections", title: ["التحصيلات", "Collections"], Icon: WalletCards, hidden: !can("view_collections") },
    { id: "reports", title: ["التقارير", "Reports"], Icon: BarChart3 },
    { id: "settings", title: ["إعدادات المشروع", "Project Settings"], Icon: Settings2 },
  ].filter((item) => !item.hidden);

  useEffect(() => {
    if (tab === "collections" && !access?.capabilities?.includes("view_collections")) setTab("open");
  }, [access?.capabilities, tab]);

  function open(id) {
    if (editorBusy) return;
    if (id && String(id) === String(editor.id)) {
      detailsRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
      return;
    }
    if (dirtyRef.current && !window.confirm(t("توجد تعديلات غير محفوظة. هل تريد فتح سجل آخر؟", "There are unsaved changes. Open another record?"))) return;
    setEditor((current) => ({ id: id || null, record: null, generation: current.generation + 1, mounted: true }));
    if (!id) clearCertificateAddress();
    setTab(id ? "open" : "new");
    if (id) requestAnimationFrame(() => detailsRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }

  function clearCertificateAddress() {
    if (!new URLSearchParams(location.search).has("id")) return;
    const url = new URL(location.href);
    url.searchParams.delete("id");
    history.replaceState(history.state, "", url);
  }

  function resetEditor() {
    dirtyRef.current = false;
    setEditorBusy(false);
    setEditor((current) => ({ id: null, record: null, generation: current.generation + 1, mounted: false }));
    setTab("open");
    clearCertificateAddress();
    requestAnimationFrame(() => searchRef.current?.focus());
  }

  function closeEditor() {
    if (editorBusy) return;
    if (dirtyRef.current && !window.confirm(t("توجد تعديلات غير محفوظة. هل تريد إغلاق المستخلص دون حفظها؟", "There are unsaved changes. Close this certificate without saving them?"))) return;
    resetEditor();
  }

  function select(next) {
    if (next === "new" && (!editor.mounted || editor.id)) return open(null);
    setTab(next);
  }

  return <div className="pc-workspace" dir={uiLanguage === "en" ? "ltr" : "rtl"}>
    <nav className="pc-tabs" aria-label={t("قسم المستخلصات والتحصيلات", "Progress Certificates & Collections")}>
      {available.map(({ id, title, Icon }) => <button key={id} type="button" aria-pressed={tab === id} disabled={id === "new" && editorBusy} onClick={() => select(id)}><Icon size={17} />{t(...title)}</button>)}
    </nav>
    <div hidden={tab !== "open"}><CertificateList request={request} revision={`${refreshKey}/${listVersion}`} t={t} locale={uiLanguage} selectedId={editor.id} searchRef={searchRef} onOpen={open} project={listProject} setProject={setListProject} /></div>
    {editor.mounted && <div ref={detailsRef} hidden={tab !== (editor.id ? "open" : "new")}>
      <Problem error={certificate.error} t={t} />
      {certificate.pending && <div className="pc-panel" role="status">{t("جارٍ تحميل المستخلص…", "Loading certificate…")}</div>}
      {(editor.record || !editor.id || certificate.data) && <CertificateEditor key={editor.generation} initial={editor.record || certificate.data} request={request} apiBase={apiBase} session={session}
        access={access} t={t} locale={uiLanguage} defaultReportLanguage={defaultReportLanguage} dirtyRef={dirtyRef}
        onChange={(saved) => {
          setListVersion((version) => version + 1);
          if (saved?.id) {
            setEditor((current) => ({...current,id:saved.id,record:saved}));
            setTab((current) => current === "new" ? "open" : current);
            if(!editor.id)requestAnimationFrame(()=>detailsRef.current?.scrollIntoView({block:"start",behavior:"smooth"}));
          }
        }} onBusyChange={setEditorBusy} onClose={closeEditor} onAccessChanged={onAccessChanged} saveNativeReport={saveNativeReport} shareNativeReport={shareNativeReport}
        onDeleted={() => {
          resetEditor();
          setListVersion((version) => version+1);
        }}
        onBackToSearch={editor.id ? () => searchRef.current?.focus() : undefined} />}
    </div>}
    {tab === "collections" && can("view_collections") && <Collections request={request} canEdit={can("manage_collections")} canDelete={access.can_delete_documents} locale={uiLanguage} t={t} onAccessChanged={onAccessChanged} />}
    {tab === "reports" && <Reports request={request} t={t} locale={uiLanguage} onOpen={(project) => { setListProject(project); setTab("open"); }} />}
    {tab === "settings" && <ProjectSettings request={request} canManage={can("manage_settings")} t={t} />}
  </div>;
}

function CertificateList({ request, revision, t, locale, project, setProject, selectedId, searchRef, onOpen }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const query = useDebounce(search);
  const results = useResource(request, `/${queryString({ project_id: project?.id, status, q: query, page, limit: pageSize })}`, revision);
  const items = results.data?.items || [];
  return <section className="pc-panel pc-stack">
    <h2>{t("عرض المستخلص", "Open Certificates")}</h2>
    <div className="pc-form">
      <Field label={t("بحث", "Search")}><input ref={searchRef} dir="auto" value={search} placeholder={t("العميل أو المشروع أو الرقم", "Customer, project, or number")} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></Field>
      <ProjectPicker request={request} t={t} value={project} onSelect={(value) => { setProject(value); setPage(1); }} />
      <Field label={t("الحالة", "Status")}><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">{t("كل الحالات", "All statuses")}</option>{statuses.map((key) => <option value={key} key={key}>{t(...statusLabel(key))}</option>)}</select></Field>
    </div>
    <Problem error={results.error} t={t} />
    {results.pending && <p className="pc-empty" role="status">{t("جارٍ تحميل المستخلصات…", "Loading certificates…")}</p>}
    {results.data && <>
      <div className="pc-table-scroll"><table className="pc-table">
        <thead><tr><th>{t("المستخلص", "Certificate")}</th><th>{t("العميل", "Customer")}</th><th>{t("المشروع", "Project")}</th><th>{t("تاريخ قطع الأعمال", "Work cutoff")}</th><th>{t("الحالة", "Status")}</th><th>{t("قيمة الأعمال", "Work value")}</th></tr></thead>
        <tbody>{items.map((item) => <tr key={item.id}>
          <th scope="row"><button type="button" className="pc-name" aria-current={String(selectedId) === String(item.id) ? "true" : undefined} onClick={() => onOpen(item.id)}><bdi>{item.certificate_number ?? item.official_number ?? item.legacy_number ?? t("مسودة", "Draft")}</bdi>{item.revision > 1 && <span className="pc-caption">{t("مراجعة", "Rev.")} <bdi>{item.revision}</bdi></span>}</button></th>
          <td><bdi>{item.customer_name}</bdi></td><td><bdi>{item.project_name}</bdi></td><td><bdi>{item.work_to || "—"}</bdi></td><td><Status t={t} value={item.status} /></td>
          <td><Money value={item.current} locale={locale} currency={item.header?.currency} /></td>
        </tr>)}</tbody>
      </table>{!items.length && <p className="pc-empty">{t("لا توجد مستخلصات تطابق البحث.", "No certificates match this search.")}</p>}</div>
      <div className="pc-pagination"><button type="button" disabled={page <= 1} onClick={() => setPage((number) => number - 1)}>{t("السابق", "Previous")}</button>
        <bdi>{results.data.total ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, results.data.total)} / {results.data.total}</bdi>
        <button type="button" disabled={page * pageSize >= results.data.total} onClick={() => setPage((number) => number + 1)}>{t("التالي", "Next")}</button></div>
    </>}
  </section>;
}

function statusLabel(key) {
  return {
    unapproved: ["غير معتمد", "Unapproved"], draft: ["مسودة", "Draft"], in_review: ["قيد المراجعة", "In review"], approved: ["معتمد", "Approved"], issued: ["صادر", "Issued"],
  }[key];
}
