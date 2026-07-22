const assert = require('node:assert/strict');
const {
  inferConnectionMode,
  startupConnectionPlan,
} = require('../electron/connection-config.cjs');

const tunnel = startupConnectionPlan(
  {
    connectionMode: 'remote',
    serverUrl: 'https://offers.yasserdiab.site/',
    startServerOnLaunch: true,
  },
  ['http://192.168.137.1:4181', 'http://127.0.0.1:4181'],
);
assert.equal(tunnel.connectionMode, 'remote');
assert.equal(tunnel.remotePinned, true);
assert.equal(tunnel.startLocalServer, false);
assert.deepEqual(tunnel.candidates, ['https://offers.yasserdiab.site']);

const unavailableTunnel = startupConnectionPlan(
  { connectionMode: 'remote', serverUrl: 'https://offline.example.test' },
  ['http://127.0.0.1:4181'],
);
assert.equal(unavailableTunnel.serverUrl, 'https://offline.example.test');
assert.deepEqual(unavailableTunnel.candidates, ['https://offline.example.test']);

const local = startupConnectionPlan(
  { connectionMode: 'local', startServerOnLaunch: true },
  ['http://127.0.0.1:4181'],
);
assert.equal(local.remotePinned, false);
assert.equal(local.startLocalServer, true);
assert.deepEqual(local.candidates, ['http://127.0.0.1:4181']);

assert.equal(inferConnectionMode('http://127.0.0.1:4181'), 'local');
assert.equal(inferConnectionMode('https://offers.yasserdiab.site'), 'remote');
assert.equal(
  inferConnectionMode('http://192.168.137.1:4181', '', ['http://192.168.137.1:4181']),
  'local',
);

console.log('Server connection persistence regression tests passed.');
