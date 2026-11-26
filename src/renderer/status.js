// システムステータス
const fmtGB = (b) => `${(b / 1024 ** 3).toFixed(1)} GB`;
function fmtDur(sec) {
  sec = Math.floor(sec);
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return (d ? `${d}日 ` : '') + `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}
function fmtRate(bps) {
  const bits = bps * 8;
  if (bits >= 1e6) return `${(bits / 1e6).toFixed(1)} Mbps`;
  return `${(bits / 1e3).toFixed(0)} kbps`;
}

const Status = {
  rows: {},
  init() {
    const defs = [
      ['cpu', 'CPU 使用率', true], ['runtime', 'アプリ起動時間', false],
      ['mem', 'メモリ使用量', true], ['uptime', 'システム稼働時間', false],
      ['disk', 'ディスク使用量 (C:)', true], ['net', 'ネットワーク (↓ / ↑)', true],
    ];
    const grid = $('#status-grid');
    for (const [k, label, bar] of defs) {
      const el = document.createElement('div');
      el.className = 'metric rv';
      el.innerHTML = `<div class="lbl">${label}</div><div class="val">--</div>` + (bar ? '<div class="barw"><div class="bar"></div></div>' : '');
      grid.appendChild(el);
      this.rows[k] = { val: el.querySelector('.val'), bar: el.querySelector('.bar') };
    }
  },
  // 次に表示される前に呼ぶ: 計測を始めておき、表示した瞬間から数値が出るようにする
  prepare() {
    if (this.timer) return;
    this.update();
    this.timer = setInterval(() => this.update(), 1000);
  },
  onShow() { this.prepare(); },
  onHide() { clearInterval(this.timer); this.timer = null; },
  set(k, text, pct) {
    // 変わったときだけ書き換える (毎秒の再描画を最小にする)
    const r = this.rows[k];
    if (r.text !== text) { r.text = text; r.val.textContent = text; }
    if (r.bar && pct != null) {
      const p = Math.round(Math.max(0, Math.min(100, pct)));
      if (r.pct === p) return;
      r.pct = p;
      r.bar.style.transform = `scaleX(${p / 100})`;
      r.bar.classList.toggle('hi', p >= 75 && p < 90);
      r.bar.classList.toggle('crit', p >= 90);
    }
  },
  async update() {
    let s;
    try { s = await window.clock.sysStats(); } catch { return; }
    if (s.cpu != null) this.set('cpu', `${s.cpu.toFixed(1)} %`, s.cpu);
    const used = s.memTotal - s.memFree;
    this.set('mem', `${fmtGB(used)} / ${fmtGB(s.memTotal)}`, used / s.memTotal * 100);
    if (s.disk) this.set('disk', `${fmtGB(s.disk.used)} / ${fmtGB(s.disk.total)}`, s.disk.used / s.disk.total * 100);
    if (s.net) this.set('net', `${fmtRate(s.net.rx)} / ${fmtRate(s.net.tx)}`, Math.min(100, s.net.rx * 8 / 1e6));
    this.set('runtime', fmtDur(s.appRuntime));
    this.set('uptime', fmtDur(s.uptime));
  },
};
