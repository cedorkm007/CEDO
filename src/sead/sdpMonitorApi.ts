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

export interface NewApprovedActivityInput {
  name: string;
  category: SDPCategory;
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
    category: input.category,
    organization: input.organization,
    date_time: input.dateTime || null,
    venue: input.venue,
    nature: input.nature,
    status: "approved",
  });
  return error ? { ok: false, error: error.message } : { ok: true };
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
  const [{ data: scholars }, { data: statusRows }] = await Promise.all([
    supabase.from("scholars").select("scholar_id_number, first_name, last_name").order("last_name"),
    supabase.from("scholar_sdp_category_status").select("scholar_id_number, category, completed").eq("completed", true),
  ]);
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
