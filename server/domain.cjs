const { composeStatementText, normalizeMeasurementMode, normalizeUnitCode } = require('./calculations.cjs');

const STATUS = {
  OFFER: '\u0639\u0631\u0636 \u0633\u0639\u0631',
  INVOICE: '\u0641\u0627\u062a\u0648\u0631\u0629',
  CONTRACTOR: '\u0645\u0633\u062a\u062e\u0644\u0635 \u0645\u0642\u0627\u0648\u0644',
};

const UNIT_LABELS = {
  sqm: '\u0645\u00b2',
  lm: '\u0645.\u0637',
  count: '\u0639\u062f\u062f',
};

function normalizeArabic(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\u064b-\u065f\u0670]/g, '')
    .replace(/[\u0623\u0625\u0622]/g, '\u0627')
    .replace(/\u0649/g, '\u064a')
    .replace(/\u0629/g, '\u0647')
    .replace(/\u0640/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripPartyPrefix(value) {
  let text = String(value || '').trim();
  const prefixes = [
    /^\u0634\u0631\u0643\u0629\s+/,
    /^\u0634\u0631\u0643\u0647\s+/,
    /^\u0645\.\s*/,
    /^\u0645\u0647\u0646\u062f\u0633\s+/,
    /^\u062f\.\s*/,
    /^\u062f\u0643\u062a\u0648\u0631\s+/,
    /^\u0627\.\s*/,
    /^\u0623\.\s*/,
  ];
  for (const prefix of prefixes) text = text.replace(prefix, '');
  return text.trim();
}

function inferPartyRole(row = {}) {
  if (row.party_role) return row.party_role;
  if (row.accounting_status === STATUS.CONTRACTOR || String(row.party_type || '').includes('\u0645\u0642\u0627\u0648\u0644')) return 'contractor';
  return 'customer';
}

function inferPartyCategory(row = {}) {
  if (row.party_category) return row.party_category;
  const text = `${row.party_type || ''} ${row.customer_name || ''} ${row.customer_display_name || ''}`;
  if (text.includes('\u0634\u0631\u0643')) return 'corporate';
  if (text.includes('\u0645\u0642\u0627\u0648\u0644')) return 'corporate';
  return 'retail';
}

function displayPartyName(baseName, category) {
  const base = stripPartyPrefix(baseName);
  if (!base) return '';
  if (category === 'unselected') return base;
  if (category === 'corporate') return `\u0634\u0631\u0643\u0629 ${base}`;
  return `\u0645. ${base}`;
}

function partyFromInput(input = {}) {
  const role = input.party_role || inferPartyRole(input);
  const category = input.party_category || inferPartyCategory(input);
  const baseName = stripPartyPrefix(input.base_party_name || input.customer_name || input.customer_display_name);
  const displayName = input.customer_display_name || displayPartyName(baseName, category) || baseName;
  const searchName = normalizeArabic(baseName || displayName);
  return { role, category, baseName, displayName, searchName };
}

function documentTypeForStatus(status) {
  if (status === STATUS.OFFER) return 'price_offer';
  if (status === STATUS.INVOICE) return 'invoice';
  if (status === STATUS.CONTRACTOR) return 'contractor_certificate';
  return 'ledger';
}

function statusForDocumentType(type) {
  if (['price_offer', 'offer'].includes(type)) return STATUS.OFFER;
  if (['invoice', 'tax_invoice', 'non_tax_invoice'].includes(type)) return STATUS.INVOICE;
  if (['contractor', 'contractor_certificate'].includes(type)) return STATUS.CONTRACTOR;
  return null;
}

function unitLabel(unitCode) {
  return UNIT_LABELS[normalizeUnitCode(unitCode)] || UNIT_LABELS.sqm;
}

function ensureRuntimeMigrations(database) {
  const cols = database.all('PRAGMA table_info(work_items)').map((row) => row.name);
  const addColumn = (name, ddl) => {
    if (!cols.includes(name)) database.exec(`ALTER TABLE work_items ADD COLUMN ${name} ${ddl}`);
  };
  const userCols = database.all('PRAGMA table_info(users)').map((row) => row.name);
  const addUserColumn = (name, ddl) => {
    if (!userCols.includes(name)) database.exec(`ALTER TABLE users ADD COLUMN ${name} ${ddl}`);
  };
  addUserColumn('can_create_invoices', 'INTEGER NOT NULL DEFAULT 0');
  addUserColumn('can_create_payments', 'INTEGER NOT NULL DEFAULT 0');
  addUserColumn('can_change_status', 'INTEGER NOT NULL DEFAULT 0');
  addUserColumn('last_login_at', 'TEXT');
  addUserColumn('last_seen_at', 'TEXT');

  addColumn('measurement_mode', "TEXT DEFAULT 'standard'");
  addColumn('unit_code', "TEXT DEFAULT 'sqm'");
  addColumn('party_id', 'INTEGER');
  addColumn('document_id', 'INTEGER');
  addColumn('party_role', "TEXT DEFAULT 'customer'");
  addColumn('party_category', 'TEXT');
  addColumn('source_customer_id', 'INTEGER');
  addColumn('source_customer_name', 'TEXT');
  addColumn('base_party_name', 'TEXT');
  addColumn('search_party_name', 'TEXT');
  addColumn('statement_text', 'TEXT');
  addColumn('document_status', "TEXT DEFAULT 'draft'");

  database.exec('CREATE INDEX IF NOT EXISTS idx_work_items_party ON work_items(party_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_work_items_document ON work_items(document_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_work_items_search_party ON work_items(search_party_name)');

  const needsPopulate = database.get(`
    SELECT COUNT(*) AS count
    FROM work_items
    WHERE deleted_at IS NULL
      AND (
        search_party_name IS NULL
        OR statement_text IS NULL
        OR unit_code IS NULL
        OR party_id IS NULL
        OR document_id IS NULL
      )
  `).count;
  if (!needsPopulate) return;

  const rows = database.all(`
    SELECT id, serial, operation_no, calculation_method, customer_name, customer_display_name,
           party_type, accounting_status, project, building_unit, entry_date, description,
           glass_spec, profile_spec, color, unit, certificate_no
    FROM work_items
    WHERE deleted_at IS NULL
  `);

  database.db.exec('BEGIN TRANSACTION');
  const partyStmt = database.db.prepare(`
    INSERT OR IGNORE INTO parties (role, category, base_name, display_name, search_name)
    VALUES (?, ?, ?, ?, ?)
  `);
  const docStmt = database.db.prepare(`
    INSERT OR IGNORE INTO documents
      (document_type, document_no, operation_no, status, party_role, party_category,
       customer_name, search_party_name, project, building_unit, entry_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of rows) {
    const party = partyFromInput(row);
    if (party.searchName) {
      partyStmt.run([party.role, party.category, party.baseName, party.displayName, party.searchName]);
    }
    const documentType = documentTypeForStatus(row.accounting_status);
    const documentNo = Number(row.serial) || 0;
    if (documentNo) {
      docStmt.run([
        documentType,
        documentNo,
        row.operation_no || String(documentNo).padStart(6, '0'),
        documentType === 'price_offer' ? 'draft' : 'approved',
        party.role,
        party.category,
        party.displayName,
        party.searchName,
        row.project || null,
        row.building_unit || null,
        row.entry_date || null,
      ]);
    }
  }
  partyStmt.free();
  docStmt.free();
  database.db.exec(`
    UPDATE documents
    SET party_id = (
      SELECT p.id
      FROM parties p
      WHERE p.role = documents.party_role
        AND p.search_name = documents.search_party_name
      LIMIT 1
    )
    WHERE party_id IS NULL
  `);
  database.db.exec('COMMIT');

  const updateStmt = database.db.prepare(`
    UPDATE work_items
    SET party_id = (
          SELECT p.id
          FROM parties p
          WHERE p.role = ?
            AND p.search_name = ?
          LIMIT 1
        ),
        document_id = (
          SELECT d.id
          FROM documents d
          WHERE d.document_type = ?
            AND d.document_no = ?
          LIMIT 1
        ),
        party_role = ?,
        party_category = ?,
        base_party_name = ?,
        search_party_name = ?,
        statement_text = ?,
        unit_code = ?,
        unit = ?,
        measurement_mode = ?,
        document_status = ?
    WHERE id = ?
  `);
  database.db.exec('BEGIN TRANSACTION');
  for (const row of rows) {
    const party = partyFromInput(row);
    const unitCode = normalizeUnitCode(row.unit);
    const measurementMode = normalizeMeasurementMode(row.calculation_method);
    const documentType = documentTypeForStatus(row.accounting_status);
    const documentNo = Number(row.serial) || 0;
    updateStmt.run([
      party.role,
      party.searchName,
      documentType,
      documentNo,
      party.role,
      party.category,
      party.baseName,
      party.searchName,
      composeStatementText(row),
      unitCode,
      unitLabel(unitCode),
      measurementMode,
      row.accounting_status === STATUS.OFFER ? 'draft' : 'approved',
      row.id,
    ]);
  }
  updateStmt.free();
  database.db.exec('COMMIT');
  database.save();
}

module.exports = {
  STATUS,
  displayPartyName,
  documentTypeForStatus,
  ensureRuntimeMigrations,
  inferPartyCategory,
  inferPartyRole,
  normalizeArabic,
  partyFromInput,
  statusForDocumentType,
  stripPartyPrefix,
  unitLabel,
};
