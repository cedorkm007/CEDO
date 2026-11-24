// ─────────────────────────────────────────────────────────────
// src/sead/academicNotSetApi.ts
// The calls behind the "No academic status" warning in Scholar Management Tools > Scholars > Grades and Academic Management (supabase_migration_academic_scholar_status.sql).
// The database decides who may read this (the Scholar Management staff); these calls just ask.
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));
const num = (v: unknown) => (v == null ? null : Number(v));
const isMissing = (e: { code?: string; message?: string }) => e.code === "PGRST202" || /could not find the function|does not exist/i.test(e.message ?? "");
export type NotSetFailed = { ok: false; error: string; missing: boolean };
const failed = (e: { code?: string; message?: string }): NotSetFailed => ({ ok: false, error: e.message ?? "Something went wrong.", missing: isMissing(e) });

export interface NotSetSchool { schoolId: string | null; school: string; scholars: number; notSet: number; academicPassingGwa: number | null; nonAcademicPassingGwa: number | null; ruleOn: boolean }
export async function fetchNotSetSummary(): Promise<{ ok: true; schools: NotSetSchool[] } | NotSetFailed> {
  const { data, error } = await supabase.rpc("academic_not_set_summary");
  if (error) return failed(error);
  return { ok: true, schools: ((data ?? []) as Row[]).map(r => ({ schoolId: r.school_id == null ? null : str(r.school_id), school: str(r.school), scholars: Number(r.scholars ?? 0), notSet: Number(r.not_set ?? 0), academicPassingGwa: num(r.academic_passing_gwa), nonAcademicPassingGwa: num(r.non_academic_passing_gwa), ruleOn: !!r.rule_on })) };
}

export const NOT_SET_PAGE = 1000;
/** Every scholar with no status (of one school, or of all), read 1,000 at a time. */
export async function fetchNotSetList(schoolId: string | null, onProgress?: (n: number) => void): Promise<{ ok: true; rows: (string | null)[][] } | NotSetFailed> {
  const rows: (string | null)[][] = [];
  for (let offset = 0; ; offset += NOT_SET_PAGE) {
    const { data, error } = await supabase.rpc("academic_not_set_list", { p_school: schoolId, p_limit: NOT_SET_PAGE, p_offset: offset });
    if (error) return failed(error);
    const page = (data ?? []) as Row[];
    for (const r of page) rows.push([str(r.scholar_id_number), str(r.name), str(r.school), str(r.program), str(r.year_level), str(r.scholarship_status), r.rule_on ? "On" : "Off (no passing GWA set)"]);
    onProgress?.(rows.length);
    if (page.length < NOT_SET_PAGE) break;
  }
  return { ok: true, rows };
}
export const NOT_SET_LIST_HEADERS = ["Scholar ID", "Full name", "School", "Program", "Year level", "Scholarship status", "GWA rule"];
