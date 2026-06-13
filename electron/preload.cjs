const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('priceOfferDesktop', {
  apiBase: `http://127.0.0.1:${process.env.PRICE_OFFER_PORT || 4181}`,
  platform: process.platform,
  openExternal: (url) => ipcRenderer.invoke('open-external-url', url),
});
