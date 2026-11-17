# Otteluohjelma

Kännykkään asennettava web-sovellus (PWA), joka näyttää suosikkijoukkueiden
pelit ja palvelun, josta pelin näkee: MTV Katsomo, Disney+ tai Yle
(Areena, TV1, TV2). Mukana ovat myös kaikki Mestarien liigan ottelut. Tehty samalla tavalla kuin Salitreeni.

## Asennus puhelimeen (Android / Chrome)

1. Avaa Chromessa https://letkujalka.github.io/otteluohjelma/
2. Valitse Chromen valikosta ⋮ **Lisää aloitusnäytölle** / **Asenna sovellus**.

## Toiminta

- **Välilehdet:** Tänään, Huomenna, Viikko (tänään + 6 päivää päivittäin
  ryhmiteltynä) ja Myöhemmin (noin 3 viikkoa eteenpäin). Välilehteä vaihdetaan
  pyyhkäisemällä sivuttain tai napauttamalla. Tänään-välilehden lopussa ovat
  eilisen tulokset.
- **Ottelukortti:** kellonaika (Suomen aikaa), sarja, joukkueet (suosikki
  lihavoituna) ja palvelu. Palvelunappi avaa palvelun. Käynnissä olevassa
  pelissä näkyy LIVE ja tilanne, päättyneessä lopputulos.
- **Vaihda:** jos palvelu on väärin, kortin "Vaihda"-linkistä valitaan sarjalle
  oikea palvelu.
- **Asetukset (⚙):** suosikit valitaan kategorioittain (Mestarien liiga,
  LaLiga, Liiga, Maajoukkueet) kategorian joukkuelistasta. Suosikin kaikki
  pelit näkyvät, myös muissa sarjoissa. Kategoriassa voi lisäksi valita
  "Näytä kaikki ottelut" (oletuksena päällä Mestarien liigassa). Oletussuosikit:
  SaiPa, Real Madrid, FC Barcelona, Suomi (myös U21 ja U19), Espanja, Ranska ja
  Englanti. Asetukset tallentuvat vain puhelimeen.

## Mistä pelit tulevat

GitHub Actions ajaa `scripts/fetch-games.mjs`-skriptin kahden tunnin välein.
Skripti hakee kategorioiden kaikki pelit ja joukkuelistat ja kirjoittaa ne
tiedostoon `games.json`, jonka sovellus lataa ja suodattaa suosikkien mukaan.
Ystävyysotteluista ja Copa del Reystä otetaan vain pelit, joissa on kategorian
tuttu joukkue.

- **Jalkapallo:** ESPN:n avoin otteluohjelma (`site.api.espn.com`).
- **Suomen U21 ja U19:** UEFA:n otteluohjelma (`match.uefa.com`), EM-kisat ja
  niiden karsinnat.
- **Liiga:** liiga.fi:n otteluohjelma (`liiga.fi/api/v2/games`).

MTV Katsomolla ja Disney+:lla ei ole julkista ohjelmatietoa, joten palvelu
päätellään sarjasta (`config.json`). Oletukset kaudelle 2026–27:

| Sarja | Palvelu |
|---|---|
| Liiga | MTV Katsomo |
| LaLiga, Copa del Rey, Supercopa | Disney+ |
| Mestarien liiga (kaikki ottelut) | MTV Katsomo |
| Muiden maajoukkueiden karsinnat ja Kansojen liiga | MTV Katsomo |
| Huuhkajat, Suomi U21 ja U19 | Yle (Areena, TV1, TV2) |
| Maaottelut (ystävyysottelut) | ei tiedossa |

## Joukkueiden ja sarjojen muokkaus

Muokkaa tiedostoa `config.json`:

- `categories`: kategoriat, niiden oletussuosikit (`defaults`, nimet suomeksi
  kuten sovelluksessa) ja `all` (näytä oletuksena kaikki ottelut).
- `competitions`: sarjat ja niiden kategoria (`cat`). `slug` on ESPN:n
  sarjatunnus (esim. `esp.1`, `uefa.champions`); `teams: true` hakee sarjan
  joukkuelistan. Nuorten sarjoissa (`source: uefa`) `teams` rajaa joukkueet.
- `teamServices`: joukkueen palvelu, joka ohittaa sarjan palvelun.
- `services`: palvelut, niiden linkit ja värit.
- `names`: lähteiden nimien suomennokset.

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
