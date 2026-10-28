import { supabase } from "@/lib/supabase";
import { creditDay, dayLabel, type SDPActivity, type SDPCategory, type SDPSubCategory, type SDPActivityType, type RecurringOccurrence } from "@/scholar/sdpApi";

// Re-export so consumers of this module don't also need to import from
// src/scholar/sdpApi directly — same underlying `sdp_activities` table,
// just accessed here with staff (sdp_monitoring tag) RLS instead of
// scholar RLS.
export type { SDPActivity, SDPCategory, SDPSubCategory, SDPActivityType, RecurringOccurrence };

/**
 * Whether the database has the sub_category column yet (supabase_migration_sdp_update_p3_subcategory.sql). Until it is installed the sub-category
 * choices are hidden and nothing about it is sent, so the rest of the page keeps working exactly as before.
 */
let subCategoryColumnPresent = true;
export function isSubCategorySupported(): boolean { return subCategoryColumnPresent; }
const mentionsSubCategory = (message: string | undefined) => /sub_category/i.test(message ?? "");

/**
 * Whether the database has the columns for the sub-names of the days and the day of a code (supabase_migration_sdp_update_p4_day_labels.sql).
 * Until then the sub-name fields and the "codes for which day" choice are hidden and nothing about them is sent.
 */
let dayColumnsPresent = true;
export function isDayLabelsSupported(): boolean { return dayColumnsPresent; }
const mentionsDayColumn = (message: string | undefined) => /sub_name|day_date|activity_day/i.test(message ?? "");

function rowToActivity(r: Record<string, unknown>): SDPActivity {
  return {
    id: String(r.id),
    name: String(r.name),
    submittedByScholarId: (r.submitted_by_scholar_id as string | null) ?? null,
    category: (r.category as SDPCategory | null) ?? null,
    subCategory: (r.sub_category as SDPSubCategory | null) ?? null,
    subName: String(r.sub_name ?? ""),
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
  if (data.length > 0) { subCategoryColumnPresent = "sub_category" in data[0]; dayColumnsPresent = "sub_name" in data[0]; }
  return data.map(rowToActivity);
}

export async function updateSDPActivity(
  id: string, fields: {
    projectHead?: string; headCluster?: string; category?: SDPCategory | null; subCategory?: SDPSubCategory | null; subName?: string; recurringDates?: RecurringOccurrence[]; credits?: number;
    name?: string; organization?: string; venue?: string; dateTime?: string | null; endTime?: string | null;
    yearLevels?: string[]; allYearLevels?: boolean;
    /** Only sent when provided -- callers pass these only if the restriction actually changed. */
    targetBarangays?: string[]; targetClusters?: string[];
  }
): Promise<{ ok: boolean; error?: string }> {
  const { data: auth } = await supabase.auth.getUser();
  const payload: Record<string, unknown> = {
    project_head: fields.projectHead,
    head_cluster: fields.headCluster,
    category: fields.category,
    ...(fields.subCategory !== undefined && subCategoryColumnPresent ? { sub_category: fields.subCategory } : {}),
    ...(fields.subName !== undefined && dayColumnsPresent ? { sub_name: fields.subName.trim() || null } : {}),
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
  };
  let { error } = await supabase.from("sdp_activities").update(payload).eq("id", id);
  if (error && "sub_category" in payload && mentionsSubCategory(error.message)) {
    // The database update for sub-categories has not been run yet: save everything else as before.
    subCategoryColumnPresent = false;
    delete payload.sub_category;
    ({ error } = await supabase.from("sdp_activities").update(payload).eq("id", id));
  }
  if (error && "sub_name" in payload && mentionsDayColumn(error.message)) {
    dayColumnsPresent = false;
    delete payload.sub_name;
    ({ error } = await supabase.from("sdp_activities").update(payload).eq("id", id));
  }
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
  /** Required by the screen whenever the database supports it; optional here so the page also works before the database update. */
  subCategory?: SDPSubCategory | null;
  /** The sub-name of the first day of a recurring activity (optional). */
  subName?: string;
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
  const row: Record<string, unknown> = {
    name: input.name,
    submitted_by_scholar_id: null,
    category: input.category,
    ...(input.subCategory && subCategoryColumnPresent ? { sub_category: input.subCategory } : {}),
    ...(input.subName?.trim() && dayColumnsPresent ? { sub_name: input.subName.trim() } : {}),
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
  };
  let { data, error } = await supabase.from("sdp_activities").insert(row).select("id").single();
  if (error && "sub_category" in row && mentionsSubCategory(error.message)) {
    subCategoryColumnPresent = false;
    delete row.sub_category;
    ({ data, error } = await supabase.from("sdp_activities").insert(row).select("id").single());
  }
  if (error && "sub_name" in row && mentionsDayColumn(error.message)) {
    dayColumnsPresent = false;
    delete row.sub_name;
    ({ data, error } = await supabase.from("sdp_activities").insert(row).select("id").single());
  }
  return error || !data ? { ok: false, error: error?.message ?? "Failed to create." } : { ok: true, id: data.id };
}

// ── SDP checklist monitoring ─────────────────────────────────

export interface AttendanceEntry {
  id: string;
  scholarIdNumber: string;
  scholarName: string;
  attendedDate: string;
  /** The day of the activity this credit is for ("2026-10-21"), or null when it is not tied to a day. */
  activityDay: string | null;
  /** The school year and semester this credit counts in (null on very old credits that were never stamped). */
  schoolYear: string | null;
  semester: string | null;
}

/** Everyone currently credited for one activity — shown in that activity's detail modal. */
export async function fetchAttendanceForActivity(activityId: string): Promise<AttendanceEntry[]> {
  // With the day of each credit when the database has it (supabase_migration_sdp_update_p4_day_labels.sql); without it exactly as before.
  const select = (cols: string) => supabase.from("sdp_attendance").select(cols).eq("activity_id", activityId).order("attended_date", { ascending: false }) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown }>;
  let { data: rawRows, error } = await select("id, scholar_id_number, attended_date, activity_day, school_year, semester");
  if (error) ({ data: rawRows, error } = await select("id, scholar_id_number, attended_date, school_year, semester"));
  if (error) ({ data: rawRows, error } = await select("id, scholar_id_number, attended_date"));
  const rows = (rawRows ?? []) as { id: string; scholar_id_number: string; attended_date: string; activity_day?: string | null; school_year?: string | null; semester?: string | null }[];
  if (error || rows.length === 0) return [];

  const scholarIds = [...new Set(rows.map(r => r.scholar_id_number))];
  const { data: scholars } = await supabase.from("scholars").select("scholar_id_number, first_name, last_name").in("scholar_id_number", scholarIds);
  const nameByScholarId = new Map((scholars ?? []).map(s => [s.scholar_id_number, `${s.first_name} ${s.last_name}`]));

  return rows.map(r => ({
    id: r.id, scholarIdNumber: r.scholar_id_number,
    scholarName: nameByScholarId.get(r.scholar_id_number) ?? r.scholar_id_number,
    attendedDate: r.attended_date,
    activityDay: r.activity_day ?? null,
    schoolYear: r.school_year ?? null,
    semester: r.semester ?? null,
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

export interface CreditHistoryEntry {
  id: string;
  occurredAt: string;
  eventType: "credit_added" | "credit_removed" | "credit_changed" | "category_changed";
  source: string;
  scholarIdNumber: string | null;
  scholarName: string | null;
  occurrenceNumber: number | null;
  schoolYear: string | null;
  semester: string | null;
  actorName: string | null;
  details: Record<string, unknown> | null;
}

/**
 * The append-only record of every credit added / removed / moved and every category change for one activity, newest first
 * (supabase_migration_sdp_update_p1_codes_history_speed.sql). Returns null when the table is not installed yet or the person may not read it,
 * so the screen can simply leave the History section out instead of showing an error.
 */
export async function fetchCreditHistory(activityId: string, limit = 300): Promise<CreditHistoryEntry[] | null> {
  const { data, error } = await supabase.from("sdp_credit_history")
    .select("id, occurred_at, event_type, source, scholar_id_number, occurrence_number, school_year, semester, actor_name, details")
    .eq("activity_id", activityId).order("occurred_at", { ascending: false }).order("id", { ascending: false }).limit(limit);
  if (error || !data) return null;
  const ids = [...new Set(data.map(r => r.scholar_id_number).filter((x): x is string => !!x))];
  const scholars = ids.length ? await fetchInChunks("scholars", "scholar_id_number, first_name, last_name", "scholar_id_number", ids) : [];
  const nameById = new Map(scholars.map(s => [String(s.scholar_id_number), `${s.first_name} ${s.last_name}`]));
  return data.map(r => ({
    id: r.id, occurredAt: r.occurred_at, eventType: r.event_type, source: r.source,
    scholarIdNumber: r.scholar_id_number, scholarName: r.scholar_id_number ? nameById.get(r.scholar_id_number) ?? null : null,
    occurrenceNumber: r.occurrence_number, schoolYear: r.school_year, semester: r.semester, actorName: r.actor_name,
    details: (r.details ?? null) as Record<string, unknown> | null,
  }));
}

/** A school year and semester a credit counts in. */
export interface CreditPeriod { schoolYear: string; semester: string }

/**
 * Credits every scholar who attended (is present) but has no credit for this activity: one credit per finished day, in the chosen semester
 * (the current grading period when none is given). Needs the activity to have an SDP category. Returns how many scholars were credited.
 */
export async function creditAttendedScholars(activityId: string, period: CreditPeriod | null = null): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const { data, error } = period
    ? await supabase.rpc("credit_attended_scholars", { p_activity_id: activityId, p_school_year: period.schoolYear, p_semester: period.semester })
    : await supabase.rpc("credit_attended_scholars", { p_activity_id: activityId });
  if (error) {
    const missing = error.code === "PGRST202" || /could not find the function|does not exist/i.test(error.message ?? "");
    return { ok: false, error: missing ? "This needs the latest database update (credit attended scholars, semester choice). Please ask the IT admin to run it." : error.message };
  }
  return { ok: true, count: Number(data ?? 0) };
}

/** Moves ONE credit to another semester (it only changes which semester it counts in; nothing is added or removed, and the move is written to the history). */
export async function moveCreditSemester(creditId: string, period: CreditPeriod): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc("move_sdp_credit_semester", { p_credit_id: creditId, p_school_year: period.schoolYear, p_semester: period.semester });
  if (!error) return { ok: true };
  const missing = error.code === "PGRST202" || /could not find the function|does not exist/i.test(error.message ?? "");
  return { ok: false, error: missing ? "This needs the latest database update (move a credit to another semester). Please ask the IT admin to run it." : error.message };
}

/** Credits one scholar as having completed this activity — this is what marks its category
 *  complete for them (see scholar_sdp_category_status). Points are no longer part of this. */
export async function creditAttendance(
  activityId: string, scholarIdNumber: string, attendedDate: string, period: CreditPeriod | null = null
): Promise<{ ok: boolean; error?: string }> {
  const { data: auth } = await supabase.auth.getUser();
  // Stamped with the current grading period (supabase_migration_sdp_reserved_credits.sql)
  // so this manual credit counts toward period-scoped totals — this path bypasses the
  // cap/reserved-credit banking in redeem_attendance_code() intentionally, same as before.
  const { data: currentPeriod } = await supabase.rpc("get_current_grading_period").maybeSingle();
  const periodRow = period ? null : (currentPeriod as { current_school_year: string | null; current_semester: string | null } | null);
  const { error } = await supabase.from("sdp_attendance")
    .upsert(
      {
        activity_id: activityId, scholar_id_number: scholarIdNumber, attended_date: attendedDate, created_by: auth.user?.id ?? null,
        school_year: period?.schoolYear ?? periodRow?.current_school_year ?? null, semester: period?.semester ?? periodRow?.current_semester ?? null,
      },
      { onConflict: "activity_id,scholar_id_number,occurrence_number" }
    );
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Credits one scholar for ONE chosen day of a recurring activity (supabase_migration_sdp_manual_credit_by_day.sql). The database allows a day only once per
 * scholar, only a real day of the activity, and never more credits than the activity has days.
 */
export async function creditScholarForDay(
  activityId: string, scholarIdNumber: string, day: string, period: CreditPeriod | null = null
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc("credit_scholar_for_day", {
    p_activity_id: activityId, p_scholar_id_number: scholarIdNumber, p_day: day,
    p_school_year: period?.schoolYear ?? null, p_semester: period?.semester ?? null,
  });
  if (!error) return { ok: true };
  const missing = error.code === "PGRST202" || /could not find the function|does not exist/i.test(error.message ?? "");
  return { ok: false, error: missing ? "Crediting a scholar for another day needs the latest database update. Please ask the IT admin to run it." : error.message };
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

export type ChecklistFilter = "all" | "complied" | "not_complied";
export type ChecklistSortKey = "scholarIdNumber" | "name" | "communityService" | "communityVolunteerism" | "formationProgram" | "result";
export interface ChecklistPageQuery {
  schoolYear: string; semester: string; search: string; filter: ChecklistFilter;
  sortKey: ChecklistSortKey | null; sortDir: "asc" | "desc"; page: number; pageSize: number;
}
const CHECKLIST_SORT_NAMES: Record<ChecklistSortKey, string> = {
  scholarIdNumber: "id", name: "name", communityService: "community_service", communityVolunteerism: "community_volunteerism", formationProgram: "formation_program", result: "result",
};
const isMissingFunction = (error: { code?: string; message?: string }) => error.code === "PGRST202" || /could not find the function|does not exist/i.test(error.message ?? "");

/**
 * ONE PAGE of the SDP Checklist (scholars_sdp_checklist_page, supabase_migration_sdp_update_p2_checklist_paging.sql): the database searches, filters,
 * sorts and cuts the page, and works out the result only for the scholars shown. `missing: true` means the database update has not been run yet,
 * so the screen falls back to loading everyone (fetchScholarsSdpCompliance), as before.
 */
export async function fetchSdpChecklistPage(q: ChecklistPageQuery): Promise<{ ok: true; rows: ScholarSdpCompliance[]; total: number } | { ok: false; error: string; missing: boolean }> {
  const { data, error } = await supabase.rpc("scholars_sdp_checklist_page", {
    p_school_year: q.schoolYear, p_semester: q.semester, p_search: q.search, p_filter: q.filter,
    p_sort: q.sortKey ? CHECKLIST_SORT_NAMES[q.sortKey] : "default", p_dir: q.sortDir, p_page: q.page, p_page_size: q.pageSize,
  });
  if (error) return { ok: false, error: error.message, missing: isMissingFunction(error) };
  const page = (data ?? []) as Record<string, unknown>[];
  return {
    ok: true,
    total: page.length > 0 ? Number(page[0].total_count ?? 0) : 0,
    rows: page.map(r => ({
      scholarIdNumber: String(r.scholar_id_number), name: String(r.name ?? ""),
      communityService: Number(r.community_service ?? 0), communityVolunteerism: Number(r.community_volunteerism ?? 0), formationProgram: Number(r.formation_program ?? 0),
      applicable: r.applicable !== false, complied: r.complied == null ? null : !!r.complied, missing: String(r.missing ?? ""),
    })),
  };
}

export interface ChecklistSummary { total: number; complied: number; notComplied: number; applicable: boolean }

/** The three counts (everyone / complied / not complied) for one semester, from one small question that can load after the page is already showing. */
export async function fetchSdpChecklistSummary(period: { schoolYear: string; semester: string }): Promise<{ ok: true; summary: ChecklistSummary } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("scholars_sdp_checklist_summary", { p_school_year: period.schoolYear, p_semester: period.semester }).maybeSingle();
  if (error || !data) return { ok: false, error: error?.message ?? "No answer" };
  const r = data as Record<string, unknown>;
  return { ok: true, summary: { total: Number(r.total ?? 0), complied: Number(r.complied ?? 0), notComplied: Number(r.not_complied ?? 0), applicable: r.applicable !== false } };
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
  /** One row per credit. For a recurring activity several rows share an activityId, one for each credited day. */
  rowKey: string;
  activityId: string;
  /** "Main name – Sub-name" when the credited day has a sub-name, otherwise the activity's name. */
  activityName: string;
  category: SDPCategory | null;
  subCategory: SDPSubCategory | null;
  date: string; // "" if unset
}

/** Attended (credited) vs. Available (not yet attended) activities for one scholar. */
export async function fetchScholarSDPHistory(scholarIdNumber: string): Promise<{ attended: SDPHistoryRow[]; available: SDPHistoryRow[] }> {
  // The most the database offers first (sub-category, the days' sub-names, the day of each credit); fewer columns when the database update for them has not been run yet.
  type ActRow = { name?: string; category?: SDPCategory | null; sub_category?: SDPSubCategory | null; sub_name?: string | null; date_time?: string | null; end_time?: string | null; venue?: string | null; recurring_dates?: RecurringOccurrence[] | null };
  type OpenRow = ActRow & { id: string };
  type Result<T> = { data: T[] | null; error: unknown };
  const tiers: { attended: string; activities: string }[] = [
    { attended: "activity_id, attended_date, activity_day, sdp_activities(name, category, sub_category, sub_name, date_time, end_time, venue, recurring_dates)", activities: "id, name, category, sub_category, sub_name, date_time, end_time, venue, recurring_dates" },
    { attended: "activity_id, attended_date, sdp_activities(name, category, sub_category)", activities: "id, name, category, sub_category, date_time" },
    { attended: "activity_id, attended_date, sdp_activities(name, category)", activities: "id, name, category, date_time" },
  ];
  let attendanceRows: Record<string, unknown>[] | null = null, openActivities: OpenRow[] | null = null;
  for (const t of tiers) {
    const [a, o] = await Promise.all([
      supabase.from("sdp_attendance").select(t.attended).eq("scholar_id_number", scholarIdNumber) as unknown as PromiseLike<Result<Record<string, unknown>>>,
      supabase.from("sdp_activities").select(t.activities) as unknown as PromiseLike<Result<OpenRow>>,
    ]);
    if (!a.error && !o.error) { attendanceRows = a.data; openActivities = o.data; break; }
  }

  const attended: SDPHistoryRow[] = (attendanceRows ?? []).map((r: Record<string, unknown>, i) => {
    const act = (r.sdp_activities ?? null) as ActRow | null;
    const schedule = { name: String(act?.name ?? "—"), dateTime: act?.date_time ?? "", endTime: act?.end_time ?? "", venue: act?.venue ?? "", subName: String(act?.sub_name ?? ""), recurringDates: act?.recurring_dates ?? [] };
    const day = creditDay(schedule, (r.activity_day as string | null | undefined) ?? null, (r.attended_date as string | null | undefined) ?? null);
    return {
      rowKey: `${r.activity_id}-${r.attended_date}-${i}`,
      activityId: String(r.activity_id),
      activityName: dayLabel(schedule, day),
      category: act?.category ?? null,
      subCategory: act?.sub_category ?? null,
      date: String(r.attended_date ?? ""),
    };
  });

  const attendedActivityIds = new Set(attended.map(a => a.activityId));
  const available: SDPHistoryRow[] = (openActivities ?? [])
    .filter(a => !attendedActivityIds.has(a.id))
    .map(a => ({ rowKey: a.id, activityId: a.id, activityName: String(a.name ?? ""), category: (a.category as SDPCategory | null) ?? null, subCategory: a.sub_category ?? null, date: a.date_time ?? "" }));

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
  /** The day of a recurring activity this code is for ("2026-10-21"), or null (any day). */
  dayDate?: string | null;
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

type AttendanceCodeInsert = { session_id: string; code: string; kind: string; batch_number: number; day_date?: string | null };
type AttendanceCodeRow = { id: string; code: string; kind: "time_in" | "time_out" | "voucher"; batch_number: number | null; redeemed_by_scholar_id: string | null; redeemed_at: string | null; day_date?: string | null };
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
    const part = codes.slice(from, from + ATTENDANCE_CODE_PAGE_SIZE);
    let { error } = await supabase.from("attendance_codes").insert(part);
    if (error && part.some(c => "day_date" in c) && /day_date/i.test(error.message)) {
      // The database update for the days has not been run yet: the codes are made without a day, as before.
      ({ error } = await supabase.from("attendance_codes").insert(part.map(({ day_date: _day, ...rest }) => rest)));
    }
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
      batchNumber: Number(c.batch_number ?? 1), dayDate: c.day_date ?? null, redeemedByScholarId: c.redeemed_by_scholar_id, redeemedAt: c.redeemed_at,
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
  activityId: string, type: AttendanceType, participantCount: number, voucherHours = 1, day: string | null = null
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
    for (let i = 0; i < participantCount; i++) codes.push({ session_id: session.id, code: randomCode(), kind: "time_in", batch_number: 1, ...(day ? { day_date: day } : {}) });
    for (let i = 0; i < participantCount; i++) codes.push({ session_id: session.id, code: randomCode(), kind: "time_out", batch_number: 1, ...(day ? { day_date: day } : {}) });
  } else {
    for (let i = 0; i < participantCount; i++) codes.push({ session_id: session.id, code: randomCode(), kind: "voucher", batch_number: 1, ...(day ? { day_date: day } : {}) });
  }

  const codesError = await insertAttendanceCodes(codes);
  if (codesError) return { ok: false, error: codesError, sessionId: session.id };
  return { ok: true, sessionId: session.id };
}

/**
 * Generates additional single-use codes when attendance exceeds the original estimate, or when a recurring activity needs a fresh code for each
 * day: vouchers for a Voucher session, and one time-in plus one time-out code per person for a Time-in / Time-out session.
 */
export async function addAttendanceVouchers(sessionId: string, participantCount: number, day: string | null = null): Promise<{ ok: boolean; error?: string }> {
  if (participantCount < 1) return { ok: false, error: "Enter a number greater than 0." };
  const { data: sessionInfo } = await supabase.from("attendance_sessions").select("type").eq("id", sessionId).maybeSingle();
  const { data: latestBatch } = await supabase.from("attendance_codes").select("batch_number").eq("session_id", sessionId).order("batch_number", { ascending: false }).limit(1).maybeSingle();
  const batchNumber = Number(latestBatch?.batch_number ?? 0) + 1;
  const kinds = sessionInfo?.type === "time_in_time_out" ? ["time_in", "time_out"] : ["voucher"];
  const codes = kinds.flatMap(kind => Array.from({ length: participantCount }, () => ({ session_id: sessionId, code: randomCode(), kind, batch_number: batchNumber, ...(day ? { day_date: day } : {}) })));
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

/** Scholars who owe EXTRA credits for a semester (an approved SDP reconsideration of the semester before): only those who do. Empty before the SDP reconsideration database update. */
export async function fetchSdpOwed(schoolYear: string, semester: string): Promise<Map<string, { communityService: number; communityVolunteerism: number; formationProgram: number }>> {
  const out = new Map<string, { communityService: number; communityVolunteerism: number; formationProgram: number }>();
  const { data, error } = await supabase.rpc("scholars_sdp_extra_required", { p_school_year: schoolYear, p_semester: semester });
  if (error || !Array.isArray(data)) return out;
  for (const r of data as { scholar_id_number: string; community_service: number; community_volunteerism: number; formation_program: number }[]) {
    out.set(String(r.scholar_id_number), { communityService: Number(r.community_service) || 0, communityVolunteerism: Number(r.community_volunteerism) || 0, formationProgram: Number(r.formation_program) || 0 });
  }
  return out;
}
