'use strict';
/* Otteluohjelma – suosikkijoukkueiden pelit ja palvelut, joista ne näkee.
   Pelit tulevat tiedostosta games.json, jonka GitHub Actions päivittää
   kahden tunnin välein. Omat asetukset (piilotetut joukkueet, palvelujen
   muutokset) tallennetaan selaimen localStorageen (avain KEY). */

const APP_VERSION = '1';
const KEY = 'otteluohjelma.v1';
const TZ = 'Europe/Helsinki';
const REFRESH_MIN = 10;

let CFG = null;          // config.json
let DATA = null;         // games.json
let loadError = '';
let S = loadState();

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && typeof s === 'object') return { hidden: [], services: {}, tab: 'today', ...s };
  } catch (e) { /* tyhjä tai rikki */ }
  return { hidden: [], services: {}, tab: 'today' };
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

const teamById = id => CFG.teams.find(t => t.id === id);
const compById = id => CFG.competitions.find(c => c.id === id);
// Järjestys: oma joukkuekohtainen valinta > config.json:n joukkuekohtainen palvelu
// (esim. Suomen karsinnat Yle Areenassa) > oma sarjakohtainen valinta > sarjan oletus.
function serviceOf(g) {
  for (const f of g.fav) if (S.services[g.comp + '/' + f]) return S.services[g.comp + '/' + f];
  const compDefault = compById(g.comp)?.service;
  if (g.service && g.service !== compDefault) return g.service;
  return S.services[g.comp] || g.service || compDefault || '?';
}
const svcInfo = name => (CFG.services && CFG.services[name]) || { url: '', color: '#59616e' };

function visibleGames() {
  if (!DATA) return [];
  return DATA.games.filter(g => g.fav.some(f => !S.hidden.includes(f)));
}

/* ---------- näkymät ---------- */

const TABS = [
  ['today', 'Tänään'],
  ['tomorrow', 'Huomenna'],
  ['week', 'Viikko'],
  ['later', 'Myöhemmin'],
];

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

function gameCard(g) {
  const svc = serviceOf(g);
  const info = svcInfo(svc);
  const isFav = name => g.fav.some(f => teamById(f)?.name === name);
  const team = (name, score) => `<div class="team${isFav(name) ? ' fav' : ''}"><span>${esc(name)}</span>${score != null && !Number.isNaN(score) ? `<b>${score}</b>` : ''}</div>`;
  let when;
  if (g.state === 'in') when = `<span class="live">● LIVE</span>${g.detail ? ` <small>${esc(g.detail)}</small>` : ''}`;
  else if (g.state === 'post') when = `<span class="muted">Päättynyt</span>`;
  else when = `<span class="time">${g.tbd ? 'Aika auki' : fmtTime(g.start)}</span>`;
  const svcTag = info.url
    ? `<a class="svc" style="--svc:${info.color}" href="${esc(info.url)}" target="_blank" rel="noopener">▶ ${esc(svc)}</a>`
    : `<span class="svc" style="--svc:${info.color}">${svc === '?' ? 'Palvelu ei tiedossa' : esc(svc)}</span>`;
  return `<div class="card game ${g.state}">
    <div class="g-head">${when}<span class="comp">${g.sport === 'hockey' ? '🏒' : '⚽'} ${esc(g.compName)}${g.round ? ' · ' + esc(g.round) : ''}</span></div>
    <div class="teams">${team(g.home, g.homeScore)}${team(g.away, g.awayScore)}</div>
    <div class="g-foot">${svcTag}<button class="linkbtn" data-act="svc" data-id="${esc(g.id)}">Vaihda</button></div>
  </div>`;
}

function dayGroups(games) {
  const groups = new Map();
  for (const g of games) {
    const k = dayKey(g.start);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(g);
  }
  return [...groups].map(([k, list]) => `<h2 class="day">${dayLabel(k)}</h2>${list.map(gameCard).join('')}`).join('');
}

function viewHome() {
  let h = `<header class="top"><h1>Otteluohjelma</h1>
    <button class="menu" data-act="refresh" title="Päivitä" aria-label="Päivitä">⟳</button>
    <a class="menu" href="#/asetukset" title="Asetukset" aria-label="Asetukset">⚙</a></header>`;
  h += `<nav class="tabs">${TABS.map(([id, label]) => {
    const n = DATA ? gamesForTab(id, visibleGames()).length : 0;
    return `<button class="tab${S.tab === id ? ' sel' : ''}" data-act="tab" data-id="${id}">${label}${n ? `<span class="count">${n}</span>` : ''}</button>`;
  }).join('')}</nav>`;

  if (!DATA) {
    h += loadError
      ? `<div class="card warn"><p>Otteluohjelmaa ei saatu ladattua.</p><p class="muted">${esc(loadError)}</p></div>`
      : `<p class="hint">Ladataan…</p>`;
    return h;
  }

  const all = visibleGames();
  const list = gamesForTab(S.tab, all);
  if (!list.length) {
    const today = dayKey(Date.now());
    const next = all.find(g => dayKey(g.start) > (S.tab === 'today' ? today : S.tab === 'tomorrow' ? addDays(today, 1) : addDays(today, 6)));
    h += `<div class="card empty"><p>${S.tab === 'today' ? 'Ei suosikkien pelejä tänään.' : S.tab === 'tomorrow' ? 'Ei suosikkien pelejä huomenna.' : 'Ei pelejä tällä aikavälillä.'}</p>
      ${next ? `<p class="muted">Seuraava: ${esc(next.home)} – ${esc(next.away)}, ${dayLabel(dayKey(next.start)).toLowerCase()} klo ${fmtTime(next.start)}</p>` : ''}</div>`;
  } else if (S.tab === 'today' || S.tab === 'tomorrow') {
    h += list.map(gameCard).join('');
  } else {
    h += dayGroups(list);
  }

  // Eilisen tulokset Tänään-välilehden loppuun.
  if (S.tab === 'today') {
    const y = addDays(dayKey(Date.now()), -1);
    const past = all.filter(g => dayKey(g.start) === y && g.state === 'post');
    if (past.length) h += `<details class="past"><summary>Eilisen tulokset (${past.length})</summary>${past.map(gameCard).join('')}</details>`;
  }

  h += `<p class="ver">Päivitetty ${ago(DATA.updated)}<br>Versio ${APP_VERSION}</p>`;
  return h;
}

function viewSettings() {
  let h = `<header class="top"><a class="back" href="#/">‹</a><h1>Asetukset</h1></header>`;
  h += `<div class="card"><h2>Suosikit</h2><p class="hint">Näytä pelit näiltä joukkueilta.</p>
    ${CFG.teams.map(t => `<button class="opt${S.hidden.includes(t.id) ? '' : ' sel'}" data-act="team" data-id="${t.id}">
      <span class="mark check"></span>${esc(t.name)}<small>${t.sport === 'hockey' ? '🏒' : '⚽'}${t.national ? ' maajoukkue' : ''}</small></button>`).join('')}
    <p class="hint">Uuden joukkueen lisäys: muokkaa tiedostoa <code>config.json</code> GitHubissa.</p></div>`;

  const names = Object.keys(CFG.services);
  const sel = (key, def) => `<select data-act="svcset" data-key="${esc(key)}">
    ${names.map(n => `<option value="${esc(n)}"${(S.services[key] || def) === n ? ' selected' : ''}>${n === '?' ? 'Ei tiedossa' : esc(n)}</option>`).join('')}</select>`;
  h += `<div class="card"><h2>Missä sarjat näkyvät</h2><p class="hint">Oletukset ovat kauden 2026–27 oikeuksien mukaiset. Muuta, jos palvelu vaihtuu.</p>
    ${CFG.competitions.map(c => `<label>${esc(c.name)}${sel(c.id, c.service)}</label>`).join('')}`;
  const overrides = Object.keys(S.services).filter(k => k.includes('/'));
  if (overrides.length) {
    h += `<h2 style="margin-top:14px">Joukkuekohtaiset</h2>${overrides.map(k => {
      const [c, t] = k.split('/');
      return `<div class="res"><span>${esc(teamById(t)?.name || t)} · ${esc(compById(c)?.name || c)}: <b>${esc(S.services[k])}</b></span>
        <button class="btn small" data-act="svcdel" data-key="${esc(k)}">Poista</button></div>`;
    }).join('')}`;
  }
  h += `</div>`;
  if (Object.keys(S.services).length) h += `<button class="btn block danger" data-act="svcreset">Palauta palvelujen oletukset</button>`;
  h += `<p class="hint">Pelit haetaan ESPN:n otteluohjelmasta (jalkapallo) ja liiga.fi:stä (Liiga) kahden tunnin välein. Palvelu päätellään sarjasta: tarkista epävarmat (esim. maaottelut) palvelusta itsestään.</p>
    ${DATA && DATA.failed && DATA.failed.length ? `<p class="hint">Viimeisimmässä haussa ei saatu: ${DATA.failed.map(id => esc(compById(id)?.name || id)).join(', ')} (näille näytetään edelliset tiedot).</p>` : ''}
    <p class="ver">Versio ${APP_VERSION}</p>`;
  return h;
}

/* ---------- reititys ja piirto ---------- */

const VIEWS = { '/': viewHome, '/asetukset': viewSettings };

function render() {
  const path = location.hash.replace(/^#/, '') || '/';
  const app = document.getElementById('app');
  if (!CFG) { app.innerHTML = loadError ? `<div class="card warn"><p>${esc(loadError)}</p></div>` : '<p class="hint">Ladataan…</p>'; return; }
  app.innerHTML = (VIEWS[path] || viewHome)();
}
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

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
  render();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') load();
});
setInterval(() => { if (document.visibilityState === 'visible') load(); }, REFRESH_MIN * 60000);
// Kellonajat ja LIVE-tilat ajan tasalle välilehteä vaihtamatta.
setInterval(() => { if (!document.getElementById('modal').classList.contains('hidden')) return; render(); }, 60000);

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
  const fav = g.fav[0];
  const favName = teamById(fav)?.name || fav;
  const opts = Object.keys(CFG.services).map(n => `<button class="opt${n === cur ? ' sel' : ''}" data-act="svcpick" data-name="${esc(n)}">
    <span class="mark radio"></span>${n === '?' ? 'Ei tiedossa' : esc(n)}</button>`).join('');
  openModal(`<h2>${esc(g.home)} – ${esc(g.away)}</h2>
    <p class="hint">Missä palvelussa ${esc(comp?.name || g.compName)} näkyy?</p>${opts}
    <label class="chk" style="margin-top:12px"><input type="checkbox" id="onlyTeam"${S.services[g.comp + '/' + fav] ? ' checked' : ''}> Koskee vain joukkuetta ${esc(favName)}</label>
    <div class="row"><button class="btn" data-act="close">Peruuta</button></div>`, { game: g });
}

/* ---------- toiminnot ---------- */

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  switch (act) {
    case 'tab': S.tab = el.dataset.id; save(); render(); window.scrollTo(0, 0); break;
    case 'refresh': load(true); break;
    case 'team': {
      const id = el.dataset.id;
      S.hidden = S.hidden.includes(id) ? S.hidden.filter(x => x !== id) : [...S.hidden, id];
      save(); render(); break;
    }
    case 'svc': {
      const g = DATA.games.find(x => x.id === el.dataset.id);
      if (g) pickService(g);
      break;
    }
    case 'svcpick': {
      const g = modalCtx.game;
      const onlyTeam = document.getElementById('onlyTeam')?.checked;
      const key = onlyTeam ? g.comp + '/' + g.fav[0] : g.comp;
      const name = el.dataset.name;
      if (!onlyTeam) delete S.services[g.comp + '/' + g.fav[0]];
      const def = onlyTeam ? null : compById(g.comp)?.service;
      if (name === def) delete S.services[key]; else S.services[key] = name;
      save(); closeModal(); render(); break;
    }
    case 'svcdel': delete S.services[el.dataset.key]; save(); render(); break;
    case 'svcreset': S.services = {}; save(); render(); break;
    case 'close': closeModal(); break;
  }
});

document.addEventListener('change', e => {
  const el = e.target.closest('[data-act="svcset"]');
  if (!el) return;
  const key = el.dataset.key;
  if (el.value === compById(key)?.service) delete S.services[key]; else S.services[key] = el.value;
  save(); render();
});

render();
load();
