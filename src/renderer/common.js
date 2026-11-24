// 共通ユーティリティ
const $ = (s, r = document) => r.querySelector(s);
const pad2 = (n) => String(n).padStart(2, '0');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 震度の色 (rsquake の配色に準拠)
const SHINDO = {
  '0': { bg: '#50565e', fg: '#fff' },
  '1': { bg: '#f2f2ff', fg: '#151518' },
  '2': { bg: '#00aaff', fg: '#fff' },
  '3': { bg: '#0041ff', fg: '#fff' },
  '4': { bg: '#fae696', fg: '#151518' },
  '5-': { bg: '#ffe600', fg: '#151518' },
  '5+': { bg: '#ff9900', fg: '#151518' },
  '6-': { bg: '#ff2800', fg: '#fff' },
  '6+': { bg: '#a50021', fg: '#fff' },
  '7': { bg: '#b40068', fg: '#fff' },
  '?': { bg: '#50565e', fg: '#fff' },
};
// Wolfx の "5強" や "5+" 等 → 内部キー
function shindoKey(s) {
  if (s == null) return '?';
  s = String(s).replace('弱', '-').replace('強', '+').replace('不明', '?').trim();
  if (s === '7' || s === '7+') return '7';
  return SHINDO[s] ? s : '?';
}
// P2PQuake の scale 数値 → 内部キー
const P2P_SCALE = { 10: '1', 20: '2', 30: '3', 40: '4', 45: '5-', 46: '5-', 50: '5+', 55: '6-', 60: '6+', 70: '7' };
const p2pScaleKey = (n) => P2P_SCALE[n] || '?';
function shindoLabel(key, html = false) {
  if (key === '?') return '不明';
  const m = key.match(/^(\d)([+-])?$/);
  if (!m) return key;
  const suf = m[2] === '-' ? '弱' : m[2] === '+' ? '強' : '';
  return html && suf ? `${m[1]}<small>${suf}</small>` : m[1] + suf;
}
function shindoBadge(key, cls = 'badge') {
  const c = SHINDO[key] || SHINDO['?'];
  return `<span class="${cls}" style="background:${c.bg};color:${c.fg}">${shindoLabel(key)}</span>`;
}

// 距離 (km)
function distKm(lat1, lon1, lat2, lon2) {
  const R = 6371, toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR, dLon = (lon2 - lon1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// "YYYY/MM/DD HH:mm:ss" (JST) → Date
function parseJst(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):?(\d{2})?/);
  if (!m) return null;
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}+09:00`);
}
const fmtTime = (d, sec = true) => d ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}${sec ? ':' + pad2(d.getSeconds()) : ''}` : '--';
// 気象庁の表記: 11月24日 06時00分ごろ
const fmtJmaTime = (d) => d ? `${d.getMonth() + 1}月${d.getDate()}日 ${pad2(d.getHours())}時${pad2(d.getMinutes())}分ごろ` : '不明';
const fmtDepth = (km) => (km == null || km < 0 || Number.isNaN(+km) ? '不明' : +km === 0 ? 'ごく浅い' : +km >= 700 ? '700km以上' : `約${km}km`);

// 子要素 (.rv) を順番にふわっと表示する
function stagger(root, base = 0) {
  if (!root) return;
  root.querySelectorAll('.rv').forEach((el, i) => {
    el.classList.remove('rv-in');
    el.style.setProperty('--i', i + base);
    void el.offsetWidth; // アニメーションを再始動
    el.classList.add('rv-in');
  });
}
const fmtDateTime = (d) => d ? `${d.getMonth() + 1}/${d.getDate()} ${fmtTime(d)}` : '--';

// 暗い地図 (国土地理院 淡色地図を反転)
function makeBaseLayer() {
  return L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', {
    maxZoom: 13, maxNativeZoom: 18, minZoom: 4, className: 'basemap',
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html">国土地理院</a>',
  });
}
function homeIcon() {
  return L.divIcon({ className: '', html: '<div class="home-marker"></div>', iconSize: [12, 12], iconAnchor: [6, 6] });
}

// ---- 音 (ファイル不要。WebAudio で生成) ----
const Sound = {
  ctx: null, muted: false,
  tone(freq, start, dur, type = 'sine', vol = 0.25) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, ctx.currentTime + start);
    g.gain.linearRampToValueAtTime(vol, ctx.currentTime + start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
    o.connect(g).connect(ctx.destination);
    o.start(ctx.currentTime + start); o.stop(ctx.currentTime + start + dur + 0.05);
  },
  play(kind) {
    if (this.muted) return;
    try {
      this.ctx = this.ctx || new AudioContext();
      if (this.ctx.state === 'suspended') this.ctx.resume();
      if (kind === 'warning') {
        // 警報: 2 音を交互に繰り返す
        for (let i = 0; i < 6; i++) { this.tone(880, i * 0.5, 0.22, 'square', 0.18); this.tone(660, i * 0.5 + 0.25, 0.22, 'square', 0.18); }
      } else if (kind === 'forecast') {
        this.tone(1046, 0, 0.35); this.tone(784, 0.35, 0.5);
      } else {
        this.tone(660, 0, 0.25, 'sine', 0.18); this.tone(880, 0.22, 0.35, 'sine', 0.18);
      }
    } catch { }
  },
};
