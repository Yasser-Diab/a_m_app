import { useEffect, useState } from "react";

export default function ReportPreviewFrame({ url, session = "", title, t }) {
  const [result, setResult] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    async function load() {
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          cache: "no-store",
          headers: session ? { Authorization: `Bearer ${session}` } : {},
        });
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error.error || `HTTP ${response.status}`);
        }
        const html = await response.text();
        if (!controller.signal.aborted) setResult({ url, session, html });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ url, session, error: error.message });
      }
    }
    load();
    return () => controller.abort();
  }, [url, session]);

  const current = result?.url === url && result?.session === session ? result : null;
  if (!current) return <p role="status">{t("جارٍ تحميل المعاينة…", "Loading preview…")}</p>;
  if (current.error) return <p role="alert">{t("تعذر تحميل المعاينة:", "Unable to load preview:")} {current.error}</p>;
  return <iframe title={title} srcDoc={current.html} />;
}
