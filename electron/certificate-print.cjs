const fs = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { paginateCertificate } = require('../server/certificate-document-html.cjs');

async function printCertificate(inputPath, options) {
  await app.whenReady();
  const window = new BrowserWindow({
    show: false,
    width: 1300,
    height: 1200,
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false },
  });
  try {
    await window.loadFile(inputPath);
    const pagination = await window.webContents.executeJavaScript(`(${paginateCertificate.toString()})(${JSON.stringify({
      issued: options.issued === true,
      measured: options.measured === true,
      outputMode: ['auto', 'detail_only', 'summary_details', 'multi_summary'].includes(options.outputMode) ? options.outputMode : 'auto',
      hasReceipts: options.hasReceipts === true,
    })})`);
    await window.webContents.executeJavaScript('Promise.all(Array.from(document.querySelectorAll("img"), image => image.decode().catch(() => {})))');
    const buffer = await window.webContents.printToPDF({
      preferCSSPageSize: true,
      printBackground: true,
      displayHeaderFooter: false,
      generateTaggedPDF: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    return { buffer, ...pagination };
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const [, , inputPath, outputPath, optionsPath] = process.argv;
  app.on('window-all-closed', () => {});
  async function run() {
    if (!inputPath || !outputPath || !optionsPath) throw new Error('Certificate print paths are required');
    const options = JSON.parse(await fs.readFile(optionsPath, 'utf8'));
    const { buffer, ...pagination } = await printCertificate(inputPath, options);
    await fs.writeFile(outputPath, buffer);
    process.stdout.write(JSON.stringify(pagination), () => app.exit(0));
  }
  run().catch((error) => {
    process.stderr.write(error.stack || error.message, () => app.exit(1));
  });
}

module.exports = { printCertificate };
