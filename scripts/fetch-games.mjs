// Hakee suosikkijoukkueiden pelit ja kirjoittaa ne tiedostoon games.json.
// Ajetaan GitHub Actionsissa (ks. .github/workflows/pages.yml), Node 20+.
// Lähteet: ESPN:n avoin otteluohjelma (jalkapallo), UEFA:n otteluohjelma
// (nuorten maajoukkueet) ja liiga.fi (jääkiekko).
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
// UEFA-lähteen joukkueet (U21, U19) tunnistetaan sarjasta, ei nimestä.
for (const t of cfg.teams) if (t.source !== 'uefa') for (const m of t.match) teamIndex.set(norm(m), t);
const favOf = name => teamIndex.get(norm(name));

const now = new Date();
const from = new Date(now.getTime() - DAYS_BACK * 864e5);
const to = new Date(now.getTime() + DAYS_AHEAD * 864e5);
const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, '');

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'otteluohjelma/1.0', Accept: 'application/json' } });
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 160).replace(/\s+/g, ' ');
    throw new Error(`${res.status} ${url}${body ? ' – ' + body : ''}`);
  }
  return res.json();
}

// Joukkueen oma palvelu (esim. Suomen maajoukkueet Ylellä) voittaa sarjan palvelun.
function serviceFor(comp, favs) {
  for (const t of favs) if (t.service) return t.service;
  return comp.service;
}

// Suomennos nimen perusteella; vertailu ilman aksentteja (esim. UEFA:n "Türki̇ye").
const nameIndex = new Map(Object.entries(cfg.names).map(([k, v]) => [norm(k).replace(/[^a-z ]/g, ''), v]));
const fiName = name => cfg.names[name] || nameIndex.get(norm(name).replace(/[^a-z ]/g, '')) || name;
function displayName(name, fav) {
  return fav ? fav.name : fiName(name);
}

/* ---------- ESPN (jalkapallo) ---------- */

async function fetchEspn(comp) {
  const base = `https://site.api.espn.com/apis/site/v2/sports/soccer/${comp.slug}/scoreboard`;
  let events;
  try {
    // Ensin koko aikaväli yhdellä haulla.
    events = (await getJson(`${base}?dates=${ymd(from)}-${ymd(to)}`)).events || [];
  } catch (e) {
    // ESPN ei aina hyväksy aikaväliä: haetaan päivä kerrallaan.
    console.log(`  ${comp.name}: aikaväli ei käy (${e.message.slice(0, 60)}…), haetaan päivittäin`);
    events = [];
    let ok = 0, lastErr;
    for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 864e5)) {
      try { events.push(...((await getJson(`${base}?dates=${ymd(d)}`)).events || [])); ok++; }
      catch (err) { lastErr = err; }
    }
    if (!ok) throw lastErr;
  }
  const games = [];
  for (const ev of events) {
    const c = (ev.competitions || [])[0];
    if (!c) continue;
    const home = c.competitors.find(x => x.homeAway === 'home') || c.competitors[0];
    const away = c.competitors.find(x => x.homeAway === 'away') || c.competitors[1];
    const names = [home, away].map(x => x.team.displayName || x.team.name);
    const favs = names.map(favOf);
    if (!comp.all && !favs.some(Boolean)) continue;
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

/* ---------- UEFA (nuorten maajoukkueet) ---------- */

// match.uefa.com on uefa.comin oma otteluohjelma. Haetaan kaikki aikavälin
// ottelut ja poimitaan ne, joiden sarjan nimessä on ikäluokka (Under-21 / U21).
let uefaCache = null;
async function uefaMatches() {
  if (uefaCache) return uefaCache;
  const iso = d => d.toISOString().slice(0, 10);
  const all = [];
  for (let offset = 0; offset < 3000; offset += 200) {
    const page = await getJson(`https://match.uefa.com/v5/matches?fromDate=${iso(from)}&toDate=${iso(to)}&order=ASC&offset=${offset}&limit=200`);
    const list = Array.isArray(page) ? page : page.matches || page.data || [];
    all.push(...list);
    if (list.length < 200) break;
  }
  const comps = [...new Set(all.map(m => m.competition?.metaData?.name || m.competition?.translations?.name?.EN || '?'))];
  console.log(`  UEFA: ${all.length} ottelua, sarjat: ${comps.join(', ')}`);
  return (uefaCache = all);
}

async function fetchUefa(comp) {
  const team = cfg.teams.find(t => t.source === 'uefa' && t.age === comp.age);
  if (!team) return [];
  const ageRe = new RegExp(`(under[ -]?${comp.age}|u${comp.age})\\b`, 'i');
  const names = new Set(team.match.map(norm));
  const tname = t => t?.internationalName || t?.translations?.displayName?.EN || t?.name || '';
  const games = [];
  for (const m of await uefaMatches()) {
    const cname = m.competition?.metaData?.name || m.competition?.translations?.name?.EN || '';
    if (!ageRe.test(cname)) continue;
    const hn = tname(m.homeTeam), an = tname(m.awayTeam);
    const isFav = [names.has(norm(hn)), names.has(norm(an))];
    if (!isFav.some(Boolean)) continue;
    const status = String(m.status || '').toUpperCase();
    const state = status === 'FINISHED' ? 'post' : status === 'LIVE' ? 'in' : 'pre';
    const sc = m.score?.total || m.score?.regular || {};
    const label = n => `${fiName(n)} U${comp.age}`;
    games.push({
      id: `uefa-${m.id}`,
      start: new Date(m.kickOffTime?.dateTime || m.kickOffTime?.date).toISOString(),
      sport: 'soccer',
      comp: comp.id,
      compName: /qualif|karsin/i.test(cname + (m.round?.metaData?.name || '')) ? `${comp.name}-karsinta` : comp.name,
      round: '',
      home: isFav[0] ? team.name : label(hn),
      away: isFav[1] ? team.name : label(an),
      fav: [team.id],
      homeScore: state === 'pre' ? null : sc.home ?? null,
      awayScore: state === 'pre' ? null : sc.away ?? null,
      state,
      detail: state === 'in' && m.minute?.normal ? `${m.minute.normal}'` : '',
      tbd: false,
      service: team.service || comp.service,
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
    const games = comp.source === 'liiga' ? await fetchLiiga(comp)
      : comp.source === 'uefa' ? await fetchUefa(comp) : await fetchEspn(comp);
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
