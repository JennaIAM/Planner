'use strict';
/* ============ Notebook Planner ============
   All data lives on this device (IndexedDB). Use ☰ → Save backup now and then. */

const DAY_ABBR = ['Su', 'M', 'Tu', 'W', 'Th', 'F', 'Sa'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const COLORS = ['#2f3542','#b0201b','#e84a5f','#f48fb1','#ef8b2c','#f2c418','#3aa76d','#2e86de','#8e5cc9','#8d6e63','#9aa0a6','#ffffff'];
const TYPES = [
  { id: 'check',  label: '✓ Check'  },
  { id: 'number', label: '# Number' },
  { id: 'letter', label: 'A Letter' },
  { id: 'word',   label: 'Aa Word'  },
  { id: 'doodle', label: '✎ Doodle' },
];
const ENTRY_MAX = 60;

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
const CHECK_SVG = '<svg viewBox="0 0 24 24"><path d="M4 13.5c2 1.6 3.4 3.2 4.8 5.6C11.6 12.8 15.4 8 20.5 4" fill="none" stroke="currentColor" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const checkIcon = () => h('span', { html: CHECK_SVG, style: 'display:contents' });

function toast(msg) {
  const t = h('div', { class: 'toast' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 1900);
}

/* ---------- storage (IndexedDB, localStorage fallback) ---------- */
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
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(writeState, 250); }
document.addEventListener('visibilitychange', () => { if (document.hidden) { clearTimeout(saveTimer); writeState(); } });

/* ---------- state ---------- */
let state = { v: 1, doodles: {}, months: {} };
const now = new Date();
const ui = { y: now.getFullYear(), m: now.getMonth(), tab: 'days', jumpToday: true };

const keyOf = (y, m) => `${y}-${String(m + 1).padStart(2, '0')}`;
const curKey = () => keyOf(ui.y, ui.m);
function prevKey() { const d = new Date(ui.y, ui.m - 1, 1); return keyOf(d.getFullYear(), d.getMonth()); }
function month(key = curKey()) {
  if (!state.months[key]) state.months[key] = { entries: {}, marks: {}, trackers: [], values: {}, goals: [], notes: [] };
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
  else if (ui.tab === 'goals') renderGoals(main);
  else renderNotes(main);
  $('#app').replaceChildren(header(), tabs(), main);
  if (st) { main.scrollTop = st[0]; main.scrollLeft = st[1]; }
  if (ui.jumpToday && ui.tab === 'days') {
    ui.jumpToday = false;
    const t = $('tr.today', main);
    if (t) main.scrollTop = Math.max(0, t.offsetTop - main.clientHeight / 3);
  }
}

function header() {
  return h('header', { class: 'top' },
    h('button', { class: 'icon', 'aria-label': 'Previous month', onclick: () => shift(-1) }, '‹'),
    h('div', { class: 'title', onclick: goToday, title: 'Go to today' },
      h('span', { class: 'mname' }, MONTHS[ui.m]), h('span', { class: 'year' }, ui.y)),
    h('button', { class: 'icon', 'aria-label': 'Next month', onclick: () => shift(1) }, '›'),
    h('button', { class: 'icon menu', 'aria-label': 'Menu', onclick: openMenu }, '☰'));
}
function shift(n) {
  const d = new Date(ui.y, ui.m + n, 1);
  ui.y = d.getFullYear(); ui.m = d.getMonth(); ui.jumpToday = true;
  render(false);
}
function goToday() { const d = new Date(); ui.y = d.getFullYear(); ui.m = d.getMonth(); ui.jumpToday = true; render(false); }

function tabs() {
  const M = state.months[curKey()];
  const g = M ? M.goals : [];
  const t = (id, label, extra) => h('button', { class: 'tab' + (ui.tab === id ? ' on' : ''), onclick: () => { ui.tab = id; ui.jumpToday = id === 'days'; render(false); } }, label, extra);
  return h('nav', { class: 'tabs' },
    t('days', 'Days'),
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
    h('button', { class: 'x', 'aria-label': 'Dismiss', onclick: () => { M.noCopy = true; save(); render(); } }, '×'));
}
function copyFromPrev() {
  const M = month(), P = state.months[prevKey()];
  if (!P) return toast('Nothing in last month');
  for (const t of P.trackers) if (!M.trackers.some(x => x.name === t.name)) M.trackers.push({ ...t, id: uid() });
  for (const g of P.goals) if (!M.goals.some(x => x.text === g.text)) M.goals.push({ id: uid(), text: g.text, done: false });
  save(); render(); toast('Copied ✓');
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
    h('th', { class: 'c-mark' }, '✦'),
    h('th', { class: 'c-entry', style: 'text-align:left;padding-left:8px' }, 'one line a day'),
    M.trackers.map(tr => h('th', { class: 'c-trk' + (tr.type === 'word' ? ' wide' : ''), onclick: () => editTracker(tr) },
      h('span', { class: 'trkname' }, tr.name || '—'))),
    h('th', { class: 'c-add' }, h('button', { class: 'addtrk', 'aria-label': 'Add tracker', onclick: () => editTracker(null) }, '+')));

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
    const entry = h('input', {
      class: 'entry', value: M.entries[d] || '', maxlength: ENTRY_MAX, enterkeyhint: 'next', 'data-day': d, autocomplete: 'off',
      oninput: e => { const v = e.target.value; if (v) M.entries[d] = v; else delete M.entries[d]; save(); },
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); const nx = $(`.entry[data-day="${d + 1}"]`); nx ? nx.focus() : e.target.blur(); } },
    });
    body.append(h('tr', { class: cls },
      h('td', { class: 'c-day' }, h('b', {}, d), h('span', {}, DAY_ABBR[wd])),
      markCell,
      h('td', { class: 'c-entry' }, entry),
      M.trackers.map(tr => trackerCell(M, tr, d)),
      h('td', { class: 'c-add' })));
  }
  const table = h('table', { class: 'days' }, h('thead', {}, headRow), body);
  main.append(table);
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
      }) }, h('span', { class: 'plus' }, '+'), h('span', {}, 'Draw new')));
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
  const t = tr ? { ...tr } : { id: uid(), name: '', type: 'check', doodle: null };
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
        }) }, h('span', { class: 'plus' }, '+'), h('span', {}, 'Draw new'))));
  };
  drawTypes(); drawDoodle();

  const idx = M.trackers.findIndex(x => x.id === t.id);
  const move = dir => {
    const j = idx + dir; if (j < 0 || j >= M.trackers.length) return;
    [M.trackers[idx], M.trackers[j]] = [M.trackers[j], M.trackers[idx]];
    save(); close(); render();
  };
  const close = sheet(isNew ? 'New tracker' : 'Edit tracker', [
    h('label', { class: 'lbl' }, 'Name'), name,
    h('label', { class: 'lbl' }, 'What do you write each day?'), typeRow, dRow,
    h('div', { class: 'sheetfoot' },
      !isNew && h('button', { class: 'btn danger', onclick: () => {
        if (!confirm(`Delete "${t.name}" and its ticks for this month?`)) return;
        M.trackers = M.trackers.filter(x => x.id !== t.id); delete M.values[t.id]; save(); close(); render();
      } }, 'Delete'),
      !isNew && idx > 0 && h('button', { class: 'btn small', onclick: () => move(-1) }, '← move'),
      !isNew && idx < M.trackers.length - 1 && h('button', { class: 'btn small', onclick: () => move(1) }, 'move →'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn primary', onclick: () => {
        t.name = name.value.trim();
        if (!t.name) { name.focus(); return toast('Give it a name'); }
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
      h('button', { class: 'x', 'aria-label': 'Delete goal', onclick: () => { M.goals = M.goals.filter(x => x !== g); save(); render(); } }, '×')));
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
  if (!M.notes.length) page.append(h('div', { class: 'emptynote' }, 'Blank page. Add some text, a table or a little doodle ↓'));
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
    i > 0 && h('button', { 'aria-label': 'Move up', onclick: () => { [M.notes[i - 1], M.notes[i]] = [M.notes[i], M.notes[i - 1]]; save(); render(); } }, '↑'),
    i < M.notes.length - 1 && h('button', { 'aria-label': 'Move down', onclick: () => { [M.notes[i + 1], M.notes[i]] = [M.notes[i], M.notes[i + 1]]; save(); render(); } }, '↓'),
    h('button', { 'aria-label': 'Delete', onclick: () => {
      const empty = (b.type === 'text' && !b.text.trim());
      if (!empty && !confirm('Delete this from your notes?')) return;
      M.notes.splice(i, 1); save(); render();
    } }, '✕'));
  const wrap = h('div', { class: 'block' }, tools);

  if (b.type === 'text') {
    const ta = h('textarea', { class: 'ntext', rows: 2, placeholder: 'write here…', value: b.text });
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.max(68, Math.ceil(ta.scrollHeight / 34) * 34) + 'px'; };
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
        h('button', { class: 'tool', onclick: () => { b.align = (b.align || 'left') === 'left' ? 'center' : 'left'; save(); render(); } }, (b.align || 'left') === 'left' ? '⇤ left' : '↔ center'),
        h('button', { class: 'tool', onclick: () => {
          const name = prompt('Save to your doodle stamps as:', '');
          if (name == null) return;
          state.doodles[uid()] = { img: b.img, name: name.trim() }; save(); toast('Saved to your stamps');
        } }, '☆ stamp')));
  }
  return wrap;
}

/* ---------- sheet (bottom modal) ---------- */
function sheet(title, content) {
  const ov = h('div', { class: 'overlay' });
  const close = () => { ov.remove(); };
  const panel = h('div', { class: 'sheet', role: 'dialog' },
    h('div', { class: 'sheethead' }, h('h3', {}, title), h('button', { class: 'x', 'aria-label': 'Close', onclick: close }, '×')),
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
      h('button', { class: 'tool', onclick: () => { const s = hist.pop(); if (s) ctx.putImageData(s, 0, 0); } }, '↶ undo'),
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
        if (!any) return toast('Draw something first ✎');
        onSave(out.toDataURL('image/png'), nameIn ? nameIn.value.trim() : '');
        close();
      } }, 'Save')),
  ]);
}

/* ---------- menu ---------- */
function openMenu() {
  const close = sheet('Notebook', h('div', { class: 'menu-list' },
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
      onSave: (img, name) => { state.doodles[uid()] = { img, name }; save(); draw(); } }) }, h('span', { class: 'plus' }, '+'), h('span', {}, 'Draw new')));
  draw();
  sheet('My doodles', [h('div', { class: 'hint' }, 'These can be stamped on any day, in any month.'), grid]);
}
async function exportBackup() {
  const json = JSON.stringify({ app: 'notebook-planner', exported: new Date().toISOString(), state });
  const fname = `planner-backup-${new Date().toISOString().slice(0, 10)}.json`;
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
      state = s; await writeState(); render(false); toast('Backup restored ✓');
    } catch { toast('That file isn’t a planner backup'); }
  });
  document.body.append(inp); inp.click();
}
function openHelp() {
  sheet('How to use', h('ul', { class: 'steps' },
    h('li', {}, 'Write one line per day in the Days page.'),
    h('li', {}, 'Tap the little dot next to a day to stamp a doodle on it (draw your own — e.g. a blood drop for the day your period started).'),
    h('li', {}, 'Tap + at the top right of the table to add a tracker column: a tick, number, letter, word or your own doodle.'),
    h('li', {}, 'Tap a tracker’s name to rename, move or delete it.'),
    h('li', {}, 'Goals: list what you want this month and tick them off later.'),
    h('li', {}, 'Notes: free page with text, tables and mini doodles.'),
    h('li', {}, 'Tap the month name to jump back to today.'),
    h('li', {}, 'Everything is stored only on this phone — use “Save backup” from the menu every so often.')));
}

/* ---------- boot ---------- */
(async function boot() {
  const s = await loadState();
  if (s && s.months) state = s;
  render(false);
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
