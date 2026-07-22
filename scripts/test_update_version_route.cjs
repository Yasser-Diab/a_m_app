const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { createServer } = require('../server/index.cjs');

function requestJson(port, route) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${route}`, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try {
          resolve({ status: response.statusCode, data: JSON.parse(body) });
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });
}

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-version-route-'));
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('api.github.com/repos/')) {
      return {
        ok: true,
        status: 200,
        json: async () => [
          { tag_name: 'v1.5.0', draft: false, prerelease: true, assets: [] },
          { tag_name: 'v1.4.9', draft: true, prerelease: false, assets: [] },
          {
            tag_name: 'v1.4.3',
            draft: false,
            prerelease: false,
            published_at: '2026-07-15T00:00:00Z',
            html_url: 'https://github.com/Yasser-Diab/a_m_app/releases/tag/v1.4.3',
            assets: [
              {
                name: 'AccountingManagement-Setup-1.4.3.exe',
                browser_download_url: 'https://example.test/AccountingManagement-Setup-1.4.3.exe',
              },
            ],
          },
        ],
        text: async () => '',
      };
    }
    return originalFetch(url);
  };

  let api;
  let httpServer;
  try {
    api = await createServer({ dataDir, port: 0 });
    httpServer = await api.listen(0, '127.0.0.1');
    const port = httpServer.address().port;
    const health = await requestJson(port, '/api/health');
    assert.equal(health.data.serverVersion, '1.4.3');
    assert.equal(health.data.databaseSchemaVersion, 12);

    const oldDevice = await requestJson(
      port,
      '/api/update/latest?platform=win32&installed_version=1.4.2',
    );
    const currentDevice = await requestJson(
      port,
      '/api/update/latest?platform=win32&installed_version=1.4.3',
    );
    assert.equal(oldDevice.data.installedVersion, '1.4.2');
    assert.equal(oldDevice.data.latestVersion, '1.4.3');
    assert.equal(oldDevice.data.updateAvailable, true);
    assert.equal(currentDevice.data.installedVersion, '1.4.3');
    assert.equal(currentDevice.data.updateAvailable, false);
  } finally {
    await new Promise((resolve) => httpServer?.close(resolve) || resolve());
    await api?.close?.();
    global.fetch = originalFetch;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  console.log('Per-device update route and database schema version verified.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
