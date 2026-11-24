// 7 セグメント時計
// 太めのセグメント (六角形) を計算で作る。T = 太さ, G = すき間
const SEG_W = 104, SEG_H = 186, T = 22, G = 2.5;
function hSeg(yc, x0, x1) { const h = T / 2; return [[x0, yc], [x0 + h, yc - h], [x1 - h, yc - h], [x1, yc], [x1 - h, yc + h], [x0 + h, yc + h]]; }
function vSeg(xc, y0, y1) { const h = T / 2; return [[xc, y0], [xc + h, y0 + h], [xc + h, y1 - h], [xc, y1], [xc - h, y1 - h], [xc - h, y0 + h]]; }
const SEGMENTS = (() => {
  const h = T / 2, L = h + 1, R = SEG_W - h - 1, top = h + 1, mid = SEG_H / 2, bot = SEG_H - h - 1;
  return {
    a: hSeg(top, L + G, R - G), g: hSeg(mid, L + G, R - G), d: hSeg(bot, L + G, R - G),
    f: vSeg(L, top + G, mid - G), b: vSeg(R, top + G, mid - G),
    e: vSeg(L, mid + G, bot - G), c: vSeg(R, mid + G, bot - G),
  };
})();
const DIGIT_MAP = {
  0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg',
};

function makeDigit(el) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 104 186');
  const polys = {};
  for (const [k, pts] of Object.entries(SEGMENTS)) {
    const p = document.createElementNS(ns, 'polygon');
    p.setAttribute('points', pts.map((q) => q.join(',')).join(' '));
    p.style.fill = 'var(--off)';
    svg.appendChild(p);
    polys[k] = p;
  }
  el.appendChild(svg);
  let last = -1;
  return (n) => {
    if (n === last) return;
    last = n;
    const on = DIGIT_MAP[n] || '';
    for (const [k, p] of Object.entries(polys)) p.style.fill = on.includes(k) ? 'var(--on)' : 'var(--off)';
  };
}

const Clock = {
  init() {
    this.d = ['h1', 'h2', 'm1', 'm2', 's1', 's2'].map((id) => makeDigit(document.getElementById(id)));
    this.colon = $('#colon');
    this.dateEl = $('#date');
    this.mini = $('#clock-mini');
    this.tick();
  },
  tick() {
    const now = new Date();
    const h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
    [Math.floor(h / 10), h % 10, Math.floor(m / 10), m % 10, Math.floor(s / 10), s % 10].forEach((v, i) => this.d[i](v));
    this.colon.classList.toggle('dim', now.getMilliseconds() >= 500);
    const W = ['日', '月', '火', '水', '木', '金', '土'];
    this.dateEl.textContent = `${now.getFullYear()}/${pad2(now.getMonth() + 1)}/${pad2(now.getDate())} (${W[now.getDay()]})`;
    this.mini.innerHTML = `${pad2(h)}<span class="blink">:</span>${pad2(m)}<span class="s">${pad2(s)}</span>`;
    // 次の 0.5 秒境界で更新 (コロン点滅用)
    const ms = now.getMilliseconds();
    setTimeout(() => this.tick(), (ms < 500 ? 500 - ms : 1000 - ms) + 5);
  },
};
