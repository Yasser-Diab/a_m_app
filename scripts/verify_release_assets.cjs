const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const version = require(path.join(root, 'package.json')).version;
const output = path.join(root, 'dist-installer', 'AccountingManagement');
const required = [
  `AccountingManagement-Setup-${version}.exe`,
  `AccountingManagement-Setup-${version}.exe.blockmap`,
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
if (!metadata.includes(`AccountingManagement-Setup-${version}.exe`)) {
  throw new Error('latest.yml installer path does not match the packaged installer.');
}

console.log(`Verified Accounting Management ${version} installer and updater metadata.`);
