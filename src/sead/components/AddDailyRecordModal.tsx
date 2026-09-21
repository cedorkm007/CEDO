import { useState } from "react";
import { X, ClipboardPlus } from "lucide-react";
import { createDailyRecord, VISIT_TYPES, type VisitType } from "../scholarCounselingApi";
import { fetchScholarInformationByIdNumber } from "../seadApi";
import { SCHOLARSHIP_STATUSES, type ScholarshipStatus } from "../types";
import { ScholarSearchField, type ScholarSearchResult } from "./ScholarSearchField";

export function AddDailyRecordModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ScholarSearchResult | null>(null);
  const [dateVisited, setDateVisited] = useState(new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState<ScholarshipStatus>("Regular");
  const [visitType, setVisitType] = useState<VisitType>("Office");
  const [failedSubjects, setFailedSubjects] = useState("");
  const [findings, setFindings] = useState("");
  const [staffRecommendations, setStaffRecommendations] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSelectScholar(r: ScholarSearchResult) {
    setSelected(r);
    // Prefill Status from the scholar's current scholarship status — this
    // field is a monitoring snapshot, not an action, so every status
    // (including Removed) is a valid value here, unlike other status
    // dropdowns in the app. Staff can still adjust it.
    const info = await fetchScholarInformationByIdNumber(r.scholarIdNumber);
    if (info) setStatus(info.status);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const scholarIdNumber = selected?.scholarIdNumber ?? query.trim();
    if (!scholarIdNumber) { setError("Enter or pick a scholar."); return; }
    if (!dateVisited) { setError("Enter the date visited."); return; }
    setBusy(true);
    const result = await createDailyRecord({
      scholarIdNumber, status, dateVisited, visitType,
      failedSubjects: failedSubjects.trim(), findings: findings.trim(), staffRecommendations: staffRecommendations.trim(),
    });
    setBusy(false);
    if (!result.ok) { setError(result.error || "Failed to save this record — check the Scholar ID exists."); return; }
    onCreated();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center px-4 py-8 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4 rounded-t-2xl">
          <h3 className="flex items-center gap-2 text-white font-bold text-[15px]"><ClipboardPlus size={16} className="text-[#F3BC00]" /> Add Daily Record</h3>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          <div className="mb-3">
            <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Scholar</label>
            <ScholarSearchField query={query} setQuery={v => { setQuery(v); setSelected(null); }} selected={selected}
              onSelect={handleSelectScholar} onClear={() => setSelected(null)} filter={{ includeRemoved: true }} />
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Date Visited</label>
              <input type="date" value={dateVisited} onChange={e => setDateVisited(e.target.value)} required
                className="w-full border border-[#062444]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#0088cc]" />
            </div>
            <div>
              <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Status</label>
              <select value={status} onChange={e => setStatus(e.target.value as ScholarshipStatus)}
                className="w-full border border-[#062444]/15 rounded-lg px-3 py-2 text-sm outline-none bg-white">
                {SCHOLARSHIP_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="mb-3">
            <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Visit Type</label>
            <select value={visitType} onChange={e => setVisitType(e.target.value as VisitType)}
              className="w-full border border-[#062444]/15 rounded-lg px-3 py-2 text-sm outline-none bg-white">
              {VISIT_TYPES.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>

          <div className="mb-3">
            <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Failed Subject(s)</label>
            <input value={failedSubjects} onChange={e => setFailedSubjects(e.target.value)} placeholder="e.g. Calculus 2, Physics 1"
              className="w-full border border-[#062444]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#0088cc]" />
          </div>

          <div className="mb-3">
            <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Findings</label>
            <textarea value={findings} onChange={e => setFindings(e.target.value)} rows={3}
              className="w-full border border-[#062444]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#0088cc] resize-none" />
          </div>

          <div className="mb-4">
            <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Staff Recommendations</label>
            <textarea value={staffRecommendations} onChange={e => setStaffRecommendations(e.target.value)} rows={3}
              className="w-full border border-[#062444]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#0088cc] resize-none" />
          </div>

          {error && <p className="text-[13px] text-red-600 mb-3">{error}</p>}

          <div className="flex justify-end">
            <button type="submit" disabled={busy}
              className="bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-60 text-white text-[13px] font-semibold rounded-lg px-5 py-2.5">
              {busy ? "Saving…" : "Save Record"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
