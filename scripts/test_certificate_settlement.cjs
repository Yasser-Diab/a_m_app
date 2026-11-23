const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const electron = require('electron');

async function checkPagination(directory) {
  const { buildCertificateDocument } = require('../server/certificate-document-model.cjs');
  const { buildCertificateHtml, paginateCertificate } = require('../server/certificate-document-html.cjs');
  const { app, BrowserWindow } = electron;
  app.on('window-all-closed', () => {});
  app.setPath('userData', path.join(directory, 'profile'));
  await app.whenReady();
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  const results = [], examples = new Set();
  try {
    for (const locale of ['en', 'ar']) for (const mode of ['detail', 'cover', 'multi']) for (const measured of [false, true]) {
      for (const count of [1, 17, 28, 39]) {
        const model = buildCertificateDocument({
          header: { locale, currency: 'EGP', output_mode: mode, work_to: '2026-11-23' },
          issuer: { name: 'Certificate Pagination Review' },
          customer: { name: 'Example customer', name_ar: 'عميل تجريبي' },
          project: { name: 'Example project', name_ar: 'مشروع تجريبي', code: 'PRJ1001' },
          lines: Array.from({ length: count }, (_, index) => ({
            id: 'item-' + index, work_type: 'Work ' + (index + 1), work_item: 'Opening ' + (index + 1), building_unit:'Building ' + (index % 3 + 1),
            description: locale === 'ar' ? 'توريد وتركيب طبقاً للمواصفات المعتمدة' : 'Supply and install to approved specifications',
            mode: measured ? 'area' : 'lump', agreed_amount: measured ? null : 200,
            billed_quantity: measured ? 2 : null, count: measured ? 1 : null, unit: measured ? 'm²' : '',
            width: 1, height: 2, dimension_unit: 'm', rate: measured ? 100 : null, progress: 80, previous: 50, current: 150, cumulative: 200,
          })),
          totals: { previous: count * 50, current: count * 150, cumulative: count * 200,
            current_payable: count * 130, cumulative_payable: count * 180,
            components: Array.from({ length: 8 }, (_, index) => ({
              label: 'SETTLEMENT_ROW_' + (index + 1), basis: 'current_work', base: count * 150,
              previous: -10, current: -20, cumulative: -30,
            })),
          },
          rule_settings: { signatures: [{ name: 'Review Engineer', title: 'Project Engineer' }] },
        });
        assert.equal(model.landscape, measured, 'Exercise both paper orientations');
        const input = path.join(directory, 'certificate.html');
        await fs.writeFile(input, buildCertificateHtml(model), 'utf8');
        await window.loadFile(input);
        const pagination = await window.webContents.executeJavaScript(`(${paginateCertificate.toString()})(${JSON.stringify({
          measured: model.measured, outputMode: model.outputMode, hasReceipts: false,
        })})`);
        const layout = await window.webContents.executeJavaScript(`(() => {
          const sheets = [...document.querySelectorAll('body > .sheet')];
          const sections = sheets.flatMap(sheet => [...sheet.querySelectorAll('main > .finance')]);
          return sections.map(section => ({
            rows: section.querySelectorAll('tbody tr').length,
            moved: section.parentElement.firstElementChild === section,
            fits: section.getBoundingClientRect().bottom <= section.parentElement.getBoundingClientRect().bottom - 1,
            page: sheets.indexOf(section.closest('.sheet')) + 1,
          }));
        })()`);
        const label = `${locale}/${mode}/${measured ? 'landscape' : 'portrait'}/${count}`;
        assert.equal(layout.length, 1, 'Settlement was split across pages: ' + label);
        assert.equal(layout[0].rows, model.financeRows.length, 'Missing settlement rows: ' + label);
        assert.equal(layout[0].fits, true, 'Settlement overlaps the footer: ' + label);
        if (mode === 'multi') {
          const summaries = await window.webContents.executeJavaScript(`(() => {
            const sheets = [...document.querySelectorAll('body > .sheet')];
            return ['cover-work-type','cover-building'].map(kind => sheets.flatMap((sheet,index) => sheet.classList.contains(kind) ? [index + 1] : []));
          })()`);
          assert.ok(summaries.every(pages => pages.length), 'Both summaries must be present: ' + label);
          assert.ok(summaries[1][0] > summaries[0].at(-1), 'Summaries share a page: ' + label);
        }
        results.push({ label, ...pagination, ...layout[0] });
        const example = locale + '-' + (mode === 'multi' ? 'multi-summary' : layout[0].moved ? 'next-page' : 'same-page');
        if (process.env.CERTIFICATE_SETTLEMENT_ARTIFACTS && !examples.has(example)) {
          await fs.mkdir(process.env.CERTIFICATE_SETTLEMENT_ARTIFACTS, { recursive: true });
          const pdf = await window.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true,
            displayHeaderFooter: false, margins: { top: 0, bottom: 0, left: 0, right: 0 } });
          await fs.writeFile(path.join(process.env.CERTIFICATE_SETTLEMENT_ARTIFACTS, 'settlement-' + example + '.pdf'), pdf);
          examples.add(example);
        }
      }
    }
    assert.ok(results.some(result => result.moved), 'A next-page settlement case must be exercised');
    assert.ok(results.some(result => !result.moved), 'A settlement that fits should remain on its page');
    await fs.writeFile(path.join(directory, 'results.json'), JSON.stringify(results, null, 2));
  } finally { window.destroy(); }
}

async function main() {
  if (typeof electron === 'object' && electron.app) {
    try { await checkPagination(process.argv[2]); electron.app.exit(0); }
    catch (error) { console.error(error); electron.app.exit(1); }
    return;
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'certificate-settlement-'));
  try {
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    await promisify(execFile)(electron, [__filename, directory], { env, windowsHide: true, timeout: 120000 });
    const results = JSON.parse(await fs.readFile(path.join(directory, 'results.json'), 'utf8'));
    if (process.env.CERTIFICATE_SETTLEMENT_ARTIFACTS)
      await fs.copyFile(path.join(directory, 'results.json'), path.join(process.env.CERTIFICATE_SETTLEMENT_ARTIFACTS, 'settlement-results.json'));
    console.log(`Certificate settlement stays intact in ${results.length} Arabic/English, portrait/landscape, detail/summary layouts.`);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error.stderr || error); process.exitCode = 1; });
