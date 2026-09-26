import { supabase } from "@/lib/supabase";

export const FORMATION_YEAR_LEVELS = ["1st Year", "2nd Year", "3rd Year", "4th Year", "5th Year"] as const;

export interface FormationActivity {
  id: string;
  name: string;
  shortDescription: string;
  dateTime: string;
  endTime: string | null;
  venue: string;
  yearLevels: string[];
  allYearLevels: boolean;
  attendanceEnabled: boolean;
  pubmatPath: string | null;
  createdAt: string;
}

function rowToActivity(row: Record<string, unknown>): FormationActivity {
  return {
    id: String(row.id), name: String(row.name ?? ""), shortDescription: String(row.short_description ?? ""),
    dateTime: String(row.date_time ?? ""), endTime: row.end_time ? String(row.end_time) : null, venue: String(row.venue ?? ""),
    yearLevels: Array.isArray(row.target_year_levels) ? row.target_year_levels.map(String) : [],
    allYearLevels: Boolean(row.all_year_levels), attendanceEnabled: Boolean(row.attendance_enabled),
    pubmatPath: (row.pubmat_path as string | null) ?? null,
    createdAt: String(row.created_at ?? ""),
  };
}

export async function fetchFormationActivitiesForScholar(): Promise<FormationActivity[]> {
  const { data, error } = await supabase.from("formation_activities").select("*").order("date_time");
  if (error || !data) return [];
  return data.map(row => rowToActivity(row as Record<string, unknown>));
}

/**
 * IDs of every Formation activity this scholar has actually attended — for
 * the "Attended" mark in Calendar and Activities. Read via
 * attendance_records (own-row RLS already exists) joined to
 * attendance_sessions.formation_activity_id, keeping a row whenever the
 * scholar timed in or redeemed at least one voucher, regardless of whether
 * a post-event survey is still pending — attendance and survey completion
 * are separate concerns (see redeem_attendance_code()'s own pending_survey
 * status).
 */
export async function fetchAttendedFormationActivityIds(scholarIdNumber: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("attendance_records")
    .select("time_in_at, voucher_redemption_count, attendance_sessions!inner(formation_activity_id)")
    .eq("scholar_id_number", scholarIdNumber);
  if (error || !data) return new Set();
  const ids = new Set<string>();
  for (const row of data as unknown as { time_in_at: string | null; voucher_redemption_count: number | null; attendance_sessions: { formation_activity_id: string | null } | null }[]) {
    const activityId = row.attendance_sessions?.formation_activity_id;
    if (!activityId) continue;
    if (row.time_in_at || (row.voucher_redemption_count ?? 0) > 0) ids.add(activityId);
  }
  return ids;
}
