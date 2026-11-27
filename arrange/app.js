/* Arrangement tool for Naava's website.
 * Vanilla JS, no build step. Talks to tools/server.py (GET/POST /api/arrangement).
 */
'use strict';

const API = '../api/arrangement';
const WORKS_URL = '../data/works.json';
const STATIC_ARR_URL = '../data/arrangement.json';
const HERO_MIN = 3, HERO_MAX = 4, FEAT_MIN = 10, FEAT_MAX = 15;
const SAVE_DELAY = 700;
const POLL_MS = 15000;
const LS = { author: 'arrange.author', pending: 'arrange.pending', help: 'arrange.helpHidden' };

const S = {
  works: [], byId: new Map(), cats: [], catBySlug: new Map(),
  arr: null,          // working copy of the arrangement
  base: null,         // updated_at of the last state we got from the server
  baseArr: null,      // that server state (for 3-way merge on conflict)
  rev: 0, savedRev: 0, saving: false, retryMs: 0, saveTimer: null, retryTimer: null,
  serverOk: true, fatalSaveError: null,
  undo: [],
  view: 'browse', orderCat: null,
  filters: { cat: 'all', q: '', placed: false },
  gridKey: null,
  lbList: [], lbId: null,
};

/* ---------- small helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const clone = (x) => JSON.parse(JSON.stringify(x));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* ignore */ } };
const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;

const work = (id) => S.byId.get(id) || null;
const thumbUrl = (w) => `../assets/img/thumb/${encodeURIComponent(w.slug)}.jpg`;
const fullUrl = (w) => `../assets/img/full/${encodeURIComponent(w.slug)}.jpg`;
const catName = (slug) => (S.catBySlug.get(slug) || { name: slug }).name;
const titleOf = (id) => { const w = work(id); return w ? w.title : 'a missing piece'; };

function catWorks(slug) {
  return S.works.filter((w) => w.category === slug).sort(byDefaultOrder);
}
function byDefaultOrder(a, b) {
  return (a.order ?? 1e9) - (b.order ?? 1e9) || a.title.localeCompare(b.title);
}
function nonEmptyCats() { return S.cats.filter((c) => c.n > 0); }

function normalize(a) {
  a = (a && typeof a === 'object') ? clone(a) : {};
  if (typeof a.version !== 'number') a.version = 1;
  if (!('updated_at' in a)) a.updated_at = null;
  for (const k of ['hero', 'featured']) if (!Array.isArray(a[k])) a[k] = [];
  for (const k of ['covers', 'order']) if (!a[k] || typeof a[k] !== 'object' || Array.isArray(a[k])) a[k] = {};
  if (!Array.isArray(a.feedback)) a.feedback = [];
  for (const k of ['hero', 'featured']) a[k] = dedupe(a[k].filter((x) => typeof x === 'string'));
  for (const c of Object.keys(a.order)) a.order[c] = Array.isArray(a.order[c]) ? dedupe(a.order[c]) : [];
  return a;
}
function dedupe(list) { return Array.from(new Set(list)); }

/* ---------- list access ("hero", "featured", "order:<cat>") ---------- */
function getList(key) {
  if (key === 'hero' || key === 'featured') return S.arr[key];
  if (key.startsWith('order:')) return S.arr.order[key.slice(6)] || [];
  return [];
}
function setList(key, list) {
  if (key === 'hero' || key === 'featured') S.arr[key] = list;
  else if (key.startsWith('order:')) {
    const c = key.slice(6);
    if (list.length) S.arr.order[c] = list; else delete S.arr.order[c];
  }
}
const LIST_NAMES = { hero: 'the front page', featured: '“From the studio”' };
const listName = (key) => LIST_NAMES[key] || `the top of ${catName(key.slice(6))}`;

/* ---------- undo + commit ---------- */
function decisions() {
  return clone({ hero: S.arr.hero, featured: S.arr.featured, covers: S.arr.covers, order: S.arr.order });
}
function act(label, fn) {
  const snap = decisions();
  fn();
  if (same(snap, decisions())) return;
  S.undo.push({ label, snap });
  if (S.undo.length > 60) S.undo.shift();
  commit();
  toast(label, true);
}
function undo() {
  const u = S.undo.pop();
  if (!u) return;
  Object.assign(S.arr, clone(u.snap));
  commit();
  toast(`Undone: ${u.label}`, false);
}
function commit() {
  S.rev++;
  lsSet(LS.pending, JSON.stringify({ base: S.base, arr: S.arr }));
  scheduleSave(SAVE_DELAY);
  render();
}

/* ---------- actions ---------- */
function toggleIn(key, id) {
  const list = getList(key).slice();
  const i = list.indexOf(id);
  const t = `“${titleOf(id)}”`;
  if (i >= 0) {
    act(`Took ${t} off ${listName(key)}`, () => { list.splice(i, 1); setList(key, list); });
  } else {
    let extra = '';
    if (key === 'hero' && list.length >= HERO_MAX) extra = ` — that makes ${list.length + 1}; 3–4 works best`;
    if (key === 'featured' && list.length >= FEAT_MAX) extra = ` — that makes ${list.length + 1}; aim for 10–15`;
    act(`Added ${t} to ${listName(key)}${extra}`, () => { list.push(id); setList(key, list); });
  }
}
function togglePin(id) {
  const w = work(id);
  if (!w) return;
  toggleIn('order:' + w.category, id);
}
function toggleCover(id) {
  const w = work(id);
  if (!w) return;
  const cat = w.category;
  if (S.arr.covers[cat] === id) {
    act(`${catName(cat)} has no cover now`, () => { delete S.arr.covers[cat]; });
  } else setCover(cat, id);
}
function setCover(cat, id) {
  const w = work(id);
  let label = `“${titleOf(id)}” is now the cover of ${catName(cat)}`;
  if (w && w.category !== cat) label += ` (note: it’s from ${catName(w.category)})`;
  act(label, () => { S.arr.covers[cat] = id; });
}
function removeCover(cat) {
  act(`Removed the cover of ${catName(cat)}`, () => { delete S.arr.covers[cat]; });
}
function moveItem(key, from, to) {
  const list = getList(key).slice();
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return;
  const [id] = list.splice(from, 1);
  list.splice(to, 0, id);
  act(`Moved “${titleOf(id)}” to place ${to + 1}`, () => setList(key, list));
}
function removeFromList(key, id) {
  const list = getList(key).filter((x) => x !== id);
  const verb = key.startsWith('order:') ? 'Unpinned' : 'Removed';
  act(`${verb} “${titleOf(id)}”${key.startsWith('order:') ? '' : ' from ' + listName(key)}`, () => setList(key, list));
}

/* ---------- feedback ---------- */
function openFeedback(section) {
  return S.arr.feedback.filter((f) => !f.resolved && (section ? f.section === section : true));
}
function openCountPrefix(prefix) {
  return S.arr.feedback.filter((f) => !f.resolved && (f.section || '').startsWith(prefix)).length;
}
function addComment(section, author, text) {
  S.arr.feedback.push({
    id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    section, author, text, at: new Date().toISOString(), resolved: false,
  });
  commit();
  toast('Comment posted — thank you!', false);
}
function setResolved(id, val) {
  const f = S.arr.feedback.find((x) => x.id === id);
  if (!f) return;
  f.resolved = val;
  if (val) f.resolved_at = new Date().toISOString(); else delete f.resolved_at;
  commit();
  toast(val ? 'Marked as done' : 'Comment reopened', false);
}
function deleteComment(id) {
  S.arr.feedback = S.arr.feedback.filter((x) => x.id !== id);
  commit();
}

/* ---------- saving ---------- */
function scheduleSave(ms) {
  clearTimeout(S.saveTimer);
  if (!S.serverOk || S.fatalSaveError) { renderStatus(); return; }
  S.saveTimer = setTimeout(save, ms);
  renderStatus();
}
const isDirty = () => S.rev !== S.savedRev;

async function save() {
  if (!S.serverOk) return;
  if (S.saving) { S.saveAgain = true; return; }
  if (!isDirty()) { renderStatus(); return; }
  clearTimeout(S.retryTimer);
  S.saving = true; S.saveAgain = false;
  renderStatus();
  const sentRev = S.rev;
  const body = { base_updated_at: S.base, arrangement: S.arr };
  let retry = false;
  try {
    const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 409) {
      const j = await r.json();
      mergeTheirs(normalize(j.arrangement));
      toast('Someone else changed things at the same time — both sets of changes are kept.', false, 9000);
      S.saveAgain = true;
    } else if (r.status === 400) {
      const j = await r.json().catch(() => ({}));
      S.fatalSaveError = j.error || 'the server did not accept the data';
    } else if (!r.ok) {
      throw new Error('HTTP ' + r.status);
    } else {
      const j = await r.json();
      S.base = j.arrangement.updated_at;
      S.baseArr = normalize(j.arrangement);
      S.arr.updated_at = S.base;
      S.retryMs = 0;
      if (S.rev === sentRev) {
        S.savedRev = sentRev;
        lsSet(LS.pending, null);
      } else {
        lsSet(LS.pending, JSON.stringify({ base: S.base, arr: S.arr }));
      }
    }
  } catch (e) {
    retry = true;
  }
  S.saving = false;
  if (retry) {
    S.retryMs = Math.min(S.retryMs ? S.retryMs * 2 : 2000, 10000);
    S.retryTimer = setTimeout(save, S.retryMs);
  } else if (S.saveAgain || isDirty()) {
    scheduleSave(S.saveAgain ? 50 : SAVE_DELAY);
  }
  renderStatus();
  if (!retry) renderReviewStamp();
}

/* Three-way merge: keep my changes since base, take theirs for everything else. */
function merge3(base, mine, theirs) {
  const out = clone(theirs);
  const pick = (b, m, t) => (same(m, b) ? t : m);
  for (const k of ['hero', 'featured']) out[k] = clone(pick(base[k], mine[k], theirs[k]));
  for (const k of ['covers', 'order']) {
    const keys = new Set([...Object.keys(base[k]), ...Object.keys(mine[k]), ...Object.keys(theirs[k])]);
    out[k] = {};
    for (const c of keys) {
      const v = pick(base[k][c], mine[k][c], theirs[k][c]);
      if (v !== undefined) out[k][c] = clone(v);
    }
  }
  const idx = (list) => new Map(list.map((f) => [f.id, f]));
  const B = idx(base.feedback), M = idx(mine.feedback), T = idx(theirs.feedback);
  const ids = new Set([...B.keys(), ...M.keys(), ...T.keys()]);
  const fb = [];
  for (const id of ids) {
    const v = pick(B.get(id), M.get(id), T.get(id));
    if (v) fb.push(clone(v));
  }
  fb.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  out.feedback = fb;
  return out;
}
function mergeTheirs(theirs) {
  S.arr = merge3(S.baseArr, S.arr, theirs);
  S.base = theirs.updated_at;
  S.baseArr = theirs;
  S.arr.updated_at = S.base;
  S.rev++;
  render();
}

async function poll() {
  if (!S.serverOk || S.saving || isDirty() || document.hidden) return;
  try {
    const r = await fetch(API + '?t=' + Date.now());
    if (!r.ok) return;
    const theirs = normalize(await r.json());
    if (S.saving || isDirty() || theirs.updated_at === S.base) return;
    const changed = !same({ ...S.arr, updated_at: 0 }, { ...theirs, updated_at: 0 });
    S.arr = theirs; S.base = theirs.updated_at; S.baseArr = clone(theirs);
    if (changed) { render(); toast('Updated with the latest changes', false); }
  } catch (e) { /* offline: try again later */ }
}

/* ---------- loading ---------- */
async function load() {
  const [wr, ar] = await Promise.all([
    fetch(WORKS_URL + '?t=' + Date.now()),
    fetch(API + '?t=' + Date.now()).catch(() => null),
  ]);
  const data = await wr.json();
  // categories marked arrange:false (e.g. Galleries & Displays) are left out of this tool entirely
  const skip = new Set((data.categories || []).filter((c) => c.arrange === false).map((c) => c.slug));
  S.works = (data.works || []).filter((w) => w && w.id && !skip.has(w.category));
  S.byId = new Map(S.works.map((w) => [w.id, w]));
  const cats = (data.categories || []).filter((c) => !skip.has(c.slug)).map((c) => ({ ...c }));
  // categories that appear on works but are not listed yet
  for (const w of S.works) if (!cats.some((c) => c.slug === w.category)) cats.push({ slug: w.category, name: w.category });
  for (const c of cats) c.n = S.works.filter((w) => w.category === c.slug).length;
  S.cats = cats;
  S.catBySlug = new Map(cats.map((c) => [c.slug, c]));

  let arr;
  if (ar && ar.ok && (ar.headers.get('content-type') || '').includes('json')) {
    arr = await ar.json();
  } else {
    S.serverOk = false;
    try { arr = await (await fetch(STATIC_ARR_URL + '?t=' + Date.now())).json(); } catch (e) { arr = {}; }
    showBanner('Saving isn’t switched on, so changes made here won’t be kept. Please close this and open the website using the <b>“Preview website”</b> launcher on the Desktop.');
  }
  if (arr && arr.locked) {
    S.serverOk = false;  // view only: nothing will be saved
    showBanner('🔒 <b>The arrangement is final and locked</b> (reviewed Nov 26). You can look around, but changes here won’t be saved.');
  }
  S.arr = normalize(arr);
  S.base = S.arr.updated_at;
  S.baseArr = clone(S.arr);

  // Changes that were made but never reached the server (e.g. the window was closed while offline)
  try {
    const p = JSON.parse(lsGet(LS.pending) || 'null');
    if (p && p.arr && S.serverOk) {
      if (p.base === S.base && !same(normalize(p.arr), S.arr)) {
        S.arr = normalize(p.arr);
        S.arr.updated_at = S.base;
        S.rev++;
        scheduleSave(300);
        setTimeout(() => toast('Restored changes from last time that hadn’t been saved yet.', false, 8000), 300);
      } else lsSet(LS.pending, null);
    }
  } catch (e) { lsSet(LS.pending, null); }

  if (!S.orderCat) S.orderCat = (nonEmptyCats()[0] || S.cats[0] || {}).slug;
  readHash();
  render();
  renderStatus();
  setInterval(poll, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
}

/* ---------- routing ---------- */
const VIEWS = ['browse', 'hero', 'featured', 'covers', 'order', 'review'];
function readHash() {
  const h = decodeURIComponent(location.hash.replace(/^#/, ''));
  const [v, arg] = h.split('/');
  S.view = VIEWS.includes(v) ? v : 'browse';
  if (S.view === 'order' && arg && S.catBySlug.has(arg)) S.orderCat = arg;
}
function go(view, arg) {
  const h = '#' + view + (arg ? '/' + arg : '');
  if (location.hash !== h) history.pushState(null, '', h);
  readHash();
  S.gridKey = null;
  render();
  window.scrollTo(0, 0);
  $('#main').focus({ preventScroll: true });
}
window.addEventListener('popstate', () => { readHash(); S.gridKey = null; render(); });

/* ---------- rendering: header ---------- */
function counters() {
  const h = S.arr.hero.length, f = S.arr.featured.length;
  const ne = nonEmptyCats();
  const coversDone = ne.filter((c) => S.arr.covers[c.slug]).length;
  const pinned = Object.entries(S.arr.order).reduce((n, [, l]) => n + l.length, 0);
  return {
    hero: { text: `${h} of 3–4`, ok: h >= HERO_MIN && h <= HERO_MAX },
    featured: { text: `${f}`, ok: f >= FEAT_MIN && f <= FEAT_MAX },
    covers: { text: `${coversDone} of ${ne.length}`, ok: coversDone === ne.length },
    order: { text: pinned ? `${pinned} pinned` : 'none yet', ok: true, neutral: true },
  };
}
function renderTabs() {
  const c = counters();
  const badge = (n) => (n ? `<span class="badge" title="${plural(n, 'open comment')}">💬 ${n}</span>` : '');
  const tab = (v, icon, label, count, fb) => {
    const cur = S.view === v ? ' aria-current="page"' : '';
    const cnt = count ? `<span class="count ${count.neutral ? '' : count.ok ? 'ok' : 'warn'}">${esc(count.text)}${count.ok && !count.neutral ? ' ✓' : ''}</span>` : '';
    return `<a href="#${v}" class="tab tab-${v}" data-view="${v}"${cur}><span class="tab-icon">${icon}</span><span class="tab-label">${label}</span>${cnt}${badge(fb)}</a>`;
  };
  $('#tabs').innerHTML =
    tab('browse', '▦', 'All pieces', { text: String(S.works.length), neutral: true }, 0) +
    tab('hero', '★', 'Front page', c.hero, openFeedback('hero').length) +
    tab('featured', '♥', 'From the studio', c.featured, openFeedback('featured').length) +
    tab('covers', '▣', 'Category covers', c.covers, openFeedback('covers').length) +
    tab('order', '📌', 'Order in categories', c.order, openCountPrefix('order:')) +
    tab('review', '💬', 'Overview & comments', null, openFeedback().length);
  const u = $('#undo');
  const last = S.undo[S.undo.length - 1];
  u.disabled = !last;
  u.title = last ? `Undo: ${last.label}` : 'Nothing to undo yet';
}
function renderStatus() {
  const el = $('#status');
  let cls = 'saved', text = 'Saved ✓', title = 'Everything is saved. Changes save by themselves.';
  if (!S.serverOk) { cls = 'error'; text = 'Not saving'; title = 'Open this through the “Preview website” launcher so changes are saved.'; }
  else if (S.fatalSaveError) { cls = 'error'; text = 'Couldn’t save'; title = 'The server refused the change: ' + S.fatalSaveError; }
  else if (S.retryMs && isDirty()) { cls = 'error'; text = 'Couldn’t save — retrying'; title = 'Is the server window still open? Your changes are kept in this window and will be saved when it’s back. Click to try now.'; }
  else if (S.saving || isDirty()) { cls = 'saving'; text = 'Saving…'; title = 'Saving your changes'; }
  el.className = 'status status-' + cls;
  el.textContent = text;
  el.title = title;
}
function showBanner(html) { const b = $('#banner'); b.innerHTML = html; b.hidden = false; }

/* ---------- rendering: main ---------- */
function render() {
  renderTabs();
  const main = $('#main');
  const v = S.view;
  if (v === 'browse') renderBrowse(main);
  else {
    S.gridKey = null;
    if (v === 'hero') renderListView(main, 'hero');
    else if (v === 'featured') renderListView(main, 'featured');
    else if (v === 'covers') renderCovers(main);
    else if (v === 'order') renderOrder(main);
    else if (v === 'review') renderReview(main);
  }
  main.dataset.current = v;
  if (!$('#lightbox').hidden) renderLightbox();
  if (!$('#modal').hidden && S.modalRender) S.modalRender();
  if (S.focusAfter) {
    const el = S.focusAfter.map((sel) => $(sel)).find(Boolean);
    if (el) el.focus({ preventScroll: false });
    S.focusAfter = null;
  }
}

function tagButtons(w) {
  const id = w.id;
  const hi = S.arr.hero.indexOf(id), fi = S.arr.featured.indexOf(id);
  const pins = S.arr.order[w.category] || [];
  const pi = pins.indexOf(id);
  const isCover = S.arr.covers[w.category] === id;
  const b = (act, on, label, onLabel, tip) =>
    `<button type="button" class="tag tag-${act}${on ? ' on' : ''}" data-act="${act}" aria-pressed="${on}" title="${esc(tip)}"><span class="box" aria-hidden="true">${on ? '✓' : ''}</span><span>${on ? onLabel : label}</span></button>`;
  return (
    b('hero', hi >= 0, '★ Front page', `★ Front page #${hi + 1}`, 'One of the 3–4 big pictures on the home page') +
    b('featured', fi >= 0, '♥ From the studio', `♥ Studio #${fi + 1}`, 'One of the 10–15 selected works on the home page') +
    b('cover', isCover, '▣ Category cover', '▣ Cover ✓', `The picture on the “${catName(w.category)}” card`) +
    b('pin', pi >= 0, '📌 Pin to top', `📌 Pinned #${pi + 1}`, `Show it near the start of “${catName(w.category)}”`)
  );
}
function isPlaced(w) {
  return S.arr.hero.includes(w.id) || S.arr.featured.includes(w.id) || S.arr.covers[w.category] === w.id ||
    (S.arr.order[w.category] || []).includes(w.id);
}
function cardHTML(w) {
  const meta = [catName(w.category), w.occasion].filter(Boolean).map(esc).join(' · ');
  return `<article class="card${isPlaced(w) ? ' placed' : ''}" data-id="${esc(w.id)}">
    <button type="button" class="card-img" data-act="zoom" aria-label="See “${esc(w.title)}” large">
      <img src="${thumbUrl(w)}" alt="" loading="lazy" decoding="async">
      ${w.isNew ? '<span class="new">New</span>' : ''}
    </button>
    <div class="card-body">
      <h3>${esc(w.title)}</h3>
      <p class="meta">${meta}</p>
      <div class="tags">${tagButtons(w)}</div>
    </div>
  </article>`;
}

function filteredWorks() {
  const { cat, q, placed } = S.filters;
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return S.works.filter((w) => {
    if (cat !== 'all' && w.category !== cat) return false;
    if (placed && !isPlaced(w)) return false;
    if (words.length) {
      const hay = `${w.title} ${w.occasion || ''} ${catName(w.category)}`.toLowerCase();
      if (!words.every((x) => hay.includes(x))) return false;
    }
    return true;
  });
}

function renderBrowse(main) {
  const key = JSON.stringify(S.filters);
  if (S.gridKey === key && $('#grid', main)) {
    // Update buttons in place so pictures don't flicker and scroll stays put.
    for (const card of $$('.card', main)) {
      const w = work(card.dataset.id);
      if (!w) continue;
      card.classList.toggle('placed', isPlaced(w));
      $('.tags', card).innerHTML = tagButtons(w);
    }
    return;
  }
  const keepFocus = document.activeElement && document.activeElement.id === 'search';
  const { cat, q, placed } = S.filters;
  const list = filteredWorks();
  const help = lsGet(LS.help) ? '' : `
    <section class="help">
      <h2>How this works</h2>
      <ol>
        <li><b>Look through your pieces</b> below. Tap a picture to see it large.</li>
        <li><b>Tap the buttons</b> under a piece to put it on the <span class="c-hero">★ Front page</span>, in <span class="c-featured">♥ From the studio</span>, as its <span class="c-cover">▣ Category cover</span>, or <span class="c-pin">📌 Pin</span> it near the top of its category.</li>
        <li><b>Use the tabs at the top</b> to put each list in order.</li>
      </ol>
      <p>Everything saves by itself. Made a mistake? Press <b>↶ Undo</b>.</p>
      <button type="button" class="btn btn-quiet" data-act="hide-help">Got it, hide this</button>
    </section>`;
  const chip = (slug, label, n) =>
    `<button type="button" class="chip${cat === slug ? ' on' : ''}" data-act="filter-cat" data-cat="${esc(slug)}" aria-pressed="${cat === slug}">${esc(label)} <span class="n">${n}</span></button>`;
  const groups = [];
  for (const c of S.cats) {
    const items = list.filter((w) => w.category === c.slug).sort(byDefaultOrder);
    if (items.length) groups.push({ c, items });
  }
  let body;
  if (!list.length) {
    body = `<div class="empty"><p>${placed && !q && cat === 'all' ? 'You haven’t placed any pieces yet. Tap the buttons under a picture to start.' :
      (cat !== 'all' && !(S.catBySlug.get(cat) || {}).n) ? 'There are no pieces in this category yet.' : 'No pieces match.'}</p>
      ${(q || placed || cat !== 'all') ? '<button type="button" class="btn" data-act="clear-filters">Show all pieces</button>' : ''}</div>`;
  } else {
    body = groups.map((g) => `
      <section class="group">
        <h2 class="group-h">${esc(g.c.name)} <span class="muted">${plural(g.items.length, 'piece')}</span></h2>
        <div class="grid">${g.items.map(cardHTML).join('')}</div>
      </section>`).join('');
  }
  main.innerHTML = `${help}
    <div class="filters" role="search">
      <div class="chips" role="group" aria-label="Category">
        ${chip('all', 'All', S.works.length)}
        ${S.cats.map((c) => chip(c.slug, c.name, c.n)).join('')}
      </div>
      <div class="filter-row">
        <label class="search"><span class="sr">Search by name</span>
          <input id="search" type="search" placeholder="Search by name…" value="${esc(q)}" autocomplete="off">
        </label>
        <label class="switch"><input type="checkbox" id="placed-only" ${placed ? 'checked' : ''}><span class="track" aria-hidden="true"></span>Only pieces I’ve placed</label>
        <span class="muted result-count">Showing ${plural(list.length, 'piece')}</span>
      </div>
    </div>
    <div id="grid">${body}</div>`;
  S.gridKey = key;
  if (keepFocus) { const s = $('#search'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
}

/* ---------- list views (front page / from the studio) ---------- */
function rowHTML(key, id, i, n) {
  const w = work(id);
  const cat = key.startsWith('order:') ? key.slice(6) : null;
  let warn = '';
  if (!w) warn = `<span class="warn-text">⚠ This piece is no longer in the list of works (${esc(id)}). You can remove it.</span>`;
  else if (cat && w.category !== cat) warn = `<span class="warn-text">⚠ This piece is now in ${esc(catName(w.category))}.</span>`;
  const img = w ? `<button type="button" class="row-img" data-act="zoom" aria-label="See “${esc(w.title)}” large"><img src="${thumbUrl(w)}" alt="" loading="lazy"></button>`
    : '<span class="row-img missing" aria-hidden="true">?</span>';
  return `<li class="row${w ? '' : ' is-missing'}" data-id="${esc(id)}">
    <span class="handle" title="Drag to move" aria-hidden="true">⠿</span>
    <span class="num">${i + 1}</span>
    ${img}
    <div class="row-text">
      <b>${w ? esc(w.title) : 'Missing piece'}</b>
      <span class="muted">${w ? esc([catName(w.category), w.occasion].filter(Boolean).join(' · ')) : ''}</span>
      ${warn}
    </div>
    <div class="row-btns">
      <button type="button" class="btn icon" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="Move “${esc(w ? w.title : id)}” up">↑</button>
      <button type="button" class="btn icon" data-act="down" ${i === n - 1 ? 'disabled' : ''} aria-label="Move “${esc(w ? w.title : id)}” down">↓</button>
      <button type="button" class="btn btn-remove" data-act="remove">${cat ? 'Unpin' : 'Remove'}</button>
    </div>
  </li>`;
}
function sortableHTML(key) {
  const list = getList(key);
  return `<ol class="rows" data-list="${esc(key)}">${list.map((id, i) => rowHTML(key, id, i, list.length)).join('')}</ol>`;
}
function feedbackCallout(section) {
  const open = openFeedback(section);
  if (!open.length) return '';
  return `<aside class="callout">
    <h3>💬 ${plural(open.length, 'comment')} about this</h3>
    ${open.map(commentHTML).join('')}
    <a href="#review" class="link" data-view="review">Reply or add a comment in the Overview →</a>
  </aside>`;
}
function catSpread(ids) {
  const set = new Set(ids.map(work).filter(Boolean).map((w) => w.category));
  const ne = nonEmptyCats();
  return { covered: ne.filter((c) => set.has(c.slug)), missing: ne.filter((c) => !set.has(c.slug)) };
}
function renderListView(main, key) {
  const list = getList(key);
  const n = list.length;
  let intro, counter, hint = '';
  if (key === 'hero') {
    intro = 'The big pictures people see first on the home page. Choose 3 or 4 of your very best, most loved pieces. The first one is shown first.';
    counter = `<span class="count big ${n >= HERO_MIN && n <= HERO_MAX ? 'ok' : 'warn'}">${n} of 3–4${n >= HERO_MIN && n <= HERO_MAX ? ' ✓' : ''}</span>`;
    if (n > HERO_MAX) hint = `That’s ${n} — the front page looks best with 3 or 4. Maybe remove ${n - HERO_MAX}?`;
    else if (n && n < HERO_MIN) hint = `Choose ${HERO_MIN - n} more.`;
  } else {
    intro = 'A selection of favourites shown on the home page under “From the studio”. Aim for 10–15 pieces, ideally from many different categories.';
    counter = `<span class="count big ${n >= FEAT_MIN && n <= FEAT_MAX ? 'ok' : 'warn'}">${n} chosen · aim for 10–15${n >= FEAT_MIN && n <= FEAT_MAX ? ' ✓' : ''}</span>`;
    const sp = catSpread(list);
    if (n) {
      hint = `Includes ${sp.covered.length} of ${nonEmptyCats().length} categories.`;
      if (sp.missing.length) hint += ` Not yet included: ${sp.missing.map((c) => `<a href="#browse" class="link" data-act="browse-cat" data-cat="${esc(c.slug)}">${esc(c.name)}</a>`).join(', ')}.`;
      else hint += ' Lovely spread!';
    }
    if (n > FEAT_MAX) hint = `That’s ${n} — a little more than 15. ` + hint;
  }
  const title = key === 'hero' ? '★ Front page' : '♥ From the studio';
  main.innerHTML = `
    <div class="view-head">
      <h2>${title} ${counter}</h2>
      <p class="intro">${intro}</p>
      ${hint ? `<p class="hint">${hint}</p>` : ''}
    </div>
    ${feedbackCallout(key)}
    ${n ? sortableHTML(key) + `<p class="howto muted">Drag the <b>⠿</b> handle, or use the <b>↑ ↓</b> buttons, to change the order.</p>` :
      `<div class="empty"><p>Nothing here yet. Go to <b>All pieces</b> and tap <b>${key === 'hero' ? '★ Front page' : '♥ From the studio'}</b> under the pieces you love.</p></div>`}
    <p><a href="#browse" class="btn" data-view="browse">+ Add more pieces</a></p>`;
  initSortable($('.rows', main));
}

/* ---------- covers ---------- */
function renderCovers(main) {
  const cards = S.cats.map((c) => {
    const id = S.arr.covers[c.slug];
    const w = id ? work(id) : null;
    let warn = '';
    if (id && !w) warn = `<p class="warn-text">⚠ The chosen piece no longer exists (${esc(id)}). Please choose another.</p>`;
    else if (w && w.category !== c.slug) warn = `<p class="warn-text">⚠ “${esc(w.title)}” is from ${esc(catName(w.category))}, not ${esc(c.name)}. That’s allowed — just checking.</p>`;
    const img = w ? `<button type="button" class="cover-img" data-act="zoom" data-id="${esc(w.id)}" aria-label="See “${esc(w.title)}” large"><img src="${thumbUrl(w)}" alt="" loading="lazy"></button>`
      : `<div class="cover-img empty-img">${id ? '?' : (c.n ? 'No cover yet' : 'No pieces yet')}</div>`;
    return `<article class="cover-card${id ? '' : ' none'}" data-cat="${esc(c.slug)}">
      ${img}
      <div class="cover-body">
        <h3>${esc(c.name)}</h3>
        <p class="muted">${plural(c.n, 'piece')}${w ? ` · cover: <b>${esc(w.title)}</b>` : ''}</p>
        ${warn}
        <div class="cover-btns">
          <button type="button" class="btn${id ? '' : ' btn-primary'}" data-act="cover-pick" data-cat="${esc(c.slug)}">${id ? 'Change cover' : 'Choose cover'}</button>
          ${id ? `<button type="button" class="btn btn-quiet" data-act="cover-remove" data-cat="${esc(c.slug)}">Remove</button>` : ''}
        </div>
      </div>
    </article>`;
  }).join('');
  const unknown = Object.keys(S.arr.covers).filter((k) => !S.catBySlug.has(k));
  const c = counters().covers;
  main.innerHTML = `
    <div class="view-head">
      <h2>▣ Category covers <span class="count big ${c.ok ? 'ok' : 'warn'}">${c.text}${c.ok ? ' ✓' : ''}</span></h2>
      <p class="intro">Each category has a card on the website with one picture on it. Choose the piece that best shows what that category is about.</p>
    </div>
    ${feedbackCallout('covers')}
    <div class="cover-grid">${cards}</div>
    ${unknown.length ? `<p class="hint">Covers saved for categories that don’t exist any more: ${unknown.map((k) => `${esc(k)} <button type="button" class="btn btn-quiet" data-act="cover-remove" data-cat="${esc(k)}">Remove</button>`).join(' ')}</p>` : ''}`;
}
function openCoverPicker(cat) {
  const modal = $('#modal');
  let all = !(S.catBySlug.get(cat) || {}).n;
  S.modalRender = () => {
    const rank = (w) => (w.category === cat ? -1 : S.cats.findIndex((c) => c.slug === w.category));
    const items = all ? S.works.slice().sort((a, b) => rank(a) - rank(b) || byDefaultOrder(a, b)) : catWorks(cat);
    const cur = S.arr.covers[cat];
    modal.innerHTML = `<div class="sheet">
      <div class="sheet-head">
        <h2>Choose the cover for ${esc(catName(cat))}</h2>
        <button type="button" class="btn icon close" data-act="close-modal" aria-label="Close">✕</button>
      </div>
      <label class="switch"><input type="checkbox" id="picker-all" ${all ? 'checked' : ''}><span class="track" aria-hidden="true"></span>Show pieces from all categories</label>
      ${items.length ? '' : '<p class="empty">No pieces yet.</p>'}
      <div class="pick-grid">${items.map((w) => `
        <button type="button" class="pick${w.id === cur ? ' on' : ''}" data-act="cover-set" data-cat="${esc(cat)}" data-id="${esc(w.id)}">
          <img src="${thumbUrl(w)}" alt="" loading="lazy">
          <span>${esc(w.title)}${w.category !== cat ? `<em>${esc(catName(w.category))}</em>` : ''}</span>
          ${w.id === cur ? '<i class="pick-check">✓ Current cover</i>' : ''}
        </button>`).join('')}</div>
    </div>`;
    $('#picker-all', modal).addEventListener('change', (e) => { all = e.target.checked; S.modalRender(); });
  };
  S.modalRender();
  openOverlay(modal);
}

/* ---------- order within categories ---------- */
function renderOrder(main) {
  const cat = S.orderCat;
  const c = S.catBySlug.get(cat) || { slug: cat, name: cat, n: 0 };
  const pins = S.arr.order[cat] || [];
  const rest = catWorks(cat).filter((w) => !pins.includes(w.id));
  const chips = S.cats.map((x) => {
    const p = (S.arr.order[x.slug] || []).length;
    const fb = openFeedback('order:' + x.slug).length;
    return `<a href="#order/${esc(x.slug)}" class="chip${x.slug === cat ? ' on' : ''}" data-act="order-cat" data-cat="${esc(x.slug)}"${x.slug === cat ? ' aria-current="true"' : ''}>${esc(x.name)} <span class="n">${p ? `📌${p}` : x.n}</span>${fb ? `<span class="badge">💬 ${fb}</span>` : ''}</a>`;
  }).join('');
  const restHTML = rest.map((w) => `
    <article class="mini" data-id="${esc(w.id)}">
      <button type="button" class="mini-img" data-act="zoom" aria-label="See “${esc(w.title)}” large"><img src="${thumbUrl(w)}" alt="" loading="lazy"></button>
      <span class="mini-title">${esc(w.title)}</span>
      <button type="button" class="btn btn-pin" data-act="pin">📌 Pin to top</button>
    </article>`).join('');
  main.innerHTML = `
    <div class="view-head">
      <h2>📌 Order in categories</h2>
      <p class="intro">Choose which pieces people see <b>first</b> in each category. You only need to pick the ones that matter — everything else simply follows in its usual order.</p>
    </div>
    <div class="chips order-chips" role="group" aria-label="Category">${chips}</div>
    <h2 class="cat-title">${esc(c.name)} <span class="muted">${plural(c.n, 'piece')}</span></h2>
    ${feedbackCallout('order:' + cat)}
    ${c.n || pins.length ? `
      <h3 class="sub">Shown first, in this order</h3>
      ${pins.length ? sortableHTML('order:' + cat) + '<p class="howto muted">Drag the <b>⠿</b> handle or use <b>↑ ↓</b> to change the order.</p>' :
        `<div class="empty small"><p>Nothing pinned yet — so ${esc(c.name)} shows in its usual order. Tap <b>📌 Pin to top</b> on any piece below to bring it to the front.</p></div>`}
      <div class="divider" role="separator"><span>${pins.length ? `Everything below this line keeps its usual order` : 'The usual order'}${rest.length ? ` (${plural(rest.length, 'piece')})` : ''}</span></div>
      ${rest.length ? `<div class="mini-grid">${restHTML}</div>` : '<p class="muted center">Every piece in this category is pinned above.</p>'}
    ` : '<div class="empty"><p>There are no pieces in this category yet.</p></div>'}`;
  initSortable($('.rows', main));
}

/* ---------- review / overview ---------- */
function relTime(iso) {
  const t = Date.parse(iso);
  if (!t) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 2) return 'yesterday';
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
function commentHTML(f) {
  return `<div class="comment${f.resolved ? ' resolved' : ''}" data-cid="${esc(f.id)}">
    <div class="comment-head"><b>${esc(f.author || 'Someone')}</b> <span class="muted">${esc(relTime(f.at))}</span>${f.resolved ? ' <span class="done">✓ Done</span>' : ''}</div>
    <p>${esc(f.text).replace(/\n/g, '<br>')}</p>
    <div class="comment-btns">
      ${f.resolved ? '<button type="button" class="btn btn-quiet small" data-act="reopen">Reopen</button>'
        : '<button type="button" class="btn small btn-resolve" data-act="resolve">✓ Mark as done</button>'}
      <button type="button" class="btn btn-quiet small" data-act="delete-comment">Delete</button>
    </div>
  </div>`;
}
function commentsBlock(section, label, collapsed) {
  const all = S.arr.feedback.filter((f) => f.section === section);
  const open = all.filter((f) => !f.resolved), done = all.filter((f) => f.resolved);
  const form = `<form class="comment-form" data-section="${esc(section)}">
      <label class="sr" for="cf-${esc(section)}">Comment on ${esc(label)}</label>
      <textarea id="cf-${esc(section)}" name="text" rows="2" placeholder="Leave a comment about ${esc(label)}…"></textarea>
      <button type="submit" class="btn btn-primary">Post comment</button>
    </form>`;
  const inner = `${open.map(commentHTML).join('')}
    ${done.length ? `<details class="resolved-list"><summary>${plural(done.length, 'comment')} marked done</summary>${done.map(commentHTML).join('')}</details>` : ''}
    ${form}`;
  if (collapsed && !open.length) {
    return `<details class="comments compact"><summary>💬 Comment on ${esc(label)}${done.length ? ` <span class="muted">(${done.length} done)</span>` : ''}</summary>${inner}</details>`;
  }
  return `<div class="comments">${inner}</div>`;
}
function tileHTML(id, i, opts = {}) {
  const w = work(id);
  if (!w) return `<figure class="tile missing"><div class="tile-img">?</div><figcaption>${i != null ? `<span class="num">${i + 1}</span>` : ''}Missing piece <span class="muted">(${esc(id)})</span></figcaption></figure>`;
  return `<figure class="tile${opts.dim ? ' dim' : ''}" data-id="${esc(w.id)}">
    <button type="button" class="tile-img" data-act="zoom" aria-label="See “${esc(w.title)}” large"><img src="${thumbUrl(w)}" alt="" loading="lazy"></button>
    <figcaption>${i != null ? `<span class="num">${i + 1}</span>` : ''}${esc(w.title)}${opts.cat ? `<span class="muted"> · ${esc(catName(w.category))}</span>` : ''}</figcaption>
  </figure>`;
}
function renderReviewStamp() {
  const el = $('#review-stamp');
  if (el) el.textContent = S.base ? `Last saved ${relTime(S.base)} (${new Date(S.base).toLocaleString()})` : 'Not saved yet';
}
function renderReview(main) {
  // Keep any half-written comments across re-renders.
  const drafts = {};
  for (const ta of $$('.comment-form textarea', main)) if (ta.value) drafts[ta.id] = ta.value;
  const openDetails = $$('details.comments[open]', main).map((d) => d.querySelector('textarea') && d.querySelector('textarea').id);
  const author = lsGet(LS.author) || '';
  const sp = catSpread(S.arr.featured);
  const c = counters();
  const coverTiles = S.cats.map((cat) => {
    const id = S.arr.covers[cat.slug];
    const w = id ? work(id) : null;
    const warn = id && !w ? '⚠ missing piece' : (w && w.category !== cat.slug ? `⚠ from ${esc(catName(w.category))}` : '');
    return `<figure class="tile cover-tile${id ? '' : ' none'}">
      ${w ? `<button type="button" class="tile-img" data-act="zoom" data-id="${esc(w.id)}" aria-label="See “${esc(w.title)}” large"><img src="${thumbUrl(w)}" alt="" loading="lazy"></button>` : `<div class="tile-img">${cat.n ? 'No cover yet' : 'No pieces yet'}</div>`}
      <figcaption><b>${esc(cat.name)}</b><br><span class="muted">${w ? esc(w.title) : '—'}</span>${warn ? `<br><span class="warn-text">${warn}</span>` : ''}</figcaption>
    </figure>`;
  }).join('');
  const orderRows = S.cats.map((cat) => {
    const pins = S.arr.order[cat.slug] || [];
    if (!cat.n && !pins.length) return `<div class="order-row empty-cat"><h4>${esc(cat.name)}</h4><span class="muted">No pieces yet</span></div>`;
    const rest = catWorks(cat.slug).filter((w) => !pins.includes(w.id));
    return `<div class="order-row">
      <h4>${esc(cat.name)} <span class="muted">${pins.length ? `${pins.length} chosen first, then ${rest.length} in the usual order` : `usual order (${plural(rest.length, 'piece')})`}</span></h4>
      <div class="strip">
        ${pins.map((id, i) => tileHTML(id, i)).join('')}
        ${pins.length ? '<div class="strip-line" aria-hidden="true"></div>' : ''}
        ${rest.slice(0, pins.length ? 3 : 5).map((w, i) => tileHTML(w.id, pins.length + i, { dim: true })).join('')}
        ${rest.length > (pins.length ? 3 : 5) ? `<div class="more">+${rest.length - (pins.length ? 3 : 5)} more</div>` : ''}
      </div>
      ${commentsBlock('order:' + cat.slug, `the order of ${cat.name}`, true)}
    </div>`;
  }).join('');
  main.innerHTML = `
    <div class="review">
      <div class="view-head">
        <h2>Overview</h2>
        <p class="intro">Everything chosen so far, on one page. Have a look and leave a comment under any section — Naava will see it and can mark it as done.</p>
        <p class="muted" id="review-stamp"></p>
        <label class="author">Your name <input id="author" type="text" value="${esc(author)}" placeholder="e.g. David" autocomplete="name"></label>
      </div>

      <section class="rv">
        <div class="rv-head"><h3>★ Front page</h3><span class="count ${c.hero.ok ? 'ok' : 'warn'}">${c.hero.text}${c.hero.ok ? ' ✓' : ''}</span><a class="link edit" href="#hero" data-view="hero">Edit</a></div>
        <div class="tiles hero-tiles">${S.arr.hero.length ? S.arr.hero.map((id, i) => tileHTML(id, i, { cat: true })).join('') : '<p class="muted">Nothing chosen yet.</p>'}</div>
        ${commentsBlock('hero', 'the front page')}
      </section>

      <section class="rv">
        <div class="rv-head"><h3>♥ From the studio</h3><span class="count ${c.featured.ok ? 'ok' : 'warn'}">${c.featured.text} · aim for 10–15${c.featured.ok ? ' ✓' : ''}</span><a class="link edit" href="#featured" data-view="featured">Edit</a></div>
        <p class="muted">Includes ${sp.covered.length} of ${nonEmptyCats().length} categories${sp.missing.length ? ` — not yet: ${sp.missing.map((x) => esc(x.name)).join(', ')}` : ''}.</p>
        <div class="tiles">${S.arr.featured.length ? S.arr.featured.map((id, i) => tileHTML(id, i, { cat: true })).join('') : '<p class="muted">Nothing chosen yet.</p>'}</div>
        ${commentsBlock('featured', '“From the studio”')}
      </section>

      <section class="rv">
        <div class="rv-head"><h3>▣ Category covers</h3><span class="count ${c.covers.ok ? 'ok' : 'warn'}">${c.covers.text}${c.covers.ok ? ' ✓' : ''}</span><a class="link edit" href="#covers" data-view="covers">Edit</a></div>
        <div class="tiles">${coverTiles}</div>
        ${commentsBlock('covers', 'the category covers')}
      </section>

      <section class="rv">
        <div class="rv-head"><h3>📌 Order in each category</h3><a class="link edit" href="#order" data-view="order">Edit</a></div>
        <p class="muted">Numbered pieces were chosen to come first; faded ones follow in the usual order.</p>
        ${orderRows}
      </section>

      <section class="rv">
        <div class="rv-head"><h3>💬 General comments</h3></div>
        ${commentsBlock('general', 'anything else')}
      </section>
    </div>`;
  for (const [id, v] of Object.entries(drafts)) { const ta = document.getElementById(id); if (ta) { ta.value = v; const d = ta.closest('details'); if (d) d.open = true; } }
  for (const id of openDetails) { const d = id && document.getElementById(id) && document.getElementById(id).closest('details'); if (d) d.open = true; }
  renderReviewStamp();
}

/* ---------- lightbox ---------- */
function openLightbox(id) {
  // Navigate within whatever is on screen right now.
  const ids = $$('#main [data-id]').map((e) => e.dataset.id).filter((x, i, a) => work(x) && a.indexOf(x) === i);
  S.lbList = ids.length ? ids : [id];
  S.lbId = id;
  S.lbReturn = document.activeElement;
  renderLightbox();
  openOverlay($('#lightbox'));
}
function renderLightbox() {
  const w = work(S.lbId);
  const lb = $('#lightbox');
  if (!w) { closeOverlay(lb); return; }
  const i = S.lbList.indexOf(w.id), n = S.lbList.length;
  lb.innerHTML = `<div class="lb" data-id="${esc(w.id)}">
    <button type="button" class="btn icon close lb-close" data-act="close-lb" aria-label="Close">✕</button>
    <div class="lb-stage">
      ${n > 1 ? '<button type="button" class="lb-nav prev" data-act="lb-prev" aria-label="Previous piece">‹</button>' : ''}
      <img src="${fullUrl(w)}" alt="${esc(w.title)}" style="background-image:url('${thumbUrl(w)}')">
      ${n > 1 ? '<button type="button" class="lb-nav next" data-act="lb-next" aria-label="Next piece">›</button>' : ''}
    </div>
    <div class="lb-info">
      <div><h2>${esc(w.title)}</h2><p class="muted">${esc([catName(w.category), w.occasion].filter(Boolean).join(' · '))}${n > 1 ? ` · ${i + 1} of ${n}` : ''}</p></div>
      <div class="tags">${tagButtons(w)}</div>
    </div>
  </div>`;
}
function lbStep(d) {
  const n = S.lbList.length;
  const i = S.lbList.indexOf(S.lbId);
  S.lbId = S.lbList[(i + d + n) % n];
  renderLightbox();
}

/* ---------- overlays ---------- */
function openOverlay(el) {
  el.hidden = false;
  document.body.classList.add('noscroll');
  const f = el.querySelector('.close');
  if (f) f.focus();
}
function closeOverlay(el) {
  el.hidden = true;
  el.innerHTML = '';
  if (el.id === 'modal') S.modalRender = null;
  if ($('#lightbox').hidden && $('#modal').hidden) document.body.classList.remove('noscroll');
  if (el.id === 'lightbox' && S.lbReturn && document.contains(S.lbReturn)) S.lbReturn.focus({ preventScroll: true });
}

/* ---------- toast ---------- */
let toastTimer;
function toast(msg, withUndo, ms = 6000) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${withUndo ? '<button type="button" class="btn small" data-act="undo">↶ Undo</button>' : ''}`;
  t.hidden = false;
  t.classList.remove('show');
  void t.offsetWidth;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove('show'); setTimeout(() => { t.hidden = true; }, 300); }, ms);
}

/* ---------- drag to reorder (pointer events: mouse, touch, pen) ---------- */
function initSortable(listEl) {
  if (!listEl) return;
  listEl.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.handle');
    if (!handle || e.button > 0) return;
    const row = handle.closest('.row');
    const key = listEl.dataset.list;
    const rows = $$('.row', listEl);
    const from = rows.indexOf(row);
    if (from < 0 || rows.length < 2) return;
    e.preventDefault();
    const rect = row.getBoundingClientRect();
    const offY = e.clientY - rect.top;
    const ph = document.createElement('li');
    ph.className = 'row placeholder';
    ph.style.height = rect.height + 'px';
    row.after(ph);
    Object.assign(row.style, { width: rect.width + 'px', left: rect.left + 'px', top: rect.top + 'px' });
    row.classList.add('dragging');
    let lastY = e.clientY, raf = 0, done = false;
    const place = () => {
      row.style.top = (lastY - offY) + 'px';
      const others = $$('.row:not(.dragging):not(.placeholder)', listEl);
      let before = null;
      for (const o of others) {
        const r = o.getBoundingClientRect();
        if (lastY < r.top + r.height / 2) { before = o; break; }
      }
      if (before) { if (ph.nextSibling !== before) listEl.insertBefore(ph, before); }
      else if (listEl.lastElementChild !== ph) listEl.appendChild(ph);
    };
    const tick = () => {
      if (done) return;
      const edge = 70, vh = window.innerHeight;
      if (lastY < edge) window.scrollBy(0, -Math.ceil((edge - lastY) / 4));
      else if (lastY > vh - edge) window.scrollBy(0, Math.ceil((lastY - (vh - edge)) / 4));
      place();
      raf = requestAnimationFrame(tick);
    };
    const move = (ev) => { lastY = ev.clientY; };
    const end = () => {
      done = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      const order = Array.from(listEl.children).filter((x) => x !== row);
      const to = order.indexOf(ph);
      row.classList.remove('dragging');
      row.removeAttribute('style');
      ph.remove();
      if (to >= 0 && to !== from) moveItem(key, from, to);
      else render();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    raf = requestAnimationFrame(tick);
  });
}

/* ---------- events ---------- */
document.addEventListener('click', (e) => {
  const nav = e.target.closest('a[data-view], button[data-view]');
  if (nav && !e.target.closest('[data-act]') && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    go(nav.dataset.view);
    return;
  }
  const el = e.target.closest('[data-act]');
  if (!el) {
    if (e.target.classList.contains('overlay')) closeOverlay(e.target);
    return;
  }
  const a = el.dataset.act;
  const holder = el.closest('[data-id]');
  const id = el.dataset.id || (holder && holder.dataset.id);
  const listEl = el.closest('[data-list]');
  const cid = (el.closest('[data-cid]') || {}).dataset;
  switch (a) {
    case 'hero': case 'featured': toggleIn(a, id); break;
    case 'cover': toggleCover(id); break;
    case 'pin': togglePin(id); break;
    case 'zoom': openLightbox(id); break;
    case 'undo': undo(); break;
    case 'save-now': if (S.serverOk) { S.fatalSaveError = null; S.retryMs = 0; save(); } break;
    case 'up': case 'down': {
      const key = listEl.dataset.list;
      const i = getList(key).indexOf(id);
      const j = a === 'up' ? i - 1 : i + 1;
      const rowSel = `[data-list="${key}"] [data-id="${id}"]`;
      S.focusAfter = [`${rowSel} [data-act="${a}"]:not([disabled])`, `${rowSel} [data-act="${a === 'up' ? 'down' : 'up'}"]`];
      moveItem(key, i, j);
      S.focusAfter = null;
      break;
    }
    case 'remove': removeFromList(listEl.dataset.list, id); break;
    case 'cover-pick': openCoverPicker(el.dataset.cat); break;
    case 'cover-remove': removeCover(el.dataset.cat); break;
    case 'cover-set': setCover(el.dataset.cat, el.dataset.id); closeOverlay($('#modal')); break;
    case 'close-modal': closeOverlay($('#modal')); break;
    case 'close-lb': closeOverlay($('#lightbox')); break;
    case 'lb-prev': lbStep(-1); break;
    case 'lb-next': lbStep(1); break;
    case 'filter-cat': S.filters.cat = el.dataset.cat; render(); break;
    case 'browse-cat': e.preventDefault(); S.filters = { cat: el.dataset.cat, q: '', placed: false }; go('browse'); break;
    case 'clear-filters': S.filters = { cat: 'all', q: '', placed: false }; render(); break;
    case 'order-cat': e.preventDefault(); S.orderCat = el.dataset.cat; history.replaceState(null, '', '#order/' + S.orderCat); render(); break;
    case 'hide-help': lsSet(LS.help, '1'); S.gridKey = null; render(); break;
    case 'resolve': setResolved(cid.cid, true); break;
    case 'reopen': setResolved(cid.cid, false); break;
    case 'delete-comment': if (confirm('Delete this comment?')) deleteComment(cid.cid); break;
    default: return;
  }
});

document.addEventListener('submit', (e) => {
  const form = e.target.closest('.comment-form');
  if (!form) return;
  e.preventDefault();
  const ta = form.querySelector('textarea');
  const text = ta.value.trim();
  if (!text) { ta.focus(); return; }
  const authorEl = $('#author');
  let author = (authorEl && authorEl.value.trim()) || lsGet(LS.author) || '';
  if (!author) {
    author = (prompt('What’s your name? (so Naava knows who wrote this)') || '').trim();
    if (!author) return;
    if (authorEl) authorEl.value = author;
  }
  lsSet(LS.author, author);
  ta.value = '';
  addComment(form.dataset.section, author, text);
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'search') {
    S.filters.q = e.target.value;
    clearTimeout(S.searchTimer);
    S.searchTimer = setTimeout(render, 150);
  } else if (e.target.id === 'author') {
    lsSet(LS.author, e.target.value.trim());
  }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'placed-only') { S.filters.placed = e.target.checked; render(); }
});

document.addEventListener('keydown', (e) => {
  const inField = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || '')) || e.target.isContentEditable;
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !inField) {
    e.preventDefault(); undo(); return;
  }
  const lb = $('#lightbox'), modal = $('#modal');
  if (e.key === 'Escape') {
    if (!modal.hidden) closeOverlay(modal);
    else if (!lb.hidden) closeOverlay(lb);
    return;
  }
  if (!lb.hidden && !inField) {
    if (e.key === 'ArrowLeft') lbStep(-1);
    else if (e.key === 'ArrowRight') lbStep(1);
  }
});

window.addEventListener('online', () => { if (isDirty()) save(); });

window.addEventListener('beforeunload', (e) => {
  if (S.serverOk && (isDirty() || S.saving)) { e.preventDefault(); e.returnValue = ''; }
});

load().catch((err) => {
  console.error(err);
  $('#main').innerHTML = `<div class="empty"><p>Sorry — the pieces couldn’t be loaded. Is the server window still open?</p><p class="muted">${esc(err && err.message)}</p><button type="button" class="btn btn-primary" onclick="location.reload()">Try again</button></div>`;
});
