const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  formatMonetaryTotal,
  renderReportHtmlV2,
} = require("../server/index.cjs");

assert.equal(formatMonetaryTotal(108029873.38), "108,029,873");
assert.equal(formatMonetaryTotal(15124182.26), "15,124,182");
assert.equal(formatMonetaryTotal(123154055.64), "123,154,056");

const fixture = {
  type: "offer",
  title: "عرض سعر",
  operation_no: "TOTALS-TEST",
  generated_at: "2026-07-15T12:00:00.000Z",
  party: "عميل اختبار",
  project: "مشروع اختبار",
  show_dimensions: false,
  vat_enabled: true,
  rows: [
    {
      description: "بند متر مربع",
      unit_code: "sqm",
      unit: "م²",
      quantity: 255,
      item_count: 20,
      rate: 5856.39,
      gross_total: 108029873.38,
      net_total: 123154055.64,
      vat_enabled: 1,
    },
    {
      description: "بند متر طولي",
      unit_code: "lm",
      unit: "م.ط",
      quantity: 120,
      item_count: 15,
      rate: 1,
      gross_total: 0,
      net_total: 0,
    },
    {
      description: "بند بالعدد",
      unit_code: "وحدة",
      unit: "وحدة",
      quantity: 125,
      item_count: 125,
      rate: 1,
      gross_total: 0,
      net_total: 0,
    },
  ],
  totals: {
    quantity: 500,
    item_count: 160,
    gross_total: 108029873.38,
    real_gross_total: 108029873.38,
    vat_amount: 15124182.26,
    discount_amount: 0,
    credit: 0,
    net_total: 123154055.64,
  },
  tax_breakdown: [
    {
      key: "vat",
      label: "ضريبة القيمة المضافة 14%",
      amount: 15124182.26,
    },
  ],
  branding: {
    companyNameEn: "Accounting Management",
    companyNameAr: "إدارة الحسابات",
    companyAbbreviation: "AM",
    companyNameColor: "#9a6b16",
    lineColor: "#d6c08d",
    tableHeaderBg: "#171717",
    tableHeaderText: "#d8ad3e",
  },
};

const html = renderReportHtmlV2(fixture);
assert.match(
  html,
  /\.totals\{[^}]*display:grid;/,
);
assert.match(
  html,
  /\.totals-primary\{[^}]*justify-content:stretch/,
);
assert.match(
  html,
  /\.totals-primary>\.box\{[^}]*flex:1 1 max-content;[^}]*width:auto/,
);
assert.match(
  html,
  /\.totals-secondary\{[^}]*justify-content:flex-end/,
);
assert.match(html, /\.box\{[^}]*direction:rtl;[^}]*text-align:right;[^}]*justify-content:space-between;/);
assert.match(html, /\.report-total-label\{[^}]*direction:rtl;[^}]*white-space:nowrap;/);
assert.match(
  html,
  /\.report-total-value\{[^}]*direction:rtl;[^}]*text-align:left;[^}]*justify-content:flex-end;[^}]*margin-inline-start:auto;[^}]*white-space:nowrap;/,
);
assert.ok(html.includes("108,029,873"));
assert.ok(html.includes("15,124,182"));
assert.ok(html.includes("123,154,056"));
assert.ok(html.includes("255"));
assert.ok(html.includes("120"));
assert.ok(html.includes("125"));
assert.match(
  html,
  /<span class="total-value-part"><bdi dir="ltr">255<\/bdi><span class="report-total-unit" dir="rtl">م²<\/span><\/span>/,
);
assert.match(
  html,
  /<span class="total-value-part"><span class="report-total-prefix" dir="rtl">بالعدد<\/span><bdi dir="ltr">125<\/bdi><\/span>/,
);
assert.match(
  html,
  /<span class="report-total-label">العدد<\/span><strong class="report-total-value"><span class="total-value-part"><bdi dir="ltr">35<\/bdi><\/span><\/strong>/,
);
assert.ok(!html.includes('<bdi dir="ltr">160</bdi>'));
assert.ok(!html.includes("255م²"));
assert.ok(!html.includes("<strong>108,029,873.38</strong>"));
assert.ok(!html.includes("<strong>123,154,055.64</strong>"));

const unitOnlyHtml = renderReportHtmlV2({
  ...fixture,
  operation_no: "UNIT-ONLY-TEST",
  rows: [
    {
      description: "بند بالعدد فقط",
      unit_code: "قطعة",
      unit: "قطعة",
      quantity: 125,
      item_count: 125,
      rate: 1,
      gross_total: 125,
      net_total: 125,
    },
  ],
  totals: {
    ...fixture.totals,
    quantity: 125,
    item_count: 125,
    gross_total: 125,
    real_gross_total: 125,
    vat_amount: 0,
    net_total: 125,
  },
  tax_breakdown: [],
  vat_enabled: false,
});
assert.match(
  unitOnlyHtml,
  /<span class="report-total-label">الكمية<\/span><strong class="report-total-value"><span class="total-value-part"><span class="report-total-prefix" dir="rtl">بالعدد<\/span><bdi dir="ltr">125<\/bdi><\/span><\/strong>/,
);
assert.doesNotMatch(
  unitOnlyHtml,
  /<span class="report-total-label">العدد<\/span>/,
);

const outputDir = path.resolve(__dirname, "..", "tmp", "pdfs");
fs.mkdirSync(outputDir, { recursive: true });
const outputPath = path.join(outputDir, "report-totals-alignment.html");
fs.writeFileSync(outputPath, html, "utf8");

console.log(`Report totals regression passed. Fixture: ${outputPath}`);
