const {reportColors, subtotalLabelParts} = require('./certificate-document-model.cjs');

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
  return `<bdi dir="ltr">${numberFormats[kind].format(value || 0)}${suffix}</bdi>`;
}

function rowCells(row, columns) {
  return columns.map(({ key, kind }) => kind === 'text'
    ? `<td><bdi dir="auto">${escapeHtml(row[key])}</bdi></td>`
    : `<td class="number" data-number="${key}">${amount(row[key], kind)}</td>`).join('');
}

function tableOpening(columns, rows = '') {
  const total = columns.reduce((sum, column) => sum + column.weight, 0);
  return `<table><colgroup>${columns.map(({key,kind,weight}) => `<col data-key="${key}" data-weight="${weight}" data-kind="${kind}" style="width:${100 * weight / total}%">`).join('')}</colgroup>
    <thead><tr>${columns.map(({ kind, label }) => `<th scope="col"${kind === 'text' ? '' : ' class="number"'}>${escapeHtml(label)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
}

function rollupCells(values, columns, moneyKeys) {
  const cells = [];
  for (let index = 0; index < columns.length; index++) {
    const {key} = columns[index];
    if (key === 'billed_quantity' && values.quantities?.length) {
      const extra = columns[index + 1]?.key === 'unit' ? 'unit' : '';
      cells.push(`<td class="quantity-total" data-quantity-total="${key}" data-quantity-extra="${extra}"${extra ? ' colspan="2"' : ''}>${quantityList(values.quantities)}</td>`);
      if (extra) index++;
    } else if (key === 'rate') {
      cells.push('<td class="number">'+(values.rates||[]).map(entry=>'<span dir="ltr"><span data-number="rate">'+amount(entry.rate)+'</span>'+(values.rates.length>1?' / '+escapeHtml(entry.unit):'')+'</span>').join('<br>')+'</td>');
    } else if (key === 'count' || key === 'cumulative_progress' || moneyKeys.includes(key)) {
      cells.push(`<td class="number" data-number="${key}">${amount(values[key],key === 'count' ? 'number' : key === 'cumulative_progress' ? 'percent' : 'money')}</td>`);
    } else cells.push('<td></td>');
  }
  return cells.join('');
}

function subtotalRow(values, columns, moneyKeys, title, attributes = '') {
  const firstNumeric = columns.findIndex(({key}) => ['rate','cumulative_progress'].includes(key) || moneyKeys.includes(key) ||
    (key === 'count' && values.count != null) || (key === 'billed_quantity' && values.quantities?.length));
  const caption = Array.isArray(title) ? title.map((part) => `<bdi dir="auto">${escapeHtml(part)}</bdi>`).join(' ') : escapeHtml(title);
  return `<tr ${attributes} class="subtotal"><th scope="row" colspan="${firstNumeric}">${caption}</th>${rollupCells(values,columns.slice(firstNumeric),moneyKeys)}</tr>`;
}

function quantityList(quantities, addSeparators = false) {
  return `<span class="quantity-list">${quantities.map(({value,unit},index) => `<span class="quantity-entry">${addSeparators && index ? '<span aria-hidden="true">+</span>' : ''}<span class="quantity-pair"><bdi dir="ltr">${escapeHtml(value)}</bdi><bdi dir="auto">${escapeHtml(unit)}</bdi></span></span>`).join('')}</span>`;
}

function identityValue(field) {
  if (field.quantities?.length) return quantityList(field.quantities,true);
  return `<bdi dir="${field.isolated ? 'ltr' : 'auto'}">${escapeHtml(field.value)}</bdi>`;
}

function fullIdentity(model) {
  const { issuer, fieldGroups, qr } = model;
  const certificate = fieldGroups.find((group) => group.some(({ key }) => key === 'certificate')) || [];
  const primaryKeys = ['certificate', 'issue_date', 'work_from', 'work_to'];
  const primary = certificate.filter(({ key }) => primaryKeys.includes(key));
  const facts = certificate.filter(({ key }) => !primaryKeys.includes(key));
  const balanceKeys = ['cumulative_payable', 'cumulative_credit'];
  const textKeys = ['title', 'notes'];
  const [customer = [], project = []] = fieldGroups.filter((group) => group !== certificate);
  const columns = [
    [customer, facts.filter(({ key }) => key !== 'total_quantity' && !balanceKeys.includes(key) && !textKeys.includes(key))],
    [project, facts.filter(({ key }) => key === 'total_quantity')],
    [primary, facts.filter(({ key }) => balanceKeys.includes(key))],
  ];
  const notes = facts.filter(({ key }) => textKeys.includes(key));
  const fieldList = (entries, className) => `<dl class="metadata-list ${className}">${entries.map((entry) =>
    `<div data-field="${escapeHtml(entry.key)}"><dt>${escapeHtml(entry.label)}</dt><dd>${identityValue(entry)}</dd></div>`
  ).join('')}</dl>`;
  return `<header class="full-identity">
    <div class="issuer">
      ${issuer.logo ? `<img src="${escapeHtml(issuer.logo)}" alt="">` : ''}
      <div>${issuer.name ? `<strong><bdi dir="auto">${escapeHtml(issuer.name)}</bdi></strong>` : ''}
      ${issuer.alternate ? `<div class="issuer-details"><bdi dir="auto">${escapeHtml(issuer.alternate)}</bdi></div>` : ''}</div>
      ${qr ? `<img class="certificate-qr" src="${escapeHtml(qr)}" alt="Certificate QR code">` : ''}
    </div>
    <div class="identities">${columns.map(([identity, details]) => `<div class="metadata-column">
      ${identity.length ? fieldList(identity, 'identity-values') : ''}
      ${details.length ? fieldList(details, 'identity-details') : ''}</div>`).join('')}</div>
    ${notes.length ? fieldList(notes, 'certificate-notes') : ''}</header>`;
}

function compactIdentity(model) {
  const { issuer, officialNumber, certificateType, direction, qr } = model;
  return `<header class="compact-identity"><div class="compact-reference">${qr ? `<img class="certificate-qr" src="${escapeHtml(qr)}" alt="Certificate QR code">` : ''}
    <span dir="${direction}">${escapeHtml(certificateType)} <bdi dir="ltr">${escapeHtml(officialNumber && `#${officialNumber}`)}</bdi></span></div>
    <strong><bdi dir="auto">${escapeHtml(issuer.name)}</bdi></strong></header>`;
}

function pageTemplate(id, title, table, model) {
  return `<template id="${id}"${id.startsWith('cover') ? ' data-summary-page' : ''}><article class="sheet${id.startsWith('cover') ? ' cover' : ''}">${fullIdentity(model)}${compactIdentity(model)}
    ${model.watermark ? `<div class="status-watermark" data-approved="${model.approved}" dir="ltr">${escapeHtml(model.watermark)}</div>` : ''}
    <main class="page-content">${title ? `<h1>${escapeHtml(title)}</h1>` : ''}${table || ''}</main>
    <footer><div><div dir="${model.direction}">${escapeHtml(model.labels.page)} <bdi dir="ltr" class="page-number"></bdi> ${escapeHtml(model.labels.of)} <bdi dir="ltr" class="page-total"></bdi></div>
      ${model.appVersion ? `<small>EasyCommercial ${escapeHtml(model.appVersion)}</small>` : ''}</div>
    <div class="footer-company"><div><bdi dir="ltr">${escapeHtml(model.issuer.website)}</bdi></div>
      <div><bdi dir="auto">${escapeHtml(model.issuer.shortName)}</bdi></div></div>
    <div class="footer-user" dir="ltr">${model.preparedBy ? `<div>By <bdi dir="auto">${escapeHtml(model.preparedBy)}</bdi></div>` : ''}
      ${model.preparedAt ? `<small>${escapeHtml(model.preparedAt)}</small>` : ''}</div></footer></article></template>`;
}

function signaturesBlock(model) {
  return `<aside class="signoff"><div class="stamp">${escapeHtml(model.labels.stamp)}</div>
    <div class="signatories" dir="${model.direction}" style="--signatures:${Math.max(1,model.signatures.length)}">${model.signatures.map(({ name, title }) => `<div class="signatory">
      <bdi dir="auto">${escapeHtml(name || title)}</bdi>${name && title ? `<small><bdi dir="auto">${escapeHtml(title)}</bdi></small>` : ''}</div>`).join('')}</div></aside>`;
}

function financeBlock(model) {
  const { financeRows, labels, currency } = model;
  if (!financeRows.length) return '';
  const showBasis = financeRows.some((row) => row.basis || row.basisValue != null);
  const valueColumns = ['previous', 'current', 'cumulative'];
  return `<section class="finance settlement-block" aria-label="${escapeHtml(labels.finance)}"><h2>${escapeHtml(labels.finance)} <span><bdi dir="ltr">${escapeHtml(currency)}</bdi></span></h2>
    ${model.historical && labels.recorded_basis ? `<div class="settlement-basis">${escapeHtml(labels.recorded_basis)}</div>` : ''}
    <table aria-label="${escapeHtml(labels.finance)}"><colgroup><col data-key="label" data-weight="${showBasis ? 29 : 43}" data-kind="text">
    ${showBasis ? '<col data-key="basis" data-weight="20" data-kind="text">' : ''}${valueColumns.map((key) => `<col data-key="${key}" data-weight="18" data-kind="money">`).join('')}</colgroup>
    <thead><tr><th></th>${showBasis ? `<th scope="col" class="basis-cell">${escapeHtml(labels.basis)}</th>` : ''}${valueColumns.map((key) => `<th class="number">${escapeHtml(labels[key])}</th>`).join('')}</tr></thead>
    <tbody>${financeRows.map((row) => `<tr${row.emphasis ? ' class="payable"' : ''}><th scope="row">${escapeHtml(row.label)}</th>
      ${showBasis ? `<td class="basis-cell"><bdi class="basis-label" dir="auto">${escapeHtml(row.basis)}</bdi> ${amount(row.basisValue)}</td>` : ''}
      ${valueColumns.map((key) => `<td class="number" data-number="${key}">${amount(row[key])}</td>`).join('')}</tr>`).join('')}
    </tbody></table></section>`;
}

function retentionBlock(model){
  if(model.variant!=='internal'||!model.holds?.length)return '';
  const t=(ar,en)=>model.locale==='ar'?ar:en;
  return `<section class="finance"><h2>${t('الاستقطاعات المحتجزة — متابعة داخلية','Retentions — Internal follow-up')}</h2>
    <table><colgroup><col data-key="label" data-weight="40" data-kind="text"><col data-key="date" data-weight="25" data-kind="text"><col data-key="balance" data-weight="25" data-kind="money"></colgroup>
    <thead><tr><th>${t('الاستقطاع','Deduction')}</th><th>${t('تاريخ التحصيل','Collection date')}</th><th class="number">${t('المحتجز','Held')}</th></tr></thead>
    <tbody>${model.holds.map(hold=>`<tr><td>${escapeHtml(hold.label)}</td><td><bdi dir="ltr">${escapeHtml(hold.collection_date||'—')}</bdi></td><td class="number" data-number="balance">${amount(hold.balance)}</td></tr>`).join('')}</tbody></table></section>`;
}

function sourceTemplate(id, units) {
  return `<template id="${id}"><table><tbody>${units.join('')}</tbody></table></template>`;
}

function splitWideLine(line, columns, landscape) {
  const width = columns.reduce((sum, column) => sum + column.weight, 0);
  const fragments = [line];
  for (const column of columns.filter((entry) => entry.kind === 'text' && entry.key !== 'work_item')) {
    const value = Array.from(line[column.key] || '');
    const chunkSize = Math.min(column.key === 'note' ? 130 : 420,
      Math.max(55,Math.floor(2300 * column.weight / width * (landscape ? 1 : 0.78))));
    if (value.length <= chunkSize) continue;
    fragments[0] = { ...fragments[0] };
    for (let offset = 0, index = 0; offset < value.length; offset += chunkSize, index += 1) {
      fragments[index] ||= { work_item: line.work_item };
      fragments[index][column.key] = value.slice(offset, offset + chunkSize).join('');
    }
  }
  return fragments;
}

function bandAttributes(path) {
  return path.map(({kind}) => `data-band-${kind.replace('_','-')}="true"`).join(' ');
}

function detailRows(model) {
  const { columns, detailGroups, labels, moneyKeys, workTotals, landscape, showGroupSubtotals } = model;
  const bands = model.detailBands ?? detailGroups.flatMap(({name,lines,totals}) => {
    const path = name ? [{kind:'work_type',name}] : [];
    return [...(name ? [{kind:'group',path}] : []), ...lines.map((line) => ({kind:'line',line,path})),
      ...(name && showGroupSubtotals ? [{kind:'subtotal',path,totals}] : [])];
  });
  if (!bands.length) return [`<tr><td class="empty" colspan="${columns.length}">${escapeHtml(labels.no_lines)}</td></tr>`];
  return [...bands.flatMap(({kind,path,line,totals},index) => {
    const attributes = `data-path="${escapeHtml(JSON.stringify(path))}" ${bandAttributes(path)}`;
    if (kind === 'group') return [`<tr class="group group-${path.at(-1).kind}" ${attributes} data-group-row="true" data-keep-next="true"><th scope="rowgroup" colspan="${columns.length}"><bdi dir="auto">${escapeHtml(path.at(-1).name)}</bdi></th></tr>`];
    if (kind === 'subtotal') return [subtotalRow(model.showDetailQuantities===false?{...totals,count:null,quantities:[]}:totals,columns,moneyKeys,subtotalLabelParts(model,path.at(-1)),attributes + (bands[index+1]?.kind === 'subtotal' ? ' data-keep-next="true"' : ''))];
    const fragments = splitWideLine(line,columns,landscape);
    return fragments.map((fragment,i) => `<tr ${attributes}${i === fragments.length-1 && bands[index+1]?.kind === 'subtotal' ? ' data-keep-next="true"' : ''}>${rowCells(fragment,columns)}</tr>`);
  }), subtotalRow(model.showDetailQuantities===false?{...workTotals,count:null,quantities:[]}:workTotals, columns, moneyKeys, labels.total)];
}

function buildCertificateHtml(model) {
  const { labels, locale, direction, columns, coverRows, moneyKeys, workTotals, receiptColumns, landscape, paper } = model;
  const coverTextColumns=model.coverTextColumns||[{key:'name',label:model.groupLabel||labels.work_type,weight:34,kind:'text'}];
  const summaryColumns = (textColumns) => [...textColumns,
    ...(model.showSummaryRate ? [{key:'rate',label:labels.rate,weight:14,kind:'money'}] : []),
    ...(model.showSummaryQuantities!==false&&workTotals.count != null ? [{key:'count',label:labels.count,weight:8,kind:'number'}] : []),
    ...(model.showSummaryQuantities!==false&&workTotals.quantities?.length ? [{key:'billed_quantity',label:labels.billed_quantity,weight:26,kind:'quantity'}] : []),
    ...(model.showSummaryProgress ? [{key:'cumulative_progress',label:labels.cumulative_progress,weight:14,kind:'percent'}] : []),
    ...moneyKeys.map((key) => ({ key, label: labels[key], weight: 18, kind: 'money' }))];
  const size = paper === 'Letter' ? [215.9, 279.4] : [210, 297];
  const [width, height] = landscape ? size.toReversed() : size;
  const style = model.style || {};
  const summaries = (model.summarySections?.length ? model.summarySections : [
    {id:'cover',title:labels.cover,rows:coverRows,textColumns:coverTextColumns},
  ]).map(section => {
    const tableColumns = summaryColumns(section.textColumns);
    const rows = section.rows.map(row => `<tr>${rowCells(row,section.textColumns)}${rollupCells(row,tableColumns.slice(section.textColumns.length),moneyKeys)}</tr>`);
    rows.push(subtotalRow({...workTotals,rates:[]},tableColumns,moneyKeys,labels.total));
    return {...section,tableColumns,rows};
  });
  const receiptRows = model.receipts.map((row) => `<tr>${rowCells(row, receiptColumns)}</tr>`);
  return `<!doctype html><html lang="${locale}" dir="${direction}"><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';">
    <title>${escapeHtml(model.officialNumber || model.watermark)}</title><style>
    @page { size: ${width}mm ${height}mm; margin: 0; }
    * { box-sizing: border-box; }
    :root { --brand:${style.companyNameColor || reportColors.text}; --line:${style.lineColor || '#265e68'};
      --heading:${style.headingFont || 'Arial,Tahoma,sans-serif'}; --heading-body:${style.bodyFont || 'Arial,Tahoma,sans-serif'};
      --body-font:Arial,Tahoma,sans-serif; --report-width:${width - 26}mm;
      --building-band:${reportColors.building}; --unit-band:${reportColors.unit};
      --work-band:color-mix(in srgb,var(--building-band),var(--unit-band)); --opposite-x:-1px; }
    :root[dir="rtl"] { --opposite-x:1px; }
    html, body { margin: 0; padding: 0; background: white; color: ${reportColors.text}; }
    body { font: 10pt/1.36 var(--body-font); print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    .sheet { position: relative; isolation: isolate; width: ${width}mm; height: ${height - 0.6}mm; padding: 8mm 13mm 9mm; display: flex; flex-direction: column; }
    .sheet + .sheet { break-before: page; }
    header, h1, h2, th, td, footer { overflow-wrap: anywhere; }
    .issuer { display:flex; align-items:center; gap:3mm; border-block-end:1.4pt solid var(--line); padding-block-end:1.5mm; }
    .issuer img { width:16mm; height:12mm; object-fit:contain; }
    .issuer:has(.certificate-qr) { position:relative; min-height:19.5mm; padding-left:21mm; }
    .issuer img.certificate-qr { position:absolute; left:0; top:0; width:18mm; height:18mm; }
    .compact-identity img.certificate-qr { width:17mm; height:17mm; object-fit:contain; }
    .issuer strong, .compact-identity strong, h1, h2 { font-family:var(--heading); color:var(--brand); }
    .issuer strong { display:block; font-size:17pt; line-height:1.15; letter-spacing:-0.3pt; }
    .issuer-details { font-family:var(--heading-body); color:${reportColors.muted}; margin-block-start:.5mm; }
    .status-watermark { position: absolute; left: 50%; top: 49%; z-index: 3; transform: translate(-50%, -50%) rotate(-25deg); pointer-events: none; white-space: nowrap; font-size: 36pt; font-weight: 700; letter-spacing: 2pt; opacity: .3; color: #934044; }
    .status-watermark[data-approved="true"] { color: #427052; }
    .identities { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); grid-template-rows:auto auto;
      gap:1mm 4mm; margin-block:1.4mm; }
    .metadata-column { min-width:0; display:grid; grid-row:1 / -1; grid-template-rows:subgrid;
      grid-template-columns:fit-content(42%) minmax(0,1fr); }
    .metadata-column:has(dd)::before { content:""; grid-column:2 / 3; grid-row:1 / -1;
      justify-self:start; border-inline-start:.75pt solid #c7d8dc; pointer-events:none; }
    .metadata-list { min-width:0; display:grid; grid-template-columns:subgrid; grid-column:1 / -1; row-gap:.45mm;
      align-content:start; margin:0; line-height:1.24; }
    .identity-values { grid-row:1; }
    .identity-details { grid-row:2; }
    .metadata-list > div { display:grid; grid-template-columns:subgrid; grid-column:1 / -1; align-items:baseline; }
    .metadata-list dt { padding-inline-end:1.5mm; text-align:end; font-size:8pt; font-weight:700; color:var(--brand); }
    .metadata-list dd { min-width:0; padding-inline-start:1.5mm; margin:0; font-size:9pt; }
    .identity-details [data-field^="cumulative_"] dd { overflow-wrap:normal; font-variant-numeric:tabular-nums; }
    .certificate-notes { grid-template-columns:max-content minmax(0,1fr); margin-block-end:1.4mm; }
    .quantity-list { display:flex; flex-wrap:wrap; gap:0 .4em; }
    .quantity-entry, .quantity-pair { display:inline-flex; align-items:baseline; gap:.32em; white-space:nowrap; }
    .quantity-entry bdi { overflow-wrap:normal; }
    .quantity-total .quantity-list { justify-content:flex-end; column-gap:.65em; font-size:var(--value-size,9pt); }
    .compact-identity { direction:ltr; align-items:center; justify-content:space-between; gap:4mm; padding-block-end:1mm; border-block-end:1pt solid var(--line); }
    .compact-reference { display:flex; align-items:center; gap:3mm; font-family:var(--heading-body); }
    .compact-identity strong { font-size: 12pt; }
    .compact-identity, .continued .full-identity { display: none; }
    .continued .compact-identity { display: flex; }
    .page-content { min-height: 0; flex: 1; }
    .page-content.bottom-signoff { display:flex; flex-direction:column; padding-block-end:2px; }
    .page-content.bottom-signoff > * { flex-shrink:0; }
    .page-content.bottom-signoff > .signoff { margin-block-start:auto; }
    h1 { font-size: 12.5pt; margin: 2mm 0 1.4mm; }
    h2 { font-size: 11pt; margin: 2mm 0 1.4mm; }
    h2 span { font-size: 8pt; font-weight: 400; margin-inline-start: 2mm; color:${reportColors.muted}; }
    table { width: 100%; table-layout: fixed; border: 0; border-collapse: collapse; font-size: 9pt; }
    th, td { padding:.9mm 1.5mm; vertical-align:top; text-align:start; border:0; box-shadow:none; outline:0; }
    thead th { background:${reportColors.header}; border-block-end:1px solid ${reportColors.headerLine}; color:${reportColors.text}; font-weight:700; font-size:8pt; overflow-wrap:normal; }
    table .number { font-variant-numeric: tabular-nums; text-align: end; }
    table td.number, .finance td bdi { white-space:nowrap; overflow-wrap:normal; font-size:var(--value-size,9pt); }
    tr.group th { background:${reportColors.group}; color:${reportColors.groupText}; font-size:9pt; }
    tr.group-unit th, .cover tr[data-band-unit]:not([data-band-work-type]) > :first-child { padding-inline-start:4mm; }
    tr.group-work_type[data-band-unit] th, .cover tr[data-band-work-type][data-band-unit] > :first-child { padding-inline-start:6mm; }
    tr[data-band-building] > :first-child, tr[data-band-unit] > :first-child { position:relative; }
    tr[data-band-building] > :first-child::before, tr[data-band-unit] > :first-child::after {
      content:""; position:absolute; inset-block:0; inset-inline-start:0; inline-size:1px; pointer-events:none;
    }
    tr[data-band-building] > :first-child::before { background:var(--building-band); }
    tr[data-band-unit] > :first-child::after { background:var(--unit-band); }
    tr[data-band-building][data-band-unit] > :first-child::after { inset-inline-start:3px; }
    tr[data-band-work-type] > :last-child { position:relative; }
    tr[data-band-work-type] > :last-child::after {
      content:""; position:absolute; inset-block:0; inset-inline-end:0; inline-size:1px;
      background:var(--work-band); pointer-events:none;
    }
    .subtotal { color:#255363; font-weight:700; }
    .detail .subtotal:last-child, .cover .subtotal { background:${reportColors.subtotal}; }
    .empty { color:${reportColors.muted}; padding-block:4mm; text-align:center; }
    .finance, .payment-details { padding-block-start:1.5mm; }
    .settlement-block { break-inside:avoid; page-break-inside:avoid; }
    .finance tbody th { font-weight: 400; }
    .finance .basis-cell { text-align:start; }
    .finance .basis-label { white-space:normal; overflow-wrap:anywhere; font-size:inherit; }
    .settlement-basis { color:${reportColors.muted}; font-size:8pt; margin-block-end:1.3mm; }
    .finance .payable { background:${reportColors.header}; color:${reportColors.text}; font-weight:700; }
    .finance .payable th { font-weight: 700; }
    footer { direction:ltr; border-block-start:0.7pt solid #adc2c9; padding-block-start:1.5mm; margin-block-start:2mm; display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:4mm; color:${reportColors.muted}; font-size:8pt; }
    footer > div:first-child { text-align: left; }
    .footer-company { text-align: center; }
    .footer-user { text-align: right; }
    .signoff { direction:ltr; display:grid; grid-template-columns:24mm minmax(0,1fr); gap:7mm; align-items:end; padding-block-start:7mm; color:${reportColors.muted}; }
    .stamp { inline-size:24mm; block-size:24mm; border:0.6pt solid #adc2c9; border-radius:50%;
      padding:4mm 2.5mm 0; font-size:8pt; text-align:center; }
    .signatories { display:grid; grid-template-columns:repeat(var(--signatures),minmax(0,1fr)); gap:4mm; align-items:start; }
    .signatory { justify-self:center; width:min(100%,34mm); min-width:0; padding-block-start:4mm;
      border-block-start:0.6pt solid #adc2c9; text-align:center; font-size:8pt; overflow-wrap:anywhere; }
    .signatory:only-child { justify-self:end; }
    .signatories[dir="rtl"] .signatory:only-child { justify-self:start; }
    .signatory { text-align:center; }
    .signatory small { display: block;text-align:center; }
    </style></head><body>
    ${summaries.map(section => pageTemplate(section.id,section.title,tableOpening(section.tableColumns),model)).join('')}
    ${pageTemplate('detail', labels.detail, tableOpening(columns), model)}
    ${pageTemplate('receipts', '', '', model)}
    ${pageTemplate('settlement', '', '', model)}
    ${pageTemplate('retentions', '', '', model)}
    ${pageTemplate('signoff-page', '', '', model)}
    ${summaries.map(section => sourceTemplate(section.id+'-rows',section.rows)).join('')}${sourceTemplate('detail-rows', detailRows(model))}
    <template id="settlement-block">${financeBlock(model)}</template>
    <template id="retentions-block">${retentionBlock(model)}</template>
    <template id="receipts-block"><section class="payment-details"><h2>${escapeHtml(labels.receipts)}</h2>${tableOpening(receiptColumns,receiptRows.join(''))}</section></template>
    <template id="signatures-block">${signaturesBlock(model)}</template>
    </body></html>`;
}

// Runs inside Chromium, using the exact physical dimensions and fonts used for printing.
async function paginateCertificate({ measured, outputMode, hasReceipts }) {
  const rootStyle = getComputedStyle(document.documentElement);
  const font = (key) => rootStyle.getPropertyValue(key).trim();
  await Promise.all([document.fonts.load(`9pt ${font('--body-font')}`, 'العربية English'),
    document.fonts.load(`bold 17pt ${font('--heading')}`, 'العربية English')]);
  await document.fonts.ready;
  const available = parseFloat(font('--report-width')) * 96 / 25.4;
  const context = document.createElement('canvas').getContext('2d');

  function fitColumns(table, contents) {
    const cols = [...table.querySelectorAll('col')];
    const wordWidths = new Map();
    const valueWidths = new Map();
    const headers = [...table.querySelectorAll('thead th')];
    context.font = `bold 8pt ${font('--body-font')}`;
    cols.forEach((col,index) => {
      const key = col.dataset.key;
      const longestWord = Math.max(0,...(headers[index]?.textContent ?? '').split(/\s+/).map((word) => context.measureText(word).width));
      wordWidths.set(key,Math.max(longestWord + 14,col.dataset.kind === 'text' ? (key === 'description' ? 124 : 53) : 40));
    });
    context.font = `bold 9pt ${font('--body-font')}`;
    for (const cell of contents.querySelectorAll('[data-number]')) {
      const key = cell.dataset.number;
      const width = context.measureText(cell.textContent).width;
      valueWidths.set(key,Math.max(width,valueWidths.get(key) || 0));
    }
    for (const cell of contents.querySelectorAll('[data-quantity-total]')) {
      const key = cell.dataset.quantityTotal;
      const unitsWidth = wordWidths.get(cell.dataset.quantityExtra) || 0;
      for (const pair of cell.querySelectorAll('.quantity-pair')) {
        const width = context.measureText([...pair.children].map((part) => part.textContent).join(' ')).width + 4;
        valueWidths.set(key,Math.max(width - unitsWidth,valueWidths.get(key) || 0));
      }
    }
    const baseWidth = (col, scale) => Math.max(wordWidths.get(col.dataset.key), (valueWidths.get(col.dataset.key) || 0) * scale + 14);
    const widthAt = (scale) => cols.reduce((sum,col) => sum + baseWidth(col,scale),0);
    let scale = 1;
    if (widthAt(1) > available) {
      let low = 0, high = 1;
      for (let i = 0; i < 12; i++) {
        const middle = (low + high) / 2;
        if (widthAt(middle) <= available) low = middle;
        else high = middle;
      }
      scale = low;
    }
    const required = widthAt(scale);
    const extra = Math.max(0, available - required);
    const extraWeight = (col) => Number(col.dataset.weight) * (['text','quantity'].includes(col.dataset.kind) ? 1 : 0.18);
    const totalWeight = cols.reduce((sum,col) => sum + extraWeight(col),0);
    for (const col of cols) {
      col.style.width = `${(baseWidth(col,scale) + extra * extraWeight(col) / totalWeight) / Math.max(required,available) * 100}%`;
    }
    table.style.setProperty('--value-size', `${9 * scale}pt`);
  }
  const summaryIds = [...document.querySelectorAll('template[data-summary-page]')].map(template => template.id);
  for (const id of [...summaryIds,'detail']) {
    fitColumns(document.getElementById(id).content.querySelector('table'),document.getElementById(`${id}-rows`).content);
  }
  for (const id of ['settlement','retentions','receipts']) {
    const table = document.getElementById(`${id}-block`).content.querySelector('table');
    if (table) fitColumns(table,table);
  }

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

  function makeSignoff(placement) {
    const block = document.getElementById('signatures-block').content.firstElementChild.cloneNode(true);
    block.dataset.placement = placement;
    return block;
  }

  function appendSummarySignoff(pages) {
    const block = makeSignoff('opening');
    const lastPage = pages.at(-1);
    lastPage.querySelector('main').append(block);
    if (fits(lastPage)) return;
    const page = makePage('signoff-page', true);
    pages.push(page);
    page.querySelector('main').append(block);
    if (!fits(page)) throw new Error('The certificate sign-off is too tall for the chosen paper');
  }

  function appendClosingSignoff(pages) {
    const block = makeSignoff('closing');
    let page = pages.at(-1);
    function place() {
      const content = page.querySelector('main');
      content.classList.add('bottom-signoff');
      content.append(block);
    }
    place();
    if (fits(page)) return;
    block.remove();
    page.querySelector('main').classList.remove('bottom-signoff');
    page = makePage('signoff-page', true);
    pages.push(page);
    place();
    if (!fits(page)) throw new Error('The certificate sign-off is too tall for the chosen paper');
  }

  function pagesFor(id, compactFirst = false, signDetails = false, reserveSignoff = true) {
    let page = makePage(id, compactFirst);
    const pages = [page];
    let table = page.querySelector('tbody');
    const units = rowsFor(id);
    if (signDetails && units.length > 1) {
      const total = units.pop();
      units.at(-1).push(...total);
    }
    const headers = new Map();
    for (const [index, unit] of units.entries()) {
      const rows = unit.map((row) => row.cloneNode(true));
      const signoff = signDetails && reserveSignoff && index === units.length - 1 ? makeSignoff('closing') : null;
      for (const row of rows) if (row.dataset.groupRow) headers.set(row.dataset.path,row);
      const hadRows = table.rows.length > 0;
      table.append(...rows);
      if (signoff) page.querySelector('main').append(signoff);
      if (!fits(page)) {
        rows.forEach((row) => row.remove());
        signoff?.remove();
        if (!hadRows) {
          if (!signoff || compactFirst || pages.length > 1) throw new Error('The certificate heading or a work line is too tall for the chosen paper');
          page.querySelector('main').replaceChildren();
          page.classList.remove(id);
        }
        page = makePage(id, true);
        pages.push(page);
        table = page.querySelector('tbody');
        const path = JSON.parse(rows[0].dataset.path || '[]');
        if (rows[0].dataset.groupRow) path.pop();
        for (let depth = 1; depth <= path.length; depth++) {
          const header = headers.get(JSON.stringify(path.slice(0,depth)));
          if (header) table.append(header.cloneNode(true));
        }
        table.append(...rows);
        if (signoff) page.querySelector('main').append(signoff);
        if (!fits(page)) throw new Error('A certificate work line is too tall for the chosen paper');
      }
    }
    return pages;
  }

  function appendTableSection(id, pages, keepTogether = false) {
    const source = document.getElementById(`${id}-block`).content.firstElementChild;
    const rows = source?.querySelectorAll('tbody tr');
    if (!rows?.length) return;
    if (keepTogether) {
      const block = source.cloneNode(true);
      let page = pages.at(-1);
      page.querySelector('main').append(block);
      if (fits(page)) return;
      block.remove();
      page = makePage(id,true);
      pages.push(page);
      page.querySelector('main').append(block);
      if (!fits(page)) throw new Error('The certificate settlement is too tall for the chosen paper');
      return;
    }
    const skeleton = source.cloneNode(true);
    skeleton.querySelector('tbody').replaceChildren();
    function startSection(page) {
      const section = skeleton.cloneNode(true);
      page.querySelector('main').append(section);
      return section;
    }
    let page = pages.at(-1);
    let section = startSection(page);
    for (const sourceRow of rows) {
      const row = sourceRow.cloneNode(true);
      const body = section.querySelector('tbody');
      body.append(row);
      if (fits(page)) continue;
      row.remove();
      if (!body.rows.length) section.remove();
      page = makePage(id,true);
      pages.push(page);
      section = startSection(page);
      section.querySelector('tbody').append(row);
      if (!fits(page)) throw new Error('A certificate summary or payment row is too tall for the chosen paper');
    }
  }

  let hasCover = outputMode === 'summary_details' || outputMode === 'multi_summary';
  if (!hasCover && measured && outputMode !== 'detail_only') {
    const detailPages = pagesFor('detail');
    hasCover = detailPages.length > 1;
    detailPages.forEach((page) => page.remove());
  }
  const openingPages = hasCover ? summaryIds.flatMap(id => pagesFor(id)) : pagesFor('detail', false, true, false);
  appendTableSection('settlement', openingPages, true);
  appendTableSection('retentions', openingPages);
  if (hasReceipts) appendTableSection('receipts', openingPages);
  if (hasCover) {
    appendSummarySignoff(openingPages);
  } else appendClosingSignoff(openingPages);
  const pages = hasCover ? [...openingPages,...pagesFor('detail',true,true)] : openingPages;
  for (const [index, page] of pages.entries()) {
    page.querySelector('.page-number').textContent = String(index + 1);
    page.querySelector('.page-total').textContent = String(pages.length);
    document.body.append(page);
  }
  return { pageCount: pages.length, detailPages: pages.filter((page) => page.classList.contains('detail')).length, hasCover };
}

module.exports = { buildCertificateHtml, paginateCertificate };
