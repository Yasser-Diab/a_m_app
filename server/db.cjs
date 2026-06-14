const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

let SQL;

async function loadSqlJs() {
  if (!SQL) {
    SQL = await initSqlJs({
      locateFile: (file) => path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file),
    });
  }
  return SQL;
}

class AppDatabase {
  constructor(dbPath, schemaPath) {
    this.dbPath = dbPath;
    this.schemaPath = schemaPath;
    this.db = null;
  }

  async open() {
    const SQLLib = await loadSqlJs();
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    if (fs.existsSync(this.dbPath)) {
      this.db = new SQLLib.Database(fs.readFileSync(this.dbPath));
    } else {
      this.db = new SQLLib.Database();
    }
    this.migrate();
    this.save();
  }

  migrate() {
    const schema = fs.readFileSync(this.schemaPath, 'utf8');
    this.db.exec(schema);
  }

  save() {
    const bytes = this.db.export();
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    fs.writeFileSync(this.dbPath, Buffer.from(bytes));
  }

  all(sql, params = []) {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  get(sql, params = []) {
    return this.all(sql, params)[0] || null;
  }

  run(sql, params = []) {
    const stmt = this.db.prepare(sql);
    let modified = 0;
    try {
      stmt.bind(params);
      while (stmt.step()) {}
      modified = this.db.getRowsModified();
    } finally {
      stmt.free();
    }
    const lastInsertRowid = this.lastInsertRowid();
    this.save();
    return { modified, lastInsertRowid };
  }

  exec(sql) {
    this.db.exec(sql);
    this.save();
  }

  lastInsertRowid() {
    const row = this.get('SELECT last_insert_rowid() AS id');
    return row ? row.id : null;
  }

  backup(targetDir) {
    fs.mkdirSync(targetDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(targetDir, `price_offer_${stamp}.db`);
    fs.copyFileSync(this.dbPath, backupPath);
    return backupPath;
  }
}

module.exports = { AppDatabase };
