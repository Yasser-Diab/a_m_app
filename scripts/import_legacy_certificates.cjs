const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { AppDatabase } = require('../server/db.cjs');
const { initializeCertificates, importLegacyCertificates } = require('../server/certificates.cjs');
const { toMinor } = require('../server/certificate-valuation.cjs');

function checksum(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

async function migrate(databasePath, batchPath, outputPath) {
  const source = path.resolve(databasePath);
  const target = path.resolve(outputPath);
  const batch = JSON.parse(fs.readFileSync(batchPath, 'utf8'));
  if ([`${source}-wal`, `${source}-journal`].some(file => fs.existsSync(file))) {
    throw new Error('The source has an active SQLite journal. Make a consistent database backup first.');
  }
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  const database = new AppDatabase(target, path.join(__dirname, '../server/schema.sql'));
  try {
    const sourceHash = checksum(target);
    if (sourceHash !== checksum(source)) throw new Error('The source changed during the copy. Retry from a stable backup.');
    await database.open();
    initializeCertificates(database);
    const result = await importLegacyCertificates(database, batch);
    const reconciliation = batch.reconciliation;
    if (reconciliation && (
      result.lines !== reconciliation.certificate_lines ||
      result.receipts !== reconciliation.receipt_lines ||
      result.work_minor !== toMinor(reconciliation.certificate_total_rounded_per_line) ||
      result.receipts_minor !== toMinor(reconciliation.receipt_total_rounded_per_line)
    )) {
      throw new Error('The imported row counts or financial totals differ from the workbook reconciliation.');
    }
    const integrity = database.all('PRAGMA integrity_check');
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') {
      throw new Error('The migrated copy failed SQLite integrity checking.');
    }
    database.close();
    console.log(JSON.stringify({ ...result, sourceHash, output: target }, null, 2));
  } catch (error) {
    if (database.db) database.db.close();
    fs.unlinkSync(target);
    throw error;
  }
}

const args = process.argv.slice(2);
if (args.length !== 3) {
  console.error('Usage: node scripts/import_legacy_certificates.cjs <source.db> <legacy.json> <new-output.db>');
  process.exitCode = 1;
} else {
  migrate(...args).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
