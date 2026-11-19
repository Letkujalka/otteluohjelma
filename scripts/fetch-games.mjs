// Hakee kategorioiden (UCL, LaLiga, Liiga, maajoukkueet) pelit ja joukkueet
// ja kirjoittaa ne tiedostoon games.json. Sovellus suodattaa pelit käyttäjän
// suosikkien mukaan.
// Ajetaan GitHub Actionsissa (ks. .github/workflows/pages.yml), Node 20+.
// Lähteet: ESPN:n avoin otteluohjelma (jalkapallo), TheSportsDB (Veikkausliiga),
// UEFA:n otteluohjelma (nuorten maajoukkueet) ja liiga.fi (jääkiekko).
// Jos lähde ei vastaa, sen edelliset pelit pidetään tallessa.
//
// Käyttö: node scripts/fetch-games.mjs [--days 21]

import { readFile, writeFile } from 'node:fs/promises';

const ROOT = new URL('..', import.meta.url);
const OUT = new URL('games.json', ROOT);
const DAYS_BACK = 2;
const DAYS_AHEAD = Number(process.argv[process.argv.indexOf('--days') + 1]) || 21;

const cfg = JSON.parse(await readFile(new URL('config.json', ROOT), 'utf8'));
let old = { games: [], teams: {} };
try { old = { teams: {}, ...JSON.parse(await readFile(OUT, 'utf8')) }; } catch { /* ensimmäinen ajo */ }

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const key = s => norm(s).replace(/[^a-z0-9 ]/g, '');

// Suomennos nimen perusteella; vertailu ilman aksentteja (esim. UEFA:n "Türki̇ye").
const nameIndex = new Map(Object.entries(cfg.names).map(([k, v]) => [key(k), v]));
const fiName = name => cfg.names[name] || nameIndex.get(key(name)) || name;

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
function serviceFor(comp, home, away) {
  return cfg.teamServices[home] || cfg.teamServices[away] || comp.service;
}

// Kategorioiden joukkuelistat: aiemmin nähdyt + oletussuosikit + tämän haun joukkueet.
// Listasta ei pudoteta ketään, jotta suosikin voi valita silloinkin, kun sillä ei ole pelejä.
const teams = {};
// Vanhat nimet ajetaan suomennoksen läpi, jotta uusi suomennos korvaa englanninkielisen nimen.
for (const c of cfg.categories) teams[c.id] = new Set([...(old.teams[c.id] || []).map(fiName), ...c.defaults]);

function game(comp, id, start, home, away, state, hs, as, detail, round = '') {
  return {
    id, start, cat: comp.cat, comp: comp.id, compName: comp.name, round, home, away,
    homeScore: state === 'pre' ? null : hs ?? null,
    awayScore: state === 'pre' ? null : as ?? null,
    state, detail, service: serviceFor(comp, home, away),
  };
}

/* ---------- ESPN (jalkapallo) ---------- */

// Joukkuelista: ensin sarjan joukkueet, tauolla (esim. Veikkausliiga talvella)
// sarjataulukko tai kuluneen vuoden ottelut.
async function espnTeams(comp) {
  const names = new Set();
  const espn = 'https://site.api.espn.com/apis';
  const tries = [
    ['joukkueet', async () => (await getJson(`${espn}/site/v2/sports/soccer/${comp.slug}/teams`))
      .sports?.[0]?.leagues?.[0]?.teams?.map(t => t.team.displayName) || []],
    ['sarjataulukko', async () => {
      const d = await getJson(`${espn}/v2/sports/soccer/${comp.slug}/standings`);
      const groups = d.children || [d];
      return groups.flatMap(g => g.standings?.entries || []).map(e => e.team?.displayName).filter(Boolean);
    }],
    // Kauden ulkopuolella: kuluneen kauden ottelut, yksi päivä viikossa huhti–lokakuussa
    // (ESPN ei hyväksy aikaväliä). Vain, jos listaa ei ole jo tallessa.
    ['kuluneen kauden ottelut', async () => {
      if (teams[comp.cat].size) return [...teams[comp.cat]];
      const out = [];
      const y = now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
      for (let d = new Date(Date.UTC(y, 3, 1)); d < new Date(Date.UTC(y, 10, 1)); d = new Date(d.getTime() + 7 * 864e5)) {
        try {
          const r = await getJson(`${espn}/site/v2/sports/soccer/${comp.slug}/scoreboard?dates=${ymd(d)}`);
          for (const ev of r.events || []) for (const c of ev.competitions?.[0]?.competitors || []) if (c.team?.displayName) out.push(c.team.displayName);
        } catch { /* yksittäinen päivä */ }
      }
      return out;
    }],
  ];
  for (const [what, fn] of tries) {
    try {
      const list = await fn();
      if (list.length) {
        for (const n of list) names.add(fiName(n));
        console.log(`  ${comp.name}: ${names.size} joukkuetta (${what})`);
        break;
      }
      console.log(`  ${comp.name}: ${what}: ei joukkueita`);
    } catch (e) {
      console.warn(`  ${comp.name}: ${what} ei onnistunut (${e.message.slice(0, 80)})`);
    }
  }
  for (const n of names) teams[comp.cat].add(n);
}

async function fetchEspn(comp) {
  if (comp.teams) await espnTeams(comp);
  const base = `https://site.api.espn.com/apis/site/v2/sports/soccer/${comp.slug}/scoreboard`;
  let events;
  try {
    // Ensin koko aikaväli yhdellä haulla.
    events = (await getJson(`${base}?dates=${ymd(from)}-${ymd(to)}`)).events || [];
  } catch (e) {
    // ESPN ei aina hyväksy aikaväliä: haetaan päivä kerrallaan.
    console.log(`  ${comp.name}: aikaväli ei käy, haetaan päivittäin`);
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
    const h = c.competitors.find(x => x.homeAway === 'home') || c.competitors[0];
    const a = c.competitors.find(x => x.homeAway === 'away') || c.competitors[1];
    const home = fiName(h.team.displayName || h.team.name);
    const away = fiName(a.team.displayName || a.team.name);
    // Esim. ystävyysottelut ja Copa del Rey: vain pelit, joissa on kategorian tuttu joukkue.
    if (comp.onlyKnown) {
      if (!teams[comp.cat].has(home) && !teams[comp.cat].has(away)) continue;
    } else {
      teams[comp.cat].add(home); teams[comp.cat].add(away);
    }
    const st = (ev.status || c.status || {}).type || {};
    const state = st.state === 'in' ? 'in' : st.state === 'post' ? 'post' : 'pre';
    games.push(game(comp, `espn-${ev.id}`, ev.date, home, away, state,
      Number(h.score ?? NaN), Number(a.score ?? NaN), state === 'in' ? (st.shortDetail || '') : '',
      (c.notes || [])[0]?.headline || ''));
  }
  return games;
}

/* ---------- TheSportsDB (Veikkausliiga) ---------- */

// Avoin TheSportsDB-rajapinta (ilmaisavain 123, enintään 30 hakua minuutissa).
// Ilmaisavaimella osa hauista palauttaa esimerkkidataa, joten jokaisesta
// tuloksesta tarkistetaan, että se kuuluu oikeaan sarjaan.
const SDB = 'https://www.thesportsdb.com/api/v1/json/123';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function sdb(path) {
  await sleep(2100);
  return getJson(`${SDB}/${path}`);
}

async function fetchSportsDb(comp) {
  const leagues = (await sdb(`search_all_leagues.php?c=${encodeURIComponent(comp.country)}&s=Soccer`)).countries || [];
  const league = leagues.find(l => [l.strLeague, l.strLeagueAlternate].some(n => n && n.toLowerCase().includes(comp.league.toLowerCase())));
  if (!league) throw new Error(`sarjaa ${comp.league} ei löytynyt (${leagues.map(l => l.strLeague).join(', ')})`);
  const inLeague = x => String(x.idLeague) === String(league.idLeague);

  // Joukkuelista tehdään joka kerta alusta (vanhassa listassa voi olla esimerkkidataa).
  const prev = new Set(teams[comp.cat]);
  teams[comp.cat].clear();
  try {
    const tl = ((await sdb(`search_all_teams.php?l=${encodeURIComponent(league.strLeague)}`)).teams || []).filter(inLeague);
    for (const t of tl) teams[comp.cat].add(fiName(t.strTeam));
    console.log(`  ${comp.name}: joukkuehaku ${tl.length}`);
  } catch (e) { console.warn(`  ${comp.name}: joukkuehaku ei onnistunut (${e.message.slice(0, 80)})`); }
  // Lisäksi joukkueet kuluneen kauden otteluista.
  for (const y of [now.getUTCFullYear(), now.getUTCFullYear() - 1]) {
    try {
      const evs = ((await sdb(`eventsseason.php?id=${league.idLeague}&s=${y}`)).events || []).filter(inLeague);
      for (const ev of evs) { teams[comp.cat].add(fiName(ev.strHomeTeam)); teams[comp.cat].add(fiName(ev.strAwayTeam)); }
      console.log(`  ${comp.name}: kauden ${y} otteluita ${evs.length}`);
    } catch (e) { console.warn(`  ${comp.name} ${y}: ${e.message.slice(0, 80)}`); }
  }

  // Pelit päivä kerrallaan.
  const games = [];
  let days = 0;
  for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 864e5)) {
    let evs;
    try { evs = (await sdb(`eventsday.php?d=${d.toISOString().slice(0, 10)}&l=${league.idLeague}`)).events || []; days++; }
    catch (e) { console.warn(`  ${comp.name} ${d.toISOString().slice(0, 10)}: ${e.message.slice(0, 60)}`); continue; }
    for (const ev of evs.filter(inLeague)) {
      // Ajat ovat UTC:tä; aikavyöhyke lisätään, jos se puuttuu.
      const raw = ev.strTimestamp || `${ev.dateEvent}T${ev.strTime || '12:00:00'}`;
      const start = new Date(/(Z|[+-]\d\d:?\d\d)$/.test(raw) ? raw : raw + 'Z');
      const home = fiName(ev.strHomeTeam), away = fiName(ev.strAwayTeam);
      teams[comp.cat].add(home); teams[comp.cat].add(away);
      const st = String(ev.strStatus || '');
      const state = /FT|AET|PEN|Match Finished/i.test(st) ? 'post' : /1H|2H|HT|LIVE|ET/i.test(st) ? 'in' : 'pre';
      games.push(game(comp, `sdb-${ev.idEvent}`, start.toISOString(), home, away, state,
        ev.intHomeScore == null ? null : Number(ev.intHomeScore), ev.intAwayScore == null ? null : Number(ev.intAwayScore), state === 'in' ? st : ''));
    }
  }
  console.log(`  ${comp.name}: sarja ${league.strLeague} (${league.idLeague}), ${teams[comp.cat].size} joukkuetta, ${days} päivää haettu`);
  if (!teams[comp.cat].size) for (const n of prev) teams[comp.cat].add(n);
  if (!days) throw new Error('päivähaku ei onnistunut');
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
  return (uefaCache = all);
}

async function fetchUefa(comp) {
  const ageRe = new RegExp(`(under[ -]?${comp.age}|u${comp.age})\\b`, 'i');
  const wanted = new Set(comp.teams.map(key));
  const tname = t => t?.internationalName || t?.translations?.displayName?.EN || t?.name || '';
  const games = [];
  for (const m of await uefaMatches()) {
    const cname = m.competition?.metaData?.name || m.competition?.translations?.name?.EN || '';
    if (!ageRe.test(cname)) continue;
    const hn = tname(m.homeTeam), an = tname(m.awayTeam);
    if (!wanted.has(key(hn)) && !wanted.has(key(an))) continue;
    const home = `${fiName(hn)} U${comp.age}`, away = `${fiName(an)} U${comp.age}`;
    const status = String(m.status || '').toUpperCase();
    const state = status === 'FINISHED' ? 'post' : status === 'LIVE' ? 'in' : 'pre';
    const sc = m.score?.total || m.score?.regular || {};
    games.push(game(comp, `uefa-${m.id}`, new Date(m.kickOffTime?.dateTime || m.kickOffTime?.date).toISOString(),
      home, away, state, sc.home, sc.away, state === 'in' && m.minute?.normal ? `${m.minute.normal}'` : ''));
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
      console.warn(`  ${tournament}: ${e.message.slice(0, 80)}`);
      continue;
    }
    for (const g of Array.isArray(list) ? list : list.games || []) {
      const home = g.homeTeam?.teamName, away = g.awayTeam?.teamName;
      if (home) teams[comp.cat].add(home);
      if (away) teams[comp.cat].add(away);
      const start = new Date(g.start);
      if (!(start >= from && start <= to) || !home || !away) continue;
      const state = g.ended ? 'post' : g.started ? 'in' : 'pre';
      const c = tournament === 'playoffs' ? { ...comp, name: comp.name + ' – pudotuspelit' } : comp;
      games.push(game(c, `liiga-${season}-${g.id}`, start.toISOString(), home, away, state,
        g.homeTeam?.goals, g.awayTeam?.goals, state === 'in' && g.gameTime ? `${Math.floor(g.gameTime / 60)}'` : ''));
    }
  }
  if (!ok) throw new Error('liiga.fi ei vastannut');
  return games;
}

/* ---------- ajo ---------- */

const all = [];
const failed = [];
// Järjestys config.json:n mukaan: joukkuelistat (teams: true) ennen onlyKnown-sarjoja.
for (const comp of cfg.competitions) {
  try {
    const games = comp.source === 'liiga' ? await fetchLiiga(comp)
      : comp.source === 'uefa' ? await fetchUefa(comp)
      : comp.source === 'sportsdb' ? await fetchSportsDb(comp) : await fetchEspn(comp);
    console.log(`${comp.name}: ${games.length} peliä`);
    all.push(...games);
  } catch (e) {
    console.warn(`${comp.name}: EPÄONNISTUI (${e.message.slice(0, 120)}) – pidetään edelliset tiedot`);
    failed.push(comp.id);
    all.push(...old.games.filter(g => g.comp === comp.id && g.cat && new Date(g.start) >= from));
  }
}

const seen = new Set();
const games = all
  .filter(g => (seen.has(g.id) ? false : seen.add(g.id)))
  .sort((a, b) => a.start.localeCompare(b.start) || a.home.localeCompare(b.home, 'fi'));

if (failed.length === cfg.competitions.length) {
  console.error('Yksikään lähde ei vastannut – games.json jätetään ennalleen.');
  process.exit(0);
}

const teamLists = Object.fromEntries(Object.entries(teams).map(([k, s]) => [k, [...s].sort((a, b) => a.localeCompare(b, 'fi'))]));
const changed = JSON.stringify([games, teamLists]) !== JSON.stringify([old.games, old.teams]);
await writeFile(OUT, JSON.stringify({ updated: now.toISOString(), failed, teams: teamLists, games }, null, 1) + '\n');
console.log(`Yhteensä ${games.length} peliä; joukkueita: ${Object.entries(teamLists).map(([k, v]) => `${k} ${v.length}`).join(', ')}${changed ? '' : ' (ei muutoksia)'}.`);
// Workflow tallentaa games.json:n repoon vain, kun sisältö muuttui (pelkkä aikaleima ei riitä).
if (process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT, `changed=${changed}\n`, { flag: 'a' });
