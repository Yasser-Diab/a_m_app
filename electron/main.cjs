const path = require('path');
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { createServer } = require('../server/index.cjs');

let apiServer;
let mainWindow;

async function createWindow() {
  const port = Number(process.env.PRICE_OFFER_PORT || 4181);
  const dataDir = app.isPackaged ? path.join(app.getPath('userData'), 'data') : undefined;
  apiServer = await createServer({ port, dataDir });
  await apiServer.listen(port);

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 680,
    title: 'Accounting Management',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    backgroundColor: '#f6f7f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    await mainWindow.loadURL(devUrl);
  } else {
    await mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(createWindow);

ipcMain.handle('open-external-url', async (_event, url) => {
  if (!/^https?:\/\//i.test(String(url || ''))) return false;
  await shell.openExternal(url);
  return true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
