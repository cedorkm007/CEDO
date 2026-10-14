// ─────────────────────────────────────────────────────────────
// src/sead/studyPlanFormsApi.ts
// Forms Management: which blank form is the STUDY PLAN form of which school (each school has its own version). The forms themselves are
// added in the Materials section as usual; this only chooses. See supabase_migration_renewal_p4_tracker.sql.
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";

export interface StudyPlanSchool { id: string; name: string; scholars: number }
/** schoolId null = the default used by every school without its own choice. */
export interface StudyPlanAssignment { schoolId: string | null; materialId: string }

export async function fetchStudyPlanFormSetup(): Promise<{ ok: true; schools: StudyPlanSchool[]; assignments: StudyPlanAssignment[] } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("renewal_study_plan_form_setup");
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't load the schools." };
  const d = data as { schools?: Record<string, unknown>[]; assignments?: Record<string, unknown>[] };
  return {
    ok: true,
    schools: (d.schools ?? []).map(s => ({ id: String(s.id), name: String(s.name ?? ""), scholars: Number(s.scholars ?? 0) })),
    assignments: (d.assignments ?? []).map(a => ({ schoolId: a.school_id == null ? null : String(a.school_id), materialId: String(a.material_id) })),
  };
}

/** Choose the study plan form of a school (null school = the default); a null material clears the choice. */
export async function setStudyPlanForm(schoolId: string | null, materialId: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.rpc("renewal_study_plan_form_set", { p_school_id: schoolId, p_material_id: materialId });
  return error ? { ok: false, error: error.message } : { ok: true };
}
