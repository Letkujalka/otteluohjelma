'use strict';
/* Otteluohjelma – suosikkijoukkueiden pelit ja palvelut, joista ne näkee.
   Pelit tulevat tiedostosta games.json, jonka GitHub Actions päivittää
   kahden tunnin välein. Siinä ovat kategorioiden (UCL, LaLiga, Liiga,
   maajoukkueet) kaikki pelit; tässä ne suodatetaan suosikkien mukaan.
   Omat asetukset tallennetaan selaimen localStorageen (avain KEY). */

const APP_VERSION = '5';
const KEY = 'otteluohjelma.v2';
const OLD_KEY = 'otteluohjelma.v1';
const TZ = 'Europe/Helsinki';
const REFRESH_MIN = 10;

let CFG = null;          // config.json
let DATA = null;         // games.json
let loadError = '';
let S = loadState();

// favs: suosikkijoukkueet (yhteinen kaikille kategorioille; null = config.json:n oletukset).
// all: kategoriakohtainen "näytä kaikki ottelut"; puuttuva = config.json:n oletus.
function loadState() {
  const base = { favs: null, all: {}, services: {}, tab: 'today' };
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && typeof s === 'object') return { ...base, ...s };
    const old = JSON.parse(localStorage.getItem(OLD_KEY));   // versio 1–2: palvelut ja välilehti talteen
    if (old && typeof old === 'object') {
      return { ...base, tab: old.tab || 'today',
        services: Object.fromEntries(Object.entries(old.services || {}).filter(([k]) => !k.includes('/'))) };
    }
  } catch (e) { /* tyhjä tai rikki */ }
  return base;
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ei tallennustilaa */ }
}

/* ---------- apufunktiot ---------- */

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dayFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('fi-FI', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const longDayFmt = new Intl.DateTimeFormat('fi-FI', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'numeric' });
const dayKey = d => dayFmt.format(new Date(d));            // "2026-11-17" Suomen aikaa
const addDays = (key, n) => {
  const d = new Date(key + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const fmtTime = d => timeFmt.format(new Date(d)).replace('.', ':');
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

function dayLabel(key) {
  const today = dayKey(Date.now());
  if (key === today) return 'Tänään';
  if (key === addDays(today, 1)) return 'Huomenna';
  if (key === addDays(today, -1)) return 'Eilen';
  return cap(longDayFmt.format(new Date(key + 'T12:00:00Z')));
}

function ago(iso) {
  const min = Math.round((Date.now() - new Date(iso)) / 60000);
  if (min < 1) return 'juuri nyt';
  if (min < 60) return `${min} min sitten`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h sitten`;
  return `${dayLabel(dayKey(iso)).toLowerCase()} klo ${fmtTime(iso)}`;
}

const compById = id => CFG.competitions.find(c => c.id === id);
const catById = id => CFG.categories.find(c => c.id === id);
const defaultFavs = () => [...new Set(CFG.categories.flatMap(c => c.defaults))];
const favList = () => Array.isArray(S.favs) ? S.favs : defaultFavs();
const favSet = () => new Set(favList());
const showAll = cat => cat in S.all ? S.all[cat] : !!catById(cat)?.all;

// Joukkueen oma palvelu config.json:ssa (esim. Suomen maajoukkueet Ylellä) >
// oma sarjakohtainen valinta > sarjan oletus.
function serviceOf(g) {
  const compDefault = compById(g.comp)?.service;
  if (g.service && g.service !== compDefault) return g.service;
  return S.services[g.comp] || g.service || compDefault || '?';
}
const svcInfo = name => (CFG.services && CFG.services[name]) || { url: '', color: '#59616e' };
const svcLabel = name => name === '?' ? 'Ei tiedossa' : (svcInfo(name).label || name);

// Peli näkyy, jos siinä on suosikki (mistä tahansa kategoriasta) tai
// kategorian kaikki ottelut on valittu näkyviin (oletuksena Mestarien liiga).
function visibleGames() {
  if (!DATA || !DATA.games) return [];
  const favs = favSet();
  return DATA.games.filter(g => g.cat && (showAll(g.cat) || favs.has(g.home) || favs.has(g.away)));
}

/* ---------- näkymät ---------- */

const TABS = [
  ['today', 'Tänään'],
  ['tomorrow', 'Huomenna'],
  ['week', 'Viikko'],
  ['later', 'Myöhemmin'],
];
const tabIndex = id => Math.max(0, TABS.findIndex(t => t[0] === id));

function gamesForTab(tab, games) {
  const today = dayKey(Date.now());
  const k = g => dayKey(g.start);
  switch (tab) {
    // Tänään-välilehdellä näkyvät myös yön yli jatkuvat käynnissä olevat pelit.
    case 'today': return games.filter(g => k(g) === today || g.state === 'in');
    case 'tomorrow': return games.filter(g => k(g) === addDays(today, 1));
    case 'week': return games.filter(g => k(g) >= today && k(g) <= addDays(today, 6));
    case 'later': return games.filter(g => k(g) > addDays(today, 6));
  }
  return [];
}

function gameCard(g, favs) {
  const svc = serviceOf(g);
  const info = svcInfo(svc);
  const team = (name, score) => `<div class="team${favs.has(name) ? ' fav' : ''}"><span>${esc(name)}</span>${score != null && !Number.isNaN(score) ? `<b>${score}</b>` : ''}</div>`;
  let when;
  if (g.state === 'in') when = `<span class="live">● LIVE</span>${g.detail ? ` <small>${esc(g.detail)}</small>` : ''}`;
  else if (g.state === 'post') when = `<span class="muted">Päättynyt</span>`;
  else when = `<span class="time">${fmtTime(g.start)}</span>`;
  const svcTag = info.url
    ? `<a class="svc" style="--svc:${info.color}" href="${esc(info.url)}" target="_blank" rel="noopener">▶ ${esc(svcLabel(svc))}</a>`
    : `<span class="svc" style="--svc:${info.color}">${svc === '?' ? 'Palvelu ei tiedossa' : esc(svcLabel(svc))}</span>`;
  // Muut kuin suosikkien pelit (esim. UCL:n kaikki ottelut) tiiviinä rivinä.
  if (!favs.has(g.home) && !favs.has(g.away)) {
    const score = g.state !== 'pre' && g.homeScore != null && !Number.isNaN(g.homeScore) ? ` <b>${g.homeScore}–${g.awayScore}</b>` : '';
    const t = g.state === 'in' ? '<span class="live">LIVE</span>' : g.state === 'post' ? '<span class="muted">Loppu</span>' : fmtTime(g.start);
    return `<div class="card game other ${g.state}">
      <span class="o-time">${t}</span>
      <span class="o-teams">${esc(g.home)} – ${esc(g.away)}${score}<small>${esc(g.compName)}${g.round ? ' · ' + esc(g.round) : ''}</small></span>
      ${info.url ? `<a class="svc mini" style="--svc:${info.color}" href="${esc(info.url)}" target="_blank" rel="noopener" title="${esc(svcLabel(svc))}">▶</a>` : ''}
    </div>`;
  }
  return `<div class="card game ${g.state}">
    <div class="g-head">${when}<span class="comp">${g.cat === 'liiga' ? '🏒' : '⚽'} ${esc(g.compName)}${g.round ? ' · ' + esc(g.round) : ''}</span></div>
    <div class="teams">${team(g.home, g.homeScore)}${team(g.away, g.awayScore)}</div>
    <div class="g-foot">${svcTag}<button class="linkbtn" data-act="svc" data-id="${esc(g.id)}">Vaihda</button></div>
  </div>`;
}

function dayGroups(games, favs) {
  const groups = new Map();
  for (const g of games) {
    const k = dayKey(g.start);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(g);
  }
  return [...groups].map(([k, list]) => `<h2 class="day">${dayLabel(k)}</h2>${list.map(g => gameCard(g, favs)).join('')}`).join('');
}

function tabsHtml() {
  const all = visibleGames();
  return TABS.map(([id, label]) => {
    const n = DATA ? gamesForTab(id, all).length : 0;
    return `<button class="tab${S.tab === id ? ' sel' : ''}" data-act="tab" data-id="${id}">${label}${n ? `<span class="count">${n}</span>` : ''}</button>`;
  }).join('');
}

// Yhden välilehden sisältö (pyyhkäisyssä vaihdetaan vain tämä).
function pageHtml(tab) {
  if (!DATA) {
    return loadError
      ? `<div class="card warn"><p>Otteluohjelmaa ei saatu ladattua.</p><p class="muted">${esc(loadError)}</p></div>`
      : `<p class="hint">Ladataan…</p>`;
  }
  const favs = favSet();
  const all = visibleGames();
  const list = gamesForTab(tab, all);
  let h = '';
  if (!list.length) {
    const today = dayKey(Date.now());
    const last = tab === 'today' ? today : tab === 'tomorrow' ? addDays(today, 1) : addDays(today, 6);
    const next = tab === 'later' ? null : all.find(g => dayKey(g.start) > last);
    h += `<div class="card empty"><p>${tab === 'today' ? 'Ei suosikkien pelejä tänään.' : tab === 'tomorrow' ? 'Ei suosikkien pelejä huomenna.' : 'Ei pelejä tällä aikavälillä.'}</p>
      ${next ? `<p class="muted">Seuraava: ${esc(next.home)} – ${esc(next.away)}, ${dayLabel(dayKey(next.start)).toLowerCase()} klo ${fmtTime(next.start)}</p>` : ''}</div>`;
  } else if (tab === 'today' || tab === 'tomorrow') {
    h += list.map(g => gameCard(g, favs)).join('');
  } else {
    h += dayGroups(list, favs);
  }
  // Eilisen tulokset Tänään-välilehden loppuun.
  if (tab === 'today') {
    const y = addDays(dayKey(Date.now()), -1);
    const past = all.filter(g => dayKey(g.start) === y && g.state === 'post');
    if (past.length) h += `<details class="past"><summary>Eilisen tulokset (${past.length})</summary>${past.map(g => gameCard(g, favs)).join('')}</details>`;
  }
  h += `<p class="ver">Päivitetty ${ago(DATA.updated)} · pyyhkäise vaihtaaksesi päivää<br>Versio ${APP_VERSION}</p>`;
  return h;
}

function viewHome() {
  return `<header class="top"><h1>Otteluohjelma</h1>
    <button class="menu" data-act="refresh" title="Päivitä" aria-label="Päivitä">⟳</button>
    <a class="menu" href="#/asetukset" title="Asetukset" aria-label="Asetukset">⚙</a></header>
    <nav class="tabs" id="tabs">${tabsHtml()}</nav>
    <div id="pager"><div id="page">${pageHtml(S.tab)}</div></div>`;
}

function catTeams(cat) {
  const set = new Set([...(DATA?.teams?.[cat.id] || []), ...cat.defaults]);
  return [...set].sort((a, b) => a.localeCompare(b, 'fi'));
}

function viewSettings() {
  let h = `<header class="top"><a class="back" href="#/">‹</a><h1>Asetukset</h1></header>
    <p class="hint">Valitse suosikit kategorioittain. Suosikin kaikki pelit näkyvät, myös muiden kategorioiden sarjoissa (esim. Real Madridin UCL-pelit).</p>`;
  const fs = favSet();
  for (const cat of CFG.categories) {
    const teams = catTeams(cat);
    const favs = teams.filter(t => fs.has(t));
    const open = S.openCat === cat.id;
    h += `<details class="card cat"${open ? ' open' : ''} data-cat="${cat.id}">
      <summary><span class="cat-name">${cat.sport === 'hockey' ? '🏒' : '⚽'} ${esc(cat.name)}</span>
        <small>${showAll(cat.id) ? 'kaikki ottelut' : favs.length ? esc(favs.join(', ')) : 'ei suosikkeja'}</small></summary>
      <button class="opt all${showAll(cat.id) ? ' sel' : ''}" data-act="catall" data-cat="${cat.id}">
        <span class="mark check"></span>Näytä kaikki ottelut</button>
      ${teams.length > 14 ? `<input class="search" type="search" placeholder="Hae joukkuetta" data-cat="${cat.id}">` : ''}
      <div class="teamlist">${teams.map(t => `<button class="opt${favs.includes(t) ? ' sel' : ''}" data-act="fav" data-cat="${cat.id}" data-name="${esc(t)}">
        <span class="mark check"></span>${esc(t)}</button>`).join('')}</div>
    </details>`;
  }
  if (Array.isArray(S.favs)) h += `<button class="btn block" data-act="favreset">Palauta oletussuosikit</button>`;

  const names = Object.keys(CFG.services);
  const sel = (key, def) => `<select data-act="svcset" data-key="${esc(key)}">
    ${names.map(n => `<option value="${esc(n)}"${(S.services[key] || def) === n ? ' selected' : ''}>${esc(svcLabel(n))}</option>`).join('')}</select>`;
  h += `<details class="card cat"${S.openCat === 'svc' ? ' open' : ''} data-cat="svc"><summary><span class="cat-name">📺 Missä sarjat näkyvät</span></summary>
    <p class="hint">Oletukset ovat kauden 2026–27 oikeuksien mukaiset. Suomen maajoukkueet näkyvät aina Ylellä.</p>
    ${CFG.competitions.map(c => `<label>${esc(c.name)}${sel(c.id, c.service)}</label>`).join('')}
    ${Object.keys(S.services).length ? `<button class="btn block danger" data-act="svcreset">Palauta palvelujen oletukset</button>` : ''}</details>`;
  h += `<p class="hint">Pelit haetaan ESPN:n ja UEFA:n otteluohjelmista (jalkapallo) ja liiga.fi:stä (Liiga) kahden tunnin välein. Palvelu päätellään sarjasta: tarkista epävarmat (esim. maaottelut) palvelusta itsestään.</p>
    ${DATA && DATA.failed && DATA.failed.length ? `<p class="hint">Viimeisimmässä haussa ei saatu: ${DATA.failed.map(id => esc(compById(id)?.name || id)).join(', ')} (näille näytetään edelliset tiedot).</p>` : ''}
    <p class="ver">Versio ${APP_VERSION}</p>`;
  return h;
}

/* ---------- reititys ja piirto ---------- */

const VIEWS = { '/': viewHome, '/asetukset': viewSettings };
const curPath = () => location.hash.replace(/^#/, '') || '/';

function render() {
  const app = document.getElementById('app');
  if (!CFG) { app.innerHTML = loadError ? `<div class="card warn"><p>${esc(loadError)}</p></div>` : '<p class="hint">Ladataan…</p>'; return; }
  // Asetuksissa haku- ja vierityskohta säilyvät uudelleenpiirrossa.
  const search = [...document.querySelectorAll('input.search')].map(i => [i.dataset.cat, i.value]);
  const y = window.scrollY;
  app.innerHTML = (VIEWS[curPath()] || viewHome)();
  for (const [cat, v] of search) {
    const inp = document.querySelector(`input.search[data-cat="${cat}"]`);
    if (inp && v) { inp.value = v; filterTeams(inp); }
  }
  if (curPath() === '/asetukset') window.scrollTo(0, y);
}
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

// Vain välilehdet ja sivun sisältö (pyyhkäisy ja välilehden vaihto).
function renderPage() {
  const page = document.getElementById('page');
  const tabs = document.getElementById('tabs');
  if (!page || !tabs) return render();
  tabs.innerHTML = tabsHtml();
  page.innerHTML = pageHtml(S.tab);
}

function filterTeams(inp) {
  const q = inp.value.trim().toLowerCase();
  inp.parentElement.querySelectorAll('.teamlist .opt').forEach(b => {
    b.style.display = !q || b.dataset.name.toLowerCase().includes(q) ? '' : 'none';
  });
}

/* ---------- pyyhkäisy välilehtien välillä ---------- */

const SWIPE_MS = 200;
let swipe = null;
let animating = false;

function goTab(dir) {
  const i = tabIndex(S.tab) + dir;
  if (i < 0 || i >= TABS.length || animating) return false;
  const page = document.getElementById('page');
  S.tab = TABS[i][0]; save();
  if (!page || matchMedia('(prefers-reduced-motion: reduce)').matches) { renderPage(); window.scrollTo(0, 0); return true; }
  animating = true;
  page.style.transition = `transform ${SWIPE_MS}ms ease-in, opacity ${SWIPE_MS}ms`;
  page.style.transform = `translateX(${-dir * 100}%)`;
  page.style.opacity = '0';
  setTimeout(() => {
    renderPage();
    window.scrollTo(0, 0);
    page.style.transition = 'none';
    page.style.transform = `translateX(${dir * 100}%)`;
    page.offsetWidth; // pakotetaan uusi lähtöasema ennen animaatiota
    page.style.transition = `transform ${SWIPE_MS}ms ease-out, opacity ${SWIPE_MS}ms`;
    page.style.transform = '';
    page.style.opacity = '';
    setTimeout(() => { animating = false; page.style.transition = ''; }, SWIPE_MS);
  }, SWIPE_MS);
  return true;
}

document.addEventListener('touchstart', e => {
  if (curPath() !== '/' || animating || e.touches.length !== 1 || !e.target.closest('#pager')) { swipe = null; return; }
  const t = e.touches[0];
  swipe = { x: t.clientX, y: t.clientY, t: Date.now(), dx: 0, lock: null };
}, { passive: true });

document.addEventListener('touchmove', e => {
  if (!swipe) return;
  const t = e.touches[0];
  const dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
  if (!swipe.lock && Math.hypot(dx, dy) > 10) swipe.lock = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
  if (swipe.lock !== 'x') return;
  e.preventDefault();
  const i = tabIndex(S.tab);
  const edge = (dx > 0 && i === 0) || (dx < 0 && i === TABS.length - 1);
  swipe.dx = edge ? dx / 4 : dx;   // reunalla jousto
  const page = document.getElementById('page');
  page.style.transition = 'none';
  page.style.transform = `translateX(${swipe.dx}px)`;
}, { passive: false });

document.addEventListener('touchend', () => {
  if (!swipe || swipe.lock !== 'x') { swipe = null; return; }
  const { dx, t } = swipe;
  swipe = null;
  const page = document.getElementById('page');
  const fast = Math.abs(dx) > 40 && Date.now() - t < 250;
  if ((Math.abs(dx) > window.innerWidth * 0.22 || fast) && goTab(dx < 0 ? 1 : -1)) return;
  page.style.transition = `transform ${SWIPE_MS}ms ease-out`;
  page.style.transform = '';
});

document.addEventListener('keydown', e => {
  if (curPath() !== '/' || e.target.closest('input, select')) return;
  if (e.key === 'ArrowRight') goTab(1);
  if (e.key === 'ArrowLeft') goTab(-1);
});

/* ---------- lataus ---------- */

async function load(force) {
  const btn = document.querySelector('[data-act="refresh"]');
  if (btn) btn.classList.add('spin');
  try {
    const opts = { cache: force ? 'reload' : 'no-cache' };
    const [c, d] = await Promise.all([
      fetch('config.json', opts).then(r => { if (!r.ok) throw new Error('config.json: ' + r.status); return r.json(); }),
      fetch('games.json', opts).then(r => { if (!r.ok) throw new Error('games.json: ' + r.status); return r.json(); }),
    ]);
    CFG = c; DATA = d; loadError = '';
  } catch (e) {
    if (!DATA) loadError = navigator.onLine === false ? 'Ei verkkoyhteyttä.' : String(e.message || e);
  }
  if (!animating && !swipe) render();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') load();
});
setInterval(() => { if (document.visibilityState === 'visible') load(); }, REFRESH_MIN * 60000);
// Kellonajat ja LIVE-tilat ajan tasalle (vain etusivulla, ei kesken pyyhkäisyä).
setInterval(() => {
  if (curPath() === '/' && !animating && !swipe && modalEl.classList.contains('hidden')) renderPage();
}, 60000);

/* ---------- modaali ---------- */

const modalEl = document.getElementById('modal');
let modalCtx = {};
function openModal(html, ctx = {}) {
  modalCtx = ctx;
  modalEl.querySelector('.sheet').innerHTML = html;
  modalEl.classList.remove('hidden');
}
function closeModal() { modalEl.classList.add('hidden'); modalCtx = {}; }
modalEl.addEventListener('click', e => { if (e.target === modalEl) closeModal(); });

function pickService(g) {
  const cur = serviceOf(g);
  const comp = compById(g.comp);
  const opts = Object.keys(CFG.services).map(n => `<button class="opt${n === cur ? ' sel' : ''}" data-act="svcpick" data-name="${esc(n)}">
    <span class="mark radio"></span>${esc(svcLabel(n))}</button>`).join('');
  openModal(`<h2>${esc(g.home)} – ${esc(g.away)}</h2>
    <p class="hint">Missä palvelussa ${esc(comp?.name || g.compName)} näkyy? Valinta koskee sarjan kaikkia pelejä.</p>${opts}
    <div class="row"><button class="btn" data-act="close">Peruuta</button></div>`, { game: g });
}

/* ---------- toiminnot ---------- */

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const cat = el.dataset.cat;
  switch (act) {
    case 'tab': {
      const dir = tabIndex(el.dataset.id) - tabIndex(S.tab);
      if (dir) { S.tab = TABS[tabIndex(S.tab) + dir - Math.sign(dir)][0]; goTab(Math.sign(dir)); }
      break;
    }
    case 'refresh': load(true); break;
    case 'fav': {
      const name = el.dataset.name;
      const favs = favList();
      S.favs = favs.includes(name) ? favs.filter(x => x !== name) : [...favs, name];
      S.openCat = cat;
      save(); render(); break;
    }
    case 'favreset': S.favs = null; save(); render(); break;
    case 'catall': S.all[cat] = !showAll(cat); S.openCat = cat; save(); render(); break;
    case 'svc': {
      const g = DATA.games.find(x => x.id === el.dataset.id);
      if (g) pickService(g);
      break;
    }
    case 'svcpick': {
      const g = modalCtx.game;
      const name = el.dataset.name;
      if (name === compById(g.comp)?.service) delete S.services[g.comp]; else S.services[g.comp] = name;
      save(); closeModal(); renderPage(); break;
    }
    case 'svcreset': S.services = {}; S.openCat = 'svc'; save(); render(); break;
    case 'close': closeModal(); break;
  }
});

// Asetuksissa muistetaan, mikä kategoria on auki.
document.addEventListener('toggle', e => {
  const d = e.target;
  if (d.matches && d.matches('details.cat')) {
    if (d.open) S.openCat = d.dataset.cat; else if (S.openCat === d.dataset.cat) S.openCat = null;
    save();
  }
}, true);

document.addEventListener('input', e => {
  if (e.target.matches('input.search')) filterTeams(e.target);
});

document.addEventListener('change', e => {
  const el = e.target.closest('[data-act="svcset"]');
  if (!el) return;
  const key = el.dataset.key;
  if (el.value === compById(key)?.service) delete S.services[key]; else S.services[key] = el.value;
  S.openCat = 'svc';
  save(); render();
});

render();
load();
