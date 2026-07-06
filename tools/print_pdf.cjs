const fs = require("fs");
const path = require("path");
const { app, BrowserWindow } = require("electron");

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

  const footer = readFooterMeta();
  const companyAbbreviation = safe(footer.companyAbbreviation || "HGAD");
  const footerColor = safe(footer.companyNameColor || "#9a6b16");
  const lineColor = safe(footer.lineColor || "#d6c08d");
  const fontStack = safe(
    String(footer.bodyFontStack || "Arial,Tahoma,sans-serif").replace(/"/g, "'"),
  );
  const footerContact = safe(
    footer.footerContact || footer.website || "https://hgad-eg.com",
  );
  const footerPhone = safe(footer.footerPhone || companyAbbreviation);
  const pdf = await win.webContents.printToPDF({
    landscape: false,
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: "<div></div>",
    footerTemplate: `
      <div style="width:100%;font-size:9.5px;color:${footerColor};padding:4px 28px 0;font-family:${fontStack};background:white;">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;align-items:center;width:100%;min-height:42px;border-top:1px solid ${lineColor};">
          <div style="display:grid;place-content:center start;text-align:left;line-height:1.45;min-width:0;min-height:42px;">
            <div>${safe(footer.date || "")}</div>
            <div>${footerPhone}</div>
          </div>
          <div style="display:grid;place-content:center;text-align:center;line-height:1.45;min-width:0;min-height:42px;">
            <div>${companyAbbreviation}</div>
            <div>${footerContact}</div>
          </div>
          <div style="display:grid;place-content:center end;text-align:right;line-height:1.45;min-width:0;min-height:42px;">
            <div>Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>
            <div>By ${safe(footer.preparedBy || "Eng. Yasser")}</div>
          </div>
        </div>
      </div>`,
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
