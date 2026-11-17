# Otteluohjelma

Kännykkään asennettava web-sovellus (PWA), joka näyttää suosikkijoukkueiden
pelit ja palvelun, josta pelin näkee: MTV Katsomo, Disney+, Viaplay tai
Yle Areena. Tehty samalla tavalla kuin Salitreeni.

## Asennus puhelimeen (Android / Chrome)

1. Avaa Chromessa https://letkujalka.github.io/otteluohjelma/
2. Valitse Chromen valikosta ⋮ **Lisää aloitusnäytölle** / **Asenna sovellus**.

## Toiminta

- **Välilehdet:** Tänään, Huomenna, Viikko (tänään + 6 päivää päivittäin
  ryhmiteltynä) ja Myöhemmin (noin 3 viikkoa eteenpäin). Tänään-välilehden
  lopussa ovat eilisen tulokset.
- **Ottelukortti:** kellonaika (Suomen aikaa), sarja, joukkueet (suosikki
  lihavoituna) ja palvelu. Palvelunappi avaa palvelun. Käynnissä olevassa
  pelissä näkyy LIVE ja tilanne, päättyneessä lopputulos.
- **Vaihda:** jos palvelu on väärin, kortin "Vaihda"-linkistä valitaan oikea
  palvelu koko sarjalle tai vain yhdelle joukkueelle.
- **Asetukset (⚙):** suosikkien piilotus ja sarjakohtaiset palvelut.
  Asetukset tallentuvat vain puhelimeen.

## Mistä pelit tulevat

GitHub Actions ajaa `scripts/fetch-games.mjs`-skriptin kahden tunnin välein.
Skripti hakee pelit ja kirjoittaa ne tiedostoon `games.json`, jonka sovellus
lataa.

- **Jalkapallo:** ESPN:n avoin otteluohjelma (`site.api.espn.com`).
- **Liiga:** liiga.fi:n otteluohjelma (`liiga.fi/api/v2/games`).

MTV Katsomolla ja Disney+:lla ei ole julkista ohjelmatietoa, joten palvelu
päätellään sarjasta (`config.json`). Oletukset kaudelle 2026–27:

| Sarja | Palvelu |
|---|---|
| Liiga | MTV Katsomo |
| LaLiga, Copa del Rey, Supercopa | Disney+ |
| Bundesliga, DFB-Pokal | Viaplay |
| Mestarien liiga | MTV Katsomo |
| Maajoukkueiden karsinnat ja Kansojen liiga | MTV Katsomo (Suomen pelit Yle Areena) |
| Maaottelut (ystävyysottelut) | ei tiedossa |

## Joukkueiden ja sarjojen muokkaus

Muokkaa tiedostoa `config.json`:

- `teams`: joukkueet. `match` sisältää nimet, joilla joukkue löytyy
  lähteestä (ESPN englanniksi, esim. "Bayern Munich"; Liiga suomeksi).
- `competitions`: sarjat. `slug` on ESPN:n sarjatunnus (esim. `esp.1`,
  `ger.1`, `uefa.champions`).
- `services`: palvelut, niiden linkit ja värit.

Muutos julkaistaan, kun se tallennetaan `main`-haaraan. Pelit voi hakea heti
kohdasta Actions → Otteluohjelma GitHub Pagesiin → Run workflow.

## Tiedostot ja kehitys

| Tiedosto | Sisältö |
|---|---|
| `index.html` | Sivun runko |
| `app.js` | Sovelluslogiikka ja näkymät |
| `style.css` | Ulkoasu (sama kuin Salitreenissä) |
| `config.json` | Joukkueet, sarjat ja palvelut |
| `games.json` | Haetut pelit (päivittyy automaattisesti) |
| `scripts/fetch-games.mjs` | Pelien haku |
| `sw.js` | Service worker: sovellus välimuistista, pelit ensin verkosta |
| `manifest.webmanifest`, `icons/` | Asennettavuus ja kuvakkeet |

Paikallinen testaus: `node scripts/fetch-games.mjs` ja sitten
`python3 -m http.server` ja selaimella `http://localhost:8000`.

Julkaistessa muutoksia kasvata `APP_VERSION` (`app.js`) ja `CACHE`-nimen
numero (`sw.js`).

Käyttöönotto: Settings → Pages → Source: **GitHub Actions**.
