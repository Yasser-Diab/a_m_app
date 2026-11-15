const fs = require('fs');
const path = require('path');
const { randomUUID } = require('node:crypto');
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
    const foreignKeys = this.get('PRAGMA foreign_keys').foreign_keys;
    const bytes = this.db.export();
    this.db.exec('PRAGMA foreign_keys = ' + (foreignKeys ? 'ON' : 'OFF'));
    const dir = path.dirname(this.dbPath);
    fs.mkdirSync(dir, { recursive: true });
    const temporaryPath = path.join(dir, path.basename(this.dbPath) + '.' + randomUUID() + '.tmp');
    try {
      const fd = fs.openSync(temporaryPath, 'wx');
      try {
        fs.writeFileSync(fd, Buffer.from(bytes));
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(temporaryPath, this.dbPath);
      this.savePending = false;
    } finally {
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    }
  }

  transaction(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('Database transaction requires a callback.');
    }
    if (this.transactionDepth > 0) return callback();
    this.db.exec('BEGIN TRANSACTION');
    this.transactionDepth = 1;
    let result;
    try {
      result = callback();
      if (result && typeof result.then === 'function') {
        throw new TypeError('Database transaction requires a synchronous callback.');
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      this.savePending = false;
      throw error;
    } finally {
      this.transactionDepth = 0;
    }
    try {
      if (this.savePending) this.saveNow();
    } catch (error) {
      if (fs.existsSync(this.dbPath)) {
        const recovered = new SQL.Database(fs.readFileSync(this.dbPath));
        const foreignKeys = this.get('PRAGMA foreign_keys').foreign_keys;
        recovered.exec('PRAGMA foreign_keys = ' + (foreignKeys ? 'ON' : 'OFF'));
        this.db.close();
        this.db = recovered;
      }
      this.savePending = false;
      throw error;
    }
    return result;
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
