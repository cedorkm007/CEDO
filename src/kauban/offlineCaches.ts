// Cache name for offline-downloaded sign-word videos, managed directly
// from page code (offlineVideoDownload.ts writes to it, videoPlayback.ts
// reads from it) rather than relying on kauban-sw.js's own fetch
// interception to populate it.
//
// That reliance was the actual bug behind "downloaded successfully but
// not available in airplane mode": a service worker only intercepts
// fetches once it's actually installed, activated, *and* claiming the
// current page — a fetch() issued before that (or if registration failed
// for any reason, silently swallowed by the .catch() in main.tsx) just
// succeeds normally over the network without ever reaching Cache
// Storage, so "download" reported success while nothing durable actually
// happened. Writing to the cache explicitly here removes that dependency
// entirely — it works whether or not the service worker is behaving.
//
// This name intentionally does NOT need to match kauban-sw.js's own
// VIDEO_CACHE constant — nothing here depends on the service worker
// knowing about or serving from it.
export const VIDEO_CACHE_NAME = "kauban-videos-v1";
