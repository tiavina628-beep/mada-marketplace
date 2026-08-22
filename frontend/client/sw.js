const CACHE_NAME = 'baobab-bazar-client-v1';
const APP_SHELL = [
  './',
  './index.html',
  './politique-confidentialite.html',
  './css/style.css',
  './js/app.js',
  './js/image-utils.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Ne jamais intercepter les requêtes qui modifient des données (panier,
  // commande, paiement...) — elles doivent toujours passer par le réseau.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isApiCall = url.pathname.startsWith('/api/');

  if (isApiCall) {
    // API : priorité au réseau (données fraîches), secours sur le cache
    // si hors-ligne (permet de reparcourir le catalogue déjà vu).
    event.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Fichiers de l'app (HTML/CSS/JS/icônes) : cache d'abord pour un
  // chargement instantané, mise à jour silencieuse en arrière-plan.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
