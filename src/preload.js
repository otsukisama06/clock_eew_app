const { contextBridge, ipcRenderer, webFrame } = require('electron');

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
  // 画像などのキャッシュを捨ててメモリを返す
  clearCache: () => webFrame.clearCache(),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragEnd: () => ipcRenderer.send('drag-end'),
  minimize: () => ipcRenderer.send('minimize'),
  quit: () => ipcRenderer.send('quit'),
  quakeAlert: () => ipcRenderer.send('quake-alert'),
  quakeAlertEnd: () => ipcRenderer.send('quake-alert-end'),
  // OS の通知 (Windows の通知センター / Linux の通知) に出す
  notify: (n) => ipcRenderer.send('notify', n),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onTest: (cb) => ipcRenderer.on('test-eew', (_e, kind) => cb(kind)),
});
