import { useEffect, useRef, useState } from "react";
import { FileText, FileType2, Loader2, X } from "lucide-react";
import { downloadClearances, type ClearanceFormat } from "../clearanceDownload";
import type { SchoolRenewalRow } from "../renewalMonitorLogic";
import { focusRing } from "./portalParts";

/**
 * "Download clearances": the pre-filled clearance (the office's Recommendation for Scholarship Renewal form) for every scholar in the list below who has an INC or a failed grade, two to an A4 page,
 * as a Word file or a PDF. It follows the filters: only the scholars the school is looking at. The school's guidance counselor fills in the recommendation and signs it by hand.
 */
export function ClearanceDownloadMenu({ rows, schoolId, schoolName, basisSchoolYear, basisTerm }: {
  rows: SchoolRenewalRow[]; schoolId: string; schoolName: string; basisSchoolYear: string; basisTerm: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"" | ClearanceFormat>("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("keydown", onKey); document.addEventListener("mousedown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDown); };
  }, [open]);

  async function choose(format: ClearanceFormat) {
    setBusy(format); setMessage(null);
    const r = await downloadClearances(rows, format, { schoolId, schoolName, basisSchoolYear, basisTerm });
    setBusy("");
    if (!r.ok) { setMessage({ ok: false, text: `Couldn't prepare the clearances: ${r.error}` }); return; }
    setMessage({ ok: true, text: `Downloaded ${r.count} clearance${r.count === 1 ? "" : "s"}.` });
    setOpen(false);
  }

  const pages = Math.ceil(rows.length / 2);
  return (
    <div ref={box} className="relative inline-block">
      <button type="button" onClick={() => { setOpen(o => !o); setMessage(null); }} aria-haspopup="dialog" aria-expanded={open}
        className={`inline-flex items-center gap-2 rounded-lg border border-[#062444]/40 bg-white px-4 py-2 text-[14px] font-semibold text-[#062444] hover:bg-[#f7f9fc] ${focusRing}`}>
        <FileText size={15} aria-hidden="true" /> Download clearances ({rows.length})
      </button>
      {open && (
        <div role="dialog" aria-label="Download the clearances" className="absolute left-0 z-30 mt-2 w-[min(22rem,90vw)] rounded-xl border border-[#062444]/20 bg-white p-4 shadow-xl">
          <div className="mb-2 flex items-start justify-between gap-2">
            <p className="text-[14.5px] font-bold text-[#062444]">{rows.length} clearance{rows.length === 1 ? "" : "s"}, {pages} page{pages === 1 ? "" : "s"}</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className={`rounded p-0.5 text-slate-700 hover:text-[#062444] ${focusRing}`}><X size={16} aria-hidden="true" /></button>
          </div>
          <p className="mb-3 text-[13.5px] text-slate-700">For the scholars below with an INC or a failed grade (the filters you chose apply). Two to an A4 page. The name, school, course and year, semester, Scholar ID, contact number and GWA are filled in; the guidance counselor fills in the recommendation and signs.</p>
          <button type="button" onClick={() => void choose("docx")} disabled={busy !== ""}
            className={`mb-2 flex w-full items-start gap-2.5 rounded-lg border border-[#062444]/25 px-3 py-2.5 text-left hover:bg-[#f7f9fc] disabled:opacity-50 ${focusRing}`}>
            {busy === "docx" ? <Loader2 size={18} className="mt-0.5 shrink-0 animate-spin text-[#0077b6]" aria-hidden="true" /> : <FileType2 size={18} className="mt-0.5 shrink-0 text-[#0077b6]" aria-hidden="true" />}
            <span><span className="block text-[14px] font-semibold text-[#062444]">{busy === "docx" ? "Preparing…" : "Word (.docx)"}</span><span className="block text-[13.5px] text-slate-700">The office's own form. You can still edit it before printing.</span></span>
          </button>
          <button type="button" onClick={() => void choose("pdf")} disabled={busy !== ""}
            className={`flex w-full items-start gap-2.5 rounded-lg border border-[#062444]/25 px-3 py-2.5 text-left hover:bg-[#f7f9fc] disabled:opacity-50 ${focusRing}`}>
            {busy === "pdf" ? <Loader2 size={18} className="mt-0.5 shrink-0 animate-spin text-[#0077b6]" aria-hidden="true" /> : <FileText size={18} className="mt-0.5 shrink-0 text-[#0077b6]" aria-hidden="true" />}
            <span><span className="block text-[14px] font-semibold text-[#062444]">{busy === "pdf" ? "Preparing…" : "PDF"}</span><span className="block text-[13.5px] text-slate-700">Ready to print, fixed layout.</span></span>
          </button>
        </div>
      )}
      {message && <p role={message.ok ? "status" : "alert"} className={`mt-2 text-[14px] ${message.ok ? "font-semibold text-green-800" : "text-red-800"}`}>{message.text}</p>}
    </div>
  );
}
