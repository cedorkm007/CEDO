// ─────────────────────────────────────────────────────────────
// src/sead/studyPlanFormsApi.ts
// Forms Management: each school has its own STUDY PLAN template. The office uploads it on that school's row; the system keeps it in its own private
// folder and names the scholar's download ("Study Plan Form - <school>.pdf"). See supabase_migration_renewal_p4_tracker.sql.
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";
import { studyPlanFileType, validateStudyPlanTemplate } from "@/lib/renewal";

const BUCKET = "renewal-study-plan-forms";

export interface StudyPlanSchool { id: string; name: string; scholars: number }
/** schoolId null = the default used by every school without its own template. */
export interface StudyPlanTemplate { schoolId: string | null; storagePath: string; fileName: string; updatedAt: string }

export async function fetchStudyPlanFormSetup(): Promise<{ ok: true; schools: StudyPlanSchool[]; templates: StudyPlanTemplate[] } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("renewal_study_plan_form_setup");
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't load the schools." };
  const d = data as { schools?: Record<string, unknown>[]; assignments?: Record<string, unknown>[] };
  return {
    ok: true,
    schools: (d.schools ?? []).map(s => ({ id: String(s.id), name: String(s.name ?? ""), scholars: Number(s.scholars ?? 0) })),
    templates: (d.assignments ?? []).map(a => ({ schoolId: a.school_id == null ? null : String(a.school_id), storagePath: String(a.storage_path), fileName: String(a.file_name ?? ""), updatedAt: String(a.updated_at ?? "") })),
  };
}

/** Upload a school's template (null school = the default) and make it that school's; the previous file, if any, is deleted afterwards. */
export async function uploadStudyPlanTemplate(schoolId: string | null, file: File): Promise<{ ok: true } | { ok: false; error: string }> {
  const problem = validateStudyPlanTemplate(file);
  if (problem) return { ok: false, error: problem };
  const type = studyPlanFileType(file.name)!;
  const path = `${schoolId ?? "default"}/${crypto.randomUUID()}.${type.ext}`;
  const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: type.mime, upsert: false });
  if (up.error) return { ok: false, error: up.error.message };
  const saved = await supabase.rpc("renewal_study_plan_form_save", { p_school_id: schoolId, p_storage_path: path, p_file_name: file.name });
  if (saved.error) {
    await supabase.storage.from(BUCKET).remove([path]);      // do not leave a file nobody points to
    return { ok: false, error: saved.error.message };
  }
  const old = saved.data as string | null;
  if (old) await supabase.storage.from(BUCKET).remove([old]);
  return { ok: true };
}

/** Remove a school's template (its scholars then use the default). */
export async function removeStudyPlanTemplate(schoolId: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("renewal_study_plan_form_remove", { p_school_id: schoolId });
  if (error) return { ok: false, error: error.message };
  if (data) await supabase.storage.from(BUCKET).remove([data as string]);
  return { ok: true };
}

/** A short-lived link for staff to look at a template. */
export async function fetchStudyPlanTemplateUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 300);
  return error || !data ? null : data.signedUrl;
}
