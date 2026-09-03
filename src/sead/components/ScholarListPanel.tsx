import { useState } from "react";
import { Download, ChevronDown, ChevronUp, FileSpreadsheet, FileText, FileType2 } from "lucide-react";
import type { ScholarInformationRow } from "../seadApi";
import { fetchScholarQuestProgress } from "../seadApi";
import { fetchScholarSDPHistory } from "../sdpMonitorApi";
import { fetchScholarFormationAttendance } from "../formationActivitiesApi";
import { toCsv, downloadCsv } from "../csvUtils";
import { exportTableAsPdf, exportComprehensiveScholarProfilePdf } from "../pdfTableExport";
import { generateScholarsInformationReport, generateComprehensiveScholarProfile } from "@/lib/docGenerator";

/** Fetches every subsystem section needed for one scholar's comprehensive profile, in parallel. */
async function loadProfileSections(r: ScholarInformationRow) {
  const [sdp, quest, formation] = await Promise.all([
    fetchScholarSDPHistory(r.scholarIdNumber),
    fetchScholarQuestProgress(r.scholarIdNumber),
    fetchScholarFormationAttendance(r.scholarIdNumber),
  ]);
  return {
    basicInfo: [
      { label: "Scholar ID", value: r.scholarIdNumber },
      { label: "Name", value: `${r.lastName}, ${r.firstName} ${r.middleName}`.trim() },
      { label: "School", value: r.school || "" },
      { label: "Course", value: r.course || "" },
      { label: "Year Level", value: r.yearLevel || "" },
      { label: "Status", value: r.status || "" },
      { label: "Barangay", value: r.barangay || "" },
      { label: "Birthday", value: r.birthday || "" },
      { label: "Civil Status", value: r.civilStatus || "" },
      { label: "Contact No.", value: r.contactNo || "" },
    ],
    sdpCompleted: sdp.attended.map(a => ({ activityName: a.activityName, category: a.category || "", date: a.date })),
    formationAttended: formation.map(f => ({ activityName: f.activityName, dateTime: f.dateTime, venue: f.venue })),
    questSubjects: quest.map(q => ({ subjectName: q.subjectName, topicCount: q.topicCount, percentage: q.percentage, isCompleted: q.isCompleted })),
  };
}

const EXPORT_COLUMNS: { label: string; value: (r: ScholarInformationRow) => string; weight?: number }[] = [
  { label: "Scholar ID", value: r => r.scholarIdNumber },
  { label: "Name", value: r => `${r.lastName}, ${r.firstName} ${r.middleName}`.trim(), weight: 1.6 },
  { label: "School", value: r => r.school || "" },
  { label: "Course", value: r => r.course || "" },
  { label: "Year Level", value: r => r.yearLevel || "" },
];

/**
 * A collapsible scholar list with CSV/PDF/Word export — reused at every
 * drill-down level in the Scholarship Program Information tab (Barangay,
 * School, Year Level, Course), since the spec calls for the identical
 * "expand + download as csv/pdf/word" affordance at each one. `rows` is
 * expected to already be the fully-filtered result for whatever this
 * panel represents (e.g. one barangay's scholars).
 */
export function ScholarListPanel({
  title, rows, filtersSummary, filenamePrefix, defaultExpanded = false,
}: {
  title: string;
  rows: ScholarInformationRow[];
  filtersSummary: string;
  filenamePrefix: string;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingWord, setExportingWord] = useState(false);
  const busy = exportingCsv || exportingPdf || exportingWord;
  // Which scholar's profile is currently being generated, and in which format — drives the per-row spinner/disabled state.
  const [profileDownloading, setProfileDownloading] = useState<{ id: string; format: "csv" | "pdf" | "word" } | null>(null);

  async function handleDownloadProfile(r: ScholarInformationRow, format: "csv" | "pdf" | "word") {
    if (profileDownloading) return;
    setProfileDownloading({ id: r.scholarIdNumber, format });
    try {
      const sections = await loadProfileSections(r);
      if (format === "word") {
        await generateComprehensiveScholarProfile({
          scholar: r,
          sdpCompleted: sections.sdpCompleted,
          formationAttended: sections.formationAttended,
          questSubjects: sections.questSubjects,
          generatedAt: new Date().toLocaleString(),
        });
      } else if (format === "pdf") {
        await exportComprehensiveScholarProfilePdf({
          scholarIdNumber: r.scholarIdNumber,
          basicInfo: sections.basicInfo,
          sections: [
            {
              heading: `SDP — Completed Activities (${sections.sdpCompleted.length})`,
              columns: ["Activity", "Category", "Date"],
              rows: sections.sdpCompleted.map(a => [a.activityName, a.category || "—", a.date || "—"]),
              emptyMessage: "No completed SDP activities.",
            },
            {
              heading: `Formation Activities — Attended (${sections.formationAttended.length})`,
              columns: ["Activity", "Date", "Venue"],
              rows: sections.formationAttended.map(a => [a.activityName, a.dateTime || "—", a.venue || "—"]),
              emptyMessage: "No formation activity attendance recorded.",
            },
            {
              heading: `Quest — Subjects (${sections.questSubjects.length})`,
              columns: ["Subject", "Topics Completed", "Score", "Status"],
              rows: sections.questSubjects.map(q => [q.subjectName, String(q.topicCount), `${q.percentage.toFixed(1)}%`, q.isCompleted ? "Completed" : "In Progress"]),
              emptyMessage: "No Quest activity recorded.",
            },
          ],
        });
      } else {
        const blocks = [
          toCsv(["Field", "Value"], sections.basicInfo.map(b => [b.label, b.value])),
          `SDP — Completed Activities (${sections.sdpCompleted.length})\r\n` + toCsv(["Activity", "Category", "Date"], sections.sdpCompleted.map(a => [a.activityName, a.category, a.date])),
          `Formation Activities — Attended (${sections.formationAttended.length})\r\n` + toCsv(["Activity", "Date", "Venue"], sections.formationAttended.map(a => [a.activityName, a.dateTime, a.venue])),
          `Quest — Subjects (${sections.questSubjects.length})\r\n` + toCsv(["Subject", "Topics Completed", "Score", "Status"], sections.questSubjects.map(q => [q.subjectName, q.topicCount, `${q.percentage.toFixed(1)}%`, q.isCompleted ? "Completed" : "In Progress"])),
        ];
        downloadCsv(`Scholar_Profile_${r.scholarIdNumber}_${new Date().toISOString().slice(0, 10)}.csv`, blocks.join("\r\n\r\n"));
      }
    } finally {
      setProfileDownloading(null);
    }
  }

  function handleExportCsv() {
    if (busy || rows.length === 0) return;
    setExportingCsv(true);
    try {
      downloadCsv(`${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.csv`,
        toCsv(EXPORT_COLUMNS.map(c => c.label), rows.map(r => EXPORT_COLUMNS.map(c => c.value(r)))));
    } finally {
      setExportingCsv(false);
    }
  }

  async function handleExportPdf() {
    if (busy || rows.length === 0) return;
    setExportingPdf(true);
    try {
      await exportTableAsPdf({ title, columns: EXPORT_COLUMNS, rows, filtersSummary, filenamePrefix });
    } finally {
      setExportingPdf(false);
    }
  }

  async function handleExportWord() {
    if (busy || rows.length === 0) return;
    setExportingWord(true);
    try {
      await generateScholarsInformationReport({
        columns: EXPORT_COLUMNS.map(c => c.label),
        columnWeights: EXPORT_COLUMNS.map(c => c.weight ?? 1),
        rows: rows.map(r => EXPORT_COLUMNS.map(c => c.value(r))),
        generatedAt: new Date().toLocaleString(),
        filtersSummary,
      });
    } finally {
      setExportingWord(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-[#e6ecf5] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={() => setExpanded(v => !v)} className="flex items-center gap-1.5 text-[13px] font-bold text-[#062444]">
          {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          {title} <span className="font-normal text-slate-400">({rows.length.toLocaleString()})</span>
        </button>
        <div className="flex items-center gap-2">
          <button onClick={handleExportCsv} disabled={busy || rows.length === 0}
            className="flex items-center gap-1 text-[11.5px] font-semibold text-[#062444] border border-[#e6ecf5] rounded-lg px-2.5 py-1.5 hover:bg-[#f8fafd] disabled:opacity-50">
            <Download size={12} /> {exportingCsv ? "…" : "CSV"}
          </button>
          <button onClick={handleExportPdf} disabled={busy || rows.length === 0}
            className="flex items-center gap-1 text-[11.5px] font-semibold text-[#062444] border border-[#e6ecf5] rounded-lg px-2.5 py-1.5 hover:bg-[#f8fafd] disabled:opacity-50">
            <Download size={12} /> {exportingPdf ? "…" : "PDF"}
          </button>
          <button onClick={handleExportWord} disabled={busy || rows.length === 0}
            className="flex items-center gap-1 text-[11.5px] font-semibold text-[#062444] border border-[#e6ecf5] rounded-lg px-2.5 py-1.5 hover:bg-[#f8fafd] disabled:opacity-50">
            <Download size={12} /> {exportingWord ? "…" : "Word"}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-[#f0f3f8] overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="bg-[#f8fafd] text-left text-[10.5px] uppercase tracking-wide text-[#0088cc]">
                <th className="px-4 py-2 whitespace-nowrap">Scholar ID</th>
                <th className="px-4 py-2 whitespace-nowrap">Name</th>
                <th className="px-4 py-2 whitespace-nowrap">School</th>
                <th className="px-4 py-2 whitespace-nowrap">Course</th>
                <th className="px-4 py-2 whitespace-nowrap">Year Level</th>
                <th className="px-4 py-2 whitespace-nowrap text-right">Profile</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">No scholars found.</td></tr>
              ) : (
                rows.map(r => {
                  const downloading = profileDownloading?.id === r.scholarIdNumber ? profileDownloading.format : null;
                  return (
                    <tr key={r.scholarIdNumber} className="border-t border-[#f0f3f8]">
                      <td className="px-4 py-2 font-medium text-[#062444] whitespace-nowrap">{r.scholarIdNumber}</td>
                      <td className="px-4 py-2 whitespace-nowrap">{r.lastName}, {r.firstName} {r.middleName}</td>
                      <td className="px-4 py-2 text-slate-500 whitespace-nowrap">{r.school || "—"}</td>
                      <td className="px-4 py-2 text-slate-500 whitespace-nowrap">{r.course || "—"}</td>
                      <td className="px-4 py-2 text-slate-500 whitespace-nowrap">{r.yearLevel || "—"}</td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => handleDownloadProfile(r, "csv")} disabled={!!profileDownloading}
                            title="Download comprehensive profile as CSV"
                            className="p-1.5 rounded-md text-slate-400 hover:text-[#0088cc] hover:bg-[#f8fafd] disabled:opacity-40">
                            {downloading === "csv" ? <span className="text-[10px]">…</span> : <FileSpreadsheet size={13} />}
                          </button>
                          <button onClick={() => handleDownloadProfile(r, "pdf")} disabled={!!profileDownloading}
                            title="Download comprehensive profile as PDF"
                            className="p-1.5 rounded-md text-slate-400 hover:text-[#0088cc] hover:bg-[#f8fafd] disabled:opacity-40">
                            {downloading === "pdf" ? <span className="text-[10px]">…</span> : <FileText size={13} />}
                          </button>
                          <button onClick={() => handleDownloadProfile(r, "word")} disabled={!!profileDownloading}
                            title="Download comprehensive profile as Word"
                            className="p-1.5 rounded-md text-slate-400 hover:text-[#0088cc] hover:bg-[#f8fafd] disabled:opacity-40">
                            {downloading === "word" ? <span className="text-[10px]">…</span> : <FileType2 size={13} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
