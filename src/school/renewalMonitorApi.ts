// ─────────────────────────────────────────────────────────────
// src/school/renewalMonitorApi.ts
// The School Portal's Renewal tab: the renewal windows that apply to the school, the school's scholars in one renewal, and the numbers for the progress bar.
// The database (supabase_migration_school_renewal_tab.sql) answers only for the signed-in school's own scholars. `missing: true` = that database update has not been run yet.
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";
import type { RenewalGroup, SchoolRenewalRow, SchoolRenewalSummary } from "./renewalMonitorLogic";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));
const num = (v: unknown) => (v == null ? 0 : Number(v));
const isMissing = (e: { code?: string; message?: string }) => e.code === "PGRST202" || /could not find the function|does not exist/i.test(e.message ?? "");
type Failed = { ok: false; error: string; missing: boolean };
const failed = (e: { code?: string; message?: string }): Failed => ({ ok: false, error: e.message ?? "Something went wrong.", missing: isMissing(e) });

export interface SchoolRenewalWindow { schoolYear: string; term: string; opensOn: string; closesOn: string; lateAllowed: boolean }

export async function fetchSchoolRenewalWindows(): Promise<{ ok: true; windows: SchoolRenewalWindow[] } | Failed> {
  const { data, error } = await supabase.rpc("school_renewal_windows");
  if (error) return failed(error);
  return { ok: true, windows: ((data ?? []) as Row[]).map(w => ({ schoolYear: str(w.school_year), term: str(w.term), opensOn: str(w.opens_on), closesOn: str(w.closes_on), lateAllowed: !!w.late_allowed })) };
}

export async function fetchSchoolRenewalRows(schoolYear: string, term: string): Promise<{ ok: true; rows: SchoolRenewalRow[] } | Failed> {
  const { data, error } = await supabase.rpc("school_renewal_list", { p_school_year: schoolYear, p_term: term });
  if (error) return failed(error);
  return {
    ok: true,
    rows: ((data ?? []) as Row[]).map(r => ({
      scholarIdNumber: str(r.scholar_id_number), schoolStudentNo: str(r.school_student_no), lastName: str(r.last_name), firstName: str(r.first_name), middleName: str(r.middle_name),
      yearLevel: str(r.year_level), program: str(r.program), scholarStatus: str(r.scholar_status), stage: r.stage == null ? null : str(r.stage), isLate: !!r.is_late,
      group: str(r.grp) as RenewalGroup, probation: !!r.probation, gradesState: r.grades_state == null ? null : str(r.grades_state), failed: num(r.failed), inc: num(r.inc), review: num(r.review),
    })),
  };
}

export async function fetchSchoolRenewalSummary(schoolYear: string, term: string): Promise<{ ok: true; summary: SchoolRenewalSummary } | Failed> {
  const { data, error } = await supabase.rpc("school_renewal_summary", { p_school_year: schoolYear, p_term: term });
  if (error) return failed(error);
  const s = (data ?? {}) as Row;
  return {
    ok: true,
    summary: {
      total: num(s.total), applied: num(s.applied), renewed: num(s.renewed), removed: num(s.removed), notApplied: num(s.not_applied), notRequired: num(s.not_required),
      probation: num(s.probation), withIncOrFailed: num(s.with_inc_or_failed), basisSchoolYear: str(s.basis_school_year), basisTerm: str(s.basis_term),
    },
  };
}
