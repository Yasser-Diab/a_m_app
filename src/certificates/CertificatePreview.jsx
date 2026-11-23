import { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, Printer } from "lucide-react";
import { certificateApi, Dialog, Field, Problem, queryString, ReportGroupingChecks } from "./shared.jsx";

function outputFileName(response, fallback) {
  const header = response.headers.get("Content-Disposition") || "";
  const utf = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  if (utf) {
    try { return decodeURIComponent(utf); } catch { return fallback; }
  }
  return /filename="([^"]+)"|filename=([^;]+)/i.exec(header)?.slice(1).find(Boolean)?.trim() || fallback;
}

async function fetchOutput({ apiBase, session, certificate, resource, variant, options, signal }) {
  const response = await fetch(`${apiBase || ""}${certificateApi}/${certificate.id}/${resource}${queryString({
    variant: variant === "internal" ? "internal" : undefined, fresh: 1, ...options,
  })}`, {
    headers: { Authorization: `Bearer ${session}` },
    signal,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const error = new Error(data?.error || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const blob = await response.blob();
  const extension = resource === "xlsx" ? "xlsx" : "pdf";
  const fallback = `Certificate-${certificate.certificate_number ?? certificate.official_number ?? certificate.legacy_number ?? "Draft"}${certificate.revision > 1 ? `-R${certificate.revision}` : ""}.${extension}`;
  return {
    blob, filename: outputFileName(response, fallback),
    pages: response.headers.get("X-Certificate-Page-Count"),
    hasCover: response.headers.get("X-Certificate-Has-Cover") === "1",
  };
}

export default function CertificatePreview({ certificate, apiBase, session, canInternal, t, onClose, onAccessChanged, saveNativeReport, shareNativeReport }) {
  const frame = useRef(null);
  const [variant, setVariant] = useState("customer");
  const [options, setOptions] = useState({ language: certificate.header?.locale || certificate.locale || "ar" });
  const [loaded, setLoaded] = useState(null);
  const [error, setError] = useState(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloaded, setDownloaded] = useState(null);
  const output = loaded?.variant === variant && loaded.options === options ? loaded : null;
  const grouping = {...certificate.report_options,...Object.fromEntries(Object.entries(options).map(([key,value]) => [key,value === "1"]))};

  useEffect(() => {
    const controller = new AbortController();
    let url;
    fetchOutput({ apiBase, session, certificate, resource: "preview", variant, options, signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(result.blob);
      setLoaded({ ...result, url, variant, options });
    }).catch((cause) => {
      if (controller.signal.aborted) return;
      setError(cause);
      if ([401, 403].includes(cause.status)) onAccessChanged?.();
    });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [apiBase, certificate, onAccessChanged, session, variant, options]);

  async function download(extension) {
    setDownloadBusy(true); setError(null); setDownloaded(null);
    let localUrl;
    try {
      const result = extension === "pdf" ? output : await fetchOutput({ apiBase, session, certificate, resource: "xlsx", variant, options });
      if (!result) return;
      if (window.priceOfferDesktop?.saveReportFile) {
        const response = await window.priceOfferDesktop.saveReportFile({ bytes: new Uint8Array(await result.blob.arrayBuffer()), fileName: result.filename, format: extension, reportType: "progress-certificates" });
        if (response?.savedPath) setDownloaded(response.savedPath);
      } else if (saveNativeReport) {
        await saveNativeReport(result.blob, result.filename);
        setDownloaded(result.filename);
      } else {
        localUrl = result.url || URL.createObjectURL(result.blob);
        const link = document.createElement("a");
        link.href = localUrl;
        link.download = result.filename;
        document.body.append(link); link.click(); link.remove();
        if (!result.url) setTimeout(() => URL.revokeObjectURL(localUrl), 60_000);
      }
    } catch (cause) { setError(cause); } finally { setDownloadBusy(false); }
  }

  function print() {
    if (!output) return;
    try {
      const printable = frame.current?.contentWindow;
      if (!printable) throw new Error("Preview unavailable");
      printable.focus(); printable.print();
    } catch { void openNative(); }
  }

  async function openNative() {
    if (!output) return;
    setDownloadBusy(true); setError(null);
    try {
      if (window.priceOfferDesktop?.openReportPreview) {
        await window.priceOfferDesktop.openReportPreview({ bytes: new Uint8Array(await output.blob.arrayBuffer()), fileName: output.filename });
      } else if (shareNativeReport) await shareNativeReport(output.blob, output.filename);
      else window.open(output.url, "_blank", "noopener");
    }
    catch (cause) { if (!/cancel/i.test(cause?.message || "")) setError(cause); }
    finally { setDownloadBusy(false); }
  }

  return <Dialog title={t("معاينة المستخلص", "Certificate preview")} onClose={onClose} t={t} wide>
    <div className="pc-output-options">
      {canInternal && <Field label={t("نسخة العرض", "Output variant")}><select value={variant} onChange={(event) => { setError(null); setLoaded(null); setVariant(event.target.value); }}>
        <option value="customer">{t("نسخة العميل", "Customer copy")}</option><option value="internal">{t("نسخة داخلية", "Internal copy")}</option>
      </select></Field>}
      <Field label={t("لغة المستخلص", "Document language")}><select value={options.language} onChange={(event) => { setError(null); setOptions({ ...options, language: event.target.value }); }}>
        <option value="ar">العربية</option><option value="en">English</option>
      </select></Field>
      <Field label={t("القالب", "Layout")}><select value={options.layout || ""} onChange={(event) => { setError(null); setOptions({ ...options, layout: event.target.value }); }}>
        <option value="">{t("الافتراضي", "Default")}</option><option value="auto">{t("تلقائي", "Automatic")}</option>
        <option value="detail">{t("التفاصيل فقط", "Details only")}</option><option value="cover">{t("ملخص وتفاصيل", "Summary and details")}</option>
        <option value="multi">{t("ملخصات منفصلة وتفاصيل", "Separate summaries and details")}</option>
      </select></Field>
      <Field label={t("مقاس الورق", "Paper size")}><select value={options.paper || ""} onChange={(event) => { setError(null); setOptions({ ...options, paper: event.target.value }); }}>
        <option value="">{t("الافتراضي", "Default")}</option><option value="A4">A4</option><option value="Letter">Letter</option>
      </select></Field>
      <Field label={t("علامة حالة الاعتماد", "Approval watermark")}><select value={options.watermark ?? "1"} onChange={(event) => {
        setError(null);
        setOptions({ ...options, watermark: event.target.value });
      }}><option value="1">{t("إظهار", "Show")}</option><option value="0">{t("إخفاء", "Hide")}</option></select></Field>
      {canInternal && <Field label={t("تفاصيل الدفعات", "Payment details")}><select value={options.receipts ?? ""} onChange={(event) => {
        setError(null);
        setOptions({ ...options, receipts: event.target.value, collections_through: "" });
      }}><option value="">{t("الافتراضي", "Default")}</option><option value="1">{t("إظهار", "Include")}</option><option value="0">{t("إخفاء", "Hide")}</option></select></Field>}
      {(options.receipts === "1" || (options.receipts !== "0" && variant === "internal")) &&
        <Field label={t("تفاصيل الدفعات حتى", "Payment details through")}><input type="date" lang="en-GB" value={options.collections_through || ""}
          onChange={(event) => { setError(null); setOptions({ ...options, collections_through: event.target.value }); }} /></Field>}
      <ReportGroupingChecks values={grouping} t={t} onChange={(key,checked) => {
        setError(null); setOptions((current) => ({...current,[key]:checked ? "1" : "0"}));
      }} />
      {(options.layout || certificate.header?.output_mode) === 'multi' && <small className="pc-span">{t(
        'ملخص لأنواع الأعمال وآخر للمباني؛ يبدأ كل ملخص محدد في صفحة جديدة.',
        'Work types and buildings have separate summaries; each selected summary starts on a new page.')}</small>}
    </div>
    <div className="pc-toolbar pc-output-actions">
      {output?.pages && <span className="pc-chip">{t("الصفحات", "Pages")} <bdi>&nbsp;{output.pages}</bdi></span>}
      {output?.hasCover && <span className="pc-chip">{t("يتضمن صفحة ملخص", "Includes summary cover")}</span>}
      <button type="button" disabled={!output || downloadBusy} onClick={() => download("pdf")}><Download size={16} />{t("تنزيل PDF", "Download PDF")}</button>
      <button type="button" disabled={downloadBusy} onClick={() => download("xlsx")}><Download size={16} />{t("تنزيل Excel", "Download Excel")}</button>
      {shareNativeReport ? <button type="button" disabled={!output || downloadBusy} onClick={openNative}><ExternalLink size={16} />{t("فتح PDF أو مشاركته للطباعة", "Open or share PDF for printing")}</button>
        : <><button type="button" disabled={!output} onClick={print}><Printer size={16} />{t("طباعة", "Print")}</button>
          <button type="button" disabled={!output || downloadBusy} onClick={openNative}><ExternalLink size={15} />{t("فتح PDF", "Open PDF")}</button></>}
    </div>
    <Problem error={error} t={t} />
    {downloaded && <p role="status"><bdi>{downloaded}</bdi></p>}
    {!output && !error && <p role="status">{t("جارٍ إعداد المعاينة…", "Preparing preview…")}</p>}
    {output && !shareNativeReport && <iframe className="pc-preview" title={t("مستند المستخلص", "Certificate document")} ref={frame} src={output.url} />}
  </Dialog>;
}
