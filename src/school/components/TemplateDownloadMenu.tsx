import { useEffect, useRef, useState } from "react";
import { Download, FileSpreadsheet, FileText, X } from "lucide-react";
import type { PeriodRef } from "@/lib/academicPeriods";
import { downloadGradeTemplate, downloadPromoTemplate } from "../templateDownload";
import { focusRing } from "./portalParts";
import type { SchoolScholarRow } from "../types";

/**
 * "Download template": asks which template the school wants before downloading it.
 *   Pre-filled — the Promotional Report / Enrollment List (Excel) with the school's scholars, their School IDs and the subjects already declared;
 *   Blank — the same Excel sheet with only the title block and headings, for the school to fill in itself;
 *   the earlier CSV layout (matched by Scholar ID) is still available as a small link.
 * Used by the scholars toolbar and by the bulk upload window, so both ask the same question.
 */
export function TemplateDownloadMenu({ scholars, period, schoolName, disabled, buttonClassName, label = "Download template", percentageEntry }: {
  scholars: SchoolScholarRow[]; period: PeriodRef; schoolName: string; disabled?: boolean; buttonClassName: string; label?: string;
  /** The school enters percentages: the GRADES column of the pre-filled sheet shows each subject's percentage. */
  percentageEntry?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"" | "prefilled" | "blank" | "csv">("");
  const [error, setError] = useState("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("keydown", onKey); document.addEventListener("mousedown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDown); };
  }, [open]);

  async function choose(kind: "prefilled" | "blank" | "csv") {
    setBusy(kind); setError("");
    const r = kind === "csv" ? await downloadGradeTemplate(scholars, period) : await downloadPromoTemplate({ schoolName, scholars, period, blank: kind === "blank", percentageEntry });
    setBusy("");
    if (!r.ok) { setError(`Couldn't prepare the template: ${r.error}`); return; }
    setOpen(false);
  }

  return (
    <div ref={box} className="relative inline-block">
      <button type="button" onClick={() => { setOpen(o => !o); setError(""); }} disabled={disabled} aria-haspopup="dialog" aria-expanded={open} className={buttonClassName}>
        <Download size={15} aria-hidden="true" /> {label}
      </button>
      {open && (
        <div role="dialog" aria-label="Which template do you want?" className="absolute left-0 z-30 mt-2 w-[min(22rem,90vw)] rounded-xl border border-[#062444]/20 bg-white p-4 shadow-xl">
          <div className="mb-2 flex items-start justify-between gap-2">
            <p className="text-[14.5px] font-bold text-[#062444]">Which template do you want?</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className={`rounded p-0.5 text-slate-700 hover:text-[#062444] ${focusRing}`}><X size={16} aria-hidden="true" /></button>
          </div>
          <button type="button" onClick={() => void choose("prefilled")} disabled={busy !== "" || scholars.length === 0}
            className={`mb-2 flex w-full items-start gap-2.5 rounded-lg border border-[#062444]/25 px-3 py-2.5 text-left hover:bg-[#f7f9fc] disabled:opacity-50 ${focusRing}`}>
            <FileSpreadsheet size={18} className="mt-0.5 shrink-0 text-[#0077b6]" aria-hidden="true" />
            <span>
              <span className="block text-[14px] font-semibold text-[#062444]">{busy === "prefilled" ? "Preparing…" : "Pre-filled with my scholars"}</span>
              <span className="block text-[13.5px] text-slate-700">Your scholars with their School ID, year level and the subjects and grades already saved. Type the grades.</span>
            </span>
          </button>
          <button type="button" onClick={() => void choose("blank")} disabled={busy !== ""}
            className={`mb-2 flex w-full items-start gap-2.5 rounded-lg border border-[#062444]/25 px-3 py-2.5 text-left hover:bg-[#f7f9fc] disabled:opacity-50 ${focusRing}`}>
            <FileText size={18} className="mt-0.5 shrink-0 text-[#0077b6]" aria-hidden="true" />
            <span>
              <span className="block text-[14px] font-semibold text-[#062444]">{busy === "blank" ? "Preparing…" : "Blank"}</span>
              <span className="block text-[13.5px] text-slate-700">The empty Promotional Report / Enrollment List for this period. You fill in the students and subjects.</span>
            </span>
          </button>
          <p className="text-[13.5px] text-slate-700">Both are Excel files (.xlsx). <button type="button" onClick={() => void choose("csv")} disabled={busy !== ""} className="font-semibold text-[#0077b6] underline disabled:opacity-50">{busy === "csv" ? "Preparing…" : "Download the older CSV layout instead"}</button></p>
          {error && <p role="alert" className="mt-2 text-[13.5px] text-red-800">{error}</p>}
        </div>
      )}
    </div>
  );
}
