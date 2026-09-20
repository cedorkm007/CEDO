import { useEffect, useState } from "react";
import { ExportButton } from "@/app/components/ExportButtons";
import type { ScholarInformationRow } from "../seadApi";
import { loadProfileSections, downloadScholarProfile, type ProfileSections } from "../scholarProfileExport";
import { Modal } from "./Modal";
import letterheadUrl from "@/imports/CEDO_Letterhead.png";
import cdeoRisLogoUrl from "@/imports/CdeO_RIS_Logo.png";
import sdgLogoUrl from "@/imports/SDG_Logo.png";

/**
 * "Complete details of the scholar" popup — a printed-page-styled
 * Comprehensive Scholar Profile (Basic Info, SDP completed, Formation
 * attended, Quest subjects) with CSV/PDF/Word download. Self-contained:
 * pass just the scholar row and it loads its own sections. Originally
 * built inline in ScholarListPanel.tsx (Scholarship Program Information's
 * drill-down "Preview"); extracted here so the Scholar Counseling Tool's
 * Daily Records "View" action can open the exact same popup.
 */
export function ScholarProfilePreviewModal({
  scholar, onClose, modalLevel = 0,
}: {
  scholar: ScholarInformationRow;
  onClose: () => void;
  modalLevel?: number;
}) {
  const [sections, setSections] = useState<ProfileSections | null>(null);
  const [downloading, setDownloading] = useState<"csv" | "pdf" | "word" | null>(null);

  useEffect(() => {
    setSections(null);
    loadProfileSections(scholar).then(setSections);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scholar.scholarIdNumber]);

  async function handleDownload(format: "csv" | "pdf" | "word") {
    if (downloading || !sections) return;
    setDownloading(format);
    try {
      await downloadScholarProfile(scholar, format, sections);
    } finally {
      setDownloading(null);
    }
  }

  return (
    <Modal level={modalLevel + 1} title={`Preview — ${scholar.lastName}, ${scholar.firstName} ${scholar.middleName}`.trim()} onClose={onClose}>
      {!sections ? (
        <p className="text-[13px] text-slate-400 text-center py-8">Loading…</p>
      ) : (
        <div className="space-y-4">
          {/* The "page" — sized and margined like a printed letter (same
              CEDO letterhead header / address-and-logos footer as the
              office's other documents), sitting on the modal's own
              light background so it reads as a sheet of paper rather
              than another web panel. Width is fixed to a page-like
              proportion; height is natural/scrolling rather than a
              literal fixed A4 height, since the amount of SDP/Formation/
              Quest data varies per scholar. */}
          <div className="mx-auto w-full max-w-[800px] bg-white shadow-[0_2px_10px_rgba(15,23,42,0.10),0_10px_30px_rgba(15,23,42,0.12)] ring-1 ring-black/5">
            <div className="px-10 pt-8 pb-5 border-b border-slate-200">
              <img src={letterheadUrl} alt="City Education and Development Office" className="h-[52px] w-auto" />
            </div>

            <div className="px-10 py-7 text-[#1a2432]">
              <div className="text-center mb-6">
                <h2 className="text-[16px] font-bold tracking-wide text-[#062444]">COMPREHENSIVE SCHOLAR PROFILE</h2>
                <p className="text-[10.5px] text-slate-500 mt-1">Generated {new Date().toLocaleString()}</p>
              </div>

              <DocSection title="Basic Information">
                <table className="w-full text-[12px] border-collapse">
                  <tbody>
                    {sections.basicInfo.map(b => (
                      <tr key={b.label}>
                        <td className="border border-slate-300 bg-slate-50 font-semibold px-3 py-1.5 w-[38%]">{b.label}</td>
                        <td className="border border-slate-300 px-3 py-1.5">{b.value || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </DocSection>

              <DocSection title={`SDP — Completed Activities (${sections.sdpCompleted.length})`}>
                <DocTable
                  columns={["Activity", "Category", "Date"]}
                  rows={sections.sdpCompleted.map(a => [a.activityName, a.category || "—", a.date || "—"])}
                  emptyMessage="No completed SDP activities."
                />
              </DocSection>

              <DocSection title={`Formation Activities — Attended (${sections.formationAttended.length})`}>
                <DocTable
                  columns={["Activity", "Date", "Venue"]}
                  rows={sections.formationAttended.map(f => [f.activityName, f.dateTime || "—", f.venue || "—"])}
                  emptyMessage="No formation activity attendance recorded."
                />
              </DocSection>

              <DocSection title={`Quest — Subjects (${sections.questSubjects.length})`} last>
                <DocTable
                  columns={["Subject", "Topics Completed", "Score", "Status"]}
                  rows={sections.questSubjects.map(q => [q.subjectName, String(q.topicCount), `${q.percentage.toFixed(1)}%`, q.isCompleted ? "Completed" : "In Progress"])}
                  emptyMessage="No Quest activity recorded."
                />
              </DocSection>
            </div>

            <div className="px-10 py-4 border-t border-slate-200 flex items-center justify-between gap-4">
              <img src={cdeoRisLogoUrl} alt="" className="h-9 w-auto shrink-0" />
              <div className="text-center text-[8.5px] leading-snug text-slate-600">
                <p>2/F POLICE STATION 1, CITY HALL COMPOUND, CAGAYAN DE ORO 9000 PH</p>
                <p>Email: cedo@cagayandeoro.gov.ph | Mobile: +63 929 819 0819 | Facebook: CDO City Scholarships Office</p>
              </div>
              <img src={sdgLogoUrl} alt="" className="h-9 w-auto shrink-0" />
            </div>
          </div>

          <div className="flex items-center justify-center gap-2">
            <ExportButton format="csv" onClick={() => handleDownload("csv")} disabled={!!downloading} label="Download CSV" />
            <ExportButton format="pdf" onClick={() => handleDownload("pdf")} disabled={!!downloading} label="Download PDF" />
            <ExportButton format="word" onClick={() => handleDownload("word")} disabled={!!downloading} label="Download Word" />
          </div>
        </div>
      )}
    </Modal>
  );
}

/** One labeled block of the printed page — a bold section title followed by its table, spaced like the sections of the actual generated document. */
function DocSection({ title, children, last = false }: { title: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={last ? "" : "mb-6"}>
      <p className="text-[11.5px] font-bold uppercase tracking-wide text-[#062444] mb-2 pb-1 border-b-2 border-[#062444]/15">{title}</p>
      {children}
    </div>
  );
}

/** Bordered, print-style table (visible grid lines, shaded header row) rather than the app's usual rounded card + soft border — this is meant to read as part of a printed page. */
function DocTable({ columns, rows, emptyMessage }: { columns: string[]; rows: string[][]; emptyMessage: string }) {
  if (rows.length === 0) {
    return <p className="text-[11.5px] text-slate-400 italic border border-slate-200 px-3 py-2.5">{emptyMessage}</p>;
  }
  return (
    <table className="w-full text-[12px] border-collapse">
      <thead>
        <tr>
          {columns.map(c => <th key={c} className="border border-slate-300 bg-slate-50 text-left font-semibold px-3 py-1.5">{c}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((value, j) => <td key={j} className="border border-slate-300 px-3 py-1.5">{value}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
