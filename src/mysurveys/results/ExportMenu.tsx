import { useEffect, useRef, useState } from "react";
import { Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { exportSurvey, type ExportFormat } from "./exportSurvey";

/**
 * "Export" for a survey's responses: CSV or Excel, one row per response and one
 * column per question (a reworded question gets one column per version). Lives
 * in the shared results panel, so it appears both in My Surveys > View Responses
 * and in the Research Project Monitoring tool.
 */
export function ExportMenu({ surveyId }: { surveyId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function outside(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    function esc(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", esc); };
  }, [open]);

  async function run(format: ExportFormat) {
    setOpen(false);
    setBusy(format); setMessage(null); setProgress(null);
    try {
      const res = await exportSurvey(surveyId, format, (done, total) => setProgress({ done, total }));
      setMessage(res.ok
        ? { kind: "ok", text: `Exported ${res.responses} response${res.responses === 1 ? "" : "s"} to ${res.fileName}.` }
        : { kind: "error", text: res.error });
    } catch {
      setMessage({ kind: "error", text: "The export failed. Please try again." });
    }
    setBusy(null); setProgress(null);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)} disabled={busy !== null} aria-haspopup="menu" aria-expanded={open}
        className="flex items-center gap-1.5 rounded-lg border border-[#e6ecf5] px-3 py-1.5 text-[12px] font-semibold text-[#062444] hover:bg-[#f7f9fc] disabled:opacity-60"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
        {busy ? (progress ? `Exporting ${progress.done}/${progress.total}…` : "Exporting…") : "Export"}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-9 z-20 w-52 rounded-xl border border-[#e6ecf5] bg-white py-1.5 text-[12.5px] shadow-lg">
          <button role="menuitem" onClick={() => void run("xlsx")} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[#062444] hover:bg-[#f7f9fc]">
            <FileSpreadsheet size={14} className="text-green-700" /> Excel (.xlsx)
          </button>
          <button role="menuitem" onClick={() => void run("csv")} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[#062444] hover:bg-[#f7f9fc]">
            <FileText size={14} className="text-slate-500" /> CSV (.csv)
          </button>
        </div>
      )}
      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={`absolute right-0 top-9 z-10 w-64 rounded-lg px-3 py-2 text-[11.5px] font-medium shadow ${message.kind === "error" ? "bg-red-50 text-red-700" : "bg-green-50 text-green-800"}`}>
          {message.text}
          <button onClick={() => setMessage(null)} className="ml-2 font-bold underline">OK</button>
        </p>
      )}
    </div>
  );
}
