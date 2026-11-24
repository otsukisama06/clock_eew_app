const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clock', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  getLocation: () => ipcRenderer.invoke('get-location'),
  sysStats: () => ipcRenderer.invoke('sys-stats'),
  fetchJson: (url) => ipcRenderer.invoke('fetch-json', url),
  setTopmost: (v) => ipcRenderer.send('set-topmost', v),
  setOpacity: (v) => ipcRenderer.send('set-opacity', v),
  setClickThrough: (v) => ipcRenderer.send('set-click-through', v),
  setMuted: (v) => ipcRenderer.send('set-muted', v),
  setPageInterval: (v) => ipcRenderer.send('set-page-interval', v),
  setPageSettings: (v) => ipcRenderer.send('set-page-settings', v),
  resetPageSettings: () => ipcRenderer.send('reset-page-settings'),
  openSettings: () => ipcRenderer.send('open-settings'),
  snap: () => ipcRenderer.send('snap'),
  minimize: () => ipcRenderer.send('minimize'),
  quit: () => ipcRenderer.send('quit'),
  quakeAlert: () => ipcRenderer.send('quake-alert'),
  quakeAlertEnd: () => ipcRenderer.send('quake-alert-end'),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onTest: (cb) => ipcRenderer.on('test-eew', (_e, kind) => cb(kind)),
});
