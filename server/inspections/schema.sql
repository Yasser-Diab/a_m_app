CREATE TABLE IF NOT EXISTS inspection_assets (
 id TEXT PRIMARY KEY,project_id INTEGER REFERENCES cert_projects(id),customer_id INTEGER REFERENCES parties(id),
 name TEXT NOT NULL,mime TEXT NOT NULL,content BLOB NOT NULL,metadata TEXT NOT NULL DEFAULT '{}',
 created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS inspection_templates (
 id TEXT PRIMARY KEY,name TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('IR','MIR')),
 scope TEXT NOT NULL CHECK(scope IN ('global','customer','project')),scope_id INTEGER,
 config TEXT NOT NULL CHECK(json_valid(config)),version INTEGER NOT NULL DEFAULT 1,archived INTEGER NOT NULL DEFAULT 0,
 updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS inspection_template_history (
 template_id TEXT NOT NULL REFERENCES inspection_templates(id),version INTEGER NOT NULL,config TEXT NOT NULL,
 name TEXT NOT NULL,actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(template_id,version)
);
CREATE TABLE IF NOT EXISTS inspection_profiles (
 scope TEXT NOT NULL CHECK(scope IN ('global','customer','project')),scope_id INTEGER NOT NULL DEFAULT 0,
 data TEXT NOT NULL CHECK(json_valid(data)),version INTEGER NOT NULL DEFAULT 1,
 updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,PRIMARY KEY(scope,scope_id)
);
CREATE TABLE IF NOT EXISTS inspection_sequences (
 project_id INTEGER NOT NULL REFERENCES cert_projects(id),kind TEXT NOT NULL,number INTEGER NOT NULL,
 PRIMARY KEY(project_id,kind)
);
CREATE TABLE IF NOT EXISTS inspection_requests (
 id INTEGER PRIMARY KEY AUTOINCREMENT,project_id INTEGER NOT NULL REFERENCES cert_projects(id),kind TEXT NOT NULL CHECK(kind IN ('IR','MIR')),
 root_id INTEGER REFERENCES inspection_requests(id),previous_id INTEGER REFERENCES inspection_requests(id),revision INTEGER NOT NULL DEFAULT 0,
 reference TEXT NOT NULL,command_key TEXT NOT NULL,template_id TEXT NOT NULL REFERENCES inspection_templates(id),template_version INTEGER NOT NULL,
 template_snapshot TEXT NOT NULL CHECK(json_valid(template_snapshot)),
 data TEXT NOT NULL CHECK(json_valid(data)),rows TEXT NOT NULL CHECK(json_valid(rows)),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','responded','cancelled','superseded')),
 version INTEGER NOT NULL DEFAULT 1,submitted_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
 UNIQUE(project_id,command_key),UNIQUE(reference,revision)
);
CREATE INDEX IF NOT EXISTS inspection_requests_project ON inspection_requests(project_id,kind,id DESC);
CREATE INDEX IF NOT EXISTS inspection_requests_root ON inspection_requests(root_id,id);
CREATE TABLE IF NOT EXISTS inspection_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,request_id INTEGER NOT NULL REFERENCES inspection_requests(id) ON DELETE CASCADE,
 version INTEGER NOT NULL,action TEXT NOT NULL,snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),reason TEXT NOT NULL DEFAULT '',
 actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS inspection_artifacts (
 id INTEGER PRIMARY KEY AUTOINCREMENT,request_id INTEGER NOT NULL REFERENCES inspection_requests(id) ON DELETE CASCADE,
 version INTEGER NOT NULL,locale TEXT NOT NULL,pdf BLOB NOT NULL,checksum TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(request_id,version,locale)
);
CREATE TABLE IF NOT EXISTS inspection_attachments (
 request_id INTEGER NOT NULL REFERENCES inspection_requests(id) ON DELETE CASCADE,asset_id TEXT NOT NULL REFERENCES inspection_assets(id),
 category TEXT NOT NULL DEFAULT 'attachment',PRIMARY KEY(request_id,asset_id)
);
