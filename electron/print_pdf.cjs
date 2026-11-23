const fs = require("fs");
const path = require("path");
const { app, BrowserWindow } = require("electron");
const {prepareOperationsPrint}=require('../server/project-operations/print-layout.cjs');
const {pdfFooter}=require('../server/report-footer.cjs');

const [, , inputHtmlPath, outputPdfPath, footerMetaArg] = process.argv;

function safe(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function readFooterMeta() {
  if (!footerMetaArg) return {};
  try {
    return JSON.parse(Buffer.from(footerMetaArg, "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

async function main() {
  if (!inputHtmlPath || !outputPdfPath) {
    throw new Error(
      "Usage: electron tools/print_pdf.cjs input.html output.pdf",
    );
  }

  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    width: 1400,
    height: 900,
    webPreferences: {
      sandbox: false,
      contextIsolation: true,
    },
  });

  if (/^https?:\/\//i.test(inputHtmlPath)) {
    await win.loadURL(inputHtmlPath);
  } else {
    await win.loadFile(path.resolve(inputHtmlPath));
  }
  await new Promise((resolve) => setTimeout(resolve, 900));
  await win.webContents.executeJavaScript(`(${prepareOperationsPrint.toString()})()`);

  const footer = readFooterMeta();
  const pdf = await win.webContents.printToPDF({
    landscape: false,
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: "<div></div>",
    footerTemplate: pdfFooter(footer),
    pageSize: "A4",
    margins: {
      marginType: "custom",
      top: 0.35,
      bottom: 1.35,
      left: 0.35,
      right: 0.35,
    },
  });

  fs.mkdirSync(path.dirname(path.resolve(outputPdfPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outputPdfPath), pdf);
  await win.close();
  app.quit();
}

main().catch((error) => {
  console.error(error);
  app.quit();
  process.exitCode = 1;
});
