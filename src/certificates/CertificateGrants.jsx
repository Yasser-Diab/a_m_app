const capabilityLabels = {
  view: ["عرض المستخلصات", "View certificates"],
  create: ["إنشاء ونسخ المسودات", "Create and copy drafts"],
  edit_draft: ["تعديل المستخلصات غير المعتمدة", "Edit unapproved certificates"],
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
const operationsLabels = {
  ops_view:["عرض عمليات المشروع","View Project Operations"],
  ops_edit:["إدخال وتعديل المواصفات","Enter and edit specifications"],
  ops_approve:["اعتماد التعديلات التشغيلية","Approve operational revisions"],
  ops_finance:["مراجعة وترحيل تسويات الفواتير","Review and post invoice adjustments"],
  ops_qc:["تسجيل فحص الجودة","Record quality inspections"],
  ops_load:["تسجيل التحميل والكميات المنفذة","Record loading and installation"],
  ops_release:["اعتماد التصنيع والشحن","Release manufacturing and shipment"],
  ops_export:["طباعة تقارير العمليات","Print operational reports"],
  ops_catalogue:["إدارة دليل الأنظمة","Manage the system catalogue"],
};

export default function CertificateGrants({ grant, projects, uiLanguage, onChange }) {
  const t = (ar, en) => uiLanguage === "en" ? en : ar;
  const draft = {
    capabilities: grant?.capabilities ?? [],
    all_projects: Boolean(grant?.all_projects),
    allow_project_creation: Boolean(grant?.allow_project_creation),
    project_ids: grant?.project_ids ?? [],
  };
  const update = (key, value) => onChange({ ...draft, [key]: value });
  function toggle(key, value, enabled) {
    update(key, enabled ? [...draft[key], value] : draft[key].filter(item => item !== value));
  }

  return <div className="user-certificate-grants" data-localized>
    <fieldset>
      <legend>{t("صلاحيات المستخلصات والتحصيلات", "Certificates & Collections permissions")}</legend>
      <div className="user-certificate-choices">
        {Object.entries(capabilityLabels).map(([key, label]) => <label key={key}>
          <input type="checkbox" checked={draft.capabilities.includes(key)} onChange={event => toggle("capabilities", key, event.target.checked)} />
          <span>{t(...label)}</span>
        </label>)}
      </div>
    </fieldset>
    <fieldset>
      <legend>{t("صلاحيات عمليات المشروعات","Project Operations permissions")}</legend>
      <div className="user-certificate-choices">{Object.entries(operationsLabels).map(([key,label])=><label key={key}>
        <input type="checkbox" checked={draft.capabilities.includes(key)} onChange={event=>toggle("capabilities",key,event.target.checked)}/>
        <span>{t(...label)}</span>
      </label>)}</div>
    </fieldset>
    <fieldset>
      <legend>{t("نطاق المشروعات", "Project scope")}</legend>
      <div className="user-certificate-choices">
        <label><input type="checkbox" checked={draft.all_projects} onChange={event => update("all_projects", event.target.checked)} />
          <span>{t("جميع مشروعات الشركة", "All company projects")}</span></label>
        <label><input type="checkbox" checked={draft.allow_project_creation} onChange={event => update("allow_project_creation", event.target.checked)} />
          <span>{t("السماح ببدء مشروع جديد", "Allow creating a new project")}</span></label>
      </div>
      {!draft.all_projects && <div className="user-certificate-choices user-certificate-projects">
        {projects.length ? projects.map(project => <label key={project.id}>
          <input type="checkbox" checked={draft.project_ids.includes(Number(project.id))} onChange={event => toggle("project_ids", Number(project.id), event.target.checked)} />
          <span>{project.name} {project.customer_name && <small>({project.customer_name})</small>}</span>
        </label>) : t("لا توجد مشروعات للاختيار.", "No projects to select.")}
      </div>}
    </fieldset>
  </div>;
}
