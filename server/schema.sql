PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  pin_hash TEXT,
  can_create_invoices INTEGER NOT NULL DEFAULT 0,
  can_create_payments INTEGER NOT NULL DEFAULT 0,
  can_change_status INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender TEXT,
  message TEXT,
  reply_to_id INTEGER,
  attachment_name TEXT,
  attachment_mime TEXT,
  attachment_path TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chat_message_reads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,
  user_name TEXT NOT NULL,
  seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(message_id, user_name),
  FOREIGN KEY (message_id) REFERENCES chat_messages(id)
);

CREATE TABLE IF NOT EXISTS work_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_row INTEGER,
  serial INTEGER,
  operation_no TEXT,
  calculation_method TEXT,
  measurement_mode TEXT DEFAULT 'standard',
  unit_code TEXT DEFAULT 'sqm',
  party_id INTEGER,
  document_id INTEGER,
  party_role TEXT DEFAULT 'customer',
  party_category TEXT,
  source_customer_id INTEGER,
  source_customer_name TEXT,
  base_party_name TEXT,
  search_party_name TEXT,
  statement_text TEXT,
  document_status TEXT DEFAULT 'draft',
  customer_name TEXT,
  customer_display_name TEXT,
  party_type TEXT,
  accounting_status TEXT,
  completion_ratio REAL,
  collection_amount REAL,
  collection_note TEXT,
  work_type TEXT,
  project TEXT,
  building_unit TEXT,
  floor_apartment TEXT,
  entry_date TEXT,
  description TEXT,
  glass_spec TEXT,
  profile_spec TEXT,
  color TEXT,
  total_quantity REAL,
  unit TEXT,
  item_count REAL,
  width_cm REAL,
  height_cm REAL,
  rate REAL,
  building_unit_price REAL,
  fixed_discount REAL,
  percent_discount REAL,
  supply_status TEXT,
  supply_date TEXT,
  driver_name TEXT,
  vehicle_no TEXT,
  certificate_no TEXT,
  vat_enabled INTEGER NOT NULL DEFAULT 0,
  social_insurance_enabled INTEGER NOT NULL DEFAULT 0,
  stamp_enabled INTEGER NOT NULL DEFAULT 0,
  works_insurance_enabled INTEGER NOT NULL DEFAULT 0,
  final_insurance_enabled INTEGER NOT NULL DEFAULT 0,
  contractor_tax_enabled INTEGER NOT NULL DEFAULT 0,
  discount_label TEXT,
  discount_amount REAL NOT NULL DEFAULT 0,
  quantity REAL NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  unit_price REAL NOT NULL DEFAULT 0,
  gross_total REAL NOT NULL DEFAULT 0,
  vat_amount REAL NOT NULL DEFAULT 0,
  social_insurance_amount REAL NOT NULL DEFAULT 0,
  stamp_amount REAL NOT NULL DEFAULT 0,
  works_insurance_amount REAL NOT NULL DEFAULT 0,
  final_insurance_amount REAL NOT NULL DEFAULT 0,
  contractor_tax_amount REAL NOT NULL DEFAULT 0,
  net_total REAL NOT NULL DEFAULT 0,
  tax_inclusive_rate REAL NOT NULL DEFAULT 0,
  rate_discount REAL NOT NULL DEFAULT 0,
  sequence_code TEXT,
  area_m2 REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_by TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS parties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK (role IN ('customer', 'contractor')),
  category TEXT CHECK (category IN ('retail', 'corporate')),
  base_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  search_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  tax_no TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(role, search_name)
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_type TEXT NOT NULL,
  document_no INTEGER NOT NULL,
  operation_no TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  party_id INTEGER,
  party_role TEXT NOT NULL DEFAULT 'customer',
  party_category TEXT,
  customer_name TEXT,
  search_party_name TEXT,
  project TEXT,
  building_unit TEXT,
  title TEXT,
  entry_date TEXT,
  discount_type TEXT CHECK (discount_type IN ('none', 'rate', 'amount')) DEFAULT 'none',
  discount_value REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  FOREIGN KEY (party_id) REFERENCES parties(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_type_no ON documents(document_type, document_no);
CREATE INDEX IF NOT EXISTS idx_documents_party ON documents(party_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_parties_search ON parties(role, search_name);

CREATE INDEX IF NOT EXISTS idx_work_items_serial ON work_items(serial);
CREATE INDEX IF NOT EXISTS idx_work_items_operation_no ON work_items(operation_no);
CREATE INDEX IF NOT EXISTS idx_work_items_customer ON work_items(customer_name);
CREATE INDEX IF NOT EXISTS idx_work_items_project ON work_items(project);
CREATE INDEX IF NOT EXISTS idx_work_items_status ON work_items(accounting_status);
CREATE INDEX IF NOT EXISTS idx_work_items_date ON work_items(entry_date);
CREATE INDEX IF NOT EXISTS idx_work_items_certificate ON work_items(certificate_no);

CREATE VIEW IF NOT EXISTS active_work_items AS
SELECT * FROM work_items WHERE deleted_at IS NULL;

INSERT OR IGNORE INTO users (username, display_name, role)
VALUES ('admin', 'مدير النظام', 'admin');

INSERT OR IGNORE INTO app_settings (key, value)
VALUES
  ('company_name_ar', 'Accounting Management'),
  ('company_name_en', 'Accounting Management'),
  ('vat_rate', '0.14'),
  ('social_insurance_rate', '0.036'),
  ('stamp_rate', '0.001'),
  ('works_insurance_rate', '0.05'),
  ('final_insurance_rate', '0.05'),
  ('contractor_tax_rate', '0.01');

INSERT OR IGNORE INTO app_settings (key, value)
VALUES
  ('admin_password', '23320001'),
  ('terms_retail', '{"sections":[{"title":"صلاحية عرض السعر","lines":["عرض السعر ساري لمدة (48) ساعة من تاريخ إصداره.","الأسعار تعتمد على أسعار المواد الخام الحالية وقابلة للتغيير حسب تقلبات السوق."]},{"title":"شروط الدفع","lines":["80% عند توقيع العقد.","20% عند التسليم."]}]}'),
  ('terms_corporate', '{"sections":[{"title":"صلاحية عرض السعر","lines":["عرض السعر ساري لمدة (48) ساعة من تاريخ إصداره.","الأسعار تعتمد على أسعار المواد الخام الحالية وقابلة للتغيير حسب تقلبات السوق."]},{"title":"شروط الدفع","lines":["60% عند توقيع العقد.","15% عند التوريد.","15% عند التركيب.","10% عند التسليم."]}]}');
