// Offline-first service worker. Runtime-caches the app shell and fingerprinted
// static assets so the SPA loads on a cold start while
// offline. API/auth requests are never cached — writes are handled by the
// in-app offline save queue (IndexedDB). After the first online visit, a nurse
// can reopen the installed app offline and the form will render.

// __SW_VERSION__ is replaced at build time with a hash of the built asset names
// (see the stamp-service-worker plugin in vite.config.ts) so a deploy changes
// the cache name and 'activate' purges the stale shell. In dev the literal token
// is harmless (it is just part of the cache key string).
const CACHE = 'stpaul-shell-__SW_VERSION__'
const OFFLINE_URL = '/index.html'
const PRECACHE_URLS = [
  '/',
  OFFLINE_URL,
  '/favicon.svg',
  '/manifest.webmanifest',
  /* __SW_PRECACHE__ */
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(async (cache) => {
        const urls = [...new Set(PRECACHE_URLS)]
        await cache.addAll(urls.slice(0, 4))
        await Promise.allSettled(urls.slice(4).map((url) => cache.add(url)))
        await self.skipWaiting()
      }),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  if (request.method !== 'GET') {
    return
  }

  const url = new URL(request.url)

  if (url.origin !== self.location.origin) {
    return
  }

  // Never cache API/auth/realtime — the offline queue owns write resilience.
  if (
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/sanctum') ||
    url.pathname.startsWith('/broadcasting')
  ) {
    return
  }

  // App navigations: network-first, fall back to the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches
            .open(CACHE)
            .then((cache) => cache.put(OFFLINE_URL, copy))
            .catch(() => {})
          return response
        })
        .catch(() =>
          caches.match(OFFLINE_URL).then((cached) => cached ?? caches.match('/')),
        ),
    )
    return
  }

  // Static assets (hashed JS/CSS/fonts/images): stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone()
            caches
              .open(CACHE)
              .then((cache) => cache.put(request, copy))
              .catch(() => {})
          }
          return response
        })
        .catch(() => cached)

      return cached ?? network
    }),
  )
})
