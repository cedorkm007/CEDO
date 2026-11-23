// ─────────────────────────────────────────────────────────────
// src/sead/sdpCreditedFiltersApi.ts
// SDP Monitoring > an activity > Credited Scholars: the calls of the filters that combine, the Export and the Import (supabase_migration_sdp_credited_filters_import.sql). The database does the matching,
// counts the options of every filter, and checks every imported row again when it is saved; these calls just ask.
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";
import type { CreditPeriod } from "./sdpMonitorApi";
import type { CreditedSort } from "@/lib/sdpCreditedView";
import { sortParams } from "@/lib/sdpCreditedView";
import type { Facets, ImportChecked, ImportRow } from "@/lib/sdpCreditedFilters";
import type { CreditedRow, Failed } from "./sdpCreditedApi";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));
const strOrNull = (v: unknown) => (v == null ? null : String(v));
const num = (v: unknown) => (v == null ? 0 : Number(v));
const isMissingFn = (e: { code?: string; message?: string }) => e.code === "PGRST202" || /could not find the function|does not exist/i.test(e.message ?? "");
const failed = (e: { code?: string; message?: string }): Failed => ({ ok: false, error: e.message ?? "Something went wrong.", missing: isMissingFn(e) });

/** Is the filters / export / import database update there? A cheap call that checks the permission and nothing else. */
export async function probeFiltersUpdate(activityId: string): Promise<boolean> {
  const { error } = await supabase.rpc("sdp_import_check", { p_activity_id: activityId, p_rows: [], p_default_school_year: null, p_default_semester: null });
  return !(error && isMissingFn(error));
}

export interface FilteredSummary { credited: number; scholars: number; notCredited: number; creditable: number; eligibleApplicable: boolean; eligible: number }
/** The numbers on the buttons, following the filters and the search. */
export async function fetchFilteredSummary(activityId: string, filters: Record<string, unknown>, search: string): Promise<{ ok: true; summary: FilteredSummary } | Failed> {
  const { data, error } = await supabase.rpc("sdp_credited_summary_f", { p_activity_id: activityId, p_filters: filters, p_search: search.trim() }).maybeSingle();
  if (error) return failed(error);
  const r = (data ?? {}) as Row;
  return { ok: true, summary: { credited: num(r.credited_count), scholars: num(r.scholar_count), notCredited: num(r.not_credited_count), creditable: num(r.creditable_count), eligibleApplicable: !!r.eligible_applicable, eligible: num(r.eligible_count) } };
}

/** The options of every filter with how many scholars each would match given the OTHER filters. */
export async function fetchFacets(activityId: string, kind: "credited" | "not_credited" | "eligible", filters: Record<string, unknown>, search: string): Promise<{ ok: true; facets: Facets } | Failed> {
  const { data, error } = await supabase.rpc("sdp_credited_facets", { p_activity_id: activityId, p_side: kind, p_filters: filters, p_search: search.trim() });
  if (error) return failed(error);
  const raw = (data ?? {}) as Record<string, unknown>;
  const out: Facets = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === "total") { const t = v as Row; out.total = { rows: num(t.rows), scholars: num(t.scholars) }; continue; }
    (out as Record<string, unknown>)[k] = ((v ?? []) as Row[]).map(o => ({ v: str(o.v), n: num(o.n) }));
  }
  return { ok: true, facets: out };
}

export interface FilteredCreditRow extends CreditedRow {
  yearLevel: string; school: string; course: string; barangay: string; cluster: string; scholarStatus: string; how: string; creditedBy: string;
}
/** ONE PAGE (up to 500 rows) of the credits that match the filters and the search, with the TRUE total. Used by the list and by the Export. */
export async function fetchFilteredCredits(activityId: string, filters: Record<string, unknown>, search: string, sort: CreditedSort, page: number, pageSize: number): Promise<{ ok: true; rows: FilteredCreditRow[]; total: number } | Failed> {
  const s = sortParams(sort);
  const { data, error } = await supabase.rpc("sdp_credited_list", { p_activity_id: activityId, p_filters: filters, p_search: search.trim(), p_sort: s.key, p_dir: s.dir, p_limit: pageSize, p_offset: (Math.max(1, page) - 1) * pageSize });
  if (error) return failed(error);
  const rows = (data ?? []) as Row[];
  return {
    ok: true, total: rows.length ? num(rows[0].total_count) : 0,
    rows: rows.map(r => ({
      id: str(r.id), scholarIdNumber: str(r.scholar_id_number), firstName: str(r.first_name), lastName: str(r.last_name), attendedDate: str(r.attended_date).slice(0, 10),
      activityDay: strOrNull(r.activity_day)?.slice(0, 10) ?? null, activitySid: strOrNull(r.activity_sid), schoolYear: strOrNull(r.school_year), semester: strOrNull(r.semester),
      yearLevel: str(r.year_level), school: str(r.school), course: str(r.course), barangay: str(r.barangay), cluster: str(r.cluster), scholarStatus: str(r.scholar_status), how: str(r.how), creditedBy: str(r.credited_by),
    })),
  };
}

export interface FilteredNotCreditedRow { scholarIdNumber: string; firstName: string; lastName: string; yearLevel: string; school: string; course: string; barangay: string; cluster: string; scholarStatus: string; attendanceStatus: string; reasonCode: string; canCredit: boolean }
/** ONE PAGE (up to 500 rows) of the scholars who are not credited ("attended" or "eligible") that match the filters and the search. */
export async function fetchFilteredNotCredited(activityId: string, kind: "attended" | "eligible", filters: Record<string, unknown>, search: string, page: number, pageSize: number): Promise<{ ok: true; rows: FilteredNotCreditedRow[]; total: number } | Failed> {
  const { data, error } = await supabase.rpc("sdp_not_credited_list", { p_activity_id: activityId, p_kind: kind, p_filters: filters, p_search: search.trim(), p_limit: pageSize, p_offset: (Math.max(1, page) - 1) * pageSize });
  if (error) return failed(error);
  const rows = (data ?? []) as Row[];
  return {
    ok: true, total: rows.length ? num(rows[0].total_count) : 0,
    rows: rows.map(r => ({
      scholarIdNumber: str(r.scholar_id_number), firstName: str(r.first_name), lastName: str(r.last_name), yearLevel: str(r.year_level), school: str(r.school), course: str(r.course), barangay: str(r.barangay), cluster: str(r.cluster),
      scholarStatus: str(r.scholar_status), attendanceStatus: str(r.attendance_status), reasonCode: str(r.reason_code), canCredit: !!r.can_credit,
    })),
  };
}

const toChecked = (e: Row): ImportChecked => ({
  i: num(e.i), state: (e.state as ImportChecked["state"]) ?? "error", willCredit: !!e.will_credit, skip: !!e.skip, messages: ((e.messages ?? []) as unknown[]).map(String),
  scholarId: strOrNull(e.scholar_id), name: strOrNull(e.name), date: strOrNull(e.date)?.slice(0, 10) ?? null, schoolYear: strOrNull(e.school_year), semester: strOrNull(e.semester),
});
const importPayload = (rows: ImportRow[]) => rows.map(r => ({ i: r.i, scholar_id: r.scholar_id, date: r.date, date_text: r.date_text, school_year: r.school_year, semester: r.semester, day_sub: r.day_sub, credits: r.credits }));

/** STEP 1 of the import: the database checks every row and saves NOTHING. */
export async function checkImport(activityId: string, rows: ImportRow[], period: CreditPeriod | null): Promise<{ ok: true; rows: ImportChecked[] } | Failed> {
  const { data, error } = await supabase.rpc("sdp_import_check", { p_activity_id: activityId, p_rows: importPayload(rows), p_default_school_year: period?.schoolYear ?? null, p_default_semester: period?.semester ?? null });
  if (error) return failed(error);
  return { ok: true, rows: ((((data ?? {}) as Row).rows ?? []) as Row[]).map(toChecked) };
}

export interface ImportSaveResult { i: number; outcome: "credited" | "skipped" | "error"; message: string | null }
/** STEP 2: the rows are checked again and only the ones that pass are credited (at most 500 at a time). */
export async function saveImport(activityId: string, rows: ImportRow[], period: CreditPeriod | null): Promise<{ ok: true; credited: number; skipped: number; errors: number; results: ImportSaveResult[] } | Failed> {
  const { data, error } = await supabase.rpc("sdp_import_save", { p_activity_id: activityId, p_rows: importPayload(rows), p_default_school_year: period?.schoolYear ?? null, p_default_semester: period?.semester ?? null });
  if (error) return failed(error);
  const r = (data ?? {}) as Row;
  return { ok: true, credited: num(r.credited), skipped: num(r.skipped), errors: num(r.errors), results: ((r.results ?? []) as Row[]).map(x => ({ i: num(x.i), outcome: str(x.outcome) as ImportSaveResult["outcome"], message: strOrNull(x.message) })) };
}
