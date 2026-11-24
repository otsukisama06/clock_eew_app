// 雨雲レーダー (気象庁 高解像度降水ナウキャスト タイル)
// 現在 (最新の実況) から 1 時間先までの予報をアニメーション再生する (過去の観測は表示しない)
const JMA_NOWC = 'https://www.jma.go.jp/bosai/jmatile/data/nowc';
const RADAR_LEGEND = [
  ['#f2f2ff', '1'], ['#a0d2ff', '5'], ['#218cff', '10'], ['#0041ff', '20'],
  ['#faf500', '30'], ['#ff9900', '50'], ['#ff2800', '80'], ['#b40068', '80+'],
];

// "20261124021000" (UTC) → Date
const utcStamp = (s) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14)));

const Radar = {
  frames: [], layers: [], idx: 0, playing: true, timer: null, latestBase: '',

  init(cfg) {
    this.cfg = cfg;
    this.map = L.map('radar-map', { zoomControl: false, attributionControl: true, zoomSnap: 0.5 })
      .setView([cfg.radarLat, cfg.radarLon], cfg.radarZoom);
    L.control.zoom({ position: 'topright' }).addTo(this.map);
    makeBaseLayer().addTo(this.map);
    this.map.attributionControl.addAttribution('<a href="https://www.jma.go.jp/bosai/nowc/">気象庁</a>');
    this.home = L.marker([cfg.lat, cfg.lon], { icon: homeIcon(), interactive: false }).addTo(this.map);

    $('#radar-legend').innerHTML = RADAR_LEGEND.map(([c, t]) => `<span style="background:${c}">${t}</span>`).join('') + '<span style="color:#aaa">mm/h</span>';
    $('#radar-play').onclick = () => this.setPlaying(!this.playing);
    $('#radar-slider').oninput = (e) => { this.setPlaying(false); this.show(+e.target.value); };
    // ダブルクリックで地元にリセット
    this.map.on('dblclick', (e) => { L.DomEvent.stop(e); this.map.setView([cfg.radarLat, cfg.radarLon], cfg.radarZoom); });
    this.map.doubleClickZoom.disable();

    this.refresh();
    setInterval(() => this.refresh(), 5 * 60 * 1000);
  },

  // 現在地に合わせる (CLOCK_RADAR_LAT/LON が設定されていれば中心はそちらのまま)
  setLocation(loc) {
    this.home.setLatLng([loc.lat, loc.lon]);
    if (!this.cfg.radarFixed) {
      this.cfg = { ...this.cfg, radarLat: loc.lat, radarLon: loc.lon };
      this.map.setView([loc.lat, loc.lon], this.map.getZoom(), { animate: false });
    }
  },

  onShow() {
    this.map.invalidateSize();
    // 表示されたら「現在」から再生
    if (this.nowIdx != null) { this.show(this.nowIdx); this.setPlaying(true); }
  },

  async refresh() {
    try {
      const [n1, n2] = await Promise.all([
        window.clock.fetchJson(`${JMA_NOWC}/targetTimes_N1.json`),
        window.clock.fetchJson(`${JMA_NOWC}/targetTimes_N2.json`),
      ]);
      // 実況は最新の 1 枚 (= 現在) だけ使う
      const past = n1.filter((t) => t.elements.includes('hrpns')).sort((a, b) => a.validtime.localeCompare(b.validtime)).slice(-1);
      const base = past[past.length - 1].basetime;
      // 予報は N2 の最新 basetime を使う (N1 より更新が少し遅れることがある)
      const fcBase = n2.reduce((m, t) => (t.basetime > m ? t.basetime : m), '');
      const key = base + fcBase;
      if (key === this.latestBase) return;
      const fut = n2.filter((t) => t.basetime === fcBase && t.validtime > base && t.elements.includes('hrpns'))
        .sort((a, b) => a.validtime.localeCompare(b.validtime)).slice(0, 12);
      this.latestBase = key;
      this.buildFrames([...past.map((t) => ({ ...t, fc: false })), ...fut.map((t) => ({ ...t, fc: true }))]);
    } catch (e) {
      $('#radar-kind').textContent = `レーダー取得失敗: ${e.message || e}`;
    }
  },

  buildFrames(frames) {
    for (const l of this.layers) this.map.removeLayer(l);
    this.frames = frames;
    this.nowIdx = frames.findIndex((f) => f.fc) - 1;
    if (this.nowIdx < 0) this.nowIdx = frames.length - 1;
    this.layers = frames.map((f) => L.tileLayer(
      `${JMA_NOWC}/${f.basetime}/none/${f.validtime}/surf/hrpns/{z}/{x}/{y}.png`,
      { opacity: 0, maxNativeZoom: 10, minZoom: 4, maxZoom: 13, zIndex: 10 },
    ).addTo(this.map));
    const s = $('#radar-slider');
    s.max = frames.length - 1;
    this.show(this.nowIdx);
    this.setPlaying(this.playing);
  },

  show(i) {
    if (!this.frames.length) return;
    this.idx = (i + this.frames.length) % this.frames.length;
    this.layers.forEach((l, k) => l.setOpacity(k === this.idx ? 0.72 : 0));
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
    if (!p) return;
    const step = () => {
      // 最新実況と最後のフレームでは少し止める
      const wait = this.idx === this.nowIdx ? 1500 : this.idx === this.frames.length - 1 ? 1200 : 450;
      this.timer = setTimeout(() => { this.show(this.idx + 1); step(); }, wait);
    };
    step();
  },
};
