import { supabase } from "@/lib/supabase";
import type { FormationActivity } from "@/scholar/formationActivitiesApi";
import type { AttendanceType, AttendanceCode, AttendanceSession, AttendanceRosterEntry } from "./sdpMonitorApi";

export type NewFormationActivityInput = Pick<FormationActivity, "name" | "shortDescription" | "dateTime" | "endTime" | "venue" | "yearLevels" | "allYearLevels" | "attendanceEnabled">;

function localDateTimeToIso(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function rowToActivity(row: Record<string, unknown>): FormationActivity {
  return {
    id: String(row.id), name: String(row.name ?? ""), shortDescription: String(row.short_description ?? ""),
    dateTime: String(row.date_time ?? ""), endTime: row.end_time ? String(row.end_time) : null, venue: String(row.venue ?? ""),
    yearLevels: Array.isArray(row.target_year_levels) ? row.target_year_levels.map(String) : [],
    allYearLevels: Boolean(row.all_year_levels), attendanceEnabled: Boolean(row.attendance_enabled),
    createdAt: String(row.created_at ?? ""),
  };
}

export async function fetchFormationActivities(): Promise<FormationActivity[]> {
  const { data, error } = await supabase.from("formation_activities").select("*").order("date_time");
  if (error || !data) return [];
  return data.map(row => rowToActivity(row as Record<string, unknown>));
}

export async function createFormationActivity(input: NewFormationActivityInput): Promise<{ ok: boolean; error?: string; id?: string }> {
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase.from("formation_activities").insert({
    name: input.name, short_description: input.shortDescription, date_time: localDateTimeToIso(input.dateTime), end_time: localDateTimeToIso(input.endTime), venue: input.venue,
    target_year_levels: input.yearLevels, all_year_levels: input.allYearLevels, attendance_enabled: input.attendanceEnabled,
    created_by: auth.user?.id ?? null,
  }).select("id").single();
  return error || !data ? { ok: false, error: error?.message || "Couldn't create the activity." } : { ok: true, id: data.id };
}

export async function updateFormationActivity(id: string, input: NewFormationActivityInput): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("formation_activities").update({
    name: input.name, short_description: input.shortDescription, date_time: localDateTimeToIso(input.dateTime), end_time: localDateTimeToIso(input.endTime), venue: input.venue,
    target_year_levels: input.yearLevels, all_year_levels: input.allYearLevels, attendance_enabled: input.attendanceEnabled,
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function deleteFormationActivity(id: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("formation_activities").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Runs `.select(selectCols).in(column, ids)` in chunks — see the matching
 * helper (and its doc comment) in seadApi.ts and sdpMonitorApi.ts for why.
 */
async function fetchInChunks(
  table: string, selectCols: string, column: string, ids: string[], chunkSize = 150,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { data, error } = await supabase.from(table).select(selectCols).in(column, chunk);
    if (error || !data) continue;
    out.push(...(data as unknown as Record<string, unknown>[]));
  }
  return out;
}

const ATTENDANCE_CODE_PAGE_SIZE = 500;
const ROSTER_PAGE_SIZE_DEFAULT = 50;
const CODES_PAGE_SIZE_DEFAULT = 50;

/**
 * Enables attendance for a Formation activity, atomically creating the
 * session AND every QR code in one Postgres transaction via
 * create_formation_attendance_session_with_codes() (see
 * supabase_migration_formation_attendance_bulk_rpc.sql) — replaces what
 * used to be a client-side loop of up to 5,200 individual code inserts
 * with client-generated codes and no rollback on partial failure.
 */
export async function enableFormationAttendance(activityId: string, type: AttendanceType, participantCount: number, voucherHours = 1): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc("create_formation_attendance_session_with_codes", {
    p_activity_id: activityId, p_type: type, p_participant_count: participantCount,
    p_voucher_hours: type === "voucher" ? voucherHours : null,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Adds a new batch of codes to an already-enabled session, atomically, via
 * add_formation_attendance_codes(). Preserves the prior batch_number
 * (max+1) and expected_attendees (+participantCount, once regardless of
 * type) behavior — now enforced server-side instead of as two separate
 * client round-trips that could race or partially fail.
 */
export async function addFormationAttendanceCodes(sessionId: string, type: AttendanceType, participantCount: number): Promise<{ ok: boolean; error?: string }> {
  if (participantCount < 1) return { ok: false, error: "Enter a number greater than 0." };
  const { error } = await supabase.rpc("add_formation_attendance_codes", {
    p_session_id: sessionId, p_type: type, p_participant_count: participantCount,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Session + Present/Incomplete counts ONLY — no QR codes, no roster rows.
 * This is what opening Formation Attendance Monitoring (or clicking
 * Refresh) actually loads now; codes and roster are fetched separately,
 * paginated, only when actually needed (see the functions below).
 */
export async function fetchFormationAttendanceSummary(activityId: string): Promise<{ session: AttendanceSession; presentCount: number; incompleteCount: number } | null> {
  const { data: row } = await supabase.from("attendance_sessions").select("*").eq("formation_activity_id", activityId).maybeSingle();
  if (!row) return null;
  const { data: counts } = await supabase.rpc("attendance_session_counts", { p_session_id: row.id });
  const countsRow = Array.isArray(counts) ? counts[0] : counts;
  return {
    session: { id: row.id, type: row.type, expectedAttendees: row.expected_attendees, voucherHours: row.duration_hours, createdAt: row.created_at },
    presentCount: Number(countsRow?.present_count ?? 0),
    incompleteCount: Number(countsRow?.incomplete_count ?? 0),
  };
}

/** One server-paginated page of the roster (default 50/page), with a chunked scholar-name lookup and a total count for "Showing X-Y of Z". */
export async function fetchFormationAttendanceRosterPage(
  sessionId: string, page: number, pageSize: number = ROSTER_PAGE_SIZE_DEFAULT,
  statusFilter?: "present" | "incomplete",
): Promise<{ entries: AttendanceRosterEntry[]; totalCount: number }> {
  const from = (page - 1) * pageSize;
  let query = supabase.from("attendance_records").select("*", { count: "exact" }).eq("session_id", sessionId);
  if (statusFilter) query = query.eq("status", statusFilter);
  const { data: rows, count } = await query.order("updated_at", { ascending: false }).range(from, from + pageSize - 1);
  if (!rows || rows.length === 0) return { entries: [], totalCount: count ?? 0 };

  const scholarIds = [...new Set(rows.map(r => r.scholar_id_number))];
  const scholars = await fetchInChunks("scholars", "scholar_id_number, first_name, last_name", "scholar_id_number", scholarIds);
  const nameByScholarId = new Map(scholars.map((s: Record<string, unknown>) => [s.scholar_id_number, `${s.first_name} ${s.last_name}`]));

  const entries = rows.map(r => ({
    scholarIdNumber: r.scholar_id_number,
    scholarName: nameByScholarId.get(r.scholar_id_number) ?? r.scholar_id_number,
    timeInAt: r.time_in_at, timeOutAt: r.time_out_at,
    hoursEarned: Number(r.hours_earned ?? 0),
    status: r.status,
  }));
  return { entries, totalCount: count ?? entries.length };
}

export interface FormationCodeBatchSummary {
  batchNumber: number;
  kind: "time_in" | "time_out" | "voucher";
  total: number;
  claimed: number;
}

/** Per batch/kind totals and claimed counts, computed server-side (attendance_code_batch_summary RPC) — never downloads the codes themselves. Drives the Batch/Type pickers for QR viewing and the Download QR PDF menu. */
export async function fetchFormationAttendanceCodeBatchSummary(sessionId: string): Promise<FormationCodeBatchSummary[]> {
  const { data, error } = await supabase.rpc("attendance_code_batch_summary", { p_session_id: sessionId });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(r => ({
    batchNumber: Number(r.batch_number), kind: r.kind as FormationCodeBatchSummary["kind"],
    total: Number(r.total), claimed: Number(r.claimed),
  }));
}

/** One page of QR codes for a specific batch + kind (default 50/page) — what "View QR codes" actually renders, never all 5,200 at once. */
export async function fetchFormationAttendanceCodesPage(
  sessionId: string, batchNumber: number, kind: AttendanceCode["kind"], page: number, pageSize: number = CODES_PAGE_SIZE_DEFAULT,
): Promise<{ codes: AttendanceCode[]; totalCount: number }> {
  const from = (page - 1) * pageSize;
  const { data, count } = await supabase.from("attendance_codes").select("*", { count: "exact" })
    .eq("session_id", sessionId).eq("batch_number", batchNumber).eq("kind", kind)
    .order("created_at").order("id").range(from, from + pageSize - 1);
  const codes = (data ?? []).map(c => ({
    id: c.id, code: c.code, kind: c.kind, batchNumber: Number(c.batch_number ?? 1),
    redeemedByScholarId: c.redeemed_by_scholar_id, redeemedAt: c.redeemed_at,
  }));
  return { codes, totalCount: count ?? codes.length };
}

/**
 * ALL codes for exactly one requested scope - a single batch's one kind,
 * or every unclaimed code of one kind across the whole session - chunked
 * via .range() the same way the old fetchAllAttendanceCodeRows() was, but
 * scoped so a PDF/export for "Batch 3, Time-in" never touches Batch 1's
 * rows or Time-out codes. This is what Download QR PDF and Export CSV
 * call; it is NOT what powers the on-screen QR viewer (that's the
 * paginated function above).
 */
export async function fetchFormationAttendanceCodesForExport(
  sessionId: string, scope: { batchNumber: number } | { unclaimed: true }, kind: AttendanceCode["kind"],
): Promise<AttendanceCode[]> {
  const rows: AttendanceCode[] = [];
  for (let from = 0; ; from += ATTENDANCE_CODE_PAGE_SIZE) {
    let query = supabase.from("attendance_codes").select("*").eq("session_id", sessionId).eq("kind", kind);
    query = "unclaimed" in scope ? query.is("redeemed_by_scholar_id", null) : query.eq("batch_number", scope.batchNumber);
    const { data, error } = await query.order("batch_number").order("created_at").order("id").range(from, from + ATTENDANCE_CODE_PAGE_SIZE - 1);
    if (error || !data) break;
    rows.push(...data.map(c => ({
      id: c.id, code: c.code, kind: c.kind, batchNumber: Number(c.batch_number ?? 1),
      redeemedByScholarId: c.redeemed_by_scholar_id, redeemedAt: c.redeemed_at,
    })));
    if (data.length < ATTENDANCE_CODE_PAGE_SIZE) break;
  }
  return rows;
}
