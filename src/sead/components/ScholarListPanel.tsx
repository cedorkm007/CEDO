import { useState } from "react";
import { Download, ChevronDown, ChevronUp, FileSpreadsheet, FileText, FileType2, Eye } from "lucide-react";
import { useSort, SortableTh } from "@/app/components/SortableTable";
import type { ScholarInformationRow } from "../seadApi";
import { fetchScholarQuestProgress } from "../seadApi";
import { fetchScholarSDPHistory } from "../sdpMonitorApi";
import { fetchScholarFormationAttendance } from "../formationActivitiesApi";
import { toCsv, downloadCsv } from "../csvUtils";
import { exportTableAsPdf, exportComprehensiveScholarProfilePdf } from "../pdfTableExport";
import { generateScholarsInformationReport, generateComprehensiveScholarProfile } from "@/lib/docGenerator";
import { Modal } from "./Modal";

interface ProfileSections {
  basicInfo: { label: string; value: string }[];
  sdpCompleted: { activityName: string; category: string; date: string }[];
  formationAttended: { activityName: string; dateTime: string; venue: string }[];
  questSubjects: { subjectName: string; topicCount: number; percentage: number; isCompleted: boolean }[];
}

/** Fetches every subsystem section needed for one scholar's comprehensive profile, in parallel. */
async function loadProfileSections(r: ScholarInformationRow): Promise<ProfileSections> {
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
  title, rows, filtersSummary, filenamePrefix, defaultExpanded = false, modalLevel = 0,
}: {
  title: string;
  rows: ScholarInformationRow[];
  filtersSummary: string;
  filenamePrefix: string;
  defaultExpanded?: boolean;
  /** Nesting depth of whatever Modal (if any) this panel is already shown inside — the Preview popup below stacks one level above it. Defaults to 0 (a normal top-level modal); pass 1 when this panel is itself inside an `elevated` modal. */
  modalLevel?: number;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingWord, setExportingWord] = useState(false);
  const busy = exportingCsv || exportingPdf || exportingWord;
  // Which scholar's profile is currently being generated, and in which format — drives the per-row spinner/disabled state.
  const [profileDownloading, setProfileDownloading] = useState<{ id: string; format: "csv" | "pdf" | "word" } | null>(null);
  // Which scholar's name was clicked to open the CSV/PDF/Word download menu — only one open at a time.
  const [openProfileMenuFor, setOpenProfileMenuFor] = useState<string | null>(null);
  // The scholar currently shown in the "Preview" popup, and its loaded sections (null while fetching).
  const [previewScholar, setPreviewScholar] = useState<ScholarInformationRow | null>(null);
  const [previewSections, setPreviewSections] = useState<ProfileSections | null>(null);

  const { sorted: sortedRows, sortState, toggleSort } = useSort<ScholarInformationRow>(rows, {
    scholarIdNumber: r => r.scholarIdNumber,
    name: r => `${r.lastName} ${r.firstName} ${r.middleName}`.trim(),
    school: r => r.school,
    course: r => r.course,
    yearLevel: r => r.yearLevel,
  });

  async function handlePreviewProfile(r: ScholarInformationRow) {
    setOpenProfileMenuFor(null);
    setPreviewScholar(r);
    setPreviewSections(null);
    setPreviewSections(await loadProfileSections(r));
  }

  /** `preloadedSections` skips the re-fetch when downloading straight out of an already-open Preview popup. */
  async function handleDownloadProfile(r: ScholarInformationRow, format: "csv" | "pdf" | "word", preloadedSections?: ProfileSections) {
    if (profileDownloading) return;
    setOpenProfileMenuFor(null);
    setProfileDownloading({ id: r.scholarIdNumber, format });
    try {
      const sections = preloadedSections ?? await loadProfileSections(r);
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
    if (busy || sortedRows.length === 0) return;
    setExportingCsv(true);
    try {
      downloadCsv(`${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.csv`,
        toCsv(EXPORT_COLUMNS.map(c => c.label), sortedRows.map(r => EXPORT_COLUMNS.map(c => c.value(r)))));
    } finally {
      setExportingCsv(false);
    }
  }

  async function handleExportPdf() {
    if (busy || sortedRows.length === 0) return;
    setExportingPdf(true);
    try {
      await exportTableAsPdf({ title, columns: EXPORT_COLUMNS, rows: sortedRows, filtersSummary, filenamePrefix });
    } finally {
      setExportingPdf(false);
    }
  }

  async function handleExportWord() {
    if (busy || sortedRows.length === 0) return;
    setExportingWord(true);
    try {
      await generateScholarsInformationReport({
        columns: EXPORT_COLUMNS.map(c => c.label),
        columnWeights: EXPORT_COLUMNS.map(c => c.weight ?? 1),
        rows: sortedRows.map(r => EXPORT_COLUMNS.map(c => c.value(r))),
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
        <div className="border-t border-[#f0f3f8] overflow-auto max-h-[55vh]">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="sticky top-0 z-10 bg-[#f8fafd] text-left text-[10.5px] uppercase tracking-wide text-[#0088cc]">
                <SortableTh label="Scholar ID" sortKey="scholarIdNumber" sortState={sortState} onSort={toggleSort} className="px-4 py-2 whitespace-nowrap" />
                <SortableTh label="Name" sortKey="name" sortState={sortState} onSort={toggleSort} className="px-4 py-2 whitespace-nowrap" />
                <SortableTh label="School" sortKey="school" sortState={sortState} onSort={toggleSort} className="px-4 py-2 whitespace-nowrap" />
                <SortableTh label="Course" sortKey="course" sortState={sortState} onSort={toggleSort} className="px-4 py-2 whitespace-nowrap" />
                <SortableTh label="Year Level" sortKey="yearLevel" sortState={sortState} onSort={toggleSort} className="px-4 py-2 whitespace-nowrap" />
              </tr>
            </thead>
            <tbody>
              {sortedRows.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">No scholars found.</td></tr>
              ) : (
                sortedRows.map(r => {
                  const downloading = profileDownloading?.id === r.scholarIdNumber ? profileDownloading.format : null;
                  const menuOpen = openProfileMenuFor === r.scholarIdNumber;
                  return (
                    <tr key={r.scholarIdNumber} className="border-t border-[#f0f3f8]">
                      <td className="px-4 py-2 font-medium text-[#062444] whitespace-nowrap">{r.scholarIdNumber}</td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <div className="relative inline-block">
                          <button onClick={() => setOpenProfileMenuFor(v => v === r.scholarIdNumber ? null : r.scholarIdNumber)}
                            disabled={!!profileDownloading}
                            title="Download this scholar's comprehensive profile"
                            className="text-left text-[#062444] hover:text-[#0088cc] hover:underline disabled:opacity-50">
                            {r.lastName}, {r.firstName} {r.middleName}
                            {downloading && <span className="ml-1.5 text-[10.5px] font-normal text-slate-400">generating…</span>}
                          </button>
                          {menuOpen && (
                            <>
                              <div className="fixed inset-0 z-40" onClick={() => setOpenProfileMenuFor(null)} />
                              <div className="absolute left-0 top-full mt-1 z-50 w-52 bg-white rounded-lg border border-[#e6ecf5] shadow-lg py-1">
                                <button onClick={() => handlePreviewProfile(r)}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-[12px] font-normal text-[#062444] hover:bg-[#f8fafd]">
                                  <Eye size={13} /> Preview
                                </button>
                                <div className="my-1 border-t border-[#f0f3f8]" />
                                <button onClick={() => handleDownloadProfile(r, "csv")}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-[12px] font-normal text-[#062444] hover:bg-[#f8fafd]">
                                  <FileSpreadsheet size={13} /> Download as CSV
                                </button>
                                <button onClick={() => handleDownloadProfile(r, "pdf")}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-[12px] font-normal text-[#062444] hover:bg-[#f8fafd]">
                                  <FileText size={13} /> Download as PDF
                                </button>
                                <button onClick={() => handleDownloadProfile(r, "word")}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-[12px] font-normal text-[#062444] hover:bg-[#f8fafd]">
                                  <FileType2 size={13} /> Download as Word
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-slate-500 max-w-[220px] truncate" title={r.school || undefined}>{r.school || "—"}</td>
                      <td className="px-4 py-2 text-slate-500 max-w-[160px] truncate" title={r.course || undefined}>{r.course || "—"}</td>
                      <td className="px-4 py-2 text-slate-500 whitespace-nowrap">{r.yearLevel || "—"}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {previewScholar && (
        <Modal level={modalLevel + 1} title={`Preview — ${previewScholar.lastName}, ${previewScholar.firstName} ${previewScholar.middleName}`.trim()}
          onClose={() => { setPreviewScholar(null); setPreviewSections(null); }}>
          {!previewSections ? (
            <p className="text-[13px] text-slate-400 text-center py-8">Loading…</p>
          ) : (
            <div className="space-y-5">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">Basic Information</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 bg-white rounded-xl border border-[#e6ecf5] p-4">
                  {previewSections.basicInfo.map(b => (
                    <div key={b.label} className="flex items-center justify-between gap-2 text-[12.5px] border-b border-[#f8fafd] py-1 last:border-b-0">
                      <span className="text-slate-400">{b.label}</span>
                      <span className="font-semibold text-[#062444] text-right">{b.value || "—"}</span>
                    </div>
                  ))}
                </div>
              </div>

              <PreviewSection
                title={`SDP — Completed Activities (${previewSections.sdpCompleted.length})`}
                columns={["Activity", "Category", "Date"]}
                rows={previewSections.sdpCompleted.map(a => [a.activityName, a.category || "—", a.date || "—"])}
                emptyMessage="No completed SDP activities."
              />
              <PreviewSection
                title={`Formation Activities — Attended (${previewSections.formationAttended.length})`}
                columns={["Activity", "Date", "Venue"]}
                rows={previewSections.formationAttended.map(f => [f.activityName, f.dateTime || "—", f.venue || "—"])}
                emptyMessage="No formation activity attendance recorded."
              />
              <PreviewSection
                title={`Quest — Subjects (${previewSections.questSubjects.length})`}
                columns={["Subject", "Topics Completed", "Score", "Status"]}
                rows={previewSections.questSubjects.map(q => [q.subjectName, String(q.topicCount), `${q.percentage.toFixed(1)}%`, q.isCompleted ? "Completed" : "In Progress"])}
                emptyMessage="No Quest activity recorded."
              />

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#e6ecf5]">
                <button onClick={() => handleDownloadProfile(previewScholar, "csv", previewSections)} disabled={!!profileDownloading}
                  className="flex items-center gap-1 text-[11.5px] font-semibold text-[#062444] border border-[#e6ecf5] rounded-lg px-2.5 py-1.5 hover:bg-white bg-[#f8fafd] disabled:opacity-50">
                  <FileSpreadsheet size={12} /> CSV
                </button>
                <button onClick={() => handleDownloadProfile(previewScholar, "pdf", previewSections)} disabled={!!profileDownloading}
                  className="flex items-center gap-1 text-[11.5px] font-semibold text-[#062444] border border-[#e6ecf5] rounded-lg px-2.5 py-1.5 hover:bg-white bg-[#f8fafd] disabled:opacity-50">
                  <FileText size={12} /> PDF
                </button>
                <button onClick={() => handleDownloadProfile(previewScholar, "word", previewSections)} disabled={!!profileDownloading}
                  className="flex items-center gap-1 text-[11.5px] font-semibold text-[#062444] border border-[#e6ecf5] rounded-lg px-2.5 py-1.5 hover:bg-white bg-[#f8fafd] disabled:opacity-50">
                  <FileType2 size={12} /> Word
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function PreviewSection({ title, columns, rows, emptyMessage }: { title: string; columns: string[]; rows: string[][]; emptyMessage: string }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">{title}</p>
      {rows.length === 0 ? (
        <p className="text-[12px] text-slate-400 italic bg-white rounded-xl border border-[#e6ecf5] px-4 py-3">{emptyMessage}</p>
      ) : (
        <div className="bg-white rounded-xl border border-[#e6ecf5] overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="bg-[#f8fafd] text-left text-[10.5px] uppercase tracking-wide text-[#0088cc]">
                {columns.map(c => <th key={c} className="px-3 py-2 whitespace-nowrap">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-t border-[#f0f3f8]">
                  {row.map((value, j) => <td key={j} className="px-3 py-2 text-slate-600 whitespace-nowrap">{value}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
