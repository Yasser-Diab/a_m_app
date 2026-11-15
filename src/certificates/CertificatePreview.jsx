import { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, Printer } from "lucide-react";
import { certificateApi, Dialog, Field, Problem, queryString } from "./shared.jsx";

function outputFileName(response, fallback) {
  const header = response.headers.get("Content-Disposition") || "";
  const utf = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  if (utf) {
    try { return decodeURIComponent(utf); } catch { return fallback; }
  }
  return /filename="([^"]+)"|filename=([^;]+)/i.exec(header)?.slice(1).find(Boolean)?.trim() || fallback;
}

async function fetchOutput({ apiBase, session, certificate, resource, variant, signal }) {
  const response = await fetch(`${apiBase || ""}${certificateApi}/${certificate.id}/${resource}${queryString({ variant: variant === "internal" ? "internal" : undefined })}`, {
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
  const fallback = `Certificate-${certificate.official_number || certificate.legacy_number || certificate.id}${certificate.revision > 1 ? `-R${certificate.revision}` : ""}.${extension}`;
  return {
    blob, filename: outputFileName(response, fallback),
    pages: response.headers.get("X-Certificate-Page-Count"),
    hasCover: response.headers.get("X-Certificate-Has-Cover") === "1",
  };
}

export default function CertificatePreview({ certificate, apiBase, session, canInternal, t, onClose, onAccessChanged, saveNativeReport, shareNativeReport }) {
  const frame = useRef(null);
  const [variant, setVariant] = useState("customer");
  const [loaded, setLoaded] = useState(null);
  const [error, setError] = useState(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloaded, setDownloaded] = useState(null);
  const output = loaded?.variant === variant ? loaded : null;
  const issued = certificate.status === "issued";

  useEffect(() => {
    const controller = new AbortController();
    let url;
    fetchOutput({ apiBase, session, certificate, resource: issued ? "pdf" : "preview", variant, signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(result.blob);
      setLoaded({ ...result, url, variant });
    }).catch((cause) => {
      if (controller.signal.aborted) return;
      setError(cause);
      if ([401, 403].includes(cause.status)) onAccessChanged?.();
    });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [apiBase, certificate, issued, onAccessChanged, session, variant]);

  async function download(extension) {
    setDownloadBusy(true); setError(null); setDownloaded(null);
    let localUrl;
    try {
      const result = extension === "pdf" ? output : await fetchOutput({ apiBase, session, certificate, resource: "xlsx", variant });
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
    } catch { window.open(output.url, "_blank", "noopener"); }
  }

  async function openNative() {
    if (!output) return;
    setDownloadBusy(true); setError(null);
    try { await shareNativeReport(output.blob, output.filename); }
    catch (cause) { if (!/cancel/i.test(cause?.message || "")) setError(cause); }
    finally { setDownloadBusy(false); }
  }

  return <Dialog title={t("معاينة المستخلص", "Certificate preview")} onClose={onClose} t={t} wide>
    <div className="pc-toolbar">
      {canInternal && <Field label={t("نسخة العرض", "Output variant")}><select value={variant} onChange={(event) => { setError(null); setLoaded(null); setVariant(event.target.value); }}>
        <option value="customer">{t("نسخة العميل", "Customer copy")}</option><option value="internal">{t("نسخة داخلية", "Internal copy")}</option>
      </select></Field>}
      {output?.pages && <span className="pc-chip">{t("الصفحات", "Pages")} <bdi>&nbsp;{output.pages}</bdi></span>}
      {output?.hasCover && <span className="pc-chip">{t("يتضمن صفحة ملخص", "Includes summary cover")}</span>}
      <button type="button" disabled={!output || downloadBusy} onClick={() => download("pdf")}><Download size={16} />{t("تنزيل PDF", "Download PDF")}</button>
      <button type="button" disabled={downloadBusy} onClick={() => download("xlsx")}><Download size={16} />{t("تنزيل Excel", "Download Excel")}</button>
      {shareNativeReport ? <button type="button" disabled={!output || downloadBusy} onClick={openNative}><ExternalLink size={16} />{t("فتح PDF أو مشاركته للطباعة", "Open or share PDF for printing")}</button>
        : <><button type="button" disabled={!output} onClick={print}><Printer size={16} />{t("طباعة", "Print")}</button>
          {output && <a href={output.url} target="_blank" rel="noopener"><ExternalLink size={15} />{t("فتح PDF", "Open PDF")}</a>}</>}
    </div>
    <Problem error={error} t={t} />
    {downloaded && <p role="status"><bdi>{downloaded}</bdi></p>}
    {!output && !error && <p role="status">{t("جارٍ إعداد المعاينة…", "Preparing preview…")}</p>}
    {output && !shareNativeReport && <iframe className="pc-preview" title={t("مستند المستخلص", "Certificate document")} ref={frame} src={output.url} />}
  </Dialog>;
}
