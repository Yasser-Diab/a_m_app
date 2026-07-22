const path = require('path');
const fs = require('fs');
const net = require('net');
const http = require('http');
const https = require('https');
const { execFile } = require('child_process');
const { app, BrowserWindow, Menu, Tray, Notification, dialog, globalShortcut, ipcMain, screen, session, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const { createServer, getLanIps } = require('../server/index.cjs');
const {
  inferConnectionMode,
  startupConnectionPlan,
} = require('./connection-config.cjs');
const { compareVersions } = require('./versioning.cjs');
const {
  friendlyUpdaterError,
  releaseUpdatePreflight,
} = require('./update-policy.cjs');

let apiServer;
let httpServer;
let mainWindow;
let tray;
let isQuitting = false;
let pendingSection = '';
let windowStateSaveTimer;
let serverStartPromise;
let shutdownPromise;
let shutdownPrepared = false;
let shutdownForceTimer;
let updateStartupTimer;
let updateCheckPromise;
let updaterConfigured = false;
const gotSingleInstanceLock = app.requestSingleInstanceLock();
const shutdownRequestedByArgument = process.argv.includes('--shutdown-for-update');

const DEFAULT_LAN_HOST = process.env.PRICE_OFFER_DEFAULT_HOST || '192.168.137.1';
const DEFAULT_PORT = Number(process.env.PRICE_OFFER_PORT || 4181);
const DEFAULT_TUNNEL_URL = process.env.PRICE_OFFER_TUNNEL_URL || '';
const APP_ID = 'com.sherifalihassan.priceoffer';
const APP_VERSION = app.getVersion();
const UPDATE_REPOSITORY = process.env.AM_UPDATE_REPOSITORY || 'Yasser-Diab/a_m_app';
const WINDOWS_EXTERNAL_DATA_DIR = 'D:\\AM_Data';
const SERVER_PROBE_TIMEOUT_MS = 1800;
const WINDOW_MIN_WIDTH = 1040;
const WINDOW_MIN_HEIGHT = 680;
const DESKTOP_SETTINGS_DEFAULTS = {
  startServerOnLaunch: true,
  connectionMode: 'local',
  serverUrl: '',
  openAtLogin: false,
  reportSaveDirectory: '',
  lastReportSaveDirectory: '',
  openPdfAfterSaving: false,
  window: {
    width: 1320,
    height: 860,
    isMaximized: false,
    isFullScreen: false,
  },
};
const NAVIGATION_SECTIONS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'entry', label: 'Entry / Edit' },
  { id: 'offer', label: 'Price Offers' },
  { id: 'invoice', label: 'Invoices' },
  { id: 'statement', label: 'Account Statement' },
  { id: 'payments', label: 'Payments' },
  { id: 'contractor', label: 'Contractors' },
  { id: 'quantities', label: 'Produced Quantities' },
  { id: 'settings', label: 'Settings' },
];

let applicationUpdateState = {
  status: 'idle',
  installedVersion: APP_VERSION,
  currentVersion: APP_VERSION,
  latestVersion: '',
  updateAvailable: false,
  canInstall: false,
  downloadPercent: 0,
  error: '',
  checkedAt: '',
};

if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

function cleanApiBase(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function unique(values) {
  return [...new Set(values.map(cleanApiBase).filter(Boolean))];
}

function publicUpdateState() {
  return {
    ...applicationUpdateState,
    installedVersion: APP_VERSION,
    currentVersion: APP_VERSION,
  };
}

function publishUpdateState(patch = {}) {
  applicationUpdateState = {
    ...applicationUpdateState,
    ...patch,
    installedVersion: APP_VERSION,
    currentVersion: APP_VERSION,
  };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app-update:state', publicUpdateState());
  }
  return publicUpdateState();
}

function fetchLatestPublishedRelease() {
  return new Promise((resolve, reject) => {
    const request = https.get(
      {
        hostname: 'api.github.com',
        path: `/repos/${UPDATE_REPOSITORY}/releases/latest`,
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `Accounting-Management/${APP_VERSION}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        timeout: 10000,
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => {
          if (response.statusCode !== 200) {
            reject(new Error(`GitHub release check returned ${response.statusCode}.`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on('timeout', () => request.destroy(new Error('Update check timed out.')));
    request.on('error', reject);
  });
}

function configureApplicationUpdater() {
  if (updaterConfigured) return;
  updaterConfigured = true;
  autoUpdater.logger = console;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.channel = 'latest';

  autoUpdater.on('checking-for-update', () => {
    publishUpdateState({
      status: 'checking',
      error: '',
      checkedAt: new Date().toISOString(),
    });
  });
  autoUpdater.on('update-available', (info = {}) => {
    publishUpdateState({
      status: 'available',
      latestVersion: String(info.version || ''),
      updateAvailable: compareVersions(info.version, APP_VERSION) > 0,
      canInstall: false,
      error: '',
    });
  });
  autoUpdater.on('download-progress', (progress = {}) => {
    publishUpdateState({
      status: 'downloading',
      downloadPercent: Math.max(0, Math.min(100, Number(progress.percent) || 0)),
      updateAvailable: true,
      canInstall: false,
    });
  });
  autoUpdater.on('update-downloaded', (info = {}) => {
    publishUpdateState({
      status: 'downloaded',
      latestVersion: String(info.version || applicationUpdateState.latestVersion || ''),
      downloadPercent: 100,
      updateAvailable: true,
      canInstall: true,
      error: '',
    });
  });
  autoUpdater.on('update-not-available', (info = {}) => {
    publishUpdateState({
      status: 'current',
      latestVersion: String(info.version || APP_VERSION),
      updateAvailable: false,
      canInstall: false,
      downloadPercent: 0,
      error: '',
    });
  });
  autoUpdater.on('error', (error) => {
    console.error('[Updater]', error?.stack || error);
    publishUpdateState({
      status: 'error',
      updateAvailable: false,
      canInstall: false,
      error: friendlyUpdaterError(error),
    });
  });
  autoUpdater.on('before-quit-for-update', () => {
    isQuitting = true;
    shutdownLog('Updater requested application quit');
  });
}

async function checkForApplicationUpdates({ manual = false } = {}) {
  configureApplicationUpdater();
  if (!app.isPackaged) {
    return publishUpdateState({
      status: manual ? 'error' : 'idle',
      latestVersion: '',
      updateAvailable: false,
      canInstall: false,
      checkedAt: new Date().toISOString(),
      error: manual ? 'Automatic updates are checked by packaged installations.' : '',
    });
  }
  if (updateCheckPromise) return updateCheckPromise;
  if (['available', 'downloading', 'downloaded'].includes(applicationUpdateState.status)) {
    return publicUpdateState();
  }
  updateCheckPromise = (async () => {
    publishUpdateState({ status: 'checking', error: '' });
    const release = await fetchLatestPublishedRelease();
    const preflight = releaseUpdatePreflight({
      installedVersion: APP_VERSION,
      release,
    });
    if (preflight.status === 'current' || preflight.status === 'error') {
      return publishUpdateState({
        ...preflight,
        checkedAt: new Date().toISOString(),
        downloadPercent: 0,
      });
    }
    publishUpdateState(preflight);
    const result = await autoUpdater.checkForUpdates();
    const info = result?.updateInfo || {};
    if (info.version && !['available', 'downloading', 'downloaded'].includes(applicationUpdateState.status)) {
      const available = compareVersions(info.version, APP_VERSION) > 0;
      publishUpdateState({
        status: available ? 'available' : 'current',
        latestVersion: String(info.version),
        updateAvailable: available,
        canInstall: false,
      });
    }
    result?.downloadPromise?.catch((error) => {
      publishUpdateState({
        status: 'error',
        error: friendlyUpdaterError(error),
        canInstall: false,
      });
    });
    return publicUpdateState();
  })()
    .catch((error) =>
      publishUpdateState({
        status: 'error',
        updateAvailable: false,
        canInstall: false,
        error: friendlyUpdaterError(error),
      }),
    )
    .finally(() => {
      updateCheckPromise = null;
    });
  return updateCheckPromise;
}

function defaultServerUrl(port = DEFAULT_PORT) {
  return `http://${DEFAULT_LAN_HOST}:${port}`;
}

function serverCandidates(port = DEFAULT_PORT, preferred = '') {
  return unique([
    preferred,
    process.env.PRICE_OFFER_API_BASE,
    process.env.PRICE_OFFER_SERVER_URL,
    defaultServerUrl(port),
    DEFAULT_TUNNEL_URL,
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
  ]);
}

function compatibleServerAt(apiBase) {
  return new Promise((resolve) => {
    const clean = cleanApiBase(apiBase);
    if (!clean) {
      resolve(null);
      return;
    }
    let parsed;
    try {
      parsed = new URL('/api/health', clean);
    } catch {
      resolve(null);
      return;
    }
    const transport = parsed.protocol === 'https:' ? https : http;
    const request = transport.get(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        timeout: SERVER_PROBE_TIMEOUT_MS,
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => {
          try {
            const data = JSON.parse(body);
            resolve(response.statusCode === 200 &&
              data?.app === 'Accounting Management' &&
              compareVersions(data.version, APP_VERSION) >= 0
              ? { apiBase: clean, health: data }
              : null);
          } catch {
            resolve(null);
          }
        });
      },
    );
    request.on('timeout', () => {
      request.destroy();
      resolve(null);
    });
    request.on('error', () => resolve(null));
  });
}

async function findCompatibleServer(candidates) {
  if (!candidates.length) return null;
  return new Promise((resolve) => {
    let pending = candidates.length;
    let settled = false;
    for (const candidate of candidates) {
      compatibleServerAt(candidate).then((result) => {
        pending -= 1;
        if (!settled && result) {
          settled = true;
          resolve(result);
          return;
        }
        if (!settled && pending === 0) resolve(null);
      });
    }
  });
}

function runPowerShellConnectionStatus(serverUrl) {
  if (process.platform !== 'win32') {
    return Promise.resolve({ ok: false, error: 'PowerShell diagnostics are available on Windows only.' });
  }
  let parsed;
  try {
    parsed = new URL(cleanApiBase(serverUrl));
  } catch {
    return Promise.resolve({ ok: false, error: 'The configured server URL is invalid.' });
  }
  const host = parsed.hostname;
  const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
  const command = `
$ErrorActionPreference = 'SilentlyContinue'
$hostValue = ${JSON.stringify(host)}
$portValue = ${port}
$dnsRows = @(Resolve-DnsName -Name $hostValue -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress } |
  Select-Object Name, Type, IPAddress)
$tcpClient = New-Object System.Net.Sockets.TcpClient
$tcpSucceeded = $false
$remoteAddress = ''
$sourceAddress = ''
try {
  $connectTask = $tcpClient.ConnectAsync($hostValue, $portValue)
  $tcpSucceeded = $connectTask.Wait(5000) -and $tcpClient.Connected
  if ($tcpSucceeded) {
    $remoteAddress = "$($tcpClient.Client.RemoteEndPoint)"
    $sourceAddress = "$($tcpClient.Client.LocalEndPoint)"
  }
} catch {
  $tcpSucceeded = $false
} finally {
  $tcpClient.Dispose()
}
$connections = @(Get-NetTCPConnection -RemotePort $portValue -State Established -ErrorAction SilentlyContinue |
  Select-Object LocalAddress, LocalPort, RemoteAddress, RemotePort, State, OwningProcess)
[pscustomobject]@{
  GeneratedAt = (Get-Date).ToString('o')
  ComputerName = $hostValue
  RemotePort = $portValue
  NameResolutionSucceeded = [bool]($dnsRows.Count)
  TcpTestSucceeded = [bool]$tcpSucceeded
  RemoteAddress = $remoteAddress
  SourceAddress = $sourceAddress
  Dns = $dnsRows
  EstablishedConnections = $connections
} | ConvertTo-Json -Depth 6
`;
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { timeout: 10000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          resolve({ ok: false, error: error.message, stderr: String(stderr || '').trim() });
          return;
        }
        try {
          resolve({ ok: true, data: JSON.parse(String(stdout || '{}')) });
        } catch (parseError) {
          resolve({ ok: false, error: parseError.message, stdout: String(stdout || '').trim() });
        }
      },
    );
  });
}

function formatClientConnectionStatus(serverUrl, detectedServer, powerShell) {
  const health = detectedServer?.health || {};
  const lines = [
    'Accounting Management client connection status',
    `Generated: ${new Date().toISOString()}`,
    'Connection mode: REMOTE SERVER / TUNNEL',
    `Configured server: ${serverUrl}`,
    'Pinned server: Yes (no automatic local-server fallback)',
    `API health: ${detectedServer ? 'Connected' : 'Unavailable'}`,
    `Remote app version: ${health.version || '-'}`,
    'Database: Managed by the remote server; no database path is required on this computer.',
  ];
  if (powerShell?.ok && powerShell.data) {
    const data = powerShell.data;
    const dnsRows = Array.isArray(data.Dns) ? data.Dns : data.Dns ? [data.Dns] : [];
    const connections = Array.isArray(data.EstablishedConnections)
      ? data.EstablishedConnections
      : data.EstablishedConnections
        ? [data.EstablishedConnections]
        : [];
    lines.push('');
    lines.push('PowerShell client network diagnostics:');
    lines.push(`  Host: ${data.ComputerName || ''}`);
    lines.push(`  Port: ${data.RemotePort || ''}`);
    lines.push(`  DNS resolved: ${data.NameResolutionSucceeded ? 'Yes' : 'No'}`);
    for (const row of dnsRows) lines.push(`  DNS: ${row.IPAddress || ''}`);
    lines.push(`  TCP connected: ${data.TcpTestSucceeded ? 'Yes' : 'No'}`);
    lines.push(`  Remote address: ${data.RemoteAddress || ''}`);
    lines.push(`  Client address: ${data.SourceAddress || ''}`);
    lines.push('  Established client connections:');
    if (!connections.length) lines.push('    - None currently reported.');
    for (const row of connections) {
      lines.push(
        `    - ${row.LocalAddress || ''}:${row.LocalPort || ''} -> ` +
          `${row.RemoteAddress || ''}:${row.RemotePort || ''} ${row.State || ''}`,
      );
    }
  } else {
    lines.push('');
    lines.push(`PowerShell client diagnostics unavailable: ${powerShell?.error || 'Unknown error'}`);
  }
  return lines.join('\n');
}

async function clientConnectionStatus(serverUrl) {
  const clean = cleanApiBase(serverUrl);
  if (!clean) throw new Error('A server URL is required.');
  const [detectedServer, powerShell] = await Promise.all([
    compatibleServerAt(clean),
    runPowerShellConnectionStatus(clean),
  ]);
  return {
    ok: !!detectedServer,
    connectionMode: 'remote',
    serverUrl: clean,
    configuredServerUrl: clean,
    connected: !!detectedServer,
    health: detectedServer?.health || null,
    powerShell,
    text: formatClientConnectionStatus(clean, detectedServer, powerShell),
  };
}

function portIsAvailable(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => {
      probe.close(() => resolve(true));
    });
  });
}

async function availablePort(preferredPort) {
  for (let port = preferredPort; port < preferredPort + 30; port += 1) {
    if (await portIsAvailable(port)) return port;
  }
  throw new Error(`No available local port between ${preferredPort} and ${preferredPort + 29}.`);
}

function compatibleServerIsRunning(port) {
  return compatibleServerAt(`http://127.0.0.1:${port}`).then(Boolean);
}

function writeStartupError(error) {
  try {
    const logDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(
      path.join(logDir, 'startup-error.log'),
      `${new Date().toISOString()}\n${error?.stack || error}\n`,
      'utf8',
    );
  } catch {
    // The visible error dialog remains the fallback if logging is unavailable.
  }
}

function shutdownLog(message, details = null) {
  const suffix = details == null
    ? ''
    : ` ${typeof details === 'string' ? details : JSON.stringify(details)}`;
  const line = `${new Date().toISOString()} [Shutdown] ${message}${suffix}`;
  console.log(line);
  try {
    const logDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, 'shutdown.log'), `${line}\n`, 'utf8');
  } catch {
    // Console logging remains available when the data directory cannot be written.
  }
}

function desktopSettingsPath() {
  return path.join(app.getPath('userData'), 'desktop-settings.json');
}

function normalizeDesktopSettings(settings = {}) {
  const windowSettings = settings.window && typeof settings.window === 'object'
    ? settings.window
    : {};
  return {
    ...DESKTOP_SETTINGS_DEFAULTS,
    ...settings,
    startServerOnLaunch: settings.startServerOnLaunch !== false,
    connectionMode: inferConnectionMode(
      settings.serverUrl || settings.apiBase,
      settings.connectionMode,
      [defaultServerUrl(DEFAULT_PORT), `http://127.0.0.1:${DEFAULT_PORT}`, `http://localhost:${DEFAULT_PORT}`],
    ),
    serverUrl: cleanApiBase(settings.serverUrl || settings.apiBase),
    openAtLogin: !!settings.openAtLogin,
    reportSaveDirectory: String(settings.reportSaveDirectory || ''),
    lastReportSaveDirectory: String(settings.lastReportSaveDirectory || ''),
    openPdfAfterSaving: !!settings.openPdfAfterSaving,
    window: {
      ...DESKTOP_SETTINGS_DEFAULTS.window,
      ...windowSettings,
      width: Math.max(WINDOW_MIN_WIDTH, Number(windowSettings.width) || DESKTOP_SETTINGS_DEFAULTS.window.width),
      height: Math.max(WINDOW_MIN_HEIGHT, Number(windowSettings.height) || DESKTOP_SETTINGS_DEFAULTS.window.height),
      x: Number.isFinite(Number(windowSettings.x)) ? Number(windowSettings.x) : undefined,
      y: Number.isFinite(Number(windowSettings.y)) ? Number(windowSettings.y) : undefined,
      isMaximized: !!windowSettings.isMaximized,
      isFullScreen: !!windowSettings.isFullScreen,
    },
  };
}

function readDesktopSettings() {
  try {
    const filePath = desktopSettingsPath();
    if (!fs.existsSync(filePath)) return normalizeDesktopSettings();
    return normalizeDesktopSettings(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch {
    return normalizeDesktopSettings();
  }
}

function writeDesktopSettings(settings) {
  const normalized = normalizeDesktopSettings(settings);
  fs.mkdirSync(path.dirname(desktopSettingsPath()), { recursive: true });
  fs.writeFileSync(desktopSettingsPath(), `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return normalized;
}

function supportsOpenAtLogin() {
  return process.platform === 'win32' || process.platform === 'darwin';
}

function applyOpenAtLoginSetting(settings = readDesktopSettings()) {
  if (!supportsOpenAtLogin()) return;
  try {
    app.setLoginItemSettings({
      openAtLogin: !!settings.openAtLogin,
      path: process.execPath,
      args: [],
    });
  } catch (error) {
    writeStartupError(error);
  }
}

function publicDesktopSettings(settings = readDesktopSettings()) {
  let loginItem = {};
  try {
    loginItem = supportsOpenAtLogin()
      ? app.getLoginItemSettings({ path: process.execPath, args: [] })
      : {};
  } catch {
    loginItem = {};
  }
  return {
    ...normalizeDesktopSettings(settings),
    supportsOpenAtLogin: supportsOpenAtLogin(),
    loginItemOpenAtLogin: !!loginItem.openAtLogin,
    settingsPath: desktopSettingsPath(),
  };
}

function sendDesktopSettingsChanged(settings = readDesktopSettings()) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('desktop:settings-changed', publicDesktopSettings(settings));
}

function updateDesktopSettings(patch = {}, options = {}) {
  const current = readDesktopSettings();
  const next = normalizeDesktopSettings({
    ...current,
    ...patch,
    window: {
      ...(current.window || {}),
      ...(patch.window || {}),
    },
  });
  const saved = writeDesktopSettings(next);
  if (options.apply !== false) {
    applyOpenAtLoginSetting(saved);
    updateTrayMenu();
    updateApplicationMenu();
    sendDesktopSettingsChanged(saved);
  }
  return publicDesktopSettings(saved);
}

function boundsAreVisible(bounds) {
  if (!bounds || !Number.isFinite(Number(bounds.x)) || !Number.isFinite(Number(bounds.y))) {
    return false;
  }
  const left = Number(bounds.x);
  const top = Number(bounds.y);
  const right = left + Number(bounds.width || WINDOW_MIN_WIDTH);
  const bottom = top + Number(bounds.height || WINDOW_MIN_HEIGHT);
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return right > area.x && left < area.x + area.width && bottom > area.y && top < area.y + area.height;
  });
}

function restoredWindowOptions() {
  const state = readDesktopSettings().window || {};
  const bounds = {
    x: Number.isFinite(Number(state.x)) ? Number(state.x) : undefined,
    y: Number.isFinite(Number(state.y)) ? Number(state.y) : undefined,
    width: Math.max(WINDOW_MIN_WIDTH, Number(state.width) || DESKTOP_SETTINGS_DEFAULTS.window.width),
    height: Math.max(WINDOW_MIN_HEIGHT, Number(state.height) || DESKTOP_SETTINGS_DEFAULTS.window.height),
  };
  if (!boundsAreVisible(bounds)) {
    delete bounds.x;
    delete bounds.y;
  }
  return bounds;
}

function currentWindowState(win = mainWindow) {
  if (!win || win.isDestroyed()) return readDesktopSettings().window;
  const bounds = win.isMaximized() || win.isFullScreen() ? win.getNormalBounds() : win.getBounds();
  return {
    ...bounds,
    isMaximized: win.isMaximized(),
    isFullScreen: win.isFullScreen(),
  };
}

function saveWindowStateNow(win = mainWindow) {
  if (!win || win.isDestroyed()) return;
  updateDesktopSettings({ window: currentWindowState(win) }, { apply: false });
}

function queueWindowStateSave(win = mainWindow) {
  if (!win || win.isDestroyed()) return;
  clearTimeout(windowStateSaveTimer);
  windowStateSaveTimer = setTimeout(() => saveWindowStateNow(win), 250);
}

function trayIconPath() {
  const variantIcon = path.join(__dirname, '..', 'build', 'variants', 'main.ico');
  if (fs.existsSync(variantIcon)) return variantIcon;
  return path.join(__dirname, '..', 'build', 'icon.ico');
}

function sendNavigate(section) {
  if (!section || !mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.webContents.isLoading()) {
    pendingSection = section;
    return;
  }
  mainWindow.webContents.send('desktop:navigate', section);
}

function showMainWindow(section = '') {
  if (isQuitting) return;
  if (section) pendingSection = section;
  if (!mainWindow) {
    createWindow().catch(writeStartupError);
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (pendingSection) {
    const nextSection = pendingSection;
    pendingSection = '';
    setTimeout(() => sendNavigate(nextSection), 50);
  }
}

function quitFromTray() {
  shutdownLog('Tray exit selected');
  shutdownApplication('Tray exit selected').catch((error) => {
    shutdownLog('Tray shutdown failed', { error: error?.stack || String(error) });
    app.exit(1);
  });
}

function serverInfo(port = Number(process.env.PRICE_OFFER_PORT || DEFAULT_PORT)) {
  const dataDir = apiServer?.dataDir || process.env.PRICE_OFFER_DATA_DIR || desktopDataDir();
  const dbPath = apiServer?.dbPath || path.join(dataDir, 'price_offer.db');
  const lanUrls = unique([
    defaultServerUrl(port),
    ...getLanIps().map((ip) => `http://${ip}:${port}`),
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
  ]);
  return {
    ok: true,
    port,
    apiBase: defaultServerUrl(port),
    serverUrl: defaultServerUrl(port),
    localUrl: `http://127.0.0.1:${port}`,
    lanUrls,
    dataDir,
    dbPath,
    running: !!httpServer,
  };
}

async function stopLocalServer() {
  const activeHttpServer = httpServer;
  const activeApiServer = apiServer;
  httpServer = null;
  apiServer = null;
  if (activeHttpServer) {
    await new Promise((resolve) => {
      let resolved = false;
      const finish = () => {
        if (resolved) return;
        resolved = true;
        resolve();
      };
      const timeout = setTimeout(() => {
        activeHttpServer.closeAllConnections?.();
        finish();
      }, 2500);
      timeout.unref?.();
      activeHttpServer.closeIdleConnections?.();
      try {
        activeHttpServer.close(() => {
          clearTimeout(timeout);
          finish();
        });
      } catch {
        clearTimeout(timeout);
        finish();
      }
    });
  }
  await activeApiServer?.close?.();
  updateTrayMenu();
  updateApplicationMenu();
}

function activeResourceSummary() {
  const handles = typeof process._getActiveHandles === 'function'
    ? process._getActiveHandles().map((handle) => handle?.constructor?.name || 'Unknown')
    : [];
  return {
    pid: process.pid,
    processName: path.basename(process.execPath),
    handles,
    timeoutMs: 5000,
  };
}

async function prepareForShutdown(reason = 'Application exit') {
  if (shutdownPromise) return shutdownPromise;
  isQuitting = true;
  shutdownLog('Quitting flag enabled', { reason });
  shutdownPromise = (async () => {
    clearTimeout(windowStateSaveTimer);
    clearTimeout(updateStartupTimer);
    windowStateSaveTimer = null;
    updateStartupTimer = null;
    saveWindowStateNow();
    globalShortcut.unregisterAll();
    if (serverStartPromise) {
      shutdownLog('Waiting for in-progress server startup');
      await Promise.race([
        serverStartPromise.catch(() => null),
        new Promise((resolve) => {
          const timer = setTimeout(resolve, 3000);
          timer.unref?.();
        }),
      ]);
    }
    await stopLocalServer();
    shutdownLog('Database subscriptions and local server closed');
    if (tray && !tray.isDestroyed()) tray.destroy();
    tray = null;
    shutdownLog('Tray destroyed');
    shutdownPrepared = true;
  })();
  try {
    await shutdownPromise;
  } catch (error) {
    shutdownLog('Cleanup completed with an error', { error: error?.stack || String(error) });
    shutdownPrepared = true;
  }
}

function scheduleForcedExit(reason) {
  clearTimeout(shutdownForceTimer);
  shutdownForceTimer = setTimeout(() => {
    shutdownLog('Force-exit timeout reached', { reason, ...activeResourceSummary() });
    app.exit(0);
  }, 5000);
  shutdownForceTimer.unref?.();
}

async function shutdownApplication(reason = 'Application exit') {
  scheduleForcedExit(reason);
  await prepareForShutdown(reason);
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.destroy();
  }
  shutdownLog('Windows destroyed');
  shutdownLog('app.quit requested');
  app.quit();
}

async function installDownloadedUpdate() {
  if (!applicationUpdateState.canInstall || applicationUpdateState.status !== 'downloaded') {
    throw new Error('The update has not finished downloading yet.');
  }
  scheduleForcedExit('Install downloaded update');
  await prepareForShutdown('Install downloaded update');
  shutdownLog('Calling updater quitAndInstall');
  autoUpdater.quitAndInstall(false, true);
  return publicUpdateState();
}

async function startLocalServerOnce(options = {}) {
  if (httpServer) {
    const requestedDataDir = options.dataDir
      ? path.resolve(String(options.dataDir))
      : apiServer?.dataDir;
    const requestedDbPath = options.dbPath
      ? path.resolve(String(options.dbPath))
      : apiServer?.dbPath;
    const switchingDatabase =
      !!options.restart ||
      (requestedDataDir && path.resolve(requestedDataDir) !== path.resolve(apiServer?.dataDir || '')) ||
      (requestedDbPath && path.resolve(requestedDbPath) !== path.resolve(apiServer?.dbPath || ''));
    if (switchingDatabase) {
      await stopLocalServer();
    } else {
      return {
        ...serverInfo(Number(process.env.PRICE_OFFER_PORT || DEFAULT_PORT)),
        alreadyRunning: true,
        message: 'Local server is already running.',
      };
    }
  }

  const requestedPort = Number(options.port || process.env.PRICE_OFFER_PORT || DEFAULT_PORT);
  const preferredPort = Number.isFinite(requestedPort) && requestedPort > 0
    ? requestedPort
    : DEFAULT_PORT;
  let port = preferredPort;
  if (!(await portIsAvailable(port))) {
    const existingServer = await compatibleServerAt(`http://127.0.0.1:${port}`);
    if (existingServer) {
      return {
        ...serverInfo(port),
        apiBase: existingServer.apiBase,
        localUrl: existingServer.apiBase,
        alreadyRunning: true,
        message: 'A compatible local server is already running.',
      };
    }
    port = await availablePort(preferredPort + 1);
  }

  const dataDir = options.dataDir ? path.resolve(String(options.dataDir)) : desktopDataDir();
  if (!dataDirIsWritable(dataDir)) {
    throw new Error(`Data folder is not writable: ${dataDir}`);
  }

  migrateLegacyDataDir(dataDir);
  process.env.PRICE_OFFER_DATA_DIR = dataDir;
  process.env.PRICE_OFFER_PORT = String(port);
  const dbPath = options.dbPath ? path.resolve(String(options.dbPath)) : undefined;
  apiServer = await createServer({
    port,
    dataDir,
    ...(dbPath ? { dbPath } : {}),
  });
  httpServer = await apiServer.listen(port, '0.0.0.0');
  httpServer.on('close', () => {
    httpServer = null;
    apiServer = null;
    updateTrayMenu();
    updateApplicationMenu();
  });
  updateTrayMenu();
  updateApplicationMenu();
  const info = serverInfo(port);
  mainWindow?.webContents?.send('desktop:server-started', info);
  return {
    ...info,
    message: 'Local server is running.',
  };
}

async function startLocalServer(options = {}) {
  if (serverStartPromise) return serverStartPromise;
  serverStartPromise = startLocalServerOnce(options)
    .then((result) => {
      updateDesktopSettings(
        {
          connectionMode: 'local',
          serverUrl: cleanApiBase(result.serverUrl || result.apiBase || result.localUrl),
        },
        { apply: false },
      );
      return result;
    })
    .catch((error) => {
      writeStartupError(error);
      throw new Error(`Local server could not start: ${error?.message || error}`);
    })
    .finally(() => {
      serverStartPromise = null;
    });
  return serverStartPromise;
}

function trayMenuTemplate() {
  const settings = readDesktopSettings();
  const serverRunning = !!httpServer;
  return [
    { label: 'Open Accounting Management', click: () => showMainWindow('dashboard') },
    { label: 'Open Settings', click: () => showMainWindow('settings') },
    { type: 'separator' },
    ...NAVIGATION_SECTIONS.map((section) => ({
      label: section.label,
      click: () => showMainWindow(section.id),
    })),
    { type: 'separator' },
    {
      label: serverRunning ? 'Local server is running' : 'Start local server',
      enabled: !serverRunning,
      click: () => startLocalServer().then((result) => showMainWindow('settings')).catch(writeStartupError),
    },
    {
      label: 'Start server when app opens',
      type: 'checkbox',
      checked: settings.startServerOnLaunch !== false,
      click: (menuItem) => updateDesktopSettings({ startServerOnLaunch: menuItem.checked }),
    },
    {
      label: process.platform === 'win32' ? 'Open at Windows sign-in' : 'Open at sign-in',
      type: 'checkbox',
      checked: !!settings.openAtLogin,
      enabled: supportsOpenAtLogin(),
      click: (menuItem) => updateDesktopSettings({ openAtLogin: menuItem.checked }),
    },
    { type: 'separator' },
    { label: 'Exit Accounting Management', click: quitFromTray },
  ];
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setToolTip(httpServer ? 'Accounting Management is running in the background' : 'Accounting Management');
  tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate()));
}

function ensureTray() {
  if (tray) return tray;
  tray = new Tray(trayIconPath());
  updateTrayMenu();
  tray.on('click', () => showMainWindow('dashboard'));
  tray.on('double-click', () => showMainWindow('dashboard'));
  return tray;
}

function updateApplicationMenu() {
  const settings = readDesktopSettings();
  const serverRunning = !!httpServer;
  const template = [
    {
      label: 'Accounting Management',
      submenu: [
        { label: 'Open App', click: () => showMainWindow('dashboard') },
        { label: 'Settings', click: () => showMainWindow('settings') },
        { type: 'separator' },
        {
          label: serverRunning ? 'Local Server Running' : 'Start Local Server',
          enabled: !serverRunning,
          click: () => startLocalServer().then(() => showMainWindow('settings')).catch(writeStartupError),
        },
        {
          label: 'Start Server When App Opens',
          type: 'checkbox',
          checked: settings.startServerOnLaunch !== false,
          click: (menuItem) => updateDesktopSettings({ startServerOnLaunch: menuItem.checked }),
        },
        {
          label: process.platform === 'win32' ? 'Open at Windows Sign-in' : 'Open at Sign-in',
          type: 'checkbox',
          checked: !!settings.openAtLogin,
          enabled: supportsOpenAtLogin(),
          click: (menuItem) => updateDesktopSettings({ openAtLogin: menuItem.checked }),
        },
        { type: 'separator' },
        { label: 'Hide to Tray', click: () => mainWindow?.hide() },
        { label: 'Exit', accelerator: 'CmdOrCtrl+Q', click: quitFromTray },
      ],
    },
    {
      label: 'Navigate',
      submenu: NAVIGATION_SECTIONS.map((section) => ({
        label: section.label,
        click: () => showMainWindow(section.id),
      })),
    },
    {
      label: 'Window',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.reload() },
        { label: 'Toggle Full Screen', accelerator: process.platform === 'darwin' ? 'Ctrl+Command+F' : 'F11', click: () => mainWindow?.setFullScreen(!mainWindow?.isFullScreen()) },
        { role: 'resetZoom', label: 'Reset Zoom' },
        { role: 'zoomIn', label: 'Zoom In' },
        { role: 'zoomOut', label: 'Zoom Out' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Open Data Folder', click: () => shell.openPath(apiServer?.dataDir || desktopDataDir()) },
        { label: 'Open Settings File', click: () => shell.openPath(desktopSettingsPath()) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function desktopDataDir() {
  if (process.env.PRICE_OFFER_DATA_DIR) {
    return path.resolve(process.env.PRICE_OFFER_DATA_DIR);
  }
  if (process.platform === 'win32' && fs.existsSync(WINDOWS_EXTERNAL_DATA_DIR)) {
    return WINDOWS_EXTERNAL_DATA_DIR;
  }
  return path.resolve(__dirname, '..', 'data');
}

function dataDirIsWritable(dataDir) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const probePath = path.join(dataDir, `.write-test-${process.pid}.tmp`);
    fs.writeFileSync(probePath, 'ok');
    fs.rmSync(probePath, { force: true });
    return true;
  } catch {
    return false;
  }
}

function migrateLegacyDataDir(targetDir) {
  const legacyDir = path.join(app.getPath('userData'), 'data');
  if (path.resolve(legacyDir) === path.resolve(targetDir)) return;
  const legacyDb = path.join(legacyDir, 'price_offer.db');
  const targetDb = path.join(targetDir, 'price_offer.db');
  if (!fs.existsSync(legacyDb)) return;
  fs.mkdirSync(targetDir, { recursive: true });
  if (!fs.existsSync(targetDb)) {
    fs.copyFileSync(legacyDb, targetDb);
  }
  const legacyUploads = path.join(legacyDir, 'chat_uploads');
  const targetUploads = path.join(targetDir, 'chat_uploads');
  if (fs.existsSync(legacyUploads) && !fs.existsSync(targetUploads)) {
    fs.cpSync(legacyUploads, targetUploads, { recursive: true });
  }
}

async function createWindow() {
  const preferredPort = Number(process.env.PRICE_OFFER_PORT || 4181);
  const desktopSettings = readDesktopSettings();
  const localServerUrls = [
    defaultServerUrl(preferredPort),
    `http://127.0.0.1:${preferredPort}`,
    `http://localhost:${preferredPort}`,
  ];
  const plan = startupConnectionPlan(
    { ...desktopSettings, localServerUrls },
    serverCandidates(preferredPort, desktopSettings.serverUrl),
  );
  const candidates = plan.candidates;
  const detectedServer = await findCompatibleServer(candidates);
  let apiBase = plan.remotePinned
    ? plan.serverUrl
    : detectedServer?.apiBase || candidates[0] || defaultServerUrl(preferredPort);
  let startupWarning = '';
  let clientOnly = plan.remotePinned || !!detectedServer;
  let port = preferredPort;
  let useExistingServer = clientOnly;
  if (!plan.remotePinned) {
    const preferredAvailable = await portIsAvailable(preferredPort);
    useExistingServer =
      clientOnly || (!preferredAvailable && (await compatibleServerIsRunning(preferredPort)));
    port = useExistingServer
      ? preferredPort
      : preferredAvailable
        ? preferredPort
        : await availablePort(preferredPort + 1);
  }
  process.env.PRICE_OFFER_PORT = String(port);
  if (plan.remotePinned) {
    if (!detectedServer) {
      startupWarning = `The saved server ${plan.serverUrl} is temporarily unreachable. The app remains pinned to this server and will not switch to a local database.`;
    }
  } else if (!useExistingServer && plan.startLocalServer) {
    try {
      const result = await startLocalServer({ port });
      apiBase = result.serverUrl || result.apiBase || defaultServerUrl(port);
      clientOnly = false;
    } catch (error) {
      writeStartupError(error);
      clientOnly = true;
      startupWarning = `Local server could not start. Use Settings to start it, or enter the tunnel/server URL on the login screen.`;
    }
  } else if (!useExistingServer) {
    clientOnly = true;
    startupWarning = 'Local server startup is off. Start it from the app Settings, tray, or app menu when you need this machine to host.';
  }

  const restoredBounds = restoredWindowOptions();
  mainWindow = new BrowserWindow({
    ...restoredBounds,
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    title: 'Accounting Management',
    icon: path.join(__dirname, '..', 'build', 'variants', 'main.ico'),
    backgroundColor: '#f6f7f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [
        `--price-offer-port=${port}`,
        `--price-offer-api-base=${apiBase}`,
        `--price-offer-installed-version=${encodeURIComponent(APP_VERSION)}`,
        `--price-offer-client-only=${clientOnly ? '1' : '0'}`,
        `--price-offer-connection-mode=${plan.remotePinned ? 'remote' : 'local'}`,
        `--price-offer-startup-warning=${encodeURIComponent(startupWarning)}`,
        `--price-offer-server-candidates=${encodeURIComponent(JSON.stringify(candidates))}`,
      ],
    },
  });
  if (desktopSettings.window?.isMaximized) mainWindow.maximize();
  if (desktopSettings.window?.isFullScreen) mainWindow.setFullScreen(true);

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    await mainWindow.loadURL(devUrl);
  } else {
    await mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.webContents.once('did-finish-load', () => {
    sendDesktopSettingsChanged();
    if (pendingSection) {
      const nextSection = pendingSection;
      pendingSection = '';
      sendNavigate(nextSection);
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.on('close', (event) => {
    saveWindowStateNow();
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.on('focus', () => mainWindow?.webContents?.focus());
  mainWindow.on('restore', () => mainWindow?.webContents?.focus());
  mainWindow.on('move', () => queueWindowStateSave());
  mainWindow.on('resize', () => queueWindowStateSave());
  mainWindow.on('maximize', () => queueWindowStateSave());
  mainWindow.on('unmaximize', () => queueWindowStateSave());
  mainWindow.on('enter-full-screen', () => queueWindowStateSave());
  mainWindow.on('leave-full-screen', () => queueWindowStateSave());
  ensureTray();
  updateApplicationMenu();
}

if (!gotSingleInstanceLock) {
  app.exit(0);
} else {
  app.on('second-instance', (_event, argv = []) => {
    if (argv.includes('--shutdown-for-update')) {
      shutdownLog('Installer requested shutdown');
      shutdownApplication('Installer requested shutdown').catch((error) => {
        shutdownLog('Installer-requested shutdown failed', { error: error?.stack || String(error) });
        app.exit(1);
      });
      return;
    }
    showMainWindow('dashboard');
  });
  app.whenReady().then(async () => {
    if (shutdownRequestedByArgument) {
      await shutdownApplication('Installer helper instance requested shutdown');
      return;
    }
    applyOpenAtLoginSetting();
    session.defaultSession.setPermissionRequestHandler(
      (_webContents, permission, callback) => {
        callback(permission === 'media' || permission === 'notifications');
      },
    );
    ensureTray();
    updateApplicationMenu();
    configureApplicationUpdater();
    await createWindow();
    updateStartupTimer = setTimeout(() => {
      checkForApplicationUpdates().catch((error) => {
        publishUpdateState({ status: 'error', error: error?.message || String(error) });
      });
    }, 5000);
    updateStartupTimer.unref?.();
  }).catch((error) => {
    writeStartupError(error);
    dialog.showErrorBox(
      'Accounting Management could not start',
      `${error?.message || error}\n\nA diagnostic log was saved in the app data folder.`,
    );
    shutdownApplication('Fatal startup failure').catch(() => app.exit(1));
  });
}

ipcMain.handle('desktop-settings:get', async () => publicDesktopSettings());
ipcMain.handle('app-version:get', async () => APP_VERSION);
ipcMain.handle('app-update:get-state', async () => publicUpdateState());
ipcMain.handle('app-update:check', async () => checkForApplicationUpdates({ manual: true }));
ipcMain.handle('app-update:install', async () => installDownloadedUpdate());

ipcMain.handle('connection-status', async (_event, serverUrl = '') =>
  clientConnectionStatus(serverUrl),
);

ipcMain.handle('desktop-settings:update', async (_event, patch = {}) => {
  const allowed = {};
  if (Object.prototype.hasOwnProperty.call(patch, 'serverUrl')) {
    allowed.serverUrl = cleanApiBase(patch.serverUrl);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'connectionMode')) {
    allowed.connectionMode = patch.connectionMode === 'remote' ? 'remote' : 'local';
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'startServerOnLaunch')) {
    allowed.startServerOnLaunch = !!patch.startServerOnLaunch;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'openAtLogin')) {
    allowed.openAtLogin = !!patch.openAtLogin;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'reportSaveDirectory')) {
    allowed.reportSaveDirectory = String(patch.reportSaveDirectory || '');
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'lastReportSaveDirectory')) {
    allowed.lastReportSaveDirectory = String(patch.lastReportSaveDirectory || '');
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'openPdfAfterSaving')) {
    allowed.openPdfAfterSaving = !!patch.openPdfAfterSaving;
  }
  return updateDesktopSettings(allowed);
});

function reportFolderForType(type = '') {
  const normalized = String(type || '').toLowerCase();
  if (normalized.includes('offer')) return 'Price Offers';
  if (normalized.includes('invoice')) return 'Invoices';
  if (normalized.includes('statement')) return 'Account Statements';
  if (normalized.includes('productive') || normalized.includes('quantit')) return 'الانتاجية';
  if (normalized.includes('contractor') || normalized.includes('certificate')) {
    return 'Contractor Certifications';
  }
  return 'Price Offers';
}

function safeReportFileName(value = 'report.pdf') {
  return String(value || 'report.pdf').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'report.pdf';
}

ipcMain.handle('save-report-file', async (_event, payload = {}) => {
  const settings = readDesktopSettings();
  const fileName = safeReportFileName(payload.fileName);
  const extension = path.extname(fileName).slice(1).toLowerCase() || String(payload.format || 'pdf');
  let savedPath = '';
  if (settings.reportSaveDirectory) {
    const outputDir = path.join(
      path.resolve(settings.reportSaveDirectory),
      reportFolderForType(payload.reportType),
    );
    fs.mkdirSync(outputDir, { recursive: true });
    savedPath = path.join(outputDir, fileName);
  } else {
    const initialDir = settings.lastReportSaveDirectory || app.getPath('documents');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save report',
      defaultPath: path.join(initialDir, fileName),
      filters: [
        extension === 'pdf'
          ? { name: 'PDF report', extensions: ['pdf'] }
          : { name: 'Excel workbook', extensions: ['xlsx'] },
      ],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    savedPath = result.filePath;
    updateDesktopSettings(
      { lastReportSaveDirectory: path.dirname(savedPath) },
      { apply: false },
    );
  }
  const bytes = Buffer.from(payload.bytes || []);
  if (!bytes.length) throw new Error('The generated report file is empty.');
  fs.mkdirSync(path.dirname(savedPath), { recursive: true });
  fs.writeFileSync(savedPath, bytes);
  let opened = false;
  if (extension === 'pdf' && settings.openPdfAfterSaving) {
    const openError = await shell.openPath(savedPath);
    opened = !openError;
    if (openError) throw new Error(`Report saved, but PDF could not be opened: ${openError}`);
  }
  return { ok: true, savedPath, opened, bytes: bytes.length };
});

ipcMain.handle('start-local-server', async (_event, options = {}) => startLocalServer(options));

ipcMain.handle('show-section', async (_event, section = '') => {
  showMainWindow(String(section || 'dashboard'));
  return true;
});

ipcMain.handle('show-desktop-notification', async (_event, payload = {}) => {
  if (!Notification.isSupported()) return false;
  const notification = new Notification({
    title: String(payload.title || 'Accounting Management'),
    body: String(payload.body || ''),
    icon: trayIconPath(),
    silent: !!payload.silent,
  });
  notification.on('click', () => showMainWindow(payload.section || 'dashboard'));
  notification.show();
  return true;
});

ipcMain.handle('restore-input-focus', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  mainWindow.webContents.focus();
  return true;
});

ipcMain.handle('open-external-url', async (_event, url) => {
  if (!/^https?:\/\//i.test(String(url || ''))) return false;
  await shell.openExternal(url);
  return true;
});

ipcMain.handle('choose-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose data folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled) return '';
  return result.filePaths[0] || '';
});

ipcMain.handle('choose-database-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose database file',
    properties: ['openFile'],
    filters: [
      { name: 'SQLite database', extensions: ['db', 'sqlite', 'sqlite3'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (result.canceled) return '';
  return result.filePaths[0] || '';
});

app.on('window-all-closed', () => {
  if (shutdownPrepared) app.quit();
});

app.on('activate', () => {
  if (isQuitting) return;
  if (mainWindow) {
    showMainWindow('dashboard');
  } else {
    createWindow().catch(writeStartupError);
  }
});

app.on('before-quit', (event) => {
  if (shutdownPrepared) return;
  event.preventDefault();
  shutdownApplication('Electron before-quit event').catch((error) => {
    shutdownLog('before-quit cleanup failed', { error: error?.stack || String(error) });
    app.exit(1);
  });
});

app.on('will-quit', () => {
  clearTimeout(shutdownForceTimer);
  shutdownLog('Electron will-quit received');
});

process.on('exit', (code) => {
  shutdownLog('Process exited', { code });
});
