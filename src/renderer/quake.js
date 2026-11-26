// 緊急地震速報 (Wolfx) + 地震情報 (P2P地震情報)
// 受信したら App.takeover() で他の表示を止め、地震情報だけを表示する。
const WOLFX_WS = 'wss://ws-api.wolfx.jp/jma_eew';
const P2P_WS = 'wss://api.p2pquake.net/v2/ws';
const P2P_HISTORY = 'https://api.p2pquake.net/v2/history?codes=551&limit=20';

// 波の速さ (簡易モデル km/s)
const VP = 6.5, VS = 3.6;

const INFO_TYPE = {
  ScalePrompt: '震度速報', Destination: '震源に関する情報', ScaleAndDestination: '震源・震度に関する情報',
  DetailScale: '震源・震度に関する情報', Foreign: '遠地地震に関する情報', Other: '地震情報',
};
const TSUNAMI = {
  None: ['この地震による津波の心配はありません', false],
  Unknown: ['津波の有無は不明です', false],
  Checking: ['津波の有無を調査中です', true],
  NonEffective: ['若干の海面変動が予想されますが、被害の心配はありません', false],
  Watch: ['津波注意報が発表されています', true],
  Warning: ['津波警報が発表されています', true],
};

// ---- WebSocket (自動再接続付き) ----
function openSocket(url, { onOpen, onMessage, pingText, label }) {
  let ws, pingTimer, retry = 0;
  const connect = () => {
    try { ws = new WebSocket(url); } catch { return schedule(); }
    ws.onopen = () => {
      retry = 0; Quake.setConn(label, true);
      if (onOpen) onOpen(ws);
      if (pingText) pingTimer = setInterval(() => { try { ws.send(pingText); } catch { } }, 10000);
    };
    ws.onmessage = (ev) => { let d; try { d = JSON.parse(ev.data); } catch { return; } onMessage(d); };
    ws.onclose = () => { clearInterval(pingTimer); Quake.setConn(label, false); schedule(); };
    ws.onerror = () => { try { ws.close(); } catch { } };
  };
  const schedule = () => setTimeout(connect, Math.min(30000, 1000 * 2 ** retry++));
  connect();
}

const Quake = {
  mode: 'idle',          // idle | eew | info
  eew: null,             // 表示中の緊急地震速報
  eewSeen: new Map(),    // EventID -> { serial, everWarn }
  history: [],           // 地震情報 (P2P 551) 新しい順
  info: null,            // 表示中の地震情報
  releaseAt: 0,
  conn: {},

  init(cfg) {
    this.cfg = cfg;
    this.homeLat = cfg.lat; this.homeLon = cfg.lon; this.homeName = cfg.city;
    this.map = L.map('quake-map', { zoomControl: false, attributionControl: true }).setView([36.5, 137.5], 5);
    makeBaseLayer().addTo(this.map);
    this.map.attributionControl.addAttribution('Wolfx / P2P地震情報');
    this.layer = L.layerGroup().addTo(this.map);
    this.home = L.marker([cfg.lat, cfg.lon], { icon: homeIcon(), interactive: false, zIndexOffset: 500 }).addTo(this.map);
    $('#quake-dismiss').onclick = () => this.release();

    openSocket(WOLFX_WS, {
      label: 'EEW', pingText: 'ping',
      onOpen: (ws) => ws.send('query_jmaeew'),
      onMessage: (d) => { if (d.type === 'jma_eew' || (!d.type && d.EventID)) this.onEew(d); },
    });
    openSocket(P2P_WS, {
      label: '地震情報',
      onMessage: (d) => { if (d.code === 551) this.onInfo(d, true); },
    });
    this.loadHistory();
    setInterval(() => this.loadHistory(), 10 * 60 * 1000);
    setInterval(() => this.tick(), 1000);
    setInterval(() => { if (this.mode === 'eew') this.updateWaves(false); }, 200);
    window.clock.onTest((k) => this.test(k));
  },

  // 現在地 (取得できなければ設定の地点)
  setHome(loc, name) {
    this.homeLat = loc.lat; this.homeLon = loc.lon;
    this.homeName = name || this.cfg.city;
    this.homeIsGps = loc.source === 'gps';
    this.home.setLatLng([loc.lat, loc.lon]);
  },
  homeLabel() { return this.homeIsGps ? `現在地（${this.homeName}）` : this.homeName; },

  setConn(label, ok) { this.conn[label] = ok; if (this.mode === 'idle') this.renderIdle(); },

  async loadHistory() {
    try {
      const list = await window.clock.fetchJson(P2P_HISTORY);
      for (const q of list.reverse()) this.onInfo(q, false);
    } catch { }
    if (this.mode === 'idle') this.renderIdle();
  },

  prepare() {
    this.map.invalidateSize();
    if (this.mode === 'idle') this.renderIdle();
  },

  onShow() {
    this.map.invalidateSize();
    this._idleShown = false;
    if (this.mode === 'idle') this.renderIdle();
  },

  // ============ 緊急地震速報 ============
  parseWolfx(d) {
    return {
      id: String(d.EventID), serial: +d.Serial || 0,
      announced: parseJst(d.AnnouncedTime), origin: parseJst(d.OriginTime),
      name: d.Hypocenter || '不明', lat: +d.Latitude, lon: +d.Longitude,
      mag: d.Magnitude ?? d.Magunitude, depth: +d.Depth || 0,
      maxInt: shindoKey(d.MaxIntensity),
      warn: !!d.isWarn, final: !!d.isFinal, cancel: !!d.isCancel,
      training: !!d.isTraining || (d.Issue && d.Issue.Status === '訓練'),
      test: d.Issue && d.Issue.Status === '試験',
      assumption: !!d.isAssumption, sea: !!d.isSea,
      areas: (d.WarnArea || []).map((a) => ({
        name: a.Chiiki, int: shindoKey(a.Shindo1), warn: a.Type === '警報', arrive: a.Arrive, time: a.Time,
      })),
      demo: !!d._demo,
    };
  },

  onEew(raw) {
    const e = this.parseWolfx(raw);
    if (e.test) return;
    if (e.training && !this.cfg.eewShowTraining && !e.demo) return;
    // 3 分以上前の電文 (接続直後の最新報など) は表示しない
    if (!e.demo && e.announced && Date.now() - e.announced.getTime() > 3 * 60 * 1000) return;

    const seen = this.eewSeen.get(e.id);
    if (seen && seen.serial >= e.serial && !e.cancel) return;
    const isNew = !seen;
    const firstWarn = e.warn && !(seen && seen.everWarn);
    e.everWarn = e.warn || !!(seen && seen.everWarn);
    this.eewSeen.set(e.id, { serial: e.serial, everWarn: e.everWarn });

    this.eew = e;
    this.mode = 'eew';
    this.eewFitAt = 0;
    const kind = e.cancel ? 'cancel' : e.everWarn ? 'warning' : 'forecast';
    const label = e.cancel ? '緊急地震速報 取消'
      : `緊急地震速報（${e.everWarn ? '警報' : '予報'}）第${e.serial}報${e.final ? '（最終）' : ''}${e.demo ? ' テスト' : ''}`;
    App.takeover(kind, label);
    if (firstWarn) Sound.play('warning');
    else if (isNew && !e.cancel) Sound.play('forecast');

    // 最終報・取消は少し表示してから戻る。続報が来なければ 3 分で戻る。
    this.releaseAt = Date.now() + (e.cancel ? 20e3 : e.final ? 90e3 : 180e3);
    this.renderEew();
  },

  renderEew() {
    const e = this.eew;
    const c = SHINDO[e.maxInt] || SHINDO['?'];
    const homeD = distKm(e.lat, e.lon, this.homeLat, this.homeLon);
    const areas = e.areas.slice().sort((a, b) => Object.keys(SHINDO).indexOf(b.int) - Object.keys(SHINDO).indexOf(a.int));
    // 表記は気象庁の緊急地震速報・地震情報に合わせる
    $('#quake-panel').innerHTML = e.cancel ? `
      <div class="card rv" style="display:flex;flex-direction:column;justify-content:center;align-items:center;gap:.6rem">
        <div class="q-big">先ほどの緊急地震速報は取り消されました</div><div class="muted">${esc(e.name)}</div></div>` : `
      <div class="q-head rv">
        <div class="shindo" style="background:${c.bg};color:${c.fg}"><div class="k">予想最大震度</div><div class="v">${shindoLabel(e.maxInt, true)}</div></div>
        <div class="q-head-body">
          <div class="q-title">${esc(e.name)}${e.sea ? '<span class="q-tag">海域</span>' : ''}${e.assumption ? '<span class="q-tag">仮定震源要素</span>' : ''}</div>
          <dl class="q-rows">
            <dt>発生時刻</dt><dd>${fmtJmaTime(e.origin)}</dd>
            <dt>深さ</dt><dd>${fmtDepth(e.depth)}</dd>
            <dt>マグニチュード</dt><dd>${e.mag != null ? Number(e.mag).toFixed(1) : '不明'}</dd>
          </dl>
        </div>
      </div>
      ${e.everWarn ? '<div class="q-notice rv">強い揺れに警戒してください</div>' : ''}
      <div class="q-count rv" id="q-count"><span class="muted small">${esc(this.homeLabel())}まで ${homeD.toFixed(0)}km<br>主要動の到達まで</span><span class="n">--</span></div>
      <div class="q-list">${areas.length ? '<div class="q-list-h rv">強い揺れが予想される地域（予想震度）</div>' + areas.slice(0, 12).map((a) => `
        <div class="row rv">${shindoBadge(a.int)}<span class="names">${esc(a.name)}
          <span class="muted">${a.arrive === '既に到達' ? '既に主要動到達と推測' : ''}</span></span></div>`).join('')
        : '<div class="muted small rv">警報の発表地域はありません</div>'}</div>
      <div class="muted small rv">第${e.serial}報${e.final ? '（最終報）' : ''} ・ ${fmtTime(e.announced)} 発表 ・ 震度と到達時刻は予想です</div>`;
    stagger($('#quake-panel'));
    $('#quake-dismiss').hidden = false;

    this.layer.clearLayers();
    this.epi = L.marker([e.lat, e.lon], { icon: L.divIcon({ className: '', html: '<div class="epi"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }) });
    const sColor = e.everWarn ? '#e0322b' : '#f2c12e';
    this.pCircle = L.circle([e.lat, e.lon], { radius: 1, color: '#5fb4ff', weight: 1.5, fill: false, dashArray: e.assumption ? '6 6' : null });
    this.sCircle = L.circle([e.lat, e.lon], { radius: 1, color: sColor, weight: 2, fillColor: sColor, fillOpacity: 0.1 });
    if (!e.cancel) this.layer.addLayer(this.pCircle).addLayer(this.sCircle);
    this.layer.addLayer(this.epi);
    this.updateWaves(true);
  },

  updateWaves(force) {
    const e = this.eew;
    if (!e || e.cancel || !e.origin) return;
    const t = (Date.now() - e.origin.getTime()) / 1000;
    const r = (v) => Math.sqrt(Math.max(0, (v * t) ** 2 - e.depth ** 2));
    const rp = r(VP), rs = r(VS);
    this.pCircle.setRadius(Math.max(1, rp * 1000));
    this.sCircle.setRadius(Math.max(1, rs * 1000));

    // 自宅への主要動 (S 波) 到達カウントダウン
    const hypo = Math.hypot(distKm(e.lat, e.lon, this.homeLat, this.homeLon), e.depth);
    const remain = hypo / VS - t;
    const box = $('#q-count');
    if (box) {
      box.classList.toggle('arrived', remain <= 0);
      box.querySelector('.n').textContent = remain > 0 ? `${Math.ceil(remain)}秒` : '到達（推定）';
    }

    // 地図を揺れの範囲に合わせる (2 秒毎)
    if (force || Date.now() - this.eewFitAt > 2000) {
      this.eewFitAt = Date.now();
      const rad = Math.max(60, Math.min(rs * 1.15, 900)) * 1000;
      const b = L.latLng(e.lat, e.lon).toBounds(rad * 2);
      this.map.fitBounds(b, { animate: !force, maxZoom: 9 });
    }
  },

  // ============ 地震情報 (P2P 551) ============
  onInfo(q, live) {
    if (!q || !q.earthquake) return;
    const id = q.id || q._id;
    if (this.history.some((h) => (h.id || h._id) === id)) return;
    this.history.unshift(q);
    this.history.sort((a, b) => (b.earthquake.time || '').localeCompare(a.earthquake.time || '') || (b.issue.time || '').localeCompare(a.issue.time || ''));
    this.history = this.history.slice(0, 30);
    if (!live) return;

    const eq = q.earthquake;
    const tsunami = TSUNAMI[eq.domesticTsunami];
    const hit = eq.maxScale >= this.cfg.quakeMinScale || (tsunami && tsunami[1]);
    // 緊急地震速報の表示中は (最終報から 30 秒は) そちらを優先
    if (this.mode === 'eew' && this.eew && !(this.eew.final || this.eew.cancel) && !q._demo) { if (this.mode === 'idle') this.renderIdle(); return; }
    if (!hit && !q._demo) { if (this.mode === 'idle') this.renderIdle(); return; }

    this.info = q;
    this.mode = 'info';
    App.takeover('info', `${INFO_TYPE[q.issue.type] || '地震情報'}${q._demo ? ' テスト' : ''}`);
    Sound.play('info');
    this.releaseAt = Date.now() + this.cfg.quakeHoldSeconds * 1000;
    this.renderInfo(q, true);
  },

  infoPanel(q, { list = 'points' } = {}) {
    const eq = q.earthquake, h = eq.hypocenter || {};
    const key = p2pScaleKey(eq.maxScale);
    const c = SHINDO[key] || SHINDO['?'];
    const t = parseJst(eq.time);
    const ts = TSUNAMI[eq.domesticTsunami];
    let listHtml = '';
    if (list === 'points') {
      const groups = new Map();
      for (const p of q.points || []) {
        const k = p.scale;
        if (!groups.has(k)) groups.set(k, new Map());
        const g = groups.get(k);
        if (!g.has(p.pref)) g.set(p.pref, []);
        g.get(p.pref).push(p.addr);
      }
      listHtml = (groups.size ? '<div class="q-list-h rv">各地の震度</div>' : '') + [...groups.entries()].sort((a, b) => b[0] - a[0]).slice(0, 7).map(([s, prefs]) =>
        `<div class="row rv">${shindoBadge(p2pScaleKey(s))}<span class="names">${[...prefs.entries()].map(([pf, a]) =>
          `<b>${esc(pf)}</b> ${esc(a.slice(0, 6).join('・'))}${a.length > 6 ? ` 他${a.length - 6}` : ''}`).join(' ')}</span></div>`).join('')
        || '<div class="muted small rv">震度の観測情報はありません</div>';
    } else {
      listHtml = '<div class="q-list-h rv">最近の地震</div>' + this.history.slice(0, 8).map((x) => {
        const e2 = x.earthquake, h2 = e2.hypocenter || {};
        return `<div class="row rv">${shindoBadge(p2pScaleKey(e2.maxScale))}<span class="names">
          <span class="muted">${fmtDateTime(parseJst(e2.time)).slice(0, -3)}</span> ${esc(h2.name || '震源調査中')}
          ${h2.magnitude > 0 ? `<span class="muted">M${h2.magnitude.toFixed(1)}</span>` : ''}</span></div>`;
      }).join('');
    }
    return `
      <div class="q-head rv">
        <div class="shindo" style="background:${c.bg};color:${c.fg}"><div class="k">最大震度</div><div class="v">${shindoLabel(key, true)}</div></div>
        <div class="q-head-body">
          <div class="q-title">${esc(h.name || '調査中')}</div>
          <dl class="q-rows">
            <dt>発生時刻</dt><dd>${fmtJmaTime(t)}</dd>
            <dt>深さ</dt><dd>${fmtDepth(h.depth)}</dd>
            <dt>マグニチュード</dt><dd>${h.magnitude > 0 ? h.magnitude.toFixed(1) : '不明'}</dd>
          </dl>
        </div>
      </div>
      ${ts ? `<div class="q-tsunami rv ${ts[1] ? 'on' : ''}">${ts[0]}</div>` : ''}
      <div class="q-list ${list === 'history' ? 'q-history' : ''}">${listHtml}</div>
      <div class="muted small rv">${esc(INFO_TYPE[q.issue.type] || '地震情報')} ・ ${esc(q.issue.source || '気象庁')} ${fmtTime(parseJst(q.issue.time), false)} 発表</div>`;
  },

  drawInfoMap(q, fit) {
    this.layer.clearLayers();
    const h = q.earthquake.hypocenter || {};
    if (h.latitude > -90 && h.longitude > -180) {
      this.layer.addLayer(L.marker([h.latitude, h.longitude], {
        icon: L.divIcon({ className: '', html: '<div class="epi"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
      }));
      if (fit) this.map.setView([h.latitude, h.longitude], q.earthquake.maxScale >= 50 ? 7 : 7.5, { animate: false });
    } else if (fit) this.map.setView([36.5, 137.5], 5, { animate: false });
  },

  renderInfo(q) {
    $('#quake-panel').innerHTML = this.infoPanel(q);
    stagger($('#quake-panel'));
    $('#quake-dismiss').hidden = false;
    this.drawInfoMap(q, true);
  },

  // 通常のページ巡回で表示する内容 (最新の地震 + 履歴)
  renderIdle() {
    $('#quake-dismiss').hidden = true;
    const conn = Object.entries(this.conn).map(([k, v]) => `${k} ${v ? '<span style="color:#3dc47e">●</span>' : '<span style="color:#e0322b">●</span>'}`).join('　');
    const latest = this.history[0];
    if (!latest) {
      $('#quake-panel').innerHTML = `<div class="empty">地震情報を待っています<br><span class="small">${conn}</span></div>`;
      return;
    }
    $('#quake-panel').innerHTML = this.infoPanel(latest, { list: 'history' }) + `<div class="muted small">接続: ${conn}</div>`;
    if (App.current === 'quake' && !this._idleShown) stagger($('#quake-panel'));
    this._idleShown = App.current === 'quake';
    this.drawInfoMap(latest, false);
    // 履歴の震央も小さく表示
    for (const x of this.history.slice(1, 10)) {
      const h = x.earthquake.hypocenter || {};
      if (!(h.latitude > -90)) continue;
      const col = (SHINDO[p2pScaleKey(x.earthquake.maxScale)] || SHINDO['?']).bg;
      this.layer.addLayer(L.circleMarker([h.latitude, h.longitude], { radius: 4, color: '#000', weight: 1, fillColor: col, fillOpacity: 0.9 }));
    }
    const h = latest.earthquake.hypocenter || {};
    if (!this._idleFitted && h.latitude > -90) { this._idleFitted = true; this.map.setView([h.latitude, h.longitude], 6, { animate: false }); }
  },

  release() {
    this.mode = 'idle';
    this.eew = null;
    this.releaseAt = 0;
    this._idleFitted = false;
    App.release();
    this.renderIdle();
  },

  tick() {
    if (this.mode !== 'idle' && this.releaseAt && Date.now() > this.releaseAt) this.release();
  },

  // ============ テスト表示 (トレイメニューから) ============
  test(kind) {
    const now = new Date(Date.now() + 9 * 3600e3); // JST 文字列用
    const f = (d) => d.toISOString().replace('T', ' ').slice(0, 19).replace(/-/g, '/');
    const origin = new Date(now.getTime() - 4000);
    const lat = this.homeLat + 0.35, lon = this.homeLon - 0.55;
    if (kind === 'info') {
      this.onInfo({
        id: 'demo-' + Date.now(), _demo: true, code: 551, issue: { type: 'DetailScale', time: f(now) },
        earthquake: { time: f(origin), maxScale: 45, domesticTsunami: 'None', hypocenter: { name: 'テスト震源', latitude: lat, longitude: lon, depth: 30, magnitude: 5.4 } },
        points: [
          { pref: 'テスト県', addr: 'A市', scale: 45 }, { pref: 'テスト県', addr: 'B町', scale: 40 },
          { pref: 'テスト県', addr: 'C村', scale: 30 }, { pref: 'サンプル県', addr: 'D市', scale: 30 }, { pref: 'サンプル県', addr: 'E市', scale: 20 },
        ],
      }, true);
      return;
    }
    const warn = kind === 'warning';
    const id = 'demo' + Date.now();
    const base = {
      _demo: true, type: 'jma_eew', EventID: id, AnnouncedTime: f(now), OriginTime: f(origin), Hypocenter: 'テスト震源（訓練）',
      Latitude: lat, Longitude: lon, Magnitude: warn ? 6.4 : 4.8, Depth: 20, MaxIntensity: warn ? '6弱' : '3',
      isWarn: warn, isFinal: false, isCancel: false, isTraining: true, Issue: { Status: '通常' },
      WarnArea: warn ? [
        { Chiiki: 'テスト地方北部', Shindo1: '6弱', Shindo2: '5強', Type: '警報', Arrive: '未到達' },
        { Chiiki: 'テスト地方南部', Shindo1: '5強', Shindo2: '5弱', Type: '警報', Arrive: '未到達' },
        { Chiiki: 'サンプル地方', Shindo1: '5弱', Shindo2: '4', Type: '警報', Arrive: '未到達' },
      ] : [],
    };
    this.onEew({ ...base, Serial: 1 });
    setTimeout(() => this.onEew({ ...base, Serial: 2, isFinal: true, AnnouncedTime: f(new Date(Date.now() + 9 * 3600e3)) }), 8000);
  },
};
