import { useEffect, useState } from "react";
import { X, Plus, Trash2, Save } from "lucide-react";
import { fetchCurrentGradingPeriod, fetchScholarGrades, upsertGrade } from "../schoolApi";
import type { SchoolScholarRow, SchoolSubjectGrade } from "../types";
import type { GradingPeriod } from "@/sead/scholarsGradesMonitoringApi";

interface EditableRow extends SchoolSubjectGrade {
  isNew?: boolean;
  dirty?: boolean;
}

function displayName(row: SchoolScholarRow): string {
  const mi = row.middleName.trim() ? `${row.middleName.trim()[0]}.` : "";
  return [row.firstName, mi, row.lastName].filter(Boolean).join(" ");
}

/** Current-semester subject+grade rows for one scholar, inline-editable. Blank grade is allowed — "declared, not yet graded" — matching the strict completeness rule (see the migration's monitoring aggregates). */
export function ScholarGradeEntryModal({ scholar, onClose }: { scholar: SchoolScholarRow; onClose: () => void }) {
  const [period, setPeriod] = useState<GradingPeriod>({ schoolYear: "", semester: "" });
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const p = await fetchCurrentGradingPeriod();
      setPeriod(p);
      const grades = await fetchScholarGrades(scholar.scholarIdNumber, p);
      setRows(grades);
      setLoading(false);
    })();
  }, [scholar.scholarIdNumber]);

  function addRow() {
    setRows(prev => [...prev, {
      id: `new-${Date.now()}`, scholarIdNumber: scholar.scholarIdNumber,
      schoolYear: period.schoolYear, semester: period.semester,
      subjectCode: "", subject: "", grade: "", isNew: true, dirty: true,
    }]);
  }

  function updateRow(id: string, field: "subjectCode" | "subject" | "grade", value: string) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value, dirty: true } : r));
  }

  function removeRow(id: string) {
    setRows(prev => prev.filter(r => r.id !== id));
  }

  async function handleSave() {
    if (!period.schoolYear || !period.semester) {
      setError("No current grading period is set — ask CEDO staff to set one from the monitoring tool first.");
      return;
    }
    setSaving(true);
    setError("");
    const dirtyRows = rows.filter(r => r.dirty && r.subject.trim());
    for (const r of dirtyRows) {
      const result = await upsertGrade({
        id: r.isNew ? null : r.id, scholarIdNumber: r.scholarIdNumber, schoolYear: period.schoolYear,
        semester: period.semester, subjectCode: r.subjectCode, subject: r.subject, grade: r.grade,
      });
      if (!result.ok) { setError(result.error || "Failed to save."); setSaving(false); return; }
    }
    setSaving(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center px-4 py-8" onClick={onClose}>
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-5 py-4 rounded-t-2xl shrink-0">
          <div>
            <h3 className="text-white font-bold text-[14.5px]">{displayName(scholar)}</h3>
            <p className="text-white/60 text-[11.5px]">{scholar.scholarIdNumber} — {period.schoolYear || "—"} · {period.semester || "—"}</p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X size={18} /></button>
        </div>

        <div className="p-5 overflow-y-auto flex-1">
          {loading ? (
            <p className="text-[13px] text-slate-400 text-center py-6">Loading…</p>
          ) : (
            <>
              <div className="space-y-2 mb-3">
                {rows.map(r => (
                  <div key={r.id} className="flex items-center gap-2">
                    <input value={r.subjectCode} onChange={e => updateRow(r.id, "subjectCode", e.target.value)} placeholder="Code"
                      className="w-20 border border-[#062444]/15 rounded-lg px-2 py-1.5 text-[12.5px] outline-none" />
                    <input value={r.subject} onChange={e => updateRow(r.id, "subject", e.target.value)} placeholder="Subject Name"
                      className="flex-1 border border-[#062444]/15 rounded-lg px-2.5 py-1.5 text-[12.5px] outline-none" />
                    <input value={r.grade} onChange={e => updateRow(r.id, "grade", e.target.value)} placeholder="Grade"
                      className="w-20 border border-[#062444]/15 rounded-lg px-2 py-1.5 text-[12.5px] outline-none" />
                    <button onClick={() => removeRow(r.id)} className="text-slate-400 hover:text-red-500 shrink-0">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <button onClick={addRow} className="flex items-center gap-1 text-[12.5px] font-semibold text-[#0088cc] hover:opacity-80">
                <Plus size={13} /> Add Subject
              </button>
              {error && <p className="text-[12.5px] text-red-600 mt-3">{error}</p>}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-[#f0f3f8] shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-[#062444]/15 text-[13px] font-semibold text-[#062444]">Cancel</button>
          <button onClick={handleSave} disabled={saving || loading}
            className="flex items-center gap-1.5 bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-60 text-white text-[13px] font-semibold rounded-lg px-4 py-2">
            <Save size={13} /> {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
