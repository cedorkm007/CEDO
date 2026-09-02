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
export function KaubanVideo({ path, className, autoPlay, cropTopPercent }: {
  path: string | null;
  className?: string;
  autoPlay?: boolean;
  /**
   * Hides the top N% of the video frame — some clips have a caption
   * baked into the footage itself (not something this app renders) that
   * gives away the answer on the Sign Language Quiz page. Stretches the
   * remaining footage vertically to still fill the same box, rather than
   * leaving a gap where the cropped part was.
   */
  cropTopPercent?: number;
}) {
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

  if (cropTopPercent) {
    // height/top are the standard "crop N% off the top, stretch the rest
    // to fill" math: making the video (1 / (1 - crop)) times taller than
    // its box and shifting it up by exactly the cropped portion's share
    // of that enlarged height means the box's bottom edge lines up with
    // the video's own bottom edge — so this doesn't need object-fit, and
    // native controls (rendered at the video's own bottom edge) still
    // land right at the visible box's bottom rather than off-screen.
    const scale = 1 / (1 - cropTopPercent / 100);
    return (
      <div className={`relative overflow-hidden ${className ?? ""}`}>
        <video
          key={path}
          src={src}
          controls
          autoPlay={autoPlay}
          playsInline
          className="absolute left-0 w-full"
          style={{ top: `-${cropTopPercent * scale}%`, height: `${scale * 100}%` }}
          onError={() => setFailed(true)}
        />
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
