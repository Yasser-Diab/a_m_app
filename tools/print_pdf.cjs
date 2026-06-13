const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const [, , inputHtmlPath, outputPdfPath, footerMetaArg] = process.argv;

function safe(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function readFooterMeta() {
  if (!footerMetaArg) return {};
  try {
    return JSON.parse(Buffer.from(footerMetaArg, 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

async function main() {
  if (!inputHtmlPath || !outputPdfPath) {
    throw new Error('Usage: electron tools/print_pdf.cjs input.html output.pdf');
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
  const pdf = await win.webContents.printToPDF({
    landscape: false,
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: `
      <div style="width:100%;font-size:9.5px;color:#9a6b16;padding:4px 28px 0;font-family:Arial,Tahoma,sans-serif;background:white;">
        <div style="display:flex;align-items:center;justify-content:space-between;width:100%;min-height:42px;">
          <div style="display:grid;place-content:center;text-align:left;line-height:1.45;min-width:220px;min-height:42px;">
            <div>${safe(footer.date || '')}</div>
            <div>${safe(footer.companyAr || 'المجموعة الهندسية للتصميمات المعمارية')}</div>
          </div>
          <div style="display:grid;place-content:center;text-align:center;line-height:1.45;min-width:220px;min-height:42px;">
            <div>HGAD</div>
            <div>${safe(footer.website || 'https://hgad-eg.com')}</div>
          </div>
          <div style="display:grid;place-content:center;text-align:right;line-height:1.45;min-width:220px;min-height:42px;">
            <div>Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>
            <div>By ${safe(footer.preparedBy || 'Eng. Yasser')}</div>
          </div>
        </div>
      </div>`,
    pageSize: 'A4',
    margins: {
      marginType: 'custom',
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
