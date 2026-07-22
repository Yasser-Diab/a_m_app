import assert from "node:assert/strict";
import {
  applySmartClipboardGridToRows,
  expandSmartClipboardGrid,
  fillSmartSelectionDownRows,
  findSmartCtrlArrowDestination,
  findSmartTableMatches,
  hasExplicitSmartValue,
  insertSmartRowRelative,
  isSmartFillDownShortcut,
  normalizeSmartSearchText,
  normalizeSmartNumericClipboardValue,
  parseSmartClipboardGrid,
  replaceSmartSearchMatches,
  removeSmartRowById,
  smartSelectionAfterNavigation,
} from "../src/smart-table-clipboard.mjs";

const singleCell = parseSmartClipboardGrid("145");
const filledRange = expandSmartClipboardGrid(singleCell, {
  rowStart: 1,
  rowEnd: 3,
  colStart: 2,
  colEnd: 4,
});
assert.deepEqual(filledRange, [
  ["145", "145", "145"],
  ["145", "145", "145"],
  ["145", "145", "145"],
]);

const rectangle = parseSmartClipboardGrid("A\tB\nC\tD");
const tiledRange = expandSmartClipboardGrid(rectangle, {
  rowStart: 0,
  rowEnd: 3,
  colStart: 0,
  colEnd: 3,
});
assert.deepEqual(tiledRange, [
  ["A", "B", "A", "B"],
  ["C", "D", "C", "D"],
  ["A", "B", "A", "B"],
  ["C", "D", "C", "D"],
]);

assert.deepEqual(
  parseSmartClipboardGrid(
    "\r\nRow 1\r\n\r\nRow 2\r\n\t\t\r\nRow 3\r\n\r\nRow 4\r\n",
  ),
  [["Row 1"], ["Row 2"], ["Row 3"], ["Row 4"]],
);
assert.deepEqual(
  parseSmartClipboardGrid("Item A\t1200\t\t5\n\n0\t0.00\t-0\t"),
  [
    ["Item A", "1200", "", "5"],
    ["0", "0.00", "-0", ""],
  ],
);
assert.deepEqual(
  parseSmartClipboardGrid(
    `${"\n".repeat(250)}First${"\n".repeat(500)}Second${"\n".repeat(250)}`,
  ),
  [["First"], ["Second"]],
);
assert.deepEqual(parseSmartClipboardGrid(null), []);
assert.equal(
  normalizeSmartSearchText(" الأَعْمـالُ الإنشائية "),
  normalizeSmartSearchText("الاعمال الانشائيه"),
);
assert.equal(
  normalizeSmartSearchText("Tempered Glass"),
  normalizeSmartSearchText("TEMPERED GLASS"),
);

const searchRows = [
  {
    _gridId: "search-1",
    description: "الأعمال الإنشائية",
    glass_spec: "Tempered Glass",
  },
  {
    _gridId: "search-2",
    description: "توريد وتركيب ألومنيوم قطاع جامبو",
    glass_spec: "",
  },
];
const arabicMatches = findSmartTableMatches({
  rows: searchRows,
  columnOrder: ["description", "glass_spec"],
  searchText: "الاعمال الانشائيه",
});
assert.equal(arabicMatches.length, 1);
assert.equal(arabicMatches[0].rowId, "search-1");
assert.equal(arabicMatches[0].columnKey, "description");
const englishMatches = findSmartTableMatches({
  rows: searchRows,
  columnOrder: ["description", "glass_spec"],
  searchText: "tempered glass",
});
assert.equal(englishMatches.length, 1);
assert.equal(englishMatches[0].columnKey, "glass_spec");
assert.deepEqual(
  replaceSmartSearchMatches(
    "توريد وتركيب ألومنيوم قطاع ألومنيوم",
    "الومنيوم",
    "الوميتال",
  ),
  {
    value: "توريد وتركيب الوميتال قطاع الوميتال",
    replacements: 2,
  },
);

const contextRows = [
  { _gridId: "row-10", description: "10" },
  { _gridId: "row-11", description: "11" },
  { _gridId: "row-12", description: "12" },
];
const insertedAbove = insertSmartRowRelative({
  rows: contextRows,
  targetRowId: "row-11",
  placement: "above",
  createRow: () => ({ _gridId: "new-above", description: "" }),
});
assert.deepEqual(
  insertedAbove.rows.map((row) => row._gridId),
  ["row-10", "new-above", "row-11", "row-12"],
);
const insertedBelow = insertSmartRowRelative({
  rows: contextRows,
  targetRowId: "row-11",
  placement: "below",
  createRow: () => ({ _gridId: "new-below", description: "" }),
});
assert.deepEqual(
  insertedBelow.rows.map((row) => row._gridId),
  ["row-10", "row-11", "new-below", "row-12"],
);
const removedByStableId = removeSmartRowById(
  insertedBelow.rows,
  "row-11",
);
assert.equal(removedByStableId.row.description, "11");
assert.deepEqual(
  removedByStableId.rows.map((row) => row._gridId),
  ["row-10", "new-below", "row-12"],
);

const tenThousandSearchRows = Array.from({ length: 10_000 }, (_, index) => ({
  _gridId: `large-search-${index}`,
  description:
    index % 250 === 0
      ? `الأعمال الإنشائية ${index}`
      : `Unmatched item ${index}`,
  glass_spec: index % 400 === 0 ? "Tempered Glass" : "",
}));
const largeArabicSearch = findSmartTableMatches({
  rows: tenThousandSearchRows,
  columnOrder: ["description", "glass_spec"],
  searchText: "الاعمال الانشائيه",
});
assert.equal(largeArabicSearch.length, 40);
const largeEnglishSearch = findSmartTableMatches({
  rows: tenThousandSearchRows,
  columnOrder: ["description", "glass_spec"],
  searchText: "tempered glass",
});
assert.equal(largeEnglishSearch.length, 25);

const columns = [
  "building_unit",
  "floor_apartment",
  "description",
  "unit_code",
];
const applied = applySmartClipboardGridToRows({
  rows: [{ description: "source", _touched: { description: true } }],
  startRow: 1,
  startKey: "description",
  columnOrder: columns,
  grid: [
    ["First", "count"],
    ["Second", "sqm"],
  ],
  createRow: () => ({ unit_code: "sqm", _touched: {} }),
});
assert.equal(applied.rows.length, 3);
assert.equal(applied.rows[1].description, "First");
assert.equal(applied.rows[1].unit_code, "count");
assert.equal(applied.rows[2].description, "Second");
assert.equal(applied.rows[2].unit_code, "sqm");
assert.equal(applied.rows[2]._touched.unit_code, true);

const zeroUnit = applySmartClipboardGridToRows({
  rows: [{ unit_code: "sqm", _touched: {} }],
  startRow: 0,
  startKey: "unit_code",
  columnOrder: columns,
  grid: [["0"]],
});
assert.equal(zeroUnit.rows[0].unit_code, "0");
assert.equal(zeroUnit.rows[0]._touched.unit_code, true);
assert.equal(hasExplicitSmartValue(zeroUnit.rows[0]), true);
assert.equal(
  hasExplicitSmartValue({ unit_code: "sqm", _touched: {} }),
  false,
);

assert.equal(normalizeSmartNumericClipboardValue("46,115"), "46115");
assert.equal(normalizeSmartNumericClipboardValue("29,013"), "29013");
assert.equal(normalizeSmartNumericClipboardValue("12,5"), "12.5");
assert.equal(normalizeSmartNumericClipboardValue("1,234.56"), "1234.56");
assert.equal(normalizeSmartNumericClipboardValue("١٢٬٣٤٨"), "12348");
assert.equal(
  isSmartFillDownShortcut({
    ctrlKey: true,
    code: "KeyD",
    key: "ي",
  }),
  true,
);
assert.equal(
  isSmartFillDownShortcut({
    ctrlKey: true,
    code: "KeyD",
    key: "d",
    repeat: true,
  }),
  true,
);
assert.equal(
  isSmartFillDownShortcut({
    ctrlKey: false,
    code: "KeyD",
    key: "d",
  }),
  false,
);

const commaFormattedRates = parseSmartClipboardGrid(
  "46,115\n29,013\n10,484\n12,348",
);
const appliedRates = applySmartClipboardGridToRows({
  rows: [],
  startRow: 0,
  startKey: "rate",
  columnOrder: ["description", "rate"],
  grid: commaFormattedRates,
  createRow: () => ({ _touched: {} }),
  normalizeValue: (value, key) =>
    key === "rate" ? normalizeSmartNumericClipboardValue(value) : value,
});
assert.deepEqual(
  appliedRates.rows.map((row) => row.rate),
  ["46115", "29013", "10484", "12348"],
);
assert.equal(appliedRates.rows.length, 4);

const fiveThousandClipboardRows = Array.from(
  { length: 5000 },
  (_, index) => (index % 2 === 0 ? `${index}\t\t${index + 1}` : ""),
).join("\r\n");
const parsedLargeClipboard = parseSmartClipboardGrid(
  `\r\n${fiveThousandClipboardRows}\r\n`,
);
assert.equal(parsedLargeClipboard.length, 2500);
assert.deepEqual(parsedLargeClipboard[0], ["0", "", "1"]);
assert.deepEqual(parsedLargeClipboard.at(-1), ["4998", "", "4999"]);
const appliedLargeClipboard = applySmartClipboardGridToRows({
  rows: [],
  startRow: 0,
  startKey: "description",
  columnOrder: ["description", "rate", "item_count"],
  grid: parsedLargeClipboard,
  createRow: () => ({ _touched: {} }),
});
assert.equal(appliedLargeClipboard.rows.length, 2500);
assert.equal(appliedLargeClipboard.rows[2499].description, "4998");
assert.equal(appliedLargeClipboard.rows[2499].rate, "");
assert.equal(appliedLargeClipboard.rows[2499].item_count, "4999");

const preservedTextComma = applySmartClipboardGridToRows({
  rows: [],
  startRow: 0,
  startKey: "description",
  columnOrder: ["description", "rate"],
  grid: [["باب, شباك"]],
  createRow: () => ({ _touched: {} }),
  normalizeValue: (value, key) =>
    key === "rate" ? normalizeSmartNumericClipboardValue(value) : value,
});
assert.equal(preservedTextComma.rows[0].description, "باب, شباك");

const filledDown = fillSmartSelectionDownRows({
  rows: [
    { description: "Top", rate: "46115", _touched: {} },
    { description: "Old 1", rate: "1", _touched: {} },
    { description: "Old 2", rate: "2", _touched: {} },
  ],
  range: { rowStart: 0, rowEnd: 2, colStart: 0, colEnd: 1 },
  columnOrder: ["description", "rate"],
  createRow: () => ({ _touched: {} }),
});
assert.deepEqual(
  filledDown.map((row) => [row.description, row.rate]),
  [
    ["Top", "46115"],
    ["Top", "46115"],
    ["Top", "46115"],
  ],
);
assert.equal(filledDown[1]._touched.description, true);
assert.equal(filledDown[2]._touched.rate, true);

const navigationColumns = ["building_unit", "floor_apartment", "description", "rate"];
const navigationRows = [
  { _gridId: "r1", building_unit: "B1", floor_apartment: "U1", description: "A", rate: "1" },
  { _gridId: "r2", building_unit: "B1", floor_apartment: "U2", description: "B", rate: "2" },
  { _gridId: "r3", building_unit: "", floor_apartment: "", description: "", rate: "" },
  { _gridId: "r4", building_unit: "B2", floor_apartment: "U4", description: "D", rate: "4" },
  { _gridId: "r5", _gridGhost: true, _touched: {}, building_unit: "", floor_apartment: "", description: "", rate: "" },
];

assert.deepEqual(
  findSmartCtrlArrowDestination({
    rows: navigationRows,
    columnOrder: navigationColumns,
    focusCell: { rowId: "r1", columnKey: "description" },
    direction: "ArrowDown",
  }),
  { rowId: "r2", columnKey: "description" },
);
assert.deepEqual(
  findSmartCtrlArrowDestination({
    rows: navigationRows,
    columnOrder: navigationColumns,
    focusCell: { rowId: "r2", columnKey: "description" },
    direction: "ArrowDown",
  }),
  { rowId: "r4", columnKey: "description" },
);
assert.deepEqual(
  findSmartCtrlArrowDestination({
    rows: navigationRows,
    columnOrder: navigationColumns,
    focusCell: { rowId: "r2", columnKey: "description" },
    direction: "ArrowLeft",
  }),
  { rowId: "r2", columnKey: "rate" },
);
assert.deepEqual(
  findSmartCtrlArrowDestination({
    rows: navigationRows,
    columnOrder: navigationColumns,
    focusCell: { rowId: "r2", columnKey: "description" },
    direction: "ArrowRight",
  }),
  { rowId: "r2", columnKey: "building_unit" },
);

let repeatedSelection = {
  anchorCell: { rowId: "r2", columnKey: "description" },
  focusCell: { rowId: "r2", columnKey: "description" },
};
for (let iteration = 0; iteration < 100; iteration += 1) {
  const direction = iteration % 2 === 0 ? "ArrowDown" : "ArrowUp";
  const destination = findSmartCtrlArrowDestination({
    rows: navigationRows,
    columnOrder: navigationColumns,
    focusCell: repeatedSelection.focusCell,
    direction,
  });
  repeatedSelection = smartSelectionAfterNavigation({
    selection: repeatedSelection,
    destination,
    extendSelection: true,
  });
  assert.deepEqual(repeatedSelection.anchorCell, {
    rowId: "r2",
    columnKey: "description",
  });
}

for (const direction of [
  "ArrowDown",
  "ArrowUp",
  "ArrowLeft",
  "ArrowRight",
]) {
  let moveSelection = {
    anchorCell: { rowId: "r2", columnKey: "description" },
    focusCell: { rowId: "r2", columnKey: "description" },
  };
  let extendSelection = moveSelection;
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const moveDestination = findSmartCtrlArrowDestination({
      rows: navigationRows,
      columnOrder: navigationColumns,
      focusCell: moveSelection.focusCell,
      direction,
    });
    moveSelection = smartSelectionAfterNavigation({
      selection: moveSelection,
      destination: moveDestination,
      extendSelection: false,
    });
    assert.ok(moveSelection.focusCell?.rowId);

    const extendDestination = findSmartCtrlArrowDestination({
      rows: navigationRows,
      columnOrder: navigationColumns,
      focusCell: extendSelection.focusCell,
      direction,
    });
    extendSelection = smartSelectionAfterNavigation({
      selection: extendSelection,
      destination: extendDestination,
      extendSelection: true,
    });
    assert.deepEqual(extendSelection.anchorCell, {
      rowId: "r2",
      columnKey: "description",
    });
  }
}

let repeatedFillRows = [
  { description: "Source", rate: "100", _touched: {} },
  { description: "", rate: "", _touched: {} },
  { description: "", rate: "", _touched: {} },
];
for (let iteration = 0; iteration < 100; iteration += 1) {
  repeatedFillRows = fillSmartSelectionDownRows({
    rows: repeatedFillRows,
    range: { rowStart: 0, rowEnd: 2, colStart: 0, colEnd: 1 },
    columnOrder: ["description", "rate"],
  });
  assert.equal(repeatedFillRows[2].description, "Source");
  assert.equal(repeatedFillRows[2].rate, "100");
}

for (const rowCount of [10, 100, 500, 1000]) {
  const beforeRows = Array.from({ length: rowCount }, (_, index) => ({
    description: index === 0 ? "Top source" : `Old ${index}`,
    rate: index === 0 ? "46115" : String(index),
    item_count: index === 0 ? "7" : String(index + 1),
    _touched: {},
  }));
  const largeFill = fillSmartSelectionDownRows({
    rows: beforeRows,
    range: {
      rowStart: 0,
      rowEnd: rowCount - 1,
      colStart: 0,
      colEnd: 2,
    },
    columnOrder: ["description", "rate", "item_count"],
    createRow: () => ({ _touched: {} }),
  });
  assert.equal(largeFill.length, rowCount);
  assert.deepEqual(
    largeFill.map((row) => [row.description, row.rate, row.item_count]),
    Array.from({ length: rowCount }, () => ["Top source", "46115", "7"]),
  );

  // The UI stores one pre-fill snapshot, so one undo restores the full range
  // and one redo reapplies the same complete transaction.
  const undoRows = beforeRows.map((row) => ({
    ...row,
    _touched: { ...row._touched },
  }));
  assert.equal(undoRows[rowCount - 1].rate, String(rowCount - 1));
  const redoRows = fillSmartSelectionDownRows({
    rows: undoRows,
    range: {
      rowStart: 0,
      rowEnd: rowCount - 1,
      colStart: 0,
      colEnd: 2,
    },
    columnOrder: ["description", "rate", "item_count"],
    createRow: () => ({ _touched: {} }),
  });
  assert.equal(redoRows[rowCount - 1].rate, "46115");
}

console.log("Smart-table clipboard regression tests passed.");
