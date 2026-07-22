const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const builder = fs.readFileSync(path.join(root, 'electron-builder.variant.cjs'), 'utf8');
const installer = fs.readFileSync(path.join(root, 'build', 'installer.nsh'), 'utf8');

assert.equal((main.match(/requestSingleInstanceLock\s*\(/g) || []).length, 1);
assert.match(main, /function\s+prepareForShutdown\s*\(/);
assert.match(main, /function\s+shutdownApplication\s*\(/);
assert.match(main, /function\s+quitFromTray[\s\S]*?shutdownApplication\('Tray exit selected'\)/);
assert.match(main, /await\s+stopLocalServer\(\)/);
assert.match(main, /tray\.destroy\(\)/);
assert.match(main, /globalShortcut\.unregisterAll\(\)/);
assert.match(main, /app\.exit\(0\)/);
assert.match(main, /argv\.includes\('--shutdown-for-update'\)/);
assert.match(main, /const APP_VERSION = app\.getVersion\(\)/);
assert.match(preload, /app-update:check/);
assert.match(preload, /app-update:install/);
assert.match(builder, /com\.sherifalihassan\.priceoffer|baseAppId/);
assert.match(builder, /latest/);
assert.match(installer, /--shutdown-for-update/);
assert.match(installer, /taskkill \/F/);

console.log('Desktop shutdown, single-instance, installer, and updater lifecycle wiring verified.');
