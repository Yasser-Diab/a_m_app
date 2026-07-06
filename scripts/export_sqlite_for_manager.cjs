const fs = require("fs");
const path = require("path");
const { AppDatabase } = require("../server/db.cjs");

const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_DB_PATH =
  process.env.PRICE_OFFER_DB_PATH ||
  process.env.AM_SQLITE_DB_PATH ||
  path.join("D:\\AM_Data", "price_offer.db");
const EXPORT_DIR =
  process.env.AM_MANAGER_EXPORT_DIR ||
  path.join("D:\\releases", "manager-imports");

const TABLES = [
  "app_settings",
  "users",
  "parties",
  "documents",
  "work_items",
  "chat_messages",
  "chat_message_reads",
  "client_devices",
  "subscription_accounts",
  "subscription_payments",
  "payment_settings",
  "payments",
  "subscriptions",
];

function safeAll(database, table) {
  try {
    return database.all(`SELECT * FROM ${table}`);
  } catch {
    return [];
  }
}

async function main() {
  const dbPath = path.resolve(process.argv[2] || DEFAULT_DB_PATH);
  const schemaPath = path.join(ROOT_DIR, "server", "schema.sql");
  if (!fs.existsSync(dbPath)) {
    throw new Error(`SQLite database was not found: ${dbPath}`);
  }
  const database = new AppDatabase(dbPath, schemaPath);
  await database.open();
  const exportedAt = new Date().toISOString();
  const payload = {
    format: "accounting-management-sqlite-export",
    format_version: 1,
    app: {
      name: "Accounting Management",
      version: require("../package.json").version,
      release_label: require("../package.json").appReleaseLabel || "",
    },
    source: {
      db_path: dbPath,
      exported_at: exportedAt,
    },
    tables: Object.fromEntries(TABLES.map((table) => [table, safeAll(database, table)])),
  };
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  const stamp = exportedAt.replace(/[:.]/g, "-");
  const outPath = path.join(EXPORT_DIR, `accounting-management-sqlite-export-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(outPath);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
