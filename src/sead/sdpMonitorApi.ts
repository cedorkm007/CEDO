import { supabase } from "@/lib/supabase";
import type { SDPActivity, SDPCategory, SDPActivityType, RecurringOccurrence } from "@/scholar/sdpApi";

// Re-export so consumers of this module don't also need to import from
// src/scholar/sdpApi directly — same underlying `sdp_activities` table,
// just accessed here with staff (sdp_monitoring tag) RLS instead of
// scholar RLS.
export type { SDPActivity, SDPCategory, SDPActivityType, RecurringOccurrence };

function rowToActivity(r: Record<string, unknown>): SDPActivity {
  return {
    id: String(r.id),
    name: String(r.name),
    submittedByScholarId: (r.submitted_by_scholar_id as string | null) ?? null,
    category: (r.category as SDPCategory | null) ?? null,
    nature: (r.nature as string[]) ?? [],
    organization: String(r.organization ?? ""),
    dateTime: (r.date_time as string | null) ?? "",
    endTime: (r.end_time as string | null) ?? "",
    venue: String(r.venue ?? ""),
    projectHead: String(r.project_head ?? ""),
    headCluster: String(r.head_cluster ?? ""),
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
    pubmatPath: (r.pubmat_path as string | null) ?? null,
    activityType: (r.activity_type as SDPActivityType | null) ?? "one_time",
    recurringDates: (r.recurring_dates as RecurringOccurrence[] | null) ?? [],
    credits: Number(r.credits ?? 1),
    yearLevels: (r.target_year_levels as string[]) ?? [],
    allYearLevels: Boolean(r.all_year_levels),
    targetBarangays: (r.target_barangays as string[] | null) ?? [],
    targetClusters: (r.target_clusters as string[] | null) ?? [],
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
  id: string, fields: {
    projectHead?: string; headCluster?: string; category?: SDPCategory | null; recurringDates?: RecurringOccurrence[]; credits?: number;
    name?: string; organization?: string; venue?: string; dateTime?: string | null; endTime?: string | null;
    yearLevels?: string[]; allYearLevels?: boolean;
    /** Only sent when provided -- callers pass these only if the restriction actually changed. */
    targetBarangays?: string[]; targetClusters?: string[];
  }
): Promise<{ ok: boolean; error?: string }> {
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase.from("sdp_activities").update({
    project_head: fields.projectHead,
    head_cluster: fields.headCluster,
    category: fields.category,
    ...(fields.recurringDates ? { recurring_dates: fields.recurringDates } : {}),
    ...(fields.credits !== undefined ? { credits: fields.credits } : {}),
    ...(fields.name !== undefined ? { name: fields.name } : {}),
    ...(fields.organization !== undefined ? { organization: fields.organization } : {}),
    ...(fields.venue !== undefined ? { venue: fields.venue } : {}),
    ...(fields.dateTime !== undefined ? { date_time: fields.dateTime } : {}),
    ...(fields.endTime !== undefined ? { end_time: fields.endTime } : {}),
    ...(fields.yearLevels !== undefined ? { target_year_levels: fields.yearLevels } : {}),
    ...(fields.allYearLevels !== undefined ? { all_year_levels: fields.allYearLevels } : {}),
    ...(fields.targetBarangays !== undefined ? { target_barangays: fields.targetBarangays } : {}),
    ...(fields.targetClusters !== undefined ? { target_clusters: fields.targetClusters } : {}),
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
  endTime: string;
  venue: string;
  nature: string[];
  activityType: SDPActivityType;
  credits: number;
  yearLevels: string[];
  allYearLevels: boolean;
  /** Empty (both) = visible to every barangay; see supabase_migration_sdp_barangay_cluster_visibility.sql. */
  targetBarangays: string[];
  targetClusters: string[];
}

function localDateTimeToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

/** Staff can create an activity directly — open to every scholar immediately, no review/approval step. */
export async function createApprovedActivity(input: NewApprovedActivityInput): Promise<{ ok: boolean; error?: string; id?: string }> {
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase.from("sdp_activities").insert({
    name: input.name,
    submitted_by_scholar_id: null,
    category: input.category,
    organization: input.organization,
    date_time: localDateTimeToIso(input.dateTime),
    end_time: localDateTimeToIso(input.endTime),
    venue: input.venue,
    nature: input.nature,
    activity_type: input.activityType,
    credits: input.credits,
    target_year_levels: input.yearLevels,
    all_year_levels: input.allYearLevels,
    // Omitted when unrestricted so creating an ordinary activity doesn't
    // depend on the barangay/cluster columns existing yet.
    ...(input.targetBarangays.length > 0 ? { target_barangays: input.targetBarangays } : {}),
    ...(input.targetClusters.length > 0 ? { target_clusters: input.targetClusters } : {}),
    created_by: auth.user?.id ?? null,
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

export interface AttendedWithoutCredit { scholarIdNumber: string; scholarName: string; reason: string; /** present, and the activity has a category, so "Credit these scholars" can credit them */ canCredit: boolean }

/**
 * Scholars who scanned this activity's QR codes but have NO credit row for it, with the reason: they are waiting for the survey, they had already
 * completed the category (the credit is saved for a later semester instead of being counted again), the activity has no SDP category, or the credit
 * is simply missing. The "Credited Scholars" list only shows credit rows, so without this these scholars looked as if their scan did not count.
 */
export async function fetchAttendedWithoutCredit(activityId: string, category: SDPCategory | null, credited: AttendanceEntry[]): Promise<AttendedWithoutCredit[]> {
  const { data: session } = await supabase.from("attendance_sessions").select("id").eq("sdp_activity_id", activityId).maybeSingle();
  if (!session) return [];
  const records: { scholar_id_number: string; status: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("attendance_records").select("scholar_id_number, status")
      .eq("session_id", session.id).in("status", ["present", "pending_survey"]).order("scholar_id_number").range(from, from + 999);
    if (error || !data) break;
    records.push(...(data as { scholar_id_number: string; status: string }[]));
    if (data.length < 1000) break;
  }
  const creditedIds = new Set(credited.map(c => c.scholarIdNumber));
  const missing = records.filter(r => !creditedIds.has(r.scholar_id_number));
  if (missing.length === 0) return [];

  const ids = missing.map(m => m.scholar_id_number);
  const scholars = await fetchInChunks("scholars", "scholar_id_number, first_name, last_name", "scholar_id_number", ids);
  const nameById = new Map(scholars.map(s => [String(s.scholar_id_number), `${s.first_name} ${s.last_name}`]));
  const banked = new Set<string>();
  if (category) {
    const reserved = await fetchInChunks("sdp_reserved_credits", "scholar_id_number", "scholar_id_number", ids);
    for (const r of reserved) banked.add(String(r.scholar_id_number));
  }
  return missing.map(m => ({
    scholarIdNumber: m.scholar_id_number,
    scholarName: nameById.get(m.scholar_id_number) ?? m.scholar_id_number,
    canCredit: m.status === "present" && !!category,
    reason: m.status === "pending_survey" ? "Waiting for the scholar to answer the survey; the credit is added once it is answered."
      : !category ? "This activity has no SDP category, so it gives no credit."
      : banked.has(m.scholar_id_number) ? "Had already completed this category, so the credit is saved for a later semester."
      : "Attended, but no credit was recorded (for example, the category was chosen after they scanned). Use “Credit these scholars” to add it.",
  })).sort((a, b) => a.scholarName.localeCompare(b.scholarName));
}

/**
 * Credits every scholar who attended (is present) but has no credit for this activity: one credit per finished day, in the current grading period.
 * Needs the activity to have an SDP category. Returns how many scholars were credited.
 */
export async function creditAttendedScholars(activityId: string): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("credit_attended_scholars", { p_activity_id: activityId });
  if (error) {
    const missing = error.code === "PGRST202" || /could not find the function|does not exist/i.test(error.message ?? "");
    return { ok: false, error: missing ? "This needs the latest database update (credit attended scholars). Please ask the IT admin to run it." : error.message };
  }
  return { ok: true, count: Number(data ?? 0) };
}

/** Credits one scholar as having completed this activity — this is what marks its category
 *  complete for them (see scholar_sdp_category_status). Points are no longer part of this. */
export async function creditAttendance(
  activityId: string, scholarIdNumber: string, attendedDate: string
): Promise<{ ok: boolean; error?: string }> {
  const { data: auth } = await supabase.auth.getUser();
  // Stamped with the current grading period (supabase_migration_sdp_reserved_credits.sql)
  // so this manual credit counts toward period-scoped totals — this path bypasses the
  // cap/reserved-credit banking in redeem_attendance_code() intentionally, same as before.
  const { data: period } = await supabase.rpc("get_current_grading_period").maybeSingle();
  const periodRow = period as { current_school_year: string | null; current_semester: string | null } | null;
  const { error } = await supabase.from("sdp_attendance")
    .upsert(
      {
        activity_id: activityId, scholar_id_number: scholarIdNumber, attended_date: attendedDate, created_by: auth.user?.id ?? null,
        school_year: periodRow?.current_school_year ?? null, semester: periodRow?.current_semester ?? null,
      },
      { onConflict: "activity_id,scholar_id_number,occurrence_number" }
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
  communityService: number;
  communityVolunteerism: number;
  formationProgram: number;
  communityServiceReserved: number;
  communityVolunteerismReserved: number;
  formationProgramReserved: number;
}

/**
 * One row per scholar with an account, showing their 3-category
 * checklist completion. Computed in Postgres via scholars_sdp_checklist()
 * (a single grouped LEFT JOIN) rather than paginating through every
 * scholar row client-side (7+ sequential round trips at this project's
 * scholar count) plus a separate full status-table fetch joined in
 * JavaScript — this was the slowest list found investigating "lists load
 * very slowly" on the admin side.
 */
const SDP_CHECKLIST_PAGE_SIZE = 1000;

export interface ScholarSdpCompliance {
  scholarIdNumber: string;
  name: string;
  communityService: number;
  communityVolunteerism: number;
  formationProgram: number;
  /** False for Summer: there is no SDP requirement, so there is no result. */
  applicable: boolean;
  /** true / false for 1st and 2nd Semester; null when not applicable. */
  complied: boolean | null;
  /** What is missing, e.g. "Formation Program: 2 of 3"; empty when complied. For Summer: "Not required for Summer". */
  missing: string;
}

/**
 * Every scholar's SDP credits AND whether they complied in ONE semester (scholars_sdp_compliance,
 * supabase_migration_renewal_p1_foundations.sql): complied = at least 3 credits in each of the three categories, counting credit carried
 * over from earlier semesters. Read in pages because PostgREST caps one response at 1,000 rows.
 */
export async function fetchScholarsSdpCompliance(period: { schoolYear: string; semester: string }): Promise<{ ok: true; rows: ScholarSdpCompliance[] } | { ok: false; error: string }> {
  const PAGE = 1000;
  const rows: ScholarSdpCompliance[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.rpc("scholars_sdp_compliance", { p_school_year: period.schoolYear, p_semester: period.semester }).range(from, from + PAGE - 1);
    if (error) return { ok: false, error: error.message };
    const page = (data ?? []) as Record<string, unknown>[];
    rows.push(...page.map(r => ({
      scholarIdNumber: String(r.scholar_id_number), name: String(r.name ?? ""),
      communityService: Number(r.community_service ?? 0), communityVolunteerism: Number(r.community_volunteerism ?? 0), formationProgram: Number(r.formation_program ?? 0),
      applicable: r.applicable !== false, complied: r.complied == null ? null : !!r.complied, missing: String(r.missing ?? ""),
    })));
    if (page.length < PAGE) break;
  }
  return { ok: true, rows };
}

/** Paginated via .range() because scholars_sdp_checklist() returns one row per scholar — PostgREST caps any single response (RPCs included) at 1000 rows, well under this project's scholar count. */
export async function fetchAllScholarsSDPChecklist(): Promise<ScholarSDPChecklist[]> {
  const out: ScholarSDPChecklist[] = [];
  for (let from = 0; ; from += SDP_CHECKLIST_PAGE_SIZE) {
    const { data, error } = await supabase.rpc("scholars_sdp_checklist").range(from, from + SDP_CHECKLIST_PAGE_SIZE - 1);
    if (error || !data) break;
    out.push(...(data as {
      scholar_id_number: string; name: string;
      community_service: number; community_volunteerism: number; formation_program: number;
      community_service_reserved: number; community_volunteerism_reserved: number; formation_program_reserved: number;
    }[]).map(r => ({
      scholarIdNumber: r.scholar_id_number,
      name: r.name,
      communityService: Number(r.community_service),
      communityVolunteerism: Number(r.community_volunteerism),
      formationProgram: Number(r.formation_program),
      communityServiceReserved: Number(r.community_service_reserved),
      communityVolunteerismReserved: Number(r.community_volunteerism_reserved),
      formationProgramReserved: Number(r.formation_program_reserved),
    })));
    if (data.length < SDP_CHECKLIST_PAGE_SIZE) break;
  }
  return out;
}

export interface SDPHistoryRow {
  activityId: string;
  activityName: string;
  category: SDPCategory | null;
  date: string; // "" if unset
}

/** Attended (credited) vs. Available (not yet attended) activities for one scholar. */
export async function fetchScholarSDPHistory(scholarIdNumber: string): Promise<{ attended: SDPHistoryRow[]; available: SDPHistoryRow[] }> {
  const [{ data: attendanceRows }, { data: openActivities }] = await Promise.all([
    supabase.from("sdp_attendance").select("activity_id, attended_date, sdp_activities(name, category)").eq("scholar_id_number", scholarIdNumber),
    supabase.from("sdp_activities").select("id, name, category, date_time"),
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

/**
 * Generates additional single-use codes when attendance exceeds the original estimate, or when a recurring activity needs a fresh code for each
 * day: vouchers for a Voucher session, and one time-in plus one time-out code per person for a Time-in / Time-out session.
 */
export async function addAttendanceVouchers(sessionId: string, participantCount: number): Promise<{ ok: boolean; error?: string }> {
  if (participantCount < 1) return { ok: false, error: "Enter a number greater than 0." };
  const { data: sessionInfo } = await supabase.from("attendance_sessions").select("type").eq("id", sessionId).maybeSingle();
  const { data: latestBatch } = await supabase.from("attendance_codes").select("batch_number").eq("session_id", sessionId).order("batch_number", { ascending: false }).limit(1).maybeSingle();
  const batchNumber = Number(latestBatch?.batch_number ?? 0) + 1;
  const kinds = sessionInfo?.type === "time_in_time_out" ? ["time_in", "time_out"] : ["voucher"];
  const codes = kinds.flatMap(kind => Array.from({ length: participantCount }, () => ({ session_id: sessionId, code: randomCode(), kind, batch_number: batchNumber })));
  const error = await insertAttendanceCodes(codes);
  if (error) return { ok: false, error };
  const { data: session, error: sessionError } = await supabase.from("attendance_sessions")
    .select("expected_attendees").eq("id", sessionId).single();
  if (sessionError) return { ok: false, error: sessionError.message };
  const { error: updateError } = await supabase.from("attendance_sessions")
    .update({ expected_attendees: Number(session.expected_attendees ?? 0) + participantCount }).eq("id", sessionId);
  return updateError ? { ok: false, error: updateError.message } : { ok: true };
}

/**
 * Runs `.select(selectCols).in(column, ids)` in chunks instead of one call
 * with every id — an unchunked .in() with a large id list risks a
 * URL-length failure well before Supabase's 1000-row response cap would
 * matter, since the id count here tracks DISTINCT scholars, not row
 * count. Same fix, same reasoning, as seadApi.ts's fetchInChunks() —
 * duplicated locally rather than shared across modules since sead/ and
 * scholar/ config intentionally don't import from each other here.
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

export interface AttendanceRosterEntry {
  scholarIdNumber: string;
  scholarName: string;
  timeInAt: string | null;
  timeOutAt: string | null;
  hoursEarned: number;
  status: "incomplete" | "present" | "pending_survey";
  /** Time-in / Time-out: how many complete pairs (days) the scholar has. A recurring activity can have several. */
  completedDays?: number;
}

/** Live roster of who's redeemed codes for a session — auto-maintained by a DB trigger. */
export async function fetchAttendanceRoster(sessionId: string): Promise<AttendanceRosterEntry[]> {
  const { data: rows } = await supabase.from("attendance_records").select("*").eq("session_id", sessionId).order("updated_at", { ascending: false });
  if (!rows || rows.length === 0) return [];

  const scholarIds = [...new Set(rows.map(r => r.scholar_id_number))];
  const scholars = await fetchInChunks("scholars", "scholar_id_number, first_name, last_name", "scholar_id_number", scholarIds);
  const nameByScholarId = new Map(scholars.map((s: Record<string, unknown>) => [s.scholar_id_number, `${s.first_name} ${s.last_name}`]));

  return rows.map(r => ({
    scholarIdNumber: r.scholar_id_number,
    scholarName: nameByScholarId.get(r.scholar_id_number) ?? r.scholar_id_number,
    timeInAt: r.time_in_at, timeOutAt: r.time_out_at,
    hoursEarned: Number(r.hours_earned ?? 0),
    status: r.status,
    completedDays: Math.min(Number(r.time_in_count ?? (r.time_in_at ? 1 : 0)), Number(r.time_out_count ?? (r.time_out_at ? 1 : 0))),
  }));
}
