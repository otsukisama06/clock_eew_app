// 設定ウィンドウ
const PAGES = [['clock', '時計'], ['weather', '天気'], ['radar', '雨雲'], ['status', 'PC'], ['quake', '地震']];
const $ = (s) => document.querySelector(s);
const rows = {};
let state = null;
let editing = false; // 入力中は受信した状態で上書きしない

function build() {
  const box = $('#rows');
  for (const [k, label] of PAGES) {
    const r = document.createElement('div');
    r.className = 'row';
    r.innerHTML = `<input type="checkbox" title="自動切り替えに含める"><span class="name">${label}</span>
      <input type="range" min="3" max="120" step="1"><span class="num"><input type="number" min="3" max="3600">秒</span>`;
    box.appendChild(r);
    const [en, range, num] = r.querySelectorAll('input');
    rows[k] = { r, en, range, num };
    range.oninput = () => { num.value = range.value; changed(); };
    num.oninput = () => { if (+num.value >= 3) range.value = Math.min(120, +num.value); changed(); };
    en.onchange = changed;
  }
  document.querySelectorAll('input[name=mode]').forEach((el) => { el.onchange = changed; });
  $('#all-sec').onchange = () => { $('input[name=mode][value=all]').checked = true; changed(); };
  $('#hover').onchange = changed;
  $('#reset').onclick = () => { editing = false; window.clock.resetPageSettings(); flash(); };
  $('#close').onclick = () => window.close();
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });
}

function render(s) {
  state = s;
  if (editing) return;
  const iv = s.pageInterval;
  const mode = iv === 0 ? 'off' : iv > 0 ? 'all' : 'per';
  $(`input[name=mode][value=${mode}]`).checked = true;
  if (iv > 0) {
    const sel = $('#all-sec');
    if (![...sel.options].some((o) => +o.value === iv)) sel.add(new Option(`${iv}秒`, iv));
    sel.value = String(iv);
  }
  for (const [k] of PAGES) {
    const { r, en, range, num } = rows[k];
    en.checked = s.pageEnabled[k] !== false;
    num.value = s.pageSeconds[k];
    range.value = Math.min(120, s.pageSeconds[k]);
    r.classList.toggle('off', !en.checked);
  }
  $('#hover').checked = s.pauseOnHover !== false;
  updateEnabled(mode);
}

function updateEnabled(mode) {
  // 「ページごと」以外では秒数は使わないので薄くする (どのページを回すかは有効)
  document.querySelectorAll('.row input[type=range], .row input[type=number]').forEach((el) => {
    el.closest('.row').querySelector('.num').classList.toggle('disabled', mode !== 'per');
    el.classList.toggle('disabled', mode !== 'per');
  });
}

let timer = null;
function changed() {
  editing = true;
  const mode = $('input[name=mode]:checked').value;
  updateEnabled(mode);
  const pageSeconds = {}, pageEnabled = {};
  for (const [k] of PAGES) {
    const { r, en, num } = rows[k];
    pageSeconds[k] = Math.max(3, Math.min(3600, Math.round(+num.value || 9)));
    pageEnabled[k] = en.checked;
    r.classList.toggle('off', !en.checked);
  }
  const pageInterval = mode === 'off' ? 0 : mode === 'all' ? +$('#all-sec').value : null;
  clearTimeout(timer);
  timer = setTimeout(() => {
    window.clock.setPageSettings({ pageSeconds, pageEnabled, pageInterval, pauseOnHover: $('#hover').checked });
    editing = false;
    flash();
  }, 250);
}

function flash() {
  const el = $('#saved');
  el.classList.add('show');
  clearTimeout(flash.t);
  flash.t = setTimeout(() => el.classList.remove('show'), 1200);
}

build();
window.clock.getConfig().then((c) => render(c.state));
window.clock.onState(render);
