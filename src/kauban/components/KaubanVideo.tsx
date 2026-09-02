import { useEffect, useState } from "react";
import { Video, WifiOff } from "lucide-react";
import { getVideoPlaybackUrl } from "../videoPlayback";

/**
 * A sign-video slot that degrades gracefully when the file isn't there
 * yet — `kauban_sign_words` rows can have a path set (from the seed SQL)
 * before the actual file has been uploaded (docs/kauban/PROGRESS.md,
 * milestone 5 was deliberately left partial), so a plain <video src=...>
 * would just show a broken player. Catches that via onError instead.
 *
 * Resolves its src through getVideoPlaybackUrl() (async, since it checks
 * the offline video cache first) rather than a plain public URL — see
 * offlineCaches.ts for why that's what actually makes downloaded videos
 * play back offline. Distinguishes "this was never downloaded and we're
 * offline" from a genuine missing-upload, rather than showing the same
 * generic message for both — the two need very different next steps
 * from whoever's looking at it.
 */
export function KaubanVideo({ path, className, autoPlay }: { path: string | null; className?: string; autoPlay?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const [servedFromCache, setServedFromCache] = useState(false);

  useEffect(() => {
    setFailed(false);
    setSrc(null);
    if (!path) return;

    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      const { url, fromCache } = await getVideoPlaybackUrl(path);
      if (cancelled) return;
      if (url.startsWith("blob:")) objectUrl = url;
      setServedFromCache(fromCache);
      setSrc(url);
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  if (!path) {
    return (
      <div className={`flex flex-col items-center justify-center gap-2 rounded-xl bg-[#3182CE]/5 text-[#A0AEC0] ${className ?? ""}`}>
        <Video size={28} />
        <span className="text-xs">Video not available yet</span>
      </div>
    );
  }

  if (failed) {
    // Not served from cache and playback still failed: almost certainly
    // "no connection and this wasn't downloaded ahead of time", not a
    // missing upload — those are different problems for whoever sees it.
    return (
      <div className={`flex flex-col items-center justify-center gap-2 rounded-xl bg-[#3182CE]/5 text-[#A0AEC0] ${className ?? ""}`}>
        {servedFromCache ? <Video size={28} /> : <WifiOff size={28} />}
        <span className="px-3 text-center text-xs">
          {servedFromCache ? "This video couldn't be played." : "This video needs a connection, or download it for offline first."}
        </span>
      </div>
    );
  }

  if (!src) {
    return (
      <div className={`flex flex-col items-center justify-center gap-2 rounded-xl bg-[#3182CE]/5 text-[#A0AEC0] ${className ?? ""}`}>
        <span className="text-xs">Loading…</span>
      </div>
    );
  }

  return (
    <video
      key={path}
      src={src}
      controls
      autoPlay={autoPlay}
      playsInline
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
