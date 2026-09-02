import { useEffect, useState } from "react";
import { Video } from "lucide-react";
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
 * play back offline.
 */
export function KaubanVideo({ path, className, autoPlay }: { path: string | null; className?: string; autoPlay?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    setFailed(false);
    setSrc(null);
    if (!path) return;

    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      const url = await getVideoPlaybackUrl(path);
      if (cancelled) return;
      if (url.startsWith("blob:")) objectUrl = url;
      setSrc(url);
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  if (!path || failed) {
    return (
      <div className={`flex flex-col items-center justify-center gap-2 rounded-xl bg-[#3182CE]/5 text-[#A0AEC0] ${className ?? ""}`}>
        <Video size={28} />
        <span className="text-xs">Video not available yet</span>
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
