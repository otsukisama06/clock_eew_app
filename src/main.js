// Topmost Clock - Electron main process
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, globalShortcut, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const APP_DIR = path.join(__dirname, '..');
const BASE_WIDTH = 940;
const BASE_HEIGHT = 500;

app.setAppUserModelId('tugu.clock.topmost');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// ---------- .env (互換: 旧 Python 版と同じファイルを読む) ----------
function loadEnv() {
  const env = {};
  const file = path.join(APP_DIR, '.env');
  try {
    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const i = line.indexOf('=');
      const k = line.slice(0, i).trim();
      let v = line.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (k && v) env[k] = v;
    }
  } catch { /* .env が無くても動く */ }
  return { ...env, ...pickProcessEnv() };
}
function pickProcessEnv() {
  const out = {};
  for (const [k, v] of Object.entries(process.env)) if (k.startsWith('CLOCK_') && v) out[k] = v;
  return out;
}
const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };

function buildConfig() {
  const env = loadEnv();
  const lat = num(env.CLOCK_LAT, 35.083);
  const lon = num(env.CLOCK_LON, 137.156);
  const pageDefault = Math.max(3, num(env.CLOCK_PAGE_SECONDS, 9));
  return {
    city: env.CLOCK_CITY || 'Toyota',
    lat, lon,
    radarLat: num(env.CLOCK_RADAR_LAT, lat),
    radarLon: num(env.CLOCK_RADAR_LON, lon),
    radarZoom: Math.max(4, Math.min(10, num(env.CLOCK_RADAR_ZOOM, 8))),
    radarFixed: !!(env.CLOCK_RADAR_LAT && env.CLOCK_RADAR_LON),
    pageSeconds: {
      clock: Math.max(3, num(env.CLOCK_PAGE_SECONDS_CLOCK, 15)),
      weather: Math.max(3, num(env.CLOCK_PAGE_SECONDS_WEATHER, pageDefault)),
      radar: Math.max(3, num(env.CLOCK_PAGE_SECONDS_RADAR, 15)),
      status: Math.max(3, num(env.CLOCK_PAGE_SECONDS_STATUS, pageDefault)),
      quake: Math.max(3, num(env.CLOCK_PAGE_SECONDS_QUAKE, pageDefault)),
    },
    // 地震情報(震度速報など)で画面を切り替える最小震度 (P2PQuake scale: 10=1, 20=2, 30=3, 40=4, 45=5弱 ...)
    quakeMinScale: num(env.CLOCK_QUAKE_MIN_SCALE, 10),
    quakeHoldSeconds: Math.max(10, num(env.CLOCK_QUAKE_HOLD_SECONDS, 60)),
    eewShowTraining: env.CLOCK_EEW_TRAINING === '1',
  };
}

// ---------- 設定 (ウィンドウ位置など) ----------
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
let settings = {
  opacity: 1, topmost: true, clickThrough: false, muted: false, bounds: null, pageInterval: null,
  pageSeconds: null,   // { clock: 15, ... } 設定画面で決めたページごとの秒数 (null なら .env)
  pageEnabled: null,   // { clock: true, ... } 自動切替に含めるページ
  pauseOnHover: true,  // マウスが乗っている間は自動切替を止める
};
const PAGE_KEYS = ['clock', 'weather', 'radar', 'status', 'quake'];
function effectivePageSettings() {
  const env = buildConfig().pageSeconds;
  const sec = {}, en = {};
  for (const k of PAGE_KEYS) {
    sec[k] = settings.pageSeconds && settings.pageSeconds[k] > 0 ? settings.pageSeconds[k] : env[k];
    en[k] = settings.pageEnabled ? settings.pageEnabled[k] !== false : true;
  }
  return { pageSeconds: sec, pageEnabled: en };
}
// pageInterval: null = ページごとの秒数 (.env), 0 = 自動切替しない, 数値 = 全ページ共通の秒数
function loadSettings() {
  try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) }; } catch { }
  settings.clickThrough = false; // 起動時は必ず操作可能にする
}
let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2)); } catch { }
  }, 400);
}

// ---------- アイコン (画像ファイル不要: ビットマップを生成) ----------
function makeIcon(size = 32) {
  const buf = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2, r = size / 2 - 1;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x - c, y - c);
    const i = (y * size + x) * 4;
    let a = 0, col = [0, 0, 0];
    if (d <= r) { a = 255; col = d > r - 2.2 ? [255, 215, 95] : [16, 16, 16]; }
    // 時計の針
    const hand1 = Math.abs(x - c) < 1.2 && y < c && y > c - r * 0.6;
    const hand2 = Math.abs(y - c) < 1.2 && x > c && x < c + r * 0.45;
    if (d <= r - 2.2 && (hand1 || hand2)) col = [255, 255, 255];
    buf[i] = col[2]; buf[i + 1] = col[1]; buf[i + 2] = col[0]; buf[i + 3] = a; // BGRA
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

// ---------- ウィンドウ ----------
let win = null;
let tray = null;

function rightmostWorkArea() {
  const displays = screen.getAllDisplays();
  displays.sort((a, b) => (b.workArea.x + b.workArea.width) - (a.workArea.x + a.workArea.width));
  return displays[0].workArea;
}
function defaultBounds() {
  const wa = rightmostWorkArea();
  const m = 16;
  const width = Math.min(BASE_WIDTH, wa.width - m * 2);
  const height = Math.min(BASE_HEIGHT, wa.height - m * 2);
  return { x: wa.x + wa.width - width - m, y: wa.y + m, width, height };
}
function boundsVisible(b) {
  if (!b) return false;
  return screen.getAllDisplays().some(d => {
    const wa = d.workArea;
    return b.x + 80 > wa.x && b.x < wa.x + wa.width - 80 && b.y >= wa.y - 10 && b.y < wa.y + wa.height - 60;
  });
}

function createWindow() {
  const b = boundsVisible(settings.bounds) ? settings.bounds : defaultBounds();
  win = new BrowserWindow({
    ...b,
    minWidth: 520,
    minHeight: 300,
    frame: false,
    backgroundColor: '#000000',
    alwaysOnTop: settings.topmost,
    skipTaskbar: false,
    show: false,
    title: 'Topmost Clock',
    icon: makeIcon(64),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  if (settings.topmost) win.setAlwaysOnTop(true, 'floating');
  win.setOpacity(settings.opacity);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.showInactive());

  const remember = () => { if (!win.isMinimized() && !win.isMaximized()) { settings.bounds = win.getBounds(); saveSettings(); } };
  win.on('moved', remember);
  win.on('resized', remember);
  win.on('closed', () => { win = null; });
  if (process.env.CLOCK_DEBUG_DIR) setupDebugCapture(process.env.CLOCK_DEBUG_DIR);
}

// 開発用: CLOCK_DEBUG_DIR を指定するとコンソール出力と画面キャプチャを保存する
function setupDebugCapture(dir) {
  fs.mkdirSync(dir, { recursive: true });
  win.webContents.on('console-message', (e) => console.log(`[renderer] ${e.message}`));
  const pages = (process.env.CLOCK_DEBUG_PAGES || 'clock|weather|radar|status|quake').split('|');
  win.webContents.once('did-finish-load', () => {
    let i = 0;
    const next = async () => {
      if (i >= pages.length) return;
      const p = pages[i++];
      if (p.startsWith('test:')) win.webContents.send('test-eew', p.slice(5));
      else if (p.startsWith('js:')) await win.webContents.executeJavaScript(p.slice(3));
      else await win.webContents.executeJavaScript(`App.show(${JSON.stringify(p)}); App.schedule();`);
      setTimeout(async () => {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(path.join(dir, `${i}-${p.replace(/[^a-z0-9]+/gi, '_').slice(0, 30)}.png`), img.toPNG());
        next();
      }, Number(process.env.CLOCK_DEBUG_WAIT || 3500));
    };
    setTimeout(next, 2500);
  });
}

function sendState() {
  if (!win && !settingsWin) return;
  const state = {
    topmost: settings.topmost, clickThrough: settings.clickThrough,
    opacity: settings.opacity, muted: settings.muted, pageInterval: settings.pageInterval,
    pauseOnHover: settings.pauseOnHover, ...effectivePageSettings(),
  };
  if (win) win.webContents.send('state', state);
  if (settingsWin) settingsWin.webContents.send('state', state);
  rebuildTrayMenu();
}
function setTopmost(v) {
  settings.topmost = !!v; saveSettings();
  if (win) win.setAlwaysOnTop(settings.topmost, 'floating');
  sendState();
}
function setClickThrough(v) {
  settings.clickThrough = !!v;
  if (win) win.setIgnoreMouseEvents(settings.clickThrough, { forward: true });
  sendState();
}
function setOpacity(v) {
  settings.opacity = Math.max(0.3, Math.min(1, Number(v) || 1)); saveSettings();
  if (win) win.setOpacity(settings.opacity);
  sendState();
}
function setMuted(v) { settings.muted = !!v; saveSettings(); sendState(); }
function setPageInterval(v) {
  settings.pageInterval = v === null || v === '' || v === 'default' ? null : Math.max(0, Math.min(600, Number(v) || 0));
  saveSettings(); sendState();
}
function snapTopRight() {
  if (!win) return;
  const [w, h] = win.getSize();
  const wa = rightmostWorkArea();
  win.setPosition(wa.x + wa.width - w - 16, wa.y + 16);
}
function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.showInactive();
}

function rebuildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '表示', click: showWindow },
    { label: '設定...', click: openSettings },
    { label: '右上に移動', click: snapTopRight },
    { type: 'separator' },
    { label: '常に手前に表示', type: 'checkbox', checked: settings.topmost, click: (i) => setTopmost(i.checked) },
    { label: 'クリック透過 (Ctrl+Alt+T)', type: 'checkbox', checked: settings.clickThrough, click: (i) => setClickThrough(i.checked) },
    { label: '音を消す', type: 'checkbox', checked: settings.muted, click: (i) => setMuted(i.checked) },
    {
      label: 'ページの自動切替', submenu: [
        { label: 'ページごとの秒数 (設定画面)', type: 'radio', checked: settings.pageInterval === null, click: () => setPageInterval(null) },
        ...[5, 10, 15, 20, 30, 60, 120].map((n) => ({
          label: `${n}秒ごと`, type: 'radio', checked: settings.pageInterval === n, click: () => setPageInterval(n),
        })),
        { label: '自動切替しない', type: 'radio', checked: settings.pageInterval === 0, click: () => setPageInterval(0) },
      ],
    },
    {
      label: '不透明度', submenu: [100, 90, 80, 70, 60, 50, 40].map(p => ({
        label: `${p}%`, type: 'radio', checked: Math.round(settings.opacity * 100) === p, click: () => setOpacity(p / 100),
      })),
    },
    { type: 'separator' },
    { label: 'テスト: 緊急地震速報(予報)', click: () => win && win.webContents.send('test-eew', 'forecast') },
    { label: 'テスト: 緊急地震速報(警報)', click: () => win && win.webContents.send('test-eew', 'warning') },
    { label: 'テスト: 地震情報', click: () => win && win.webContents.send('test-eew', 'info') },
    { type: 'separator' },
    { label: '終了', click: () => app.quit() },
  ]));
}

// ---------- システム情報 ----------
let lastCpu = null;
function cpuPercent() {
  const cpus = os.cpus();
  let idle = 0, total = 0;
  for (const c of cpus) { for (const t of Object.values(c.times)) total += t; idle += c.times.idle; }
  let pct = null;
  if (lastCpu) {
    const dt = total - lastCpu.total, di = idle - lastCpu.idle;
    if (dt > 0) pct = Math.max(0, Math.min(100, (1 - di / dt) * 100));
  }
  lastCpu = { idle, total };
  return pct;
}
// ネットワーク速度: 常駐する非表示の PowerShell で物理アダプタの送受信バイト数を 2 秒毎に取得
let netCache = null, netProc = null;
function startNetSampler() {
  if (process.platform !== 'win32') return;
  const { spawn } = require('child_process');
  // 親 (このアプリ) が終了したら PowerShell も終了する
  const script = `$ErrorActionPreference='SilentlyContinue'; while (Get-Process -Id ${process.pid}) { ` +
    "$n = (Get-NetAdapter -Physical | Where-Object Status -eq 'Up').Name; " +
    "if ($n) { $s = Get-NetAdapterStatistics -Name $n | Measure-Object -Property ReceivedBytes,SentBytes -Sum; " +
    "[Console]::Out.WriteLine(('{0} {1}' -f $s[0].Sum, $s[1].Sum)) } else { [Console]::Out.WriteLine('0 0') }; " +
    "Start-Sleep -Seconds 2 }";
  netProc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
  let prev = null, buf = '';
  netProc.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      const [rx, tx] = line.split(' ').map(Number);
      if (!Number.isFinite(rx)) continue;
      const now = Date.now();
      if (prev && rx >= prev.rx) {
        const dt = (now - prev.t) / 1000;
        netCache = { rx: (rx - prev.rx) / dt, tx: Math.max(0, tx - prev.tx) / dt };
      }
      prev = { rx, tx, t: now };
    }
  });
  netProc.on('exit', () => { netProc = null; });
}
async function diskUsage() {
  try {
    const root = path.parse(process.env.SystemDrive ? process.env.SystemDrive + '\\' : '/').root;
    const s = await fs.promises.statfs(root);
    const total = s.blocks * s.bsize, free = s.bavail * s.bsize;
    return { total, used: total - free };
  } catch { return null; }
}
const appStartedAt = Date.now();
ipcMain.handle('sys-stats', async () => {
  const disk = await diskUsage();
  return {
    cpu: cpuPercent(),
    memTotal: os.totalmem(), memFree: os.freemem(),
    disk, net: netCache,
    uptime: os.uptime(),
    appRuntime: (Date.now() - appStartedAt) / 1000,
  };
});

// ---------- 外部 API (CORS 回避のため main で取得) ----------
const ALLOWED_HOSTS = new Set([
  'www.jma.go.jp', 'api.open-meteo.com', 'api.p2pquake.net', 'api.wolfx.jp', 'mreversegeocoder.gsi.go.jp',
]);

// ---------- 現在地 (Windows の位置情報サービス。取得できなければ .env の地点) ----------
let locCache = null, locAt = 0, locPending = null;
function readWindowsLocation() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null);
    const { execFile } = require('child_process');
    const script = "Add-Type -AssemblyName System.Device; $w = New-Object System.Device.Location.GeoCoordinateWatcher; " +
      "[void]$w.TryStart($false, [TimeSpan]::FromSeconds(8)); $d = (Get-Date).AddSeconds(10); " +
      "while ($w.Status -ne 'Ready' -and (Get-Date) -lt $d) { Start-Sleep -Milliseconds 200 }; " +
      "$c = $w.Position.Location; if (-not $c.IsUnknown) { '{0} {1} {2}' -f $c.Latitude, $c.Longitude, $c.HorizontalAccuracy }";
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 20000 }, (err, out) => {
        const [lat, lon, acc] = String(out || '').trim().split(/\s+/).map(Number);
        resolve(!err && Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon, accuracy: acc } : null);
      });
  });
}
ipcMain.handle('get-location', async () => {
  if (locCache && Date.now() - locAt < 10 * 60 * 1000) return locCache;
  if (!locPending) {
    locPending = readWindowsLocation().then((r) => {
      locPending = null;
      if (r) { locCache = { ...r, source: 'gps' }; locAt = Date.now(); return locCache; }
      const c = buildConfig();
      return { lat: c.lat, lon: c.lon, source: 'config' };
    });
  }
  return locPending;
});
ipcMain.handle('fetch-json', async (_e, url) => {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname)) throw new Error('host not allowed');
  const res = await net.fetch(url, { headers: { 'User-Agent': 'topmost-clock/2.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
});

ipcMain.handle('get-config', () => ({ ...buildConfig(), state: { ...settings, ...effectivePageSettings() } }));
ipcMain.on('open-settings', () => openSettings());
ipcMain.on('set-page-settings', (_e, v) => {
  const sec = {}, en = {};
  for (const k of PAGE_KEYS) {
    sec[k] = Math.max(3, Math.min(3600, Math.round(Number(v.pageSeconds && v.pageSeconds[k]) || 9)));
    en[k] = !(v.pageEnabled && v.pageEnabled[k] === false);
  }
  settings.pageSeconds = sec; settings.pageEnabled = en;
  if (typeof v.pauseOnHover === 'boolean') settings.pauseOnHover = v.pauseOnHover;
  if ('pageInterval' in v) settings.pageInterval = v.pageInterval;
  saveSettings(); sendState();
});
ipcMain.on('reset-page-settings', () => {
  settings.pageSeconds = null; settings.pageEnabled = null; settings.pauseOnHover = true; settings.pageInterval = null;
  saveSettings(); sendState();
});

// ---------- 設定ウィンドウ ----------
let settingsWin = null;
function openSettings() {
  if (settingsWin) { settingsWin.show(); settingsWin.focus(); return; }
  const wa = win ? screen.getDisplayMatching(win.getBounds()).workArea : rightmostWorkArea();
  const w = 460, h = 650;
  settingsWin = new BrowserWindow({
    width: w, height: h, x: Math.round(wa.x + (wa.width - w) / 2), y: Math.round(wa.y + (wa.height - h) / 2),
    useContentSize: true, resizable: false, minimizable: false, maximizable: false, autoHideMenuBar: true,
    title: 'Topmost Clock の設定', backgroundColor: '#0f1113', icon: makeIcon(64), show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  settingsWin.setMenu(null);
  settingsWin.setAlwaysOnTop(true, 'pop-up-menu'); // 手前表示の時計より上に出す
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => { settingsWin = null; });
  if (process.env.CLOCK_DEBUG_DIR) {
    settingsWin.webContents.once('did-finish-load', () => setTimeout(async () => {
      const img = await settingsWin.webContents.capturePage();
      fs.writeFileSync(path.join(process.env.CLOCK_DEBUG_DIR, 'settings.png'), img.toPNG());
    }, 1200));
  }
}
ipcMain.on('set-topmost', (_e, v) => setTopmost(v));
ipcMain.on('set-opacity', (_e, v) => setOpacity(v));
ipcMain.on('set-click-through', (_e, v) => setClickThrough(v));
ipcMain.on('set-muted', (_e, v) => setMuted(v));
ipcMain.on('set-page-interval', (_e, v) => setPageInterval(v));
ipcMain.on('snap', () => snapTopRight());
ipcMain.on('minimize', () => win && win.minimize());
ipcMain.on('quit', () => app.quit());
// 地震情報受信時: 最小化/非表示でも前面に出す
ipcMain.on('quake-alert', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.showInactive();
  win.setAlwaysOnTop(true, 'screen-saver');
  win.moveTop();
  win.flashFrame(true);
});
ipcMain.on('quake-alert-end', () => {
  if (!win) return;
  win.flashFrame(false);
  win.setAlwaysOnTop(settings.topmost, 'floating');
});

app.on('second-instance', showWindow);

app.whenReady().then(() => {
  loadSettings();
  createWindow();
  tray = new Tray(makeIcon(32));
  tray.setToolTip('Topmost Clock');
  tray.on('click', showWindow);
  rebuildTrayMenu();
  startNetSampler();
  // クリック透過中でも戻せるように
  globalShortcut.register('Control+Alt+T', () => setClickThrough(!settings.clickThrough));
  screen.on('display-removed', () => { if (win && !boundsVisible(win.getBounds())) win.setBounds(defaultBounds()); });
});
app.on('will-quit', () => { globalShortcut.unregisterAll(); if (netProc) netProc.kill(); });
app.on('window-all-closed', () => app.quit());
