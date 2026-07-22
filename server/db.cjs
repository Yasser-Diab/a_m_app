const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

let SQL;

function locateSqlJsFile(file) {
  const packageLocalPath = path.join(
    __dirname,
    '..',
    'node_modules',
    'sql.js',
    'dist',
    file,
  );
  if (fs.existsSync(packageLocalPath)) return packageLocalPath;
  try {
    return require.resolve(`sql.js/dist/${file}`);
  } catch {
    return packageLocalPath;
  }
}

async function loadSqlJs() {
  if (!SQL) {
    SQL = await initSqlJs({
      locateFile: locateSqlJsFile,
    });
  }
  return SQL;
}

class AppDatabase {
  constructor(dbPath, schemaPath) {
    this.dbPath = dbPath;
    this.schemaPath = schemaPath;
    this.db = null;
    this.transactionDepth = 0;
    this.savePending = false;
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
    if (this.transactionDepth > 0) {
      this.savePending = true;
      return;
    }
    this.saveNow();
  }

  saveNow() {
    const bytes = this.db.export();
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    fs.writeFileSync(this.dbPath, Buffer.from(bytes));
    this.savePending = false;
  }

  transaction(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('Database transaction requires a callback.');
    }
    if (this.transactionDepth > 0) return callback();
    this.db.exec('BEGIN TRANSACTION');
    this.transactionDepth = 1;
    try {
      const result = callback();
      this.db.exec('COMMIT');
      this.transactionDepth = 0;
      this.saveNow();
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } finally {
        this.transactionDepth = 0;
        this.savePending = false;
      }
      throw error;
    }
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

  close() {
    if (!this.db) return;
    this.save();
    this.db.close();
    this.db = null;
  }
}

module.exports = { AppDatabase };
