import { supabase } from "@/lib/supabase";
import type { SDPActivity, SDPStatus } from "@/scholar/sdpApi";

// Re-export so consumers of this module don't also need to import from
// src/scholar/sdpApi directly — same underlying `sdp_activities` table,
// just accessed here with staff (sdp_monitoring tag) RLS instead of
// scholar RLS.
export type { SDPActivity, SDPStatus };

function rowToActivity(r: Record<string, unknown>): SDPActivity {
  return {
    id: String(r.id),
    name: String(r.name),
    submittedByScholarId: (r.submitted_by_scholar_id as string | null) ?? null,
    nature: (r.nature as string[]) ?? [],
    organization: String(r.organization ?? ""),
    dateTime: (r.date_time as string | null) ?? "",
    venue: String(r.venue ?? ""),
    projectHead: String(r.project_head ?? ""),
    headCluster: String(r.head_cluster ?? ""),
    status: r.status as SDPStatus,
    sdpPoints: Number(r.sdp_points ?? 0),
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
  id: string, fields: { status: SDPStatus; projectHead?: string; headCluster?: string; sdpPoints?: number }
): Promise<{ ok: boolean; error?: string }> {
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase.from("sdp_activities").update({
    status: fields.status,
    project_head: fields.projectHead,
    head_cluster: fields.headCluster,
    sdp_points: fields.sdpPoints,
    reviewed_by: auth.user?.id ?? null,
    reviewed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export interface NewApprovedActivityInput {
  name: string;
  organization: string;
  dateTime: string;
  venue: string;
  nature: string[];
}

/** Staff can create an activity directly (no scholar proposal), open to all — starts 'approved'. */
export async function createApprovedActivity(input: NewApprovedActivityInput): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("sdp_activities").insert({
    name: input.name,
    submitted_by_scholar_id: null,
    organization: input.organization,
    date_time: input.dateTime || null,
    venue: input.venue,
    nature: input.nature,
    status: "approved",
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

// ── SDP Points monitoring ────────────────────────────────────

export interface AttendanceEntry {
  id: string;
  scholarIdNumber: string;
  scholarName: string;
  pointsCredited: number;
  attendedDate: string;
}

/** Everyone currently credited for one activity — shown in that activity's detail modal. */
export async function fetchAttendanceForActivity(activityId: string): Promise<AttendanceEntry[]> {
  const { data: rows, error } = await supabase.from("sdp_attendance")
    .select("id, scholar_id_number, points_credited, attended_date").eq("activity_id", activityId).order("attended_date", { ascending: false });
  if (error || !rows || rows.length === 0) return [];

  const scholarIds = [...new Set(rows.map(r => r.scholar_id_number))];
  const { data: scholars } = await supabase.from("scholars").select("scholar_id_number, first_name, last_name").in("scholar_id_number", scholarIds);
  const nameByScholarId = new Map((scholars ?? []).map(s => [s.scholar_id_number, `${s.first_name} ${s.last_name}`]));

  return rows.map(r => ({
    id: r.id, scholarIdNumber: r.scholar_id_number,
    scholarName: nameByScholarId.get(r.scholar_id_number) ?? r.scholar_id_number,
    pointsCredited: Number(r.points_credited), attendedDate: r.attended_date,
  }));
}

/** Credits (or re-credits, updating the point value) one scholar for attending one activity. */
export async function creditAttendance(
  activityId: string, scholarIdNumber: string, points: number, attendedDate: string
): Promise<{ ok: boolean; error?: string }> {
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase.from("sdp_attendance")
    .upsert(
      { activity_id: activityId, scholar_id_number: scholarIdNumber, points_credited: points, attended_date: attendedDate, created_by: auth.user?.id ?? null },
      { onConflict: "activity_id,scholar_id_number" }
    );
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function removeAttendance(attendanceId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("sdp_attendance").delete().eq("id", attendanceId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export interface ScholarSDPSummary {
  scholarIdNumber: string;
  name: string;
  totalPoints: number;
}

/** One row per scholar with an account, showing their running SDP point total. */
export async function fetchAllScholarsSDPSummary(): Promise<ScholarSDPSummary[]> {
  const [{ data: scholars }, { data: attendance }] = await Promise.all([
    supabase.from("scholars").select("scholar_id_number, first_name, last_name").order("last_name"),
    supabase.from("sdp_attendance").select("scholar_id_number, points_credited"),
  ]);
  if (!scholars) return [];

  const totalsByScholarId = new Map<string, number>();
  for (const row of attendance ?? []) {
    totalsByScholarId.set(row.scholar_id_number, (totalsByScholarId.get(row.scholar_id_number) ?? 0) + Number(row.points_credited ?? 0));
  }

  return scholars.map(s => ({
    scholarIdNumber: s.scholar_id_number,
    name: `${s.first_name} ${s.last_name}`,
    totalPoints: totalsByScholarId.get(s.scholar_id_number) ?? 0,
  }));
}

export interface SDPHistoryRow {
  activityId: string;
  activityName: string;
  points: number;
  date: string; // "" if unset
}

/** Attended (credited) vs. Available (approved/ongoing, not yet attended) activities for one scholar. */
export async function fetchScholarSDPHistory(scholarIdNumber: string): Promise<{ attended: SDPHistoryRow[]; available: SDPHistoryRow[] }> {
  const [{ data: attendanceRows }, { data: openActivities }] = await Promise.all([
    supabase.from("sdp_attendance").select("activity_id, points_credited, attended_date, sdp_activities(name)").eq("scholar_id_number", scholarIdNumber),
    supabase.from("sdp_activities").select("id, name, sdp_points, date_time").in("status", ["approved", "ongoing"]),
  ]);

  const attended: SDPHistoryRow[] = (attendanceRows ?? []).map((r: Record<string, unknown>) => ({
    activityId: String(r.activity_id),
    activityName: String((r.sdp_activities as { name?: string } | null)?.name ?? "—"),
    points: Number(r.points_credited ?? 0),
    date: String(r.attended_date ?? ""),
  }));

  const attendedActivityIds = new Set(attended.map(a => a.activityId));
  const available: SDPHistoryRow[] = (openActivities ?? [])
    .filter(a => !attendedActivityIds.has(a.id))
    .map(a => ({ activityId: a.id, activityName: a.name, points: Number(a.sdp_points ?? 0), date: a.date_time ?? "" }));

  return { attended, available };
}
