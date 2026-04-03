const CACHE_NAME = 'fogocska-cache-v1';
const urlsToCache = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Visszaadjuk a cachelt verziót ha létezik, különben netről lehúzzuk
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
  );
});
