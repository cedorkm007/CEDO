import { useState } from "react";
import { Download, ChevronDown, ChevronUp } from "lucide-react";
import type { ScholarInformationRow } from "../seadApi";
import { toCsv, downloadCsv } from "../csvUtils";
import { exportTableAsPdf } from "../pdfTableExport";
import { generateScholarsInformationReport } from "@/lib/docGenerator";

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
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">No scholars found.</td></tr>
              ) : (
                rows.map(r => (
                  <tr key={r.scholarIdNumber} className="border-t border-[#f0f3f8]">
                    <td className="px-4 py-2 font-medium text-[#062444] whitespace-nowrap">{r.scholarIdNumber}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{r.lastName}, {r.firstName} {r.middleName}</td>
                    <td className="px-4 py-2 text-slate-500 whitespace-nowrap">{r.school || "—"}</td>
                    <td className="px-4 py-2 text-slate-500 whitespace-nowrap">{r.course || "—"}</td>
                    <td className="px-4 py-2 text-slate-500 whitespace-nowrap">{r.yearLevel || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
