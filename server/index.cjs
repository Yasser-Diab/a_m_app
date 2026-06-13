const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const express = require('express');
const cors = require('cors');
const electronPath = require('electron');
const ExcelJS = require('exceljs');
const QRCodeSvg = require('qrcode-svg');
const { AppDatabase } = require('./db.cjs');
const {
  boolValue,
  calculateItem,
  excelSerialToIso,
  formatOperationNo,
  numberOrNull,
  numberOrZero,
  round2,
} = require('./calculations.cjs');
const {
  STATUS,
  displayPartyName,
  documentTypeForStatus,
  ensureRuntimeMigrations,
  normalizeArabic,
  partyFromInput,
  statusForDocumentType,
  unitLabel,
} = require('./domain.cjs');

const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_PORT = Number(process.env.PRICE_OFFER_PORT || 4181);
const APP_VERSION = (() => {
  try {
    return require(path.join(ROOT_DIR, 'package.json')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();
const UPDATE_REPOSITORY = process.env.AM_UPDATE_REPOSITORY || 'Yasser-Diab/a_m_app';

const ENTRY_COLUMNS = [
  'source_row', 'serial', 'operation_no', 'calculation_method', 'measurement_mode', 'unit_code',
  'party_id', 'document_id', 'party_role', 'party_category', 'base_party_name', 'search_party_name',
  'statement_text', 'document_status', 'customer_name', 'customer_display_name', 'party_type',
  'accounting_status', 'completion_ratio', 'collection_amount', 'collection_note', 'work_type',
  'project', 'building_unit', 'floor_apartment', 'entry_date', 'description', 'glass_spec',
  'profile_spec', 'color', 'total_quantity', 'unit', 'item_count', 'width_cm', 'height_cm',
  'rate', 'building_unit_price', 'fixed_discount', 'percent_discount', 'supply_status',
  'supply_date', 'driver_name', 'vehicle_no', 'certificate_no', 'vat_enabled',
  'social_insurance_enabled', 'stamp_enabled', 'works_insurance_enabled', 'final_insurance_enabled',
  'contractor_tax_enabled', 'discount_label', 'discount_amount', 'quantity', 'cost', 'unit_price',
  'gross_total', 'vat_amount', 'social_insurance_amount', 'stamp_amount', 'works_insurance_amount',
  'final_insurance_amount', 'contractor_tax_amount', 'net_total', 'tax_inclusive_rate',
  'rate_discount', 'sequence_code', 'area_m2', 'notes', 'created_by', 'updated_by',
];

function getDataDir() {
  const configured = process.env.PRICE_OFFER_DATA_DIR;
  if (configured) return path.resolve(configured);
  return path.join(ROOT_DIR, 'data');
}

function seedDatabaseIfNeeded(dbPath) {
  if (fs.existsSync(dbPath)) return;
  const seed = path.join(ROOT_DIR, 'data', 'price_offer.db');
  if (seed !== dbPath && fs.existsSync(seed)) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.copyFileSync(seed, dbPath);
  }
}

function getLanIps() {
  return Object.values(os.networkInterfaces()).flat().filter(Boolean)
    .filter((address) => address.family === 'IPv4' && !address.internal)
    .map((address) => address.address);
}

function normalizeText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function versionParts(value) {
  return String(value || '0.0.0')
    .replace(/^v/i, '')
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  const length = Math.max(a.length, b.length, 3);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function chooseReleaseAsset(release, platform = '') {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const normalized = String(platform || '').toLowerCase();
  const rules = normalized.includes('android')
    ? [/\.apk$/i]
    : normalized.includes('win')
      ? [/setup.*\.exe$/i, /\.exe$/i, /\.zip$/i]
      : [/\.apk$/i, /\.exe$/i, /\.zip$/i];
  for (const rule of rules) {
    const asset = assets.find((item) => rule.test(item.name || ''));
    if (asset) return asset;
  }
  return assets[0] || null;
}

function uniqueStrings(values) {
  return [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function normalizeNumber(value) {
  return numberOrNull(value);
}

function storedPartyCategory(value) {
  return ['retail', 'corporate'].includes(value) ? value : null;
}

function normalizeBool(value) {
  return boolValue(value) ? 1 : 0;
}

function hashPassword(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function sqlLikeNormalized(value) {
  const normalized = normalizeArabic(value);
  return normalized ? `%${normalized}%` : null;
}

function nextDocumentNo(database, type) {
  const row = database.get(
    'SELECT COALESCE(MAX(document_no), 0) + 1 AS next_no FROM documents WHERE document_type = ? AND document_no < 1000000',
    [type],
  );
  return row.next_no || 1;
}

function getOrCreateParty(database, input) {
  const party = partyFromInput(input);
  if (!party.searchName) return null;
  let existing = database.get(
    'SELECT * FROM parties WHERE role = ? AND search_name = ?',
    [party.role, party.searchName],
  );
  if (existing) return existing;
  const result = database.run(
    `INSERT INTO parties (role, category, base_name, display_name, search_name)
     VALUES (?, ?, ?, ?, ?)`,
    [party.role, storedPartyCategory(party.category), party.baseName, party.displayName, party.searchName],
  );
  const created = database.get('SELECT * FROM parties WHERE id = ?', [result.lastInsertRowid]);
  return created?.category ? created : { ...created, category: party.category };
}

function getOrCreateDocument(database, input, party) {
  const incomingDocumentId = Number(input.document_id || 0);
  if (Number.isFinite(incomingDocumentId) && incomingDocumentId > 0) {
    const existingById = database.get('SELECT * FROM documents WHERE id = ?', [incomingDocumentId]);
    if (existingById) return existingById;
  }
  const status = normalizeText(input.accounting_status) || STATUS.OFFER;
  const documentType = input.document_type || documentTypeForStatus(status);
  const documentNo = normalizeNumber(input.serial) || nextDocumentNo(database, documentType);
  const existing = database.get(
    'SELECT * FROM documents WHERE document_type = ? AND document_no = ?',
    [documentType, documentNo],
  );
  if (existing) return existing;
  const operationNo = normalizeText(input.operation_no) || formatOperationNo(documentNo);
  const result = database.run(
    `INSERT INTO documents
      (document_type, document_no, operation_no, status, party_id, party_role, party_category,
       customer_name, search_party_name, project, building_unit, entry_date, discount_type, discount_value)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      documentType,
      documentNo,
      operationNo,
      input.document_status || (documentType === 'price_offer' ? 'draft' : 'approved'),
      party?.id || null,
      party?.role || 'customer',
      party?.category || null,
      party?.display_name || input.customer_display_name || input.customer_name || null,
      party?.search_name || normalizeArabic(input.customer_name),
      normalizeText(input.project),
      normalizeText(input.building_unit),
      input.entry_date ? excelSerialToIso(input.entry_date) : new Date().toISOString().slice(0, 10),
      ['rate', 'amount'].includes(input.discount_type) ? input.discount_type : 'none',
      numberOrZero(input.discount_value),
    ],
  );
  return database.get('SELECT * FROM documents WHERE id = ?', [result.lastInsertRowid]);
}

function normalizeInput(database, body, existing = {}) {
  const item = { ...existing, ...body };
  const party = getOrCreateParty(database, item);
  const document = getOrCreateDocument(database, item, party);
  const status = statusForDocumentType(document?.document_type) || normalizeText(item.accounting_status) || STATUS.OFFER;
  const serial = document?.document_no || normalizeNumber(item.serial) || Date.now();
  const calculated = calculateItem(item);
  const entryDate = item.entry_date ? excelSerialToIso(item.entry_date) : (document?.entry_date || new Date().toISOString().slice(0, 10));
  const displayName = party?.display_name
    || normalizeText(item.customer_display_name)
    || displayPartyName(item.customer_name, item.party_category || 'retail');
  const sequence = [
    entryDate,
    displayName,
    normalizeText(item.work_type),
    normalizeText(item.project),
    normalizeText(item.building_unit),
  ].filter(Boolean).join('_');

  return {
    source_row: item.source_row || null,
    serial,
    operation_no: document?.operation_no || normalizeText(item.operation_no) || formatOperationNo(serial),
    calculation_method: calculated.measurement_mode === 'engineering' ? 'هندسي' : null,
    measurement_mode: calculated.measurement_mode,
    unit_code: calculated.unit_code,
    party_id: party?.id || item.party_id || null,
    document_id: document?.id || item.document_id || null,
    party_role: party?.role || item.party_role || 'customer',
    party_category: party?.category || item.party_category || 'retail',
    base_party_name: party?.base_name || item.base_party_name || item.customer_name || null,
    search_party_name: party?.search_name || normalizeArabic(item.customer_name),
    statement_text: calculated.statement_text,
    document_status: document?.status || item.document_status || 'draft',
    customer_name: displayName,
    customer_display_name: displayName,
    party_type: party?.category === 'corporate' ? 'شركات' : 'افراد',
    accounting_status: status,
    completion_ratio: normalizeNumber(item.completion_ratio),
    collection_amount: normalizeNumber(item.collection_amount),
    collection_note: normalizeText(item.collection_note),
    work_type: normalizeText(item.work_type),
    project: normalizeText(item.project),
    building_unit: normalizeText(item.building_unit),
    floor_apartment: normalizeText(item.floor_apartment),
    entry_date: entryDate,
    description: normalizeText(item.description),
    glass_spec: normalizeText(item.glass_spec),
    profile_spec: normalizeText(item.profile_spec),
    color: normalizeText(item.color),
    total_quantity: normalizeNumber(item.total_quantity),
    unit: unitLabel(calculated.unit_code),
    item_count: normalizeNumber(item.item_count),
    width_cm: normalizeNumber(item.width_cm),
    height_cm: normalizeNumber(item.height_cm),
    rate: normalizeNumber(item.rate),
    building_unit_price: normalizeNumber(item.building_unit_price),
    fixed_discount: null,
    percent_discount: null,
    supply_status: normalizeText(item.supply_status),
    supply_date: item.supply_date ? excelSerialToIso(item.supply_date) : null,
    driver_name: normalizeText(item.driver_name),
    vehicle_no: normalizeText(item.vehicle_no),
    certificate_no: normalizeText(item.certificate_no),
    vat_enabled: normalizeBool(item.vat_enabled),
    social_insurance_enabled: normalizeBool(item.social_insurance_enabled),
    stamp_enabled: normalizeBool(item.stamp_enabled),
    works_insurance_enabled: normalizeBool(item.works_insurance_enabled),
    final_insurance_enabled: normalizeBool(item.final_insurance_enabled),
    contractor_tax_enabled: normalizeBool(item.contractor_tax_enabled),
    discount_label: null,
    notes: normalizeText(item.notes),
    created_by: normalizeText(item.created_by),
    updated_by: normalizeText(item.updated_by),
    sequence_code: normalizeText(item.sequence_code) || sequence,
    ...calculated,
  };
}

function syncPaymentDocumentFromEntry(database, entry) {
  const documentId = Number(entry?.document_id || 0);
  if (!documentId) return;
  const document = database.get('SELECT document_type FROM documents WHERE id = ?', [documentId]);
  if (document?.document_type !== 'payment') return;
  database.run(
    `UPDATE documents
     SET party_id = ?,
         party_role = ?,
         party_category = ?,
         customer_name = ?,
         search_party_name = ?,
         project = ?,
         building_unit = ?,
         entry_date = ?,
         status = 'approved',
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      entry.party_id || null,
      entry.party_role || 'customer',
      entry.party_category || null,
      entry.customer_display_name || entry.customer_name || null,
      entry.search_party_name || normalizeArabic(entry.customer_name),
      normalizeText(entry.project),
      normalizeText(entry.building_unit),
      entry.entry_date || new Date().toISOString().slice(0, 10),
      documentId,
    ],
  );
}

function whereFromQuery(query, options = {}) {
  const clauses = ['wi.deleted_at IS NULL'];
  const params = [];
  const normalizedQ = sqlLikeNormalized(query.q);
  if (normalizedQ) {
    const compactQ = String(query.q || '').trim().replace(/^0+(?=\d)/, '');
    clauses.push(`(
      wi.search_party_name LIKE ? OR wi.project LIKE ? OR wi.building_unit LIKE ?
      OR wi.statement_text LIKE ? OR wi.operation_no LIKE ? OR wi.work_type LIKE ?
      OR CAST(wi.document_id AS TEXT) LIKE ? OR CAST(wi.serial AS TEXT) LIKE ? OR CAST(wi.id AS TEXT) LIKE ?
    )`);
    params.push(normalizedQ, `%${query.q}%`, `%${query.q}%`, `%${query.q}%`, `%${query.q}%`, `%${query.q}%`, `%${compactQ || query.q}%`, `%${compactQ || query.q}%`, `%${compactQ || query.q}%`);
  }
  if (query.status) {
    clauses.push('wi.accounting_status = ?');
    params.push(query.status);
  }
  if (query.document_status) {
    clauses.push('wi.document_status = ?');
    params.push(query.document_status);
  }
  if (query.party_id) {
    clauses.push('wi.party_id = ?');
    params.push(Number(query.party_id));
  } else if (query.customer) {
    clauses.push('wi.search_party_name LIKE ?');
    params.push(sqlLikeNormalized(query.customer));
  }
  if (query.project) {
    clauses.push('wi.project = ?');
    params.push(query.project);
  }
  if (query.work_type) {
    clauses.push('wi.work_type = ?');
    params.push(query.work_type);
  }
  if (query.document_id) {
    clauses.push('wi.document_id = ?');
    params.push(Number(query.document_id));
  }
  if (query.serial) {
    clauses.push('wi.serial = ?');
    params.push(Number(query.serial));
  }
  if (query.operation_no) {
    clauses.push('wi.operation_no = ?');
    params.push(query.operation_no);
  }
  if (query.certificate_no) {
    clauses.push('wi.certificate_no = ?');
    params.push(query.certificate_no);
  }
  if (options.documentType === 'offer') clauses.push('wi.accounting_status = ?') && params.push(STATUS.OFFER);
  if (options.documentType === 'invoice') clauses.push('wi.accounting_status = ?') && params.push(STATUS.INVOICE);
  if (options.documentType === 'contractor') clauses.push('wi.accounting_status = ?') && params.push(STATUS.CONTRACTOR);
  if (options.taxMode === 'tax' || query.tax === 'yes') clauses.push('wi.vat_enabled = 1');
  if (options.taxMode === 'nonTax' || query.tax === 'no') clauses.push('wi.vat_enabled = 0');
  if (options.rowKind === 'work') clauses.push('COALESCE(wi.collection_amount, 0) = 0');
  if (options.rowKind === 'payment') clauses.push('ABS(COALESCE(wi.collection_amount, 0)) > 0');
  return { where: clauses.join(' AND '), params };
}

function totalsForRows(rows, document = null) {
  const totals = rows.reduce((acc, row) => {
    acc.quantity += numberOrZero(row.quantity);
    acc.area_m2 += numberOrZero(row.area_m2);
    acc.cost += numberOrZero(row.cost);
    acc.gross_total += numberOrZero(row.gross_total);
    acc.vat_amount += numberOrZero(row.vat_amount);
    acc.deductions += numberOrZero(row.social_insurance_amount)
      + numberOrZero(row.stamp_amount)
      + numberOrZero(row.works_insurance_amount)
      + numberOrZero(row.final_insurance_amount)
      + numberOrZero(row.contractor_tax_amount);
    acc.collections += Math.abs(numberOrZero(row.collection_amount));
    acc.net_before_discount += numberOrZero(row.net_total);
    return acc;
  }, {
    quantity: 0, area_m2: 0, cost: 0, gross_total: 0, vat_amount: 0,
    deductions: 0, collections: 0, net_before_discount: 0, discount_amount: 0, net_total: 0,
  });
  if (document?.discount_type === 'rate') totals.discount_amount = totals.net_before_discount * (numberOrZero(document.discount_value) / 100);
  if (document?.discount_type === 'amount') totals.discount_amount = numberOrZero(document.discount_value);
  totals.net_total = totals.net_before_discount - totals.discount_amount;
  return totals;
}

function runningBalanceRows(rows) {
  let balance = 0;
  return rows.map((row) => {
    const debit = numberOrZero(row.debit);
    const credit = numberOrZero(row.credit);
    balance += debit - credit;
    return { ...row, balance: roundMoney(balance) };
  });
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function hasReportDimensions(rows) {
  return rows.some((row) => row.unit_code === 'sqm' && numberOrZero(row.width_cm) > 0 && numberOrZero(row.height_cm) > 0);
}

function dimensionText(row, unit = 'cm') {
  if (row.unit_code !== 'sqm') return '';
  const width = numberOrZero(row.width_cm);
  const height = numberOrZero(row.height_cm);
  if (!width || !height) return '';
  if (unit === 'm') return `${money(width / 100)} × ${money(height / 100)} م`;
  return `${money(width)} × ${money(height)} سم`;
}

function accountStatementData(database, query, type) {
  const clauses = [
    'd.deleted_at IS NULL',
    "d.status = 'approved'",
    "(d.document_type = 'invoice' OR d.document_type = 'payment')",
  ];
  const params = [];
  if (query.party_id) {
    clauses.push('d.party_id = ?');
    params.push(Number(query.party_id));
  } else if (query.customer) {
    clauses.push('d.search_party_name LIKE ?');
    params.push(sqlLikeNormalized(query.customer));
  }
  if (query.project) {
    clauses.push('d.project = ?');
    params.push(query.project);
  }
  if (query.document_id) {
    clauses.push('d.id = ?');
    params.push(Number(query.document_id));
  }

  const rawRows = database.all(
    `SELECT d.id AS document_id,
            d.document_type,
            d.document_no,
            d.operation_no,
            d.entry_date,
            MIN(CASE WHEN COALESCE(wi.collection_amount, 0) <> 0 THEN wi.entry_date END) AS payment_entry_date,
            d.customer_name,
            d.project,
            d.building_unit,
            d.discount_type,
            d.discount_value,
            COUNT(wi.id) AS item_count,
            GROUP_CONCAT(DISTINCT NULLIF(wi.work_type, '')) AS work_types,
            GROUP_CONCAT(DISTINCT NULLIF(wi.collection_note, '')) AS collection_notes,
            ROUND(SUM(CASE WHEN COALESCE(wi.collection_amount, 0) = 0 THEN wi.quantity ELSE 0 END), 2) AS quantity,
            ROUND(SUM(CASE WHEN COALESCE(wi.collection_amount, 0) = 0 THEN wi.gross_total ELSE 0 END), 2) AS gross_total,
            ROUND(SUM(CASE WHEN COALESCE(wi.collection_amount, 0) = 0 THEN wi.vat_amount ELSE 0 END), 2) AS vat_amount,
            ROUND(SUM(CASE WHEN COALESCE(wi.collection_amount, 0) = 0 THEN wi.social_insurance_amount ELSE 0 END), 2) AS social_insurance_amount,
            ROUND(SUM(CASE WHEN COALESCE(wi.collection_amount, 0) = 0 THEN wi.stamp_amount ELSE 0 END), 2) AS stamp_amount,
            ROUND(SUM(CASE WHEN COALESCE(wi.collection_amount, 0) = 0 THEN wi.works_insurance_amount ELSE 0 END), 2) AS works_insurance_amount,
            ROUND(SUM(CASE WHEN COALESCE(wi.collection_amount, 0) = 0 THEN wi.final_insurance_amount ELSE 0 END), 2) AS final_insurance_amount,
            ROUND(SUM(CASE WHEN COALESCE(wi.collection_amount, 0) = 0 THEN wi.contractor_tax_amount ELSE 0 END), 2) AS contractor_tax_amount,
            ROUND(SUM(CASE WHEN COALESCE(wi.collection_amount, 0) = 0 THEN wi.net_total ELSE 0 END), 2) AS debit,
            ROUND(SUM(CASE WHEN COALESCE(wi.collection_amount, 0) <> 0 THEN ABS(wi.collection_amount) ELSE 0 END), 2) AS credit
     FROM documents d
     LEFT JOIN work_items wi ON wi.document_id = d.id AND wi.deleted_at IS NULL
     WHERE ${clauses.join(' AND ')}
     GROUP BY d.id
     HAVING debit <> 0 OR credit <> 0
     ORDER BY COALESCE(d.entry_date, ''), d.document_no`,
    params,
  );
  const ledgerRows = [];
  for (const row of rawRows) {
    const isPayment = row.document_type === 'payment';
    const docNo = row.operation_no || row.document_no || '';
    const netBeforeDiscount = numberOrZero(row.debit);
    let discountAmount = 0;
    if (!isPayment && row.discount_type === 'rate') discountAmount = netBeforeDiscount * (numberOrZero(row.discount_value) / 100);
    if (!isPayment && row.discount_type === 'amount') discountAmount = numberOrZero(row.discount_value);
    const debit = isPayment ? 0 : roundMoney(Math.max(netBeforeDiscount - discountAmount, 0));
    const credit = roundMoney(numberOrZero(row.credit));
    if (debit) {
      ledgerRows.push({
      ...row,
      debit,
        credit: 0,
      discount_amount: roundMoney(discountAmount),
        is_payment: 0,
        entry_date: row.entry_date || '',
        description: `${documentTypeLabel(row.document_type)} - ${docNo}`,
        project_label: [row.project, row.building_unit].filter(Boolean).join(' - '),
        details: row.work_types || '',
      });
    }
    if (credit) {
      ledgerRows.push({
        ...row,
        quantity: 0,
        gross_total: 0,
        vat_amount: 0,
        social_insurance_amount: 0,
        stamp_amount: 0,
        works_insurance_amount: 0,
        final_insurance_amount: 0,
        contractor_tax_amount: 0,
        debit: 0,
        credit,
        discount_amount: 0,
        is_payment: 1,
        entry_date: row.payment_entry_date || row.entry_date || '',
        description: `تحصيل - ${docNo}`,
        project_label: [row.project, row.building_unit].filter(Boolean).join(' - '),
        details: row.collection_notes || '',
      });
    }
  }
  ledgerRows.sort((a, b) => String(a.entry_date || '').localeCompare(String(b.entry_date || '')) || Number(a.document_no || 0) - Number(b.document_no || 0));
  const statementRows = runningBalanceRows(ledgerRows);
  const totals = statementRows.reduce((acc, row) => {
    acc.quantity += numberOrZero(row.quantity);
    acc.gross_total += numberOrZero(row.gross_total);
    acc.vat_amount += numberOrZero(row.vat_amount);
    acc.social_insurance_amount += numberOrZero(row.social_insurance_amount);
    acc.stamp_amount += numberOrZero(row.stamp_amount);
    acc.works_insurance_amount += numberOrZero(row.works_insurance_amount);
    acc.final_insurance_amount += numberOrZero(row.final_insurance_amount);
    acc.contractor_tax_amount += numberOrZero(row.contractor_tax_amount);
    acc.discount_amount += numberOrZero(row.discount_amount);
    acc.debit += numberOrZero(row.debit);
    acc.credit += numberOrZero(row.credit);
    acc.net_total = numberOrZero(row.balance);
    return acc;
  }, {
    quantity: 0, gross_total: 0, vat_amount: 0, social_insurance_amount: 0, stamp_amount: 0,
    works_insurance_amount: 0, final_insurance_amount: 0, contractor_tax_amount: 0,
    debit: 0, credit: 0, net_total: 0, discount_amount: 0, deductions: 0,
  });
  totals.deductions = roundMoney(
    numberOrZero(totals.social_insurance_amount)
    + numberOrZero(totals.stamp_amount)
    + numberOrZero(totals.works_insurance_amount)
    + numberOrZero(totals.final_insurance_amount)
    + numberOrZero(totals.contractor_tax_amount),
  );
  const taxBreakdown = [
    ['vat_amount', 'ضريبة القيمة المضافة 14%'],
    ['social_insurance_amount', 'تأمينات اجتماعية 3.6%'],
    ['stamp_amount', 'دمغة هندسية 0.001'],
    ['works_insurance_amount', 'تأمينات أعمال 5%'],
    ['final_insurance_amount', 'تأمين أعمال نهائي 5%'],
    ['contractor_tax_amount', 'ضريبة 1%'],
  ].map(([key, label]) => ({ key, label, amount: roundMoney(totals[key]) })).filter((tax) => tax.amount);
  const first = statementRows[0] || {};
  return {
    title: documentTitle(type),
    type,
    is_statement: true,
    filters: query,
    prepared_by: query.user_name || 'Eng. Yasser',
    party: first.customer_name || query.customer || '',
    project: query.project || '',
    building_unit: first.building_unit || query.building_unit || '',
    operation_no: query.operation_no || '',
    serial: query.serial || '',
    entry_date: first.entry_date || query.entry_date || '',
    generated_at: new Date().toISOString(),
    totals,
    tax_breakdown: taxBreakdown,
    discount_label: totals.discount_amount ? 'إجمالي الخصومات' : '',
    rows: [],
    statementRows,
    summaryRows: [],
    terms: [],
  };
}

function documentTitle(type) {
  return {
    offer: 'عرض سعر',
    taxInvoice: 'فاتورة ضريبية',
    nonTaxInvoice: 'فاتورة غير ضريبية',
    invoice: 'فاتورة',
    taxStatement: 'كشف حساب ضريبي',
    nonTaxStatement: 'كشف حساب غير ضريبي',
    statement: 'كشف حساب',
    contractor: 'مستخلص مقاول',
    runningCertificate: 'مستخلصات جارية',
    contractorStatement: 'كشف حساب مقاول',
    contractorBoq: 'جدول كميات مستخلص مقاول',
    customerSummary: 'اجمالي عام عملاء',
    taxDeductions: 'اجمالي ضرائب و تامينات',
    taxInclusiveTotal: 'الاجمالي شامل الضريبة فقط',
    nonTaxTotal: 'اجمالي بدون ضريبة',
    metricTotal: 'اجمالي متري',
  }[type] || 'مستند';
}

function documentTypeLabel(type) {
  return {
    price_offer: 'عرض سعر',
    invoice: 'فاتورة',
    contractor_certificate: 'مستخلص مقاول',
    payment: 'تحصيل',
    ledger: 'قيد حساب',
  }[type] || type || '';
}

function richDefaultTerms(kind) {
  const vatLine = '__VAT_LINE__';
  const common = [
    {
      title: 'صلاحية عرض السعر',
      lines: [
        kind === 'corporate'
          ? 'عرض السعر ساري لمدة ( 7 ) سبعة أيام من تاريخ إصداره.'
          : 'عرض السعر ساري لمدة ( 48 ) ساعة من تاريخ إصداره.',
        'الأسعار تعتمد على أسعار المواد الخام الحالية وقابلة للتغيير حسب تقلبات السوق.',
        'يرتبط عرض السعر بسعر صرف الدولار الأمريكي وفقًا للبنك المركزي المصري، ما لم يتم الاتفاق كتابيًا على خلاف ذلك.',
        ...(kind === 'retail' ? ['** بداية الأعمال من تاريخ استلام الدفعة المقدمة ويتم تسليم الأعمال خلال 30 يوم.'] : []),
      ],
    },
    {
      title: 'ضريبة القيمة المضافة والاستثناءات',
      lines: [
        vatLine,
        'لا يشمل العرض السقالات أو أي أعمال خارجية ما لم يتم ذكرها صراحة.',
      ],
    },
    {
      title: 'نطاق العمل',
      lines: [
        'العميل مسؤول عن تجهيز فتحات التركيب وتوفير وسائل المساعدة اللازمة أثناء التركيب.',
        'في حال عدم توفر وسائل المساعدة في الوقت المحدد، يتحمل العميل التكاليف الإضافية الناتجة عن التأخير.',
      ],
    },
    {
      title: 'شروط الدفع',
      lines: kind === 'corporate'
        ? ['60% عند توقيع العقد.', '15% عند التوريد.', '15% عند التركيب.', '10% عند التسليم النهائي.']
        : ['80% عند توقيع العقد.', '20% عند التسليم.'],
    },
    {
      title: 'التصنيع والجودة',
      lines: [
        'يتم التصنيع بدقة وكفاءة عالية في مصانع معتمدة.',
        'يتم التركيب وفقًا لأعلى معايير الجودة وتحت إشراف هندسي.',
        'جميع الإكسسوارات معتمدة وذات جودة مضمونة.',
      ],
    },
    {
      title: 'دعم المكاتب الاستشارية',
      lines: [
        'جاهزون للتنسيق مع أي مكتب استشاري مشرف على التنفيذ.',
      ],
    },
    {
      title: 'ملاحظة',
      lines: [
        'جميع المقاسات والكميات المذكورة تقريبية وتعتمد على الرسومات؛ وسيتم تعديلها أثناء التصنيع بما يتناسب مع الحاجة الفعلية.',
      ],
    },
  ];
  return { sections: common };
}

function ensureRichTerms(database) {
  const versionKey = 'terms_template_version';
  const currentVersion = database.get('SELECT value FROM app_settings WHERE key = ?', [versionKey])?.value;
  const nextVersion = 'clean-offer-terms-v2';
  for (const [key, value] of [
    ['terms_retail', richDefaultTerms('retail')],
    ['terms_corporate', richDefaultTerms('corporate')],
  ]) {
    const row = database.get('SELECT value FROM app_settings WHERE key = ?', [key]);
    let shouldUpdate = !row || currentVersion !== nextVersion;
    if (row) {
      try {
        const parsed = JSON.parse(row.value);
        shouldUpdate = shouldUpdate || !Array.isArray(parsed.sections) || parsed.sections.length < 6;
      } catch {
        shouldUpdate = true;
      }
    }
    if (shouldUpdate) {
      database.run('INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)', [key, JSON.stringify(value)]);
    }
  }
  database.run('INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)', [versionKey, nextVersion]);
}

function adminPassword(database) {
  return database.get('SELECT value FROM app_settings WHERE key = ?', ['admin_password'])?.value || '23320001';
}

function ensureDefaultUsers(database) {
  database.run(
    `INSERT OR IGNORE INTO users (username, display_name, role, pin_hash, can_create_invoices, can_create_payments, can_change_status, is_active)
     VALUES (?, ?, ?, ?, 1, 1, 1, 1)`,
    ['Yasser', 'Eng. Yasser', 'admin', hashPassword('982700')],
  );
  database.run("UPDATE users SET can_create_invoices = 1, can_create_payments = 1, can_change_status = 1 WHERE role = 'admin'");
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
    can_create_invoices: normalizeBool(row.can_create_invoices || row.role === 'admin'),
    can_create_payments: normalizeBool(row.can_create_payments || row.role === 'admin'),
    can_change_status: normalizeBool(row.can_change_status || row.role === 'admin'),
    is_active: row.is_active,
    last_login_at: row.last_login_at || null,
    last_seen_at: row.last_seen_at || null,
    is_online: normalizeBool(row.is_online),
  };
}

function statementParts(row) {
  return [row.description, row.glass_spec, row.profile_spec, row.color]
    .map((part) => String(part || '').trim())
    .filter(Boolean);
}

function overallWorkType(rows) {
  const values = [...new Set((rows || []).map((row) => String(row.work_type || '').trim()).filter(Boolean))];
  if (values.length === 1) return values[0];
  return values.length ? values.join(' / ') : '';
}

function taxBreakdown(rows) {
  const totals = [
    ['vat_amount', 'ضريبة القيمة المضافة 14%'],
    ['social_insurance_amount', 'تأمينات اجتماعية 3.6%'],
    ['stamp_amount', 'دمغة هندسية 0.001'],
    ['works_insurance_amount', 'تأمينات أعمال 5%'],
    ['final_insurance_amount', 'تأمين أعمال نهائي 5%'],
    ['contractor_tax_amount', 'ضريبة 1%'],
  ].map(([key, label]) => ({
    key,
    label,
    amount: roundMoney((rows || []).reduce((sum, row) => sum + numberOrZero(row[key]), 0)),
  })).filter((item) => item.amount);
  return totals;
}

function discountLabel(document, totals) {
  if (!totals?.discount_amount) return '';
  if (document?.discount_type === 'rate') return `خصم خاص ${money(document.discount_value)}%`;
  if (document?.discount_type === 'amount') return `خصم خاص ${money(document.discount_value)} جنيه`;
  return 'خصم خاص';
}

function termsForDocument(database, first, type, rows = []) {
  if (type !== 'offer') return [];
  const key = first?.party_category === 'corporate' ? 'terms_corporate' : 'terms_retail';
  const hasVat = (rows || []).some((row) => normalizeBool(row.vat_enabled) || numberOrZero(row.vat_amount));
  const vatLine = hasVat
    ? 'الأسعار شاملة ضريبة القيمة المضافة بنسبة 14% .'
    : 'الأسعار غير شاملة ضريبة القيمة المضافة بنسبة 14% .';
  try {
    const sections = JSON.parse(database.get('SELECT value FROM app_settings WHERE key = ?', [key])?.value || '{"sections":[]}').sections || [];
    return sections.map((section) => ({
      ...section,
      lines: (section.lines || []).map((line) => String(line).replace('__VAT_LINE__', vatLine)),
    }));
  } catch {
    return [];
  }
}

function recalculateAllItems(database) {
  const rows = database.all('SELECT * FROM work_items WHERE deleted_at IS NULL');
  if (!rows.length) return;
  const updateColumns = [
    'unit_code', 'measurement_mode', 'unit', 'statement_text', 'quantity', 'cost', 'unit_price',
    'gross_total', 'vat_amount', 'social_insurance_amount', 'stamp_amount',
    'works_insurance_amount', 'final_insurance_amount', 'contractor_tax_amount',
    'discount_amount', 'net_total', 'tax_inclusive_rate', 'rate_discount', 'area_m2',
  ];
  const stmt = database.db.prepare(`
    UPDATE work_items
    SET ${updateColumns.map((column) => `${column} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  database.db.exec('BEGIN TRANSACTION');
  try {
    for (const row of rows) {
      const calculated = calculateItem({ ...row, discount_amount: 0 });
      const values = updateColumns.map((column) => {
        if (column === 'unit') return unitLabel(calculated.unit_code);
        return calculated[column] ?? 0;
      });
      stmt.bind([...values, row.id]);
      stmt.step();
      stmt.reset();
    }
    database.db.exec('COMMIT');
    database.save();
  } catch (error) {
    database.db.exec('ROLLBACK');
    throw error;
  } finally {
    stmt.free();
  }
}

function documentOptions(type) {
  const map = {
    offer: { documentType: 'offer', rowKind: 'work' },
    invoice: { documentType: 'invoice', rowKind: 'work' },
    taxInvoice: { documentType: 'invoice', taxMode: 'tax', rowKind: 'work' },
    nonTaxInvoice: { documentType: 'invoice', taxMode: 'nonTax', rowKind: 'work' },
    statement: {},
    taxStatement: { taxMode: 'tax' },
    nonTaxStatement: { taxMode: 'nonTax' },
    contractor: { documentType: 'contractor', rowKind: 'work' },
    runningCertificate: { documentType: 'contractor', rowKind: 'work' },
    contractorStatement: { documentType: 'contractor', rowKind: 'work' },
    contractorBoq: { documentType: 'contractor', rowKind: 'work' },
    customerSummary: {},
    taxDeductions: {},
    taxInclusiveTotal: { taxMode: 'tax' },
    nonTaxTotal: { taxMode: 'nonTax' },
    metricTotal: {},
  };
  return map[type] || {};
}

function getReportRows(database, query, type) {
  const { where, params } = whereFromQuery(query, documentOptions(type));
  const rows = database.all(
    `SELECT wi.*, d.discount_type, d.discount_value, d.status AS real_document_status
     FROM work_items wi
     LEFT JOIN documents d ON d.id = wi.document_id
     WHERE ${where}
     ORDER BY COALESCE(wi.entry_date, ''), wi.serial, wi.id`,
    params,
  );
  const document = query.document_id ? database.get('SELECT * FROM documents WHERE id = ?', [Number(query.document_id)]) : null;
  return { rows, document };
}

function getReportPaymentRows(database, query, type) {
  const options = { ...documentOptions(type), rowKind: 'payment' };
  const paymentQuery = { ...query };
  if (type === 'contractor') {
    delete paymentQuery.certificate_no;
    delete paymentQuery.work_type;
  }
  const { where, params } = whereFromQuery(paymentQuery, options);
  const dateLimit = normalizeText(query.payment_until_date);
  return database.all(
    `SELECT wi.*, d.discount_type, d.discount_value, d.status AS real_document_status
     FROM work_items wi
     LEFT JOIN documents d ON d.id = wi.document_id
     WHERE ${where}${dateLimit ? ' AND COALESCE(wi.entry_date, \'\') <= ?' : ''}
     ORDER BY COALESCE(wi.entry_date, ''), wi.serial, wi.id`,
    dateLimit ? [...params, dateLimit] : params,
  );
}

function groupedReport(database, type, query) {
  const { where, params } = whereFromQuery(query, documentOptions(type));
  if (type === 'customerSummary') {
    return database.all(
      `SELECT wi.customer_display_name AS customer, wi.project, wi.building_unit,
              COUNT(*) AS rows, ROUND(SUM(wi.area_m2), 2) AS area_m2,
              ROUND(SUM(wi.gross_total), 2) AS gross_total,
              ROUND(SUM(wi.vat_amount), 2) AS vat_amount,
              ROUND(SUM(wi.net_total), 2) AS net_total
       FROM work_items wi WHERE ${where}
       GROUP BY wi.customer_display_name, wi.project, wi.building_unit
       ORDER BY customer, wi.project, wi.building_unit LIMIT 500`,
      params,
    );
  }
  if (type === 'taxDeductions') {
    return database.all(
      `SELECT wi.customer_display_name AS customer, wi.project,
              ROUND(SUM(wi.vat_amount), 2) AS vat_amount,
              ROUND(SUM(wi.social_insurance_amount), 2) AS social_insurance_amount,
              ROUND(SUM(wi.stamp_amount), 2) AS stamp_amount,
              ROUND(SUM(wi.works_insurance_amount), 2) AS works_insurance_amount,
              ROUND(SUM(wi.final_insurance_amount), 2) AS final_insurance_amount,
              ROUND(SUM(wi.contractor_tax_amount), 2) AS contractor_tax_amount,
              ROUND(SUM(wi.net_total), 2) AS net_total
       FROM work_items wi WHERE ${where}
       GROUP BY wi.customer_display_name, wi.project
       ORDER BY customer, wi.project LIMIT 500`,
      params,
    );
  }
  if (type === 'metricTotal') {
    return database.all(
      `SELECT wi.customer_display_name AS customer, wi.project, wi.work_type,
              ROUND(SUM(wi.area_m2), 2) AS area_m2,
              ROUND(SUM(wi.quantity), 2) AS quantity,
              ROUND(AVG(NULLIF(wi.rate, 0)), 2) AS average_rate,
              ROUND(SUM(wi.gross_total), 2) AS gross_total,
              ROUND(SUM(wi.net_total), 2) AS net_total
       FROM work_items wi WHERE ${where} AND (wi.unit_code = 'sqm' OR wi.area_m2 > 0)
       GROUP BY wi.customer_display_name, wi.project, wi.work_type
       ORDER BY customer, wi.project, wi.work_type LIMIT 500`,
      params,
    );
  }
  return [];
}

function renderReportHtml(data) {
  const rowHtml = (data.rows || []).map((row) => `
    <tr>
      <td>${escapeHtml(row.entry_date || '')}</td>
      <td>${escapeHtml(row.work_type || '')}</td>
      <td class="desc">${escapeHtml(row.statement_text || row.description || row.collection_note || '')}</td>
      <td>${escapeHtml(unitLabel(row.unit_code))}</td>
      <td>${money(row.quantity)}</td>
      <td>${money(row.rate)}</td>
      <td>${money(row.gross_total)}</td>
      <td>${money(row.net_total)}</td>
    </tr>`).join('');
  const summaryKeys = Object.keys((data.summaryRows || [])[0] || {});
  const summaryHtml = summaryKeys.length ? `
    <table><thead><tr>${summaryKeys.map((key) => `<th>${escapeHtml(summaryLabel(key))}</th>`).join('')}</tr></thead>
    <tbody>${data.summaryRows.map((row) => `<tr>${summaryKeys.map((key) => `<td>${formatCell(row[key])}</td>`).join('')}</tr>`).join('')}</tbody></table>
  ` : '';
  const detailHtml = rowHtml ? `
    <table><thead><tr><th>التاريخ</th><th>الأعمال</th><th>البيان</th><th>الوحدة</th><th>الكمية</th><th>الفئة</th><th>الإجمالي</th><th>الصافي</th></tr></thead><tbody>${rowHtml}</tbody></table>
  ` : '';
  const logoPath = path.join(ROOT_DIR, 'src', 'assets', 'hgad-logo.png').replace(/\\/g, '/');
  return `<!doctype html>
  <html lang="ar" dir="rtl"><head><meta charset="utf-8" />
  <style>
    body{font-family:Arial,"Segoe UI",sans-serif;margin:24px;color:#111827}
    .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0f172a;padding-bottom:12px;margin-bottom:14px}
    .logo{width:78px;height:auto}.meta{text-align:left;direction:ltr;color:#475569}
    h1{margin:6px 0 4px;font-size:24px}.party{font-size:15px;color:#334155}
    table{width:100%;border-collapse:collapse;font-size:11px;margin-top:10px}
    th,td{border:1px solid #cbd5e1;padding:6px;vertical-align:top}th{background:#1f3f73;color:white}.desc{min-width:260px}
    .totals{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:14px}
    .box{border:1px solid #cbd5e1;padding:8px;background:#f8fafc}
    @page{size:A4 portrait;margin:10mm}
  </style></head><body>
    <div class="head"><div><img class="logo" src="file:///${logoPath}" /><h1>${escapeHtml(data.title)}</h1><div class="party">${escapeHtml(data.party || '')} / ${escapeHtml(data.project || '')}</div></div><div class="meta"><strong>${escapeHtml(data.operation_no || '')}</strong><br/>${new Date(data.generated_at).toLocaleDateString('en-GB')}</div></div>
    ${summaryHtml}${detailHtml}
    <div class="totals"><div class="box">الإجمالي: <strong>${money(data.totals.gross_total)}</strong></div><div class="box">ضريبة: <strong>${money(data.totals.vat_amount)}</strong></div><div class="box">خصم التقرير: <strong>${money(data.totals.discount_amount)}</strong></div><div class="box">الصافي: <strong>${money(data.totals.net_total)}</strong></div></div>
  </body></html>`;
}

function renderReportXml(data) {
  const rows = data.rows || [];
  const summaryRows = data.summaryRows || [];
  const columns = [
    ['entry_date', 'التاريخ'],
    ['operation_no', 'رقم العملية'],
    ['customer_display_name', 'العميل'],
    ['project', 'المشروع'],
    ['building_unit', 'المبنى/الوحدة'],
    ['work_type', 'نوع الأعمال'],
    ['statement_text', 'البيان'],
    ['unit', 'الوحدة'],
    ['quantity', 'الكمية'],
    ['rate', 'الفئة'],
    ['gross_total', 'الإجمالي'],
    ['vat_amount', 'ضريبة 14%'],
    ['social_insurance_amount', 'تأمينات اجتماعية'],
    ['stamp_amount', 'دمغة هندسية'],
    ['works_insurance_amount', 'تأمين أعمال'],
    ['final_insurance_amount', 'تأمين أعمال نهائي'],
    ['contractor_tax_amount', 'ضريبة 1%'],
    ['net_total', 'الصافي'],
  ];
  const summaryColumns = Object.keys(summaryRows[0] || {});
  const cell = (value, type = null) => {
    if (type === 'number') {
      return `<Cell><Data ss:Type="Number">${Number(value || 0)}</Data></Cell>`;
    }
    return `<Cell><Data ss:Type="String">${xmlEscape(value ?? '')}</Data></Cell>`;
  };
  const detailTable = `
    <Table>
      <Row>${columns.map(([, label]) => cell(label)).join('')}</Row>
      ${rows.map((row) => `<Row>${columns.map(([key]) => {
        const value = key === 'unit' ? unitLabel(row.unit_code) : row[key];
        return cell(value, typeof value === 'number' ? 'number' : null);
      }).join('')}</Row>`).join('')}
      <Row></Row>
      <Row>${cell('الإجمالي')}${cell(data.totals.gross_total, 'number')}${cell('ضريبة 14%')}${cell(data.totals.vat_amount, 'number')}${cell('خصم التقرير')}${cell(data.totals.discount_amount, 'number')}${cell('الصافي')}${cell(data.totals.net_total, 'number')}</Row>
    </Table>`;
  const summaryTable = summaryColumns.length ? `
    <Worksheet ss:Name="ملخص">
      <Table>
        <Row>${summaryColumns.map((key) => cell(summaryLabel(key))).join('')}</Row>
        ${summaryRows.map((row) => `<Row>${summaryColumns.map((key) => cell(row[key], typeof row[key] === 'number' ? 'number' : null)).join('')}</Row>`).join('')}
      </Table>
    </Worksheet>` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
  <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
    <Title>${xmlEscape(data.title)}</Title>
    <Author>Accounting Management</Author>
    <Created>${new Date(data.generated_at).toISOString()}</Created>
  </DocumentProperties>
  <Worksheet ss:Name="التقرير">
    ${detailTable}
  </Worksheet>
  ${summaryTable}
</Workbook>`;
}

function renderReportHtmlV2(data) {
  const showDimensions = !!data.show_dimensions;
  const dimensionUnit = data.dimension_unit || 'cm';
  const statementHtml = (data.statementRows || []).length ? `
    <table><thead><tr><th>التاريخ</th><th>المستند</th><th>المشروع</th><th>الوحدة</th><th>إجمالي المستند</th><th>التحصيل</th><th>الرصيد</th></tr></thead>
    <tbody>${data.statementRows.map((row) => `
      <tr><td>${escapeHtml(row.entry_date || '')}</td><td>${escapeHtml(row.description || '')}</td><td>${escapeHtml(row.project || '')}</td><td>${escapeHtml(row.building_unit || '')}</td><td>${money(row.debit)}</td><td>${money(row.credit)}</td><td>${money(row.balance)}</td></tr>
    `).join('')}</tbody></table>
  ` : '';
  const rowHtml = (data.rows || []).map((row) => `
    <tr>
      <td>${escapeHtml(row.entry_date || '')}</td>
      <td>${escapeHtml(row.work_type || '')}</td>
      <td class="desc">${escapeHtml(row.statement_text || row.description || row.collection_note || '')}</td>
      ${showDimensions ? `<td>${escapeHtml(dimensionText(row, dimensionUnit) || '-')}</td>` : ''}
      <td>${escapeHtml(unitLabel(row.unit_code))}</td>
      <td>${money(row.quantity)}</td>
      <td>${money(row.rate)}</td>
      <td>${money(row.gross_total)}</td>
      <td>${money(row.net_total)}</td>
    </tr>`).join('');
  const summaryKeys = Object.keys((data.summaryRows || [])[0] || {});
  const summaryHtml = summaryKeys.length ? `
    <table><thead><tr>${summaryKeys.map((key) => `<th>${escapeHtml(summaryLabel(key))}</th>`).join('')}</tr></thead>
    <tbody>${data.summaryRows.map((row) => `<tr>${summaryKeys.map((key) => `<td>${formatCell(row[key])}</td>`).join('')}</tr>`).join('')}</tbody></table>
  ` : '';
  const detailHtml = rowHtml ? `
    <table><thead><tr><th>التاريخ</th><th>الأعمال</th><th>البيان</th>${showDimensions ? '<th>المقاس</th>' : ''}<th>الوحدة</th><th>الكمية</th><th>الفئة</th><th>الإجمالي</th><th>الصافي</th></tr></thead><tbody>${rowHtml}</tbody></table>
  ` : '';
  const logoPath = path.join(ROOT_DIR, 'src', 'assets', 'hgad-logo.png').replace(/\\/g, '/');
  return `<!doctype html>
  <html lang="ar" dir="rtl"><head><meta charset="utf-8" />
  <style>
    body{font-family:Arial,"Segoe UI",sans-serif;margin:24px;color:#111827}
    .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0f172a;padding-bottom:12px;margin-bottom:14px}
    .logo{width:78px;height:auto}.meta{text-align:left;direction:ltr;color:#475569}
    h1{margin:6px 0 4px;font-size:24px}.party{font-size:15px;color:#334155}
    table{width:100%;border-collapse:collapse;font-size:11px;margin-top:10px}
    th,td{border:1px solid #cbd5e1;padding:6px;vertical-align:top}th{background:#1f3f73;color:white}.desc{min-width:260px}
    .totals{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:14px}
    .box{border:1px solid #cbd5e1;padding:8px;background:#f8fafc}
    @page{size:A4 portrait;margin:10mm}
  </style></head><body>
    <div class="head"><div><img class="logo" src="file:///${logoPath}" /><h1>${escapeHtml(data.title)}</h1><div class="party">${escapeHtml(data.party || '')} / ${escapeHtml(data.project || '')}</div></div><div class="meta"><strong>${escapeHtml(data.operation_no || '')}</strong><br/>${new Date(data.generated_at).toLocaleDateString('en-GB')}</div></div>
    ${summaryHtml}${statementHtml}${detailHtml}${contractorPaymentTableHtml(data)}
    <div class="totals"><div class="box">الإجمالي: <strong>${money(data.totals.gross_total || data.totals.debit)}</strong></div><div class="box">ضريبة: <strong>${money(data.totals.vat_amount)}</strong></div><div class="box">التحصيل/الخصم: <strong>${money(data.totals.credit || data.totals.discount_amount)}</strong></div><div class="box">الصافي: <strong>${money(data.totals.net_total)}</strong></div></div>
  </body></html>`;
}

function renderReportXmlV2(data) {
  const summaryRows = data.summaryRows || [];
  const statementRows = data.statementRows || [];
  const showDimensions = !!data.show_dimensions;
  const dimensionUnit = data.dimension_unit || 'cm';
  const cell = (value, type = null) => {
    if (type === 'number') return `<Cell><Data ss:Type="Number">${Number(value || 0)}</Data></Cell>`;
    return `<Cell><Data ss:Type="String">${xmlEscape(value ?? '')}</Data></Cell>`;
  };
  const detailColumns = [
    ['entry_date', 'التاريخ'],
    ['operation_no', 'رقم العملية'],
    ['customer_display_name', 'العميل'],
    ['project', 'المشروع'],
    ['building_unit', 'المبنى/الوحدة'],
    ['work_type', 'نوع الأعمال'],
    ['statement_text', 'البيان'],
    ...(showDimensions ? [['__dimension', 'المقاس']] : []),
    ['unit', 'الوحدة'],
    ['quantity', 'الكمية'],
    ['rate', 'الفئة'],
    ['gross_total', 'الإجمالي'],
    ['vat_amount', 'ضريبة 14%'],
    ['net_total', 'الصافي'],
  ];
  const statementColumns = [
    ['entry_date', 'التاريخ'],
    ['description', 'المستند'],
    ['project', 'المشروع'],
    ['building_unit', 'الوحدة'],
    ['debit', 'إجمالي المستند'],
    ['credit', 'التحصيل'],
    ['balance', 'الرصيد'],
  ];
  const rows = statementRows.length ? statementRows : (data.rows || []);
  const columns = statementRows.length ? statementColumns : detailColumns;
  const detailTable = `
    <Table>
      <Row>${columns.map(([, label]) => cell(label)).join('')}</Row>
      ${rows.map((row) => `<Row>${columns.map(([key]) => {
        const value = key === '__dimension' ? (dimensionText(row, dimensionUnit) || '-') : key === 'unit' ? unitLabel(row.unit_code) : row[key];
        return cell(value, typeof value === 'number' ? 'number' : null);
      }).join('')}</Row>`).join('')}
      <Row></Row>
      <Row>${cell('الإجمالي')}${cell(data.totals.gross_total || data.totals.debit, 'number')}${cell('التحصيل/الخصم')}${cell(data.totals.credit || data.totals.discount_amount, 'number')}${cell('الصافي')}${cell(data.totals.net_total, 'number')}</Row>
    </Table>`;
  const summaryColumns = Object.keys(summaryRows[0] || {});
  const summaryTable = summaryColumns.length ? `
    <Worksheet ss:Name="ملخص">
      <Table>
        <Row>${summaryColumns.map((key) => cell(summaryLabel(key))).join('')}</Row>
        ${summaryRows.map((row) => `<Row>${summaryColumns.map((key) => cell(row[key], typeof row[key] === 'number' ? 'number' : null)).join('')}</Row>`).join('')}
      </Table>
    </Worksheet>` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
  <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
    <Title>${xmlEscape(data.title)}</Title>
    <Author>Accounting Management</Author>
    <Created>${new Date(data.generated_at).toISOString()}</Created>
  </DocumentProperties>
  <Worksheet ss:Name="التقرير">
    ${detailTable}
  </Worksheet>
  ${summaryTable}
</Workbook>`;
}

function reportDescriptionLines(row = {}) {
  const directParts = statementParts(row);
  if (directParts.length) return directParts;
  return String(row.statement_text || row.collection_note || '')
    .split(/\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function reportDescriptionText(row = {}) {
  return reportDescriptionLines(row).join('\n');
}

function reportDescriptionHtml(row = {}) {
  return reportDescriptionLines(row)
    .map((part) => `<span class="desc-line" dir="auto">${escapeHtml(part)}</span>`)
    .join('');
}

function taxBreakdown(rows) {
  return [
    ['vat_amount', 'ضريبة القيمة المضافة 14%'],
    ['social_insurance_amount', 'تأمينات اجتماعية 3.6%'],
    ['stamp_amount', 'دمغة هندسية 0.001'],
    ['works_insurance_amount', 'تأمينات أعمال 5%'],
    ['final_insurance_amount', 'تأمين أعمال نهائي 5%'],
    ['contractor_tax_amount', 'ضريبة 1%'],
  ].map(([key, label]) => ({
    key,
    label,
    amount: roundMoney((rows || []).reduce((sum, row) => sum + numberOrZero(row[key]), 0)),
  })).filter((item) => item.amount);
}

function reportDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return String(value || '');
  return new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function englishDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return String(value || '');
  return new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function englishMoney(value) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0));
}

function englishReportTitle(type) {
  return {
    offer: 'Price offer',
    invoice: 'Invoice',
    taxInvoice: 'Invoice',
    nonTaxInvoice: 'Invoice',
    statement: 'Account statement',
    taxStatement: 'Account statement',
    nonTaxStatement: 'Account statement',
    contractor: 'Contractor certificate',
    runningCertificate: 'Contractor certificate',
    contractorStatement: 'Contractor statement',
  }[type] || 'Report';
}

function reportTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

function displayNumber(value, dashZero = false) {
  if (dashZero && !numberOrZero(value)) return '-';
  return money(value);
}

function imageDataUri(filePath) {
  try {
    const bytes = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase().replace('.', '') || 'png';
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
    return `data:${mime};base64,${bytes.toString('base64')}`;
  } catch {
    return '';
  }
}

function latinNumber(value, size = 2) {
  return new Intl.NumberFormat('en-US', {
    useGrouping: false,
    minimumIntegerDigits: size,
  }).format(Number(value || 0));
}

function reportDateTime(value, timeZone = 'Africa/Cairo') {
  const dateOnly = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    return `${latinNumber(dateOnly[1], 4)}/${latinNumber(dateOnly[2])}/${latinNumber(dateOnly[3])} ${latinNumber(0)}:${latinNumber(0)}:${latinNumber(0)}`;
  }
  const date = value ? new Date(value) : new Date();
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${latinNumber(parts.year, 4)}/${latinNumber(parts.month)}/${latinNumber(parts.day)} ${latinNumber(parts.hour)}:${latinNumber(parts.minute)}:${latinNumber(parts.second)}`;
}

function reportDateBlock(data) {
  const generated = data.generated_at || new Date().toISOString();
  const entry = data.entry_date || generated;
  return `
    <div class="issue-dates">
      <div>Issue date: ${reportDateTime(generated, 'Africa/Cairo')} Cairo</div>
      <div>UTC: ${reportDateTime(generated, 'UTC')} UTC</div>
      <div>Entry date: ${reportDateTime(entry, 'Africa/Cairo')} Cairo</div>
      <div>UTC: ${reportDateTime(entry, 'UTC')} UTC</div>
    </div>`;
}

function qrDataUri(data) {
  const reportName = englishReportTitle(data.type);
  const id = data.operation_no || data.serial || '';
  const totalQuantity = quantitySummaryText(data.rows || [], 'en') || new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format((data.rows || []).reduce((sum, row) => sum + numberOrZero(row.quantity), 0));
  const totalAmount = data.totals?.net_total || data.totals?.gross_total || 0;
  const content = [
    'HGAD',
    `${reportName} number ${id}`,
    `Total quantity: ${totalQuantity}`,
    `Total amount: ${englishMoney(totalAmount)} EGP`,
    `Provided and approved by Handasia group for architectural designs and provided in the date ${englishDate(data.generated_at)}`,
    'https://hgad-eg.com',
  ].join('\n');
  const svg = new QRCodeSvg({
    content,
    padding: 1,
    width: 96,
    height: 96,
    color: '#111111',
    background: '#ffffff',
    ecl: 'M',
  }).svg();
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

function quantitySummaryText(rows = [], locale = 'ar') {
  const totals = {
    sqm: { quantity: 0, count: 0 },
    lm: { quantity: 0, count: 0 },
    count: { quantity: 0, count: 0 },
  };
  for (const row of rows || []) {
    const unit = row.unit_code === 'lm' ? 'lm' : row.unit_code === 'count' ? 'count' : 'sqm';
    totals[unit].quantity += numberOrZero(row.quantity);
    totals[unit].count += numberOrZero(row.item_count);
  }
  const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  const parts = [];
  if (totals.sqm.quantity) parts.push(`${fmt.format(roundMoney(totals.sqm.quantity))}${locale === 'en' ? ' m2' : 'م²'}`);
  if (totals.lm.quantity) parts.push(`${fmt.format(roundMoney(totals.lm.quantity))}${locale === 'en' ? ' lm' : ' م.ط'}`);
  return parts.join(locale === 'en' ? ' | ' : ' | ');
}

function itemCountSummaryText(rows = [], locale = 'ar') {
  const total = (rows || []).reduce((sum, row) => sum + numberOrZero(row.item_count), 0);
  if (!total) return '';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(roundMoney(total));
}

function contractorCertificateNumber(rows = [], requested = '') {
  const selected = normalizeText(requested);
  if (selected) return selected;
  const certificates = uniqueRowValues(rows, 'certificate_no');
  if (certificates.length) {
    return certificates
      .sort((a, b) => {
        const an = Number(a);
        const bn = Number(b);
        if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
        return String(a).localeCompare(String(b), 'ar', { numeric: true });
      })
      .at(-1);
  }
  const dates = uniqueRowValues(rows, 'entry_date');
  return dates.length ? String(dates.length) : '';
}

const AR_ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
const AR_TENS = ['', 'عشرة', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const AR_TEENS = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const AR_HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];

function arabicIntegerWords(value) {
  const n = Math.floor(Math.abs(Number(value || 0)));
  if (!n) return 'صفر';
  if (n < 10) return AR_ONES[n];
  if (n < 20) return AR_TEENS[n - 10];
  if (n < 100) {
    const one = n % 10;
    const ten = Math.floor(n / 10);
    return one ? `${AR_ONES[one]} و${AR_TENS[ten]}` : AR_TENS[ten];
  }
  if (n < 1000) {
    const rest = n % 100;
    const hundred = Math.floor(n / 100);
    return rest ? `${AR_HUNDREDS[hundred]} و${arabicIntegerWords(rest)}` : AR_HUNDREDS[hundred];
  }
  const scales = [
    [1000000000, 'مليار', 'ملياران', 'مليارات'],
    [1000000, 'مليون', 'مليونان', 'ملايين'],
    [1000, 'ألف', 'ألفان', 'آلاف'],
  ];
  for (const [scale, single, dual, plural] of scales) {
    if (n >= scale) {
      const major = Math.floor(n / scale);
      const rest = n % scale;
      let majorText;
      if (major === 1) majorText = single;
      else if (major === 2) majorText = dual;
      else if (major <= 10) majorText = `${arabicIntegerWords(major)} ${plural}`;
      else majorText = `${arabicIntegerWords(major)} ${single}`;
      return rest ? `${majorText} و${arabicIntegerWords(rest)}` : majorText;
    }
  }
  return String(n);
}

function arabicAmountWords(amount) {
  const safe = Math.max(0, roundMoney(amount));
  const pounds = Math.floor(safe);
  const piasters = Math.round((safe - pounds) * 100);
  const poundPart = `${arabicIntegerWords(pounds)} جنيه`;
  const piasterPart = piasters ? ` و${arabicIntegerWords(piasters)} قرشاً` : '';
  return `${poundPart}${piasterPart} فقط`;
}

function uniqueRowValues(rows, key) {
  return [...new Set((rows || []).map((row) => String(row[key] || '').trim()).filter(Boolean))];
}

function locationText(row = {}) {
  return [row.building_unit, row.floor_apartment].map((part) => String(part || '').trim()).filter(Boolean).join(' / ');
}

function contractorPaymentTableHtml(data) {
  const rows = data.paymentRows || [];
  if (data.type !== 'contractor' || !rows.length) return '';
  return `
    <table class="report-table payment-table">
      <thead><tr><th>\u062a\u0627\u0631\u064a\u062e \u0627\u0644\u062f\u0641\u0639\u0629</th><th>\u0628\u064a\u0627\u0646 \u0627\u0644\u062f\u0641\u0639\u0629</th><th>\u0645\u0644\u0627\u062d\u0638\u0629</th><th>\u0627\u0644\u0645\u0628\u0644\u063a</th></tr></thead>
      <tbody>${rows.map((row) => `
        <tr class="payment-row">
          <td>${escapeHtml(row.entry_date || '')}</td>
          <td>${escapeHtml(row.work_type || row.description || '\u062a\u062d\u0635\u064a\u0644')}</td>
          <td>${escapeHtml(row.collection_note || row.notes || '')}</td>
          <td>${money(Math.abs(numberOrZero(row.collection_amount)))}</td>
        </tr>`).join('')}</tbody>
    </table>`;
}

function detailReportTableHtml(data, showDimensions, dimensionUnit) {
  const rows = data.rows || [];
  if (!rows.length) return '';
  const generalWorksLabel = '\u0627\u0639\u0645\u0627\u0644 \u0639\u0627\u0645\u0629';
  const subtotalMode = data.subtotal_mode || 'none';
  const enableBuildingSubtotal = ['building', 'unit'].includes(subtotalMode);
  const enableUnitSubtotal = subtotalMode === 'unit';
  const locations = uniqueRowValues(rows, 'building_unit');
  const showLocation = locations.length > 1 || rows.some((row) => row.floor_apartment);
  const orderedRows = showLocation
    ? [...rows].sort((a, b) => locationText(a).localeCompare(locationText(b), 'ar') || Number(a.id || 0) - Number(b.id || 0))
    : rows;
  const locationCounts = new Map();
  const locationTotals = new Map();
  const unitCounts = new Map();
  const unitTotals = new Map();
  for (const row of orderedRows) {
    const key = locationText(row) || generalWorksLabel;
    locationCounts.set(key, (locationCounts.get(key) || 0) + 1);
    const totals = locationTotals.get(key) || { quantity: 0, item_count: 0, gross_total: 0, net_total: 0 };
    totals.quantity += numberOrZero(row.quantity);
    totals.item_count += numberOrZero(row.item_count);
    totals.gross_total += numberOrZero(row.gross_total);
    totals.net_total += numberOrZero(row.net_total);
    locationTotals.set(key, totals);
    const unitKey = [row.building_unit || 'بدون مبنى', row.floor_apartment || row.unit || 'بدون وحدة'].join(' / ');
    unitCounts.set(unitKey, (unitCounts.get(unitKey) || 0) + 1);
    const unit = unitTotals.get(unitKey) || { quantity: 0, item_count: 0, gross_total: 0, net_total: 0 };
    unit.quantity += numberOrZero(row.quantity);
    unit.item_count += numberOrZero(row.item_count);
    unit.gross_total += numberOrZero(row.gross_total);
    unit.net_total += numberOrZero(row.net_total);
    unitTotals.set(unitKey, unit);
  }
  let activeLocation = null;
  let activeUnit = null;
  const body = [];
  const subtotalRow = (key, totalsMap, countsMap, label) => {
    if ((countsMap.get(key) || 0) <= 1) return '';
    const selectedTotals = totalsMap.get(key);
    if (!selectedTotals) return '';
    const span = 2 + (showDimensions ? 1 : 0);
    const labelText = [label, key].filter(Boolean).join(' ');
    return `<tr class="subtotal"><td colspan="${span}">إجمالي ${escapeHtml(labelText)}</td><td>${money(selectedTotals.item_count)}</td><td>${money(selectedTotals.quantity)}</td><td></td><td>${money(selectedTotals.gross_total)}</td></tr>`;
  };
  orderedRows.forEach((row, index) => {
    const key = locationText(row) || generalWorksLabel;
    const unitKey = [row.building_unit || 'بدون مبنى', row.floor_apartment || row.unit || 'بدون وحدة'].join(' / ');
    if (activeUnit && unitKey !== activeUnit && enableUnitSubtotal) body.push(subtotalRow(activeUnit, unitTotals, unitCounts, 'الوحدة'));
    if (activeLocation && key !== activeLocation && enableBuildingSubtotal) body.push(subtotalRow(activeLocation, locationTotals, locationCounts, ''));
    if (showLocation && key !== activeLocation) body.push(`<tr class="group-row"><td colspan="${6 + (showDimensions ? 1 : 0)}">${escapeHtml(key)}</td></tr>`);
    activeLocation = key;
    activeUnit = unitKey;
    const descriptionHtml = data.type === 'contractor'
      ? `<span class="desc-line" dir="auto">${escapeHtml(row.work_type || reportDescriptionText(row) || '-')}</span>`
      : (reportDescriptionHtml(row) || '-');
    body.push(`
      <tr>
        <td class="desc">${descriptionHtml}</td>
        ${showDimensions ? `<td>${escapeHtml(dimensionText(row, dimensionUnit) || '-')}</td>` : ''}
        <td>${escapeHtml(unitLabel(row.unit_code))}</td>
        <td>${displayNumber(row.item_count, true)}</td>
        <td>${displayNumber(row.quantity, true)}</td>
        <td>${displayNumber(row.rate, true)}</td>
        <td>${money(row.gross_total)}</td>
      </tr>`);
    if (index === orderedRows.length - 1) {
      if (enableUnitSubtotal) body.push(subtotalRow(unitKey, unitTotals, unitCounts, 'الوحدة'));
      if (enableBuildingSubtotal) body.push(subtotalRow(key, locationTotals, locationCounts, ''));
    }
  });
  return `
    <table class="report-table">
      <thead><tr><th>البيان</th>${showDimensions ? '<th>المقاس</th>' : ''}<th>الوحدة</th><th>العدد</th><th>الكمية</th><th>الفئة</th><th>الإجمالي</th></tr></thead>
      <tbody>${body.join('')}</tbody>
    </table>`;
}

function termsHtml(data) {
  const sections = data.terms || [];
  if (!sections.length) return '';
  return `
    <section class="terms">
      <h2>الشروط والأحكام</h2>
      ${sections.map((section) => `
        <div class="term-block">
          <h3>${escapeHtml(section.title || '')}</h3>
          <ul>${(section.lines || []).filter(Boolean).map((line) => {
            const raw = String(line);
            const important = raw.trim().startsWith('**');
            const text = important ? raw.replace(/^\s*\*\*\s*/, '') : raw;
            return `<li class="${important ? 'important' : ''}"><span>${escapeHtml(text)}</span></li>`;
          }).join('')}</ul>
        </div>
      `).join('')}
    </section>`;
}

function totalsHtml(data) {
  const totals = data.totals || {};
  if (data.is_statement || (data.statementRows || []).length) {
    const quantitySummary = totals.quantity ? `<div class="box"><span>الكمية</span><strong>${money(totals.quantity)}</strong></div>` : '';
    const taxBoxes = (data.tax_breakdown || [])
      .map((tax) => `<div class="box"><span>${escapeHtml(tax.label)}</span><strong>${money(tax.amount)}</strong></div>`)
      .join('');
    const discountBox = data.discount_label
      ? `<div class="box discount"><span>${escapeHtml(data.discount_label)}</span><strong>${money(totals.discount_amount)}</strong></div>`
      : '';
    return `
      <div class="totals">
        ${quantitySummary}
        <div class="box"><span>إجمالي المستندات</span><strong>${money(totals.gross_total || totals.debit)}</strong></div>
        ${taxBoxes}
        ${discountBox}
        <div class="box"><span>التحصيل</span><strong>${money(totals.credit)}</strong></div>
        <div class="box emphasis"><span>الرصيد</span><strong>${money(totals.net_total)}</strong></div>
      </div>`;
  }
  const quantitySummary = quantitySummaryText(data.rows || [], 'ar');
  const itemCountSummary = itemCountSummaryText(data.rows || [], 'ar');
  const quantityBox = quantitySummary
    ? `<div class="box"><span>الكمية</span><strong>${escapeHtml(quantitySummary)}</strong></div>`
    : '';
  const itemCountBox = itemCountSummary
    ? `<div class="box"><span>العدد</span><strong>${escapeHtml(itemCountSummary)}</strong></div>`
    : '';
  const taxBoxes = (data.tax_breakdown || [])
    .map((tax) => `<div class="box"><span>${escapeHtml(tax.label)}</span><strong>${money(tax.amount)}</strong></div>`)
    .join('');
  const discountBox = data.discount_label
    ? `<div class="box discount"><span>${escapeHtml(data.discount_label)}</span><strong>${money(totals.discount_amount)}</strong></div>`
    : '';
  const paymentBox = totals.credit
    ? `<div class="box payment-total"><span>التحصيل</span><strong>${money(totals.credit)}</strong></div>`
    : '';
  const hasAdjustments = !!taxBoxes || !!discountBox || !!paymentBox;
  const showGross = hasAdjustments || roundMoney(totals.gross_total) !== roundMoney(totals.net_total);
  return `
    <div class="totals">
      ${quantityBox}
      ${itemCountBox}
      ${showGross ? `<div class="box"><span>الإجمالي</span><strong>${money(totals.gross_total)}</strong></div>` : ''}
      ${taxBoxes}
      ${discountBox}
      ${paymentBox}
      <div class="box emphasis"><span>الصافي</span><strong>${money(totals.net_total)}</strong></div>
      ${['invoice', 'taxInvoice', 'nonTaxInvoice'].includes(data.type) ? `<div class="box words"><strong>${escapeHtml(arabicAmountWords(totals.net_total))}</strong></div>` : ''}
    </div>`;
}

function renderReportHtmlV2(data) {
  const showDimensions = !!data.show_dimensions;
  const dimensionUnit = data.dimension_unit || 'cm';
  const logoData = imageDataUri(path.join(ROOT_DIR, 'src', 'assets', 'hgad-logo.png'));
  const qrData = qrDataUri(data);
  const titleLine = data.operation_no ? `${data.title} رقم ${data.operation_no}` : data.title;
  const workLine = data.type !== 'contractor' && data.overall_work_type ? `أعمال ${data.overall_work_type}` : '';
  const rows = data.rows || [];
  const projectValues = uniqueRowValues(rows, 'project');
  const buildingValues = uniqueRowValues(rows, 'building_unit');
  const projectValue = projectValues.length === 1 ? projectValues[0] : (data.project || 'متعدد - راجع البنود');
  const buildingValue = buildingValues.length === 1 ? buildingValues[0] : (buildingValues.length > 1 ? 'متعدد - راجع البنود' : data.building_unit || '');
  const headerInfo = [
    ['العميل', data.party || '-'],
    ['المشروع', [projectValue, buildingValue].filter(Boolean).join(' - ') || '-'],
  ];
  const statementRows = data.statementRows || [];
  const statementHtml = statementRows.length ? `
    <table class="report-table">
      <thead><tr><th>التاريخ</th><th>المستند</th><th>المشروع</th><th>التفاصيل</th><th>الكمية</th><th>ضرائب / خصم</th><th>إجمالي المستند</th><th>التحصيل</th><th>الرصيد</th></tr></thead>
      <tbody>${statementRows.map((row) => `
        <tr class="${row.is_payment ? 'payment-row' : ''}">
          <td>${escapeHtml(row.entry_date || '')}</td>
          <td class="statement-doc">${escapeHtml(row.description || '')}</td>
          <td>${escapeHtml(row.project_label || row.project || '')}</td>
          <td>${escapeHtml(row.details || '')}</td>
          <td>${row.is_payment ? '-' : money(row.quantity)}</td>
          <td>${row.is_payment ? '-' : escapeHtml([row.vat_amount ? `ضريبة ${money(row.vat_amount)}` : '', row.discount_amount ? `خصم ${money(row.discount_amount)}` : ''].filter(Boolean).join(' / ') || '-')}</td>
          <td>${money(row.debit)}</td>
          <td>${money(row.credit)}</td>
          <td>${money(row.balance)}</td>
        </tr>`).join('')}</tbody>
    </table>` : '';
  const detailHtml = detailReportTableHtml(data, showDimensions, dimensionUnit);
  const summaryKeys = Object.keys((data.summaryRows || [])[0] || {});
  const summaryHtml = summaryKeys.length ? `
    <table class="report-table summary"><thead><tr>${summaryKeys.map((key) => `<th>${escapeHtml(summaryLabel(key))}</th>`).join('')}</tr></thead>
    <tbody>${data.summaryRows.map((row) => `<tr>${summaryKeys.map((key) => `<td>${formatCell(row[key])}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '';

  return `<!doctype html>
  <html lang="ar" dir="rtl"><head><meta charset="utf-8" />
  <style>
    @page{size:A4 portrait;margin:10mm 9mm 20mm}
    *{box-sizing:border-box}
    body{font-family:Arial,"Segoe UI",Tahoma,sans-serif;margin:0;color:#1b1b1b;background:#fff;font-size:12px}
    .page{padding:10px 12px 24px}
    .brand-head{position:relative;min-height:190px;margin-bottom:8px;padding-top:2px;text-align:center}
    .brand-center{width:min(620px,100%);margin:0 auto;text-align:center}
    .logo,.qr{width:94px;height:94px;object-fit:contain}
    .qr{position:absolute;right:0;top:4px;border:1px solid #d7c08a;padding:4px;background:#fff}
    .brand-en,.brand-ar,h1,.terms h2,.term-block h3{font-family:Georgia,"Times New Roman",serif}
    .brand-en{color:#a87921;font-weight:700;font-size:16px;letter-spacing:.5px;text-transform:uppercase;text-shadow:0 1px 0 #f5eee0}
    .brand-ar{color:#a87921;font-weight:700;font-size:16px;margin-top:2px;text-shadow:0 1px 0 #f5eee0}
    h1{font-size:17px;margin:12px 0 3px;font-weight:700}
    .subtitle{font-size:15px;margin:0 0 8px;color:#111}
    .issue-dates{position:absolute;left:4px;top:8px;width:300px;direction:ltr;text-align:left;color:#1f2933;font-size:9.8px;line-height:1.55;border-left:3px solid #a87921;padding-left:8px;white-space:normal}
    .info-band{display:grid;grid-template-columns:repeat(2,1fr);gap:0;background:#f3f0e8;border:1px solid #d9cfb8;margin:8px 0 10px}
    .info-item{display:grid;grid-template-columns:auto 1fr;gap:10px;padding:8px 12px;align-items:center;min-height:34px}
    .info-item span{font-weight:700;color:#111}
    .info-item strong{font-weight:500;text-align:right}
    .report-table{width:100%;border-collapse:collapse;margin-top:10px;font-size:11px}
    th,td{border:1px solid #d6d0c3;padding:5px 6px;vertical-align:top}
    th{background:#202020;color:#d6a84f;font-weight:700;text-align:center}
    td{text-align:center}
    tbody tr:nth-child(odd):not(.group-row):not(.subtotal){background:#faf8f2}
    .desc{text-align:right;min-width:320px;line-height:1.45;white-space:normal;unicode-bidi:plaintext}
    .desc-line{display:block;unicode-bidi:plaintext}
    .totals{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:12px 0}
    .box{border:1px solid #d6c08d;background:#fbfaf6;padding:8px 10px;display:flex;gap:8px;justify-content:space-between;align-items:center;min-height:40px}
    .box span{font-weight:700}.box strong{font-size:13px}.box.emphasis{background:#efe3c6;border-color:#a87921}
    .box.words{grid-column:1/-1;justify-content:flex-start;gap:18px;text-align:right}
    .box.discount span,.box.discount strong{color:#c00000}
    .payment-row td{color:#c00000;text-decoration:underline;text-underline-offset:3px;font-weight:700}
    .group-row td{background:#ece6d7;color:#111;font-weight:700;text-align:right}
    .subtotal td{background:#f0f0f0;font-weight:700;color:#111}
    .terms{page-break-inside:avoid;margin-top:14px;border:1px solid #d6c08d;background:#fff}
    .terms h2{font-size:14px;margin:0;text-align:center;background:#202020;color:#d6a84f;padding:8px}
    .term-block{padding:8px 12px;border-top:1px solid #e6ddc9}
    .term-block h3{font-size:12px;margin:0 0 5px;color:#9a6b16}
    .term-block ul{list-style:none;margin:0;padding:0;display:grid;gap:3px}
    .term-block li{position:relative;margin:0;padding-right:14px;line-height:1.55;text-align:right;color:#202020}
    .term-block li::before{content:"-";position:absolute;right:0;color:#a87921;font-weight:700}
    .term-block li.important span{color:#c00000;font-weight:700}
    .footer{margin-top:12px;padding-top:7px;border-top:1px solid #d6c08d;display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;color:#9a6b16;font-size:11px;direction:ltr;line-height:1.45;align-items:center}
    .footer .left,.footer .center,.footer .right{text-align:center}.footer span{display:grid;min-height:42px;place-content:center;gap:2px}.footer em{font-style:normal}
    @media print{.footer{display:none}}
  </style></head><body><div class="page">
    <header class="brand-head">
      <img class="qr" src="${qrData}" />
      <div class="brand-center">
        <img class="logo" src="${logoData}" />
        <div class="brand-en">EL HANDASIA GROUP FOR ARCHITECTURAL DESIGNS</div>
        <div class="brand-ar">المجموعة الهندسية للتصميمات المعمارية</div>
        <h1>${escapeHtml(titleLine)}</h1>
        ${workLine ? `<p class="subtitle">${escapeHtml(workLine)}</p>` : ''}
      </div>
      ${reportDateBlock(data)}
    </header>
    <section class="info-band">
      ${headerInfo.map(([label, value]) => `<div class="info-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}
    </section>
    ${summaryHtml}${statementHtml}${detailHtml}${contractorPaymentTableHtml(data)}
    ${totalsHtml(data)}
    ${termsHtml(data)}
    <footer class="footer">
      <span class="left"><strong>${escapeHtml(reportDate(data.generated_at))}</strong><em>المجموعة الهندسية للتصميمات المعمارية</em></span>
      <span class="center"><strong>HGAD</strong><em>https://hgad-eg.com</em></span>
      <span class="right"><strong>Page preview</strong><em>By ${escapeHtml(data.prepared_by || 'Eng. Yasser')}</em></span>
    </footer>
  </div></body></html>`;
}

async function writeXlsx(data, outputPath) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Accounting Management';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('التقرير', {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 7 }],
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1 },
  });
  sheet.columns = [
    { key: 'date', width: 13 },
    { key: 'work', width: 24 },
    { key: 'description', width: 54 },
    { key: 'dimension', width: 18 },
    { key: 'unit', width: 10 },
    { key: 'count', width: 10 },
    { key: 'quantity', width: 12 },
    { key: 'rate', width: 12 },
    { key: 'gross', width: 14 },
    { key: 'net', width: 14 },
  ];
  sheet.mergeCells('A1:J1');
  sheet.getCell('A1').value = 'EL HANDASIA GROUP FOR ARCHITECTURAL DESIGNS';
  sheet.getCell('A1').font = { bold: true, size: 16, color: { argb: 'B9852F' } };
  sheet.getCell('A1').alignment = { horizontal: 'center' };
  sheet.mergeCells('A2:J2');
  sheet.getCell('A2').value = 'المجموعة الهندسية للتصميمات المعمارية';
  sheet.getCell('A2').font = { bold: true, size: 14, color: { argb: 'B9852F' } };
  sheet.getCell('A2').alignment = { horizontal: 'center' };
  sheet.mergeCells('A3:J3');
  sheet.getCell('A3').value = `${data.title}${data.operation_no ? ` رقم ${data.operation_no}` : ''}`;
  sheet.getCell('A3').font = { bold: true, size: 14 };
  sheet.getCell('A3').alignment = { horizontal: 'center' };
  sheet.mergeCells('A4:J4');
  sheet.getCell('A4').value = data.type !== 'contractor' && data.overall_work_type ? `أعمال ${data.overall_work_type}` : '';
  sheet.getCell('A4').alignment = { horizontal: 'center' };
  sheet.addRow([]);
  sheet.addRow(['العميل', data.party || '', 'المشروع', [data.project, data.building_unit].filter(Boolean).join(' - '), 'تاريخ التقرير', reportDate(data.generated_at), 'الأعمال', data.overall_work_type || '', 'By', data.prepared_by || 'Eng. Yasser']);
  sheet.lastRow.font = { bold: true };
  sheet.lastRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6E6E6' } };

  const statementRows = data.statementRows || [];
  if (statementRows.length) {
    sheet.addRow(['التاريخ', 'المستند', 'المشروع', 'التفاصيل', 'الكمية', 'ضرائب / خصم', 'إجمالي المستند', 'التحصيل', 'الرصيد']);
    sheet.lastRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.lastRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4B82' } };
    for (const row of statementRows) {
      const adjustments = [
        row.vat_amount ? `ضريبة ${money(row.vat_amount)}` : '',
        row.discount_amount ? `خصم ${money(row.discount_amount)}` : '',
      ].filter(Boolean).join(' / ');
      const xlsxRow = sheet.addRow([
        row.entry_date || '',
        row.description || '',
        row.project_label || [row.project, row.building_unit].filter(Boolean).join(' - '),
        row.details || '',
        row.is_payment ? '' : numberOrZero(row.quantity),
        row.is_payment ? '' : adjustments,
        numberOrZero(row.debit),
        numberOrZero(row.credit),
        numberOrZero(row.balance),
      ]);
      if (row.is_payment) {
        xlsxRow.eachCell((cell) => {
          cell.font = { bold: true, color: { argb: 'FFC00000' }, underline: true };
        });
      }
    }
  } else {
    const headers = ['الموقع', 'البيان', 'المقاس', 'الوحدة', 'العدد', 'الكمية', 'الفئة', 'الإجمالي', 'الصافي'];
    sheet.addRow(headers);
    sheet.lastRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.lastRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4B82' } };
    for (const row of data.rows || []) {
      sheet.addRow([
        locationText(row) || '',
        reportDescriptionText(row),
        data.show_dimensions ? (dimensionText(row, data.dimension_unit || 'cm') || '-') : '',
        unitLabel(row.unit_code),
        numberOrZero(row.item_count) || '',
        numberOrZero(row.quantity) || '',
        numberOrZero(row.rate) || '',
        numberOrZero(row.gross_total),
        numberOrZero(row.net_total),
      ]);
    }
  }
  sheet.addRow([]);
  sheet.addRow(['الإجمالي', numberOrZero(data.totals?.gross_total || data.totals?.debit)]);
  for (const tax of data.tax_breakdown || []) sheet.addRow([tax.label, tax.amount]);
  if (data.discount_label) sheet.addRow([data.discount_label, numberOrZero(data.totals?.discount_amount)]);
  if (data.totals?.credit) sheet.addRow(['التحصيل', numberOrZero(data.totals.credit)]);
  sheet.addRow(['الصافي', numberOrZero(data.totals?.net_total)]);
  if ((data.terms || []).length) {
    sheet.addRow([]);
    sheet.addRow(['الشروط والأحكام']);
    sheet.lastRow.font = { bold: true, color: { argb: 'FF1F4B82' } };
    for (const section of data.terms) {
      sheet.addRow([section.title || '']);
      sheet.lastRow.font = { bold: true };
      for (const line of section.lines || []) sheet.addRow([line]);
    }
  }
  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.alignment = { vertical: 'top', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFBFD2E6' } },
        left: { style: 'thin', color: { argb: 'FFBFD2E6' } },
        bottom: { style: 'thin', color: { argb: 'FFBFD2E6' } },
        right: { style: 'thin', color: { argb: 'FFBFD2E6' } },
      };
      if (typeof cell.value === 'number') cell.numFmt = '#,##0.00';
    });
  });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await workbook.xlsx.writeFile(outputPath);
}

async function writeCleanXlsx(data, outputPath) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Accounting Management';
  workbook.created = new Date();
  const statementRows = data.statementRows || [];
  const rows = data.rows || [];
  const showDimensions = !!data.show_dimensions;
  const isStatement = statementRows.length > 0;
  const columns = isStatement
    ? [
      { header: 'التاريخ', key: 'entry_date', width: 14 },
      { header: 'المستند', key: 'description', width: 28 },
      { header: 'المشروع', key: 'project_label', width: 38 },
      { header: 'التفاصيل', key: 'details', width: 30 },
      { header: 'الكمية', key: 'quantity', width: 12 },
      { header: 'ضرائب / خصم', key: 'adjustments', width: 24 },
      { header: 'إجمالي المستند', key: 'debit', width: 16 },
      { header: 'التحصيل', key: 'credit', width: 16 },
      { header: 'الرصيد', key: 'balance', width: 16 },
    ]
    : [
      { header: 'البيان', key: 'description', width: 58 },
      ...(showDimensions ? [{ header: 'المقاس', key: 'dimension', width: 18 }] : []),
      { header: 'الوحدة', key: 'unit', width: 10 },
      { header: 'العدد', key: 'count', width: 10 },
      { header: 'الكمية', key: 'quantity', width: 12 },
      { header: 'الفئة', key: 'rate', width: 13 },
      { header: 'الإجمالي', key: 'gross', width: 16 },
    ];
  const sheet = workbook.addWorksheet('التقرير', {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 7 }],
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1 },
  });
  sheet.columns = columns.map((column) => ({ key: column.key, width: column.width }));
  const totalCols = columns.length;
  const mergeRow = (rowNumber, value, font = {}) => {
    sheet.mergeCells(rowNumber, 1, rowNumber, totalCols);
    const cell = sheet.getCell(rowNumber, 1);
    cell.value = value;
    cell.font = font;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  };
  mergeRow(1, 'EL HANDASIA GROUP FOR ARCHITECTURAL DESIGNS', { bold: true, size: 16, color: { argb: 'FFB9852F' } });
  mergeRow(2, 'المجموعة الهندسية للتصميمات المعمارية', { bold: true, size: 14, color: { argb: 'FFB9852F' } });
  mergeRow(3, `${data.title}${data.operation_no ? ` رقم ${data.operation_no}` : ''}`, { bold: true, size: 14 });
  mergeRow(4, data.type !== 'contractor' && data.overall_work_type ? `أعمال ${data.overall_work_type}` : '', { bold: true, size: 12 });
  sheet.addRow([]);
  const info = sheet.addRow(['العميل', data.party || '', 'المشروع', [data.project, data.building_unit].filter(Boolean).join(' - '), 'By', data.prepared_by || '']);
  info.font = { bold: true };
  info.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F0E8' } };
  const header = sheet.addRow(columns.map((column) => column.header));
  header.font = { bold: true, color: { argb: 'FFD6A84F' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF202020' } };
  header.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

  if (isStatement) {
    for (const row of statementRows) {
      const adjustments = [
        row.vat_amount ? `ضريبة ${money(row.vat_amount)}` : '',
        row.discount_amount ? `خصم ${money(row.discount_amount)}` : '',
      ].filter(Boolean).join(' / ');
      const xlsxRow = sheet.addRow([
        row.entry_date || '',
        row.description || '',
        row.project_label || [row.project, row.building_unit].filter(Boolean).join(' - '),
        row.details || '',
        row.is_payment ? '' : numberOrZero(row.quantity),
        row.is_payment ? '' : adjustments,
        numberOrZero(row.debit),
        numberOrZero(row.credit),
        numberOrZero(row.balance),
      ]);
      if (row.is_payment) {
        xlsxRow.eachCell((cell) => {
          cell.font = { bold: true, color: { argb: 'FFC00000' }, underline: true };
        });
      }
    }
  } else {
    const showGroups = uniqueRowValues(rows, 'building_unit').length > 1 || rows.some((row) => row.floor_apartment);
    const orderedRows = showGroups
      ? [...rows].sort((a, b) => locationText(a).localeCompare(locationText(b), 'ar') || Number(a.id || 0) - Number(b.id || 0))
      : rows;
    let activeLocation = null;
    for (const row of orderedRows) {
      const location = locationText(row) || '\u0627\u0639\u0645\u0627\u0644 \u0639\u0627\u0645\u0629';
      if (showGroups && location !== activeLocation) {
        activeLocation = location;
        const group = sheet.addRow([location]);
        sheet.mergeCells(group.number, 1, group.number, totalCols);
        group.font = { bold: true };
        group.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECE6D7' } };
      }
      sheet.addRow([
        reportDescriptionText(row),
        ...(showDimensions ? [dimensionText(row, data.dimension_unit || 'cm') || ''] : []),
        unitLabel(row.unit_code),
        numberOrZero(row.item_count) || '',
        numberOrZero(row.quantity) || '',
        numberOrZero(row.rate) || '',
        numberOrZero(row.gross_total),
      ]);
    }
  }

  if ((data.paymentRows || []).length) {
    sheet.addRow([]);
    const paymentHeader = sheet.addRow(['\u062a\u0627\u0631\u064a\u062e \u0627\u0644\u062f\u0641\u0639\u0629', '\u0628\u064a\u0627\u0646 \u0627\u0644\u062f\u0641\u0639\u0629', '\u0645\u0644\u0627\u062d\u0638\u0629', '\u0627\u0644\u0645\u0628\u0644\u063a']);
    paymentHeader.font = { bold: true, color: { argb: 'FFD6A84F' } };
    paymentHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF202020' } };
    for (const row of data.paymentRows) {
      const paymentRow = sheet.addRow([
        row.entry_date || '',
        row.work_type || row.description || '\u062a\u062d\u0635\u064a\u0644',
        row.collection_note || row.notes || '',
        Math.abs(numberOrZero(row.collection_amount)),
      ]);
      paymentRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFC00000' }, underline: true };
      });
    }
  }

  sheet.addRow([]);
  const addTotal = (label, amount, emphasis = false) => {
    const row = sheet.addRow([label, amount]);
    row.font = { bold: true, color: emphasis ? { argb: 'FF9A6B16' } : undefined };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: emphasis ? 'FFEFE3C6' : 'FFFBFAF6' } };
  };
  addTotal('الإجمالي', numberOrZero(data.totals?.gross_total || data.totals?.debit));
  for (const tax of data.tax_breakdown || []) addTotal(tax.label, numberOrZero(tax.amount));
  if (data.discount_label) addTotal(data.discount_label, numberOrZero(data.totals?.discount_amount));
  if (data.totals?.credit) addTotal('التحصيل', numberOrZero(data.totals.credit));
  addTotal('الصافي', numberOrZero(data.totals?.net_total), true);
  if (['invoice', 'taxInvoice', 'nonTaxInvoice'].includes(data.type)) {
    const wordsRow = sheet.addRow([arabicAmountWords(data.totals?.net_total)]);
    sheet.mergeCells(wordsRow.number, 1, wordsRow.number, totalCols);
    wordsRow.font = { bold: true };
    wordsRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F0E8' } };
  }

  if ((data.terms || []).length) {
    sheet.addRow([]);
    const termsTitle = sheet.addRow(['الشروط والأحكام']);
    sheet.mergeCells(termsTitle.number, 1, termsTitle.number, totalCols);
    termsTitle.font = { bold: true, color: { argb: 'FFD6A84F' } };
    termsTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF202020' } };
    for (const section of data.terms) {
      const sectionRow = sheet.addRow([section.title || '']);
      sectionRow.font = { bold: true, color: { argb: 'FF9A6B16' } };
      for (const line of section.lines || []) sheet.addRow([`- ${String(line).replace(/^\s*\*\*\s*/, '')}`]);
    }
  }

  sheet.eachRow((row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      cell.alignment = { vertical: 'middle', horizontal: rowNumber <= 7 ? 'center' : 'right', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD9CFB8' } },
        left: { style: 'thin', color: { argb: 'FFD9CFB8' } },
        bottom: { style: 'thin', color: { argb: 'FFD9CFB8' } },
        right: { style: 'thin', color: { argb: 'FFD9CFB8' } },
      };
      if (typeof cell.value === 'number') cell.numFmt = '#,##0.00';
    });
  });
  sheet.getColumn(1).alignment = { vertical: 'top', wrapText: true };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await workbook.xlsx.writeFile(outputPath);
}

function buildReportData(database, query, type) {
  if (type === 'statement') return accountStatementData(database, query, type);
  const { rows, document } = getReportRows(database, query, type);
  const summaryRows = groupedReport(database, type, query);
  const first = rows[0] || {};
  const rowDates = rows.map((row) => normalizeText(row.entry_date)).filter(Boolean).sort();
  const paymentQuery = type === 'contractor' && rowDates.length
    ? { ...query, payment_until_date: rowDates[rowDates.length - 1] }
    : query;
  const paymentRows = type === 'contractor' ? getReportPaymentRows(database, paymentQuery, type) : [];
  const dimensionUnit = query.dimension_unit === 'm' ? 'm' : 'cm';
  const totals = totalsForRows(rows, document);
  const contractorCertificateNo = type === 'contractor'
    ? contractorCertificateNumber(rows, query.certificate_no)
    : '';
  if (type === 'contractor' && paymentRows.length) {
    totals.credit = roundMoney(paymentRows.reduce((sum, row) => sum + Math.abs(numberOrZero(row.collection_amount)), 0));
    totals.collections = totals.credit;
    totals.net_total = roundMoney(numberOrZero(totals.net_total) - totals.credit);
  }
  return {
    title: documentTitle(type),
    type,
    filters: query,
    show_dimensions: hasReportDimensions(rows),
    dimension_unit: dimensionUnit,
    subtotal_mode: ['building', 'unit'].includes(query.subtotal_mode) ? query.subtotal_mode : 'none',
    prepared_by: query.user_name || 'Eng. Yasser',
    overall_work_type: overallWorkType(rows),
    party: document?.customer_name || first.customer_display_name || query.customer || '',
    project: document?.project || first.project || query.project || '',
    building_unit: document?.building_unit || first.building_unit || query.building_unit || '',
    operation_no: contractorCertificateNo || document?.operation_no || first.operation_no || query.operation_no || '',
    certificate_no: contractorCertificateNo,
    serial: document?.document_no || first.serial || query.serial || '',
    entry_date: document?.entry_date || first.entry_date || query.entry_date || '',
    generated_at: new Date().toISOString(),
    totals,
    tax_breakdown: taxBreakdown(rows),
    discount_label: discountLabel(document, totals),
    terms: termsForDocument(database, first, type, rows),
    summaryRows,
    rows,
    paymentRows,
  };
}

function formatCell(value) {
  return typeof value === 'number' ? money(value) : escapeHtml(value || '');
}

function summaryLabel(key) {
  return {
    customer: 'العميل', project: 'المشروع', building_unit: 'المبني/الوحدة', work_type: 'نوع الأعمال',
    rows: 'عدد القيود', area_m2: 'الأمتار المربعة', quantity: 'الكمية', average_rate: 'متوسط الفئة',
    gross_total: 'الإجمالي', vat_amount: 'ضريبة 14%', social_insurance_amount: 'تأمينات اجتماعية',
    stamp_amount: 'دمغة', works_insurance_amount: 'تأمين أعمال', final_insurance_amount: 'تأمين نهائي',
    contractor_tax_amount: 'ضريبة مقاولات', net_total: 'الصافي',
  }[key] || key;
}

function money(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(value || 0));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function xmlEscape(value) {
  return escapeHtml(value).replace(/'/g, '&apos;');
}

function safeFilePart(value) {
  return String(value || 'report')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'report';
}

function reportFileName(data, extension) {
  const workPart = data.overall_work_type ? `أعمال ${data.overall_work_type}` : '';
  const idPart = data.operation_no || data.serial || Date.now();
  const projectPart = [data.project, data.building_unit].filter(Boolean).join(' - ');
  const parts = [
    `${data.title} ${workPart}`.trim(),
    `رقم ${idPart}`,
    data.party,
    projectPart,
  ].filter(Boolean).map(safeFilePart);
  return `${parts.join(' _ ')}.${extension}`;
}

function safeOptionalFilePart(value) {
  const clean = String(value || '')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return clean || '';
}

function reportFileName(data, extension) {
  const workPart = data.overall_work_type ? `أعمال ${data.overall_work_type}` : '';
  const idPart = data.operation_no || data.serial || Date.now();
  const titlePart = [data.title, workPart].filter(Boolean).join(' ');
  const projectPart = [data.project, data.building_unit].filter(Boolean).join(' - ');
  const parts = [
    titlePart,
    `رقم ${idPart}`,
    data.party,
    projectPart,
  ].map(safeOptionalFilePart).filter(Boolean);
  return `${parts.join(' _ ')}.${extension}`;
}

function exportFolderName(type) {
  if (type === 'offer') return 'Price offers';
  if (['invoice', 'taxInvoice', 'nonTaxInvoice'].includes(type)) return 'Invoices';
  if (['contractor', 'runningCertificate', 'contractorStatement', 'contractorBoq'].includes(type)) return 'Certificates';
  if (['statement', 'taxStatement', 'nonTaxStatement', 'customerSummary'].includes(type)) return 'Account statement';
  return 'Other reports';
}

function reportsRootDir(fallbackDir) {
  const roots = ['D:\\', 'C:\\'].filter((drive) => {
    try {
      return fs.existsSync(drive);
    } catch {
      return false;
    }
  });
  const baseRoot = roots[0] || fallbackDir;
  return path.join(baseRoot, 'Price offers');
}

function reportOutputDir(type, fallbackDir) {
  const folder = exportFolderName(type);
  const candidates = [reportsRootDir(fallbackDir), path.join(fallbackDir, 'exports')];
  let lastError = null;
  for (const root of candidates) {
    const outputDir = path.join(root, folder);
    try {
      fs.mkdirSync(outputDir, { recursive: true });
      return outputDir;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Could not create export folder');
}

function writePdf(html, outputPath, data = {}) {
  const tmpDir = path.join(ROOT_DIR, 'data', 'exports', 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const htmlPath = path.join(tmpDir, `report_${Date.now()}.html`);
  fs.writeFileSync(htmlPath, html, 'utf8');
  return new Promise((resolve, reject) => {
    const script = path.join(ROOT_DIR, 'tools', 'print_pdf.cjs');
    const footerMeta = Buffer.from(JSON.stringify({
      date: reportDate(data.generated_at),
      companyAr: 'المجموعة الهندسية للتصميمات المعمارية',
      website: 'https://hgad-eg.com',
      preparedBy: data.prepared_by || 'Eng. Yasser',
    }), 'utf8').toString('base64url');
    const child = spawn(electronPath, [script, htmlPath, outputPath, footerMeta], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('exit', (code) => {
      fs.rmSync(htmlPath, { force: true });
      if (code === 0 && fs.existsSync(outputPath)) resolve(outputPath);
      else reject(new Error(stderr || `PDF renderer exited with code ${code}`));
    });
  });
}

function tempReportPath(dataDir, data, extension) {
  const tmpDir = path.join(dataDir, 'exports', 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const safeName = reportFileName(data, extension);
  return path.join(tmpDir, `${Date.now()}_${safeName}`);
}

function downloadAndCleanup(res, filePath, fileName) {
  res.download(filePath, fileName, () => {
    fs.rmSync(filePath, { force: true });
  });
}

async function createServer(options = {}) {
  const dataDir = options.dataDir || getDataDir();
  const dbPath = options.dbPath || path.join(dataDir, 'price_offer.db');
  seedDatabaseIfNeeded(dbPath);
  const database = new AppDatabase(dbPath, path.join(ROOT_DIR, 'server', 'schema.sql'));
  await database.open();
  ensureRuntimeMigrations(database);
  recalculateAllItems(database);
  ensureRichTerms(database);
  ensureDefaultUsers(database);

  const app = express();
  app.use(cors({ exposedHeaders: ['Content-Disposition'] }));
  app.use(express.json({ limit: '4mb' }));

  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      app: 'Accounting Management',
      version: APP_VERSION,
      dataDir,
      dbPath,
      lanIps: getLanIps(),
      port: options.port || DEFAULT_PORT,
    });
  });

  app.get('/api/update/latest', async (req, res) => {
    const platform = req.query.platform || '';
    const repo = process.env.AM_UPDATE_REPOSITORY || UPDATE_REPOSITORY;
    const apiUrl = `https://api.github.com/repos/${repo}/releases/latest`;
    try {
      const response = await fetch(apiUrl, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `Accounting-Management/${APP_VERSION}`,
        },
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        return res.status(response.status).json({
          error: `تعذر فحص التحديثات من GitHub (${response.status})`,
          details: body.slice(0, 240),
          currentVersion: APP_VERSION,
          updateAvailable: false,
        });
      }
      const release = await response.json();
      const latestVersion = String(release.tag_name || release.name || '').replace(/^v/i, '') || APP_VERSION;
      const asset = chooseReleaseAsset(release, platform);
      res.json({
        currentVersion: APP_VERSION,
        latestVersion,
        updateAvailable: compareVersions(latestVersion, APP_VERSION) > 0,
        releaseName: release.name || release.tag_name || '',
        releaseUrl: release.html_url || `https://github.com/${repo}/releases/latest`,
        downloadUrl: asset?.browser_download_url || release.html_url || `https://github.com/${repo}/releases/latest`,
        assetName: asset?.name || '',
        publishedAt: release.published_at || '',
        repository: repo,
      });
    } catch (error) {
      res.status(502).json({
        error: `تعذر فحص التحديثات: ${error.message}`,
        currentVersion: APP_VERSION,
        updateAvailable: false,
      });
    }
  });

  app.get('/api/bootstrap', (req, res) => {
    const summary = database.get(`
      SELECT COUNT(*) AS rows, COUNT(DISTINCT document_id) AS documents, COUNT(DISTINCT party_id) AS customers,
             ROUND(SUM(CASE WHEN accounting_status = ? THEN net_total ELSE 0 END), 2) AS offers_total,
             ROUND(SUM(CASE WHEN accounting_status = ? THEN net_total ELSE 0 END), 2) AS invoices_total,
             ROUND(SUM(CASE WHEN accounting_status = ? THEN net_total ELSE 0 END), 2) AS contractor_total,
             ROUND(SUM(net_total), 2) AS net_total
      FROM active_work_items`, [STATUS.OFFER, STATUS.INVOICE, STATUS.CONTRACTOR]);
    const docs = database.all(`
      SELECT d.document_type, d.status, COUNT(*) AS count
      FROM documents d WHERE d.deleted_at IS NULL
      GROUP BY d.document_type, d.status ORDER BY d.document_type, d.status`);
    const byStatus = database.all(`
      SELECT accounting_status AS status, COUNT(*) AS rows, ROUND(SUM(net_total), 2) AS total
      FROM active_work_items
      GROUP BY accounting_status
      ORDER BY rows DESC`);
    res.json({ summary, docs, byStatus, dataDir, dbPath, lanIps: getLanIps(), port: options.port || DEFAULT_PORT });
  });

  app.get('/api/lookups', (req, res) => {
    const lookup = (column, limit = 300) => database.all(
      `SELECT ${column} AS value, COUNT(*) AS count FROM active_work_items
       WHERE ${column} IS NOT NULL AND ${column} <> ''
       GROUP BY ${column} ORDER BY count DESC, value ASC LIMIT ?`, [limit]);
    res.json({
      customers: database.all('SELECT * FROM parties WHERE role = ? ORDER BY display_name LIMIT 500', ['customer']),
      contractors: database.all('SELECT * FROM parties WHERE role = ? ORDER BY display_name LIMIT 500', ['contractor']),
      projects: lookup('project'),
      statuses: [{ value: STATUS.OFFER }, { value: STATUS.INVOICE }, { value: STATUS.CONTRACTOR }],
      workTypes: lookup('work_type'),
      buildingUnits: lookup('building_unit'),
      floorApartments: lookup('floor_apartment'),
      descriptions: lookup('description', 500),
      glassSpecs: lookup('glass_spec', 500),
      profileSpecs: lookup('profile_spec', 500),
      colors: lookup('color', 500),
      rates: lookup('rate', 500),
      units: [{ value: 'sqm', label: '\u0645\u00b2' }, { value: 'lm', label: '\u0645.\u0637' }, { value: 'count', label: '\u0639\u062f\u062f' }],
    });
  });

  app.post('/api/auth/login', (req, res) => {
    const username = normalizeText(req.body.username || req.body.name);
    const password = String(req.body.password || '');
    if (!username || !password) return res.status(400).json({ error: 'Name and password are required' });
    const user = database.get(
      `SELECT * FROM users
       WHERE is_active = 1
         AND (LOWER(username) = LOWER(?) OR LOWER(display_name) = LOWER(?))
       LIMIT 1`,
      [username, username],
    );
    if (!user || user.pin_hash !== hashPassword(password)) return res.status(403).json({ error: 'Wrong name or password' });
    database.run('UPDATE users SET last_login_at = CURRENT_TIMESTAMP, last_seen_at = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
    const fresh = database.get('SELECT *, 1 AS is_online FROM users WHERE id = ?', [user.id]);
    res.json({ user: publicUser(fresh) });
  });

  app.get('/api/users', (req, res) => {
    res.json(database.all(`
      SELECT id, username, display_name, role, can_create_invoices, can_create_payments, can_change_status,
             is_active, last_login_at, last_seen_at, created_at,
             CASE WHEN last_seen_at IS NOT NULL AND last_seen_at >= datetime('now', '-2 minutes') THEN 1 ELSE 0 END AS is_online
      FROM users
      ORDER BY is_online DESC, role = 'admin' DESC, display_name COLLATE NOCASE
    `).map(publicUser));
  });

  app.post('/api/users/:id/presence', (req, res) => {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'User id is required' });
    database.run('UPDATE users SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ? AND is_active = 1', [id]);
    res.json({ ok: true });
  });

  app.post('/api/users', (req, res) => {
    const username = normalizeText(req.body.username);
    const displayName = normalizeText(req.body.display_name || req.body.username);
    const password = String(req.body.password || '');
    const role = req.body.role === 'admin' ? 'admin' : 'user';
    if (!username || !displayName || !password) return res.status(400).json({ error: 'User name, display name and password are required' });
    try {
      const result = database.run(
        'INSERT INTO users (username, display_name, role, pin_hash, can_create_invoices, can_create_payments, can_change_status, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
        [
          username,
          displayName,
          role,
          hashPassword(password),
          role === 'admin' ? 1 : normalizeBool(req.body.can_create_invoices),
          role === 'admin' ? 1 : normalizeBool(req.body.can_create_payments),
          role === 'admin' ? 1 : normalizeBool(req.body.can_change_status),
        ],
      );
      res.status(201).json(publicUser(database.get('SELECT * FROM users WHERE id = ?', [result.lastInsertRowid])));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.put('/api/users/:id', (req, res) => {
    const id = Number(req.params.id);
    const existing = database.get('SELECT * FROM users WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'User not found' });
    const allowed = ['username', 'display_name', 'role', 'is_active', 'can_create_invoices', 'can_create_payments', 'can_change_status'];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        sets.push(`${key} = ?`);
        params.push(['is_active', 'can_create_invoices', 'can_create_payments', 'can_change_status'].includes(key) ? normalizeBool(req.body[key]) : req.body[key]);
      }
    }
    if (req.body.password) {
      sets.push('pin_hash = ?');
      params.push(hashPassword(req.body.password));
    }
    if (!sets.length) return res.status(400).json({ error: 'No changes' });
    params.push(id);
    database.run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
    res.json(publicUser(database.get('SELECT * FROM users WHERE id = ?', [id])));
  });

  app.put('/api/users/:id/password', (req, res) => {
    const id = Number(req.params.id);
    const existing = database.get('SELECT * FROM users WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'User not found' });
    const newPassword = String(req.body.new_password || req.body.password || '');
    if (!newPassword) return res.status(400).json({ error: 'New password is required' });
    if (existing.role !== 'admin' && req.body.current_password && existing.pin_hash !== hashPassword(req.body.current_password)) {
      return res.status(403).json({ error: 'Current password is wrong' });
    }
    database.run('UPDATE users SET pin_hash = ? WHERE id = ?', [hashPassword(newPassword), id]);
    res.json({ ok: true });
  });

  app.delete('/api/users/:id', (req, res) => {
    const id = Number(req.params.id);
    const existing = database.get('SELECT * FROM users WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'User not found' });
    const activeAdmins = database.get("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND is_active = 1")?.count || 0;
    if (existing.role === 'admin' && activeAdmins <= 1) return res.status(400).json({ error: 'Cannot delete the last active admin' });
    database.run('UPDATE users SET is_active = 0 WHERE id = ?', [id]);
    res.json({ ok: true });
  });

  app.get('/api/parties', (req, res) => {
    const role = req.query.role || 'customer';
    const partyClauses = ['role = ?'];
    const partyParams = [role];
    const joinedClauses = ['p.role = ?'];
    const joinedParams = [role];
    const rawQ = normalizeText(req.query.q);
    const q = sqlLikeNormalized(rawQ);
    if (q) {
      const compactQ = rawQ.replace(/^0+(?=\d)/, '');
      partyClauses.push('(search_name LIKE ? OR display_name LIKE ? OR CAST(id AS TEXT) LIKE ?)');
      partyParams.push(q, `%${rawQ}%`, `%${compactQ || rawQ}%`);
      joinedClauses.push('(p.search_name LIKE ? OR p.display_name LIKE ? OR CAST(p.id AS TEXT) LIKE ? OR d.operation_no LIKE ? OR CAST(d.document_no AS TEXT) LIKE ? OR CAST(d.id AS TEXT) LIKE ?)');
      joinedParams.push(q, `%${rawQ}%`, `%${compactQ || rawQ}%`, `%${rawQ}%`, `%${compactQ || rawQ}%`, `%${compactQ || rawQ}%`);
    }
    if (req.query.document_type || req.query.document_status || (rawQ && /^\d+/.test(rawQ))) {
      const docClauses = [];
      if (req.query.document_type) {
        docClauses.push('d.document_type = ?');
        joinedParams.push(req.query.document_type);
        if (req.query.document_type === 'payment') {
          docClauses.push(`EXISTS (
            SELECT 1 FROM work_items wi
            WHERE wi.document_id = d.id AND wi.deleted_at IS NULL
              AND ABS(COALESCE(wi.collection_amount, 0)) > 0
          )`);
        } else if (['price_offer', 'invoice', 'contractor_certificate'].includes(req.query.document_type)) {
          docClauses.push(`EXISTS (
            SELECT 1 FROM work_items wi
            WHERE wi.document_id = d.id AND wi.deleted_at IS NULL
              AND COALESCE(wi.collection_amount, 0) = 0
          )`);
        }
      }
      if (req.query.document_status) {
        docClauses.push('d.status = ?');
        joinedParams.push(req.query.document_status);
      }
      const documentFilter = docClauses.length ? ` AND ${docClauses.join(' AND ')}` : '';
      return res.json(database.all(
        `SELECT DISTINCT p.* FROM parties p
         JOIN documents d ON d.party_id = p.id
         WHERE ${joinedClauses.join(' AND ')}${documentFilter}
         ORDER BY p.display_name LIMIT 500`,
        joinedParams,
      ));
    }
    res.json(database.all(`SELECT * FROM parties WHERE ${partyClauses.join(' AND ')} ORDER BY display_name LIMIT 500`, partyParams));
  });

  app.get('/api/party-related', (req, res) => {
    const role = req.query.role || 'customer';
    const name = normalizeText(req.query.name);
    if (!name) return res.json({ projects: [], buildings: [], rows: [] });
    const clauses = ['wi.party_role = ?'];
    const params = [role];
    const searchName = normalizeArabic(name);
    clauses.push('(wi.search_party_name = ? OR wi.search_party_name LIKE ? OR wi.customer_display_name LIKE ? OR wi.customer_name LIKE ?)');
    params.push(searchName, `%${searchName}%`, `%${name}%`, `%${name}%`);
    if (req.query.category) {
      clauses.push('wi.party_category = ?');
      params.push(req.query.category);
    }
    const rows = database.all(
      `SELECT wi.customer_display_name, wi.customer_name, wi.project, wi.building_unit, COUNT(*) AS count
       FROM active_work_items wi
       WHERE ${clauses.join(' AND ')}
       GROUP BY wi.customer_display_name, wi.customer_name, wi.project, wi.building_unit
       ORDER BY count DESC, wi.project, wi.building_unit
       LIMIT 500`,
      params,
    );
    const projectFilter = normalizeText(req.query.project);
    const filteredRows = projectFilter ? rows.filter((row) => row.project === projectFilter) : rows;
    res.json({
      projects: uniqueStrings(rows.map((row) => row.project)),
      buildings: uniqueStrings(filteredRows.map((row) => row.building_unit)),
      rows,
    });
  });

  app.get('/api/customer-overview', (req, res) => {
    const id = Number(req.query.party_id || 0);
    const name = normalizeText(req.query.name);
    let party = null;
    if (id) party = database.get('SELECT * FROM parties WHERE id = ? AND role = ?', [id, 'customer']);
    if (!party && name) {
      const search = normalizeArabic(name);
      party = database.get(
        'SELECT * FROM parties WHERE role = ? AND (search_name = ? OR search_name LIKE ? OR display_name LIKE ?) ORDER BY id LIMIT 1',
        ['customer', search, `%${search}%`, `%${name}%`],
      );
    }
    if (!party) return res.json({ party: null, projects: [], priceOffers: [], invoices: [], payments: [], statements: [] });

    const docs = database.all(
      `SELECT d.id, d.document_type, d.status, d.document_no, d.operation_no, d.entry_date,
              d.project, d.building_unit, d.title,
              ROUND(SUM(CASE WHEN COALESCE(wi.collection_amount, 0) = 0 THEN wi.gross_total ELSE 0 END), 2) AS gross_total,
              ROUND(SUM(CASE WHEN COALESCE(wi.collection_amount, 0) = 0 THEN wi.net_total ELSE 0 END), 2) AS net_total,
              ROUND(SUM(CASE WHEN COALESCE(wi.collection_amount, 0) <> 0 THEN ABS(wi.collection_amount) ELSE 0 END), 2) AS paid_total,
              COUNT(wi.id) AS rows_count
       FROM documents d
       LEFT JOIN work_items wi ON wi.document_id = d.id AND wi.deleted_at IS NULL
       WHERE d.deleted_at IS NULL AND d.party_id = ?
       GROUP BY d.id
       ORDER BY COALESCE(d.entry_date, '') DESC, d.document_no DESC`,
      [party.id],
    );
    const payments = docs.filter((doc) => doc.document_type === 'payment' && doc.status === 'approved');
    const priceOffers = docs.filter((doc) => doc.document_type === 'price_offer' && doc.status !== 'approved');
    const invoices = docs.filter((doc) => doc.status === 'approved' && (doc.document_type === 'invoice' || doc.document_type === 'price_offer'));
    const statementDocs = docs.filter((doc) => doc.status === 'approved' && (
      doc.document_type === 'invoice'
      || doc.document_type === 'payment'
    ));
    const projectNames = uniqueStrings(docs.map((doc) => doc.project));
    const statementProjectNames = uniqueStrings(statementDocs.map((doc) => doc.project));
    const projects = projectNames.map((project) => {
      const projectDocs = docs.filter((doc) => (doc.project || '') === project);
      return {
        name: project,
        documents: projectDocs,
        buildings: uniqueStrings(projectDocs.map((doc) => doc.building_unit)),
        total: roundMoney(projectDocs.reduce((sum, doc) => sum + numberOrZero(doc.net_total), 0)),
        paid: roundMoney(projectDocs.reduce((sum, doc) => sum + numberOrZero(doc.paid_total), 0)),
      };
    });
    res.json({
      party,
      projects,
      priceOffers,
      invoices,
      payments,
      statements: statementProjectNames.map((project) => {
        const projectDocs = statementDocs.filter((doc) => (doc.project || '') === project);
        return {
          project,
          debit: roundMoney(projectDocs.reduce((sum, doc) => sum + numberOrZero(doc.net_total), 0)),
          credit: roundMoney(projectDocs.reduce((sum, doc) => sum + numberOrZero(doc.paid_total), 0)),
          balance: roundMoney(projectDocs.reduce((sum, doc) => sum + numberOrZero(doc.net_total) - numberOrZero(doc.paid_total), 0)),
          documents_count: projectDocs.length,
        };
      }).filter((row) => row.debit || row.credit || row.balance),
    });
  });

  app.get('/api/documents', (req, res) => {
    const clauses = ['d.deleted_at IS NULL'];
    const params = [];
    const requestedType = normalizeText(req.query.type);
    if (requestedType) {
      clauses.push('d.document_type = ?');
      params.push(requestedType);
      if (requestedType === 'payment') {
        clauses.push(`EXISTS (
          SELECT 1 FROM work_items wi
          WHERE wi.document_id = d.id AND wi.deleted_at IS NULL
            AND ABS(COALESCE(wi.collection_amount, 0)) > 0
        )`);
      } else if (['price_offer', 'invoice', 'contractor_certificate'].includes(requestedType)) {
        clauses.push(`EXISTS (
          SELECT 1 FROM work_items wi
          WHERE wi.document_id = d.id AND wi.deleted_at IS NULL
            AND COALESCE(wi.collection_amount, 0) = 0
        )`);
      }
    }
    if (req.query.status) { clauses.push('d.status = ?'); params.push(req.query.status); }
    if (req.query.party_id) { clauses.push('d.party_id = ?'); params.push(Number(req.query.party_id)); }
    const rawQ = normalizeText(req.query.q);
    const q = sqlLikeNormalized(rawQ);
    if (q) {
      const compactQ = rawQ.replace(/^0+(?=\d)/, '');
      clauses.push('(d.search_party_name LIKE ? OR d.customer_name LIKE ? OR d.project LIKE ? OR d.building_unit LIKE ? OR d.operation_no LIKE ? OR CAST(d.document_no AS TEXT) LIKE ? OR CAST(d.id AS TEXT) LIKE ?)');
      params.push(q, `%${rawQ}%`, `%${rawQ}%`, `%${rawQ}%`, `%${rawQ}%`, `%${compactQ || rawQ}%`, `%${compactQ || rawQ}%`);
    }
    const rows = database.all(
      `SELECT d.*, p.display_name, p.base_name FROM documents d
       LEFT JOIN parties p ON p.id = d.party_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY d.document_no DESC LIMIT 500`, params);
    res.json(rows);
  });

  app.get('/api/next-document-no', (req, res) => {
    const type = req.query.type || 'price_offer';
    const nextNo = nextDocumentNo(database, type);
    res.json({ type, next_no: nextNo, operation_no: formatOperationNo(nextNo) });
  });

  app.put('/api/documents/:id', (req, res) => {
    const allowed = ['status', 'project', 'building_unit', 'title', 'discount_type', 'discount_value', 'notes'];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        sets.push(`${key} = ?`);
        params.push(req.body[key]);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'No changes' });
    params.push(Number(req.params.id));
    database.run(`UPDATE documents SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, params);
    res.json(database.get('SELECT * FROM documents WHERE id = ?', [Number(req.params.id)]));
  });

  app.get('/api/payment-customers', (req, res) => {
    const clauses = [
      'wi.deleted_at IS NULL',
      'd.deleted_at IS NULL',
      'ABS(COALESCE(wi.collection_amount, 0)) > 0',
      "d.status = 'approved'",
    ];
    const params = [];
    const q = normalizeText(req.query.q);
    const search = sqlLikeNormalized(q);
    if (search) {
      clauses.push('(p.search_name LIKE ? OR wi.search_party_name LIKE ? OR p.display_name LIKE ? OR wi.customer_display_name LIKE ? OR wi.customer_name LIKE ?)');
      params.push(search, search, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    const rows = database.all(
      `SELECT COALESCE(p.id, d.party_id, 0) AS id,
              COALESCE(NULLIF(p.display_name, ''), NULLIF(wi.customer_display_name, ''), NULLIF(wi.customer_name, '')) AS display_name,
              COALESCE(NULLIF(p.base_name, ''), NULLIF(wi.customer_name, ''), NULLIF(wi.customer_display_name, '')) AS base_name,
              COALESCE(NULLIF(p.category, ''), NULLIF(wi.party_category, ''), 'unselected') AS category,
              COUNT(DISTINCT d.id) AS payments_count,
              ROUND(SUM(ABS(COALESCE(wi.collection_amount, 0))), 2) AS paid_total
       FROM work_items wi
       JOIN documents d ON d.id = wi.document_id
       LEFT JOIN parties p ON p.id = d.party_id
       WHERE ${clauses.join(' AND ')}
       GROUP BY 1, 2, 3, 4
       HAVING display_name IS NOT NULL AND display_name <> ''
       ORDER BY payments_count DESC, display_name
       LIMIT 500`,
      params,
    );
    res.json(rows);
  });

  app.get('/api/payments', (req, res) => {
    const limit = Math.min(Number(req.query.limit || 100), 2000);
    const clauses = ['wi.deleted_at IS NULL', 'd.deleted_at IS NULL', 'ABS(COALESCE(wi.collection_amount, 0)) > 0'];
    const params = [];
    if (req.query.party_id) {
      clauses.push('d.party_id = ?');
      params.push(Number(req.query.party_id));
    }
    if (req.query.customer) {
      const q = normalizeText(req.query.customer);
      const search = sqlLikeNormalized(q);
      clauses.push('(p.search_name LIKE ? OR wi.search_party_name LIKE ? OR p.display_name LIKE ? OR wi.customer_display_name LIKE ? OR wi.customer_name LIKE ?)');
      params.push(search, search, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (req.query.project) {
      clauses.push('wi.project = ?');
      params.push(req.query.project);
    }
    const rows = database.all(
      `SELECT wi.*, d.operation_no AS document_operation_no,
              p.display_name AS party_display_name,
              p.base_name AS base_party_name
       FROM work_items wi
       JOIN documents d ON d.id = wi.document_id
       LEFT JOIN parties p ON p.id = d.party_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY COALESCE(wi.entry_date, '' ) DESC, wi.id DESC
       LIMIT ?`,
      [...params, limit],
    );
    res.json({ rows });
  });

  app.post('/api/payments', (req, res) => {
    const amount = numberOrZero(req.body.amount || req.body.collection_amount);
    if (amount <= 0) return res.status(400).json({ error: 'Payment amount must be greater than zero' });
    const paymentBody = {
      ...req.body,
      party_role: 'customer',
      document_type: 'payment',
      document_status: 'approved',
      accounting_status: 'تحصيل',
      unit_code: 'count',
      item_count: 0,
      total_quantity: 0,
      rate: 0,
      work_type: normalizeText(req.body.work_type) || 'تحصيل',
      description: normalizeText(req.body.description) || 'تحصيل',
      collection_note: normalizeText(req.body.note || req.body.collection_note) || 'تحصيل',
      collection_amount: amount,
    };
    const entry = normalizeInput(database, paymentBody);
    const columns = ENTRY_COLUMNS.filter((column) => Object.prototype.hasOwnProperty.call(entry, column));
    const result = database.run(`INSERT INTO work_items (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`, columns.map((column) => entry[column]));
    const saved = database.get('SELECT * FROM work_items WHERE id = ?', [result.lastInsertRowid]);
    syncPaymentDocumentFromEntry(database, saved);
    res.status(201).json(saved);
  });

  app.get('/api/entries', (req, res) => {
    const limit = Math.min(Number(req.query.limit || 100), 500);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    const { where, params } = whereFromQuery(req.query);
    const rows = database.all(`SELECT wi.* FROM work_items wi WHERE ${where} ORDER BY wi.serial DESC, wi.id LIMIT ? OFFSET ?`, [...params, limit, offset]);
    const total = database.get(`SELECT COUNT(*) AS count FROM work_items wi WHERE ${where}`, params);
    res.json({ rows, total: total.count, limit, offset });
  });

  app.post('/api/entries', (req, res) => {
    const entry = normalizeInput(database, req.body);
    const columns = ENTRY_COLUMNS.filter((column) => Object.prototype.hasOwnProperty.call(entry, column));
    const result = database.run(`INSERT INTO work_items (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`, columns.map((column) => entry[column]));
    res.status(201).json(database.get('SELECT * FROM work_items WHERE id = ?', [result.lastInsertRowid]));
  });

  app.put('/api/entries/:id', (req, res) => {
    const existing = database.get('SELECT * FROM work_items WHERE id = ? AND deleted_at IS NULL', [Number(req.params.id)]);
    if (!existing) return res.status(404).json({ error: 'Entry not found' });
    const entry = normalizeInput(database, req.body, existing);
    const columns = ENTRY_COLUMNS.filter((column) => column !== 'created_by' && Object.prototype.hasOwnProperty.call(entry, column));
    database.run(`UPDATE work_items SET ${columns.map((column) => `${column} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [...columns.map((column) => entry[column]), Number(req.params.id)]);
    const saved = database.get('SELECT * FROM work_items WHERE id = ?', [Number(req.params.id)]);
    syncPaymentDocumentFromEntry(database, saved);
    res.json(saved);
  });

  app.delete('/api/entries/:id', (req, res) => {
    database.run('UPDATE work_items SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?', [Number(req.params.id)]);
    res.json({ ok: true });
  });

  app.get('/api/settings/terms', (req, res) => {
    const rows = database.all("SELECT key, value FROM app_settings WHERE key IN ('terms_retail', 'terms_corporate')");
    res.json(Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.value)])));
  });

  app.put('/api/settings/terms/:key', (req, res) => {
    if (req.body.password !== adminPassword(database)) return res.status(403).json({ error: 'Wrong password' });
    const key = req.params.key === 'corporate' ? 'terms_corporate' : 'terms_retail';
    database.run('INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)', [key, JSON.stringify(req.body.value || { sections: [] })]);
    res.json({ ok: true });
  });

  app.post('/api/admin/start-hosting', (req, res) => {
    if (req.body.password !== adminPassword(database)) return res.status(403).json({ error: 'Wrong password' });
    const port = options.port || DEFAULT_PORT;
    const lanIps = getLanIps();
    res.json({
      ok: true,
      hosting: true,
      message: 'Server is running. Keep this PC awake and this server process open.',
      localUrl: `http://127.0.0.1:${port}`,
      lanUrls: lanIps.map((ip) => `http://${ip}:${port}`),
      dataDir,
      dbPath,
      needsInternetSetup: 'For access from outside the local network, configure router port forwarding or a secure tunnel to this same port.',
    });
  });

  app.get('/api/documents/:type', (req, res) => {
    const type = req.params.type.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    res.json(buildReportData(database, req.query, type));
  });

  app.get('/api/documents/:type/html', (req, res) => {
    const type = req.params.type.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const data = buildReportData(database, req.query, type);
    res.type('html').send(renderReportHtmlV2(data));
  });

  async function sendXlsxReport(req, res) {
    try {
      const type = req.params.type.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      const data = buildReportData(database, req.query, type);
      const fileName = reportFileName(data, 'xlsx');
      const outputPath = tempReportPath(dataDir, data, 'xlsx');
      await writeCleanXlsx(data, outputPath);
      downloadAndCleanup(res, outputPath, fileName);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  function sendSpreadsheetReport(req, res) {
    const type = req.params.type.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const data = buildReportData(database, req.query, type);
    const fileName = reportFileName(data, 'xml');
    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.send(renderReportXmlV2(data));
  }

  app.get('/api/documents/:type/xlsx', sendXlsxReport);
  app.get('/api/documents/:type/xml', sendSpreadsheetReport);
  app.get('/api/documents/:type/xlm', sendSpreadsheetReport);

  app.get('/api/documents/:type/pdf', async (req, res) => {
    try {
      const type = req.params.type.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      const data = buildReportData(database, req.query, type);
      const fileName = reportFileName(data, 'pdf');
      const outputPath = tempReportPath(dataDir, data, 'pdf');
      await writePdf(renderReportHtmlV2(data), outputPath, data);
      downloadAndCleanup(res, outputPath, fileName);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/documents/:type/export', async (req, res) => {
    try {
      const type = req.params.type.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      const format = req.body.format === 'pdf' ? 'pdf' : (req.body.format === 'xml' ? 'xml' : 'xlsx');
      const query = req.body.query || {};
      const data = buildReportData(database, query, type);
      const exportsDir = reportOutputDir(type, dataDir);
      const outputPath = path.join(exportsDir, reportFileName(data, format));
      if (format === 'pdf') {
        await writePdf(renderReportHtmlV2(data), outputPath, data);
      } else if (format === 'xlsx') {
        await writeCleanXlsx(data, outputPath);
      } else {
        fs.writeFileSync(outputPath, renderReportXmlV2(data), 'utf8');
      }
      res.json({
        ok: true,
        format,
        savedPath: outputPath,
        fileName: path.basename(outputPath),
        bytes: fs.statSync(outputPath).size,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/backup', (req, res) => {
    const backupPath = database.backup(path.join(dataDir, 'backups'));
    res.json({ ok: true, backupPath });
  });

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  app.use('/api', (error, req, res, next) => {
    console.error(error);
    if (res.headersSent) return next(error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  });

  const distDir = path.join(ROOT_DIR, 'dist');
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get(/.*/, (req, res) => res.sendFile(path.join(distDir, 'index.html')));
  }

  return {
    app, database, dataDir, dbPath,
    listen(port = DEFAULT_PORT, host = '0.0.0.0') {
      return new Promise((resolve) => {
        const server = app.listen(port, host, () => resolve(server));
      });
    },
  };
}

if (require.main === module) {
  createServer({ port: DEFAULT_PORT }).then((server) => {
    server.listen(DEFAULT_PORT).then(() => {
      console.log(`Accounting Management server: http://127.0.0.1:${DEFAULT_PORT}`);
      console.log(`Database: ${server.dbPath}`);
      for (const ip of getLanIps()) console.log(`LAN: http://${ip}:${DEFAULT_PORT}`);
    });
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { createServer, getDataDir, getLanIps };
