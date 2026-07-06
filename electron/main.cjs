const path = require('path');
const fs = require('fs');
const net = require('net');
const http = require('http');
const https = require('https');
const { app, BrowserWindow, Menu, Tray, Notification, dialog, ipcMain, screen, session, shell } = require('electron');
const { createServer, getLanIps } = require('../server/index.cjs');
const packageJson = require('../package.json');

let apiServer;
let httpServer;
let mainWindow;
let tray;
let isQuitting = false;
let pendingSection = '';
let windowStateSaveTimer;
const gotSingleInstanceLock = app.requestSingleInstanceLock();

const DEFAULT_LAN_HOST = process.env.PRICE_OFFER_DEFAULT_HOST || '192.168.137.1';
const DEFAULT_PORT = Number(process.env.PRICE_OFFER_PORT || 4181);
const DEFAULT_TUNNEL_URL = process.env.PRICE_OFFER_TUNNEL_URL || 'https://yasserdiab.site';
const APP_VERSION = packageJson.version || '0.0.0';
const WINDOWS_EXTERNAL_DATA_DIR = 'D:\\AM_Data';
const SERVER_PROBE_TIMEOUT_MS = 1800;
const WINDOW_MIN_WIDTH = 1040;
const WINDOW_MIN_HEIGHT = 680;
const DESKTOP_SETTINGS_DEFAULTS = {
  startServerOnLaunch: true,
  openAtLogin: false,
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

function cleanApiBase(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function unique(values) {
  return [...new Set(values.map(cleanApiBase).filter(Boolean))];
}

function versionParts(value) {
  return String(value || '0.0.0').split(/[^\d]+/).filter(Boolean).slice(0, 3).map((part) => Number(part) || 0);
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff) return diff;
  }
  return 0;
}

function defaultServerUrl(port = DEFAULT_PORT) {
  return `http://${DEFAULT_LAN_HOST}:${port}`;
}

function serverCandidates(port = DEFAULT_PORT) {
  return unique([
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
  for (const candidate of candidates) {
    const result = await compatibleServerAt(candidate);
    if (result) return result;
  }
  return null;
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
    openAtLogin: !!settings.openAtLogin,
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
  isQuitting = true;
  saveWindowStateNow();
  httpServer?.close?.();
  app.quit();
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

async function startLocalServer(options = {}) {
  if (httpServer) {
    return {
      ...serverInfo(Number(process.env.PRICE_OFFER_PORT || DEFAULT_PORT)),
      alreadyRunning: true,
      message: 'Local server is already running.',
    };
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
  const candidates = serverCandidates(preferredPort);
  const detectedServer = await findCompatibleServer(candidates);
  let apiBase = detectedServer?.apiBase || candidates[0] || defaultServerUrl(preferredPort);
  let startupWarning = '';
  let clientOnly = !!detectedServer;
  const preferredAvailable = await portIsAvailable(preferredPort);
  const useExistingServer =
    clientOnly || (!preferredAvailable && (await compatibleServerIsRunning(preferredPort)));
  const port = useExistingServer
    ? preferredPort
    : preferredAvailable
      ? preferredPort
      : await availablePort(preferredPort + 1);
  process.env.PRICE_OFFER_PORT = String(port);
  if (!useExistingServer && desktopSettings.startServerOnLaunch !== false) {
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
        `--price-offer-client-only=${clientOnly ? '1' : '0'}`,
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
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow('dashboard'));
  app.whenReady().then(() => {
    applyOpenAtLoginSetting();
    session.defaultSession.setPermissionRequestHandler(
      (_webContents, permission, callback) => {
        callback(permission === 'media' || permission === 'notifications');
      },
    );
    ensureTray();
    updateApplicationMenu();
    return createWindow();
  }).catch((error) => {
    writeStartupError(error);
    dialog.showErrorBox(
      'Accounting Management could not start',
      `${error?.message || error}\n\nA diagnostic log was saved in the app data folder.`,
    );
    app.quit();
  });
}

ipcMain.handle('desktop-settings:get', async () => publicDesktopSettings());

ipcMain.handle('desktop-settings:update', async (_event, patch = {}) => {
  const allowed = {};
  if (Object.prototype.hasOwnProperty.call(patch, 'startServerOnLaunch')) {
    allowed.startServerOnLaunch = !!patch.startServerOnLaunch;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'openAtLogin')) {
    allowed.openAtLogin = !!patch.openAtLogin;
  }
  return updateDesktopSettings(allowed);
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
  if (isQuitting) {
    httpServer?.close?.();
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow) {
    showMainWindow('dashboard');
  } else {
    createWindow().catch(writeStartupError);
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  saveWindowStateNow();
  httpServer?.close?.();
});
