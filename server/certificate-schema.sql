CREATE TABLE IF NOT EXISTS cert_revoked_sessions (
  nonce TEXT PRIMARY KEY,
  expiry INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cert_access (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  grants_json TEXT NOT NULL,
  all_projects INTEGER NOT NULL DEFAULT 0,
  allow_project_creation INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cert_customer_profiles (
  customer_id INTEGER PRIMARY KEY REFERENCES parties(id) ON DELETE CASCADE,
  code TEXT,
  alternate_name TEXT,
  print_contact TEXT,
  raw_json TEXT,
  settings_json TEXT
);

CREATE TABLE IF NOT EXISTS cert_customer_creators (
  customer_id INTEGER NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(customer_id,user_id)
);

CREATE TABLE IF NOT EXISTS cert_projects (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  search_name TEXT NOT NULL,
  alternate_name TEXT,
  code TEXT,
  address TEXT,
  contract_ref TEXT,
  contract_date TEXT,
  currency TEXT NOT NULL DEFAULT 'EGP',
  raw_json TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (customer_id, search_name, contract_ref, address)
);

CREATE INDEX IF NOT EXISTS idx_cert_projects_customer ON cert_projects(customer_id,search_name);
CREATE TABLE IF NOT EXISTS cert_project_grants (
  user_id INTEGER NOT NULL REFERENCES cert_access(user_id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES cert_projects(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, project_id)
);

CREATE TABLE IF NOT EXISTS cert_locations (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES cert_projects(id) ON DELETE CASCADE,
  parent_id INTEGER,
  parent_key INTEGER GENERATED ALWAYS AS (COALESCE(parent_id, 0)) STORED,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  search_name TEXT NOT NULL,
  code TEXT,
  UNIQUE (project_id, id),
  UNIQUE (project_id, parent_key, search_name, kind),
  FOREIGN KEY (project_id, parent_id) REFERENCES cert_locations(project_id, id)
);

CREATE TABLE IF NOT EXISTS cert_rule_versions (
  project_id INTEGER NOT NULL REFERENCES cert_projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  effective_at TEXT NOT NULL,
  rules_json TEXT NOT NULL,
  settings_json TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, version)
);

CREATE INDEX IF NOT EXISTS idx_cert_rules_effective ON cert_rule_versions(project_id,effective_at DESC,version DESC);

CREATE TABLE IF NOT EXISTS cert_series (
  project_id INTEGER NOT NULL REFERENCES cert_projects(id) ON DELETE CASCADE,
  reference TEXT NOT NULL,
  next_number INTEGER NOT NULL DEFAULT 1 CHECK(next_number > 0),
  final_revision_id INTEGER,
  PRIMARY KEY(project_id,reference)
);

CREATE TABLE IF NOT EXISTS cert_revisions (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES cert_projects(id) ON DELETE RESTRICT,
  series_key TEXT NOT NULL,
  root_id INTEGER REFERENCES cert_revisions(id) ON DELETE RESTRICT,
  revises_id INTEGER REFERENCES cert_revisions(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','in_review','approved','issued','historical')),
  pdf_status TEXT,
  official_number INTEGER,
  legacy_number TEXT,
  type TEXT NOT NULL DEFAULT 'progress' CHECK(type IN ('progress','final','correction','void','reopen')),
  locale TEXT NOT NULL DEFAULT 'ar' CHECK(locale IN ('ar','en')),
  location_id INTEGER,
  work_to TEXT,
  collection_cutoff TEXT,
  header_json TEXT NOT NULL,
  baseline_id INTEGER REFERENCES cert_revisions(id) ON DELETE RESTRICT,
  rules_version INTEGER,
  approved_json TEXT,
  snapshot_json TEXT,
  issued_at TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id,id),
  UNIQUE(root_id,revision),
  FOREIGN KEY(project_id,location_id) REFERENCES cert_locations(project_id,id),
  FOREIGN KEY(project_id,rules_version) REFERENCES cert_rule_versions(project_id,version)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cert_official_number ON cert_revisions(project_id,series_key,official_number) WHERE official_number IS NOT NULL AND revises_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_cert_project_status ON cert_revisions(project_id,status,id DESC);
CREATE INDEX IF NOT EXISTS idx_cert_baseline ON cert_revisions(project_id,series_key,location_id,status,work_to DESC,id DESC);

CREATE TABLE IF NOT EXISTS cert_lines (
  revision_id INTEGER NOT NULL REFERENCES cert_revisions(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  position INTEGER NOT NULL,
  location_id INTEGER,
  identity TEXT NOT NULL,
  data_json TEXT NOT NULL,
  PRIMARY KEY(revision_id,id),
  UNIQUE(revision_id,identity),
  UNIQUE(revision_id,position)
);
CREATE INDEX IF NOT EXISTS idx_cert_line_position ON cert_lines(revision_id,position);

CREATE TABLE IF NOT EXISTS cert_receipts (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES cert_projects(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(kind IN ('receipt','advance','reversal')),
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  received_at TEXT NOT NULL,
  cleared_at TEXT,
  due_at TEXT,
  currency TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','received','cleared')),
  method TEXT,
  reference TEXT,
  evidence TEXT,
  command_key TEXT,
  reverses_id INTEGER UNIQUE REFERENCES cert_receipts(id) ON DELETE RESTRICT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id,id),
  UNIQUE(project_id,created_by,command_key)
);
CREATE INDEX IF NOT EXISTS idx_cert_receipt_cutoff ON cert_receipts(project_id,received_at);

CREATE TABLE IF NOT EXISTS cert_receipt_allocations (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL,
  receipt_id INTEGER NOT NULL,
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  location_id INTEGER,
  certificate_id INTEGER,
  allocated_at TEXT,
  FOREIGN KEY(project_id,receipt_id) REFERENCES cert_receipts(project_id,id) ON DELETE CASCADE,
  FOREIGN KEY(project_id,location_id) REFERENCES cert_locations(project_id,id),
  FOREIGN KEY(project_id,certificate_id) REFERENCES cert_revisions(project_id,id)
);
CREATE INDEX IF NOT EXISTS idx_cert_allocations_receipt ON cert_receipt_allocations(receipt_id);

CREATE TABLE IF NOT EXISTS cert_advance_recoveries (
  project_id INTEGER NOT NULL,
  advance_id INTEGER NOT NULL,
  certificate_id INTEGER NOT NULL,
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  PRIMARY KEY(advance_id,certificate_id),
  FOREIGN KEY(project_id,advance_id) REFERENCES cert_receipts(project_id,id),
  FOREIGN KEY(project_id,certificate_id) REFERENCES cert_revisions(project_id,id)
);
CREATE INDEX IF NOT EXISTS idx_cert_advance_recovery_certificate ON cert_advance_recoveries(certificate_id);

CREATE TABLE IF NOT EXISTS cert_import_batches (
  id TEXT PRIMARY KEY,
  revision_id INTEGER NOT NULL REFERENCES cert_revisions(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  source_label TEXT,
  mapping_json TEXT NOT NULL,
  source_json TEXT NOT NULL,
  committed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cert_audit (
  id INTEGER PRIMARY KEY,
  project_id INTEGER REFERENCES cert_projects(id) ON DELETE CASCADE,
  revision_id INTEGER REFERENCES cert_revisions(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  reason TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_cert_audit_revision ON cert_audit(revision_id,id);

CREATE TABLE IF NOT EXISTS cert_commands (
  revision_id INTEGER NOT NULL REFERENCES cert_revisions(id) ON DELETE CASCADE,
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  command_key TEXT NOT NULL,
  action TEXT NOT NULL,
  result_revision INTEGER NOT NULL REFERENCES cert_revisions(id) ON DELETE CASCADE,
  PRIMARY KEY(revision_id,actor_id,command_key)
);

CREATE TABLE IF NOT EXISTS cert_legacy_batches (
  fingerprint TEXT PRIMARY KEY,
  source_name TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cert_legacy_records (
  fingerprint TEXT NOT NULL REFERENCES cert_legacy_batches(fingerprint) ON DELETE CASCADE,
  record_type TEXT NOT NULL,
  source_key TEXT NOT NULL,
  project_id INTEGER REFERENCES cert_projects(id) ON DELETE RESTRICT,
  revision_id INTEGER REFERENCES cert_revisions(id) ON DELETE RESTRICT,
  amount_minor INTEGER,
  data_json TEXT NOT NULL,
  PRIMARY KEY(fingerprint,record_type,source_key)
);
CREATE INDEX IF NOT EXISTS idx_cert_legacy_project ON cert_legacy_records(project_id,record_type);
CREATE TABLE IF NOT EXISTS cert_legacy_workflow (
  revision_id INTEGER PRIMARY KEY REFERENCES cert_revisions(id) ON DELETE CASCADE,
  edited_json TEXT,
  approved_json TEXT,
  approved_at TEXT,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
