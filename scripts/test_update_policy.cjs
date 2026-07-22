const assert = require('assert');
const {
  friendlyUpdaterError,
  releaseUpdatePreflight,
} = require('../electron/update-policy.cjs');

const oldAssetlessRelease = {
  tag_name: 'v1.4.2',
  draft: false,
  prerelease: false,
  assets: [],
};
assert.deepEqual(
  releaseUpdatePreflight({
    installedVersion: '1.4.3',
    release: oldAssetlessRelease,
  }).status,
  'current',
);

const incompleteNewRelease = releaseUpdatePreflight({
  installedVersion: '1.4.2',
  release: { ...oldAssetlessRelease, tag_name: 'v1.4.3' },
});
assert.equal(incompleteNewRelease.status, 'error');
assert.equal(incompleteNewRelease.updateAvailable, true);
assert.doesNotMatch(incompleteNewRelease.error, /https?:|stack|HttpError/i);

const completeNewRelease = releaseUpdatePreflight({
  installedVersion: '1.4.2',
  release: {
    ...oldAssetlessRelease,
    tag_name: 'v1.4.3',
    assets: [{ name: 'latest.yml' }, { name: 'AccountingManagement-Setup-1.4.3.exe' }],
  },
});
assert.equal(completeNewRelease.status, 'available');

const sanitized = friendlyUpdaterError(
  new Error('Cannot find latest.yml: HttpError: 404 headers: secret stack'),
);
assert.doesNotMatch(sanitized, /404|headers|stack|https?:/i);

console.log('Updater release preflight and safe error presentation verified.');
