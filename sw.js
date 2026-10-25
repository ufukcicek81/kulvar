/* Kulvar service worker: çevrimdışı önbellek ve bildirim tıklaması. */
const CACHE = 'kulvar-v1.2.0';
const ASSETS = [
  './', './index.html', './styles.css', './data.js', './app.js', './manifest.webmanifest', './data/sonuclar.json',
  './icons/logo.svg', './icons/logo-dark.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/favicon-32.png', './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// Önce ağ, olmazsa önbellek: güncellemeler hemen gelir, internet yoksa uygulama yine açılır.
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(function (res) {
    const copy = res.clone();
    caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
    return res;
  }).catch(function () {
    return caches.match(e.request, { ignoreSearch: true }).then(function (r) { return r || caches.match('./index.html'); });
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.link) || '#/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    if (list.length) { list[0].focus(); list[0].postMessage({ link: link }); return; }
    return self.clients.openWindow('./index.html' + link);
  }));
});
