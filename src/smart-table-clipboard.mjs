export function parseSmartClipboardGrid(textValue) {
  if (typeof textValue !== "string") return [];
  return textValue
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.split("\t").map((cell) => cell.trim()))
    .filter((row) =>
      row.some((cell) => String(cell ?? "").trim() !== ""),
    );
}

export function hasExplicitSmartValue(row = {}) {
  const touched = row._touched || {};
  return Object.entries(touched).some(
    ([key, wasTouched]) =>
      wasTouched && String(row[key] ?? "").trim() !== "",
  );
}

export function isSmartFillDownShortcut(event = {}) {
  const controlPressed = !!(event.ctrlKey || event.metaKey);
  const physicalD = event.code === "KeyD";
  const localizedKey = String(event.key || "").toLowerCase() === "d";
  return controlPressed && (physicalD || localizedKey);
}

const ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const EASTERN_ARABIC_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

function normalizeDigits(value) {
  return String(value ?? "")
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_INDIC_DIGITS.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(EASTERN_ARABIC_DIGITS.indexOf(digit)));
}

export function normalizeSmartNumericClipboardValue(value) {
  let text = normalizeDigits(value)
    .trim()
    .replace(/[\s\u00a0\u202f]/g, "")
    .replace(/\u2212/g, "-")
    .replace(/\u066b/g, ".")
    .replace(/\u066c/g, ",")
    .replace(/%$/, "");
  if (!text.includes(",")) return text;
  const commaCount = (text.match(/,/g) || []).length;
  const usesThousandsSeparators = /^[-+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(text);
  if (text.includes(".") || commaCount > 1 || usesThousandsSeparators)
    return text.replace(/,/g, "");
  if (/^[-+]?\d+,\d{1,2}$/.test(text)) return text.replace(",", ".");
  return text.replace(/,/g, "");
}

export function expandSmartClipboardGrid(grid, destinationRange = null) {
  const source = (grid || []).map((line) =>
    Array.isArray(line) ? line : [line],
  );
  if (!source.length || !source[0]?.length || !destinationRange) return source;
  const sourceRows = source.length;
  const sourceColumns = Math.max(...source.map((line) => line.length));
  const destinationRows =
    destinationRange.rowEnd - destinationRange.rowStart + 1;
  const destinationColumns =
    destinationRange.colEnd - destinationRange.colStart + 1;
  const targetRows = Math.max(sourceRows, destinationRows);
  const targetColumns = Math.max(sourceColumns, destinationColumns);
  if (targetRows === sourceRows && targetColumns === sourceColumns)
    return source;
  return Array.from({ length: targetRows }, (_, rowIndex) =>
    Array.from({ length: targetColumns }, (_, columnIndex) => {
      const sourceLine = source[rowIndex % sourceRows] || [""];
      return sourceLine[columnIndex % Math.max(1, sourceLine.length)] ?? "";
    }),
  );
}

export function applySmartClipboardGridToRows({
  rows = [],
  startRow = 0,
  startKey,
  columnOrder = [],
  grid = [],
  createRow = () => ({ _touched: {} }),
  normalizeValue = (value) => value,
}) {
  if (!grid.length || !grid[0]?.length) return null;
  const startColumn = columnOrder.indexOf(startKey);
  if (startColumn < 0) return null;
  const next = rows.map((row) => ({
    ...row,
    _touched: { ...(row?._touched || {}) },
  }));
  while (next.length < startRow + grid.length) next.push(createRow());
  grid.forEach((line, rowOffset) => {
    const rowIndex = startRow + rowOffset;
    if (!next[rowIndex]) next[rowIndex] = createRow();
    const rowPatch = {};
    const touched = { ...(next[rowIndex]._touched || {}) };
    line.forEach((value, columnOffset) => {
      const targetKey = columnOrder[startColumn + columnOffset];
      if (!targetKey) return;
      rowPatch[targetKey] = normalizeValue(value, targetKey);
      touched[targetKey] = true;
    });
    next[rowIndex] = { ...next[rowIndex], ...rowPatch, _touched: touched };
  });
  return {
    rows: next,
    startColumn,
    endColumn: Math.min(
      columnOrder.length - 1,
      startColumn + Math.max(...grid.map((line) => line.length)) - 1,
    ),
  };
}

export function fillSmartSelectionDownRows({
  rows = [],
  range,
  columnOrder = [],
  createRow = () => ({ _touched: {} }),
}) {
  if (
    !range ||
    range.rowEnd <= range.rowStart ||
    range.colStart < 0 ||
    range.colEnd < range.colStart
  ) {
    return null;
  }
  const next = rows.map((row) => ({
    ...row,
    _touched: { ...(row?._touched || {}) },
  }));
  while (next.length <= range.rowEnd) next.push(createRow());
  const source = next[range.rowStart] || createRow();
  for (let rowIndex = range.rowStart + 1; rowIndex <= range.rowEnd; rowIndex += 1) {
    const touched = { ...(next[rowIndex]?._touched || {}) };
    const patch = {};
    for (let columnIndex = range.colStart; columnIndex <= range.colEnd; columnIndex += 1) {
      const key = columnOrder[columnIndex];
      if (!key) continue;
      patch[key] = source[key] ?? "";
      touched[key] = true;
    }
    next[rowIndex] = { ...next[rowIndex], ...patch, _touched: touched };
  }
  return next;
}

function smartGridCellHasValue(row, columnKey) {
  if (!row || !columnKey) return false;
  const value = row[columnKey];
  if (value === null || value === undefined || String(value).trim() === "") {
    return false;
  }
  if (row._gridGhost && !row._touched?.[columnKey]) return false;
  return true;
}

export function findSmartCtrlArrowDestination({
  rows = [],
  columnOrder = [],
  focusCell,
  direction,
}) {
  if (!rows.length || !columnOrder.length || !focusCell) return null;
  const rowIndex = rows.findIndex(
    (row) => String(row?._gridId || "") === String(focusCell.rowId || ""),
  );
  const columnIndex = columnOrder.indexOf(focusCell.columnKey);
  if (rowIndex < 0 || columnIndex < 0) return null;

  // smartCellOrder follows the visual RTL order: increasing the column index
  // moves physically left, decreasing it moves physically right.
  const delta = {
    ArrowDown: [1, 0],
    ArrowUp: [-1, 0],
    ArrowLeft: [0, 1],
    ArrowRight: [0, -1],
  }[direction];
  if (!delta) return null;

  const inside = (row, column) =>
    row >= 0 &&
    row < rows.length &&
    column >= 0 &&
    column < columnOrder.length;
  const pointAt = (row, column) => ({
    rowId: rows[row]._gridId,
    columnKey: columnOrder[column],
  });
  const populatedAt = (row, column) =>
    smartGridCellHasValue(rows[row], columnOrder[column]);

  let nextRow = rowIndex + delta[0];
  let nextColumn = columnIndex + delta[1];
  if (!inside(nextRow, nextColumn)) return pointAt(rowIndex, columnIndex);

  if (populatedAt(nextRow, nextColumn)) {
    let destinationRow = nextRow;
    let destinationColumn = nextColumn;
    while (inside(nextRow + delta[0], nextColumn + delta[1])) {
      const candidateRow = nextRow + delta[0];
      const candidateColumn = nextColumn + delta[1];
      if (!populatedAt(candidateRow, candidateColumn)) break;
      nextRow = candidateRow;
      nextColumn = candidateColumn;
      destinationRow = candidateRow;
      destinationColumn = candidateColumn;
    }
    return pointAt(destinationRow, destinationColumn);
  }

  while (inside(nextRow, nextColumn)) {
    if (populatedAt(nextRow, nextColumn)) return pointAt(nextRow, nextColumn);
    const candidateRow = nextRow + delta[0];
    const candidateColumn = nextColumn + delta[1];
    if (!inside(candidateRow, candidateColumn)) {
      return pointAt(nextRow, nextColumn);
    }
    nextRow = candidateRow;
    nextColumn = candidateColumn;
  }
  return pointAt(rowIndex, columnIndex);
}

export function smartSelectionAfterNavigation({
  selection,
  destination,
  extendSelection = false,
}) {
  if (!destination) return selection || null;
  const anchorCell =
    extendSelection && selection?.anchorCell
      ? { ...selection.anchorCell }
      : { ...destination };
  return {
    anchorCell,
    focusCell: { ...destination },
  };
}

function normalizeSmartSearchCharacter(character) {
  return character
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .toLocaleLowerCase();
}

export function normalizeSmartSearchText(value) {
  return Array.from(String(value ?? ""))
    .map(normalizeSmartSearchCharacter)
    .join("")
    .trim();
}

function normalizedSmartSearchValueWithMap(value) {
  const original = String(value ?? "");
  let normalized = "";
  const sourceIndexes = [];
  Array.from(original).forEach((character, sourceIndex) => {
    const next = normalizeSmartSearchCharacter(character);
    for (const normalizedCharacter of Array.from(next)) {
      normalized += normalizedCharacter;
      sourceIndexes.push(sourceIndex);
    }
  });
  return { original, normalized, sourceIndexes };
}

export function findSmartSearchMatchRanges(value, searchText) {
  const query = normalizeSmartSearchText(searchText);
  if (!query) return [];
  const { original, normalized, sourceIndexes } =
    normalizedSmartSearchValueWithMap(value);
  const ranges = [];
  let cursor = 0;
  while (cursor <= normalized.length - query.length) {
    const matchIndex = normalized.indexOf(query, cursor);
    if (matchIndex < 0) break;
    const start = sourceIndexes[matchIndex] ?? 0;
    const lastMappedIndex =
      sourceIndexes[matchIndex + query.length - 1] ?? start;
    const end =
      lastMappedIndex +
      (Array.from(original).at(lastMappedIndex)?.length || 1);
    ranges.push({ start, end });
    cursor = matchIndex + Math.max(1, query.length);
  }
  return ranges;
}

export function findSmartTableMatches({
  rows = [],
  columnOrder = [],
  searchText = "",
}) {
  if (!normalizeSmartSearchText(searchText)) return [];
  const matches = [];
  rows.forEach((row, rowIndex) => {
    columnOrder.forEach((columnKey) => {
      const value = String(row?.[columnKey] ?? "");
      const ranges = findSmartSearchMatchRanges(value, searchText);
      if (!ranges.length) return;
      matches.push({
        rowId: row?._gridId || "",
        rowIndex,
        visibleRowNumber: rowIndex + 1,
        columnKey,
        value,
        matchRange: ranges[0],
        occurrenceCount: ranges.length,
      });
    });
  });
  return matches;
}

export function replaceSmartSearchMatches(
  value,
  searchText,
  replacementText = "",
) {
  const original = String(value ?? "");
  const ranges = findSmartSearchMatchRanges(original, searchText);
  if (!ranges.length) return { value: original, replacements: 0 };
  let cursor = 0;
  let nextValue = "";
  for (const range of ranges) {
    nextValue += original.slice(cursor, range.start);
    nextValue += String(replacementText ?? "");
    cursor = range.end;
  }
  nextValue += original.slice(cursor);
  return { value: nextValue, replacements: ranges.length };
}

export function insertSmartRowRelative({
  rows = [],
  targetRowId,
  placement = "above",
  createRow,
}) {
  const targetIndex = rows.findIndex(
    (row) => String(row?._gridId || "") === String(targetRowId || ""),
  );
  if (targetIndex < 0 || typeof createRow !== "function") return null;
  const row = createRow();
  const insertIndex = targetIndex + (placement === "below" ? 1 : 0);
  return {
    row,
    insertIndex,
    rows: [
      ...rows.slice(0, insertIndex),
      row,
      ...rows.slice(insertIndex),
    ],
  };
}

export function removeSmartRowById(rows = [], rowId) {
  const index = rows.findIndex(
    (row) => String(row?._gridId || "") === String(rowId || ""),
  );
  if (index < 0) return null;
  return {
    index,
    row: rows[index],
    rows: [...rows.slice(0, index), ...rows.slice(index + 1)],
  };
}
