import { useState } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Loader2, X } from "lucide-react";
import { formatBytes, queueProgress, queueSummary } from "../storageToolLogic";

export type JobStatus = "waiting" | "uploading" | "done" | "error" | "cancelled";
export interface UploadJob { id: string; name: string; size: number; where: string; status: JobStatus; progress: number; error?: string }

/**
 * The upload panel at the bottom right: one line and one progress bar per file, a Cancel (x) for every file that is waiting or sending, and a
 * summary on top. It stays until the person closes it, so they can see what happened to every file.
 */
export function UploadTray({ jobs, onCancel, onCancelAll, onClear }: { jobs: UploadJob[]; onCancel: (id: string) => void; onCancelAll: () => void; onClear: () => void }) {
  const [open, setOpen] = useState(true);
  if (jobs.length === 0) return null;
  const busy = jobs.some(j => j.status === "waiting" || j.status === "uploading");
  return (
    <section aria-label="Uploads" className="fixed bottom-4 right-4 z-[90] w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-[#e6ecf5] bg-white shadow-2xl">
      <header className="flex items-center justify-between gap-2 rounded-t-xl bg-[#062444] px-4 py-2.5 text-white">
        <div>
          <p className="text-[14px] font-bold">{busy ? "Uploading…" : "Uploads"}</p>
          <p className="text-[13px] text-white/90" aria-live="polite">{queueSummary(jobs)}{busy ? ` · ${queueProgress(jobs)}%` : ""}</p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setOpen(v => !v)} aria-label={open ? "Hide the list" : "Show the list"} aria-expanded={open} className="rounded p-1 hover:bg-white/15">{open ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronUp size={18} aria-hidden="true" />}</button>
          {busy
            ? <button onClick={onCancelAll} className="rounded px-2 py-1 text-[13px] font-bold hover:bg-white/15">Cancel all</button>
            : <button onClick={onClear} aria-label="Close the upload list" className="rounded p-1 hover:bg-white/15"><X size={18} aria-hidden="true" /></button>}
        </div>
      </header>
      {open && (
        <ul tabIndex={0} aria-label="Files in this upload" className="max-h-72 divide-y divide-[#e6ecf5] overflow-y-auto">
          {jobs.map(j => (
            <li key={j.id} className="px-4 py-2.5 text-[14px]">
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate font-semibold text-[#062444]" title={j.name}>{j.name}</p>
                {j.status === "done" && <CheckCircle2 size={17} className="shrink-0 text-green-700" aria-label="Uploaded" />}
                {j.status === "error" && <AlertCircle size={17} className="shrink-0 text-red-700" aria-label="Failed" />}
                {j.status === "uploading" && <Loader2 size={16} className="shrink-0 animate-spin text-[#062444]" aria-label="Uploading" />}
                {(j.status === "waiting" || j.status === "uploading") && (
                  <button onClick={() => onCancel(j.id)} aria-label={`Cancel the upload of ${j.name}`} className="shrink-0 rounded p-1 text-slate-700 hover:bg-[#f7f9fc]"><X size={16} aria-hidden="true" /></button>
                )}
              </div>
              <p className="text-[13px] text-slate-700">{formatBytes(j.size)} · {j.where}</p>
              {(j.status === "uploading" || j.status === "waiting") && (
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={j.progress} aria-label={`Progress of ${j.name}`}>
                  <div className="h-full rounded-full bg-[#00709f] transition-[width]" style={{ width: `${j.status === "waiting" ? 0 : j.progress}%` }} />
                </div>
              )}
              {j.status === "waiting" && <p className="text-[13px] text-slate-700">Waiting for its turn…</p>}
              {j.status === "cancelled" && <p className="text-[13px] text-slate-700">Cancelled.</p>}
              {j.status === "error" && <p role="alert" className="text-[13px] font-semibold text-red-800">{j.error}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
