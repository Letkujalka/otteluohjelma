// Hakee suosikkijoukkueiden pelit ja kirjoittaa ne tiedostoon games.json.
// Ajetaan GitHub Actionsissa (ks. .github/workflows/pages.yml), Node 20+.
// Lähteet: ESPN:n avoin otteluohjelma (jalkapallo) ja liiga.fi (jääkiekko).
// Jos lähde ei vastaa, sen edelliset pelit pidetään tallessa.
//
// Käyttö: node scripts/fetch-games.mjs [--days 21]

import { readFile, writeFile } from 'node:fs/promises';

const ROOT = new URL('..', import.meta.url);
const OUT = new URL('games.json', ROOT);
const DAYS_BACK = 2;
const DAYS_AHEAD = Number(process.argv[process.argv.indexOf('--days') + 1]) || 21;

const cfg = JSON.parse(await readFile(new URL('config.json', ROOT), 'utf8'));
let old = { games: [] };
try { old = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* ensimmäinen ajo */ }

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const teamIndex = new Map();
for (const t of cfg.teams) for (const m of t.match) teamIndex.set(norm(m), t);
const favOf = name => teamIndex.get(norm(name));

const now = new Date();
const from = new Date(now.getTime() - DAYS_BACK * 864e5);
const to = new Date(now.getTime() + DAYS_AHEAD * 864e5);
const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, '');

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'otteluohjelma/1.0', Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

function serviceFor(comp, favs) {
  for (const t of favs) if (t.services && t.services[comp.id]) return t.services[comp.id];
  return comp.service;
}

function displayName(name, fav) {
  return fav ? fav.name : (cfg.names[name] || name);
}

/* ---------- ESPN (jalkapallo) ---------- */

async function fetchEspn(comp) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${comp.slug}/scoreboard?dates=${ymd(from)}-${ymd(to)}&limit=1000`;
  const data = await getJson(url);
  const games = [];
  for (const ev of data.events || []) {
    const c = (ev.competitions || [])[0];
    if (!c) continue;
    const home = c.competitors.find(x => x.homeAway === 'home') || c.competitors[0];
    const away = c.competitors.find(x => x.homeAway === 'away') || c.competitors[1];
    const names = [home, away].map(x => x.team.displayName || x.team.name);
    const favs = names.map(favOf);
    if (!favs.some(Boolean)) continue;
    const st = (ev.status || c.status || {}).type || {};
    games.push({
      id: `espn-${ev.id}`,
      start: ev.date,
      sport: 'soccer',
      comp: comp.id,
      compName: comp.name,
      round: (c.notes || [])[0]?.headline || '',
      home: displayName(names[0], favs[0]),
      away: displayName(names[1], favs[1]),
      fav: favs.filter(Boolean).map(t => t.id),
      homeScore: st.state === 'pre' ? null : Number(home.score ?? NaN),
      awayScore: st.state === 'pre' ? null : Number(away.score ?? NaN),
      state: st.state === 'in' ? 'in' : st.state === 'post' ? 'post' : 'pre',
      detail: st.state === 'in' ? (st.shortDetail || '') : '',
      tbd: !!(st.name === 'STATUS_SCHEDULED' && ev.timeValid === false),
      service: serviceFor(comp, favs.filter(Boolean)),
    });
  }
  return games;
}

/* ---------- liiga.fi (jääkiekko) ---------- */

async function fetchLiiga(comp) {
  // Kausi 2026–27 on liiga.fi:ssä "2027".
  const season = now.getUTCMonth() >= 6 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  const games = [];
  let ok = 0;
  for (const tournament of comp.tournaments) {
    let list;
    try {
      list = await getJson(`https://liiga.fi/api/v2/games?tournament=${tournament}&season=${season}`);
      ok++;
    } catch (e) {
      console.warn(`  ${tournament}: ${e.message}`);
      continue;
    }
    for (const g of Array.isArray(list) ? list : list.games || []) {
      const start = new Date(g.start);
      if (!(start >= from && start <= to)) continue;
      const hn = g.homeTeam?.teamName, an = g.awayTeam?.teamName;
      const favs = [favOf(hn), favOf(an)];
      if (!favs.some(Boolean)) continue;
      const state = g.ended ? 'post' : g.started ? 'in' : 'pre';
      games.push({
        id: `liiga-${season}-${g.id}`,
        start: start.toISOString(),
        sport: 'hockey',
        comp: comp.id,
        compName: comp.name + (tournament === 'playoffs' ? ' – pudotuspelit' : ''),
        round: '',
        home: displayName(hn, favs[0]),
        away: displayName(an, favs[1]),
        fav: favs.filter(Boolean).map(t => t.id),
        homeScore: state === 'pre' ? null : g.homeTeam?.goals ?? null,
        awayScore: state === 'pre' ? null : g.awayTeam?.goals ?? null,
        state,
        detail: state === 'in' && g.gameTime ? `${Math.floor(g.gameTime / 60)}'` : '',
        tbd: false,
        service: serviceFor(comp, favs.filter(Boolean)),
      });
    }
  }
  if (!ok) throw new Error('liiga.fi ei vastannut');
  return games;
}

/* ---------- ajo ---------- */

const all = [];
const failed = [];
for (const comp of cfg.competitions) {
  try {
    const games = comp.source === 'liiga' ? await fetchLiiga(comp) : await fetchEspn(comp);
    console.log(`${comp.name}: ${games.length} peliä`);
    all.push(...games);
  } catch (e) {
    console.warn(`${comp.name}: EPÄONNISTUI (${e.message}) – pidetään edelliset tiedot`);
    failed.push(comp.id);
    all.push(...old.games.filter(g => g.comp === comp.id && new Date(g.start) >= from));
  }
}

// Sama ottelu voi tulla kahdesta lähteestä (esim. useampi suosikki samassa pelissä) – poistetaan tuplat.
const seen = new Set();
const games = all
  .filter(g => (seen.has(g.id) ? false : seen.add(g.id)))
  .sort((a, b) => a.start.localeCompare(b.start));

if (failed.length === cfg.competitions.length) {
  console.error('Yksikään lähde ei vastannut – games.json jätetään ennalleen.');
  process.exit(0);
}

const changed = JSON.stringify(games) !== JSON.stringify(old.games);
await writeFile(OUT, JSON.stringify({ updated: now.toISOString(), failed, games }, null, 1) + '\n');
console.log(`Yhteensä ${games.length} peliä${changed ? '' : ' (ei muutoksia)'}.`);
// Workflow tallentaa games.json:n repoon vain, kun pelit muuttuivat (pelkkä aikaleima ei riitä).
if (process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT, `changed=${changed}\n`, { flag: 'a' });
