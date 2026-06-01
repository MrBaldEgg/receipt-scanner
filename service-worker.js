const CACHE_NAME = 'receipt-scanner-v1';
const urlsToCache = [
    '/',
    'index.html',
    'app.js',
    '/manifest.json'
];

self.addEventListener('install', event =>{
    event.waitUntil(
        caches.open(CACHE_NAME)
        .then(cache => cache.addAll(urlsToCache))
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
        .then(cachedResponse =>{
            const fetchPromise = fetch(event.request).then(networkresponse => {
                if (networkresponse && networkresponse.status === 200 && networkresponse.type === 'basic') {
                    const responseToCache = networkresponse.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache));
                }
                return networkresponse;
            }).catch(() => cachedResponse);
            return cachedResponse || fetchPromise;
        })
    )
})