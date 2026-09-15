import { useState } from "react";
import { X, AlertTriangle, HardDriveDownload } from "lucide-react";
import { backfillDriveFilesToStorage } from "../submissionActivitiesApi";

/** One-time migration trigger: moves every Submission Activity file still on Google Drive into the new "submission-uploads" Supabase Storage bucket. Structured exactly like ScholarsTab.tsx's ResetAllPasswordsModal (type-to-confirm, batched progress, a results summary on completion) — safe to re-run any time, since the backfill itself only ever touches rows still missing storage_path. */
export function BackfillDriveFilesModal({ onClose }: { onClose: () => void }) {
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const canConfirm = confirmText.trim().toUpperCase() === "MIGRATE";

  async function handleConfirm() {
    if (!canConfirm || busy) return;
    setBusy(true);
    setError("");
    setProgress(null);
    const result = await backfillDriveFilesToStorage((done, total) => setProgress({ done, total }));
    setBusy(false);
    if (!result.ok) { setError(result.error || "Failed to migrate files."); return; }
    const succeeded = result.succeeded ?? 0;
    const failed = result.failed ?? 0;
    if (succeeded === 0 && failed === 0) {
      window.alert("Every file has already been migrated off Google Drive — nothing left to do.");
    } else if (failed === 0) {
      window.alert(`Migrated ${succeeded} file${succeeded === 1 ? "" : "s"} off Google Drive into Supabase Storage.`);
    } else {
      const failureList = (result.failures ?? []).map(f => `• ${f.fileName}: ${f.error}`).join("\n");
      window.alert(
        `Migrated ${succeeded} file(s); ${failed} failed. You can re-run this safely to retry just the failed ones:\n${failureList}`
      );
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center px-4 py-8 overflow-y-auto" onClick={busy ? undefined : onClose}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4 rounded-t-2xl">
          <span className="flex items-center gap-2 text-white font-bold text-[15px]"><HardDriveDownload size={17} className="text-[#F3BC00]" /> Migrate Drive Files</span>
          <button onClick={onClose} disabled={busy} className="text-white/70 hover:text-white disabled:opacity-40"><X size={18} /></button>
        </div>

        <div className="p-6">
          <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-100 rounded-lg px-3.5 py-3 mb-4">
            <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[12.5px] text-amber-800 leading-relaxed">
              Downloads every Submission Activity file still stored in Google Drive, compresses PDFs, and stores a copy in Supabase Storage.
              The original files in Drive are never touched or deleted. Safe to run more than once — already-migrated files are skipped.
            </p>
          </div>

          <label className="block text-[12.5px] font-semibold text-[#062444] mb-1.5">
            Type <span className="font-mono bg-[#f8fafd] border border-[#e6ecf5] rounded px-1.5 py-0.5">MIGRATE</span> to confirm
          </label>
          <input
            value={confirmText}
            onChange={e => setConfirmText(e.target.value)}
            disabled={busy}
            placeholder="MIGRATE"
            className="w-full text-sm border border-[#062444]/15 rounded-lg px-3 py-2.5 outline-none focus:border-[#0088cc] mb-4"
          />

          {error && <p className="text-[12.5px] text-red-600 mb-3">{error}</p>}

          {busy && (
            <div className="mb-3">
              <p className="text-[12px] text-slate-500 mb-1.5">
                {progress && progress.total > 0
                  ? `Migrating… ${progress.done} / ${progress.total}`
                  : "Starting…"}
              </p>
              <div className="w-full h-1.5 bg-[#f0f3f8] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#0088cc] rounded-full transition-all"
                  style={{ width: progress && progress.total > 0 ? `${Math.min(100, (progress.done / progress.total) * 100)}%` : "10%" }}
                />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button onClick={onClose} disabled={busy} className="text-[13px] font-semibold text-slate-500 hover:text-[#062444] disabled:opacity-40 px-4 py-2.5">
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!canConfirm || busy}
              className="flex items-center gap-2 bg-[#062444] disabled:opacity-40 disabled:cursor-not-allowed text-white text-[13px] font-semibold rounded-lg px-5 py-2.5 hover:bg-[#0a3a6b]"
            >
              {busy ? "Migrating…" : "Migrate Files"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
