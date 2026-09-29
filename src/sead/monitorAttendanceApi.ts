import { supabase } from "@/lib/supabase";
import type { ActivityType } from "./activityMonitorsApi";

export type ScanOutcome = "success" | "already_scanned" | "unrecognized_token" | "not_eligible" | "removed_scholar" | "attendance_not_enabled";
export type AttendanceKind = "time_in" | "time_out" | "voucher";

export interface ScanResult {
  outcome: ScanOutcome;
  scholarName?: string;
  activityName?: string;
  kind?: AttendanceKind;
  surveyPending?: boolean;
  surveyId?: string | null;
  categoryCompleted?: boolean;
}

/**
 * Records one scan for a monitor — thin wrapper over record_monitor_attendance(),
 * which does all authorization/eligibility/duplicate checks server-side and
 * returns one of ScanOutcome rather than throwing for the expected
 * non-error cases. A thrown error here means something genuinely
 * unexpected (not authorized, malformed input), not a normal scan outcome.
 */
export async function recordMonitorAttendance(
  activityType: ActivityType, activityId: string, scholarQrToken: string, kind: AttendanceKind,
): Promise<{ ok: true; result: ScanResult } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("record_monitor_attendance", {
    p_activity_type: activityType, p_activity_id: activityId, p_scholar_qr_token: scholarQrToken, p_kind: kind,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, result: data as ScanResult };
}
