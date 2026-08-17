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
  createdAt: string;
}

function rowToActivity(row: Record<string, unknown>): FormationActivity {
  return {
    id: String(row.id), name: String(row.name ?? ""), shortDescription: String(row.short_description ?? ""),
    dateTime: String(row.date_time ?? ""), endTime: row.end_time ? String(row.end_time) : null, venue: String(row.venue ?? ""),
    yearLevels: Array.isArray(row.target_year_levels) ? row.target_year_levels.map(String) : [],
    allYearLevels: Boolean(row.all_year_levels), attendanceEnabled: Boolean(row.attendance_enabled),
    createdAt: String(row.created_at ?? ""),
  };
}

export async function fetchFormationActivitiesForScholar(): Promise<FormationActivity[]> {
  const { data, error } = await supabase.from("formation_activities").select("*").order("date_time");
  if (error || !data) return [];
  return data.map(row => rowToActivity(row as Record<string, unknown>));
}
