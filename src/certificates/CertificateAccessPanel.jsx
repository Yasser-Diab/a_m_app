import { useState } from "react";
import "./certificates.css";

export default function CertificateAccessPanel({ session, access, uiLanguage, onRetry, onSignInAgain, onOpenUsers }) {
  const t = (ar, en) => uiLanguage === "en" ? en : ar;
  const [retrying, setRetrying] = useState(false);
  const canAdmin = Boolean(session && access?.can_admin);
  let heading;
  let message;
  let action;

  async function retry() {
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  }

  if (!access) {
    heading = t("جارٍ التحقق من الصلاحيات", "Checking certificate access");
    message = t("جارٍ التحقق من صلاحيات حسابك على الخادم المتصل.", "Checking your account on the connected server.");
  } else if (access.error === 401 || access.error === 403 || (!session && !access.error && typeof access.enabled === "boolean")) {
    heading = t("سجّل الدخول مجددًا لاستخدام المستخلصات", "Sign in again to use Certificates");
    message = t("بعد تسجيل الدخول، سيُعاد فتح هذا القسم للتحقق من صلاحيات حسابك.", "This section will reopen after you sign in and check your permissions.");
    action = <button className="primary" type="button" onClick={onSignInAgain}>{t("تسجيل الدخول مجددًا", "Sign in again")}</button>;
  } else if (access.error || typeof access.enabled !== "boolean") {
    const unsupported = access.error === 404 || access.error === 501 || !access.error;
    heading = t("المستخلصات غير متاحة على الخادم الحالي", "Certificates are unavailable on this server");
    message = unsupported
      ? t("اتصل بخادم Easy Commercial يدعم المستخلصات، ثم أعد المحاولة.", "Connect to an Easy Commercial server that supports Certificates, then try again.")
      : t("تعذّر التحقق من صلاحيات المستخلصات. أعد المحاولة عند توفر اتصال بالخادم.", "The app could not check certificate permissions. Try again when the server is reachable.");
    action = <button type="button" onClick={retry} disabled={retrying}>{t("إعادة المحاولة", "Try again")}</button>;
  } else {
    heading = access.enabled
      ? t("يلزم إذن لعرض المستخلصات", "Certificate viewing access required")
      : t("قسم المستخلصات غير مفعّل", "Certificates are disabled");
    message = canAdmin
      ? t("تُدار صلاحيات المستخلصات من جدول المستخدمين في الإعدادات.", "Manage certificate access in the Users table in Settings.")
      : t("اطلب من مسؤول الشركة تفعيل القسم ومنح حسابك صلاحية الوصول إلى المشروعات المطلوبة.", "Ask your company administrator to enable Certificates and grant access to the projects you need.");
    if (canAdmin) {
      action = <button className="primary" type="button" onClick={onOpenUsers}>
        {t("فتح إعدادات المستخدمين", "Open Users settings")}
      </button>;
    } else if (!canAdmin) {
      action = <button type="button" onClick={retry} disabled={retrying}>{t("التحقق من الصلاحيات مجددًا", "Check permissions again")}</button>;
    }
  }

  return <div className="pc-workspace" data-localized>
    <section className="pc-panel pc-stack" aria-labelledby="certificate-access-title">
      <h2 id="certificate-access-title">{heading}</h2>
      <p role="status">{message}</p>
      {action && <div className="pc-toolbar">{action}</div>}
    </section>
  </div>;
}
