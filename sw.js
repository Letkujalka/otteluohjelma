// Välimuisti, jotta sovellus aukeaa ilman verkkoyhteyttäkin.
// Päivitys: kasvata CACHE-numeroa, kun sovelluksen tiedostot muuttuvat.
const CACHE = 'otteluohjelma-5';
const FILES = ['./', './index.html', './style.css', './app.js', './manifest.webmanifest',
  './config.json', './games.json',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png'];
const DATA = ['config.json', 'games.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const isData = DATA.some(f => url.pathname.endsWith('/' + f));
  e.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(e.request, { ignoreSearch: true });
    const fresh = fetch(e.request).then(res => {
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    });
    fresh.catch(() => {}); // ei verkkoa: käsitellään alla
    // Otteluohjelma: ensin verkosta, ilman verkkoa välimuistista.
    if (isData) return fresh.catch(() => cached || Response.error());
    // Sovellus: heti välimuistista, uusi versio taustalla seuraavaa avausta varten.
    return cached || fresh.catch(() => cached);
  }));
});
