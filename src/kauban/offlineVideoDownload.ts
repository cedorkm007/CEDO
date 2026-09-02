import { fetchSignWords, getVideoPublicUrl } from "./kaubanPublicApi";
import { VIDEO_CACHE_NAME } from "./offlineCaches";

export interface DownloadProgress {
  completed: number;
  total: number;
  failed: number;
}

/**
 * Proactively caches every sign-word video (clip + tutorial) for offline
 * use, rather than relying only on cache-on-first-play (kauban-sw.js),
 * which only caches a clip after someone has already watched it once.
 *
 * Writes directly to Cache Storage (see offlineCaches.ts for why this
 * doesn't just fetch() and hope the service worker intercepts it) —
 * paired with videoPlayback.ts, which reads from the same cache when
 * rendering a <video>. Re-running this after videos are already cached
 * is cheap: already-cached URLs are skipped without a network request.
 */
export async function downloadAllVideosForOffline(
  onProgress: (progress: DownloadProgress) => void
): Promise<DownloadProgress> {
  const words = await fetchSignWords();
  const paths = new Set<string>();
  for (const word of words) {
    if (word.clipVideoPath) paths.add(word.clipVideoPath);
    if (word.tutorialVideoPath) paths.add(word.tutorialVideoPath);
  }
  const urls = Array.from(paths, getVideoPublicUrl);

  let completed = 0;
  let failed = 0;
  const total = urls.length;
  onProgress({ completed, total, failed });

  const cache = await caches.open(VIDEO_CACHE_NAME);

  // A small concurrency cap rather than firing every request at once —
  // gentler on mobile data and CPU.
  const CONCURRENCY = 3;
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < urls.length) {
      const url = urls[nextIndex++];
      try {
        const alreadyCached = await cache.match(url);
        if (!alreadyCached) {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          await cache.put(url, response);
        }
      } catch {
        failed++;
      }
      completed++;
      onProgress({ completed, total, failed });
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker));
  return { completed, total, failed };
}
