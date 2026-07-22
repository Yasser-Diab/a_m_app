const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { renderReportHtmlV2 } = require("../server/index.cjs");

function row({
  id,
  building = "",
  unit = "",
  project = "النخيل",
  description = "بند اختبار",
}) {
  return {
    id,
    project,
    building_unit: building,
    floor_apartment: unit,
    description,
    unit_code: "sqm",
    quantity: 1,
    item_count: 1,
    rate: 100,
    gross_total: 100,
    net_total: 100,
  };
}

function fixture(rows, operationNo) {
  return {
    type: "offer",
    title: "عرض سعر",
    operation_no: operationNo,
    generated_at: "2026-07-16T09:00:00.000Z",
    party: "عميل اختبار",
    project: "النخيل",
    rows,
    totals: {
      quantity: rows.length,
      item_count: rows.length,
      gross_total: rows.length * 100,
      real_gross_total: rows.length * 100,
      net_total: rows.length * 100,
    },
    tax_breakdown: [],
    subtotal_mode: "none",
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
}

const building = "قطعة 7 بلوك 28006";
const secondBuilding = "قطعة 8 بلوك 28007";

const oneBuildingOneUnit = renderReportHtmlV2(
  fixture(
    [
      row({ id: 1, building, unit: "شقة 1" }),
      row({ id: 2, building, unit: "شقة 1" }),
    ],
    "LOCATION-1",
  ),
);
assert.ok(oneBuildingOneUnit.includes("النخيل - قطعة 7 بلوك 28006 - شقة 1"));
assert.ok(!oneBuildingOneUnit.includes("building-group-row"));
assert.ok(!oneBuildingOneUnit.includes("unit-group-row"));

const oneBuildingSeveralUnits = renderReportHtmlV2(
  fixture(
    [
      row({ id: 1, building, unit: "", description: "صف مباشر" }),
      row({ id: 2, building, unit: "شقة 1" }),
      row({ id: 3, building, unit: "شقة 2" }),
      row({ id: 4, building, unit: "شقة 3" }),
    ],
    "LOCATION-2",
  ),
);
assert.ok(oneBuildingSeveralUnits.includes("النخيل - قطعة 7 بلوك 28006"));
assert.ok(!oneBuildingSeveralUnits.includes("النخيل - قطعة 7 بلوك 28006 - شقة"));
assert.ok(!oneBuildingSeveralUnits.includes("building-group-row"));
assert.match(oneBuildingSeveralUnits, /unit-group-row[^>]*><td[^>]*>شقة 1<\/td>/);
assert.match(oneBuildingSeveralUnits, /unit-group-row[^>]*><td[^>]*>شقة 2<\/td>/);
assert.match(oneBuildingSeveralUnits, /unit-group-row[^>]*><td[^>]*>شقة 3<\/td>/);
assert.ok(
  oneBuildingSeveralUnits.indexOf("صف مباشر") <
    oneBuildingSeveralUnits.indexOf("unit-group-row"),
);

const severalBuildings = renderReportHtmlV2(
  fixture(
    [
      row({ id: 1, building, unit: "شقة 1" }),
      row({ id: 2, building: secondBuilding, unit: "شقة 2" }),
    ],
    "LOCATION-3",
  ),
);
assert.match(severalBuildings, /<span>المشروع<\/span><strong>النخيل<\/strong>/);
assert.match(severalBuildings, /building-group-row[^>]*><td[^>]*>قطعة 7 بلوك 28006<\/td>/);
assert.match(severalBuildings, /building-group-row[^>]*><td[^>]*>قطعة 8 بلوك 28007<\/td>/);
assert.match(severalBuildings, /unit-group-row[^>]*><td[^>]*>شقة 1<\/td>/);
assert.match(severalBuildings, /unit-group-row[^>]*><td[^>]*>شقة 2<\/td>/);

const oneBuildingNoUnit = renderReportHtmlV2(
  fixture(
    [row({ id: 1, building, unit: "" })],
    "LOCATION-4",
  ),
);
assert.ok(oneBuildingNoUnit.includes("النخيل - قطعة 7 بلوك 28006"));
assert.ok(!oneBuildingNoUnit.includes("النخيل - قطعة 7 بلوك 28006 - "));
assert.ok(!oneBuildingNoUnit.includes("building-group-row"));
assert.ok(!oneBuildingNoUnit.includes("unit-group-row"));

const outputDir = path.resolve(__dirname, "..", "tmp", "pdfs");
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(
  path.join(outputDir, "report-location-one-building-one-unit.html"),
  oneBuildingOneUnit,
  "utf8",
);
fs.writeFileSync(
  path.join(outputDir, "report-location-one-building-several-units.html"),
  oneBuildingSeveralUnits,
  "utf8",
);
fs.writeFileSync(
  path.join(outputDir, "report-location-several-buildings.html"),
  severalBuildings,
  "utf8",
);
fs.writeFileSync(
  path.join(outputDir, "report-location-one-building-no-unit.html"),
  oneBuildingNoUnit,
  "utf8",
);

console.log("Report heading and building/unit grouping regressions passed.");
