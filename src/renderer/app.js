// ページ切替・地震割り込み・ウィンドウ操作
const PAGE_ORDER = ['clock', 'weather', 'radar', 'status', 'quake'];
// 各ページの準備 (prepare: 表示の数秒前に裏で読み込み) / 表示 / 非表示 の処理
const PAGE_HOOKS = {
  radar: { prepare: () => Radar.prepare(), show: () => Radar.onShow(), hide: () => Radar.onHide() },
  status: { prepare: () => Status.prepare(), show: () => Status.onShow(), hide: () => Status.onHide() },
  quake: { prepare: () => Quake.prepare(), show: () => Quake.onShow() },
  weather: { prepare: () => Weather.prepare() },
};
const hook = (page, kind) => { const f = PAGE_HOOKS[page] && PAGE_HOOKS[page][kind]; if (f) f(); };
// 切り替えの何秒前に次のページを準備するか
const PREPARE_LEAD_SEC = 5;

const App = {
  current: null,
  timer: null,
  alerting: false,
  hover: false,

  async init() {
    this.cfg = await window.clock.getConfig();
    this.applyState(this.cfg.state);
    window.clock.onState((s) => this.applyState(s));
    this.fitRootFont();
    window.addEventListener('resize', () => this.fitRootFont());

    // タブ
    const tabs = $('#tabs');
    for (const p of PAGE_ORDER) {
      const b = document.createElement('button');
      b.textContent = document.querySelector(`.page[data-page="${p}"]`).dataset.label;
      b.dataset.page = p;
      b.onclick = () => { this.show(p); this.schedule(); };
      tabs.appendChild(b);
    }
    // マウスが乗っている間はページ送りを止める
    document.body.addEventListener('mouseenter', () => { this.hover = true; });
    document.body.addEventListener('mouseleave', () => {
      this.hover = false;
      if (this.waitingHover && !this.alerting) {
        this.waitingHover = false;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => { if (!this.hover && !this.alerting) this.next(); else if (this.hover) this.waitingHover = true; }, 1500);
      }
    });

    $('#btn-top').onclick = () => window.clock.setTopmost(!this.state.topmost);
    $('#btn-settings').onclick = () => window.clock.openSettings();
    $('#btn-mute').onclick = () => window.clock.setMuted(!this.state.muted);
    $('#opacity').oninput = (e) => window.clock.setOpacity(e.target.value / 100);
    // ドラッグでウィンドウを移動 (ボタン・入力欄・地図の上は除く)
    const NO_DRAG = 'button, input, select, a, .map, .leaflet-control';
    document.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.target.closest(NO_DRAG)) return;
      e.preventDefault();
      document.body.classList.add('dragging');
      window.clock.dragStart();
    });
    const endDrag = () => {
      if (!document.body.classList.contains('dragging')) return;
      document.body.classList.remove('dragging');
      window.clock.dragEnd();
    };
    window.addEventListener('mouseup', endDrag);
    window.addEventListener('blur', endDrag);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'F6') window.clock.snap();
      if (e.key === 'Escape' && this.alerting) Quake.release();
      if (e.key === 'ArrowRight' && !this.alerting) { this.next(true); }
    });

    Clock.init();
    Status.init();
    Weather.init(this.cfg);
    Radar.init(this.cfg);
    Quake.init(this.cfg);
    Warnings.init();
    this.show('clock');
    this.schedule();
    this.updateLocation();
    setInterval(() => this.updateLocation(), 30 * 60 * 1000);
  },

  // 現在地を取得 (取れなければ設定の地点) して各ページに反映
  async updateLocation() {
    let loc;
    try { loc = await window.clock.getLocation(); } catch { loc = { lat: this.cfg.lat, lon: this.cfg.lon, source: 'config' }; }
    const moved = !this.loc || distKm(this.loc.lat, this.loc.lon, loc.lat, loc.lon) > 1;
    this.loc = loc;
    if (!moved && Warnings.place) return Warnings.refresh();
    await Warnings.setLocation(loc);
    const name = Warnings.place ? Warnings.place.name : this.cfg.city;
    Weather.setLocation(loc, name);
    Radar.setLocation(loc);
    Quake.setHome(loc, name);
  },

  applyState(s) {
    this.state = s;
    $('#btn-top').classList.toggle('on', s.topmost);
    $('#btn-top').textContent = s.topmost ? 'TOP ON' : 'TOP OFF';
    $('#btn-mute').classList.toggle('on', !s.muted);
    $('#btn-mute').textContent = s.muted ? '♪ OFF' : '♪ ON';
    $('#opacity').value = Math.round(s.opacity * 100);
    Sound.muted = s.muted;
    // 切り替え設定が変わったら、今のページのタイマーを掛け直す
    const key = JSON.stringify([s.pageInterval, s.pageSeconds, s.pageEnabled]);
    const changed = this._schedKey !== undefined && this._schedKey !== key;
    this._schedKey = key;
    if (changed && this.current) this.schedule();
  },

  // ウィンドウサイズに合わせて全体を拡大縮小 (基準 940x500)
  fitRootFont() {
    const scale = Math.max(0.55, Math.min(2.2, Math.min(innerWidth / 940, innerHeight / 500)));
    document.documentElement.style.fontSize = `${16 * scale}px`;
  },

  show(page) {
    if (page === this.current) return;
    const prev = this.current && document.querySelector(`.page[data-page="${this.current}"]`);
    const next = document.querySelector(`.page[data-page="${page}"]`);
    document.querySelectorAll('.page.leaving').forEach((el) => el.classList.remove('leaving'));
    if (prev) {
      const prevName = this.current;
      prev.classList.remove('active'); prev.classList.add('leaving');
      setTimeout(() => { prev.classList.remove('leaving'); if (this.current !== prevName) hook(prevName, 'hide'); }, 350);
    }
    next.classList.add('active');
    stagger(next);
    this.current = page;
    document.body.dataset.page = page;
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
    hook(page, 'show');
  },

  // 自動切替で次に出すページ (チェックの外れたページは飛ばす)
  nextPage(manual = false) {
    const en = (this.state && this.state.pageEnabled) || {};
    const i = PAGE_ORDER.indexOf(this.current);
    for (let k = 1; k <= PAGE_ORDER.length; k++) {
      const p = PAGE_ORDER[(i + k) % PAGE_ORDER.length];
      if (manual || en[p] !== false) return p;
    }
    return this.current;
  },

  next(manual = false) {
    const p = this.nextPage(manual);
    if (p !== this.current) { hook(p, 'prepare'); this.show(p); }
    this.schedule();
  },

  schedule() {
    clearTimeout(this.timer);
    if (this.alerting) return;
    const iv = this.state && this.state.pageInterval;
    const bar = $('#progress');
    if (iv === 0) { bar.style.transition = 'none'; bar.style.transform = 'scaleX(0)'; return; } // 自動切替しない
    const secs = (this.state && this.state.pageSeconds) || this.cfg.pageSeconds;
    const sec = iv > 0 ? iv : (secs[this.current] || 9);
    bar.classList.remove('paused');
    this.waitingHover = false;
    // 次のページまでの残り時間をヘッダー下の細いバーで表示
    bar.style.transition = 'none'; bar.style.transform = 'scaleX(0)';
    void bar.offsetWidth;
    // transform の transition は GPU (コンポジタ) で動くので、滑らかにしても負荷は小さい
    bar.style.transition = `transform ${sec}s linear`; bar.style.transform = 'scaleX(1)';
    // 切り替えの少し前に次のページを裏で準備しておく (地図タイルの読み込みなど)
    clearTimeout(this.prepTimer);
    const upcoming = this.nextPage();
    if (upcoming !== this.current) this.prepTimer = setTimeout(() => hook(upcoming, 'prepare'), Math.max(0, sec - PREPARE_LEAD_SEC) * 1000);
    this.timer = setTimeout(() => {
      if (this.alerting) return;
      // マウスが乗っている間は止め、離れてから少しして切り替える
      if (this.hover && this.state.pauseOnHover !== false) { this.waitingHover = true; bar.classList.add('paused'); return; }
      this.next();
    }, sec * 1000);
  },

  // 地震受信: 他の表示を止めて地震情報だけを表示
  takeover(kind, label) {
    this.alerting = true;
    clearTimeout(this.timer);
    clearTimeout(this.prepTimer);
    document.body.classList.remove('alert-warning', 'alert-forecast', 'alert-info', 'alert-cancel');
    document.body.classList.add('alerting', `alert-${kind}`);
    const banner = $('#alert-banner');
    banner.textContent = label;
    banner.hidden = false;
    this.show('quake');
    window.clock.quakeAlert();
  },

  release() {
    if (!this.alerting) return;
    this.alerting = false;
    document.body.classList.remove('alerting', 'alert-warning', 'alert-forecast', 'alert-info', 'alert-cancel');
    $('#alert-banner').hidden = true;
    window.clock.quakeAlertEnd();
    this.schedule();
  },
};

App.init();
