const { contextBridge, ipcRenderer } = require('electron');

function packageMetadata() {
  try {
    return require('../package.json');
  } catch {
    return {};
  }
}

const packagedMetadata = packageMetadata();
const portArgument = process.argv.find((argument) =>
  argument.startsWith('--price-offer-port='),
);
const localPort = Number(portArgument?.split('=')[1] || process.env.PRICE_OFFER_PORT || 4181);
const apiBaseArgument = process.argv.find((argument) =>
  argument.startsWith('--price-offer-api-base='),
);
const clientOnlyArgument = process.argv.find((argument) =>
  argument.startsWith('--price-offer-client-only='),
);
const connectionModeArgument = process.argv.find((argument) =>
  argument.startsWith('--price-offer-connection-mode='),
);
const startupWarningArgument = process.argv.find((argument) =>
  argument.startsWith('--price-offer-startup-warning='),
);
const candidatesArgument = process.argv.find((argument) =>
  argument.startsWith('--price-offer-server-candidates='),
);
const installedVersionArgument = process.argv.find((argument) =>
  argument.startsWith('--price-offer-installed-version='),
);
const defaultApiBase =
  apiBaseArgument?.split('=')[1] ||
  `http://${process.env.PRICE_OFFER_DEFAULT_HOST || '192.168.137.1'}:${localPort}`;

function decodeArgument(argument) {
  try {
    return decodeURIComponent(argument?.split('=')[1] || '');
  } catch {
    return '';
  }
}

function serverCandidates() {
  try {
    const parsed = JSON.parse(decodeArgument(candidatesArgument));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

contextBridge.exposeInMainWorld('priceOfferDesktop', {
  apiBase: defaultApiBase,
  clientOnly: clientOnlyArgument?.split('=')[1] === '1',
  connectionMode: connectionModeArgument?.split('=')[1] === 'remote' ? 'remote' : 'local',
  startupWarning: decodeArgument(startupWarningArgument),
  serverCandidates: serverCandidates(),
  platform: process.platform,
  installedVersion: decodeArgument(installedVersionArgument),
  appVariant: process.env.AM_APP_VARIANT || process.env.VITE_APP_VARIANT || packagedMetadata.amVariant || '',
  entryTab: packagedMetadata.amEntryTab || '',
  openExternal: (url) => ipcRenderer.invoke('open-external-url', url),
  chooseDirectory: () => ipcRenderer.invoke('choose-directory'),
  chooseDatabaseFile: () => ipcRenderer.invoke('choose-database-file'),
  getDesktopSettings: () => ipcRenderer.invoke('desktop-settings:get'),
  updateDesktopSettings: (patch) => ipcRenderer.invoke('desktop-settings:update', patch || {}),
  startLocalServer: (options) => ipcRenderer.invoke('start-local-server', options || {}),
  getConnectionStatus: (serverUrl) => ipcRenderer.invoke('connection-status', serverUrl || ''),
  showSection: (section) => ipcRenderer.invoke('show-section', section || ''),
  showNotification: (payload) => ipcRenderer.invoke('show-desktop-notification', payload || {}),
  restoreInputFocus: () => ipcRenderer.invoke('restore-input-focus'),
  saveReportFile: (payload) => ipcRenderer.invoke('save-report-file', payload || {}),
  getInstalledVersion: () => ipcRenderer.invoke('app-version:get'),
  getUpdateState: () => ipcRenderer.invoke('app-update:get-state'),
  checkForUpdates: () => ipcRenderer.invoke('app-update:check'),
  installUpdate: () => ipcRenderer.invoke('app-update:install'),
  onUpdateState: (callback) => {
    const listener = (_event, state) => callback?.(state);
    ipcRenderer.on('app-update:state', listener);
    return () => ipcRenderer.removeListener('app-update:state', listener);
  },
  onDesktopSettingsChanged: (callback) => {
    const listener = (_event, settings) => callback?.(settings);
    ipcRenderer.on('desktop:settings-changed', listener);
    return () => ipcRenderer.removeListener('desktop:settings-changed', listener);
  },
  onLocalServerStarted: (callback) => {
    const listener = (_event, info) => callback?.(info);
    ipcRenderer.on('desktop:server-started', listener);
    return () => ipcRenderer.removeListener('desktop:server-started', listener);
  },
  onNavigate: (callback) => {
    const listener = (_event, section) => callback?.(section);
    ipcRenderer.on('desktop:navigate', listener);
    return () => ipcRenderer.removeListener('desktop:navigate', listener);
  },
});
