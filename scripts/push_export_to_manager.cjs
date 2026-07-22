const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_IMPORT_URL =
  process.env.AM_MANAGER_IMPORT_URL ||
  `${(process.env.AM_CLOUD_API_URL || process.env.AM_MANAGER_BASE_URL || "https://manager.yasserdiab.site").replace(/\/$/, "")}/api/import/sqlite-export`;

function readToken() {
  const candidates = [
    process.env.AM_MANAGER_TOKEN_FILE,
    process.env.MANAGER_INGEST_TOKEN_FILE,
    path.join("D:\\manager_app", "data", "manager-ingest-token.txt"),
    path.join(ROOT_DIR, ".manager-token"),
    path.join(ROOT_DIR, "manager-token.txt"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        const token = fs.readFileSync(candidate, "utf8").trim();
        if (token) return token;
      }
    } catch {
      // Ignore optional token files.
    }
  }
  return process.env.AM_MANAGER_TOKEN || process.env.AM_MANAGER_INGEST_TOKEN || "";
}

function latestExport() {
  const exportDir =
    process.env.AM_MANAGER_EXPORT_DIR || path.join("D:\\releases", "manager-imports");
  if (!fs.existsSync(exportDir)) return "";
  return fs
    .readdirSync(exportDir)
    .filter((name) => /^accounting-management-sqlite-export-.*\.json$/i.test(name))
    .map((name) => path.join(exportDir, name))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0] || "";
}

async function main() {
  const inputPath = path.resolve(process.argv[2] || latestExport());
  if (!inputPath || !fs.existsSync(inputPath)) {
    throw new Error("No export JSON was found. Run npm run export:manager first.");
  }
  const token = readToken();
  if (!token) {
    throw new Error(
      "Manager token is missing. Set AM_MANAGER_TOKEN or AM_MANAGER_TOKEN_FILE before pushing.",
    );
  }
  const payload = fs.readFileSync(inputPath, "utf8");
  const response = await fetch(DEFAULT_IMPORT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Manager-Token": token,
    },
    body: payload,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Manager import failed with HTTP ${response.status}`);
  }
  console.log(text || `Export pushed to ${DEFAULT_IMPORT_URL}`);
}

if (typeof fetch !== "function") {
  const result = spawnSync(process.execPath, ["-e", "console.error('Node 18+ is required')"], {
    stdio: "inherit",
  });
  process.exit(result.status || 1);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
