// Al subir un cambio real a la app, sube también este número. Un nombre de caché
// distinto obliga al navegador a tratarlo como una versión nueva del service worker.
const CACHE_NAME = 'war-ning-v2';
const urlsToCache = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
  self.skipWaiting(); // no esperar a que se cierren todas las pestañas para activarse
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(nombres =>
      Promise.all(
        nombres
          .filter(nombre => nombre !== CACHE_NAME) // borra cachés de versiones anteriores
          .map(nombre => caches.delete(nombre))
      )
    ).then(() => self.clients.claim()) // toma control de las pestañas ya abiertas, sin esperar a recargar
  );
});

self.addEventListener('fetch', event => {
  // Red primero: siempre se intenta traer lo más reciente. Solo se usa la copia
  // guardada si no hay conexión, para que la app siga funcionando sin internet.
  // Así, cada vez que se sube un cambio, se ve de inmediato, sin depender de que
  // alguien recuerde subir también un sw.js con una versión nueva.
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copia = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copia));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
