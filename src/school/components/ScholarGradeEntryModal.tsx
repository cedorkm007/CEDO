import { useEffect, useMemo, useState } from "react";
import { X, Plus, Trash2, Save, CheckCircle2, AlertTriangle } from "lucide-react";
import { fetchScholarGradesChecked, upsertGrade, deleteGradeRows } from "../schoolApi";
import { validateEntryRows, findUnconfirmed, savedMessage, periodLabel, type SavedRow } from "../gradeSaveLogic";
import { gwaDetail, formatGwa, needsUnits, type LetterGrade } from "@/lib/gwa";
import { validateGradeValue } from "../bulkGradeLogic";
import { gradeInputHint } from "../portalLogic";
import { focusRing } from "./portalParts";
import type { GradingConfig, SchoolScholarRow, SchoolSubjectGrade } from "../types";
import type { GradingPeriod } from "@/sead/scholarsGradesMonitoringApi";

interface EditableRow extends SchoolSubjectGrade {
  isNew?: boolean;
  dirty?: boolean;
  /** What is typed in the Units box. */
  unitsText: string;
}

function displayName(row: SchoolScholarRow): string {
  const mi = row.middleName.trim() ? `${row.middleName.trim()[0]}.` : "";
  return [row.firstName, mi, row.lastName].filter(Boolean).join(" ");
}

function toEditable(rows: SchoolSubjectGrade[]): EditableRow[] {
  return rows.map(r => ({ ...r, unitsText: r.units == null ? "" : String(r.units) }));
}

/** The number in the Units box, or null when it is blank / not a positive number (validateEntryRows reports the latter before saving). */
function parseUnits(text: string): number | null {
  const t = text.trim();
  return /^\d+(\.\d+)?$/.test(t) && Number(t) > 0 ? Number(t) : null;
}

const inputClass = `border border-[#062444]/30 rounded-lg px-2 py-1.5 text-[14px] text-[#062444] ${focusRing} focus-visible:border-[#0077b6] disabled:bg-slate-50 disabled:text-slate-700`;

/**
 * Current-semester subject+grade rows for one scholar, inline-editable. Blank grade is allowed — "declared, not yet graded" — matching the strict completeness rule (see the migration's monitoring aggregates).
 *
 * Phase 4: each subject has Units and an "Exclude from GWA" checkbox (NSTP, PE, ...), and a live GWA preview
 * (the same units-weighted calculation staff and scholars see — src/lib/gwa.ts). A subject without units is
 * counted as 1 unit and flagged here so the school can complete it.
 *
 * Save does not trust the write's reply: it re-reads the rows from the database and checks each saved grade, units and flag
 * came back (see findUnconfirmed in ../gradeSaveLogic.ts), then shows "Saved: 1.75 · 1st Semester 2026-2027".
 * The modal stays open afterwards so the school sees what is actually stored; `onSaved` lets the scholar table behind it refresh.
 *
 * The period is the one chosen in the Scholars tab. When it is not Open (`canEdit` false) the grades are shown read-only —
 * the database refuses a school's changes to a Closed or Archived period as well, this just says so up front.
 */
export function ScholarGradeEntryModal({ scholar, period, canEdit, config, letterGrades, onClose, onSaved }: {
  scholar: SchoolScholarRow; period: GradingPeriod; canEdit: boolean; config: GradingConfig | null; letterGrades: LetterGrade[]; onClose: () => void; onSaved?: () => void;
}) {
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedNote, setSavedNote] = useState("");

  useEffect(() => {
    (async () => {
      const result = await fetchScholarGradesChecked(scholar.scholarIdNumber, period);
      if (result.ok) setRows(toEditable(result.rows));
      else setError(`Couldn't load this scholar's subjects: ${result.error}`);
      setLoading(false);
    })();
  }, [scholar.scholarIdNumber, period]);

  function addRow() {
    setSavedNote("");
    setRows(prev => [...prev, {
      id: `new-${Date.now()}`, scholarIdNumber: scholar.scholarIdNumber,
      schoolYear: period.schoolYear, semester: period.semester,
      subjectCode: "", subject: "", grade: "", units: null, excludeFromGwa: false, unitsText: "", isNew: true, dirty: true,
    }]);
  }

  function updateRow(id: string, field: "subjectCode" | "subject" | "grade" | "unitsText", value: string) {
    setSavedNote("");
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value, dirty: true } : r));
  }

  function toggleExclude(id: string, value: boolean) {
    setSavedNote("");
    setRows(prev => prev.map(r => r.id === id ? { ...r, excludeFromGwa: value, dirty: true } : r));
  }

  /** A row that was already saved is only really deleted when Save is pressed; a brand-new row just disappears. */
  function removeRow(id: string) {
    setSavedNote("");
    const row = rows.find(r => r.id === id);
    if (row && !row.isNew) setRemovedIds(prev => [...prev, id]);
    setRows(prev => prev.filter(r => r.id !== id));
  }

  /** What is wrong with the grade typed on this row (outside the school's scale / not one of its letters), or null. */
  const gradeProblem = (grade: string): string | null => (config ? validateGradeValue(grade, config, letterGrades) : null);
  const allowedHint = gradeInputHint(config, letterGrades);

  // Live preview from what is on screen right now (saved or not), using the shared calculation.
  const preview = useMemo(() => {
    const named = rows.filter(r => r.subject.trim());
    return {
      detail: gwaDetail(named.map(r => ({ grade: r.grade, units: parseUnits(r.unitsText), excludeFromGwa: r.excludeFromGwa })), letterGrades),
      missingUnits: named.filter(r => needsUnits({ units: parseUnits(r.unitsText), excludeFromGwa: r.excludeFromGwa })).length,
    };
  }, [rows, letterGrades]);

  async function handleSave() {
    setError("");
    setSavedNote("");
    if (!canEdit) {
      setError("This period is not Open, so grades can't be changed. Choose an Open period.");
      return;
    }
    if (!period.schoolYear || !period.semester) {
      setError("No grading period is selected — ask CEDO staff to set one from the monitoring tool first.");
      return;
    }
    const badGradeIndex = rows.findIndex(r => r.subject.trim() && gradeProblem(r.grade));
    if (badGradeIndex !== -1) { setError(`Row ${badGradeIndex + 1}: ${gradeProblem(rows[badGradeIndex].grade)}`); return; }
    const problem = validateEntryRows(rows.map(r => ({
      id: r.id, subjectCode: r.subjectCode, subject: r.subject, grade: r.grade, unitsText: r.unitsText, hadUnits: r.units != null,
    })));
    if (problem) { setError(problem); return; }

    const dirtyRows = rows.filter(r => r.dirty && r.subject.trim());
    if (dirtyRows.length === 0 && removedIds.length === 0) {
      setSavedNote("No changes to save.");
      return;
    }

    setSaving(true);
    const saved: SavedRow[] = [];
    let failure = "";
    for (const r of dirtyRows) {
      const units = parseUnits(r.unitsText);
      const result = await upsertGrade({
        id: r.isNew ? null : r.id, scholarIdNumber: r.scholarIdNumber, schoolYear: period.schoolYear,
        semester: period.semester, subjectCode: r.subjectCode, subject: r.subject, grade: r.grade,
        units, excludeFromGwa: r.excludeFromGwa,
      });
      if (!result.ok || !result.id) { failure = result.error || "Failed to save."; break; }
      saved.push({ id: result.id, subject: r.subject, grade: r.grade, units, excludeFromGwa: r.excludeFromGwa });
    }
    let removedCount = 0;
    if (!failure && removedIds.length > 0) {
      const removed = await deleteGradeRows(removedIds);
      if (removed.ok) removedCount = removedIds.length;
      else failure = removed.error || "Failed to remove subjects.";
    }

    // Always re-read, even after a failure part-way through: show what the database really holds.
    const fresh = await fetchScholarGradesChecked(scholar.scholarIdNumber, period);
    if (fresh.ok) {
      setRows(toEditable(fresh.rows));
      setRemovedIds([]);
    }
    if (saved.length > 0 || removedCount > 0) onSaved?.();
    setSaving(false);

    if (failure) { setError(failure); return; }
    if (!fresh.ok) {
      setError(`Your changes were sent, but we couldn't read them back to confirm: ${fresh.error}`);
      return;
    }
    const unconfirmed = findUnconfirmed(saved, fresh.rows);
    if (unconfirmed.length > 0) {
      setError(`These did not save: ${unconfirmed.join(", ")}. Please try again, and tell CEDO if it keeps happening.`);
      return;
    }
    setSavedNote(savedMessage(saved, removedCount, period));
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center px-4 py-8" onClick={onClose}>
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-5 py-4 rounded-t-2xl shrink-0">
          <div>
            <h3 className="text-white font-bold text-[14.5px]">{displayName(scholar)}</h3>
            <p className="text-white/70 text-[11.5px]">{scholar.scholarIdNumber} — {period.schoolYear || "—"} · {period.semester || "—"}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-white/70 hover:text-white"><X size={18} /></button>
        </div>

        <div className="p-5 overflow-y-auto flex-1">
          {loading ? (
            <p className="text-[14px] text-slate-700 text-center py-6">Loading…</p>
          ) : (
            <>
              {!canEdit && (
                <p className="text-[14px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
                  Read-only — {periodLabel(period) || "this period"} is not Open, so grades can't be added or changed.
                </p>
              )}
              {rows.length === 0 && (
                <p className="text-[14.5px] text-slate-800 mb-3">No subjects declared for {periodLabel(period) || "this period"} yet{canEdit ? " — add subjects below, or use Upload CSV on the Scholars tab to add many at once." : "."}</p>
              )}

              {rows.length > 0 && (
                <div className="hidden sm:grid grid-cols-[6rem_1fr_4.5rem_5rem_9.5rem_1.5rem] gap-2 px-0.5 mb-1 text-[13px] font-bold text-slate-800">
                  <span>Code</span><span>Subject name</span><span>Units</span><span>Grade</span><span>Exclude from GWA</span><span />
                </div>
              )}
              <div className="space-y-2 mb-3">
                {rows.map((r, i) => {
                  const noUnits = r.subject.trim() !== "" && needsUnits({ units: parseUnits(r.unitsText), excludeFromGwa: r.excludeFromGwa });
                  const gradeErr = r.grade.trim() ? gradeProblem(r.grade) : null;
                  return (
                    <div key={r.id}>
                    <div className="grid grid-cols-2 sm:grid-cols-[6rem_1fr_4.5rem_5rem_9.5rem_1.5rem] gap-2 items-center">
                      <input value={r.subjectCode} onChange={e => updateRow(r.id, "subjectCode", e.target.value)} placeholder="Code" aria-label={`Subject code, row ${i + 1}`} disabled={!canEdit}
                        className={inputClass} />
                      <input value={r.subject} onChange={e => updateRow(r.id, "subject", e.target.value)} placeholder="Subject name" aria-label={`Subject name, row ${i + 1}`} disabled={!canEdit}
                        className={inputClass} />
                      <input value={r.unitsText} onChange={e => updateRow(r.id, "unitsText", e.target.value)} placeholder="Units" inputMode="decimal" aria-label={`Units, row ${i + 1}`} disabled={!canEdit}
                        title={noUnits ? "No units yet — counted as 1 unit until you enter them" : undefined}
                        className={`${inputClass} ${noUnits ? "border-amber-400 bg-amber-50" : ""}`} />
                      <input value={r.grade} onChange={e => updateRow(r.id, "grade", e.target.value)} placeholder="Grade" aria-label={`Grade, row ${i + 1}`} disabled={!canEdit}
                        aria-invalid={gradeErr ? true : undefined} aria-describedby={gradeErr ? `grade-err-${r.id}` : undefined}
                        className={`${inputClass} ${gradeErr ? "border-red-600 bg-red-50" : ""}`} />
                      <label className="flex items-center gap-1.5 text-[14px] text-slate-800">
                        <input type="checkbox" checked={r.excludeFromGwa} onChange={e => toggleExclude(r.id, e.target.checked)} disabled={!canEdit}
                          aria-label={`Exclude from GWA, row ${i + 1}`} className="h-4 w-4 accent-[#062444]" />
                        <span className="sm:hidden">Exclude from GWA</span>
                        <span className="hidden sm:inline">Exclude</span>
                      </label>
                      <button onClick={() => removeRow(r.id)} disabled={!canEdit} aria-label={`Remove row ${i + 1}`} className="text-slate-700 hover:text-red-700 shrink-0 disabled:opacity-30 justify-self-end sm:justify-self-auto">
                        <Trash2 size={15} />
                      </button>
                    </div>
                    {gradeErr && <p id={`grade-err-${r.id}`} className="text-[14px] text-red-800 mt-1">{gradeErr}</p>}
                    </div>
                  );
                })}
              </div>
              {rows.length > 0 && <p className="text-[14px] text-slate-700 mb-2">{allowedHint}. Leave the grade blank until it is available.</p>}
              {canEdit && (
                <button onClick={addRow} className="flex items-center gap-1 text-[14px] font-semibold text-[#0077b6] hover:opacity-80">
                  <Plus size={13} /> Add subject
                </button>
              )}

              {rows.some(r => r.subject.trim()) && (
                <div className="mt-4 rounded-xl border border-[#e6ecf5] bg-[#f7f9fc] px-4 py-3" aria-live="polite">
                  <p className="text-[14px] text-[#062444]">
                    <strong>GWA for these subjects: {formatGwa(preview.detail.gwa)}</strong>
                    <span className="text-slate-700"> — weighted by units{preview.detail.subjectsCounted > 0 ? ` (${preview.detail.subjectsCounted} subject${preview.detail.subjectsCounted === 1 ? "" : "s"}, ${preview.detail.unitsCounted} unit${preview.detail.unitsCounted === 1 ? "" : "s"} counted)` : ""}</span>
                  </p>
                  {preview.detail.excluded > 0 && (
                    <p className="text-[14px] text-slate-700 mt-0.5">{preview.detail.excluded} subject{preview.detail.excluded === 1 ? " is" : "s are"} excluded from the GWA.</p>
                  )}
                  {preview.missingUnits > 0 && (
                    <p className="flex items-start gap-1.5 text-[14px] text-amber-900 mt-1.5">
                      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                      <span>{preview.missingUnits} subject{preview.missingUnits === 1 ? " has" : "s have"} no units yet and {preview.missingUnits === 1 ? "is" : "are"} counted as 1 unit. Enter the units (highlighted) to make the GWA accurate.</span>
                    </p>
                  )}
                </div>
              )}

              {removedIds.length > 0 && (
                <p className="text-[14px] text-amber-900 mt-3">{removedIds.length} saved subject{removedIds.length === 1 ? "" : "s"} will be deleted when you press Save.</p>
              )}
            </>
          )}
          {error && <p role="alert" className="text-[14px] text-red-700 mt-3">{error}</p>}
          {savedNote && (
            <p role="status" className="flex items-center gap-1.5 text-[14px] font-semibold text-green-800 bg-green-50 border border-green-200 rounded-lg px-3 py-2 mt-3">
              <CheckCircle2 size={14} className="shrink-0" /> {savedNote}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-[#f0f3f8] shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-[#062444]/20 text-[14px] font-semibold text-[#062444]">Close</button>
          <button onClick={handleSave} disabled={saving || loading || !canEdit}
            className="flex items-center gap-1.5 bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-60 text-white text-[14px] font-semibold rounded-lg px-4 py-2">
            <Save size={13} /> {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
