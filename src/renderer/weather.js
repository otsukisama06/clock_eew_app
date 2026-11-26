// 天気 (Open-Meteo)
const WMO_JA = {
  0: '快晴', 1: '晴れ', 2: '晴れ時々曇り', 3: '曇り', 45: '霧', 48: '霧氷',
  51: '霧雨', 53: '霧雨', 55: '霧雨', 56: '着氷性霧雨', 57: '着氷性霧雨',
  61: '雨', 63: '雨', 65: '強い雨', 66: '着氷性の雨', 67: '着氷性の雨',
  71: '雪', 73: '雪', 75: '大雪', 77: '霧雪', 80: 'にわか雨', 81: 'にわか雨', 82: '激しいにわか雨',
  85: 'にわか雪', 86: 'にわか雪', 95: '雷雨', 96: '雷雨・ひょう', 99: '雷雨・ひょう',
};

function weatherIcon(code, night = false) {
  const sun = night
    ? '<path d="M44 14a16 16 0 1 0 14 22 13 13 0 0 1-14-22z" fill="#e8e4b0"/>'
    : '<circle cx="40" cy="26" r="12" fill="#f5c542"/><g stroke="#f5c542" stroke-width="3" stroke-linecap="round"><path d="M40 5v5M40 42v5M19 26h5M56 26h5M25 11l3.5 3.5M51.5 37.5 55 41M25 41l3.5-3.5M51.5 14.5 55 11"/></g>';
  const cloud = (c = '#9db0bd') => `<path d="M22 54h38a11 11 0 0 0 0-22 15 15 0 0 0-28-4 12 12 0 0 0-10 26z" fill="${c}"/>`;
  const drops = '<g stroke="#5fb4ff" stroke-width="3" stroke-linecap="round"><path d="M28 60l-3 7M40 60l-3 7M52 60l-3 7"/></g>';
  const snow = '<g fill="#d9f3ff"><circle cx="28" cy="64" r="2.6"/><circle cx="40" cy="67" r="2.6"/><circle cx="52" cy="64" r="2.6"/></g>';
  let body;
  if (code === 0 || code === 1) body = night ? '<path d="M48 12a20 20 0 1 0 18 28 16 16 0 0 1-18-28z" fill="#e8e4b0"/>' : sun.replace(/40/g, '40');
  else if (code === 2) body = `<g transform="translate(-10,-4) scale(.85)">${sun}</g>${cloud()}`;
  else if (code === 3 || code === 45 || code === 48) body = cloud();
  else if ([71, 73, 75, 77, 85, 86].includes(code)) body = cloud() + snow;
  else if ([95, 96, 99].includes(code)) body = cloud('#7d8b96') + '<path d="M42 54l-8 12h7l-4 10 12-14h-7l4-8z" fill="#ffd35a"/>';
  else if (code >= 51) body = cloud('#8597a3') + drops;
  else body = cloud();
  return `<svg viewBox="0 0 80 80">${body}</svg>`;
}

const Weather = {
  init(cfg) {
    this.cfg = cfg;
    $('#w-city').textContent = cfg.city;
    this.refresh();
    setInterval(() => this.refresh(), 10 * 60 * 1000);
  },
  // 表示の前に、古くなっていれば取り直す
  prepare() { if (Date.now() - (this.fetchedAt || 0) > 10 * 60 * 1000) this.refresh(); },
  setLocation(loc, name) {
    this.cfg = { ...this.cfg, lat: loc.lat, lon: loc.lon };
    $('#w-city').textContent = name ? `${name}${loc.source === 'gps' ? '（現在地）' : ''}` : this.cfg.city;
    this.refresh();
  },
  async refresh() {
    const q = new URLSearchParams({
      latitude: this.cfg.lat, longitude: this.cfg.lon,
      current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,precipitation,wind_speed_10m,is_day',
      hourly: 'temperature_2m,weather_code,precipitation_probability,is_day',
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      timezone: 'Asia/Tokyo', forecast_days: 2, wind_speed_unit: 'ms',
    });
    try {
      const w = await window.clock.fetchJson(`https://api.open-meteo.com/v1/forecast?${q}`);
      this.fetchedAt = Date.now();
      this.render(w);
    } catch (e) {
      $('#w-cond').textContent = '天気の取得に失敗しました';
      $('#w-updated').textContent = String(e.message || e);
    }
  },
  render(w) {
    const c = w.current, d = w.daily;
    $('#w-icon').innerHTML = weatherIcon(c.weather_code, c.is_day === 0);
    $('#w-temp').textContent = `${c.temperature_2m.toFixed(1)}°`;
    $('#w-cond').textContent = WMO_JA[c.weather_code] || '--';
    $('#w-meta').innerHTML = [
      `最高 <b>${d.temperature_2m_max[0].toFixed(0)}°</b> / 最低 <b>${d.temperature_2m_min[0].toFixed(0)}°</b>`,
      `降水確率 <b>${d.precipitation_probability_max[0] ?? '--'}%</b> ・ 降水 <b>${c.precipitation.toFixed(1)}mm</b>`,
      `体感 <b>${c.apparent_temperature.toFixed(1)}°</b> ・ 湿度 <b>${c.relative_humidity_2m}%</b> ・ 風 <b>${c.wind_speed_10m.toFixed(1)}m/s</b>`,
    ].join('<br>');
    // 今から 12 時間
    const now = Date.now();
    const h = w.hourly;
    let start = h.time.findIndex((t) => new Date(t + ':00+09:00').getTime() > now - 3600e3);
    if (start < 0) start = 0;
    let html = '';
    for (let i = start; i < Math.min(start + 12, h.time.length); i++) {
      const hh = h.time[i].slice(11, 13);
      html += `<div class="hour rv"><div class="muted">${+hh}時</div>${weatherIcon(h.weather_code[i], h.is_day[i] === 0)}
        <div class="t">${Math.round(h.temperature_2m[i])}°</div><div class="p">${h.precipitation_probability[i] ?? '-'}%</div></div>`;
    }
    $('#w-hours').innerHTML = html;
    $('#w-updated').textContent = `更新 ${fmtTime(new Date(), false)} ・ Open-Meteo`;
    Clock.setInfo(`<span class="ci-icon">${weatherIcon(c.weather_code, c.is_day === 0)}</span>
      <span class="ci-temp">${c.temperature_2m.toFixed(1)}°</span><span class="ci-text">${WMO_JA[c.weather_code] || ''}</span>
      <span class="ci-sep"></span><span class="ci-text">最高 ${d.temperature_2m_max[0].toFixed(0)}° / 最低 ${d.temperature_2m_min[0].toFixed(0)}°</span>
      <span class="ci-sep"></span><span class="ci-text">降水 ${d.precipitation_probability_max[0] ?? '--'}%</span>`);
  },
};
