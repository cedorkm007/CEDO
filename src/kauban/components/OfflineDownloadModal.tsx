import { useState } from "react";
import { X, Download, Check, AlertCircle } from "lucide-react";
import { downloadAllVideosForOffline, type DownloadProgress } from "../offlineVideoDownload";

type Status = "idle" | "downloading" | "done";
type ModelStatus = "pending" | "downloading" | "done" | "failed";

/**
 * Proactively caches every sign-word video for offline use, rather than
 * waiting for cache-on-first-play to pick each one up as it's watched
 * (see offlineVideoDownload.ts) — and, alongside that, the offline speech
 * model too (voskRecognition.ts), so a visitor who explicitly prepares
 * for offline use gets everything in one action instead of the model
 * only downloading later, the first time they happen to use the mic
 * while already offline. Triggered from KaubanTopNav's dropdown.
 */
export function OfflineDownloadModal({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState<DownloadProgress>({ completed: 0, total: 0, failed: 0 });
  const [modelStatus, setModelStatus] = useState<ModelStatus>("pending");

  async function handleStart() {
    setStatus("downloading");
    setModelStatus("downloading");
    const [result] = await Promise.all([
      downloadAllVideosForOffline(setProgress),
      // Dynamic import — same reasoning as the speech pages: vosk-browser
      // is large enough that a static import here would pull it into the
      // main app bundle, even though this modal renders on every page.
      import("../voskRecognition")
        .then(({ prefetchVoskModel }) => prefetchVoskModel())
        .then(() => setModelStatus("done"))
        .catch(() => setModelStatus("failed")),
    ]);
    setProgress(result);
    setStatus("done");
  }

  const percent = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-[#2D3748]" style={{ fontFamily: "'Fredoka', sans-serif" }}>Download for Offline</h2>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full text-[#A0AEC0] transition active:scale-90 hover:text-[#718096]" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {status === "idle" && (
          <>
            <p className="mb-5 text-sm text-[#718096]">
              Downloads every sign-language video and the offline speech model (~130MB) now, so they all work without an internet connection later. This can use a fair amount of mobile data — Wi-Fi is recommended.
            </p>
            <button
              onClick={handleStart}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-[#3182CE] py-3 text-sm font-bold text-white transition active:scale-[0.98]"
            >
              <Download size={16} /> Start Download
            </button>
          </>
        )}

        {status === "downloading" && (
          <>
            <p className="mb-2 text-sm text-[#718096]">
              Downloading videos… {progress.completed} of {progress.total}
            </p>
            <div className="mb-3 h-2.5 overflow-hidden rounded-full bg-[#EDF2F7]">
              <div className="h-full rounded-full bg-[#3182CE] transition-all" style={{ width: `${percent}%` }} />
            </div>
            <p className="text-xs text-[#A0AEC0]">
              {modelStatus === "downloading" && "Downloading speech model…"}
              {modelStatus === "done" && "✓ Speech model ready"}
              {modelStatus === "failed" && "Speech model couldn't be downloaded — the mic will still work online."}
            </p>
          </>
        )}

        {status === "done" && (
          <>
            <div className="mb-4 flex items-center gap-2 text-[#38A169]">
              <Check size={20} />
              <p className="text-sm font-semibold">
                {progress.failed > 0
                  ? `Downloaded ${progress.completed - progress.failed} of ${progress.total} videos.`
                  : `All ${progress.total} videos are now available offline.`}
              </p>
            </div>
            {progress.failed > 0 && (
              <div className="mb-4 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-700">
                <AlertCircle size={15} className="mt-0.5 shrink-0" />
                <p>{progress.failed} video{progress.failed === 1 ? "" : "s"} couldn't be downloaded — check your connection and try again.</p>
              </div>
            )}
            {modelStatus === "failed" && (
              <div className="mb-4 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-700">
                <AlertCircle size={15} className="mt-0.5 shrink-0" />
                <p>The offline speech model couldn't be downloaded — check your connection and try again.</p>
              </div>
            )}
            <button
              onClick={onClose}
              className="w-full rounded-full bg-[#EBF8FF] py-3 text-sm font-bold text-[#2B6CB0] transition active:scale-[0.98]"
            >
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}
