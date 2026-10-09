// ─────────────────────────────────────────────────────────────
// src/lib/academicPeriodsApi.ts
// Reads and (staff only) writes academic periods. See
// supabase_migration_academic_periods.sql. Reading is open to any signed-in
// account (school, scholar or staff); changes go through RPCs that check the
// scholars_grades_monitoring tag.
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";
import { TERMS, type AcademicPeriod, type PeriodStatus, type Term } from "./academicPeriods";

export type PeriodsResult = { ok: true; periods: AcademicPeriod[] } | { ok: false; error: string };

export async function fetchAcademicPeriods(): Promise<PeriodsResult> {
  const { data, error } = await supabase.from("academic_periods").select("id, school_year, term, status, submission_deadline");
  if (error) return { ok: false, error: error.message };
  const periods: AcademicPeriod[] = (data ?? [])
    .filter(r => (TERMS as readonly string[]).includes(String(r.term)))
    .map(r => ({
      id: String(r.id), schoolYear: String(r.school_year), term: String(r.term) as Term,
      status: String(r.status) as PeriodStatus, deadline: r.submission_deadline ? String(r.submission_deadline) : null,
    }));
  return { ok: true, periods };
}

/** Staff: add a period or change its status / deadline. Leave `status` or `deadline` undefined to keep what is stored; pass `clearDeadline` to remove a deadline. */
export async function upsertAcademicPeriod(input: {
  schoolYear: string; term: string; status?: PeriodStatus; deadline?: string | null; clearDeadline?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc("upsert_academic_period", {
    p_school_year: input.schoolYear, p_term: input.term, p_status: input.status ?? null,
    p_deadline: input.deadline || null, p_clear_deadline: !!input.clearDeadline,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}
