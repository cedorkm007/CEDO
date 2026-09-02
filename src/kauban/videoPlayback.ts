import { getVideoPublicUrl } from "./kaubanPublicApi";
import { VIDEO_CACHE_NAME } from "./offlineCaches";

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
 * pattern.
 */
export async function getVideoPlaybackUrl(path: string): Promise<string> {
  const networkUrl = getVideoPublicUrl(path);
  try {
    const cache = await caches.open(VIDEO_CACHE_NAME);
    const cached = await cache.match(networkUrl);
    if (cached) {
      const blob = await cached.blob();
      return URL.createObjectURL(blob);
    }
  } catch {
    // Cache Storage unavailable for some reason — fall through to the
    // plain network URL rather than failing playback outright.
  }
  return networkUrl;
}
