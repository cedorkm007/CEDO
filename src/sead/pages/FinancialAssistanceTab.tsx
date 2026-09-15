import { useEffect, useState } from "react";
import { Plus, UploadCloud, QrCode, Pencil, Trash2, CheckCircle2, Clock, Settings2, X } from "lucide-react";
import {
  fetchFinancialAssistancePeriods, createFinancialAssistancePeriod, fetchFinancialAssistanceApplicants,
  setFinancialAssistanceApplicantStatus, deleteFinancialAssistanceApplicant,
  fetchFinancialAssistanceApprovedInstructions, setFinancialAssistanceApprovedInstructions,
  formatPeriodLabel, FA_SEMESTERS,
  type FinancialAssistancePeriod, type FinancialAssistanceApplicant,
} from "../financialAssistanceApi";
import { useSort, SortableTh } from "@/app/components/SortableTable";
import { usePaginatedList, ListSearchBox, ListPagination } from "@/app/components/PaginatedList";
import { ExportButtonGroup, type ExportFormat } from "@/app/components/ExportButtons";
import { toCsv, downloadCsv } from "../csvUtils";
import { exportTableAsPdf } from "../pdfTableExport";
import { generateFinancialAssistanceReport } from "@/lib/docGenerator";
import { AddEditFinancialAssistanceApplicantModal } from "../components/AddEditFinancialAssistanceApplicantModal";
import { BulkFinancialAssistanceUploadModal } from "../components/BulkFinancialAssistanceUploadModal";
import { FinancialAssistanceQrModal } from "../components/FinancialAssistanceQrModal";

const STATUS_META: Record<string, { label: string; className: string; Icon: typeof Clock }> = {
  processing: { label: "Still Processing", className: "bg-amber-50 text-amber-700", Icon: Clock },
  approved: { label: "Approved", className: "bg-emerald-50 text-emerald-700", Icon: CheckCircle2 },
};

export function FinancialAssistanceTab() {
  const [periods, setPeriods] = useState<FinancialAssistancePeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  const [loadingPeriods, setLoadingPeriods] = useState(true);
  const [showNewPeriod, setShowNewPeriod] = useState(false);

  const [applicants, setApplicants] = useState<FinancialAssistanceApplicant[]>([]);
  const [loadingApplicants, setLoadingApplicants] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<FinancialAssistanceApplicant | null>(null);
  const [showBulk, setShowBulk] = useState(false);
  const [qrApplicant, setQrApplicant] = useState<FinancialAssistanceApplicant | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);

  const [exportBusy, setExportBusy] = useState<ExportFormat | null>(null);

  async function loadPeriods(preferId?: string) {
    setLoadingPeriods(true);
    const rows = await fetchFinancialAssistancePeriods();
    setPeriods(rows);
    const active = rows.find(p => p.isActive) ?? rows[0];
    setSelectedPeriodId(preferId ?? active?.id ?? "");
    setLoadingPeriods(false);
  }
  useEffect(() => { loadPeriods(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function loadApplicants() {
    if (!selectedPeriodId) { setApplicants([]); return; }
    setLoadingApplicants(true);
    setApplicants(await fetchFinancialAssistanceApplicants(selectedPeriodId));
    setLoadingApplicants(false);
  }
  useEffect(() => { loadApplicants(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [selectedPeriodId]);

  async function handleToggleStatus(a: FinancialAssistanceApplicant) {
    const next = a.status === "approved" ? "processing" : "approved";
    const result = await setFinancialAssistanceApplicantStatus(a.id, next);
    if (result.ok) loadApplicants();
  }

  async function handleDelete(a: FinancialAssistanceApplicant) {
    if (!window.confirm(`Remove ${a.name} from this period's list? This cannot be undone.`)) return;
    const result = await deleteFinancialAssistanceApplicant(a.id);
    if (result.ok) loadApplicants();
  }

  const { sorted, sortState, toggleSort } = useSort<FinancialAssistanceApplicant>(applicants, {
    referenceNumber: r => r.referenceNumber,
    name: r => r.name,
    barangay: r => r.barangay,
    school: r => r.school,
    program: r => r.program,
    yearLevel: r => r.yearLevel,
    vulnerableSector: r => r.vulnerableSector,
    modeOfApplication: r => r.modeOfApplication,
    status: r => r.status,
    appliedAt: r => r.appliedAt,
  });

  const { paged, search, setSearch, page, setPage, totalPages, filteredCount, pageSize } = usePaginatedList(sorted, {
    searchKeys: ["name", "referenceNumber", "school", "barangay"],
  });

  const selectedPeriod = periods.find(p => p.id === selectedPeriodId) ?? null;

  function exportRows() {
    return sorted; // export the full filtered/sorted period list, not just the current page
  }

  function handleExportCsv() {
    setExportBusy("csv");
    const rows = exportRows();
    const headers = ["Reference #", "Name", "Barangay", "School", "Program", "Year Level", "Vulnerable Sector", "Mode of Application", "Status", "Date Applied"];
    const csvRows = rows.map(r => [r.referenceNumber, r.name, r.barangay, r.school, r.program, r.yearLevel, r.vulnerableSector, r.modeOfApplication, STATUS_META[r.status]?.label ?? r.status, new Date(r.appliedAt).toLocaleDateString()]);
    downloadCsv(`financial-assistance-${selectedPeriod ? formatPeriodLabel(selectedPeriod) : "export"}.csv`, toCsv(headers, csvRows));
    setExportBusy(null);
  }

  async function handleExportPdf() {
    setExportBusy("pdf");
    const rows = exportRows();
    await exportTableAsPdf({
      title: `Financial Assistance Applicants — ${selectedPeriod ? formatPeriodLabel(selectedPeriod) : ""}`,
      columns: [
        { label: "Reference #", value: r => r.referenceNumber },
        { label: "Name", value: r => r.name, weight: 1.6 },
        { label: "Barangay", value: r => r.barangay },
        { label: "School", value: r => r.school, weight: 1.4 },
        { label: "Program", value: r => r.program, weight: 1.2 },
        { label: "Year Level", value: r => r.yearLevel },
        { label: "Vulnerable Sector", value: r => r.vulnerableSector },
        { label: "Mode", value: r => r.modeOfApplication },
        { label: "Status", value: r => STATUS_META[r.status]?.label ?? r.status },
      ],
      rows,
      filtersSummary: `Period: ${selectedPeriod ? formatPeriodLabel(selectedPeriod) : "—"}`,
      filenamePrefix: "financial-assistance-applicants",
    });
    setExportBusy(null);
  }

  async function handleExportWord() {
    setExportBusy("word");
    const rows = exportRows();
    await generateFinancialAssistanceReport({
      columns: ["Reference #", "Name", "Barangay", "School", "Program", "Year Level", "Vulnerable Sector", "Mode", "Status"],
      columnWeights: [1, 1.6, 1, 1.4, 1.2, 1, 1, 1, 1],
      rows: rows.map(r => [r.referenceNumber, r.name, r.barangay, r.school, r.program, r.yearLevel, r.vulnerableSector, r.modeOfApplication, STATUS_META[r.status]?.label ?? r.status]),
      filtersSummary: `Period: ${selectedPeriod ? formatPeriodLabel(selectedPeriod) : "—"}`,
      generatedAt: new Date().toLocaleString(),
    });
    setExportBusy(null);
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-[#e6ecf5] p-4">
        <div className="flex flex-wrap items-end gap-3 justify-between">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">Period</label>
            <select value={selectedPeriodId} onChange={e => setSelectedPeriodId(e.target.value)} disabled={loadingPeriods}
              className="border border-[#062444]/15 rounded-lg px-3 py-2 text-[13px] font-semibold text-[#062444] outline-none focus:border-[#0088cc] bg-white min-w-[220px]">
              {periods.length === 0 && <option value="">No periods yet</option>}
              {periods.map(p => <option key={p.id} value={p.id}>{formatPeriodLabel(p)}{p.isActive ? " (active)" : ""}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowNewPeriod(true)} className="flex items-center gap-1.5 text-[12.5px] font-bold text-[#0088cc] hover:underline">
              <Plus size={14} /> New Period
            </button>
            <button onClick={() => setShowInstructions(true)} className="flex items-center gap-1.5 text-[12.5px] font-bold text-slate-500 hover:text-[#062444]">
              <Settings2 size={14} /> Approved Instructions
            </button>
          </div>
        </div>
      </div>

      {selectedPeriodId && (
        <div className="bg-white rounded-2xl border border-[#e6ecf5] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 bg-gradient-to-br from-[#062444] to-[#0a3a6b] text-white text-[12.5px] font-bold rounded-lg px-3.5 py-2">
                <Plus size={14} /> Add Applicant
              </button>
              <button onClick={() => setShowBulk(true)} className="flex items-center gap-1.5 border border-[#e6ecf5] text-slate-600 text-[12.5px] font-bold rounded-lg px-3.5 py-2 hover:bg-[#f8fafd]">
                <UploadCloud size={14} /> Bulk Import
              </button>
            </div>
            <ExportButtonGroup onExportCsv={handleExportCsv} onExportPdf={handleExportPdf} onExportWord={handleExportWord} busyFormat={exportBusy} disabled={applicants.length === 0} />
          </div>

          <ListSearchBox value={search} onChange={setSearch} placeholder="Search by name, reference #, school, or barangay…" />

          <div className="mt-3 overflow-x-auto border border-[#e6ecf5] rounded-lg">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="bg-[#f8fafd] text-left text-[11px] uppercase tracking-wide text-[#0088cc]">
                  <SortableTh label="Reference #" sortKey="referenceNumber" sortState={sortState} onSort={toggleSort} className="px-3 py-2.5" />
                  <SortableTh label="Name" sortKey="name" sortState={sortState} onSort={toggleSort} className="px-3 py-2.5" />
                  <SortableTh label="Barangay" sortKey="barangay" sortState={sortState} onSort={toggleSort} className="px-3 py-2.5" />
                  <SortableTh label="School" sortKey="school" sortState={sortState} onSort={toggleSort} className="px-3 py-2.5" />
                  <SortableTh label="Program" sortKey="program" sortState={sortState} onSort={toggleSort} className="px-3 py-2.5" />
                  <SortableTh label="Year Level" sortKey="yearLevel" sortState={sortState} onSort={toggleSort} className="px-3 py-2.5" />
                  <SortableTh label="Vulnerable Sector" sortKey="vulnerableSector" sortState={sortState} onSort={toggleSort} className="px-3 py-2.5" />
                  <SortableTh label="Mode" sortKey="modeOfApplication" sortState={sortState} onSort={toggleSort} className="px-3 py-2.5" />
                  <SortableTh label="Status" sortKey="status" sortState={sortState} onSort={toggleSort} className="px-3 py-2.5" />
                  <th className="px-3 py-2.5">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loadingApplicants ? (
                  <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-400">Loading…</td></tr>
                ) : paged.length === 0 ? (
                  <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-400">No applicants match.</td></tr>
                ) : (
                  paged.map(a => {
                    const meta = STATUS_META[a.status] ?? STATUS_META.processing;
                    return (
                      <tr key={a.id} className="border-t border-[#f0f3f8]">
                        <td className="px-3 py-2.5 font-mono text-[#062444]">{a.referenceNumber}</td>
                        <td className="px-3 py-2.5 font-semibold text-[#062444]">{a.name}</td>
                        <td className="px-3 py-2.5 text-slate-500">{a.barangay}</td>
                        <td className="px-3 py-2.5 text-slate-500">{a.school}</td>
                        <td className="px-3 py-2.5 text-slate-500">{a.program}</td>
                        <td className="px-3 py-2.5 text-slate-500">{a.yearLevel}</td>
                        <td className="px-3 py-2.5 text-slate-500">{a.vulnerableSector}</td>
                        <td className="px-3 py-2.5 text-slate-500">{a.modeOfApplication}</td>
                        <td className="px-3 py-2.5">
                          <button onClick={() => handleToggleStatus(a)}
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold cursor-pointer hover:opacity-80 transition-opacity ${meta.className}`}>
                            <meta.Icon size={11} /> {meta.label}
                          </button>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <button onClick={() => setQrApplicant(a)} title="View QR" className="text-slate-400 hover:text-[#0088cc]"><QrCode size={15} /></button>
                            <button onClick={() => setEditing(a)} title="Edit" className="text-slate-400 hover:text-[#0088cc]"><Pencil size={14} /></button>
                            <button onClick={() => handleDelete(a)} title="Delete" className="text-slate-300 hover:text-red-500"><Trash2 size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {filteredCount > 0 && (
            <div className="mt-2">
              <ListPagination page={page} totalPages={totalPages} onPageChange={setPage} filteredCount={filteredCount} pageSize={pageSize} itemLabel="applicants" />
            </div>
          )}
        </div>
      )}

      {showNewPeriod && (
        <NewPeriodModal onClose={() => setShowNewPeriod(false)} onCreated={id => { setShowNewPeriod(false); loadPeriods(id); }} />
      )}

      {(showAdd || editing) && selectedPeriodId && (
        <AddEditFinancialAssistanceApplicantModal
          periodId={selectedPeriodId}
          existing={editing}
          onClose={() => { setShowAdd(false); setEditing(null); }}
          onSaved={applicant => {
            setShowAdd(false); setEditing(null); loadApplicants();
            if (applicant && !editing) setQrApplicant(applicant);
          }}
        />
      )}

      {showBulk && selectedPeriodId && (
        <BulkFinancialAssistanceUploadModal periodId={selectedPeriodId} onClose={() => setShowBulk(false)} onDone={loadApplicants} />
      )}

      {qrApplicant && <FinancialAssistanceQrModal applicant={qrApplicant} onClose={() => setQrApplicant(null)} />}

      {showInstructions && <ApprovedInstructionsModal onClose={() => setShowInstructions(false)} />}
    </div>
  );
}

function NewPeriodModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [academicYear, setAcademicYear] = useState("");
  const [semester, setSemester] = useState<string>(FA_SEMESTERS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!academicYear.trim()) { setError("Enter an academic year, e.g. 2026-2027."); return; }
    setBusy(true);
    setError("");
    const result = await createFinancialAssistancePeriod(academicYear.trim(), semester);
    setBusy(false);
    if (!result.ok || !result.id) { setError(result.error || "Failed to create period."); return; }
    onCreated(result.id);
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center px-4 py-8" onClick={onClose}>
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4 rounded-t-2xl">
          <h3 className="text-white font-bold text-[15px]">New Period</h3>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6">
          <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Academic Year</label>
          <input value={academicYear} onChange={e => setAcademicYear(e.target.value)} placeholder="e.g. 2026-2027"
            className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc] mb-4" />
          <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Semester</label>
          <select value={semester} onChange={e => setSemester(e.target.value)}
            className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc] mb-4 bg-white">
            {FA_SEMESTERS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {error && <p className="text-[13px] text-red-600 mb-3">{error}</p>}
          <div className="flex justify-end">
            <button type="submit" disabled={busy} className="bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-60 text-white text-[13px] font-semibold rounded-lg px-5 py-2.5">
              {busy ? "Creating…" : "Create Period"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ApprovedInstructionsModal({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      setText(await fetchFinancialAssistanceApprovedInstructions());
      setLoading(false);
    })();
  }, []);

  async function handleSave() {
    setSaving(true);
    setError("");
    setSaved(false);
    const result = await setFinancialAssistanceApprovedInstructions(text);
    setSaving(false);
    if (!result.ok) { setError(result.error || "Failed to save."); return; }
    setSaved(true);
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center px-4 py-8" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4 rounded-t-2xl">
          <h3 className="text-white font-bold text-[15px]">Approved Instructions</h3>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X size={18} /></button>
        </div>
        <div className="p-6">
          <p className="text-[12.5px] text-slate-500 mb-3">Shown to applicants on the public status page once their application is marked Approved.</p>
          {loading ? (
            <p className="text-[13px] text-slate-400 py-4">Loading…</p>
          ) : (
            <>
              <textarea value={text} onChange={e => setText(e.target.value)} rows={5}
                className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc] mb-3 resize-none" />
              {error && <p className="text-[13px] text-red-600 mb-3">{error}</p>}
              {saved && <p className="text-[13px] text-emerald-600 mb-3">Saved.</p>}
              <div className="flex justify-end">
                <button onClick={handleSave} disabled={saving} className="bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-60 text-white text-[13px] font-semibold rounded-lg px-5 py-2.5">
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
