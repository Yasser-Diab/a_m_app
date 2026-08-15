const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const packageVersion = require(path.join(root, 'package.json')).version;
let configuredVersion = '';
try {
  configuredVersion = require(path.join(root, 'config', 'app-variants.json')).version || '';
} catch {
  configuredVersion = '';
}
const version = process.env.AM_BUILD_VERSION || configuredVersion || packageVersion;
const output = path.join(root, 'dist-installer', 'EasyCommercial');
const required = [
  `EasyCommercial-Setup-${version}.exe`,
  `EasyCommercial-Setup-${version}.exe.blockmap`,
  'latest.yml',
];

const missing = required.filter((name) => !fs.existsSync(path.join(output, name)));
if (missing.length) {
  throw new Error(`Missing release/update assets: ${missing.join(', ')}`);
}

const metadata = fs.readFileSync(path.join(output, 'latest.yml'), 'utf8');
if (!new RegExp(`^version:\\s*["']?${version.replace(/\./g, '\\.')}`, 'm').test(metadata)) {
  throw new Error(`latest.yml does not describe packaged version ${version}.`);
}
if (!metadata.includes(`EasyCommercial-Setup-${version}.exe`)) {
  throw new Error('latest.yml installer path does not match the packaged installer.');
}

const releaseRoot = path.join(root, 'releases');
const releaseDir = path.join(releaseRoot, `EasyCommercial_V${version}`);
const manifestPath = path.join(releaseRoot, 'easy-commercial-update.json');
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.version !== version) {
    throw new Error(`Release manifest version ${manifest.version} does not match ${version}.`);
  }
  const windowsAsset = manifest.windows?.downloadUrl;
  const androidAsset = manifest.android?.downloadUrl;
  for (const assetName of [windowsAsset, androidAsset].filter(Boolean)) {
    if (!fs.existsSync(path.join(releaseDir, assetName))) {
      throw new Error(`Release manifest asset does not exist in ${releaseDir}: ${assetName}`);
    }
  }
  if (androidAsset && !fs.existsSync(path.join(releaseRoot, 'apk', androidAsset))) {
    throw new Error(`Android release asset is missing from releases/apk: ${androidAsset}`);
  }
  if (windowsAsset && !fs.existsSync(path.join(releaseRoot, 'win', windowsAsset))) {
    throw new Error(`Windows release asset is missing from releases/win: ${windowsAsset}`);
  }
}

console.log(`Verified Easy Commercial ${version} installer, APK, and updater metadata.`);
