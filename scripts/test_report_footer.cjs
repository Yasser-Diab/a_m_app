const assert=require('node:assert/strict');
const {footerMetadata,footerContents,pdfFooter}=require('../server/report-footer.cjs');
const {compactLoadingReference}=require('../server/project-operations/references.cjs');
const branding={companyPhone:'+20 100 123 4567',website:'https://company.test',companyAbbreviation:'HGAD'};
const now=new Date('2026-11-22T22:05:00Z');
for(const type of ['offer','price_offer','invoice','taxInvoice','nonTaxInvoice'])for(const locale of ['en','ar']){
  const meta=footerMetadata({type,report_language:locale,prepared_by:'Engineer <One>'},branding,'2.0.7',now);
  assert.equal(meta.preparedAt,'23/11/2026 · 00:05');assert.equal(meta.commercial,true);
  const html=footerContents(meta);
  assert.ok(html.includes(branding.companyPhone));assert.ok(html.indexOf('app-credit')>html.indexOf('https://company.test'));
  assert.ok(html.includes('font-size:0.25em'));assert.ok(html.indexOf('23/11/2026')>html.indexOf('Engineer &lt;One&gt;'));
  assert.ok(footerContents(meta,true).includes(locale==='ar'?'معاينة الصفحة':'Page preview'));
  assert.ok(pdfFooter(meta).includes('font-size:9.5px'));
}
for(const type of ['contractor','statement','project-operations','certificate']){
  const meta=footerMetadata({type,prepared_by:'Reviewer'},branding,'2.0.7',now),html=footerContents(meta);
  assert.equal(meta.commercial,false);assert.ok(!html.includes('app-credit'));assert.ok(html.includes('EasyCommercial 2.0.7'));
}
assert.equal(compactLoadingReference('CL1001-PRJ1370',1),'LO100113700001');
assert.equal(compactLoadingReference('CL1-PRJ23',12),'LO000100230012');
assert.notEqual(compactLoadingReference('CL1-PRJ23',1),compactLoadingReference('CL12-PRJ3',1));
console.log('Commercial phone footer, quarter-size app credit, Cairo date/time, escaping and compact loading numbers passed');
