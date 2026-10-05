/**
 * Mealy Machine Studio — service worker.
 *
 * This file is a BUILD TEMPLATE. It is not served as-is: `pwa-build.mjs`
 * copies it to `dist/sw.js` and injects the content-hashed build version and
 * the precache list, so the file is always paired with the exact assets that
 * were deployed. See the "build-injected" block below.
 *
 * Design rules, in order of importance:
 *  1. Never cache anything user-specific. This app keeps a user's machine in
 *     localStorage, and this worker never reads, writes, syncs or clears it —
 *     offline data survives updates and uninstallation is a browser concern.
 *  2. Only ever touch same-origin GET requests for this app's own static
 *     files. Writes, cross-origin requests (fonts, APIs) and anything that
 *     looks like an auth/session endpoint are passed straight to the network.
 *  3. Never serve a half-built cache. `addAll` is atomic and `activate`
 *     deletes every previous version, so a user is never pinned to old files.
 */

/* --- build-injected (do not edit) --- */
const BUILD = '__BUILD_VERSION__'
const PRECACHE = [__PRECACHE_MANIFEST__]
/* --- end build-injected --- */

const CACHE = `mealy-studio-${BUILD}`
const SHELL = './index.html'

// Paths that must never be written to a cache, whatever the request looks like.
const NEVER_CACHE =
  /\/api\/|\/auth\/|\/login|\/logout|\/signout|\/token|\/session|\/csrf|\/graphql|\/rest\/|xmlrpc\.php|wp-json/i

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      const entries = PRECACHE.includes(SHELL) ? PRECACHE : [...PRECACHE, SHELL]
      // Atomic: if any file 404s the whole install rejects and the new version
      // never activates, so the previous version keeps serving.
      await cache.addAll(entries)
      // First ever install has no active worker to displace, so take over now
      // and become offline-capable without asking the user to reload.
      if (!self.registration.active) await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((key) => key.startsWith('mealy-studio-') && key !== CACHE)
          .map((key) => caches.delete(key)),
      )
      await self.clients.claim()
    })(),
  )
})

/** Same-origin, basic, successful — the only responses allowed into a cache. */
function storable(response) {
  return Boolean(response) && response.ok && response.status === 200 && response.type === 'basic'
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(request)
  if (hit) return hit
  const response = await fetch(request)
  if (storable(response)) cache.put(request, response.clone())
  return response
}

async function networkFirstShell(request) {
  const cache = await caches.open(CACHE)
  try {
    const response = await fetch(request)
    // Keep the newest HTML as the offline shell, but only if the server really
    // served the app (a 404 must not overwrite it).
    if (storable(response)) cache.put(SHELL, response.clone())
    return response
  } catch {
    const shell = (await cache.match(SHELL)) || (await cache.match('./'))
    return shell || Response.error()
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  if (request.headers.has('authorization')) return
  if (request.cache === 'no-store') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (NEVER_CACHE.test(url.pathname)) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstShell(request))
    return
  }
  event.respondWith(cacheFirst(request))
})

self.addEventListener('message', (event) => {
  const data = event.data
  if (!data || typeof data !== 'object') return

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting()
    return
  }

  if (data.type === 'GET_VERSION') {
    const port = event.ports && event.ports[0]
    if (port) port.postMessage({ version: BUILD, cache: CACHE })
    return
  }

  // Escape hatch: drop everything this worker cached and let the page reload.
  if (data.type === 'RESET_CACHE') {
    event.waitUntil(
      (async () => {
        await caches.delete(CACHE)
        const clients = await self.clients.matchAll()
        clients.forEach((client) => client.postMessage({ type: 'CACHE_RESET' }))
      })(),
    )
  }
})
