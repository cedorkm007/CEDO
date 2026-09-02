import { fetchSignWords, getVideoPublicUrl } from "./kaubanPublicApi";

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
 * This doesn't touch the Cache Storage API directly — it just issues a
 * plain fetch() per video URL. The service worker's own fetch handler
 * already intercepts every request matching the Supabase video path
 * (VIDEO_URL_MARKER in kauban-sw.js) and caches it there, regardless of
 * whether the request came from a <video> element or, as here, a bare
 * fetch() call. Re-running this after videos are already cached is cheap:
 * the service worker resolves those straight from cache without hitting
 * the network again.
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

  // A small concurrency cap rather than firing every request at once —
  // gentler on mobile data and CPU, and avoids handing the service
  // worker dozens of simultaneous large video downloads together.
  const CONCURRENCY = 3;
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < urls.length) {
      const url = urls[nextIndex++];
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
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
