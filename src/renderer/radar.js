// 雨雲レーダー (気象庁 高解像度降水ナウキャスト タイル)
// 現在 (最新の実況) から 1 時間先までの予報をアニメーション再生する (過去の観測は表示しない)
const JMA_NOWC = 'https://www.jma.go.jp/bosai/jmatile/data/nowc';
const RADAR_LEGEND = [
  ['#f2f2ff', '1'], ['#a0d2ff', '5'], ['#218cff', '10'], ['#0041ff', '20'],
  ['#faf500', '30'], ['#ff9900', '50'], ['#ff2800', '80'], ['#b40068', '80+'],
];

// "20261124021000" (UTC) → Date
const utcStamp = (s) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14)));

// メモリ節約のため、タイル画像は「レーダーページの直前〜表示中」だけ読み込み、離れたら解放する
const Radar = {
  frames: [], layers: [], idx: 0, playing: true, timer: null, latestBase: '',
  active: false, fetchedAt: 0,

  init(cfg) {
    this.cfg = cfg;
    this.map = L.map('radar-map', { zoomControl: false, attributionControl: true, zoomSnap: 0.5, fadeAnimation: false })
      .setView([cfg.radarLat, cfg.radarLon], cfg.radarZoom);
    L.control.zoom({ position: 'topright' }).addTo(this.map);
    this.base = makeBaseLayer();
    this.map.attributionControl.addAttribution('<a href="https://www.jma.go.jp/bosai/nowc/">気象庁</a>');
    this.home = L.marker([cfg.lat, cfg.lon], { icon: homeIcon(), interactive: false }).addTo(this.map);

    $('#radar-legend').innerHTML = RADAR_LEGEND.map(([c, t]) => `<span style="background:${c}">${t}</span>`).join('') + '<span style="color:#aaa">mm/h</span>';
    $('#radar-play').onclick = () => this.setPlaying(!this.playing);
    $('#radar-slider').oninput = (e) => { this.setPlaying(false); this.show(+e.target.value); };
    // ダブルクリックで地元にリセット
    this.map.on('dblclick', (e) => { L.DomEvent.stop(e); this.map.setView([cfg.radarLat, cfg.radarLon], cfg.radarZoom); });
    this.map.doubleClickZoom.disable();
    // 表示中は 5 分ごとに最新に更新
    setInterval(() => { if (this.active) this.refresh(); }, 5 * 60 * 1000);
  },

  // 現在地に合わせる (CLOCK_RADAR_LAT/LON が設定されていれば中心はそちらのまま)
  setLocation(loc) {
    this.home.setLatLng([loc.lat, loc.lon]);
    if (!this.cfg.radarFixed) {
      this.cfg = { ...this.cfg, radarLat: loc.lat, radarLon: loc.lon };
      this.map.setView([loc.lat, loc.lon], this.map.getZoom(), { animate: false });
    }
  },

  // 次に表示される前に呼ぶ: 地図と全コマのタイルを先に読み込んでおく (表示時にカクつかない)
  prepare() {
    this.active = true;
    clearTimeout(this.releaseTimer);
    this.map.invalidateSize();
    if (!this.map.hasLayer(this.base)) this.base.addTo(this.map);
    if (!this.frames.length || Date.now() - this.fetchedAt > 4 * 60 * 1000) this.refresh();
    else if (!this.layers.length) this.buildLayers();
  },

  onShow() {
    this.prepare();
    // 表示されたら「現在」から再生
    if (this.nowIdx != null) { this.show(this.nowIdx); this.setPlaying(true); }
  },

  // ページを離れたら再生を止め、タイルを捨ててメモリを返す
  onHide() {
    clearTimeout(this.timer);
    clearTimeout(this.releaseTimer);
    this.releaseTimer = setTimeout(() => this.release(), 1500);
  },
  release() {
    this.active = false;
    for (const l of this.layers) this.map.removeLayer(l);
    this.layers = [];
    if (this.map.hasLayer(this.base)) this.map.removeLayer(this.base);
    window.clock.clearCache();
  },

  async refresh() {
    try {
      const [n1, n2] = await Promise.all([
        window.clock.fetchJson(`${JMA_NOWC}/targetTimes_N1.json`),
        window.clock.fetchJson(`${JMA_NOWC}/targetTimes_N2.json`),
      ]);
      this.fetchedAt = Date.now();
      // 実況は最新の 1 枚 (= 現在) だけ使う
      const past = n1.filter((t) => t.elements.includes('hrpns')).sort((a, b) => a.validtime.localeCompare(b.validtime)).slice(-1);
      const base = past[past.length - 1].basetime;
      // 予報は N2 の最新 basetime を使う (N1 より更新が少し遅れることがある)
      const fcBase = n2.reduce((m, t) => (t.basetime > m ? t.basetime : m), '');
      const key = base + fcBase;
      if (key === this.latestBase && this.layers.length) return;
      const fut = n2.filter((t) => t.basetime === fcBase && t.validtime > base && t.elements.includes('hrpns'))
        .sort((a, b) => a.validtime.localeCompare(b.validtime)).slice(0, 12);
      this.latestBase = key;
      this.frames = [...past.map((t) => ({ ...t, fc: false })), ...fut.map((t) => ({ ...t, fc: true }))];
      this.nowIdx = 0;
      if (this.active) this.buildLayers();
    } catch (e) {
      $('#radar-kind').textContent = `レーダー取得失敗: ${e.message || e}`;
    }
  },

  buildLayers() {
    for (const l of this.layers) this.map.removeLayer(l);
    const frames = this.frames;
    this.layers = frames.map((f) => L.tileLayer(
      `${JMA_NOWC}/${f.basetime}/none/${f.validtime}/surf/hrpns/{z}/{x}/{y}.png`,
      { opacity: 0, maxNativeZoom: 10, minZoom: 4, maxZoom: 13, zIndex: 10, keepBuffer: 0, updateWhenIdle: true },
    ).addTo(this.map));
    // 画像の読み込み (通信) は全コマ先に済ませるが、描画 (GPU) は表示中のコマと次のコマだけにする
    for (const l of this.layers) l.getContainer().style.display = 'none';
    $('#radar-slider').max = frames.length - 1;
    this.show(this.nowIdx);
    if (App.current === 'radar') this.setPlaying(this.playing);
  },

  show(i) {
    if (!this.frames.length) return;
    const n = this.frames.length;
    this.idx = (i + n) % n;
    const next = (this.idx + 1) % n;
    // 表示中のコマ: 不透明 / 次のコマ: ほぼ透明で描画だけ先に済ませる (切替時にカクつかない) / それ以外: 描画しない
    this.layers.forEach((l, k) => {
      const c = l.getContainer();
      if (!c) return;
      if (k === this.idx) { c.style.display = ''; l.setOpacity(0.72); }
      else if (k === next) { c.style.display = ''; l.setOpacity(0.01); }
      else if (c.style.display !== 'none') { c.style.display = 'none'; l.setOpacity(0); }
    });
    const f = this.frames[this.idx];
    const t = utcStamp(f.validtime);
    $('#radar-time').textContent = fmtTime(t, false);
    const diff = Math.round((t - utcStamp(this.frames[this.nowIdx].validtime)) / 60000);
    const k = $('#radar-kind');
    k.textContent = f.fc ? `予報 +${diff}分` : '現在 (実況)';
    k.classList.toggle('fc', f.fc);
    $('#radar-slider').value = this.idx;
  },

  setPlaying(p) {
    this.playing = p;
    $('#radar-play').textContent = p ? '❚❚' : '▶';
    clearTimeout(this.timer);
    if (!p || App.current !== 'radar') return;
    const step = () => {
      // 現在と最後のコマでは少し止める
      const wait = this.idx === this.nowIdx ? 1500 : this.idx === this.frames.length - 1 ? 1200 : 500;
      this.timer = setTimeout(() => { this.show(this.idx + 1); step(); }, wait);
    };
    step();
  },
};
