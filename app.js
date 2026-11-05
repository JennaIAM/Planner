'use strict';
/* ============ Notebook Planner ============
   All data lives on this device (IndexedDB). Use the menu > Save backup now and then. */

const DAY_ABBR = ['Su', 'M', 'Tu', 'W', 'Th', 'F', 'Sa'];
const DAY_FULL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const COLORS = ['#2f3542','#b0201b','#e84a5f','#f48fb1','#ef8b2c','#f2c418','#3aa76d','#2e86de','#8e5cc9','#8d6e63','#9aa0a6','#ffffff'];
const TYPES = [
  { id: 'check',  label: 'Tick'   },
  { id: 'number', label: 'Number' },
  { id: 'letter', label: 'Letter' },
  { id: 'word',   label: 'Word'   },
  { id: 'doodle', label: 'Doodle' },
];
const ENTRY_MAX = 80;
function growEntry(el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }

/* ---------- tiny DOM helper ---------- */
const $ = (s, r = document) => r.querySelector(s);
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k === 'value') e.value = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(9)) {
    if (k == null || k === false) continue;
    e.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
  return e;
}
const put = (el, ...kids) => el.replaceChildren(...kids.flat(9).filter(k => k != null && k !== false));
const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-5);
const CHECK_SVG = '<svg viewBox="0 0 24 24"><path d="M4.5 13c1.8 1.4 3.2 3 4.4 5.2C11.5 12.6 15.2 8 20 4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICONS = {
  chevL: '<path d="M15 5l-7 7 7 7"/>',
  chevR: '<path d="M9 5l7 7-7 7"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
  up: '<path d="M12 19V5M6.5 10.5L12 5l5.5 5.5"/>',
  down: '<path d="M12 5v14M6.5 13.5L12 19l5.5-5.5"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>',
  star: '<path d="M12 4.5l2.2 4.6 5 .6-3.7 3.4 1 5-4.5-2.5-4.5 2.5 1-5-3.7-3.4 5-.6z"/>',
};
const ic = name => h('span', { class: 'ic', html: `<svg viewBox="0 0 24 24">${ICONS[name]}</svg>` });
const checkIcon = () => h('span', { html: CHECK_SVG, style: 'display:contents' });

function toast(msg) {
  const t = h('div', { class: 'toast' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 1900);
}

/* ---------- native app (Android / iPhone) ---------- */
const NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const plug = name => (NATIVE && window.capacitorExports) ? window.capacitorExports.registerPlugin(name) : null;
const LN = plug('LocalNotifications'), FS = plug('Filesystem'), SH = plug('Share');
if (NATIVE) plug('App'); // enables the Android back button to close open sheets
const DATA_FILE = 'planner-data.json';

/* ---------- storage (IndexedDB, localStorage fallback; plus a file in the native app) ---------- */
const DB_NAME = 'notebook-planner', STORE = 'kv', KEY = 'state';
let dbPromise = null;
function idb() {
  if (!dbPromise) dbPromise = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbPromise;
}
async function loadState() {
  if (NATIVE) {
    try {
      const r = await FS.readFile({ path: DATA_FILE, directory: 'DATA', encoding: 'utf8' });
      const v = JSON.parse(r.data);
      if (v && v.months) return v;
    } catch (e) { /* no file yet */ }
  }
  try {
    const db = await idb();
    const v = await new Promise((res, rej) => {
      const q = db.transaction(STORE).objectStore(STORE).get(KEY);
      q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
    });
    if (v) return v;
  } catch (e) { /* fall through */ }
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
async function writeState() {
  if (NATIVE) {
    try { await FS.writeFile({ path: DATA_FILE, directory: 'DATA', encoding: 'utf8', data: JSON.stringify(state) }); }
    catch (e) { console.warn('file save failed', e); }
  }
  try {
    const db = await idb();
    await new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(state, KEY);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  } catch (e) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e2) { toast('Could not save — storage full?'); }
  }
}
let saveTimer;
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(writeState, NATIVE ? 500 : 250); scheduleSync(); }
document.addEventListener('visibilitychange', () => { if (document.hidden) { clearTimeout(saveTimer); writeState(); } });
window.addEventListener('pagehide', () => { clearTimeout(saveTimer); writeState(); });

/* ---------- state ---------- */
let state = { v: 1, doodles: {}, months: {} };
const now = new Date();
const ui = { y: now.getFullYear(), m: now.getMonth(), tab: 'days', jumpToday: true };

const keyOf = (y, m) => `${y}-${String(m + 1).padStart(2, '0')}`;
const curKey = () => keyOf(ui.y, ui.m);
function prevKey() { const d = new Date(ui.y, ui.m - 1, 1); return keyOf(d.getFullYear(), d.getMonth()); }
function month(key = curKey()) {
  if (!state.months[key]) state.months[key] = { entries: {}, marks: {}, trackers: [], values: {}, goals: [], notes: [], todos: {} };
  state.months[key].todos ||= {};
  return state.months[key];
}
const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();
const doodleImg = id => state.doodles[id] && state.doodles[id].img;

/* ---------- render ---------- */
function render(keepScroll = true) {
  const old = $('main');
  const st = keepScroll && old ? [old.scrollTop, old.scrollLeft] : null;
  const main = h('main', {});
  if (ui.tab === 'days') renderDays(main);
  else if (ui.tab === 'todo') renderTodo(main);
  else if (ui.tab === 'goals') renderGoals(main);
  else renderNotes(main);
  $('#app').replaceChildren(header(), tabs(), main);
  if (st) { main.scrollTop = st[0]; main.scrollLeft = ui.tab === 'days' ? st[1] : 0; }
  if (ui.jumpToday && ui.tab === 'days') {
    ui.jumpToday = false;
    const t = $('tr.today', main);
    if (t) main.scrollTop = Math.max(0, t.offsetTop - main.clientHeight / 3);
  }
}

function header() {
  return h('header', { class: 'top' },
    h('button', { class: 'icon', 'aria-label': 'Previous month', onclick: () => shift(-1) }, ic('chevL')),
    h('div', { class: 'title', onclick: goToday, title: 'Go to today' },
      h('span', { class: 'mname' }, MONTHS[ui.m]), h('span', { class: 'year' }, ui.y)),
    h('button', { class: 'icon', 'aria-label': 'Next month', onclick: () => shift(1) }, ic('chevR')),
    h('button', { class: 'icon menu', 'aria-label': 'Menu', onclick: openMenu }, ic('menu')));
}
function shift(n) {
  const d = new Date(ui.y, ui.m + n, 1);
  ui.y = d.getFullYear(); ui.m = d.getMonth(); ui.jumpToday = true; ui.todoDay = null;
  render(false);
}
function goToday() { const d = new Date(); ui.y = d.getFullYear(); ui.m = d.getMonth(); ui.jumpToday = true; ui.todoDay = null; render(false); }

function tabs() {
  const M = state.months[curKey()];
  const g = M ? M.goals : [];
  const t = (id, label, extra) => h('button', { class: 'tab' + (ui.tab === id ? ' on' : ''), onclick: () => { ui.tab = id; ui.jumpToday = id === 'days'; render(false); } }, label, extra);
  return h('nav', { class: 'tabs' },
    t('days', 'Days'),
    t('todo', 'To-do'),
    t('goals', 'Goals', g.length ? h('small', {}, `${g.filter(x => x.done).length}/${g.length}`) : null),
    t('notes', 'Notes'));
}

/* ---------- copy-from-last-month banner ---------- */
function copyBanner() {
  const M = month(), P = state.months[prevKey()];
  if (M.trackers.length || M.goals.length || M.noCopy || !P || (!P.trackers.length && !P.goals.length)) return null;
  const d = new Date(ui.y, ui.m - 1, 1);
  return h('div', { class: 'banner' },
    h('span', { class: 'grow' }, `Reuse ${MONTHS[d.getMonth()]}'s trackers & goals?`),
    h('button', { class: 'btn small primary', onclick: copyFromPrev }, 'Copy'),
    h('button', { class: 'x', 'aria-label': 'Dismiss', onclick: () => { M.noCopy = true; save(); render(); } }, ic('x')));
}
function copyFromPrev() {
  const M = month(), P = state.months[prevKey()];
  if (!P) return toast('Nothing in last month');
  for (const t of P.trackers) if (!M.trackers.some(x => x.name === t.name)) M.trackers.push({ ...t, id: uid() });
  for (const g of P.goals) if (!M.goals.some(x => x.text === g.text)) M.goals.push({ id: uid(), text: g.text, done: false });
  save(); render(); toast('Copied');
}

/* ---------- DAYS ---------- */
function renderDays(main) {
  const M = month();
  const banner = copyBanner();
  if (banner) main.append(banner);
  const n = daysIn(ui.y, ui.m);
  const today = new Date();
  const isThisMonth = today.getFullYear() === ui.y && today.getMonth() === ui.m;

  const headRow = h('tr', {},
    h('th', { class: 'c-day' }, ''),
    h('th', { class: 'c-mark' }, ic('star')),
    h('th', { class: 'c-entry', style: 'text-align:left;padding-left:8px' }, 'one line a day'),
    M.trackers.map(tr => h('th', { class: 'c-trk' + (tr.type === 'word' ? ' wide' : ''), onclick: () => editTracker(tr) },
      h('span', { class: 'trkname' }, tr.title === 'doodle' && tr.titleImg ? h('img', { src: tr.titleImg, alt: tr.name || 'tracker' }) : (tr.name || '—')))),
    h('th', { class: 'c-add' }, h('button', { class: 'addtrk', 'aria-label': 'Add tracker', onclick: () => editTracker(null) }, ic('plus'))));

  const body = h('tbody', {});
  for (let d = 1; d <= n; d++) {
    const wd = new Date(ui.y, ui.m, d).getDay();
    const cls = [wd === 0 && d > 1 ? 'weekstart' : '', isThisMonth && today.getDate() === d ? 'today' : ''].join(' ');
    const markCell = h('td', { class: 'c-mark' });
    const fillMark = () => {
      const ids = (M.marks[d] || []).filter(doodleImg);
      put(markCell, h('button', { class: 'markbtn', 'aria-label': `Marks for day ${d}`, onclick: () => openMarkSheet(d, fillMark) },
        ids.length ? ids.slice(0, 3).map(id => h('img', { src: doodleImg(id), alt: '' })) : h('span', { class: 'dot' })));
    };
    fillMark();
    const entry = h('textarea', {
      class: 'entry', rows: 1, value: M.entries[d] || '', maxlength: ENTRY_MAX, enterkeyhint: 'next', 'data-day': d, autocomplete: 'off',
      oninput: e => { const v = e.target.value.replace(/\n/g, ' '); if (v !== e.target.value) e.target.value = v; if (v) M.entries[d] = v; else delete M.entries[d]; save(); growEntry(e.target); },
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); const nx = $(`.entry[data-day="${d + 1}"]`); nx ? nx.focus() : e.target.blur(); } },
    });
    body.append(h('tr', { class: cls },
      h('td', { class: 'c-day', onclick: () => { ui.tab = 'todo'; ui.todoDay = d; render(false); } }, h('b', {}, d), h('span', {}, DAY_ABBR[wd]),
        (M.todos[d] || []).length ? h('i', { class: 'pip' + ((M.todos[d] || []).every(x => x.done) ? ' done' : '') }) : null),
      markCell,
      h('td', { class: 'c-entry' }, entry),
      M.trackers.map(tr => trackerCell(M, tr, d)),
      h('td', { class: 'c-add' })));
  }
  const table = h('table', { class: 'days' }, h('thead', {}, headRow), body);
  main.append(table);
  requestAnimationFrame(() => main.querySelectorAll('.entry').forEach(growEntry));
  if (!M.trackers.length) {
    // gentle hint, only once per month view
  }
}

function trackerCell(M, tr, d) {
  const vals = (M.values[tr.id] ||= {});
  const td = h('td', { class: 'c-trk' + (tr.type === 'word' ? ' wide' : '') });
  const set = v => { if (v === '' || v == null || v === false) delete vals[d]; else vals[d] = v; save(); };
  if (tr.type === 'check' || tr.type === 'doodle') {
    const fill = () => {
      const on = vals[d] === true;
      const img = tr.type === 'doodle' && doodleImg(tr.doodle);
      put(td, h('button', { class: 'cellbtn', 'aria-label': `${tr.name} day ${d}`, onclick: () => { set(!on); fill(); } },
        on ? (img ? h('img', { src: img, alt: '✓' }) : checkIcon()) : null));
    };
    fill();
  } else {
    const max = tr.type === 'letter' ? 1 : tr.type === 'word' ? 14 : 8;
    td.append(h('input', {
      class: 'cellin', value: vals[d] ?? '', maxlength: max, autocomplete: 'off',
      inputmode: tr.type === 'number' ? 'decimal' : 'text',
      autocapitalize: tr.type === 'letter' ? 'characters' : 'off',
      oninput: e => { let v = e.target.value; if (tr.type === 'number') { v = v.replace(/[^0-9.,\-]/g, ''); e.target.value = v; } set(v); },
    }));
  }
  return td;
}

/* ---------- marks ---------- */
function openMarkSheet(d, refresh) {
  const M = month();
  const wd = new Date(ui.y, ui.m, d).getDay();
  const grid = h('div', { class: 'stampgrid' });
  const draw = () => {
    const cur = M.marks[d] || [];
    put(grid, 
      Object.entries(state.doodles).map(([id, dd]) => h('button', {
        class: 'stamp' + (cur.includes(id) ? ' on' : ''),
        onclick: () => {
          const list = M.marks[d] || [];
          M.marks[d] = list.includes(id) ? list.filter(x => x !== id) : [...list, id];
          if (!M.marks[d].length) delete M.marks[d];
          save(); draw(); refresh();
        },
      }, h('img', { src: dd.img, alt: '' }), h('span', {}, dd.name || ' '))),
      h('button', { class: 'stamp new', onclick: () => openDoodleEditor({
        title: 'Draw a new mark', withName: true, namePh: 'e.g. period, gym, trip',
        onSave: (img, name) => { const id = uid(); state.doodles[id] = { img, name }; M.marks[d] = [...(M.marks[d] || []), id]; save(); draw(); refresh(); },
      }) }, h('span', { class: 'plus' }, ic('plus')), h('span', {}, 'Draw new')));
  };
  draw();
  sheet(`${d} ${DAY_ABBR[wd]} · marks`, [
    h('div', { class: 'hint' }, 'Tap a doodle to stamp it on this day. Tap again to remove.'),
    grid,
  ]);
}

/* ---------- tracker editor ---------- */
function editTracker(tr) {
  const M = month();
  const isNew = !tr;
  const t = tr ? { ...tr } : { id: uid(), name: '', type: 'check', doodle: null, title: 'text', titleImg: null };
  if (!t.title) t.title = 'text';
  const name = h('input', { class: 'field', placeholder: 'e.g. Creatine, Water, Mood', maxlength: 24, value: t.name });
  const typeRow = h('div', { class: 'seg' });
  const dRow = h('div', {});
  const drawTypes = () => put(typeRow, TYPES.map(T =>
    h('button', { class: 'segb' + (t.type === T.id ? ' on' : ''), onclick: () => { t.type = T.id; drawTypes(); drawDoodle(); } }, T.label)));
  const drawDoodle = () => {
    if (t.type !== 'doodle') { put(dRow, h('div', { class: 'hint' }, ({
      check: 'Tap a day to tick it.', number: 'Type a number for each day (e.g. glasses of water).',
      letter: 'One letter per day (e.g. G / B for good or bad).', word: 'A short word per day (e.g. mood).' })[t.type])); return; }
    put(dRow, 
      h('div', { class: 'hint' }, 'Pick the doodle that shows on days you tap:'),
      h('div', { class: 'stampgrid' },
        Object.entries(state.doodles).map(([id, dd]) => h('button', { class: 'stamp' + (t.doodle === id ? ' on' : ''), onclick: () => { t.doodle = id; drawDoodle(); } },
          h('img', { src: dd.img, alt: '' }), h('span', {}, dd.name || ' '))),
        h('button', { class: 'stamp new', onclick: () => openDoodleEditor({
          title: 'Draw tracker doodle', withName: true, name: name.value, namePh: 'name it',
          onSave: (img, nm) => { const id = uid(); state.doodles[id] = { img, name: nm }; t.doodle = id; save(); drawDoodle(); },
        }) }, h('span', { class: 'plus' }, ic('plus')), h('span', {}, 'Draw new'))));
  };
  drawTypes(); drawDoodle();

  // column title: words or a doodle that replaces the name
  const nameLbl = h('label', { class: 'lbl' });
  const titleSeg = h('div', { class: 'seg' });
  const titleRow = h('div', {});
  const drawTitle = () => {
    put(titleSeg, [['text', 'Words'], ['doodle', 'Draw it']].map(([id, l]) =>
      h('button', { class: 'segb' + (t.title === id ? ' on' : ''), onclick: () => { t.title = id; drawTitle(); if (id === 'doodle' && !t.titleImg) drawTitleImg(); } }, l)));
    nameLbl.textContent = t.title === 'doodle' ? 'Name (only for you, not shown)' : 'Name';
    if (t.title !== 'doodle') return put(titleRow);
    put(titleRow, h('div', { class: 'stampgrid', style: 'margin-top:8px' },
      h('button', { class: 'stamp' + (t.titleImg ? ' on' : ' new'), onclick: drawTitleImg },
        t.titleImg ? h('img', { src: t.titleImg, alt: '' }) : h('span', { class: 'plus' }, ic('plus')),
        h('span', {}, t.titleImg ? 'redraw' : 'Draw title'))));
  };
  const drawTitleImg = () => openDoodleEditor({
    title: 'Draw the column title', img: t.titleImg,
    onSave: img => { t.titleImg = img; drawTitle(); },
  });
  drawTitle();

  const idx = M.trackers.findIndex(x => x.id === t.id);
  const move = dir => {
    const j = idx + dir; if (j < 0 || j >= M.trackers.length) return;
    [M.trackers[idx], M.trackers[j]] = [M.trackers[j], M.trackers[idx]];
    save(); close(); render();
  };
  const close = sheet(isNew ? 'New tracker' : 'Edit tracker', [
    h('label', { class: 'lbl' }, 'Column title'), titleSeg, titleRow,
    nameLbl, name,
    h('label', { class: 'lbl' }, 'What do you write each day?'), typeRow, dRow,
    h('div', { class: 'sheetfoot' },
      !isNew && h('button', { class: 'btn danger', onclick: () => {
        if (!confirm(`Delete "${t.name}" and its ticks for this month?`)) return;
        M.trackers = M.trackers.filter(x => x.id !== t.id); delete M.values[t.id]; save(); close(); render();
      } }, 'Delete'),
      !isNew && idx > 0 && h('button', { class: 'btn small', onclick: () => move(-1) }, 'Move left'),
      !isNew && idx < M.trackers.length - 1 && h('button', { class: 'btn small', onclick: () => move(1) }, 'Move right'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn primary', onclick: () => {
        t.name = name.value.trim();
        if (t.title === 'doodle' && !t.titleImg) return toast('Draw the title first');
        if (!t.name && t.title !== 'doodle') { name.focus(); return toast('Give it a name'); }
        if (t.type === 'doodle' && !t.doodle) return toast('Pick or draw a doodle');
        if (!isNew && tr.type !== t.type) {
          const had = Object.keys(M.values[t.id] || {}).length;
          const boolish = x => x === 'check' || x === 'doodle';
          if (!(boolish(tr.type) && boolish(t.type))) {
            if (had && !confirm('Changing the type clears this month\'s entries for it. OK?')) return;
            M.values[t.id] = {};
          }
        }
        if (isNew) M.trackers.push(t); else Object.assign(M.trackers[idx], t);
        save(); close(); render();
      } }, 'Save')),
  ]);
  if (isNew) setTimeout(() => name.focus(), 250);
}

/* ---------- TO-DO ---------- */
function curTodoDay() {
  const n = daysIn(ui.y, ui.m);
  if (!ui.todoDay || ui.todoDay > n) {
    const t = new Date();
    ui.todoDay = (t.getFullYear() === ui.y && t.getMonth() === ui.m) ? t.getDate() : 1;
  }
  return ui.todoDay;
}
const fmtTime = t => { const [hh, mm] = t.split(':').map(Number); return new Date(2000, 0, 1, hh, mm).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };

function renderTodo(main) {
  const M = month();
  const n = daysIn(ui.y, ui.m), d = curTodoDay();
  const today = new Date();
  const isThisMonth = today.getFullYear() === ui.y && today.getMonth() === ui.m;

  const strip = h('div', { class: 'daystrip' });
  for (let dd = 1; dd <= n; dd++) {
    const wd = new Date(ui.y, ui.m, dd).getDay();
    const L = M.todos[dd] || [];
    strip.append(h('button', {
      class: 'dchip' + (dd === d ? ' on' : '') + (isThisMonth && today.getDate() === dd ? ' today' : ''),
      onclick: () => { ui.todoDay = dd; render(); },
    }, h('b', {}, dd), h('span', {}, DAY_ABBR[wd]), L.length ? h('i', { class: 'pip' + (L.every(x => x.done) ? ' done' : '') }) : null));
  }

  const wd = new Date(ui.y, ui.m, d).getDay();
  const list = M.todos[d] || [];
  const doneN = list.filter(x => x.done).length;
  const page = h('div', { class: 'page' },
    h('h2', {}, `${DAY_FULL[wd]} ${d}`, list.length ? h('span', { class: 'progress' }, `${doneN}/${list.length}`) : null),
    h('p', { class: 'sub' }, 'Your to-do list for the day. Tap the clock to add a reminder time.'));
  for (const item of list) page.append(todoRow(M, d, item));

  const add = h('input', { class: 'gtext', placeholder: '+ add a to-do…', maxlength: 80, enterkeyhint: 'done' });
  const commit = refocus => {
    const v = add.value.trim(); if (!v) return;
    add.value = '';
    (M.todos[d] ||= []).push({ id: uid(), text: v, done: false, time: null }); save(); render();
    if (refocus) { const a = $('.goal.adder .gtext'); a && a.focus(); }
  };
  add.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(true); } });
  add.addEventListener('blur', () => commit(false));
  page.append(h('div', { class: 'goal adder' }, h('span', { class: 'box', style: 'border-style:dashed;opacity:.5' }), add));

  const open = list.filter(x => !x.done);
  page.append(h('div', { class: 'tctrl', style: 'margin:1.1rem 0 0 2.5rem' },
    open.length && d < n ? h('button', { class: 'btn small', onclick: () => {
      M.todos[d + 1] = [...(M.todos[d + 1] || []), ...open];
      M.todos[d] = list.filter(x => x.done); if (!M.todos[d].length) delete M.todos[d];
      save(); render(); toast(`Moved ${open.length} to tomorrow`);
    } }, 'Move unfinished to tomorrow') : null,
    !NATIVE && open.some(x => x.time) ? h('button', { class: 'btn small', onclick: () => exportDayTodos(d) }, 'Add timed ones to Calendar') : null,
    h('button', { class: 'btn small', onclick: openReminders }, 'Reminders')));

  main.append(strip);
  if (NATIVE && !settings().asked) main.append(h('div', { class: 'banner' },
    h('span', { class: 'grow' }, 'Get reminders for your to-dos and daily check-ins?'),
    h('button', { class: 'btn small primary', onclick: async () => { settings().asked = true; await enableNativeReminders(); save(); render(); } }, 'Turn on'),
    h('button', { class: 'x', 'aria-label': 'Dismiss', onclick: () => { settings().asked = true; save(); render(); } }, ic('x'))));
  main.append(page);
  requestAnimationFrame(() => {
    const on = $('.dchip.on', strip);
    if (on) strip.scrollLeft = on.offsetLeft - strip.clientWidth / 2 + on.offsetWidth / 2;
  });
}

function todoRow(M, d, item) {
  const timeIn = h('input', { type: 'time', value: item.time || '', 'aria-label': 'Reminder time',
    onchange: e => { item.time = e.target.value || null; save(); render(); } });
  return h('div', { class: 'goal todo' + (item.done ? ' done' : '') },
    h('button', { class: 'box', 'aria-label': 'Done', onclick: () => { item.done = !item.done; save(); render(); } }, item.done ? checkIcon() : null),
    h('input', { class: 'gtext', value: item.text, maxlength: 80, oninput: e => { item.text = e.target.value; save(); } }),
    h('label', { class: 'timechip' + (item.time ? ' set' : '') }, h('span', {}, item.time ? fmtTime(item.time) : ic('clock')), timeIn),
    h('button', { class: 'x', 'aria-label': 'Delete', onclick: () => {
      M.todos[d] = (M.todos[d] || []).filter(x => x !== item); if (!M.todos[d].length) delete M.todos[d]; save(); render();
    } }, ic('x')));
}

/* ---------- REMINDERS ---------- */
function settings() {
  return (state.settings ||= { nudges: ['09:00', '14:00', '20:00'], notify: true });
}
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

async function nativePerm() {
  try { return (await LN.checkPermissions()).display; } catch { return 'denied'; }
}
async function enableNativeReminders() {
  const S = settings();
  let p = await nativePerm();
  if (p !== 'granted') { try { p = (await LN.requestPermissions()).display; } catch { p = 'denied'; } }
  if (p === 'granted') { S.notify = true; save(); syncNative(); toast('Reminders on'); }
  else toast('Reminders are blocked in your phone settings');
  return p;
}
function openReminders() {
  const S = settings();
  const wrap = h('div', {});
  let nperm = 'prompt';
  const draw = () => {
    if (NATIVE) {
      let part;
      if (nperm === 'granted') part = h('div', { class: 'tctrl' },
        h('button', { class: 'segb' + (S.notify ? ' on' : ''), onclick: () => { S.notify = !S.notify; save(); syncNative(); draw(); } }, S.notify ? 'On' : 'Off'),
        h('button', { class: 'btn small', onclick: async () => {
          await LN.schedule({ notifications: [{ id: 99999, title: 'Planner test', body: 'Reminders are working', schedule: { at: new Date(Date.now() + 4000), allowWhileIdle: true } }] });
          toast('Test coming in a few seconds');
        } }, 'Send a test'));
      else if (nperm === 'denied') part = h('div', { class: 'hint' }, 'Notifications are blocked. Turn them on in your phone Settings → Apps → Planner → Notifications.');
      else part = h('button', { class: 'btn small primary', onclick: async () => { nperm = await enableNativeReminders(); draw(); } }, 'Turn on reminders');
      put(wrap,
        nudgeEditor(S, draw),
        h('label', { class: 'lbl' }, 'Notifications'),
        h('div', { class: 'hint' }, 'You’ll get a reminder at each to-do’s time and at your check-in times, even when the app is closed. They’re set a week ahead and refresh whenever you open the app.'),
        part);
      return;
    }

    const hasN = 'Notification' in window;
    const perm = hasN ? Notification.permission : 'none';
    let notifPart;
    if (!hasN) notifPart = h('div', { class: 'hint' }, isIOS
      ? 'On iPhone this only works when the planner is opened from its Home Screen icon (not inside Safari).'
      : 'This browser can’t show notifications — use the Calendar option below.');
    else if (perm === 'granted') notifPart = h('div', { class: 'tctrl' },
      h('button', { class: 'segb' + (S.notify ? ' on' : ''), onclick: () => { S.notify = !S.notify; save(); draw(); } }, S.notify ? 'On' : 'Off'),
      h('button', { class: 'btn small', onclick: () => notify('Planner test', 'Notifications are working') }, 'Send a test'));
    else if (perm === 'denied') notifPart = h('div', { class: 'hint' }, 'Blocked. Allow them in your phone Settings → Notifications → Planner.');
    else notifPart = h('button', { class: 'btn small primary', onclick: async () => {
      const r = await Notification.requestPermission();
      if (r === 'granted') { S.notify = true; save(); notify('Planner', 'Reminders are on'); }
      draw();
    } }, 'Turn on notifications');

    put(wrap,
      nudgeEditor(S, draw),
      h('label', { class: 'lbl' }, 'Option 1 · Pop-up notifications'),
      h('div', { class: 'hint' }, 'For check-ins and to-dos with a time. They show while the planner is open or was used recently. Your phone pauses it once it’s fully closed.'),
      notifPart,
      h('label', { class: 'lbl' }, 'Option 2 · Add to your phone’s Calendar (works even when closed)'),
      h('div', { class: 'hint' }, 'Adds the check-ins as repeating daily events with an alert. Do it again if you change the times.'),
      h('div', { class: 'tctrl' },
        h('button', { class: 'btn small primary', onclick: exportCheckins }, 'Add check-ins to Calendar'),
        h('button', { class: 'btn small', onclick: () => exportCheckins(true) }, 'share file instead')));
  };
  draw();
  sheet('Reminders', wrap);
  if (NATIVE) nativePerm().then(p => { nperm = p; draw(); });
}
function nudgeEditor(S, draw) {
  return [
    h('label', { class: 'lbl' }, 'Daily check-ins'),
    h('div', { class: 'hint' }, 'A nudge at these times to look at what’s left on your to-do list.'),
    h('div', { class: 'tctrl' },
      S.nudges.map((t, i) => h('span', { class: 'nudge' },
        h('label', { class: 'timechip set' }, h('span', {}, fmtTime(t)),
          h('input', { type: 'time', value: t, onchange: e => { if (e.target.value) { S.nudges[i] = e.target.value; S.nudges.sort(); save(); } draw(); } })),
        h('button', { class: 'x', 'aria-label': 'Remove', onclick: () => { S.nudges.splice(i, 1); save(); draw(); } }, ic('x')))),
      h('button', { class: 'btn small', onclick: () => { S.nudges.push('12:00'); S.nudges.sort(); save(); draw(); } }, '+ time'))];
}

/* real scheduled reminders in the native app */
let syncTimer;
function scheduleSync() { if (!NATIVE) return; clearTimeout(syncTimer); syncTimer = setTimeout(syncNative, 1500); }
const atTime = (day, t) => { const [hh, mm] = t.split(':').map(Number); return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hh, mm); };
async function syncNative() {
  if (!NATIVE) return;
  const S = settings();
  try {
    if ((await nativePerm()) !== 'granted') return;
    const pend = await LN.getPending();
    const old = (pend.notifications || []).filter(n => n.id !== 99999);
    if (old.length) await LN.cancel({ notifications: old.map(n => ({ id: n.id })) });
    if (!S.notify) return;
    const now = new Date(), list = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      const M = state.months[keyOf(day.getFullYear(), day.getMonth())];
      const todos = (M && M.todos && M.todos[day.getDate()]) || [];
      const left = todos.filter(x => !x.done);
      for (const it of left) if (it.time) {
        const at = atTime(day, it.time);
        if (at > now) list.push({ prio: 0, at, title: it.text || 'To-do', body: 'Reminder from your planner' });
      }
      if (todos.length && !left.length) continue; // everything done that day, no nudges
      for (const t of S.nudges) {
        const at = atTime(day, t);
        if (at <= now) continue;
        list.push({ prio: 1, at,
          title: left.length ? `${left.length} thing${left.length > 1 ? 's' : ''} left today` : 'Planner check-in',
          body: left.length ? left.slice(0, 4).map(x => '• ' + x.text).join('\n') : 'Take a minute to plan your day.' });
      }
    }
    // iPhone allows 64 pending reminders: keep timed to-dos first, then the nearest check-ins
    const chosen = list.sort((a, b) => a.prio - b.prio || a.at - b.at).slice(0, 60).sort((a, b) => a.at - b.at);
    if (chosen.length) await LN.schedule({ notifications: chosen.map((x, i) => ({
      id: i + 1, title: x.title, body: x.body, schedule: { at: x.at, allowWhileIdle: true } })) });
  } catch (e) { console.warn('reminder sync failed', e); }
}

/* notifications while the app is alive */
let fired = new Set();
try { fired = new Set(JSON.parse(localStorage.getItem('planner-fired') || '[]')); } catch {}
function markFired(k) {
  fired.add(k);
  try { localStorage.setItem('planner-fired', JSON.stringify([...fired].slice(-300))); } catch {}
}
async function notify(title, body) {
  try {
    const reg = 'serviceWorker' in navigator && await navigator.serviceWorker.getRegistration();
    if (reg) { await reg.showNotification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: title }); return; }
  } catch {}
  try { new Notification(title, { body, icon: 'icons/icon-192.png' }); } catch {}
  if (!document.hidden) toast(title);
}
function tick() {
  if (NATIVE) return;
  const S = settings();
  if (!S.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  const n = new Date(), k = keyOf(n.getFullYear(), n.getMonth()), d = n.getDate();
  const mins = n.getHours() * 60 + n.getMinutes();
  const toMin = t => { const [a, b] = t.split(':').map(Number); return a * 60 + b; };
  const due = t => mins >= toMin(t) && mins - toMin(t) <= 10;
  const M = state.months[k];
  const list = (M && M.todos && M.todos[d]) || [];
  const tag = `${k}-${d}`;
  for (const it of list) {
    const key = `${tag}|${it.id}|${it.time}`;
    if (it.time && !it.done && due(it.time) && !fired.has(key)) { markFired(key); notify(it.text || 'To-do', 'Reminder from your planner'); }
  }
  for (const t of S.nudges) {
    const key = `${tag}|nudge|${t}`;
    if (!due(t) || fired.has(key)) continue;
    markFired(key);
    const left = list.filter(x => !x.done);
    if (left.length) notify(`${left.length} thing${left.length > 1 ? 's' : ''} left today`, left.slice(0, 4).map(x => '• ' + x.text).join('\n'));
  }
}
setInterval(tick, 20000);
document.addEventListener('visibilitychange', tick);

/* calendar (.ics) export */
const pad2 = x => String(x).padStart(2, '0');
const icsEsc = s => String(s).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/[,;]/g, m => '\\' + m);
const icsLocal = t => `${t.getFullYear()}${pad2(t.getMonth() + 1)}${pad2(t.getDate())}T${pad2(t.getHours())}${pad2(t.getMinutes())}00`;
function icsEvent({ id, start, title, desc, rrule }) {
  const end = new Date(start.getTime() + 10 * 60000);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  return ['BEGIN:VEVENT', `UID:${id}@notebook-planner`, `DTSTAMP:${stamp}`, `DTSTART:${icsLocal(start)}`, `DTEND:${icsLocal(end)}`,
    rrule && `RRULE:${rrule}`, `SUMMARY:${icsEsc(title)}`, desc && `DESCRIPTION:${icsEsc(desc)}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(title)}`, 'TRIGGER:PT0S', 'END:VALARM', 'END:VEVENT'].filter(Boolean);
}
function icsFile(events) {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Notebook Planner//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', ...events.flat(), 'END:VCALENDAR'].join('\r\n') + '\r\n';
}
async function deliverIcs(text, fname, share) {
  const file = new File([text], fname, { type: 'text/calendar' });
  if (share) {
    try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; } } catch (e) { if (e.name === 'AbortError') return; }
  }
  if (isIOS && !share) {
    const url = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(text);
    const w = window.open(url, '_blank');
    if (!w) location.href = url;
    return;
  }
  const a = h('a', { href: URL.createObjectURL(file), download: fname });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  toast('Open the downloaded file to add it to your calendar');
}
function exportCheckins(share) {
  const S = settings();
  if (!S.nudges.length) return toast('Add a check-in time first');
  const base = new Date();
  const evs = S.nudges.map(t => {
    const [hh, mm] = t.split(':').map(Number);
    return icsEvent({ id: 'checkin-' + t.replace(':', ''), start: new Date(base.getFullYear(), base.getMonth(), base.getDate(), hh, mm),
      title: 'Check your planner', desc: 'Open your planner and look at today’s to-do list.', rrule: 'FREQ=DAILY' });
  });
  deliverIcs(icsFile(evs), 'planner-check-ins.ics', share === true);
}
function exportDayTodos(d) {
  const M = month();
  const items = (M.todos[d] || []).filter(x => x.time && !x.done);
  if (!items.length) return toast('No to-dos with a time');
  const evs = items.map(it => {
    const [hh, mm] = it.time.split(':').map(Number);
    return icsEvent({ id: it.id, start: new Date(ui.y, ui.m, d, hh, mm), title: it.text, desc: 'From your planner' });
  });
  deliverIcs(icsFile(evs), `planner-todo-${ui.y}-${pad2(ui.m + 1)}-${pad2(d)}.ics`, false);
}

/* ---------- GOALS ---------- */
function renderGoals(main) {
  const M = month();
  const banner = copyBanner();
  if (banner) main.append(banner);
  const done = M.goals.filter(g => g.done).length;
  const page = h('div', { class: 'page' },
    h('h2', {}, `${MONTHS[ui.m]} goals`, M.goals.length ? h('span', { class: 'progress' }, `${done}/${M.goals.length}`) : null),
    h('p', { class: 'sub' }, 'What I want to do this month — tick them off when done.'));
  for (const g of M.goals) {
    page.append(h('div', { class: 'goal' + (g.done ? ' done' : '') },
      h('button', { class: 'box', 'aria-label': 'Done', onclick: () => { g.done = !g.done; save(); render(); } }, g.done ? checkIcon() : null),
      h('input', { class: 'gtext', value: g.text, maxlength: 80, oninput: e => { g.text = e.target.value; save(); } }),
      h('button', { class: 'x', 'aria-label': 'Delete goal', onclick: () => { M.goals = M.goals.filter(x => x !== g); save(); render(); } }, ic('x'))));
  }
  const add = h('input', { class: 'gtext', placeholder: '+ add a goal…', maxlength: 80, enterkeyhint: 'done' });
  const commit = (refocus) => {
    const v = add.value.trim(); if (!v) return;
    add.value = '';
    M.goals.push({ id: uid(), text: v, done: false }); save(); render();
    if (refocus) { const a = $('.goal.adder .gtext'); a && a.focus(); }
  };
  add.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(true); } });
  add.addEventListener('blur', () => commit(false));
  page.append(h('div', { class: 'goal adder' }, h('span', { class: 'box', style: 'border-style:dashed;opacity:.5' }), add));
  main.append(page);
}

/* ---------- NOTES ---------- */
function renderNotes(main) {
  const M = month();
  const page = h('div', { class: 'notes' }, h('h2', {}, `${MONTHS[ui.m]} notes`));
  if (!M.notes.length) page.append(h('div', { class: 'emptynote' }, 'Blank page. Add some text, a table or a little doodle below.'));
  M.notes.forEach((b, i) => page.append(noteBlock(M, b, i)));
  page.append(h('div', { class: 'addbar' },
    h('button', { class: 'btn', onclick: () => addBlock({ type: 'text', text: '' }) }, '+ Text'),
    h('button', { class: 'btn', onclick: () => addBlock({ type: 'table', rows: [['', '', ''], ['', '', ''], ['', '', '']] }) }, '+ Table'),
    h('button', { class: 'btn', onclick: () => openDoodleEditor({ title: 'Mini doodle', size: 400, onSave: img => addBlock({ type: 'doodle', img, size: 'm' }) }) }, '+ Doodle')));
  main.append(page);
}
function addBlock(b) {
  const M = month(); b.id = uid(); M.notes.push(b); save(); render();
  const m = $('main'); m.scrollTop = m.scrollHeight;
  if (b.type === 'text') { const all = document.querySelectorAll('.ntext'); all[all.length - 1]?.focus(); }
}
function noteBlock(M, b, i) {
  const tools = h('div', { class: 'blocktools' },
    i > 0 && h('button', { 'aria-label': 'Move up', onclick: () => { [M.notes[i - 1], M.notes[i]] = [M.notes[i], M.notes[i - 1]]; save(); render(); } }, ic('up')),
    i < M.notes.length - 1 && h('button', { 'aria-label': 'Move down', onclick: () => { [M.notes[i + 1], M.notes[i]] = [M.notes[i], M.notes[i + 1]]; save(); render(); } }, ic('down')),
    h('button', { 'aria-label': 'Delete', onclick: () => {
      const empty = (b.type === 'text' && !b.text.trim());
      if (!empty && !confirm('Delete this from your notes?')) return;
      M.notes.splice(i, 1); save(); render();
    } }, ic('trash')));
  const wrap = h('div', { class: 'block' }, tools);

  if (b.type === 'text') {
    const ta = h('textarea', { class: 'ntext', rows: 2, placeholder: 'write here…', value: b.text });
    const grow = () => { ta.style.height = 'auto'; const lh = parseFloat(getComputedStyle(ta).lineHeight) || 34; ta.style.height = Math.max(lh * 2, Math.ceil(ta.scrollHeight / lh - 0.01) * lh) + 'px'; };
    ta.addEventListener('input', () => { b.text = ta.value; save(); grow(); });
    requestAnimationFrame(grow);
    wrap.append(ta);
  } else if (b.type === 'table') {
    const tbl = h('table', { class: 'ntable' },
      b.rows.map((row, ri) => h('tr', {}, row.map((v, ci) => h('td', {},
        h('input', { value: v, autocomplete: 'off', oninput: e => { b.rows[ri][ci] = e.target.value; save(); } }))))));
    const cols = b.rows[0]?.length || 0;
    wrap.append(h('div', { class: 'tscroll' }, tbl), h('div', { class: 'tctrl' },
      h('button', { class: 'btn small', onclick: () => { b.rows.push(Array(cols).fill('')); save(); render(); } }, '+ row'),
      h('button', { class: 'btn small', onclick: () => { b.rows.forEach(r => r.push('')); save(); render(); } }, '+ column'),
      b.rows.length > 1 && h('button', { class: 'btn small', onclick: () => { b.rows.pop(); save(); render(); } }, '− row'),
      cols > 1 && h('button', { class: 'btn small', onclick: () => { b.rows.forEach(r => r.pop()); save(); render(); } }, '− column')));
  } else if (b.type === 'doodle') {
    const sizes = { s: 'S', m: 'M', l: 'L' };
    wrap.append(
      h('img', { class: `ndoodle ${b.size || 'm'} ${b.align || 'left'}`, src: b.img, alt: 'doodle',
        onclick: () => openDoodleEditor({ title: 'Edit doodle', img: b.img, size: 400, onSave: img => { b.img = img; save(); render(); } }) }),
      h('div', { class: 'tctrl' },
        Object.entries(sizes).map(([k, l]) => h('button', { class: 'tool' + ((b.size || 'm') === k ? ' on' : ''), onclick: () => { b.size = k; save(); render(); } }, l)),
        h('button', { class: 'tool', onclick: () => { b.align = (b.align || 'left') === 'left' ? 'center' : 'left'; save(); render(); } }, (b.align || 'left') === 'left' ? 'Left' : 'Centre'),
        h('button', { class: 'tool', onclick: () => {
          const name = prompt('Save to your doodle stamps as:', '');
          if (name == null) return;
          state.doodles[uid()] = { img: b.img, name: name.trim() }; save(); toast('Saved to your stamps');
        } }, 'Save as stamp')));
  }
  return wrap;
}

/* ---------- sheet (bottom modal) ---------- */
// One history entry stands for "a sheet is open", so the phone's back button closes sheets
const openSheets = [];
let ignorePop = 0, sheetEntry = false;
window.addEventListener('popstate', () => {
  if (ignorePop) { ignorePop--; return; }
  sheetEntry = false;
  const top = openSheets[openSheets.length - 1];
  if (top) top(true);
  if (openSheets.length) { try { history.pushState({ sheet: 1 }, ''); sheetEntry = true; } catch {} }
});
function releaseSheetEntry() {
  setTimeout(() => {
    if (!openSheets.length && sheetEntry) { sheetEntry = false; ignorePop++; history.back(); }
  }, 0);
}
function sheet(title, content) {
  const ov = h('div', { class: 'overlay' });
  const close = fromPop => {
    if (!ov.isConnected) return;
    ov.remove();
    const i = openSheets.indexOf(close);
    if (i >= 0) openSheets.splice(i, 1);
    if (fromPop !== true) releaseSheetEntry();
  };
  openSheets.push(close);
  if (!sheetEntry) { try { history.pushState({ sheet: 1 }, ''); sheetEntry = true; } catch {} }
  const panel = h('div', { class: 'sheet', role: 'dialog' },
    h('div', { class: 'sheethead' }, h('h3', {}, title), h('button', { class: 'x', 'aria-label': 'Close', onclick: close }, ic('x'))),
    content);
  ov.append(panel);
  ov.addEventListener('pointerdown', e => { if (e.target === ov) ov.dataset.down = '1'; });
  ov.addEventListener('click', e => { if (e.target === ov && ov.dataset.down) close(); ov.dataset.down = ''; });
  document.body.append(ov);
  return close;
}

/* ---------- doodle editor ---------- */
function openDoodleEditor({ title = 'Doodle', img = null, name = '', withName = false, namePh = 'name', size = 256, onSave, onDelete }) {
  const S = 640;
  const c = h('canvas', { class: 'pad', width: S, height: S });
  const ctx = c.getContext('2d');
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  let color = COLORS[0], width = 14, erase = false, drawing = false, pts = [];
  const hist = [];
  if (img) { const im = new Image(); im.onload = () => ctx.drawImage(im, 0, 0, S, S); im.src = img; }
  const snap = () => { hist.push(ctx.getImageData(0, 0, S, S)); if (hist.length > 30) hist.shift(); };
  const pos = e => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * S / r.width, (e.clientY - r.top) * S / r.height]; };
  const setup = () => {
    ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
    ctx.strokeStyle = ctx.fillStyle = color;
    ctx.lineWidth = erase ? width * 2.4 : width;
  };
  c.addEventListener('pointerdown', e => {
    e.preventDefault(); c.setPointerCapture(e.pointerId); snap(); setup(); drawing = true;
    pts = [pos(e)];
    ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill();
  });
  c.addEventListener('pointermove', e => {
    if (!drawing) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (evs.length ? evs : [e])) {
      pts.push(pos(ev));
      const n = pts.length;
      ctx.beginPath();
      if (n < 3) { ctx.moveTo(...pts[0]); ctx.lineTo(...pts[n - 1]); }
      else {
        const [a, b, cc] = [pts[n - 3], pts[n - 2], pts[n - 1]];
        ctx.moveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        ctx.quadraticCurveTo(b[0], b[1], (b[0] + cc[0]) / 2, (b[1] + cc[1]) / 2);
      }
      ctx.stroke();
    }
  });
  const end = () => {
    if (!drawing) return; drawing = false;
    const n = pts.length;
    if (n > 1) { ctx.beginPath(); const a = pts[n - 2], b = pts[n - 1]; ctx.moveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); ctx.lineTo(...b); ctx.stroke(); }
  };
  c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);

  const colorRow = h('div', { class: 'tools' });
  const toolRow = h('div', { class: 'tools' });
  const drawTools = () => {
    put(colorRow, COLORS.map(col => h('button', {
      class: 'sw' + (!erase && col === color ? ' on' : ''), style: `background:${col}`, 'aria-label': col,
      onclick: () => { color = col; erase = false; drawTools(); } })));
    put(toolRow, 
      [[7, 6], [14, 11], [26, 17]].map(([w, dot]) => h('button', { class: 'tool' + (width === w ? ' on' : ''), 'aria-label': 'Brush size', onclick: () => { width = w; drawTools(); } },
        h('span', { class: 'sizedot', style: `width:${dot}px;height:${dot}px` }))),
      h('button', { class: 'tool' + (erase ? ' on' : ''), onclick: () => { erase = !erase; drawTools(); } }, 'eraser'),
      h('button', { class: 'tool', onclick: () => { const s = hist.pop(); if (s) ctx.putImageData(s, 0, 0); } }, 'Undo'),
      h('button', { class: 'tool', onclick: () => { snap(); ctx.clearRect(0, 0, S, S); } }, 'clear'));
  };
  drawTools();

  const nameIn = withName ? h('input', { class: 'field', placeholder: namePh, maxlength: 20, value: name, style: 'margin-top:10px' }) : null;
  const close = sheet(title, [
    h('div', { class: 'padwrap' }, c), colorRow, toolRow, nameIn,
    h('div', { class: 'sheetfoot' },
      onDelete && h('button', { class: 'btn danger', onclick: () => { if (confirm('Delete this doodle?')) { onDelete(); close(); } } }, 'Delete'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: () => close() }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: () => {
        const out = document.createElement('canvas'); out.width = out.height = size;
        const o = out.getContext('2d'); o.imageSmoothingQuality = 'high'; o.drawImage(c, 0, 0, size, size);
        const px = o.getImageData(0, 0, size, size).data;
        let any = false; for (let i = 3; i < px.length; i += 4) if (px[i] > 8) { any = true; break; }
        if (!any) return toast('Draw something first');
        onSave(out.toDataURL('image/png'), nameIn ? nameIn.value.trim() : '');
        close();
      } }, 'Save')),
  ]);
}

/* ---------- look: paper, pen, size ---------- */
const PENS = [
  { id: 'fine',  name: 'Fine',  family: "'Pen Fine'",  k: 1.12, tr: '-0.025em' },
  { id: 'light', name: 'Light', family: "'Pen Light'", k: 1.0 },
  { id: 'quick', name: 'Quick', family: "'Pen Quick'", k: 0.97 },
  { id: 'neat',  name: 'Neat',  family: "'Pen Neat'",  k: 0.86 },
];
const PAPERS = [['Cream', '#fbf7ee'], ['White', '#ffffff'], ['Grey', '#f0f0ee'], ['Sky', '#edf2f7'], ['Blush', '#f8ecea'],
  ['Sage', '#ecf1e7'], ['Sand', '#eee3cf'], ['Lilac', '#efecf6'], ['Night', '#25272b']];
function look() {
  const S = settings();
  return (S.look ||= { paper: '#fbf7ee', pen: 'fine', size: 0.9 });
}
const hexRgb = hx => { const n = parseInt(hx.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const mixRgb = (a, b, t) => '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('');
let SB = null;
function applyLook() {
  const L = look();
  const pen = PENS.find(p => p.id === L.pen) || PENS[0];
  const r = document.documentElement.style;
  r.fontSize = (16 * L.size * pen.k).toFixed(2) + 'px';
  r.setProperty('--hand', `${pen.family},system-ui,sans-serif`);
  r.setProperty('--track', pen.tr || '0');
  const paper = /^#[0-9a-f]{6}$/i.test(L.paper) ? L.paper.toLowerCase() : '#fbf7ee';
  const rgb = hexRgb(paper), W = [255, 255, 255], K = [0, 0, 0];
  const dark = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255 < 0.45;
  const vars = dark
    ? { '--paper-2': mixRgb(rgb, W, .07), '--card': mixRgb(rgb, W, .05), '--ink': '#ece9e3', '--ink-inv': paper, '--muted': '#9c9ea4', '--faint': '#6f7177',
        '--line': 'rgba(190,205,230,.14)', '--line-strong': 'rgba(190,205,230,.28)', '--margin': 'rgba(230,120,110,.45)',
        '--today': 'rgba(255,210,90,.10)', '--focus': 'rgba(190,205,230,.08)', '--accent': '#e48a80' }
    : { '--paper-2': mixRgb(rgb, K, .05), '--card': mixRgb(rgb, W, .55), '--ink': '#26282c', '--ink-inv': mixRgb(rgb, W, .3), '--muted': '#85888e', '--faint': '#b3b3ae',
        '--line': 'rgba(110,140,180,.22)', '--line-strong': 'rgba(110,140,180,.40)', '--margin': 'rgba(214,96,90,.45)',
        '--today': 'rgba(255,200,60,.20)', '--focus': 'rgba(110,140,180,.10)', '--accent': '#c9574e' };
  r.setProperty('--paper', paper);
  for (const [k, v] of Object.entries(vars)) r.setProperty(k, v);
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = paper;
  if (NATIVE) {
    try { SB ||= plug('SystemBars'); SB.setStyle({ style: dark ? 'DARK' : 'LIGHT' }).catch(() => {}); } catch {}
  }
}
function openLook() {
  const L = look();
  const wrap = h('div', {});
  const draw = () => {
    const cur = PENS.find(p => p.id === L.pen) || PENS[0];
    const preset = PAPERS.some(p => p[1] === L.paper.toLowerCase());
    const pct = h('b', {}, Math.round(L.size * 100) + '%');
    put(wrap,
      h('label', { class: 'lbl' }, 'Paper'),
      h('div', { class: 'papers' },
        PAPERS.map(([n, c]) => h('button', { class: 'paper' + (L.paper.toLowerCase() === c ? ' on' : ''), style: `background:${c}`, 'aria-label': n, title: n,
          onclick: () => { L.paper = c; save(); applyLook(); draw(); } })),
        h('label', { class: 'paper custom' + (preset ? '' : ' on'), title: 'Any colour', style: preset ? '' : `background:${L.paper}` },
          preset ? ic('plus') : null,
          h('input', { type: 'color', value: L.paper, 'aria-label': 'Any colour',
            oninput: e => { L.paper = e.target.value; applyLook(); }, onchange: () => { save(); draw(); } }))),
      h('div', { class: 'hint' }, 'The last square lets you pick any colour.'),
      h('label', { class: 'lbl' }, 'Pen'),
      h('div', { class: 'pens' }, PENS.map(p => h('button', {
        class: 'pen' + (cur.id === p.id ? ' on' : ''),
        style: `font-family:${p.family};font-size:${(1.15 * p.k / cur.k).toFixed(3)}rem`,
        onclick: () => { L.pen = p.id; save(); applyLook(); draw(); },
      }, h('small', {}, p.name), 'Went to the beach'))),
      h('label', { class: 'lbl' }, 'Size'),
      h('div', { class: 'sizerow' },
        h('span', { style: 'font-size:.8rem' }, 'A'),
        h('input', { type: 'range', min: 60, max: 130, step: 5, value: Math.round(L.size * 100), 'aria-label': 'Size',
          oninput: e => { L.size = e.target.value / 100; pct.textContent = e.target.value + '%'; applyLook(); },
          onchange: () => save() }),
        h('span', { style: 'font-size:1.3rem' }, 'A'), pct),
      h('div', { class: 'hint' }, 'Smaller fits more on the screen.'));
  };
  draw();
  sheet('Paper, pen & size', wrap);
}

/* ---------- menu ---------- */
function openMenu() {
  const close = sheet('Notebook', h('div', { class: 'menu-list' },
    h('button', { onclick: () => { close(); openLook(); } }, 'Paper, pen & size', h('small', {}, 'Paper colour, handwriting and zoom')),
    h('button', { onclick: () => { close(); openReminders(); } }, 'Reminders', h('small', {}, 'Daily check-ins, notifications, Calendar')),
    h('button', { onclick: () => { close(); openDoodleLibrary(); } }, 'My doodles', h('small', {}, 'Edit, rename or delete your stamps')),
    h('button', { onclick: () => { close(); copyFromPrev(); } }, 'Copy last month’s setup', h('small', {}, 'Trackers & goals into this month')),
    h('button', { onclick: () => { close(); exportBackup(); } }, 'Save backup', h('small', {}, 'Download everything as one file — do this now and then')),
    h('button', { onclick: () => { close(); importBackup(); } }, 'Restore backup', h('small', {}, 'Load a backup file (replaces what’s here)')),
    h('button', { onclick: () => { close(); openHelp(); } }, 'How to use', h('small', {}, 'Quick tips'))));
}
function openDoodleLibrary() {
  const grid = h('div', { class: 'stampgrid' });
  const draw = () => put(grid, 
    Object.entries(state.doodles).map(([id, dd]) => h('button', { class: 'stamp', onclick: () => openDoodleEditor({
      title: 'Edit doodle', img: dd.img, withName: true, name: dd.name,
      onSave: (img, name) => { dd.img = img; dd.name = name; save(); draw(); render(); },
      onDelete: () => {
        delete state.doodles[id];
        for (const M of Object.values(state.months)) {
          for (const d of Object.keys(M.marks)) { M.marks[d] = M.marks[d].filter(x => x !== id); if (!M.marks[d].length) delete M.marks[d]; }
          for (const t of M.trackers) if (t.doodle === id) { t.doodle = null; t.type = 'check'; }
        }
        save(); draw(); render();
      },
    }) }, h('img', { src: dd.img, alt: '' }), h('span', {}, dd.name || ' '))),
    h('button', { class: 'stamp new', onclick: () => openDoodleEditor({ title: 'New doodle', withName: true,
      onSave: (img, name) => { state.doodles[uid()] = { img, name }; save(); draw(); } }) }, h('span', { class: 'plus' }, ic('plus')), h('span', {}, 'Draw new')));
  draw();
  sheet('My doodles', [h('div', { class: 'hint' }, 'These can be stamped on any day, in any month.'), grid]);
}
async function exportBackup() {
  const json = JSON.stringify({ app: 'notebook-planner', exported: new Date().toISOString(), state });
  const fname = `planner-backup-${new Date().toISOString().slice(0, 10)}.json`;
  if (NATIVE) {
    try {
      const r = await FS.writeFile({ path: fname, data: json, directory: 'CACHE', encoding: 'utf8' });
      await SH.share({ title: 'Planner backup', files: [r.uri] });
    } catch (e) { if (!/cancel/i.test(String(e && e.message))) toast('Could not save the backup'); }
    return;
  }
  const file = new File([json], fname, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Planner backup' }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  const a = h('a', { href: URL.createObjectURL(file), download: fname });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function importBackup() {
  const inp = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
  inp.addEventListener('change', async () => {
    const f = inp.files[0]; inp.remove(); if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const s = data.state || data;
      if (!s.months || !s.doodles) throw new Error('bad');
      if (!confirm('Replace everything in this notebook with the backup?')) return;
      state = s; await writeState(); applyLook(); render(false); toast('Backup restored');
    } catch { toast('That file isn’t a planner backup'); }
  });
  document.body.append(inp); inp.click();
}
function openHelp() {
  sheet('How to use', h('ul', { class: 'steps' },
    h('li', {}, 'Write one line per day in the Days page.'),
    h('li', {}, 'Tap the little dot next to a day to stamp a doodle on it (draw your own, e.g. a blood drop for the day your period started).'),
    h('li', {}, 'Tap + at the top right of the table to add a tracker column: a tick, number, letter, word or your own doodle.'),
    h('li', {}, 'Tap a tracker’s name to rename, move or delete it.'),
    h('li', {}, 'To-do: a list for each day. Tap a day number on the Days page to jump to its to-do list. Tap the clock on a to-do to get reminded.'),
    h('li', {}, NATIVE ? 'Reminders (in the menu): set your daily check-in times and turn on notifications.' : 'Reminders (in the menu): set daily check-in times, turn on notifications, or add them to your phone’s Calendar so they alert you even when the planner is closed.'),
    h('li', {}, 'Goals: list what you want this month and tick them off later.'),
    h('li', {}, 'Notes: free page with text, tables and mini doodles.'),
    h('li', {}, 'Tap the month name to jump back to today.'),
    h('li', {}, 'Paper, pen & size (in the menu): change the paper colour, the handwriting and how big everything looks.'),
    h('li', {}, 'Everything is stored only on this phone — use “Save backup” from the menu every so often.'),
    NATIVE && h('li', {}, 'Moving from the web version? Save a backup there, then use “Restore backup” here.')));
}

/* ---------- boot ---------- */
(async function boot() {
  const s = await loadState();
  if (s && s.months) state = s;
  applyLook();
  render(false);
  setTimeout(tick, 1500);
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if (NATIVE) { syncNative(); document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNative(); }); }
  else if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
