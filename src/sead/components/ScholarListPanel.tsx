import { useState } from "react";
import { ChevronDown, ChevronUp, Eye } from "lucide-react";
import { useSort, SortableTh } from "@/app/components/SortableTable";
import { ExportButtonGroup, ExportMenuItem, type ExportFormat } from "@/app/components/ExportButtons";
import type { ScholarInformationRow } from "../seadApi";
import { toCsv, downloadCsv } from "../csvUtils";
import { exportTableAsPdf } from "../pdfTableExport";
import { generateScholarsInformationReport } from "@/lib/docGenerator";
import { loadProfileSections, downloadScholarProfile, type ProfileSections } from "../scholarProfileExport";
import { ScholarProfilePreviewModal } from "./ScholarProfilePreviewModal";

const EXPORT_COLUMNS: { label: string; value: (r: ScholarInformationRow) => string; weight?: number }[] = [
  { label: "Scholar ID", value: r => r.scholarIdNumber },
  { label: "Name", value: r => `${r.lastName}, ${r.firstName} ${r.middleName}`.trim(), weight: 1.6 },
  { label: "School", value: r => r.school || "" },
  { label: "Program", value: r => r.course || "" },
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
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(null);
  const busy = exportingFormat !== null;
  // Which scholar's profile is currently being generated, and in which format — drives the per-row spinner/disabled state.
  const [profileDownloading, setProfileDownloading] = useState<{ id: string; format: "csv" | "pdf" | "word" } | null>(null);
  // Which scholar's name was clicked to open the CSV/PDF/Word download menu — only one open at a time.
  const [openProfileMenuFor, setOpenProfileMenuFor] = useState<string | null>(null);
  // The scholar currently shown in the "Preview" popup (ScholarProfilePreviewModal loads its own sections).
  const [previewScholar, setPreviewScholar] = useState<ScholarInformationRow | null>(null);

  const { sorted: sortedRows, sortState, toggleSort } = useSort<ScholarInformationRow>(rows, {
    scholarIdNumber: r => r.scholarIdNumber,
    name: r => `${r.lastName} ${r.firstName} ${r.middleName}`.trim(),
    school: r => r.school,
    course: r => r.course,
    yearLevel: r => r.yearLevel,
  });

  function handlePreviewProfile(r: ScholarInformationRow) {
    setOpenProfileMenuFor(null);
    setPreviewScholar(r);
  }

  /** Direct download from the dropdown menu, without opening the Preview popup. */
  async function handleDownloadProfile(r: ScholarInformationRow, format: "csv" | "pdf" | "word") {
    if (profileDownloading) return;
    setOpenProfileMenuFor(null);
    setProfileDownloading({ id: r.scholarIdNumber, format });
    try {
      const sections: ProfileSections = await loadProfileSections(r);
      await downloadScholarProfile(r, format, sections);
    } finally {
      setProfileDownloading(null);
    }
  }

  function handleExportCsv() {
    if (busy || sortedRows.length === 0) return;
    setExportingFormat("csv");
    try {
      downloadCsv(`${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.csv`,
        toCsv(EXPORT_COLUMNS.map(c => c.label), sortedRows.map(r => EXPORT_COLUMNS.map(c => c.value(r)))));
    } finally {
      setExportingFormat(null);
    }
  }

  async function handleExportPdf() {
    if (busy || sortedRows.length === 0) return;
    setExportingFormat("pdf");
    try {
      await exportTableAsPdf({ title, columns: EXPORT_COLUMNS, rows: sortedRows, filtersSummary, filenamePrefix });
    } finally {
      setExportingFormat(null);
    }
  }

  async function handleExportWord() {
    if (busy || sortedRows.length === 0) return;
    setExportingFormat("word");
    try {
      await generateScholarsInformationReport({
        columns: EXPORT_COLUMNS.map(c => c.label),
        columnWeights: EXPORT_COLUMNS.map(c => c.weight ?? 1),
        rows: sortedRows.map(r => EXPORT_COLUMNS.map(c => c.value(r))),
        generatedAt: new Date().toLocaleString(),
        filtersSummary,
      });
    } finally {
      setExportingFormat(null);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-[#e6ecf5] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={() => setExpanded(v => !v)} className="flex items-center gap-1.5 text-[13px] font-bold text-[#062444]">
          {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          {title} <span className="font-normal text-slate-400">({rows.length.toLocaleString()})</span>
        </button>
        <ExportButtonGroup
          onExportCsv={handleExportCsv} onExportPdf={handleExportPdf} onExportWord={handleExportWord}
          busyFormat={exportingFormat} disabled={rows.length === 0}
        />
      </div>

      {expanded && (
        <div className="border-t border-[#f0f3f8] overflow-auto max-h-[55vh]">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="sticky top-0 z-10 bg-[#f8fafd] text-left text-[10.5px] uppercase tracking-wide text-[#0088cc]">
                <SortableTh label="Scholar ID" sortKey="scholarIdNumber" sortState={sortState} onSort={toggleSort} className="px-4 py-2 whitespace-nowrap" />
                <SortableTh label="Name" sortKey="name" sortState={sortState} onSort={toggleSort} className="px-4 py-2 whitespace-nowrap" />
                <SortableTh label="School" sortKey="school" sortState={sortState} onSort={toggleSort} className="px-4 py-2 whitespace-nowrap" />
                <SortableTh label="Program" sortKey="course" sortState={sortState} onSort={toggleSort} className="px-4 py-2 whitespace-nowrap" />
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
                                <ExportMenuItem format="csv" onClick={() => handleDownloadProfile(r, "csv")} />
                                <ExportMenuItem format="pdf" onClick={() => handleDownloadProfile(r, "pdf")} />
                                <ExportMenuItem format="word" onClick={() => handleDownloadProfile(r, "word")} />
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
        <ScholarProfilePreviewModal scholar={previewScholar} onClose={() => setPreviewScholar(null)} modalLevel={modalLevel} />
      )}
    </div>
  );
}
