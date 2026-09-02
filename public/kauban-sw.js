// Service worker for the Kauban app only (registered with scope "/kauban/"
// from src/main.tsx, conditionally, when isKaubanSite — see docs/kauban/
// PROGRESS.md milestone 16). Not used by the staff app or the public CEDO
// site, which share this Vite build but are not offline-capable.
//
// Bump CACHE_VERSION to invalidate old caches on the next deploy.
const CACHE_VERSION = "kauban-v2";
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
          .filter((key) => key.startsWith("kauban-") && key !== SHELL_CACHE && key !== VIDEO_CACHE)
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
  // safe to serve cache-first and cache indefinitely. The self-hosted ONNX
  // WASM runtime (offline Whisper speech recognition — see
  // whisperWorker.ts) is the same story: static, versioned by the app's
  // own deploy, never changes underneath a given build.
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/kauban-icons/") || url.pathname.startsWith("/kauban-onnx-wasm/")) {
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
