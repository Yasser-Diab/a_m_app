const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const ExcelJS = require('exceljs');
const { AppDatabase } = require('../server/db.cjs');
const {
  buildCertificateDocument, renderCertificatePdf, writeCertificateXlsx, initializeCertificateArtifacts,
  enqueueCertificateRender, processCertificateRender,
} = require('../server/certificate-documents.cjs');

function fixture(locale, lines, totals, more = {}) {
  return {
    header: { locale, currency: 'EGP', type: 'progress', work_to: '2026-11-13', contract_ref: 'PO-1142/EG', collection_cutoff: '2026-11-12' },
    issuer: { name: 'Example Contracting', name_ar: 'المثال للمقاولات' },
    project: { name: 'Riverside Business Park', name_ar: 'مشروع ريفرسايد للأعمال', code: 'BP-402', address: 'Block 11, Industrial Road, New Cairo' },
    customer: { name: 'Riverside Property Management', name_ar: 'شركة ريفرسايد لإدارة الممتلكات والخدمات التجارية المتكاملة', address: 'New Cairo, Egypt' },
    revision: 1,
    lines,
    totals,
    ...more,
  };
}

async function verifyPdf(model, expected) {
  const { buffer, ...pagination } = await renderCertificatePdf(model);
  if (expected) assert.deepEqual(pagination, expected);
  else {
    assert.ok(pagination.detailPages > 1);
    assert.equal(pagination.pageCount, pagination.detailPages + 1);
    assert.equal(pagination.hasCover, true);
  }
  const raw = buffer.toString('latin1');
  assert.match(raw, /^%PDF-/);
  assert.equal([...raw.matchAll(/\/Type\s*\/Page\b/g)].length, pagination.pageCount);
  return buffer;
}

async function main() {
  const lump = {
    id: 'lump', mode: 'lump', work_type: 'Building works', work_item: 'BLD-10', description: 'Supply and install building cladding',
    agreed_amount: 100_000, progress: 25, previous: 30_000, current: 25_000, cumulative: 55_000,
  };
  const simple = buildCertificateDocument(fixture('en', [lump], { ...lump, current_payable: 25_000, cumulative_payable: 55_000 }));
  assert.equal(simple.landscape, false);
  assert.deepEqual(simple.columns.map((column) => column.key), ['work_item', 'description', 'agreed_amount', 'progress', 'previous', 'current', 'cumulative']);
  assert.equal(simple.fieldGroups.flat().some((field) => field.key === 'tax_no'), false);
  const historical = buildCertificateDocument(fixture('en', [lump], { ...lump, current_payable: 25_000 },
    { status: 'historical', legacy_number: '2017-24', source_name: 'Workbook.xlsb' }));
  assert.equal(historical.watermark, 'Historical import');
  assert.equal(historical.officialNumber, '2017-24');
  assert.deepEqual(historical.moneyKeys, ['current']);
  assert.equal(historical.financeRows.length, 0);
  assert.equal(historical.fieldGroups.flat().find((field) => field.key === 'source_name').value, 'Workbook.xlsb');
  await verifyPdf(historical, { pageCount: 1, detailPages: 1, hasCover: false });
  const english = await verifyPdf(simple, { pageCount: 1, detailPages: 1, hasCover: false });

  const linear = { ...lump, mode: 'linear', width: 2.5, height: 7.5, dimension_unit: 'm', billed_quantity: 2.5, unit: 'm', rate: 25 };
  const linearModel = buildCertificateDocument(fixture('en', [linear], {}));
  assert.equal(linearModel.columns.some((column) => column.key === 'height'), false);
  assert.equal(linearModel.columns.find((column) => column.key === 'width').label, 'Length');
  const direct = buildCertificateDocument(fixture('en', [{ ...linear, mode: 'direct' }], {}));
  assert.equal(direct.columns.some((column) => column.key === 'width'), false);

  const measured = Array.from({ length: 34 }, (_, index) => ({
    id: `M${index}`, work_type: index < 16 ? 'أعمال الألومنيوم' : 'أعمال الزجاج', location: `المبنى ${index + 1}`,
    work_item: `EW-${401 + index}`, description: 'توريد وتركيب وحدات الواجهة طبقاً للمواصفات والرسومات المعتمدة',
    mode: 'area', count: 2, width: 1, height: 2, dimension_unit: 'm', billed_quantity: 4, unit: 'm²', rate: 25,
    last_current: 25, previous: 25, current: 100, cumulative: 125,
  }));
  const issued = fixture('ar', measured, {
    previous: 850, current: 3400, cumulative: 4250, last_current: 850, current_payable: 3326, cumulative_payable: 4276,
    ordinary_collections: 300, advance_recovery: 250,
    components: [{ kind: 'vat', basis: 'current_work', base: 3400, amount: 476, cumulative: 576 }],
  }, {
    status: 'issued', official_number: 'PC-014', issued_at: '2026-11-15T09:00:00Z', baseline: { id: 5 },
    receipts: [{ id: 100, amount: 300, reference: 'PRIVATE-RECEIPT-100' }],
  });
  const arabicModel = buildCertificateDocument(issued);
  assert.equal(arabicModel.coverRows.length, 2);
  assert.equal(arabicModel.coverRows.reduce((sum, row) => sum + row.current, 0), 3400);
  assert.equal(arabicModel.columns.some((column) => column.key === 'height'), true);
  assert.equal(arabicModel.direction, 'rtl');
  assert.equal(JSON.stringify(arabicModel).includes('PRIVATE-RECEIPT-100'), false);
  assert.equal(buildCertificateDocument(issued, { variant: 'internal' }).receipts[0].reference, 'PRIVATE-RECEIPT-100');
  const arabic = await verifyPdf(arabicModel);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await writeCertificateXlsx(arabicModel));
  const measurements = workbook.getWorksheet('تفاصيل الأعمال');
  assert.equal(measurements.views[0].rightToLeft, true);
  const amountIndex = measurements.getRow(1).values.indexOf(arabicModel.labels.current);
  assert.equal(measurements.getRow(2).getCell(amountIndex).value, 100);

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'certificate-document-test-'));
  const schema = path.join(directory, 'schema.sql');
  await fs.writeFile(schema, 'CREATE TABLE IF NOT EXISTS cert_revisions(id INTEGER PRIMARY KEY, pdf_status TEXT);');
  const database = new AppDatabase(path.join(directory, 'test.db'), schema);
  try {
    await database.open();
    initializeCertificateArtifacts(database);
    const frozen = fixture('en', [lump], { ...lump, current_payable: 25_000, cumulative_payable: 55_000 },
      { status: 'issued', official_number: 1, issued_at: '2026-11-15' });
    database.transaction(() => {
      database.run("INSERT INTO cert_revisions VALUES (1,'pending')");
      enqueueCertificateRender(database, 1, frozen);
    });
    frozen.customer.name = 'Edited customer record';
    await Promise.all([processCertificateRender(database, 1), processCertificateRender(database, 1)]);
    const artifact = database.get("SELECT * FROM cert_pdf_artifacts WHERE certificate_id = 1 AND variant = 'customer'");
    assert.equal(artifact.status, 'ready');
    assert.equal(database.get('SELECT pdf_status FROM cert_revisions WHERE id = 1').pdf_status, 'ready');
    assert.equal(JSON.parse(artifact.document_json).identities.customer, 'Riverside Property Management');
    assert.equal(artifact.checksum, createHash('sha256').update(artifact.pdf).digest('hex'));
    await processCertificateRender(database, 1);
    assert.deepEqual(database.get('SELECT pdf FROM cert_pdf_artifacts WHERE certificate_id = 1').pdf, artifact.pdf);
  } finally {
    database.close();
    await fs.rm(directory, { recursive: true, force: true });
  }

  if (process.env.CERTIFICATE_TEST_ARTIFACTS) {
    const outputDirectory = process.env.CERTIFICATE_TEST_ARTIFACTS;
    await fs.mkdir(outputDirectory, { recursive: true });
    await fs.writeFile(path.join(outputDirectory, 'certificate-en.pdf'), english);
    await fs.writeFile(path.join(outputDirectory, 'certificate-ar.pdf'), arabic);
  }
  console.log('Certificate documents passed: dynamic columns, bilingual pagination, settlement, private variant, typed XLSX, archived bytes');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
