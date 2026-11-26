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
  // 時刻同期 (NTP とのずれ)
  getTimeSync: () => ipcRenderer.invoke('get-time-sync'),
  syncTime: () => ipcRenderer.invoke('sync-time'),
  onTimeSync: (cb) => ipcRenderer.on('time-sync', (_e, t) => cb(t)),
  // スリープ復帰時など: 情報をすべて取り直す
  onRefreshAll: (cb) => ipcRenderer.on('refresh-all', () => cb()),
  // PC の高負荷 (CPU とメモリが両方とも高い状態が続いている)
  getPcAlert: () => ipcRenderer.invoke('get-pc-alert'),
  onPcAlert: (cb) => ipcRenderer.on('pc-alert', (_e, a) => cb(a)),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onTest: (cb) => ipcRenderer.on('test-eew', (_e, kind) => cb(kind)),
});
