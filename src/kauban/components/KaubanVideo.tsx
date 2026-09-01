import { useEffect, useState } from "react";
import { Video } from "lucide-react";
import { getVideoPublicUrl } from "../kaubanPublicApi";

/**
 * A sign-video slot that degrades gracefully when the file isn't there
 * yet — `kauban_sign_words` rows can have a path set (from the seed SQL)
 * before the actual file has been uploaded (docs/kauban/PROGRESS.md,
 * milestone 5 was deliberately left partial), so a plain <video src=...>
 * would just show a broken player. Catches that via onError instead.
 */
export function KaubanVideo({ path, className, autoPlay }: { path: string | null; className?: string; autoPlay?: boolean }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => { setFailed(false); }, [path]);

  if (!path || failed) {
    return (
      <div className={`flex flex-col items-center justify-center gap-2 rounded-xl bg-[#4F46E5]/5 text-slate-400 ${className ?? ""}`}>
        <Video size={28} />
        <span className="text-xs">Video not available yet</span>
      </div>
    );
  }

  return (
    <video
      key={path}
      src={getVideoPublicUrl(path)}
      controls
      autoPlay={autoPlay}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
