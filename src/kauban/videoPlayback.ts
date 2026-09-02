import { getVideoPublicUrl } from "./kaubanPublicApi";
import { VIDEO_CACHE_NAME } from "./offlineCaches";

export interface VideoPlaybackResult {
  url: string;
  /** True if served from the offline cache (see offlineCaches.ts) rather than falling back to the plain network URL. */
  fromCache: boolean;
}

/**
 * Resolves a sign-word video's playback URL, checking the offline cache
 * (populated by offlineVideoDownload.ts, or by kauban-sw.js's own
 * cache-on-first-play when the service worker is behaving) before
 * falling back to the plain network URL. Reading Cache Storage directly
 * here — rather than only setting a <video src> to the network URL and
 * hoping the service worker intercepts and redirects it to cache — is
 * what actually makes offline-downloaded videos play back offline; see
 * offlineCaches.ts for why that indirection wasn't reliable.
 *
 * Returns a blob: URL when served from cache. Callers that store the
 * result in state should revoke it (URL.revokeObjectURL) once done with
 * it — see KaubanVideo.tsx / SpeechToSignLanguagePage.tsx for the
 * pattern. `fromCache` lets a caller tell "this was actually downloaded
 * and is playing from local storage" apart from "this fell back to the
 * network" — useful for showing an accurate message if that network
 * fetch then fails (e.g. genuinely offline with nothing cached), rather
 * than a generic "video not available" that reads like the file was
 * never uploaded at all.
 */
export async function getVideoPlaybackUrl(path: string): Promise<VideoPlaybackResult> {
  const networkUrl = getVideoPublicUrl(path);
  try {
    const cache = await caches.open(VIDEO_CACHE_NAME);
    const cached = await cache.match(networkUrl);
    if (cached) {
      const blob = await cached.blob();
      return { url: URL.createObjectURL(blob), fromCache: true };
    }
  } catch (err) {
    console.error("Cache Storage lookup failed for video playback", err);
  }
  return { url: networkUrl, fromCache: false };
}
