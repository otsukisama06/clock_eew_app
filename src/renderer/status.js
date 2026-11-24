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
    this.update();
    setInterval(() => this.update(), 1000);
  },
  set(k, text, pct) {
    const r = this.rows[k];
    r.val.textContent = text;
    if (r.bar && pct != null) {
      const p = Math.max(0, Math.min(100, pct));
      r.bar.style.width = `${p}%`;
      r.bar.classList.toggle('hi', p >= 75 && p < 90);
      r.bar.classList.toggle('crit', p >= 90);
    }
  },
  async update() {
    if (document.body.dataset.page !== 'status' && this.rows.cpu.val.textContent !== '--') {
      // 非表示中も CPU 差分のためにサンプリングだけは続ける (5 秒毎)
      if ((this._skip = (this._skip || 0) + 1) % 5) return;
    }
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
