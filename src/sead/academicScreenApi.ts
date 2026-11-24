// ─────────────────────────────────────────────────────────────
// src/sead/academicScreenApi.ts
// The calls behind the school screen of Scholar Management Tools > Scholars > Grades and Academic Management (supabase_migration_academic_status_screen.sql).
// The database decides who may do what (the Scholar Management staff) and checks every change; these calls just ask.
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";
import { SCREEN_PAGE_SIZE, filterToJson, type ScreenFilter, type ScreenImpact, type ScreenStatus } from "@/lib/academicScreen";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));
const strOrNull = (v: unknown) => (v == null ? null : String(v));
const numOrNull = (v: unknown) => (v == null ? null : Number(v));
const isMissing = (e: { code?: string; message?: string }) => e.code === "PGRST202" || /could not find the function|does not exist/i.test(e.message ?? "");
export type Failed = { ok: false; error: string; missing: boolean };
const failed = (e: { code?: string; message?: string }): Failed => ({ ok: false, error: e.message ?? "Something went wrong.", missing: isMissing(e) });

export interface ScreenRow {
  scholarId: string; name: string; program: string; yearLevel: string; scholarship: string; status: ScreenStatus; isSet: boolean;
  customGwa: number | null; passingGwa: number | null; updatedAt: string | null; updatedBy: string | null;
}
export type ScreenSort = "name" | "id" | "program" | "year" | "scholarship" | "status" | "updated";

export async function fetchScreenPage(schoolId: string, filter: ScreenFilter, sort: ScreenSort, dir: "asc" | "desc", page: number): Promise<{ ok: true; rows: ScreenRow[]; total: number } | Failed> {
  const { data, error } = await supabase.rpc("academic_school_scholars", { p_school: schoolId, p_filter: filterToJson(filter), p_sort: sort, p_dir: dir, p_limit: SCREEN_PAGE_SIZE, p_offset: (page - 1) * SCREEN_PAGE_SIZE });
  if (error) return failed(error);
  const list = (data ?? []) as Row[];
  return {
    ok: true, total: list.length ? Number(list[0].total) : 0,
    rows: list.map(r => ({
      scholarId: str(r.scholar_id_number), name: str(r.name), program: str(r.program), yearLevel: str(r.year_level), scholarship: str(r.scholarship_status),
      status: (r.academic_status == null ? "not_set" : str(r.academic_status)) as ScreenStatus, isSet: !!r.is_set, customGwa: numOrNull(r.custom_passing_gwa), passingGwa: numOrNull(r.passing_gwa),
      updatedAt: strOrNull(r.updated_at), updatedBy: strOrNull(r.updated_by),
    })),
  };
}

export interface ScreenFacets { total: number; academic: number; nonAcademic: number; notSet: number; custom: number; removed: number; programs: { key: string; program: string; n: number }[]; years: { value: string; n: number }[]; scholarship: { value: string; n: number }[] }
export async function fetchScreenFacets(schoolId: string): Promise<{ ok: true; facets: ScreenFacets } | Failed> {
  const { data, error } = await supabase.rpc("academic_school_facets", { p_school: schoolId });
  if (error || !data) return error ? failed(error) : { ok: false, error: "Couldn't load the school.", missing: false };
  const d = data as Row;
  return {
    ok: true,
    facets: {
      total: Number(d.total ?? 0), academic: Number(d.academic ?? 0), nonAcademic: Number(d.non_academic ?? 0), notSet: Number(d.not_set ?? 0), custom: Number(d.custom ?? 0), removed: Number(d.removed ?? 0),
      programs: ((d.programs ?? []) as Row[]).map(p => ({ key: str(p.key), program: str(p.program), n: Number(p.n) })),
      years: ((d.years ?? []) as Row[]).map(p => ({ value: str(p.value), n: Number(p.n) })),
      scholarship: ((d.scholarship ?? []) as Row[]).map(p => ({ value: str(p.value), n: Number(p.n) })),
    },
  };
}

/** Who is changed: the chosen Scholar IDs, or (ids = null) ALL that match the filter. */
export interface ChangeTarget { schoolId: string; filter: ScreenFilter; ids: string[] | null }
export interface ChangeWhat { status: ScreenStatus; customGwa: number | null; clearCustom: boolean }

export async function fetchImpact(t: ChangeTarget, w: ChangeWhat): Promise<{ ok: true; impact: ScreenImpact } | Failed> {
  const { data, error } = await supabase.rpc("academic_status_impact", { p_school: t.schoolId, p_filter: filterToJson(t.filter), p_ids: t.ids, p_status: w.status, p_custom: w.customGwa, p_clear_custom: w.clearCustom });
  if (error) return failed(error);
  const d = (data ?? {}) as Row;
  return {
    ok: true,
    impact: {
      total: Number(d.total ?? 0), willChange: Number(d.will_change ?? 0), same: Number(d.same ?? 0), fromNotSet: Number(d.from_not_set ?? 0), fromAcademic: Number(d.from_academic ?? 0), fromNonAcademic: Number(d.from_non_academic ?? 0),
      customSet: Number(d.custom_set ?? 0), customCleared: Number(d.custom_cleared ?? 0), openRenewals: Number(d.open_renewals ?? 0), ruleOn: !!d.rule_on,
      academicPassingGwa: numOrNull(d.academic_passing_gwa), nonAcademicPassingGwa: numOrNull(d.non_academic_passing_gwa),
    },
  };
}

export async function applyChange(t: ChangeTarget, w: ChangeWhat, reason: string, expected: number): Promise<{ ok: true; changed: number; same: number } | Failed> {
  const { data, error } = await supabase.rpc("academic_status_apply", { p_school: t.schoolId, p_filter: filterToJson(t.filter), p_ids: t.ids, p_status: w.status, p_custom: w.customGwa, p_clear_custom: w.clearCustom, p_reason: reason.trim() || null, p_expected: expected });
  if (error) return failed(error);
  const d = (data ?? {}) as Row;
  return { ok: true, changed: Number(d.changed ?? 0), same: Number(d.same ?? 0) };
}

export interface HistoryRow { at: string; scholarId: string | null; name: string | null; oldStatus: string | null; newStatus: string | null; oldCustom: number | null; newCustom: number | null; how: string; reason: string | null; by: string }
const mapHistory = (r: Row): HistoryRow => ({ at: str(r.at), scholarId: strOrNull(r.scholar_id_number), name: strOrNull(r.name), oldStatus: strOrNull(r.old_status), newStatus: strOrNull(r.new_status), oldCustom: numOrNull(r.old_custom_gwa), newCustom: numOrNull(r.new_custom_gwa), how: str(r.how), reason: strOrNull(r.reason), by: str(r.by_label) });
export async function fetchScholarHistory(scholarId: string): Promise<{ ok: true; rows: HistoryRow[] } | Failed> {
  const { data, error } = await supabase.rpc("academic_status_history_scholar", { p_scholar: scholarId });
  return error ? failed(error) : { ok: true, rows: ((data ?? []) as Row[]).map(mapHistory) };
}
export async function fetchSchoolHistory(schoolId: string, page: number): Promise<{ ok: true; rows: HistoryRow[]; total: number } | Failed> {
  const { data, error } = await supabase.rpc("academic_status_history_school", { p_school: schoolId, p_limit: SCREEN_PAGE_SIZE, p_offset: (page - 1) * SCREEN_PAGE_SIZE });
  if (error) return failed(error);
  const list = (data ?? []) as Row[];
  return { ok: true, total: list.length ? Number(list[0].total) : 0, rows: list.map(mapHistory) };
}

export interface ScholarStatusInfo { scholarId: string; status: ScreenStatus; isSet: boolean; passingGwa: number | null; custom: boolean }
/** The status and the passing GWA used for some scholars (the Information list, its export, the renewal case). Empty when the database update is not run yet. */
export async function fetchStatusOf(ids: string[]): Promise<Map<string, ScholarStatusInfo>> {
  const out = new Map<string, ScholarStatusInfo>();
  const unique = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 500) {
    const { data, error } = await supabase.rpc("academic_status_of_scholars", { p_ids: unique.slice(i, i + 500) });
    if (error) return out;
    for (const r of (data ?? []) as Row[]) out.set(str(r.scholar_id_number), { scholarId: str(r.scholar_id_number), status: str(r.academic_status) as ScreenStatus, isSet: !!r.is_set, passingGwa: numOrNull(r.passing_gwa), custom: !!r.custom });
  }
  return out;
}
