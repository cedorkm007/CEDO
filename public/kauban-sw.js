// Service worker for the Kauban app only (registered with scope "/kauban/"
// from src/main.tsx, conditionally, when isKaubanSite — see docs/kauban/
// PROGRESS.md milestone 16). Not used by the staff app or the public CEDO
// site, which share this Vite build but are not offline-capable.
//
// Stamped with the current deploy's short commit hash by
// stampServiceWorkerCacheVersion() in vite.config.ts at build time —
// this literal only matters in dev, where that step doesn't run. A fixed
// version here (unchanged across many deploys) meant activate's own
// cleanup below never actually fired, since it only deletes cache
// *names* other than the current one: every deploy's content-hashed
// JS/CSS just piled up in the same never-cleared cache indefinitely.
const CACHE_VERSION = "kauban-v3";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const VIDEO_CACHE = `${CACHE_VERSION}-video`;

const VIDEO_URL_MARKER = "/storage/v1/object/public/kauban-media/";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          // Only this SW's own versioned shell/video caches from a prior
          // deploy — NOT "kauban-videos-v1" (offlineCaches.ts's explicit
          // Download-for-Offline cache) or "kauban-vosk-model-v2"
          // (voskRecognition.ts's speech model), which are managed by
          // page code entirely outside this service worker. A plain
          // startsWith("kauban-") here would delete those too on every
          // future deploy now that this file's own bytes change per
          // commit (see CACHE_VERSION above) and reliably trigger this
          // handler — wiping out someone's offline downloads the next
          // time they open the app after any unrelated deploy.
          .filter((key) => /^kauban-.+-(shell|video)$/.test(key) && key !== SHELL_CACHE && key !== VIDEO_CACHE)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Sign/tutorial video clips: cache-on-first-play, so a word or phrase
  // someone has already watched keeps working offline or on flaky data.
  if (url.pathname.includes(VIDEO_URL_MARKER)) {
    event.respondWith(cacheFirst(request, VIDEO_CACHE));
    return;
  }

  // Only handle same-origin app-shell traffic below. Supabase API calls
  // (kauban_* tables) and anything cross-origin other than video clips
  // must always hit the network — caching stale staff-authored content
  // (quick phrases, emergency contacts) would be actively harmful.
  if (url.origin !== self.location.origin) return;

  // Full-page navigations to /kauban*: network-first, so a fresh deploy is
  // picked up immediately; fall back to the cached shell when offline.
  if (request.mode === "navigate" && url.pathname.startsWith("/kauban")) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Hashed, content-addressed build assets (JS/CSS/images) are immutable —
  // safe to serve cache-first and cache indefinitely. The self-hosted Vosk
  // speech model (offline speech recognition — see voskRecognition.ts) is
  // the same story: static, versioned by the app's own deploy, never
  // changes underneath a given build. vosk-browser fetches it from its
  // own internal Web Worker, not from this page directly, but service
  // workers intercept same-origin fetches from any worker in scope too.
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/kauban-icons/") || url.pathname.startsWith("/kauban-vosk-model/")) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}
