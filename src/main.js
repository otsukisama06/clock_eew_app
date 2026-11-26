// Topmost Clock - Electron main process
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, globalShortcut, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const APP_DIR = path.join(__dirname, '..');
const BASE_WIDTH = 940;
const BASE_HEIGHT = 500;
const TITLEBAR_H = 36;

app.setAppUserModelId('tugu.clock.topmost'); // 通知・タスクバーの識別子 (package.json の build.appId と同じ)

// ---------- 低負荷化 ----------
// JS のヒープ上限を小さめに、使わない Chromium 機能 (予備の描画プロセス・メディアキー・翻訳など) を切る
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=128');
app.commandLine.appendSwitch('disable-features',
  'SpareRendererForSitePerProcess,HardwareMediaKeyHandling,MediaSessionService,Translate,AutofillServerCommunication,OptimizationHints');
app.commandLine.appendSwitch('disk-cache-size', String(64 * 1024 * 1024));
// GPU を使わない描画にする: GPU プロセスが地図タイルを抱えて 400MB 以上になるのを防ぐ
// (この画面の大きさとアニメーション量なら CPU 描画で十分軽い。CLOCK_GPU=1 で GPU 描画に戻せる)
if (process.env.CLOCK_GPU !== '1') app.disableHardwareAcceleration();

// 開発用: 別の設定フォルダで起動する (起動中の時計と同時に動かして確認するとき)
if (process.env.CLOCK_USER_DATA) app.setPath('userData', process.env.CLOCK_USER_DATA);
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// ---------- .env (互換: 旧 Python 版と同じファイルを読む) ----------
// 読む順 (後のものが優先): ソースフォルダ (開発時) → ユーザーデータフォルダ (インストール版) → 環境変数
function envFiles() {
  const files = [];
  if (!app.isPackaged) files.push(path.join(APP_DIR, '.env'));
  files.push(path.join(app.getPath('userData'), '.env'));
  return files;
}
function loadEnv() {
  const env = {};
  for (const file of envFiles()) {
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
  }
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

// ---------- デスクトップのショートカット ----------
// Ubuntu などでは Ctrl+Alt+T が端末の起動に使われているので Shift を足す
const CLICK_THROUGH_KEY = process.platform === 'linux' ? 'Control+Alt+Shift+T' : 'Control+Alt+T';
const CLICK_THROUGH_LABEL = CLICK_THROUGH_KEY.replace('Control', 'Ctrl');

function launchCommand() {
  // AppImage は実行中に展開先へ移るので、元の .AppImage ファイルを起動先にする
  const exe = process.env.APPIMAGE || process.execPath;
  return { exe, args: app.isPackaged ? [] : [APP_DIR] };
}
function createDesktopShortcut() {
  const { exe, args } = launchCommand();
  const desktop = app.getPath('desktop');
  try {
    if (process.platform === 'win32') {
      const { shell } = require('electron');
      const file = path.join(desktop, 'Topmost Clock.lnk');
      const ok = shell.writeShortcutLink(file, {
        target: exe, args: args.map((a) => `"${a}"`).join(' '), cwd: path.dirname(exe),
        description: 'Topmost Clock (時計・天気・雨雲レーダー・地震速報)', appUserModelId: 'tugu.clock.topmost',
      });
      return ok ? file : null;
    }
    if (process.platform === 'linux') {
      const iconFile = path.join(app.getPath('userData'), 'icon.png');
      fs.writeFileSync(iconFile, makeIcon(256).toPNG());
      const q = (s) => `"${String(s).replace(/(["`$\\])/g, '\\$1')}"`;
      const entry = [
        '[Desktop Entry]', 'Type=Application', 'Name=Topmost Clock',
        'Comment=時計・天気・雨雲レーダー・緊急地震速報', `Exec=${[exe, ...args].map(q).join(' ')}`,
        `Icon=${iconFile}`, 'Terminal=false', 'Categories=Utility;', 'StartupWMClass=topmost-clock', '',
      ].join('\n');
      fs.mkdirSync(desktop, { recursive: true });
      const file = path.join(desktop, 'topmost-clock.desktop');
      fs.writeFileSync(file, entry, { mode: 0o755 });
      fs.chmodSync(file, 0o755);
      // GNOME はデスクトップの .desktop を「信頼済み」にしないと起動できない
      require('child_process').execFile('gio', ['set', file, 'metadata::trusted', 'true'], () => { });
      // AppImage はアプリ一覧にも出す (deb はインストール時に登録済み)
      if (process.env.APPIMAGE) {
        const appsDir = path.join(os.homedir(), '.local', 'share', 'applications');
        fs.mkdirSync(appsDir, { recursive: true });
        fs.writeFileSync(path.join(appsDir, 'topmost-clock.desktop'), entry);
      }
      return file;
    }
  } catch (e) { console.error('shortcut', e); }
  return null;
}
function createDesktopShortcutWithNotice() {
  const { dialog } = require('electron');
  const file = createDesktopShortcut();
  dialog.showMessageBox({
    type: file ? 'info' : 'error', title: 'Topmost Clock',
    message: file ? `デスクトップにショートカットを作成しました。\n${file}` : 'ショートカットを作成できませんでした。',
  });
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
    // Windows 標準のタイトルバーボタン (スナップレイアウト対応) を右上に重ねて表示
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0a0a0a', symbolColor: '#9aa0a6', height: TITLEBAR_H },
    maximizable: true,
    backgroundColor: '#0a0a0a',
    alwaysOnTop: settings.topmost,
    skipTaskbar: false,
    show: false,
    title: 'Topmost Clock',
    icon: makeIcon(64),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      // 最小化中は描画・タイマーを抑える (地震の受信は WebSocket なので影響なし)
      backgroundThrottling: true,
    },
  });
  if (settings.topmost) win.setAlwaysOnTop(true, 'floating');
  win.setOpacity(settings.opacity);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.showInactive());

  const remember = () => { if (!win.isMinimized() && !win.isMaximized()) { settings.bounds = win.getBounds(); saveSettings(); } };
  win.on('moved', remember);
  win.on('resized', remember);
  // メイン画面を閉じたらアプリを終了する (設定画面だけが残らないように)
  win.on('closed', () => { win = null; app.quit(); });
  if (process.env.CLOCK_DEBUG_DIR) setupDebugCapture(process.env.CLOCK_DEBUG_DIR);
}

// 開発用: CLOCK_DEBUG_DIR を指定するとコンソール出力と画面キャプチャを保存する
function setupDebugCapture(dir) {
  fs.mkdirSync(dir, { recursive: true });
  win.webContents.on('console-message', (e) => console.log(`[renderer] ${e.message}`));
  if (process.env.CLOCK_DEBUG_METRICS) setInterval(async () => {
    const m = app.getAppMetrics().map((p) => `${p.type}:${Math.round(p.memory.privateBytes / 1024)}MB cpu${p.cpu.percentCPUUsage.toFixed(1)}%`);
    const js = await win.webContents.executeJavaScript('JSON.stringify({heap: Math.round(performance.memory.usedJSHeapSize/1048576), total: Math.round(performance.memory.totalJSHeapSize/1048576), page: App.current, imgs: document.images.length, radarLayers: Radar.layers.length})');
    fs.appendFileSync(path.join(dir, "metrics.log"), `${new Date().toISOString().slice(11, 19)} ${m.join(" ")} ${js}
`);
  }, 5000);
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
    { label: `クリック透過 (${CLICK_THROUGH_LABEL})`, type: 'checkbox', checked: settings.clickThrough, click: (i) => setClickThrough(i.checked) },
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
    { label: 'デスクトップにショートカットを作成', click: createDesktopShortcutWithNotice },
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
// ネットワーク速度: PC ページを表示している間だけ netstat -e を 3 秒ごとに実行 (常駐プロセスなし)
let netCache = null, netPrev = null, netTimer = null, netStopTimer = null;
function updateNet(rx, tx) {
  const t = Date.now();
  if (netPrev && rx >= netPrev.rx && t > netPrev.t) {
    const dt = (t - netPrev.t) / 1000;
    netCache = { rx: (rx - netPrev.rx) / dt, tx: Math.max(0, tx - netPrev.tx) / dt };
  }
  netPrev = { rx, tx, t };
}
function sampleNetOnce() {
  if (process.platform === 'linux') {
    // /proc/net/dev: "iface: rxBytes ... (8 列目まで受信) txBytes ..." ループバックは除く
    fs.readFile('/proc/net/dev', 'utf8', (err, txt) => {
      if (err) return;
      let rx = 0, tx = 0;
      for (const line of txt.split('\n').slice(2)) {
        const [name, rest] = line.split(':');
        if (!rest || name.trim() === 'lo') continue;
        const f = rest.trim().split(/\s+/).map(Number);
        rx += f[0] || 0; tx += f[8] || 0;
      }
      updateNet(rx, tx);
    });
    return;
  }
  if (process.platform !== 'win32') return;
  require('child_process').execFile('netstat', ['-e'], { windowsHide: true, timeout: 5000 }, (err, out) => {
    if (err) return;
    // 1 行目に数値が 2 つ並ぶのが「バイト」(受信 / 送信)
    const m = String(out).split(/\r?\n/).map((l) => l.match(/\s(\d+)\s+(\d+)\s*$/)).find(Boolean);
    if (!m) return;
    updateNet(Number(m[1]), Number(m[2]));
  });
}
// Linux の os.freemem() はキャッシュを含まない値なので、実際に使える量 (MemAvailable) を読む
function freeMemory() {
  if (process.platform === 'linux') {
    try {
      const m = fs.readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+)\s*kB/m);
      if (m) return Number(m[1]) * 1024;
    } catch { }
  }
  return os.freemem();
}
// renderer から「PC ページをもうすぐ表示 / 表示中」のときに呼ばれる。呼ばれなくなれば自動で止まる
function keepNetSampling() {
  if (!netTimer) { netPrev = null; sampleNetOnce(); netTimer = setInterval(sampleNetOnce, 3000); }
  clearTimeout(netStopTimer);
  netStopTimer = setTimeout(() => { clearInterval(netTimer); netTimer = null; netCache = null; }, 8000);
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
  keepNetSampling();
  const disk = await diskUsage();
  return {
    cpu: cpuPercent(),
    memTotal: os.totalmem(), memFree: freeMemory(),
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
// ウィンドウのドラッグ移動: 押した位置からのカーソル移動量だけウィンドウを動かす
let dragTimer = null;
ipcMain.on('drag-start', () => {
  if (!win) return;
  clearInterval(dragTimer);
  const start = screen.getCursorScreenPoint();
  const b = win.getBounds();
  dragTimer = setInterval(() => {
    if (!win) return clearInterval(dragTimer);
    const c = screen.getCursorScreenPoint();
    win.setBounds({ x: b.x + c.x - start.x, y: b.y + c.y - start.y, width: b.width, height: b.height });
  }, 16);
});
ipcMain.on('drag-end', () => {
  if (!dragTimer) return;
  clearInterval(dragTimer); dragTimer = null;
  if (win) { settings.bounds = win.getBounds(); saveSettings(); }
});
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
// ---------- OS の通知 ----------
// Windows: 「重要な通知」(scenario=urgent) として出すと、応答不可 (おやすみモード) 中でも表示される
//          (Windows 11。通知の設定でこのアプリの重要な通知が許可されている場合)
// Linux:   urgency=critical はおやすみモード中でも表示される (GNOME など)
// 音はアプリ自身が鳴らすので、通知の音は鳴らさない
const APP_ID = 'tugu.clock.topmost';
const liveNotifications = new Set(); // GC されるとクリックが届かなくなるので保持する
const xmlEsc = (s) => String(s).replace(/[<>&"']/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[ch]));
function showQuakeNotification({ title, body, level } = {}) {
  const { Notification } = require('electron');
  if (!Notification.isSupported() || !title) return;
  const lines = String(body || '').split('\n').filter(Boolean).slice(0, 2);
  const important = level !== 'normal';
  const opts = { title: String(title), body: lines.join('\n'), silent: true, icon: makeIcon(64) };
  if (process.platform === 'win32') {
    opts.toastXml = `<toast${important ? ' scenario="urgent"' : ''} duration="long" launch="show">`
      + `<visual><binding template="ToastGeneric"><text>${xmlEsc(title)}</text>${lines.map((l) => `<text>${xmlEsc(l)}</text>`).join('')}</binding></visual>`
      + '<audio silent="true"/></toast>';
  } else {
    opts.urgency = important ? 'critical' : 'normal';
    opts.timeoutType = level === 'warning' ? 'never' : 'default';
  }
  const n = new Notification(opts);
  liveNotifications.add(n);
  const drop = () => liveNotifications.delete(n);
  n.on('click', () => { showWindow(); drop(); });
  n.on('close', drop);
  n.on('failed', (_e, err) => { console.error('notification failed', err); drop(); });
  n.on('show', () => { if (process.env.CLOCK_DEBUG_DIR) console.log('notification shown:', title); });
  n.show();
  setTimeout(drop, 10 * 60 * 1000);
}
ipcMain.on('notify', (_e, n) => showQuakeNotification(n));

// Windows の通知は、同じ AppUserModelID を持つスタートメニューのショートカットが無いと出ない。
// インストール版はインストーラーが作るので、ソースから起動したときだけここで作る
function ensureDevStartMenuShortcut() {
  if (process.platform !== 'win32' || app.isPackaged) return;
  const file = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Topmost Clock (開発版).lnk');
  if (fs.existsSync(file)) return;
  const { shell } = require('electron');
  shell.writeShortcutLink(file, {
    target: process.execPath, args: `"${APP_DIR}"`, cwd: APP_DIR,
    description: 'Topmost Clock (ソースから起動)', appUserModelId: APP_ID,
  });
}

ipcMain.on('quake-alert-end', () => {
  if (!win) return;
  win.flashFrame(false);
  win.setAlwaysOnTop(settings.topmost, 'floating');
});

app.on('second-instance', showWindow);

app.whenReady().then(() => {
  loadSettings();
  try { ensureDevStartMenuShortcut(); } catch (e) { console.error('start menu shortcut', e); }
  createWindow();
  tray = new Tray(makeIcon(32));
  tray.setToolTip('Topmost Clock');
  tray.on('click', showWindow);
  rebuildTrayMenu();
  // クリック透過中でも戻せるように
  globalShortcut.register(CLICK_THROUGH_KEY, () => setClickThrough(!settings.clickThrough));
  // Linux 版は初回起動時にデスクトップへショートカットを置く (Windows はインストーラーが作る)
  if (process.platform === 'linux' && app.isPackaged && !settings.linuxShortcutCreated) {
    if (createDesktopShortcut()) { settings.linuxShortcutCreated = true; saveSettings(); }
  }
  screen.on('display-removed', () => { if (win && !boundsVisible(win.getBounds())) win.setBounds(defaultBounds()); });
});
app.on('will-quit', () => { globalShortcut.unregisterAll(); clearInterval(netTimer); });
app.on('window-all-closed', () => app.quit());
