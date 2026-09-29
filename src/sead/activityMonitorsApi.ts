import { supabase } from "@/lib/supabase";
import type { SDPActivity } from "./sdpMonitorApi";
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
 * powers the "Scanning Tools" tile grid. RLS alone decides which rows
 * come back (the monitor-scoped SELECT policies added in
 * supabase_migration_activity_monitor_helpers_and_policies.sql); this
 * just runs the two queries and unions the results client-side.
 */
export async function fetchMyMonitoredActivities(): Promise<MonitoredActivity[]> {
  const [sdpResult, formationResult] = await Promise.all([
    supabase.from("sdp_activities").select("id, name, pubmat_path").order("date_time", { ascending: false }),
    supabase.from("formation_activities").select("id, name, pubmat_path").order("date_time", { ascending: false }),
  ]);
  const sdp: MonitoredActivity[] = (sdpResult.data ?? []).map((r: Record<string, unknown>) => ({
    activityType: "sdp" as const, id: String(r.id), name: String(r.name), pubmatPath: (r.pubmat_path as string | null) ?? null,
  }));
  const formation: MonitoredActivity[] = (formationResult.data ?? []).map((r: Record<string, unknown>) => ({
    activityType: "formation" as const, id: String(r.id), name: String(r.name), pubmatPath: (r.pubmat_path as string | null) ?? null,
  }));
  return [...sdp, ...formation];
}

export type { SDPActivity, FormationActivity };
