import { supabase } from "@/lib/supabase";
import type { SDPActivity, SDPStatus, SDPCategory } from "@/scholar/sdpApi";

// Re-export so consumers of this module don't also need to import from
// src/scholar/sdpApi directly — same underlying `sdp_activities` table,
// just accessed here with staff (sdp_monitoring tag) RLS instead of
// scholar RLS.
export type { SDPActivity, SDPStatus, SDPCategory };

function rowToActivity(r: Record<string, unknown>): SDPActivity {
  return {
    id: String(r.id),
    name: String(r.name),
    submittedByScholarId: (r.submitted_by_scholar_id as string | null) ?? null,
    category: (r.category as SDPCategory | null) ?? null,
    nature: (r.nature as string[]) ?? [],
    organization: String(r.organization ?? ""),
    dateTime: (r.date_time as string | null) ?? "",
    venue: String(r.venue ?? ""),
    projectHead: String(r.project_head ?? ""),
    headCluster: String(r.head_cluster ?? ""),
    status: r.status as SDPStatus,
    budgetaryRequirement: String(r.budgetary_requirement ?? ""),
    sourceOfFund: (r.source_of_fund as string[]) ?? [],
    sourceOfFundOther: String(r.source_of_fund_other ?? ""),
    rationale: String(r.rationale ?? ""),
    linkWithOrg: String(r.link_with_org ?? ""),
    objectives: (r.objectives as SDPActivity["objectives"]) ?? [],
    targetPartners: (r.target_partners as string[]) ?? [],
    targetPartnersOther: String(r.target_partners_other ?? ""),
    specificRole: (r.specific_role as string[]) ?? [],
    workPlan: (r.work_plan as SDPActivity["workPlan"]) ?? [],
    programFlow: (r.program_flow as SDPActivity["programFlow"]) ?? [],
    budgetItems: (r.budget_items as SDPActivity["budgetItems"]) ?? [],
    createdAt: String(r.created_at ?? ""),
  };
}

/** Every SDP activity — staff-created and scholar-submitted alike. Requires the
 *  sdp_monitoring tag (enforced by RLS; this just returns [] otherwise). */
export async function fetchAllSDPActivities(): Promise<SDPActivity[]> {
  const { data, error } = await supabase.from("sdp_activities").select("*").order("created_at", { ascending: false });
  if (error || !data) return [];
  return data.map(rowToActivity);
}

export async function updateSDPActivity(
  id: string, fields: { status: SDPStatus; projectHead?: string; headCluster?: string; category?: SDPCategory | null }
): Promise<{ ok: boolean; error?: string }> {
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase.from("sdp_activities").update({
    status: fields.status,
    project_head: fields.projectHead,
    head_cluster: fields.headCluster,
    category: fields.category,
    reviewed_by: auth.user?.id ?? null,
    reviewed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Permanently removes an activity and its related attendance data. */
export async function deleteSDPActivity(id: string): Promise<{ ok: boolean; error?: string }> {
  const { error: attendanceError } = await supabase.from("sdp_attendance").delete().eq("activity_id", id);
  if (attendanceError) return { ok: false, error: attendanceError.message };
  const { error } = await supabase.from("sdp_activities").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export interface NewApprovedActivityInput {
  name: string;
  category: SDPCategory;
  organization: string;
  dateTime: string;
  venue: string;
  nature: string[];
}

function localDateTimeToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

/** Staff can create an activity directly (no scholar proposal), open to all — starts 'approved'. */
export async function createApprovedActivity(input: NewApprovedActivityInput): Promise<{ ok: boolean; error?: string; id?: string }> {
  const { data, error } = await supabase.from("sdp_activities").insert({
    name: input.name,
    submitted_by_scholar_id: null,
    category: input.category,
    organization: input.organization,
    date_time: localDateTimeToIso(input.dateTime),
    venue: input.venue,
    nature: input.nature,
    status: "approved",
  }).select("id").single();
  return error ? { ok: false, error: error.message } : { ok: true, id: data.id };
}

// ── SDP checklist monitoring ─────────────────────────────────

export interface AttendanceEntry {
  id: string;
  scholarIdNumber: string;
  scholarName: string;
  attendedDate: string;
}

/** Everyone currently credited for one activity — shown in that activity's detail modal. */
export async function fetchAttendanceForActivity(activityId: string): Promise<AttendanceEntry[]> {
  const { data: rows, error } = await supabase.from("sdp_attendance")
    .select("id, scholar_id_number, attended_date").eq("activity_id", activityId).order("attended_date", { ascending: false });
  if (error || !rows || rows.length === 0) return [];

  const scholarIds = [...new Set(rows.map(r => r.scholar_id_number))];
  const { data: scholars } = await supabase.from("scholars").select("scholar_id_number, first_name, last_name").in("scholar_id_number", scholarIds);
  const nameByScholarId = new Map((scholars ?? []).map(s => [s.scholar_id_number, `${s.first_name} ${s.last_name}`]));

  return rows.map(r => ({
    id: r.id, scholarIdNumber: r.scholar_id_number,
    scholarName: nameByScholarId.get(r.scholar_id_number) ?? r.scholar_id_number,
    attendedDate: r.attended_date,
  }));
}

/** Credits one scholar as having completed this activity — this is what marks its category
 *  complete for them (see scholar_sdp_category_status). Points are no longer part of this. */
export async function creditAttendance(
  activityId: string, scholarIdNumber: string, attendedDate: string
): Promise<{ ok: boolean; error?: string }> {
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase.from("sdp_attendance")
    .upsert(
      { activity_id: activityId, scholar_id_number: scholarIdNumber, attended_date: attendedDate, created_by: auth.user?.id ?? null },
      { onConflict: "activity_id,scholar_id_number" }
    );
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function removeAttendance(attendanceId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("sdp_attendance").delete().eq("id", attendanceId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export interface ScholarSDPChecklist {
  scholarIdNumber: string;
  name: string;
  communityService: boolean;
  communityVolunteerism: boolean;
  formationProgram: boolean;
}

/** One row per scholar with an account, showing their 3-category checklist completion. */
export async function fetchAllScholarsSDPChecklist(): Promise<ScholarSDPChecklist[]> {
  // PostgREST caps a single response (commonly at 1,000 rows). Fetch every
  // page so the checklist remains complete as the scholar population grows.
  async function fetchAllScholarRows() {
    const pageSize = 1000;
    const rows: { scholar_id_number: string; first_name: string; last_name: string }[] = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase.from("scholars")
        .select("scholar_id_number, first_name, last_name")
        .order("last_name").order("first_name")
        .range(from, from + pageSize - 1);
      if (error || !data) return null;
      rows.push(...data);
      if (data.length < pageSize) return rows;
    }
  }

  const [scholars, statusResult] = await Promise.all([
    fetchAllScholarRows(),
    supabase.from("scholar_sdp_category_status").select("scholar_id_number, category, completed").eq("completed", true),
  ]);
  const statusRows = statusResult.data;
  if (!scholars) return [];

  const completedByScholarId = new Map<string, Set<SDPCategory>>();
  for (const row of statusRows ?? []) {
    const set = completedByScholarId.get(row.scholar_id_number) ?? new Set<SDPCategory>();
    set.add(row.category as SDPCategory);
    completedByScholarId.set(row.scholar_id_number, set);
  }

  return scholars.map(s => {
    const completed = completedByScholarId.get(s.scholar_id_number) ?? new Set<SDPCategory>();
    return {
      scholarIdNumber: s.scholar_id_number,
      name: `${s.first_name} ${s.last_name}`,
      communityService: completed.has("community_service"),
      communityVolunteerism: completed.has("community_volunteerism"),
      formationProgram: completed.has("formation_program"),
    };
  });
}

export interface SDPHistoryRow {
  activityId: string;
  activityName: string;
  category: SDPCategory | null;
  date: string; // "" if unset
}

/** Attended (credited) vs. Available (approved/ongoing, not yet attended) activities for one scholar. */
export async function fetchScholarSDPHistory(scholarIdNumber: string): Promise<{ attended: SDPHistoryRow[]; available: SDPHistoryRow[] }> {
  const [{ data: attendanceRows }, { data: openActivities }] = await Promise.all([
    supabase.from("sdp_attendance").select("activity_id, attended_date, sdp_activities(name, category)").eq("scholar_id_number", scholarIdNumber),
    supabase.from("sdp_activities").select("id, name, category, date_time").in("status", ["approved", "ongoing"]),
  ]);

  const attended: SDPHistoryRow[] = (attendanceRows ?? []).map((r: Record<string, unknown>) => {
    const act = r.sdp_activities as { name?: string; category?: SDPCategory } | null;
    return {
      activityId: String(r.activity_id),
      activityName: String(act?.name ?? "—"),
      category: act?.category ?? null,
      date: String(r.attended_date ?? ""),
    };
  });

  const attendedActivityIds = new Set(attended.map(a => a.activityId));
  const available: SDPHistoryRow[] = (openActivities ?? [])
    .filter(a => !attendedActivityIds.has(a.id))
    .map(a => ({ activityId: a.id, activityName: a.name, category: (a.category as SDPCategory | null) ?? null, date: a.date_time ?? "" }));

  return { attended, available };
}

// ── QR / code attendance monitoring ──────────────────────────
// See supabase_migration_attendance_system.sql. Separate from the
// manual "credit a scholar" flow above — this is the self-service
// scan/enter-code system.

export type AttendanceType = "time_in_time_out" | "voucher";

export interface AttendanceSession {
  id: string;
  type: AttendanceType;
  expectedAttendees: number | null;
  voucherHours: number | null;
  createdAt: string;
}

export interface AttendanceCode {
  id: string;
  code: string;
  kind: "time_in" | "time_out" | "voucher";
  batchNumber: number;
  redeemedByScholarId: string | null;
  redeemedAt: string | null;
}

function randomCode(): string {
  // Excludes ambiguous characters (0/O, 1/I/L) so codes are easy to read/type by hand.
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 7; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

type AttendanceCodeInsert = { session_id: string; code: string; kind: string; batch_number: number };
type AttendanceCodeRow = { id: string; code: string; kind: "time_in" | "time_out" | "voucher"; batch_number: number | null; redeemed_by_scholar_id: string | null; redeemed_at: string | null };
const ATTENDANCE_CODE_PAGE_SIZE = 500;

/** Supabase limits a single REST response, so read every code page before rendering/exporting QR batches. */
async function fetchAllAttendanceCodeRows(sessionId: string): Promise<AttendanceCodeRow[] | null> {
  const rows: AttendanceCodeRow[] = [];
  for (let from = 0; ; from += ATTENDANCE_CODE_PAGE_SIZE) {
    const { data, error } = await supabase.from("attendance_codes").select("*").eq("session_id", sessionId)
      .order("batch_number").order("kind").order("created_at").order("id")
      .range(from, from + ATTENDANCE_CODE_PAGE_SIZE - 1);
    if (error || !data) return null;
    rows.push(...(data as AttendanceCodeRow[]));
    if (data.length < ATTENDANCE_CODE_PAGE_SIZE) return rows;
  }
}

/** Insert in small requests so sessions with thousands of QR codes do not exceed REST request limits. */
async function insertAttendanceCodes(codes: AttendanceCodeInsert[]): Promise<string | null> {
  for (let from = 0; from < codes.length; from += ATTENDANCE_CODE_PAGE_SIZE) {
    const { error } = await supabase.from("attendance_codes").insert(codes.slice(from, from + ATTENDANCE_CODE_PAGE_SIZE));
    if (error) return error.message;
  }
  return null;
}

/** The attendance session for one SDP activity, if attendance monitoring was enabled for it. */
export async function fetchAttendanceSession(activityId: string): Promise<{ session: AttendanceSession; codes: AttendanceCode[] } | null> {
  const { data: sessionRow } = await supabase.from("attendance_sessions").select("*").eq("sdp_activity_id", activityId).maybeSingle();
  if (!sessionRow) return null;
  const codeRows = await fetchAllAttendanceCodeRows(sessionRow.id);
  return {
    session: {
      id: sessionRow.id, type: sessionRow.type,
      expectedAttendees: sessionRow.expected_attendees, voucherHours: sessionRow.duration_hours,
      createdAt: sessionRow.created_at,
    },
    codes: (codeRows ?? []).map(c => ({
      id: c.id, code: c.code, kind: c.kind,
      batchNumber: Number(c.batch_number ?? 1), redeemedByScholarId: c.redeemed_by_scholar_id, redeemedAt: c.redeemed_at,
    })),
  };
}

/**
 * Turns on attendance monitoring for an SDP activity and generates the
 * full batch of codes upfront (per the department's confirmed model —
 * codes are pre-generated tickets, not rotated live).
 *   - time_in_time_out: `count` = expected attendees → generates
 *     `count` time_in codes AND `count` time_out codes (2×count total).
 *   - voucher: `count` = duration in hours → generates `count` codes,
 *     each worth 1 hour.
 */
export async function enableAttendanceForActivity(
  activityId: string, type: AttendanceType, participantCount: number, voucherHours = 1
): Promise<{ ok: boolean; error?: string; sessionId?: string }> {
  if (participantCount < 1) return { ok: false, error: "Enter a number greater than 0." };
  if (type === "voucher" && ![1, 2, 4, 8].includes(voucherHours)) return { ok: false, error: "Choose a valid voucher hour equivalent." };

  const { data: auth } = await supabase.auth.getUser();
  const { data: session, error: sessionError } = await supabase.from("attendance_sessions").insert({
    sdp_activity_id: activityId,
    type,
    expected_attendees: participantCount,
    duration_hours: type === "voucher" ? voucherHours : null,
    created_by: auth.user?.id ?? null,
  }).select("id").single();
  if (sessionError || !session) return { ok: false, error: sessionError?.message || "Failed to create attendance session." };

  const codes: AttendanceCodeInsert[] = [];
  if (type === "time_in_time_out") {
    for (let i = 0; i < participantCount; i++) codes.push({ session_id: session.id, code: randomCode(), kind: "time_in", batch_number: 1 });
    for (let i = 0; i < participantCount; i++) codes.push({ session_id: session.id, code: randomCode(), kind: "time_out", batch_number: 1 });
  } else {
    for (let i = 0; i < participantCount; i++) codes.push({ session_id: session.id, code: randomCode(), kind: "voucher", batch_number: 1 });
  }

  const codesError = await insertAttendanceCodes(codes);
  if (codesError) return { ok: false, error: codesError, sessionId: session.id };
  return { ok: true, sessionId: session.id };
}

/** Generates additional single-use voucher codes when attendance exceeds the original estimate. */
export async function addAttendanceVouchers(sessionId: string, participantCount: number): Promise<{ ok: boolean; error?: string }> {
  if (participantCount < 1) return { ok: false, error: "Enter a number greater than 0." };
  const { data: latestBatch } = await supabase.from("attendance_codes").select("batch_number").eq("session_id", sessionId).order("batch_number", { ascending: false }).limit(1).maybeSingle();
  const batchNumber = Number(latestBatch?.batch_number ?? 0) + 1;
  const codes = Array.from({ length: participantCount }, () => ({ session_id: sessionId, code: randomCode(), kind: "voucher", batch_number: batchNumber }));
  const error = await insertAttendanceCodes(codes);
  if (error) return { ok: false, error };
  const { data: session, error: sessionError } = await supabase.from("attendance_sessions")
    .select("expected_attendees").eq("id", sessionId).single();
  if (sessionError) return { ok: false, error: sessionError.message };
  const { error: updateError } = await supabase.from("attendance_sessions")
    .update({ expected_attendees: Number(session.expected_attendees ?? 0) + participantCount }).eq("id", sessionId);
  return updateError ? { ok: false, error: updateError.message } : { ok: true };
}

export interface AttendanceRosterEntry {
  scholarIdNumber: string;
  scholarName: string;
  timeInAt: string | null;
  timeOutAt: string | null;
  hoursEarned: number;
  status: "incomplete" | "present";
}

/** Live roster of who's redeemed codes for a session — auto-maintained by a DB trigger. */
export async function fetchAttendanceRoster(sessionId: string): Promise<AttendanceRosterEntry[]> {
  const { data: rows } = await supabase.from("attendance_records").select("*").eq("session_id", sessionId).order("updated_at", { ascending: false });
  if (!rows || rows.length === 0) return [];

  const scholarIds = [...new Set(rows.map(r => r.scholar_id_number))];
  const { data: scholars } = await supabase.from("scholars").select("scholar_id_number, first_name, last_name").in("scholar_id_number", scholarIds);
  const nameByScholarId = new Map((scholars ?? []).map(s => [s.scholar_id_number, `${s.first_name} ${s.last_name}`]));

  return rows.map(r => ({
    scholarIdNumber: r.scholar_id_number,
    scholarName: nameByScholarId.get(r.scholar_id_number) ?? r.scholar_id_number,
    timeInAt: r.time_in_at, timeOutAt: r.time_out_at,
    hoursEarned: Number(r.hours_earned ?? 0),
    status: r.status,
  }));
}
