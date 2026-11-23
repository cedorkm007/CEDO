// ─────────────────────────────────────────────────────────────
// src/sead/sdpCreditedApi.ts
// SDP Monitoring > an activity > Credited Scholars: the calls of the tab (supabase_migration_sdp_credited_scholars_paging.sql). The database decides who may see and change credits and how credits are counted;
// these calls just ask. Crediting and removing use the same functions / rules as before (credit_scholar_for_day, creditAttendance, delete of a credit, move_sdp_credit_semester).
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";
import type { CreditPeriod } from "./sdpMonitorApi";
import type { CreditedSort, SemesterCount } from "@/lib/sdpCreditedView";
import { sortParams } from "@/lib/sdpCreditedView";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));
const strOrNull = (v: unknown) => (v == null ? null : String(v));
const num = (v: unknown) => (v == null ? 0 : Number(v));
export type Failed = { ok: false; error: string; missing: boolean };
const isMissingFn = (e: { code?: string; message?: string }) => e.code === "PGRST202" || /could not find the function|does not exist/i.test(e.message ?? "");
const failed = (e: { code?: string; message?: string }): Failed => ({ ok: false, error: e.message ?? "Something went wrong.", missing: isMissingFn(e) });
export const SDP_CREDITED_SQL = "supabase_migration_sdp_credited_scholars_paging.sql";

export interface CreditedSummary { credited: number; scholars: number; notCredited: number; creditable: number; semesters: SemesterCount[] }
/** The numbers on "Credited (N)" / "Not credited (N)" and the semesters of the credits, in ONE small answer. */
export async function fetchCreditedSummary(activityId: string): Promise<{ ok: true; summary: CreditedSummary } | Failed> {
  const { data, error } = await supabase.rpc("sdp_credited_summary", { p_activity_id: activityId }).maybeSingle();
  if (error) return failed(error);
  const r = (data ?? {}) as Row;
  return {
    ok: true,
    summary: {
      credited: num(r.credited_count), scholars: num(r.scholar_count), notCredited: num(r.not_credited_count), creditable: num(r.creditable_count),
      semesters: ((r.semesters ?? []) as Row[]).map(s => ({ schoolYear: strOrNull(s.school_year), semester: strOrNull(s.semester), n: num(s.n) })),
    },
  };
}

export interface CreditedRow {
  id: string; scholarIdNumber: string; firstName: string; lastName: string; attendedDate: string; activityDay: string | null; activitySid: string | null; schoolYear: string | null; semester: string | null;
}
export interface CreditedQuery { activityId: string; search: string; sort: CreditedSort; schoolYear: string | null; semester: string | null; noSemester: boolean; page: number; pageSize: number }
/** ONE PAGE of the credits of an activity with the TRUE total. */
export async function fetchCreditedPage(q: CreditedQuery): Promise<{ ok: true; rows: CreditedRow[]; total: number } | Failed> {
  const s = sortParams(q.sort);
  const { data, error } = await supabase.rpc("sdp_credited_page", {
    p_activity_id: q.activityId, p_search: q.search.trim(), p_school_year: q.schoolYear, p_semester: q.semester, p_no_semester: q.noSemester,
    p_sort: s.key, p_dir: s.dir, p_limit: q.pageSize, p_offset: (Math.max(1, q.page) - 1) * q.pageSize,
  });
  if (error) return failed(error);
  const rows = (data ?? []) as Row[];
  return {
    ok: true, total: rows.length ? num(rows[0].total_count) : 0,
    rows: rows.map(r => ({
      id: str(r.id), scholarIdNumber: str(r.scholar_id_number), firstName: str(r.first_name), lastName: str(r.last_name), attendedDate: str(r.attended_date).slice(0, 10),
      activityDay: strOrNull(r.activity_day)?.slice(0, 10) ?? null, activitySid: strOrNull(r.activity_sid), schoolYear: strOrNull(r.school_year), semester: strOrNull(r.semester),
    })),
  };
}

export interface NotCreditedRow { scholarIdNumber: string; firstName: string; lastName: string; attendanceStatus: string; reasonCode: string; canCredit: boolean }
/** ONE PAGE of the scholars who attended (scanned the QR code / present) but have no credit, with the reason code and whether they can be credited. */
export async function fetchNotCreditedPage(activityId: string, search: string, page: number, pageSize: number): Promise<{ ok: true; rows: NotCreditedRow[]; total: number } | Failed> {
  const { data, error } = await supabase.rpc("sdp_not_credited_page", { p_activity_id: activityId, p_search: search.trim(), p_limit: pageSize, p_offset: (Math.max(1, page) - 1) * pageSize });
  if (error) return failed(error);
  const rows = (data ?? []) as Row[];
  return {
    ok: true, total: rows.length ? num(rows[0].total_count) : 0,
    rows: rows.map(r => ({ scholarIdNumber: str(r.scholar_id_number), firstName: str(r.first_name), lastName: str(r.last_name), attendanceStatus: str(r.attendance_status), reasonCode: str(r.reason_code), canCredit: !!r.can_credit })),
  };
}

/** Credits only the ticked scholars (the same rules as "Credit these scholars"; nobody is credited twice). */
export async function creditSelectedScholars(activityId: string, scholarIds: string[], period: CreditPeriod | null): Promise<{ ok: true; count: number } | Failed> {
  const { data, error } = await supabase.rpc("sdp_credit_selected", { p_activity_id: activityId, p_scholar_ids: scholarIds, p_school_year: period?.schoolYear ?? null, p_semester: period?.semester ?? null });
  if (error) return failed(error);
  return { ok: true, count: num(data) };
}

/** Moves several credits to another semester at once (each move is written to the history, as for one credit). */
export async function moveCreditsSemester(creditIds: string[], period: CreditPeriod): Promise<{ ok: true; count: number } | Failed> {
  const { data, error } = await supabase.rpc("sdp_move_credits_semester", { p_credit_ids: creditIds, p_school_year: period.schoolYear, p_semester: period.semester });
  if (error) return failed(error);
  return { ok: true, count: num(data) };
}

/** Removes several credits (the same delete as removing one; the database writes a history line for each). */
export async function removeCredits(creditIds: string[]): Promise<{ ok: boolean; error?: string }> {
  if (creditIds.length === 0) return { ok: true };
  const { error } = await supabase.from("sdp_attendance").delete().in("id", creditIds);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export interface ScholarMatch { scholarIdNumber: string; name: string; school: string }
/** The scholar search of the credit form: an indexed match on the Scholar ID and the name (either order), the first 10. Falls back to the older search before the database update. */
export async function searchScholarsForCredit(query: string, activityId: string): Promise<ScholarMatch[] | null> {
  const q = query.trim();
  if (!q) return [];
  const { data, error } = await supabase.rpc("sdp_search_scholars", { p_query: q, p_activity_id: activityId, p_limit: 10 });
  if (error) return null;      // the caller uses the older search
  return ((data ?? []) as Row[]).map(r => ({ scholarIdNumber: str(r.scholar_id_number), name: str(r.name), school: str(r.school) }));
}
