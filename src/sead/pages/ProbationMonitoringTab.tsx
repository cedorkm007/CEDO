import { useEffect, useState } from "react";
import { Search, History } from "lucide-react";
import { fetchProbationMonitoringList, saveProbationNotes, type ProbationRow } from "../scholarCounselingApi";
import { fetchScholarInformationByIdNumber, type ScholarInformationRow } from "../seadApi";
import { ScholarProfilePreviewModal } from "../components/ScholarProfilePreviewModal";
import { CounselingHistoryModal } from "../components/CounselingHistoryModal";

/** Debounced auto-save text cell for Study Plan / Academic Contract Update — saves ~800ms after the last keystroke, or immediately on blur. */
function NoteCell({ value, onSave }: { value: string; onSave: (next: string) => Promise<void> }) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(value); }, [value]);

  useEffect(() => {
    if (draft === value) return;
    const t = setTimeout(() => void commit(), 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  async function commit() {
    if (draft === value) return;
    setSaving(true);
    await onSave(draft);
    setSaving(false);
  }

  return (
    <div className="relative">
      <textarea value={draft} onChange={e => setDraft(e.target.value)} onBlur={() => void commit()} rows={2}
        placeholder="—"
        className="w-full min-w-[160px] border border-transparent hover:border-[#e6ecf5] focus:border-[#0088cc] rounded-lg px-2 py-1.5 text-[12.5px] outline-none resize-none bg-transparent focus:bg-white" />
      {saving && <span className="absolute -top-1.5 right-1 text-[9.5px] font-semibold text-slate-400">Saving…</span>}
    </div>
  );
}

/**
 * "Probationary Monitoring" — a live roster of every currently-Probationary
 * scholar, for staff to track their study plan and academic contract
 * status alongside their counseling history. Distinct from Daily Records
 * (a chronological visit log across all scholars) — this is a one-row-
 * per-scholar view scoped to a single status.
 */
export function ProbationMonitoringTab() {
  const [rows, setRows] = useState<ProbationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [viewingScholar, setViewingScholar] = useState<ScholarInformationRow | null>(null);
  const [viewingInfoId, setViewingInfoId] = useState<string | null>(null);
  const [viewingHistoryFor, setViewingHistoryFor] = useState<{ scholarIdNumber: string; name: string } | null>(null);

  async function load() {
    setLoading(true);
    setRows(await fetchProbationMonitoringList(search));
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  useEffect(() => {
    const t = setTimeout(load, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function handleViewInfo(scholarIdNumber: string) {
    setViewingInfoId(scholarIdNumber);
    const info = await fetchScholarInformationByIdNumber(scholarIdNumber);
    setViewingInfoId(null);
    if (info) setViewingScholar(info);
  }

  function updateLocal(scholarIdNumber: string, patch: Partial<ProbationRow>) {
    setRows(prev => prev.map(r => r.scholarIdNumber === scholarIdNumber ? { ...r, ...patch } : r));
  }

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-4">Scholars currently on Probationary status — track their study plan and academic contract alongside their counseling history.</p>

      <div className="flex items-center gap-2 bg-white border border-[#e6ecf5] rounded-lg px-3 py-2 max-w-sm mb-4">
        <Search size={15} className="text-slate-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or Scholar ID…"
          className="w-full text-sm outline-none" />
      </div>

      <div className="bg-white rounded-2xl border border-[#e6ecf5] overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#f8fafd] text-left text-[11px] uppercase tracking-wide text-[#0088cc]">
              <th className="px-4 py-3 whitespace-nowrap">Name</th>
              <th className="px-4 py-3 whitespace-nowrap">Course</th>
              <th className="px-4 py-3 whitespace-nowrap">Year</th>
              <th className="px-4 py-3 whitespace-nowrap">School</th>
              <th className="px-4 py-3 text-center whitespace-nowrap">Information</th>
              <th className="px-4 py-3 text-center whitespace-nowrap">Counseling History</th>
              <th className="px-4 py-3 whitespace-nowrap">Study Plan</th>
              <th className="px-4 py-3 whitespace-nowrap">Academic Contract Update</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">No probationary scholars found.</td></tr>
            ) : (
              rows.map(r => (
                <tr key={r.scholarIdNumber} className="border-t border-[#f0f3f8] hover:bg-[#f8fafd]">
                  <td className="px-4 py-3 font-medium text-[#062444] whitespace-nowrap">{r.name}</td>
                  <td className="px-4 py-3 text-slate-500 max-w-[160px] truncate" title={r.course || undefined}>{r.course || "—"}</td>
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{r.yearLevel || "—"}</td>
                  <td className="px-4 py-3 text-slate-500 max-w-[200px] truncate" title={r.school || undefined}>{r.school || "—"}</td>
                  <td className="px-4 py-3 text-center whitespace-nowrap">
                    <button onClick={() => handleViewInfo(r.scholarIdNumber)} disabled={viewingInfoId === r.scholarIdNumber}
                      className="text-[12.5px] font-semibold text-[#0088cc] hover:underline disabled:opacity-50">
                      {viewingInfoId === r.scholarIdNumber ? "Loading…" : "View"}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-center whitespace-nowrap">
                    <button onClick={() => setViewingHistoryFor({ scholarIdNumber: r.scholarIdNumber, name: r.name })}
                      className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-[#0088cc] hover:underline">
                      <History size={13} /> View
                    </button>
                  </td>
                  <td className="px-2 py-2 min-w-[180px]">
                    <NoteCell value={r.studyPlan} onSave={async next => {
                      updateLocal(r.scholarIdNumber, { studyPlan: next });
                      await saveProbationNotes(r.scholarIdNumber, next, r.academicContractUpdate);
                    }} />
                  </td>
                  <td className="px-2 py-2 min-w-[180px]">
                    <NoteCell value={r.academicContractUpdate} onSave={async next => {
                      updateLocal(r.scholarIdNumber, { academicContractUpdate: next });
                      await saveProbationNotes(r.scholarIdNumber, r.studyPlan, next);
                    }} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {viewingScholar && <ScholarProfilePreviewModal scholar={viewingScholar} onClose={() => setViewingScholar(null)} />}
      {viewingHistoryFor && (
        <CounselingHistoryModal scholarIdNumber={viewingHistoryFor.scholarIdNumber} scholarName={viewingHistoryFor.name}
          onClose={() => setViewingHistoryFor(null)} />
      )}
    </div>
  );
}
