const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const electron = require('electron');
const ExcelJS = require('exceljs');
const { buildCertificateDocument, documentFilename } = require('./certificate-document-model.cjs');
const { buildCertificateHtml } = require('./certificate-document-html.cjs');

const execFileAsync = promisify(execFile);
const activeRenders = new WeakMap();
let renderer = Promise.resolve();
let queued = 0;

function documentError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function renderCertificatePdf(model) {
  if (queued >= 16) throw documentError(503, 'The document renderer is busy. Try again shortly.');
  queued += 1;
  const render = renderer.then(async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'easycommercial-certificate-'));
    try {
      const htmlPath = path.join(directory, 'document.html');
      const options = { issued: model.issued, measured: model.measured, outputMode: model.outputMode, hasReceipts: model.receipts.length > 0 };
      await fs.writeFile(htmlPath, buildCertificateHtml(model), { mode: 0o600 });
      if (typeof electron === 'object' && electron.BrowserWindow) {
        const { printCertificate } = require('../electron/certificate-print.cjs');
        return await printCertificate(htmlPath, options);
      }
      const outputPath = path.join(directory, 'document.pdf');
      const optionsPath = path.join(directory, 'options.json');
      await fs.writeFile(optionsPath, JSON.stringify(options), { mode: 0o600 });
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      const { stdout } = await execFileAsync(electron, [
        path.join(__dirname, '..', 'electron', 'certificate-print.cjs'), htmlPath, outputPath, optionsPath,
      ], { windowsHide: true, timeout: 60_000, env });
      const pagination = JSON.parse(stdout);
      return { ...pagination, buffer: await fs.readFile(outputPath) };
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
  renderer = render.catch(() => {});
  try {
    return await render;
  } finally {
    queued -= 1;
  }
}

function addWorksheet(workbook, model, name, columns, rows) {
  const sheet = workbook.addWorksheet(name, { views: [{ rightToLeft: model.direction === 'rtl', state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map((column) => ({
    header: column.label,
    key: column.key,
    width: Math.max(column.weight + 4, Math.min(28, column.label.length + 2)),
    style: { alignment: { vertical: 'top', wrapText: column.kind === 'text' },
      ...(column.kind === 'money' ? { numFmt: '#,##0.00;[Red]-#,##0.00' } : {}),
      ...(column.kind === 'percent' ? { numFmt: '0.######"%"' } : {}),
    },
  }));
  sheet.getRow(1).height = 32;
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FF183148' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5EEF1' } };
    cell.alignment = { wrapText: true, vertical: 'middle' };
  });
  for (const row of rows) sheet.addRow(row);
  return sheet;
}

async function writeCertificateXlsx(model) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = model.issuer.name;
  workbook.title = model.officialNumber || model.watermark;
  const identity = workbook.addWorksheet(model.labels.certificate, { views: [{ rightToLeft: model.direction === 'rtl' }] });
  identity.columns = [{ width: 27 }, { width: 70 }];
  identity.addRow([model.issuer.name]);
  if (model.issuer.alternate) identity.addRow([model.issuer.alternate]);
  if (model.watermark) identity.addRow([model.watermark]);
  for (const group of model.fieldGroups) for (const field of group) identity.addRow([field.label, field.value]);
  if (model.preparedBy) identity.addRow([model.labels.prepared, model.preparedBy]);
  if (model.preparedAt) identity.addRow(['',model.preparedAt]);
  if (model.issuer.website) identity.addRow([model.issuer.website, model.issuer.shortName]);
  if (model.appVersion) identity.addRow([`EasyCommercial ${model.appVersion}`]);
  const type = { key: 'work_type', label: model.labels.work_type, weight: 18, kind: 'text' };
  addWorksheet(workbook, model, model.labels.detail, [type, ...model.columns], model.lines);
  if (model.financeRows.length) addWorksheet(workbook, model, model.labels.finance, [
    { key: 'label', label: model.labels.finance, weight: 38, kind: 'text' },
    { key: 'basis', label: model.labels.basis, weight: 19, kind: 'text' },
    { key: 'basisValue', label: `${model.labels.basis} (${model.currency})`, weight: 16, kind: 'money' },
    { key: 'previous', label: `${model.labels.previous} (${model.currency})`, weight: 20, kind: 'money' },
    { key: 'current', label: `${model.labels.current} (${model.currency})`, weight: 20, kind: 'money' },
    { key: 'cumulative', label: `${model.labels.cumulative} (${model.currency})`, weight: 20, kind: 'money' },
  ], model.financeRows);
  if (model.receipts.length) addWorksheet(workbook, model, model.labels.receipts, model.receiptColumns, model.receipts);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function initializeCertificateArtifacts(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS cert_pdf_artifacts (
      certificate_id INTEGER NOT NULL REFERENCES cert_revisions(id),
      variant TEXT NOT NULL CHECK(variant IN ('customer', 'internal')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'ready', 'failed')),
      template_version INTEGER NOT NULL,
      document_json TEXT NOT NULL,
      pdf BLOB,
      checksum TEXT,
      pagination_json TEXT,
      failure TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(certificate_id, variant)
    );
    CREATE INDEX IF NOT EXISTS idx_certificate_pdf_status ON cert_pdf_artifacts(status, certificate_id);
  `);
}

function enqueueCertificateRender(database, certificateId, frozenInput) {
  const variants = frozenInput.receipts?.length ? ['customer', 'internal'] : ['customer'];
  for (const variant of variants) {
    const model = buildCertificateDocument(frozenInput, { variant });
    database.run(`INSERT OR IGNORE INTO cert_pdf_artifacts(certificate_id, variant, template_version, document_json)
      VALUES (?,?,?,?)`, [certificateId, variant, model.modelVersion, JSON.stringify(model)]);
  }
}

function processCertificateRender(database, certificateId) {
  let pending = activeRenders.get(database);
  if (!pending) {
    pending = new Map();
    activeRenders.set(database, pending);
  }
  if (pending.has(certificateId)) return pending.get(certificateId);

  const task = (async () => {
    const jobs = database.all(`SELECT variant, document_json FROM cert_pdf_artifacts
      WHERE certificate_id = ? AND status = 'pending' ORDER BY variant`, [certificateId]);
    for (const job of jobs) {
      let buffer = null;
      let pagination = null;
      let failure = null;
      try {
        const { buffer: pdf, ...meta } = await renderCertificatePdf(JSON.parse(job.document_json));
        buffer = pdf;
        pagination = JSON.stringify(meta);
      } catch (error) {
        failure = String(error.message || error).slice(0, 1200);
        console.error('Certificate PDF render failed', certificateId, job.variant, failure);
      }
      const checksum = buffer && createHash('sha256').update(buffer).digest('hex');
      const status = buffer ? 'ready' : 'failed';
      database.transaction(() => {
        database.run(`UPDATE cert_pdf_artifacts SET status = ?, pdf = ?, checksum = ?, pagination_json = ?, failure = ?,
          updated_at = CURRENT_TIMESTAMP WHERE certificate_id = ? AND variant = ? AND status = 'pending'`,
        [status, buffer, checksum, pagination, failure, certificateId, job.variant]);
        if (job.variant === 'customer') database.run('UPDATE cert_revisions SET pdf_status = ? WHERE id = ?', [status, certificateId]);
      });
    }
  })().catch((error) => {
    console.error('Could not persist certificate PDF render state', certificateId, error);
  }).finally(() => pending.delete(certificateId));
  pending.set(certificateId, task);
  return task;
}

async function resumeCertificateRenders(database) {
  const jobs = database.all(`SELECT DISTINCT certificate_id FROM cert_pdf_artifacts WHERE status = 'pending' ORDER BY certificate_id`);
  for (const row of jobs) await processCertificateRender(database, row.certificate_id);
}

function getArtifact(database, certificateId, variant, includePdf) {
  const fields = `status, document_json, pagination_json, checksum${includePdf ? ', pdf' : ''}`;
  return database.get(`SELECT ${fields} FROM cert_pdf_artifacts WHERE certificate_id = ? AND variant = ?`, [certificateId, variant])
    || (variant === 'internal' ? database.get(`SELECT ${fields} FROM cert_pdf_artifacts WHERE certificate_id = ? AND variant = 'customer'`, [certificateId]) : null);
}

function setPagination(res, { pageCount, detailPages, hasCover }) {
  res.set({ 'X-Certificate-Page-Count': String(pageCount), 'X-Certificate-Detail-Pages': String(detailPages), 'X-Certificate-Has-Cover': hasCover ? '1' : '0' });
}

function sendDocument(res, data, model, extension, disposition) {
  const filename = documentFilename(model, extension);
  const safeFallback = `Certificate.${extension}`;
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  res.set({
    'Content-Type': extension === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `${disposition}; filename="${safeFallback}"; filename*=UTF-8''${encoded}`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  }).send(Buffer.from(data));
}

function registerCertificateDocumentRoutes(router, { database, authorize, documentFor, getCertificate }) {
  const previews = new Map();

  function access(req, capability, projectId) {
    if (authorize(req, capability, projectId) === false) throw documentError(403, 'Certificate access is required');
  }

  function input(req, capability = 'export') {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) throw documentError(404, 'Certificate was not found');
    const row = getCertificate(id);
    if (!row) throw documentError(404, 'Certificate was not found');
    access(req, 'view', row.project_id);
    access(req, capability, row.project_id);
    const variant = req.query.variant === 'internal' ? 'internal' : 'customer';
    if (variant === 'internal' || req.query.receipts === '1' || req.query.collections_through)
      access(req, 'view_collections', row.project_id);
    return { row, variant };
  }

  function route(handler) {
    return async (req, res, next) => {
      try {
        await handler(req, res);
      } catch (error) {
        const status = error.status || error.statusCode;
        if (status >= 400 && status < 600) return res.status(status).json({ error: error.message });
        return next(error);
      }
    };
  }

  function recheck(req, snapshot) {
    const { row } = input(req);
    if (snapshot.version !== row.version || snapshot.status !== row.status) {
      throw documentError(409, 'The certificate changed while preparing its output. Refresh and try again.');
    }
  }

  async function draftPdf(req, row, variant) {
    const draft = await documentFor(req, row);
    const key = createHash('sha256').update(JSON.stringify([draft, variant])).digest('hex');
    if (!previews.has(key)) {
      const model = buildCertificateDocument(draft, { variant });
      const promise = renderCertificatePdf(model).then((rendered) => ({ ...rendered, model }))
        .finally(() => previews.delete(key));
      previews.set(key, promise);
    }
    return previews.get(key);
  }

  function pdf(disposition) {
    return route(async (req, res) => {
      const { row, variant } = input(req);
      if (row.status === 'issued' && req.query.fresh !== '1') {
        const artifact = getArtifact(database, row.id, variant, true);
        if (!artifact || artifact.status !== 'ready' || !artifact.pdf) {
          const failed = artifact?.status === 'failed';
          throw documentError(failed ? 409 : 425, failed ? 'Certificate PDF failed. An issuer can retry rendering.' : 'Certificate PDF is still processing.');
        }
        setPagination(res, JSON.parse(artifact.pagination_json));
        return sendDocument(res, artifact.pdf, JSON.parse(artifact.document_json), 'pdf', disposition);
      }
      const { buffer, model, ...pagination } = await draftPdf(req, row, variant);
      recheck(req, row);
      setPagination(res, pagination);
      return sendDocument(res, buffer, model, 'pdf', disposition);
    });
  }

  router.get('/:id/preview', pdf('inline'));
  router.get('/:id/pdf', pdf('attachment'));
  router.get('/:id/xlsx', route(async (req, res) => {
    const { row, variant } = input(req);
    const artifact = row.status === 'issued' && req.query.fresh !== '1' ? getArtifact(database, row.id, variant, false) : null;
    const model = artifact ? JSON.parse(artifact.document_json) : buildCertificateDocument(await documentFor(req, row), { variant });
    const buffer = await writeCertificateXlsx(model);
    recheck(req, row);
    return sendDocument(res, buffer, model, 'xlsx', 'attachment');
  }));
  router.post('/:id/render', route(async (req, res) => {
    const { row, variant } = input(req, 'issue');
    if (row.status !== 'issued') throw documentError(409, 'Only issued certificates have an archival render.');
    database.transaction(() => {
      const changed = database.run(`UPDATE cert_pdf_artifacts SET status = 'pending', failure = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE certificate_id = ? AND variant = ? AND status = 'failed'`, [row.id, variant]);
      if (variant === 'customer' && changed.modified) database.run("UPDATE cert_revisions SET pdf_status = 'pending' WHERE id = ?", [row.id]);
    });
    await processCertificateRender(database, row.id);
    input(req, 'issue');
    const artifact = getArtifact(database, row.id, variant, false);
    if (!artifact || artifact.status !== 'ready') throw documentError(409, 'Could not render the PDF. The issued certificate remains available.');
    res.json({ status: 'ready', ...JSON.parse(artifact.pagination_json) });
  }));
}

module.exports = {
  buildCertificateDocument, renderCertificatePdf, writeCertificateXlsx, documentFilename,
  initializeCertificateArtifacts, enqueueCertificateRender, processCertificateRender, resumeCertificateRenders,
  registerCertificateDocumentRoutes,
};
