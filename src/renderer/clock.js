// メインの時計 (文字表示)
// 低負荷: 1 秒に 1 回だけ更新し、変わった文字だけ書き換える。コロンの点滅と分のバーは CSS アニメーションに任せる
const WEEK_JA = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'];
const WEEK_SHORT = ['日', '月', '火', '水', '木', '金', '土'];

const Clock = {
  init() {
    this.els = {
      h: $('#c-h'), m: $('#c-m'), s: $('#c-sec'),
      mh: $('#mini-h'), mm: $('#mini-m'), ms: $('#mini-s'),
      date: $('#clock-date'), hdate: $('#date'), bar: $('#c-minute-bar'),
    };
    this.prev = {};
    this.tick();
  },
  set(key, text) {
    if (this.prev[key] === text) return;
    this.prev[key] = text;
    this.els[key].textContent = text;
  },
  tick() {
    const now = nowDate();
    const h = pad2(now.getHours()), m = pad2(now.getMinutes()), s = pad2(now.getSeconds());
    this.set('h', h); this.set('m', m); this.set('s', s);
    this.set('mh', h); this.set('mm', m); this.set('ms', s);
    this.set('date', `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${WEEK_JA[now.getDay()]}`);
    this.set('hdate', `${now.getMonth() + 1}/${now.getDate()} (${WEEK_SHORT[now.getDay()]})`);
    // 分のバー: 次の秒の位置まで 1 秒かけて滑らかに伸ばす (transform の transition は GPU で動くので軽い)
    const bar = this.els.bar, sec = now.getSeconds();
    if (sec === 0 || !this.barStarted) {
      // 分の始め (と起動直後) は逆戻りのアニメーションをさせずに一瞬で位置を合わせる
      this.barStarted = true;
      bar.style.transition = 'none';
      bar.style.transform = `scaleX(${sec / 60})`;
      void bar.offsetWidth;
    }
    bar.style.transition = `transform ${(1000 - now.getMilliseconds()) / 1000}s linear`;
    bar.style.transform = `scaleX(${(sec + 1) / 60})`;
    setTimeout(() => this.tick(), 1000 - now.getMilliseconds() + 5);
  },
  // 時計の下に、今の天気を小さく表示
  setInfo(html) { $('#clock-info').innerHTML = html; },
};
