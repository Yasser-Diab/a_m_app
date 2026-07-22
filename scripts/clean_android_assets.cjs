const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const targets = [
  path.join(root, "android", "app", "src", "main", "assets", "public"),
];

for (const target of targets) {
  const resolved = path.resolve(target);
  const allowedRoot = path.resolve(root, "android", "app", "src", "main", "assets");
  if (!resolved.startsWith(`${allowedRoot}${path.sep}`)) {
    throw new Error(`Refusing to clean unexpected Android asset path: ${resolved}`);
  }
  if (fs.existsSync(resolved)) {
    fs.rmSync(resolved, { recursive: true, force: true });
    console.log(`Removed stale Android web assets: ${resolved}`);
  }
}
