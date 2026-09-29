import { supabase } from "@/lib/supabase";
import { fetchAllSDPActivities, type SDPActivity } from "./sdpMonitorApi";
import { fetchFormationActivities } from "./formationActivitiesApi";
import type { FormationActivity } from "@/scholar/formationActivitiesApi";

export type ActivityType = "sdp" | "formation";

export interface ActivityMonitor {
  id: string;
  activityType: ActivityType;
  activityId: string;
  staffId: string;
  staffName: string;
}

function rowToMonitor(r: Record<string, unknown>): ActivityMonitor {
  const staff = r.users as { first_name?: string; last_name?: string } | null;
  return {
    id: String(r.id),
    activityType: r.activity_type as ActivityType,
    activityId: String(r.activity_id),
    staffId: String(r.staff_id),
    staffName: staff ? `${staff.first_name ?? ""} ${staff.last_name ?? ""}`.trim() : "",
  };
}

/** Every staff member explicitly assigned as a monitor of one activity (the creator is implicit — see is_activity_monitor() — and isn't listed here unless also explicitly assigned). */
export async function fetchMonitors(activityType: ActivityType, activityId: string): Promise<ActivityMonitor[]> {
  const { data, error } = await supabase.from("activity_monitors")
    .select("id, activity_type, activity_id, staff_id, users!activity_monitors_staff_id_fkey(first_name, last_name)")
    .eq("activity_type", activityType).eq("activity_id", activityId);
  if (error || !data) return [];
  return data.map(r => rowToMonitor(r as Record<string, unknown>));
}

export async function addMonitor(activityType: ActivityType, activityId: string, staffId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase.from("activity_monitors").insert({
    activity_type: activityType, activity_id: activityId, staff_id: staffId, assigned_by: auth.user?.id ?? null,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function removeMonitor(monitorId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("activity_monitors").delete().eq("id", monitorId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Every staff account, for the "add a monitor" picker — same source the rest of the app already loads from (public.users). */
export async function fetchAllStaff(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase.from("users").select("id, first_name, last_name").order("last_name");
  if (error || !data) return [];
  return data.map(r => ({ id: String(r.id), name: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() }));
}

/** Whether the signed-in staff member monitors at least one activity — gates the "Scanning Tools" sidebar tab. */
export async function fetchHasAnyMonitorAssignment(): Promise<boolean> {
  const { data, error } = await supabase.rpc("has_any_monitor_assignment");
  return error ? false : !!data;
}

export interface MonitoredActivity {
  activityType: ActivityType;
  id: string;
  name: string;
  pubmatPath: string | null;
}

/**
 * Every SDP/Formation activity the signed-in staff member monitors —
 * powers the "Scanning Tools" tile grid. Calls a SECURITY DEFINER RPC
 * that explicitly filters by is_activity_monitor() rather than trusting
 * sdp_activities'/formation_activities' own SELECT policies to scope
 * this — both tables' pre-existing scholar-facing policies turned out to
 * be identity-agnostic for any all_year_levels row (i.e. effectively
 * public), which silently broke a plain `.select()` here (see
 * supabase_migration_fetch_my_monitored_activities.sql).
 */
export async function fetchMyMonitoredActivities(): Promise<MonitoredActivity[]> {
  const { data, error } = await supabase.rpc("fetch_my_monitored_activities");
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(r => ({
    activityType: r.activity_type as ActivityType, id: String(r.id), name: String(r.name), pubmatPath: (r.pubmat_path as string | null) ?? null,
  }));
}

/** Loads the full activity record (for the lightweight edit modal, which needs more than the tile grid's minimal fields) via the RLS-permitted monitor-scoped read, reusing the existing full-list fetchers rather than duplicating their row mapping. */
export async function fetchActivityForEdit(activityType: ActivityType, id: string): Promise<SDPActivity | FormationActivity | null> {
  if (activityType === "sdp") {
    const all = await fetchAllSDPActivities();
    return all.find(a => a.id === id) ?? null;
  }
  const all = await fetchFormationActivities();
  return all.find(a => a.id === id) ?? null;
}

/** The attendance session's own type ('time_in_time_out' | 'voucher'), or null if attendance hasn't been enabled for this activity yet — the scanner uses this to decide whether to show a Time In/Time Out toggle before scanning (a voucher-type session needs no toggle; an activity with no session at all can't be scanned, matching record_monitor_attendance's own attendance_not_enabled outcome). */
export async function fetchAttendanceSessionType(activityType: ActivityType, activityId: string): Promise<"time_in_time_out" | "voucher" | null> {
  const column = activityType === "sdp" ? "sdp_activity_id" : "formation_activity_id";
  const { data } = await supabase.from("attendance_sessions").select("type").eq(column, activityId).maybeSingle();
  return (data?.type as "time_in_time_out" | "voucher" | null) ?? null;
}

export type { SDPActivity, FormationActivity };
