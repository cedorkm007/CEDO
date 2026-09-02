const PREFIX = "kauban-metadata-cache:";

/**
 * Videos (offlineCaches.ts/videoPlayback.ts) and the speech model
 * (voskRecognition.ts) already work offline through their own caches, but
 * the *word list* a recognized phrase is matched against — fetchSignWords()
 * and the other lookups in kaubanPublicApi.ts — had no offline fallback at
 * all: each one hits Supabase fresh on every call and silently returns []
 * on any failure, network included. Offline, that meant an empty word
 * pool every time, so matchSignWords() could never produce a match even
 * though the matching clip was sitting right there in the video cache —
 * with no error, since an empty match list looks like a legitimate (if
 * unlucky) result rather than a failure.
 *
 * localStorage rather than Cache Storage: this is small, structured JSON
 * (word/category/phrase lists), not binary media, and reading it back
 * needs to be synchronous-cheap and available even before any service
 * worker or Cache Storage call would resolve.
 */
export function getCachedMetadata<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function setCachedMetadata<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage full/unavailable isn't fatal — it just means no offline
    // fallback next time, same as never having fetched successfully yet.
  }
}
