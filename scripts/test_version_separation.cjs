const assert = require('assert');
const { deviceUpdateState } = require('../electron/versioning.cjs');

const databaseSchemaVersion = 12;
const deviceA = deviceUpdateState({
  installedVersion: '1.4.3',
  latestVersion: '1.4.3',
  databaseSchemaVersion,
});
const deviceB = deviceUpdateState({
  installedVersion: '1.4.2',
  latestVersion: '1.4.3',
  databaseSchemaVersion,
});

assert.equal(deviceA.updateAvailable, false);
assert.equal(deviceB.updateAvailable, true);
assert.equal(deviceA.installedVersion, '1.4.3');
assert.equal(deviceB.installedVersion, '1.4.2');
assert.equal(deviceA.databaseSchemaVersion, deviceB.databaseSchemaVersion);

const newerDatabase = deviceUpdateState({
  installedVersion: '1.4.2',
  latestVersion: '1.4.3',
  databaseSchemaVersion: 99,
});
assert.equal(newerDatabase.installedVersion, '1.4.2');
assert.equal(newerDatabase.updateAvailable, true);

console.log('Installed, release, and database versions remain independent per device.');
