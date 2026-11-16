const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const ExcelJS = require('exceljs');
const { AppDatabase } = require('../server/db.cjs');
const { buildCertificateHtml } = require('../server/certificate-document-html.cjs');
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
    assert.ok(pagination.pageCount > pagination.detailPages);
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
  assert.deepEqual(simple.columns.map((column) => column.key), ['work_item', 'description', 'agreed_amount', 'previous_progress', 'current_progress', 'previous', 'current', 'cumulative']);
  assert.equal(simple.lines[0].previous_progress,30);
  assert.equal(simple.lines[0].current_progress,25);
  assert.equal(simple.watermark,'UNAPPROVED');
  assert.match(simple.qr,/^data:image\/svg\+xml;base64,/);
  assert.equal(simple.fieldGroups.flat().some((field) => field.key === 'tax_no'), false);
  const historical = buildCertificateDocument(fixture('en', [lump], { ...lump, current_payable: 25_000 },
    { status: 'historical', legacy_number: '2017-24', source_name: 'Workbook.xlsb' }));
  assert.equal(historical.watermark, 'UNAPPROVED');
  assert.equal(historical.officialNumber, '2017-24');
  assert.deepEqual(historical.moneyKeys, ['previous','current','cumulative']);
  assert.equal(historical.financeRows.find((row) => row.key === 'current_payable').current,25000);
  assert.equal(historical.fieldGroups.flat().some((field) => ['source_name', 'revision'].includes(field.key)), false);
  await verifyPdf(historical, { pageCount: 1, detailPages: 1, hasCover: false });
  const english = await verifyPdf(simple, { pageCount: 1, detailPages: 1, hasCover: false });

  const linear = { ...lump, mode: 'linear', width: 2.5, height: 7.5, dimension_unit: 'm', billed_quantity: 2.5, unit: 'm', rate: 25 };
  const linearModel = buildCertificateDocument(fixture('en', [linear], {}));
  assert.equal(linearModel.columns.some((column) => column.key === 'height'), false);
  assert.equal(linearModel.columns.find((column) => column.key === 'width').label, 'Length (m)');
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
    receipts: [{ id: 100, amount: 300, reference: 'RCPT-100', method: 'INTERNAL-PAYMENT-METHOD' }],
  });
  issued.header.group_work_types = true;
  issued.issuer = {companyNameEn:'Example Contracting', companyNameAr:'المثال للمقاولات', website:'example.test', companyAbbreviation:'EC'};
  issued.rule_settings = {signatures:[{name:'Prepared Person', title:'Project Engineer'}]};
  issued.prepared_by = 'Report Operator';
  issued.prepared_at = '15/11/2026, 11:00';
  issued.app_version = '2.0.4';
  const arabicModel = buildCertificateDocument(issued);
  assert.equal(arabicModel.coverRows.length, 2);
  assert.equal(arabicModel.coverRows.reduce((sum, row) => sum + row.current, 0), 3400);
  assert.equal(arabicModel.columns.some((column) => column.key === 'height'), true);
  assert.equal(arabicModel.columns.some(({key}) => ['building_unit','floor_apartment','location','dimension_unit'].includes(key)), false);
  assert.equal(arabicModel.lines[0].unit,'م²');
  assert.deepEqual(buildCertificateDocument(fixture('ar', ['Pcs','KG','linear meter'].map((unit) => ({...linear,unit})),{})).lines.map(({unit}) => unit),
    ['عدد','كجم','م.ط']);
  assert.deepEqual(buildCertificateDocument(fixture('en', ['عدد','كجم','م.ط'].map((unit) => ({...linear,unit})),{})).lines.map(({unit}) => unit),
    ['Pcs','kg','l.m']);
  assert.equal(arabicModel.direction, 'rtl');
  assert.equal(arabicModel.lines[0].current_progress, 100);
  assert.equal(arabicModel.watermark,'APPROVED');
  assert.equal(buildCertificateDocument({...issued,show_status_watermark:false}).watermark,'');
  assert.equal(arabicModel.issuer.name, 'Example Contracting');
  assert.equal(arabicModel.signatures[0].name, 'Prepared Person');
  assert.equal(JSON.stringify(arabicModel).includes('RCPT-100'), false);
  const internalPayments = buildCertificateDocument(issued, { variant:'internal' });
  assert.equal(internalPayments.receipts[0].reference,'RCPT-100');
  assert.equal(internalPayments.receipts[0].method,'INTERNAL-PAYMENT-METHOD');
  const customerPayments = buildCertificateDocument({...issued, include_receipts:true});
  assert.equal(customerPayments.receipts[0].amount, 300);
  assert.equal(customerPayments.receipts[0].reference,'RCPT-100');
  assert.deepEqual(customerPayments.receiptColumns.map(({key}) => key),['received_date','receipt_type','reference','amount']);
  const customerPaymentsHtml = buildCertificateHtml(customerPayments);
  assert.ok(customerPaymentsHtml.includes('>المرجع</th>'));
  assert.ok(customerPaymentsHtml.includes('>RCPT-100</bdi>'));
  assert.equal(customerPaymentsHtml.includes('INTERNAL-PAYMENT-METHOD'),false);
  const paymentsWorkbook = new ExcelJS.Workbook();
  await paymentsWorkbook.xlsx.load(await writeCertificateXlsx(customerPayments));
  const payments = paymentsWorkbook.getWorksheet(customerPayments.labels.receipts);
  const referenceColumn = payments.getRow(1).values.indexOf(customerPayments.labels.reference);
  assert.equal(payments.getRow(2).getCell(referenceColumn).value,'RCPT-100');
  const arabic = await verifyPdf(arabicModel);

  const compact = fixture('ar', [lump], {current:25_000,current_payable:24_000,cumulative_payable:24_000,ordinary_collections:1000}, {
    include_receipts:true, receipts:[{kind:'receipt',amount:1000,reference:'RCPT-200'}],
    rule_settings:{collections_basis:'received',signatures:[{name:'Project Engineer'}]},
  });
  const compactCover = buildCertificateDocument({...compact,header:{...compact.header,output_mode:'cover'}});
  assert.ok(buildCertificateHtml(compactCover).includes('حسب تاريخ استلام الدفعة'));
  await verifyPdf(compactCover,{pageCount:2,detailPages:1,hasCover:true});
  await verifyPdf(buildCertificateDocument({...compact,header:{...compact.header,output_mode:'detail'}}),
    {pageCount:1,detailPages:1,hasCover:false});

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await writeCertificateXlsx(arabicModel));
  const measurements = workbook.getWorksheet('تفاصيل الأعمال');
  assert.equal(measurements.views[0].rightToLeft, true);
  const amountIndex = measurements.getRow(1).values.indexOf(arabicModel.labels.current);
  assert.equal(measurements.getRow(2).getCell(1).value, 'المبنى 1');
  assert.equal(measurements.getRow(2).getCell(1).border.right.style,'thin');
  assert.equal(measurements.getRows(2,3).find((row) => row.getCell(amountIndex).value === 100).getCell(amountIndex).value,100);

  const buildingRows = [1,2,3].map((id) => ({...lump,id,building_unit:id === 2 ? 'Tower B' : 'Tower A',
    floor_apartment:'Apartment 1',current:id*100}));
  const byUnit = fixture('en',buildingRows,{});
  byUnit.header.group_by = 'unit';
  byUnit.header.show_group_subtotals = true;
  const unitModel = buildCertificateDocument(byUnit);
  assert.deepEqual(unitModel.detailGroups.map(({name,totals}) => [name,totals.current]),
    [['Tower A / Apartment 1',400],['Tower B / Apartment 1',200]]);
  assert.equal(unitModel.workTotals.current,600);
  const unitWorkbook = new ExcelJS.Workbook();
  await unitWorkbook.xlsx.load(await writeCertificateXlsx(unitModel));
  const works = unitWorkbook.getWorksheet(unitModel.labels.detail);
  const columnIndex = works.getRow(1).values.indexOf(unitModel.labels.current);
  assert.equal(works.getRow(2).getCell(1).value,'Tower A');
  assert.equal(works.getRow(3).getCell(1).value,'Apartment 1');
  assert.equal(works.getRow(3).getCell(1).border.left.style,'thin');
  assert.equal(works.getRow(6).getCell(columnIndex).value,400);
  byUnit.header.group_by = 'building';
  assert.deepEqual(buildCertificateDocument(byUnit).coverRows.map(({name}) => name),['Tower A','Tower B']);
  byUnit.header.group_by = 'work_type';
  byUnit.header.show_group_subtotals = false;
  const noGroupsSubtotal = buildCertificateDocument(byUnit);
  assert.equal(noGroupsSubtotal.detailGroups[0].name,'Building works');
  assert.equal(noGroupsSubtotal.showGroupSubtotals,false);
  assert.equal(noGroupsSubtotal.coverRows.length,0);

  for (const building of [false,true]) for (const unit of [false,true]) {
    const grouped = buildCertificateDocument({...byUnit,report_options:{group_work_types:true,show_building_subtotals:building,show_unit_subtotals:unit}});
    assert.deepEqual(grouped.detailBands.filter(({kind}) => kind === 'subtotal').map(({path}) => path.at(-1).kind),
      [unit && 'unit',building && 'building',unit && 'unit',building && 'building'].filter(Boolean));
    assert.equal(grouped.detailBands.find(({kind}) => kind === 'line').path.length,3);
    assert.equal(grouped.workTotals.current,600);
    if (building) assert.deepEqual(grouped.coverRows.map(({name,current}) => [name,current]),[['Tower A',400],['Tower B',200]]);
    else if (unit) assert.deepEqual(grouped.coverRows.map(({name,current}) => [name,current]),[['Tower A / Apartment 1',400],['Tower B / Apartment 1',200]]);
    else assert.equal(grouped.coverRows.length,0);
  }
  const allSubtotals = {group_work_types:true,show_building_subtotals:true,show_unit_subtotals:true,show_work_type_subtotals:true};
  const noBuildings = buildingRows.map((line) => ({...line,building_unit:'',floor_apartment:line.id === 3 ? 'Apartment 2' : 'Apartment 1'}));
  const unitSummary = buildCertificateDocument({...fixture('en',noBuildings,{}),report_options:allSubtotals});
  assert.equal(unitSummary.groupLabel,unitSummary.labels.floor_apartment);
  assert.deepEqual(unitSummary.coverRows.map(({name,current}) => [name,current]),[['Apartment 1',300],['Apartment 2',300]]);
  assert.deepEqual(unitSummary.detailBands.filter(({kind}) => kind === 'subtotal').map(({path}) => path.at(-1).kind),
    ['work_type','unit','work_type','unit']);

  for (const locale of ['ar','en']) {
    const arabic = locale === 'ar';
    const unit = arabic ? 'جانبية شمال' : 'North Side';
    const named = buildCertificateDocument({...fixture(locale,[{...lump,building_unit:'12',floor_apartment:unit}],{}),
      rule_settings:{signatures:[{title:'Project Manager'},{name:'Site Engineer'},{}]},
      report_options:{show_building_subtotals:true,show_unit_subtotals:true}});
    assert.equal(named.fieldGroups.flat().find(({key}) => key === 'location').value,`12 - ${unit}`);
    assert.deepEqual(named.signatures,[{name:'',title:'Project Manager'},{name:'Site Engineer',title:''}]);
    const html = buildCertificateHtml(named);
    assert.ok(html.includes('<bdi dir="auto">Project Manager</bdi>'));
    assert.ok(html.includes('<bdi dir="auto">Site Engineer</bdi>'));
    const exported = new ExcelJS.Workbook();
    await exported.xlsx.load(await writeCertificateXlsx(named));
    const detail = exported.getWorksheet(named.labels.detail);
    const captionColumn = detail.getRow(1).values.indexOf(named.labels.description);
    const captions = detail.getColumn(captionColumn).values;
    for (const name of [unit,'12']) {
      const parts = arabic ? ['إجمالي',name] : [name,'Total'];
      assert.ok(html.includes(parts.map((part) => `<bdi dir="auto">${part}</bdi>`).join(' ')));
      const rowNumber = captions.indexOf(parts.join(' '));
      assert.ok(rowNumber > 0);
      assert.equal(detail.getRow(rowNumber).getCell(captionColumn).alignment.readingOrder,named.direction);
    }
  }
  const reportLocation = (lines) => buildCertificateDocument(fixture('en',lines,{})).fieldGroups.flat()
    .find(({key}) => key === 'location')?.value;
  assert.equal(reportLocation([{...lump,building_unit:'A',floor_apartment:'1'}, {...lump,building_unit:'A',floor_apartment:'2'}]),'A');
  assert.equal(reportLocation([{...lump,building_unit:'A',floor_apartment:'1'}, {...lump,building_unit:'B',floor_apartment:'1'}]),undefined);

  const quantityLines = [
    {...lump,id:'area',mode:'area',count:3,billed_quantity:9.5,unit:'m²',width:1,height:3,dimension_unit:'m'},
    {...lump,id:'linear',mode:'linear',count:4,billed_quantity:8,unit:'m',width:2,dimension_unit:'m'},
    {...lump,id:'pcs',mode:'count',count:6,billed_quantity:6,unit:'Pcs'},
  ].map((line) => ({...line,building_unit:'12',floor_apartment:'جانبية شمال'}));
  const quantities = buildCertificateDocument({...fixture('ar',quantityLines,{}),report_options:allSubtotals});
  const expectedQuantities = [{value:'9.5',unit:'م²'},{value:'8',unit:'م.ط'},{value:'6',unit:'عدد'}];
  assert.deepEqual(quantities.workTotals.quantities,expectedQuantities);
  assert.equal(quantities.workTotals.count,13);
  assert.equal(quantities.coverRows[0].count,13);
  for (const row of quantities.detailBands.filter(({kind}) => kind === 'subtotal')) {
    assert.deepEqual(row.totals.quantities,expectedQuantities);
    assert.equal(row.totals.count,13);
  }
  const quantityWorkbook = new ExcelJS.Workbook();
  await quantityWorkbook.xlsx.load(await writeCertificateXlsx(quantities));
  const quantitySheet = quantityWorkbook.getWorksheet(quantities.labels.detail);
  const headers = quantitySheet.getRow(1).values;
  const captions = quantitySheet.getColumn(headers.indexOf(quantities.labels.description)).values;
  for (const label of ['إجمالي جانبية شمال','إجمالي 12',quantities.labels.total]) {
    const totalRow = quantitySheet.getRow(captions.indexOf(label));
    assert.equal(totalRow.getCell(headers.indexOf(quantities.labels.count)).value,13);
    assert.equal(totalRow.getCell(headers.indexOf(quantities.labels.billed_quantity)).value,'9.5 م²\n8 م.ط\n6 عدد');
  }

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
