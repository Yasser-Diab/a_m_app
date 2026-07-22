const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const target = path.resolve(root, process.argv[2] || "dist");
const extensions = new Set([".html", ".js", ".css"]);

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (extensions.has(path.extname(entry.name))) files.push(full);
  }
  return files;
}

const searchRoot = fs.existsSync(path.join(target, "app", "src", "main", "assets", "public"))
  ? path.join(target, "app", "src", "main", "assets", "public")
  : target;
const files = walk(searchRoot);

if (!files.length) {
  throw new Error(`No built web assets found in ${searchRoot}`);
}

const bundle = files.map((file) => fs.readFileSync(file, "utf8")).join("\n");
const requiredMarkers = [
  "cell-suggestions",
  "/api/auth/login",
  "/api/bootstrap",
  "/api/lookups",
  "/api/settings/terms",
  "/api/settings/report-branding",
  "/api/subscription/status",
  "/api/subscription/plans",
  "/api/subscription/config",
  "/api/company-account",
  "/api/manager/public",
  "/api/manager-payments",
  "/api/paypal/orders",
  "/api/paypal/subscription-plan",
  "/api/paypal/subscriptions/activate",
  "subscription-mode-grid",
  "account-danger-zone",
  "تحديث Manager",
  "am-manager-v1.4.3",
];
const forbiddenMarkers = [
  "smartRates",
  "Embedded secure checkout",
  "Manager PayPal client id is not configured",
  "/api/manager-account",
  "إرسال البيانات للمدير",
  "Delete Manager account",
];

const missing = requiredMarkers.filter((marker) => !bundle.includes(marker));
if (missing.length) {
  throw new Error(`Built assets are missing required markers: ${missing.join(", ")}`);
}

const stale = forbiddenMarkers.filter((marker) => bundle.includes(marker));
if (stale.length) {
  throw new Error(`Built assets still contain stale markers: ${stale.join(", ")}`);
}

console.log(`Verified built assets in ${searchRoot}`);
