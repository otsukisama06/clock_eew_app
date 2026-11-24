// 現在地に発表中の気象警報・注意報 (気象庁 防災情報 JSON)
// 現在地 → 国土地理院の逆ジオコーダで市区町村コード → 気象庁の area.json で予報区・府県を特定
const JMA_AREA = 'https://www.jma.go.jp/bosai/common/const/area.json';
const JMA_WARNING = (office) => `https://www.jma.go.jp/bosai/warning/data/warning/${office}.json`;
const GSI_REVGEO = (lat, lon) => `https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${lat}&lon=${lon}`;

// 気象庁の警報・注意報コード
const WARN_CODES = {
  '02': '暴風雪警報', '03': '大雨警報', '04': '洪水警報', '05': '暴風警報', '06': '大雪警報', '07': '波浪警報', '08': '高潮警報',
  '10': '大雨注意報', '12': '大雪注意報', '13': '風雪注意報', '14': '雷注意報', '15': '強風注意報', '16': '波浪注意報',
  '17': '融雪注意報', '18': '洪水注意報', '19': '高潮注意報', '20': '濃霧注意報', '21': '乾燥注意報', '22': 'なだれ注意報',
  '23': '低温注意報', '24': '霜注意報', '25': '着氷注意報', '26': '着雪注意報', '27': 'その他の注意報',
  '32': '暴風雪特別警報', '33': '大雨特別警報', '35': '暴風特別警報', '36': '大雪特別警報', '37': '波浪特別警報', '38': '高潮特別警報',
};
const warnLevel = (name) => (name.includes('特別警報') ? 3 : name.includes('警報') ? 2 : 1);
const WARN_CLASS = { 3: 'w-special', 2: 'w-warning', 1: 'w-advisory' };

const Warnings = {
  area: null, place: null, list: [], error: null,

  init() {
    this.render();
    setInterval(() => this.refresh(), 5 * 60 * 1000);
  },

  // 位置が決まったら (変わったら) 呼ぶ
  async setLocation(loc) {
    this.loc = loc;
    try {
      await this.resolvePlace(loc);
      await this.refresh();
    } catch (e) {
      this.error = '警報・注意報の取得に失敗しました';
      this.render();
    }
  },

  async resolvePlace({ lat, lon }) {
    const rg = await window.clock.fetchJson(GSI_REVGEO(lat.toFixed(5), lon.toFixed(5)));
    const muni = rg && rg.results && rg.results.muniCd;
    if (!muni) throw new Error('市区町村が特定できません');
    if (!this.area) this.area = await window.clock.fetchJson(JMA_AREA);
    const a = this.area;
    // 市区町村コード (5 桁) で始まる二次細分区域 (豊田市西部/東部 のように分割される場合がある)
    const muniKey = String(muni).padStart(5, '0');
    const codes = Object.keys(a.class20s).filter((k) => k.startsWith(muniKey));
    if (!codes.length) throw new Error('予報区が見つかりません');
    // 親をたどって府県予報区 (office) を探す
    let p = a.class20s[codes[0]].parent;
    for (let i = 0; i < 5 && p && !a.offices[p]; i++) p = (a.class15s[p] || a.class10s[p] || {}).parent;
    const names = codes.map((c) => a.class20s[c].name);
    this.place = { codes, office: p, name: commonPrefix(names) || names[0], officeName: a.offices[p] ? a.offices[p].name : '' };
  },

  async refresh() {
    if (!this.place || !this.place.office) return;
    try {
      const w = await window.clock.fetchJson(JMA_WARNING(this.place.office));
      const found = new Map();
      for (const at of w.areaTypes || []) for (const ar of at.areas || []) {
        if (!this.place.codes.includes(ar.code)) continue;
        for (const x of ar.warnings || []) {
          if (!x.code || x.status === '解除' || x.status === '発表警報・注意報はなし') continue;
          const name = WARN_CODES[x.code] || `警報・注意報 (${x.code})`;
          found.set(name, { name, level: warnLevel(name), status: x.status });
        }
      }
      this.list = [...found.values()].sort((a, b) => b.level - a.level);
      this.headline = (w.headlineText || '').trim();
      this.updated = new Date(w.reportDatetime);
      this.error = null;
    } catch (e) {
      this.error = '警報・注意報の取得に失敗しました';
    }
    this.render();
  },

  chips(max = 99) {
    return this.list.slice(0, max).map((x) => `<span class="wchip ${WARN_CLASS[x.level]}">${esc(x.name)}</span>`).join('');
  },

  render() {
    // ヘッダー: 何か出ていれば常に表示 (地震表示中も)
    const chip = $('#warn-chip');
    const top = this.list[0];
    if (top) {
      chip.hidden = false;
      chip.className = WARN_CLASS[top.level];
      chip.textContent = `${this.place.name} ${top.name}${this.list.length > 1 ? ` 他${this.list.length - 1}` : ''}`;
      chip.title = this.list.map((x) => x.name).join(' / ');
    } else chip.hidden = true;

    // 天気ページ
    const box = $('#w-warn');
    if (!box) return;
    const where = this.place ? `${esc(this.place.name)}${this.loc && this.loc.source === 'gps' ? '（現在地）' : ''}` : '';
    if (this.error) box.innerHTML = `<span class="muted small">${this.error}</span>`;
    else if (!this.place) box.innerHTML = '<span class="muted small">現在地を確認中...</span>';
    else box.innerHTML = `<span class="w-where">${where}</span>` +
      (this.list.length ? this.chips() : '<span class="muted small">発表中の警報・注意報はありません</span>');
  },
};

function commonPrefix(arr) {
  if (!arr.length) return '';
  let p = arr[0];
  for (const s of arr) while (!s.startsWith(p)) p = p.slice(0, -1);
  return p.replace(/(東部|西部|南部|北部|中部)$/, '');
}
