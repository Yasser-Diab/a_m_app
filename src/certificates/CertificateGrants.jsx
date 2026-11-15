import { useState } from "react";
import { Field, Problem, useCertificateApi, useResource } from "./shared.jsx";
import "./certificates.css";

const capabilityLabels = {
  view: ["عرض المستخلصات", "View certificates"],
  create: ["إنشاء ونسخ المسودات", "Create and copy drafts"],
  edit_draft: ["تعديل المسودات", "Edit drafts"],
  import: ["استيراد البنود", "Import work rows"],
  create_master: ["إضافة العملاء والمشروعات والمواقع", "Create customers, projects and locations"],
  manage_settings: ["إدارة إعدادات المستخلصات", "Manage certificate settings"],
  view_collections: ["عرض تفاصيل التحصيلات", "View collection details"],
  manage_collections: ["تسجيل وتوزيع التحصيلات", "Record and allocate collections"],
  submit: ["إرسال للمراجعة", "Submit for review"],
  approve: ["الاعتماد والإرجاع", "Approve and return"],
  issue: ["إصدار المستخلصات", "Issue certificates"],
  revise: ["طلب التصحيح والإلغاء وإعادة الفتح", "Request correction, void, or reopening"],
  export: ["معاينة وتصدير المستخلصات", "Preview and export certificates"],
  view_audit: ["عرض سجل التدقيق", "View audit history"],
};

export default function CertificateGrants({ api, session, access, users, uiLanguage, onSaved }) {
  const t = (ar, en) => uiLanguage === "en" ? en : ar;
  const request = useCertificateApi(api, session);
  const [userId, setUserId] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const canAdmin = Boolean(session && access?.can_admin);
  const feature = useResource(request, canAdmin ? "/admin/feature" : null, reload);
  const projects = useResource(request, canAdmin ? "/admin/projects" : null);
  const grant = useResource(request, canAdmin && userId ? `/admin/users/${userId}` : null, reload);
  const enabled = feature.data?.enabled ?? access?.enabled;

  if (!canAdmin) return <div className="pc-grants" role="status">{!session
    ? t("سجّل الخروج ثم الدخول لإدارة صلاحيات المستخلصات.", "Sign out and back in to manage certificate permissions.")
    : t("يمكن لمدير مصرح له إدارة صلاحيات المستخلصات.", "An authorized administrator can manage certificate permissions.")}</div>;

  async function setFeature(event) {
    const next = event.target.checked;
    setBusy(true);
    setError(null);
    try {
      await request("/admin/feature", { method: "PUT", body: { enabled: next } });
      setReload((value) => value + 1);
      await onSaved?.();
    } catch (cause) { setError(cause); } finally { setBusy(false); }
  }

  return <section className="pc-grants">
    <Problem error={error || feature.error || projects.error || grant.error} t={t} />
    <label className="pc-check"><input type="checkbox" checked={Boolean(enabled)} onChange={setFeature} disabled={busy || feature.pending} />{t("تمكين قسم المستخلصات للمستخدمين المصرح لهم", "Enable certificates for users with grants")}</label>
    <Field label={t("المستخدم", "User")}><select value={userId} onChange={(event) => setUserId(event.target.value)}>
      <option value="">{t("اختر مستخدمًا", "Select a user")}</option>
      {users.filter((user) => user.is_active).map((user) => <option key={user.id} value={user.id}>{user.display_name} ({user.username})</option>)}
    </select></Field>
    {grant.pending && <p role="status">{t("جارٍ التحميل…", "Loading…")}</p>}
    {grant.data && <GrantForm key={`${userId}-${reload}`} grant={grant.data} projects={projects.data || []} t={t} onSave={async (draft) => {
      await request(`/admin/users/${userId}`, { method: "PUT", body: draft });
      await onSaved?.();
    }} />}
  </section>;
}

function GrantForm({ grant, projects, t, onSave }) {
  const [draft, setDraft] = useState(() => ({
    capabilities: grant.capabilities || [],
    all_projects: Boolean(grant.all_projects),
    project_ids: (grant.project_ids || []).map(String),
    allow_project_creation: Boolean(grant.allow_project_creation),
  }));
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  function patch(key, value) { setDraft((current) => ({ ...current, [key]: value })); setStatus(null); }
  function toggleValue(key, value, checked) {
    patch(key, checked ? [...draft[key], value] : draft[key].filter((candidate) => candidate !== value));
  }

  return <form className="pc-grant-form" onSubmit={async (event) => {
    event.preventDefault(); setBusy(true); setStatus(null);
    try { await onSave({ ...draft, project_ids: draft.project_ids.map(Number) }); setStatus({ saved: true }); }
    catch (error) { setStatus({ error }); }
    finally { setBusy(false); }
  }}>
    <fieldset disabled={busy}>
      <legend>{t("إمكانيات المستخدم", "User capabilities")}</legend>
      <div className="pc-choice-grid">{Object.entries(capabilityLabels).map(([key, label]) => <label className="pc-check" key={key}>
        <input type="checkbox" checked={draft.capabilities.includes(key)} onChange={(event) => toggleValue("capabilities", key, event.target.checked)} />
        {t(...label)}
      </label>)}</div>
    </fieldset>
    <fieldset disabled={busy}>
      <legend>{t("نطاق المشروعات", "Project scope")}</legend>
      <label className="pc-check"><input type="checkbox" checked={draft.all_projects} onChange={(event) => patch("all_projects", event.target.checked)} />{t("جميع مشروعات الشركة", "All company projects")}</label>
      <label className="pc-check"><input type="checkbox" checked={draft.allow_project_creation} onChange={(event) => patch("allow_project_creation", event.target.checked)} />{t("السماح ببدء مشروع جديد", "Allow creating a new project")}</label>
      {!draft.all_projects && <div className="pc-project-grants">{projects.length ? projects.map((project) => <label className="pc-check" key={project.id}>
        <input type="checkbox" checked={draft.project_ids.includes(String(project.id))} onChange={(event) => toggleValue("project_ids", String(project.id), event.target.checked)} />
        <span>{project.name} {project.customer_name && <small>({project.customer_name})</small>}</span>
      </label>) : t("لا توجد مشروعات للاختيار.", "No projects to select.")}</div>}
    </fieldset>
    <button className="primary" type="submit" disabled={busy}>{t("حفظ صلاحيات المستخلصات", "Save certificate permissions")}</button>
    {status?.saved && <p role="status">{t("تم حفظ الصلاحيات.", "Permissions saved.")}</p>}
    <Problem error={status?.error} t={t} />
  </form>;
}
