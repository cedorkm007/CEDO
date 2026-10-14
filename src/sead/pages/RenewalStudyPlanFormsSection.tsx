import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { fetchFormMaterials, type FormMaterial } from "../formsManagementApi";
import { fetchStudyPlanFormSetup, setStudyPlanForm, type StudyPlanAssignment, type StudyPlanSchool } from "../studyPlanFormsApi";

/**
 * "Renewal study plans": every school has its own version of the blank study plan form. Upload each version in Materials as usual, then choose
 * here which one each school's scholars get from the Renewal tile ("Download the study plan form"). Schools with no choice use the default.
 * The chosen form does not have to be unlocked for everyone — scholars of that school can always download it from their Renewal tile.
 */
export function RenewalStudyPlanFormsSection() {
  const [schools, setSchools] = useState<StudyPlanSchool[]>([]);
  const [assignments, setAssignments] = useState<StudyPlanAssignment[]>([]);
  const [materials, setMaterials] = useState<FormMaterial[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [setup, mats] = await Promise.all([fetchStudyPlanFormSetup(), fetchFormMaterials()]);
    if (!setup.ok) { setError(setup.error); setLoading(false); return; }
    setSchools(setup.schools); setAssignments(setup.assignments); setMaterials(mats); setError(""); setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const choice = (schoolId: string | null) => assignments.find(a => a.schoolId === schoolId)?.materialId ?? "";
  const usable = materials.filter(m => m.kind === "flipbook" || m.fileName);

  async function choose(schoolId: string | null, materialId: string) {
    const key = schoolId ?? "default";
    setSaving(key); setSaved(null); setError("");
    const r = await setStudyPlanForm(schoolId, materialId || null);
    setSaving(null);
    if (!r.ok) { setError(r.error); return; }
    setAssignments(prev => [...prev.filter(a => a.schoolId !== schoolId), ...(materialId ? [{ schoolId, materialId }] : [])]);
    setSaved(key);
  }

  const row = (schoolId: string | null, label: string, note?: string) => {
    const key = schoolId ?? "default";
    const selectId = `spf-${key}`;
    return (
      <li key={key} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e6ecf5] bg-white px-4 py-3">
        <div className="min-w-0">
          <label htmlFor={selectId} className="text-[14px] font-bold text-[#062444]">{label}</label>
          {note && <p className="text-[13.5px] text-slate-700">{note}</p>}
        </div>
        <div className="flex items-center gap-2">
          <select id={selectId} value={choice(schoolId)} onChange={e => void choose(schoolId, e.target.value)} disabled={saving === key}
            className="max-w-[18rem] rounded-lg border border-[#062444]/25 bg-white px-3 py-2 text-[14px] outline-none focus:border-[#062444]">
            <option value="">{schoolId === null ? "— none —" : "— use the default —"}</option>
            {usable.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
          </select>
          {saving === key && <Loader2 size={15} className="animate-spin" aria-label="Saving" />}
          {saved === key && <span className="flex items-center gap-1 text-[14px] font-semibold text-green-800"><CheckCircle2 size={14} aria-hidden="true" /> Saved</span>}
        </div>
      </li>
    );
  };

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-[15px] font-extrabold text-[#062444]">Renewal study plan forms</h2>
        <p className="mt-1 text-[14px] text-slate-700">
          Each school has its own version of the blank study plan form. Upload every version in <strong>Materials</strong>, then choose here which one each school's scholars get when they open their Renewal tile
          ("Download the study plan form"). A school with no choice uses the default. Scholars of a school can always download the form chosen for them from the Renewal tile, even if it is locked in their Forms tab.
        </p>
      </div>
      {error && <p role="alert" className="mb-3 text-[14px] text-red-700">{error}</p>}
      {loading ? <p className="text-[14px] text-slate-700">Loading…</p> : (
        <>
          {usable.length === 0 && <p className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[14px] text-amber-950">No form with an uploaded file yet. Add the study plan forms in <strong>Materials</strong> first.</p>}
          <ul className="space-y-2.5">
            {row(null, "Default (all other schools)", "Used for any school that has no choice of its own below.")}
            {schools.map(s => row(s.id, s.name, `${s.scholars} scholar${s.scholars === 1 ? "" : "s"}${choice(s.id) ? "" : choice(null) ? " · uses the default" : " · no form chosen yet"}`))}
          </ul>
        </>
      )}
    </div>
  );
}
