import { useEffect, useState } from "react";
import { ExportButton } from "@/app/components/ExportButtons";
import type { ScholarInformationRow } from "../seadApi";
import { loadProfileSections, downloadScholarProfile, type ProfileSections } from "../scholarProfileExport";
import { Modal } from "./Modal";
import { DocPage, DocSection, DocTable, DocFieldTable } from "./DocPage";

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
          <DocPage title="COMPREHENSIVE SCHOLAR PROFILE" subtitle={`Generated ${new Date().toLocaleString()}`}>
            <DocSection title="Basic Information">
              <DocFieldTable fields={sections.basicInfo} />
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
          </DocPage>

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
