function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

const numberFormats = {
  money: new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  number: new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }),
  percent: new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }),
};

function amount(value, kind = 'money') {
  if (value == null || !Number.isFinite(value)) return '';
  const suffix = kind === 'percent' ? '%' : '';
  return `<bdi dir="ltr">${numberFormats[kind].format(value)}${suffix}</bdi>`;
}

function rowCells(row, columns) {
  return columns.map(({ key, kind }) => kind === 'text'
    ? `<td><bdi dir="auto">${escapeHtml(row[key])}</bdi></td>`
    : `<td class="number">${amount(row[key], kind)}</td>`).join('');
}

function tableOpening(columns) {
  const total = columns.reduce((sum, column) => sum + column.weight, 0);
  return `<table><colgroup>${columns.map((column) => `<col style="width:${100 * column.weight / total}%">`).join('')}</colgroup>
    <thead><tr>${columns.map(({ kind, label }) => `<th scope="col"${kind === 'text' ? '' : ' class="number"'}>${escapeHtml(label)}</th>`).join('')}</tr></thead><tbody></tbody></table>`;
}

function subtotalRow(values, columns, moneyKeys, title) {
  const firstNumeric = columns.findIndex((column) => moneyKeys.includes(column.key));
  return `<tr class="subtotal"><th scope="row" colspan="${firstNumeric}">${escapeHtml(title)}</th>${columns.slice(firstNumeric).map(({ key }) => `<td class="number">${amount(values[key])}</td>`).join('')}</tr>`;
}

function fullIdentity(model) {
  const { issuer, fieldGroups, watermark } = model;
  return `<header class="full-identity">
    <div class="issuer">
      ${issuer.logo ? `<img src="${escapeHtml(issuer.logo)}" alt="">` : ''}
      <div><strong><bdi dir="auto">${escapeHtml(issuer.name)}</bdi></strong>
      ${issuer.details.length ? `<div class="issuer-details">${issuer.details.map((detail) => `<bdi dir="auto">${escapeHtml(detail)}</bdi>`).join(' <span aria-hidden="true">·</span> ')}</div>` : ''}</div>
      ${watermark ? `<span class="draft">${escapeHtml(watermark)}</span>` : ''}
    </div>
    <div class="identities" style="--groups:${Math.max(1, fieldGroups.length)}">
      ${fieldGroups.map((group) => `<dl>${group.map((field) => `<div${field.wide ? ' class="wide"' : ''}><dt>${escapeHtml(field.label)}</dt><dd><bdi dir="${field.isolated ? 'ltr' : 'auto'}">${escapeHtml(field.value)}</bdi></dd></div>`).join('')}</dl>`).join('')}
    </div></header>`;
}

function compactIdentity(model) {
  const { issuer, officialNumber, certificateType, identities, watermark } = model;
  return `<header class="compact-identity"><strong><bdi dir="auto">${escapeHtml(issuer.name)}</bdi></strong>
    <bdi dir="auto">${escapeHtml(identities.project)}</bdi><span>${escapeHtml(certificateType)} <bdi dir="ltr">${escapeHtml(officialNumber)}</bdi></span>
    ${watermark ? `<span class="draft">${escapeHtml(watermark)}</span>` : ''}</header>`;
}

function pageTemplate(id, title, table, model) {
  return `<template id="${id}"><article class="sheet">${fullIdentity(model)}${compactIdentity(model)}
    <main class="page-content">${title ? `<h1>${escapeHtml(title)}</h1>` : ''}${table || ''}</main>
    <footer><span><bdi dir="ltr">${escapeHtml(model.officialNumber)}</bdi>${model.officialNumber && model.revision !== '' ? ` · ${escapeHtml(model.labels.revision)} <bdi dir="ltr">${escapeHtml(model.revision)}</bdi>` : ''}</span>
    <span>${escapeHtml(model.labels.page)} <bdi dir="ltr" class="page-number"></bdi> ${escapeHtml(model.labels.of)} <bdi dir="ltr" class="page-total"></bdi></span></footer></article></template>`;
}

function financeBlock(model) {
  const { financeRows, labels, currency } = model;
  if (!financeRows.length) return '';
  const showBasis = financeRows.some((row) => row.basis || row.basisValue != null);
  const valueColumns = ['previous', 'current', 'cumulative'];
  return `<section class="finance" aria-label="${escapeHtml(labels.finance)}"><h2>${escapeHtml(labels.finance)} <span><bdi dir="ltr">${escapeHtml(currency)}</bdi></span></h2>
    <table aria-label="${escapeHtml(labels.finance)}"><colgroup><col style="width:${showBasis ? 29 : 43}%">
    ${showBasis ? '<col style="width:20%">' : ''}${valueColumns.map(() => '<col>').join('')}</colgroup>
    <thead><tr><th></th>${showBasis ? `<th>${escapeHtml(labels.basis)}</th>` : ''}${valueColumns.map((key) => `<th class="number">${escapeHtml(labels[key])}</th>`).join('')}</tr></thead>
    <tbody>${financeRows.map((row) => `<tr${row.emphasis ? ' class="payable"' : ''}><th scope="row">${escapeHtml(row.label)}</th>
      ${showBasis ? `<td>${escapeHtml(row.basis)} ${amount(row.basisValue)}</td>` : ''}
      ${valueColumns.map((key) => `<td class="number">${amount(row[key])}</td>`).join('')}</tr>`).join('')}
    </tbody></table></section>`;
}

function sourceTemplate(id, units) {
  return `<template id="${id}"><table><tbody>${units.join('')}</tbody></table></template>`;
}

function splitWideLine(line, columns, landscape) {
  const width = columns.reduce((sum, column) => sum + column.weight, 0);
  const fragments = [line];
  for (const column of columns.filter((entry) => entry.kind === 'text' && entry.key !== 'work_item')) {
    const value = Array.from(line[column.key] || '');
    const chunkSize = Math.max(55, Math.floor(2300 * column.weight / width * (landscape ? 1 : 0.78)));
    if (value.length <= chunkSize) continue;
    fragments[0] = { ...fragments[0] };
    for (let offset = 0, index = 0; offset < value.length; offset += chunkSize, index += 1) {
      fragments[index] ||= { work_item: line.work_item };
      fragments[index][column.key] = value.slice(offset, offset + chunkSize).join('');
    }
  }
  return fragments;
}

function detailRows(model) {
  const { columns, detailGroups, labels, moneyKeys, workTotals, landscape } = model;
  if (detailGroups.length === 0) return [`<tr><td class="empty" colspan="${columns.length}">${escapeHtml(labels.no_lines)}</td></tr>`];
  const units = [];
  for (const group of detailGroups) {
    const rows = group.lines.flatMap((line) => splitWideLine(line, columns, landscape));
    rows.forEach((line, index) => {
      const first = index === 0;
      const last = index === rows.length - 1;
      const merged = `<tr${first ? ' data-keep-next="true" class="group"' : ''}${first ? ' data-group-row="true"' : ''} data-group="${escapeHtml(group.name)}"><th scope="rowgroup" colspan="${columns.length}"><bdi dir="auto">${escapeHtml(group.name)}</bdi></th></tr>`;
      const row = `<tr data-group="${escapeHtml(group.name)}"${last ? ' data-keep-next="true"' : ''}>${rowCells(line, columns)}</tr>`;
      units.push(first ? merged : '', row);
      if (last) units.push(subtotalRow(group.totals, columns, moneyKeys, labels.subtotal));
    });
  }
  units.push(subtotalRow(workTotals, columns, moneyKeys, labels.total));
  return units;
}

function buildCertificateHtml(model) {
  const { labels, locale, direction, columns, coverRows, moneyKeys, workTotals, receiptColumns, landscape, paper } = model;
  const coverColumns = [{ key: 'name', label: labels.work_type, weight: 34, kind: 'text' },
    ...moneyKeys.map((key) => ({ key, label: labels[key], weight: 18, kind: 'money' }))];
  const size = paper === 'Letter' ? [215.9, 279.4] : [210, 297];
  const [width, height] = landscape ? size.toReversed() : size;
  const cover = coverRows.map((row) => `<tr>${rowCells(row, coverColumns)}</tr>`);
  cover.push(subtotalRow(workTotals, coverColumns, moneyKeys, labels.total));
  const receiptRows = model.receipts.map((row) => `<tr>${rowCells(row, receiptColumns)}</tr>`);
  return `<!doctype html><html lang="${locale}" dir="${direction}"><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';">
    <title>${escapeHtml(model.officialNumber || model.watermark)}</title><style>
    @page { size: ${width}mm ${height}mm; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: white; color: #183148; }
    body { font: 10pt/1.36 Arial, Tahoma, sans-serif; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    .sheet { width: ${width}mm; height: ${height - 0.6}mm; padding: 12mm 13mm 9mm; display: flex; flex-direction: column; }
    .sheet + .sheet { break-before: page; }
    header, h1, h2, th, td, footer { overflow-wrap: anywhere; }
    .issuer { display: flex; align-items: center; gap: 3mm; border-block-end: 1.4pt solid #265e68; padding-block-end: 3mm; }
    .issuer img { width: 18mm; height: 14mm; object-fit: contain; }
    .issuer strong { display: block; font-size: 19pt; line-height: 1.15; letter-spacing: -0.3pt; }
    .issuer-details { color: #3c5266; margin-block-start: 1mm; }
    .draft { display: inline-block; margin-inline-start: auto; align-self: flex-start; padding: 1mm 2.4mm; border: 0.6pt solid #a16b27; border-radius: 1mm; color: #774507; font-weight: 700; white-space: nowrap; }
    .identities { display: grid; grid-template-columns: repeat(var(--groups), minmax(0, 1fr)); gap: 3mm; margin-block: 3mm; }
    .identities dl { min-width: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 2mm; align-content: start; border-inline-start: 0.75pt solid #c7d8dc; padding-inline-start: 2.4mm; margin: 0; }
    .identities dl > div { min-width: 0; margin-block-start: 1mm; }
    .identities .wide { grid-column: 1 / -1; }
    .identities dt { font-size: 8pt; font-weight: 700; color: #466476; }
    .identities dd { margin: 0; }
    .compact-identity { align-items: baseline; justify-content: space-between; gap: 4mm; padding-block-end: 2mm; border-block-end: 1pt solid #265e68; }
    .compact-identity strong { font-size: 12pt; }
    .compact-identity, .continued .full-identity { display: none; }
    .continued .compact-identity { display: flex; }
    .page-content { min-height: 0; flex: 1; }
    h1 { font-size: 12.5pt; margin: 2mm 0 1.4mm; }
    h2 { font-size: 11pt; margin: 2mm 0 1.4mm; }
    h2 span { font-size: 8pt; font-weight: 400; margin-inline-start: 2mm; color: #466476; }
    table { width: 100%; table-layout: fixed; border: 0; border-collapse: collapse; font-size: 9pt; }
    th, td { border-block-end: 0.65pt solid #d4dee4; padding: 1.25mm 1.5mm; vertical-align: top; text-align: start; }
    thead th { background: #e5eef1; border-block-end: 1pt solid #b5cbd1; color: #183148; font-weight: 700; }
    table .number { font-variant-numeric: tabular-nums; text-align: end; }
    tr.group th { background: #f3f7f8; font-size: 9pt; color: #26525a; }
    .subtotal { color: #255363; font-weight: 700; }
    .detail .subtotal:last-child, .cover .subtotal { background: #edf4f5; }
    .empty { color: #3c5266; padding-block: 4mm; text-align: center; }
    .finance { padding-block-start: 1.5mm; }
    .finance tbody th { font-weight: 400; }
    .finance .payable { background: #e5eef1; color: #183148; font-weight: 700; }
    .finance .payable th { font-weight: 700; }
    footer { border-block-start: 0.7pt solid #adc2c9; padding-block-start: 1.5mm; margin-block-start: 2mm; display: flex; justify-content: space-between; gap: 5mm; color: #3c5266; font-size: 8pt; }
    footer span:last-child { white-space: nowrap; }
    </style></head><body>
    ${pageTemplate('cover', labels.cover, tableOpening(coverColumns), model)}
    ${pageTemplate('detail', labels.detail, tableOpening(columns), model)}
    ${pageTemplate('receipts', labels.receipts, tableOpening(receiptColumns), model)}
    ${pageTemplate('settlement', '', '', model)}
    ${sourceTemplate('cover-rows', cover)}${sourceTemplate('detail-rows', detailRows(model))}${sourceTemplate('receipts-rows', receiptRows)}
    <template id="settlement-block">${financeBlock(model)}</template>
    </body></html>`;
}

// Runs inside Chromium, using the exact physical dimensions and fonts used for printing.
async function paginateCertificate({ issued, measured, outputMode, hasReceipts }) {
  await document.fonts.load('10pt Arial', 'العربية English');
  await document.fonts.load('bold 10pt Arial', 'العربية English');
  await document.fonts.ready;

  function makePage(id, continued) {
    const sheet = document.getElementById(id).content.firstElementChild.cloneNode(true);
    sheet.classList.add(id);
    if (continued) sheet.classList.add('continued');
    document.body.append(sheet);
    return sheet;
  }

  function fits(page) {
    const content = page.querySelector('main');
    const last = content.lastElementChild;
    return !last || last.getBoundingClientRect().bottom <= content.getBoundingClientRect().bottom - 1;
  }

  function rowsFor(id) {
    const rows = [...document.getElementById(`${id}-rows`).content.querySelectorAll('tr')];
    const units = [];
    for (let index = 0; index < rows.length;) {
      const unit = [rows[index++]];
      while (index < rows.length && unit.at(-1).dataset.keepNext) unit.push(rows[index++]);
      units.push(unit);
    }
    return units;
  }

  function pagesFor(id) {
    let page = makePage(id, false);
    const pages = [page];
    let table = page.querySelector('tbody');
    let group = '';
    for (const units of rowsFor(id)) {
      const rows = units.map((row) => row.cloneNode(true));
      const groupRow = rows.find((row) => row.dataset.groupRow);
      if (groupRow) group = groupRow.dataset.group;
      const hadRows = table.rows.length > 0;
      table.append(...rows);
      if (!fits(page)) {
        rows.forEach((row) => row.remove());
        if (!hadRows) throw new Error('The certificate heading or a work line is too tall for the chosen paper');
        page = makePage(id, true);
        pages.push(page);
        table = page.querySelector('tbody');
        if (!groupRow && id === 'detail' && group && rows.some((row) => row.dataset.group)) {
          const groupHeader = document.createElement('tr');
          groupHeader.classList.add('group');
          const cell = document.createElement('th');
          cell.scope = 'rowgroup';
          cell.colSpan = page.querySelectorAll('thead th').length;
          cell.textContent = group;
          groupHeader.append(cell);
          table.append(groupHeader);
        }
        table.append(...rows);
        if (!fits(page)) throw new Error('A certificate work line is too tall for the chosen paper');
      }
    }
    return pages;
  }

  const detail = pagesFor('detail');
  const longMeasured = measured && detail.length > 1;
  const hasCover = outputMode === 'summary_details' || (longMeasured && (issued || outputMode !== 'detail_only'));
  const cover = hasCover ? pagesFor('cover') : [];
  const settlementTemplate = document.getElementById('settlement-block').content.firstElementChild;
  if (settlementTemplate) {
    const settlement = settlementTemplate.cloneNode(true);
    const settlementPages = cover.length ? cover : detail;
    let page = settlementPages.at(-1);
    page.querySelector('main').append(settlement);
    if (!fits(page)) {
      page = makePage('settlement', true);
      settlementPages.push(page);
      page.querySelector('main').append(settlement);
      if (!fits(page)) throw new Error('The certificate settlement is too tall for the chosen paper');
    }
  }

  const pages = [...cover, ...detail, ...(hasReceipts ? pagesFor('receipts') : [])];
  for (const [index, page] of pages.entries()) {
    page.querySelector('.page-number').textContent = String(index + 1);
    page.querySelector('.page-total').textContent = String(pages.length);
    document.body.append(page);
  }
  return { pageCount: pages.length, detailPages: pages.filter((page) => page.classList.contains('detail')).length, hasCover };
}

module.exports = { buildCertificateHtml, paginateCertificate };
