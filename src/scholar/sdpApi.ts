import { supabase } from "@/lib/supabase";
import { SDP_CREDITS_REQUIRED } from "@/lib/renewal";

export type SDPCategory = "community_service" | "community_volunteerism" | "formation_program";
export type SDPActivityType = "one_time" | "recurring";
/** endTime is optional — occurrences added before this field existed only have a start `date`. */
export interface RecurringOccurrence { date: string; endTime?: string; venue: string; /** Optional label of this day, e.g. "Day 2 – Bonbon Shoreline". Only a label: it never changes how days or credits are counted. */ subName?: string; }

export const SDP_CATEGORIES: { key: SDPCategory; label: string }[] = [
  { key: "community_service", label: "Institutional Volunteerism" },
  { key: "community_volunteerism", label: "Community Volunteerism" },
  { key: "formation_program", label: "Formation Program" },
];

/** Under every category an activity can also be School-based, Community-based or CEDO Projects. It has no effect on credits or on Complied / Not complied. */
export type SDPSubCategory = "school_based" | "community_based" | "cedo_projects";
export const SDP_SUBCATEGORIES: { key: SDPSubCategory; label: string }[] = [
  { key: "school_based", label: "School-based" },
  { key: "community_based", label: "Community-based" },
  { key: "cedo_projects", label: "CEDO Projects" },
];
export function subCategoryLabel(key: SDPSubCategory | null | undefined): string {
  return SDP_SUBCATEGORIES.find(s => s.key === key)?.label ?? "No sub-category";
}

// ── The days of a recurring activity and their sub-names ──
const manilaDayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" });
/** The Philippine calendar day ("2026-10-21") of a date/time, "" if it is not a valid date. */
export function manilaDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : manilaDayFormat.format(d);
}
export interface ScheduleDay { day: string; subName: string; venue: string; startIso: string; endIso: string }
type ScheduleSource = Pick<SDPActivity, "dateTime" | "endTime" | "venue" | "subName" | "recurringDates">;
/** Every day of an activity, its own date first and then each extra date, as Philippine calendar days. */
export function scheduleDays(a: ScheduleSource): ScheduleDay[] {
  const out: ScheduleDay[] = [];
  if (a.dateTime) out.push({ day: manilaDay(a.dateTime), subName: (a.subName ?? "").trim(), venue: a.venue, startIso: a.dateTime, endIso: a.endTime });
  for (const o of a.recurringDates ?? []) if (o.date) out.push({ day: manilaDay(o.date), subName: (o.subName ?? "").trim(), venue: o.venue, startIso: o.date, endIso: o.endTime ?? "" });
  return out;
}
/** The sub-name of one day ("" if that day has none, or is not a day of the activity). */
export function daySubName(a: ScheduleSource, day: string | null | undefined): string {
  if (!day) return "";
  return scheduleDays(a).find(d => d.day === day && d.subName)?.subName ?? "";
}
/** "Main name – Sub-name", or just the main name when the day has no sub-name. */
export function dayLabel(a: ScheduleSource & { name: string }, day: string | null | undefined): string {
  const sub = daySubName(a, day);
  return sub ? `${a.name} – ${sub}` : a.name;
}
/** The day a credit is for: the day saved on it, or else the day it was scanned if that is one of the activity's days. */
export function creditDay(a: ScheduleSource, activityDay: string | null | undefined, attendedDate: string | null | undefined): string | null {
  if (activityDay) return activityDay;
  const d = (attendedDate ?? "").slice(0, 10);
  return d && scheduleDays(a).some(s => s.day === d) ? d : null;
}

export interface ObjectiveRow { objective: string; deliverable: string; }
export interface WorkPlanRow { date: string; activity: string; }
export interface ProgramFlowRow { time: string; segment: string; deliverables: string; personInCharge: string; }
export interface BudgetRow { quantity: string; unit: string; specification: string; unitCost: string; subtotal: string; }

export interface SDPActivity {
  id: string;
  name: string;
  submittedByScholarId: string | null; // null = staff-created, open to all scholars
  category: SDPCategory | null;
  /** null = none chosen (activities made before sub-categories existed, or no category yet). */
  subCategory: SDPSubCategory | null;
  /** The sub-name of the activity's own (first) date, "" if none. The sub-names of the other days are in recurringDates. */
  subName: string;
  nature: string[];
  organization: string;
  dateTime: string; // "" if unset — the start of the activity
  endTime: string; // "" if unset
  venue: string;
  projectHead: string;
  headCluster: string;
  budgetaryRequirement: string;
  sourceOfFund: string[];
  sourceOfFundOther: string;
  rationale: string;
  linkWithOrg: string;
  objectives: ObjectiveRow[];
  targetPartners: string[];
  targetPartnersOther: string;
  specificRole: string[];
  workPlan: WorkPlanRow[];
  programFlow: ProgramFlowRow[];
  budgetItems: BudgetRow[];
  pubmatPath: string | null;
  activityType: SDPActivityType;
  recurringDates: RecurringOccurrence[];
  credits: number;
  yearLevels: string[];
  allYearLevels: boolean;
  /** Barangays/clusters ('A'–'H') whose scholars can see this activity -- both empty means everyone. */
  targetBarangays: string[];
  targetClusters: string[];
  createdAt: string;
}

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
    objectives: (r.objectives as ObjectiveRow[]) ?? [],
    targetPartners: (r.target_partners as string[]) ?? [],
    targetPartnersOther: String(r.target_partners_other ?? ""),
    specificRole: (r.specific_role as string[]) ?? [],
    workPlan: (r.work_plan as WorkPlanRow[]) ?? [],
    programFlow: (r.program_flow as ProgramFlowRow[]) ?? [],
    budgetItems: (r.budget_items as BudgetRow[]) ?? [],
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

/** Staff-created activities, open to every scholar immediately. */
export async function fetchApprovedSDPActivities(): Promise<SDPActivity[]> {
  const { data, error } = await supabase.from("sdp_activities")
    .select("*")
    .is("submitted_by_scholar_id", null)
    .order("date_time", { ascending: true });
  if (error || !data) return [];
  return data.map(rowToActivity);
}

export type SDPCategoryStatus = Record<SDPCategory, boolean>;

/**
 * This scholar's completion status for each of the 3 required SDP categories (the green / grey marks on the profile banner and the profile card).
 * A category is complete when EITHER the saved "completed" mark says so OR the credits the SDP tab shows for it (carry-over from earlier semesters included, the same
 * total the renewal check counts) have reached the requirement. The saved mark is kept up to date by a database trigger on the attendance table and can be missing or behind
 * (for example credit that came from "set aside" credits, or an attendance row changed by hand), and a scholar showing 4/3 must never look as if they have not complied.
 */
export async function fetchScholarSDPCategoryStatus(scholarIdNumber: string): Promise<SDPCategoryStatus> {
  const fallback: SDPCategoryStatus = { community_service: false, community_volunteerism: false, formation_program: false };
  const [saved, progress, required] = await Promise.all([
    supabase.from("scholar_sdp_category_status").select("category, completed").eq("scholar_id_number", scholarIdNumber),
    fetchScholarSDPProgress(),
    fetchScholarSDPRequirements(),
  ]);
  const status = { ...fallback };
  if (!saved.error && saved.data) for (const row of saved.data) status[row.category as SDPCategory] = !!row.completed;
  for (const c of Object.keys(status) as SDPCategory[]) if ((progress.credits[c] ?? 0) >= required[c]) status[c] = true;
  return status;
}

/** IDs of every SDP activity this scholar has attended at least once — for the "Attended" mark in Calendar and Activities. A recurring activity's occurrences aren't individually tracked (sdp_attendance only records "attended N times," not which date), so every calendar entry for an attended activity gets the mark, not just the specific occurrence attended. */
export async function fetchAttendedSDPActivityIds(scholarIdNumber: string): Promise<Set<string>> {
  const { data, error } = await supabase.from("sdp_attendance").select("activity_id").eq("scholar_id_number", scholarIdNumber);
  if (error || !data) return new Set();
  return new Set(data.map(r => String(r.activity_id)));
}

export type SDPCreditCounts = Record<SDPCategory, number>;

/**
 * What each SDP category needs for the CURRENT grading period: 3, plus any credits owed because an SDP reconsideration of the semester before was approved
 * (fetch_scholar_sdp_requirements(), supabase_migration_sdp_reconsideration_b_sdp_rules.sql). Before that database update is run, or if it fails, every category needs 3 as always.
 */
export async function fetchScholarSDPRequirements(): Promise<SDPCreditCounts> {
  const req: SDPCreditCounts = { community_service: SDP_CREDITS_REQUIRED, community_volunteerism: SDP_CREDITS_REQUIRED, formation_program: SDP_CREDITS_REQUIRED };
  const { data, error } = await supabase.rpc("fetch_scholar_sdp_requirements");
  if (error || !Array.isArray(data)) return req;
  for (const row of data as { category: SDPCategory; required?: number }[]) {
    const n = Number(row.required);
    if (row.category in req && Number.isFinite(n) && n > 0) req[row.category] = n;
  }
  return req;
}

/** Credits added to the scholar's SDP requirement because an SDP reconsideration was approved: this semester and the ones coming (supabase_migration_sdp_owed_for_scholar.sql). */
export interface SDPOwedRow { schoolYear: string; semester: string; category: SDPCategory; amount: number; isCurrent: boolean }
/** Empty (and no error) before the database update has been run, or when nothing is owed. */
export async function fetchScholarSDPOwed(): Promise<SDPOwedRow[]> {
  const { data, error } = await supabase.rpc("fetch_scholar_sdp_owed");
  if (error || !Array.isArray(data)) return [];
  return (data as { school_year: string; semester: string; category: SDPCategory; amount: number; is_current: boolean }[])
    .map(r => ({ schoolYear: String(r.school_year), semester: String(r.semester), category: r.category, amount: Number(r.amount) || 0, isCurrent: !!r.is_current }))
    .filter(r => r.amount > 0);
}

const zeroCreditCounts = (): SDPCreditCounts => ({ community_service: 0, community_volunteerism: 0, formation_program: 0 });

/**
 * This scholar's credits per SDP category FOR THE CURRENT GRADING PERIOD
 * (3 needed to complete one). The count is the real total (can be 4/3, 6/3)
 * and includes credit carried in automatically from earlier semesters — see
 * fetch_scholar_sdp_progress() (supabase_migration_sdp_show_total_credits_
 * over_required.sql). `reserved` is always 0 now; it is kept only so the
 * RPC's shape didn't have to change.
 */
export async function fetchScholarSDPProgress(): Promise<{ credits: SDPCreditCounts; reserved: SDPCreditCounts }> {
  const fallback = { credits: zeroCreditCounts(), reserved: zeroCreditCounts() };
  const { data, error } = await supabase.rpc("fetch_scholar_sdp_progress");
  if (error || !data) return fallback;
  const credits = zeroCreditCounts();
  const reserved = zeroCreditCounts();
  for (const row of data as { category: SDPCategory; credits: number; reserved: number }[]) {
    credits[row.category] = Number(row.credits ?? 0);
    reserved[row.category] = Number(row.reserved ?? 0);
  }
  return { credits, reserved };
}

/** Applies all of this scholar's unclaimed reserved credit in one category into the current grading period. Returns the amount claimed. */
export async function claimSDPReservedCredits(category: SDPCategory): Promise<{ ok: boolean; error?: string; amount?: number }> {
  const { data, error } = await supabase.rpc("claim_sdp_reserved_credits", { p_category: category });
  if (error) return { ok: false, error: error.message };
  return { ok: true, amount: Number(data ?? 0) };
}

