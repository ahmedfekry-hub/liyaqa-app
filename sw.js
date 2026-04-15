self.addEventListener('install', (event) => {
  event.waitUntil(caches.open('liyaqa-v1').then(cache => cache.addAll(['./', './index.html', './styles.css', './app.js', './config.js'])));
});
self.addEventListener('fetch', (event) => {
  event.respondWith(caches.match(event.request).then(resp => resp || fetch(event.request)));
});
