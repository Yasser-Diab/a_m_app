CREATE TABLE IF NOT EXISTS ops_projects (
  project_id INTEGER PRIMARY KEY REFERENCES cert_projects(id) ON DELETE RESTRICT,
  boq_id INTEGER NOT NULL REFERENCES documents(id),
  boq_snapshot TEXT NOT NULL CHECK(json_valid(boq_snapshot)),
  details TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(details)),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS ops_source_approvals (
  document_id INTEGER PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  approved_on TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ops_customer_type_specs (
  customer_id INTEGER NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  system TEXT NOT NULL REFERENCES ops_systems(id),
  technical TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(technical)),
  PRIMARY KEY(customer_id,category,system)
);

CREATE TABLE IF NOT EXISTS ops_customer_specs (
  customer_id INTEGER NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  system TEXT NOT NULL REFERENCES ops_systems(id),
  technical TEXT NOT NULL CHECK(json_valid(technical)),
  PRIMARY KEY(customer_id,description)
);

CREATE TABLE IF NOT EXISTS ops_project_specs (
  project_id INTEGER NOT NULL REFERENCES ops_projects(project_id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  system TEXT NOT NULL REFERENCES ops_systems(id),
  technical TEXT NOT NULL CHECK(json_valid(technical)),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  save_sequence INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(project_id,description,category,system)
);

CREATE TABLE IF NOT EXISTS ops_sequences (
  project_id INTEGER NOT NULL REFERENCES ops_projects(project_id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  number INTEGER NOT NULL CHECK(number>0),
  PRIMARY KEY(project_id,kind)
);

CREATE TABLE IF NOT EXISTS ops_project_boqs (
  project_id INTEGER NOT NULL REFERENCES ops_projects(project_id) ON DELETE CASCADE,
  document_id INTEGER NOT NULL REFERENCES documents(id),
  snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
  PRIMARY KEY(project_id,document_id)
);

CREATE TABLE IF NOT EXISTS ops_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  company TEXT NOT NULL DEFAULT '',
  position TEXT NOT NULL DEFAULT '',
  mobile TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '',
  identity TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS ops_people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES ops_projects(project_id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  contact_id INTEGER REFERENCES ops_contacts(id),
  position TEXT NOT NULL DEFAULT '',
  CHECK((user_id IS NULL) <> (contact_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ops_people_internal ON ops_people(project_id,user_id,position) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ops_people_external ON ops_people(project_id,contact_id,position) WHERE contact_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ops_systems (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  ar TEXT NOT NULL,
  en TEXT NOT NULL,
  tags TEXT NOT NULL CHECK(json_valid(tags)),
  fields TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(fields))
);

CREATE TABLE IF NOT EXISTS ops_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES ops_projects(project_id) ON DELETE CASCADE,
  source_line_id INTEGER REFERENCES work_items(id),
  code TEXT NOT NULL COLLATE NOCASE,
  original TEXT CHECK(original IS NULL OR json_valid(original)),
  commercial TEXT NOT NULL CHECK(json_valid(commercial)),
  technical TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(technical)),
  category TEXT NOT NULL DEFAULT '',
  system TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  financial_version INTEGER NOT NULL DEFAULT 0,
  UNIQUE(project_id,code),
  UNIQUE(project_id,source_line_id)
);
CREATE INDEX IF NOT EXISTS ops_items_category ON ops_items(project_id,category,id);
CREATE TABLE IF NOT EXISTS ops_item_approvals (
  item_id INTEGER NOT NULL REFERENCES ops_items(id) ON DELETE CASCADE,
  item_version INTEGER NOT NULL,
  part TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('approved','na')),
  reference TEXT NOT NULL,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(item_id,item_version,part)
);

CREATE TABLE IF NOT EXISTS ops_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES ops_items(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','returned')),
  prior TEXT NOT NULL CHECK(json_valid(prior)),
  proposed TEXT NOT NULL CHECK(json_valid(proposed)),
  base_version INTEGER NOT NULL,
  prior_change_id INTEGER REFERENCES ops_changes(id),
  reason TEXT NOT NULL,
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  submitted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  review_note TEXT,
  adjustment_id INTEGER REFERENCES documents(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ops_changes_pending ON ops_changes(item_id) WHERE status='pending';

CREATE TABLE IF NOT EXISTS ops_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES ops_items(id) ON DELETE CASCADE,
  item_version INTEGER NOT NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  content BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  removed_at TEXT
);
CREATE INDEX IF NOT EXISTS ops_attachments_item ON ops_attachments(item_id,id);

CREATE TABLE IF NOT EXISTS ops_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES ops_projects(project_id) ON DELETE CASCADE,
  reference TEXT NOT NULL COLLATE NOCASE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','released','shipped','closed')),
  required_date TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(project_id,reference)
);

CREATE TABLE IF NOT EXISTS ops_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES ops_orders(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES ops_items(id),
  quantity INTEGER NOT NULL CHECK(quantity>0),
  quantities TEXT NOT NULL CHECK(json_valid(quantities)),
  specification TEXT NOT NULL CHECK(json_valid(specification)),
  UNIQUE(order_id,item_id)
);
CREATE INDEX IF NOT EXISTS ops_order_items_item ON ops_order_items(item_id,order_id);

CREATE TABLE IF NOT EXISTS ops_order_reviews (
  order_item_id INTEGER NOT NULL REFERENCES ops_order_items(id) ON DELETE CASCADE,
  item_version INTEGER NOT NULL,
  stage TEXT NOT NULL,
  approved INTEGER NOT NULL CHECK(approved IN (0,1)),
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(order_item_id,item_version,stage)
);

CREATE TABLE IF NOT EXISTS ops_inspections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_item_id INTEGER NOT NULL REFERENCES ops_order_items(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  inspection_date TEXT NOT NULL,
  inspector_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  inspector_name TEXT NOT NULL,
  record TEXT NOT NULL CHECK(json_valid(record)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ops_inspections_order ON ops_inspections(order_item_id,stage,id DESC);

CREATE TABLE IF NOT EXISTS ops_loads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES ops_orders(id) ON DELETE CASCADE,
  reference TEXT NOT NULL COLLATE NOCASE,
  loading_date TEXT NOT NULL,
  responsible TEXT NOT NULL CHECK(json_valid(responsible)),
  notes TEXT NOT NULL DEFAULT '',
  recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(order_id,reference)
);
CREATE TABLE IF NOT EXISTS ops_loading_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES ops_orders(id) ON DELETE CASCADE,
  after_load_id INTEGER NOT NULL DEFAULT 0,
  reference TEXT NOT NULL COLLATE NOCASE UNIQUE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(order_id,after_load_id)
);
CREATE TABLE IF NOT EXISTS ops_loading_sequences (
  project_id INTEGER PRIMARY KEY REFERENCES cert_projects(id) ON DELETE CASCADE,
  number INTEGER NOT NULL CHECK(number>0)
);
CREATE TABLE IF NOT EXISTS ops_manual_loading_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES cert_projects(id) ON DELETE RESTRICT,
  reference TEXT NOT NULL COLLATE NOCASE UNIQUE,
  command_key TEXT NOT NULL UNIQUE,
  loading_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','issued','cancelled')),
  items TEXT NOT NULL CHECK(json_valid(items)),
  signatures TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(signatures)),
  vehicle_plate TEXT NOT NULL DEFAULT '',
  driver_name TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS ops_manual_loading_project ON ops_manual_loading_orders(project_id,id DESC);
CREATE TABLE IF NOT EXISTS ops_manual_loading_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  loading_order_id INTEGER NOT NULL REFERENCES ops_manual_loading_orders(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(loading_order_id,version)
);
CREATE TABLE IF NOT EXISTS ops_load_lines (
  load_id INTEGER NOT NULL REFERENCES ops_loads(id) ON DELETE CASCADE,
  order_item_id INTEGER NOT NULL REFERENCES ops_order_items(id),
  kind TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity>0),
  PRIMARY KEY(load_id,order_item_id,kind)
);
CREATE INDEX IF NOT EXISTS ops_load_lines_item ON ops_load_lines(order_item_id,kind);
CREATE TABLE IF NOT EXISTS ops_load_parts (
  load_id INTEGER NOT NULL REFERENCES ops_loads(id) ON DELETE CASCADE,
  part_id TEXT NOT NULL,
  order_item_id INTEGER REFERENCES ops_order_items(id),
  label TEXT NOT NULL,
  unit TEXT NOT NULL,
  quantity REAL NOT NULL CHECK(quantity>0),
  PRIMARY KEY(load_id,part_id)
);

CREATE TABLE IF NOT EXISTS ops_confirmations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES ops_items(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK(stage IN ('installed','claimable')),
  quantity REAL NOT NULL CHECK(quantity>0),
  unit TEXT NOT NULL,
  reference TEXT NOT NULL COLLATE NOCASE,
  confirmed_on TEXT NOT NULL,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(item_id,stage,reference)
);

CREATE TABLE IF NOT EXISTS ops_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES ops_projects(project_id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_id INTEGER,
  details TEXT CHECK(details IS NULL OR json_valid(details)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ops_audit_project ON ops_audit(project_id,id DESC);

CREATE TABLE IF NOT EXISTS ops_report_edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES ops_orders(id) ON DELETE CASCADE,
  document_ref TEXT NOT NULL,
  report_kind TEXT NOT NULL,
  locale TEXT NOT NULL CHECK(locale IN ('ar','en')),
  body_html TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(order_id,document_ref,report_kind,locale)
);
CREATE TABLE IF NOT EXISTS ops_report_edit_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_edit_id INTEGER NOT NULL REFERENCES ops_report_edits(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  body_html TEXT,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(report_edit_id,version)
);

CREATE TABLE IF NOT EXISTS ops_stage_assignments (
 order_id INTEGER NOT NULL REFERENCES ops_orders(id) ON DELETE CASCADE,stage TEXT NOT NULL,data TEXT NOT NULL DEFAULT '{}',version INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(order_id,stage));
CREATE TABLE IF NOT EXISTS ops_installations (
 order_item_id INTEGER PRIMARY KEY REFERENCES ops_order_items(id) ON DELETE CASCADE,quantity INTEGER NOT NULL CHECK(quantity>=0),installation_date TEXT,notes TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
