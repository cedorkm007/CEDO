import { supabase } from "@/lib/supabase";
import type { FormationActivity } from "@/scholar/formationActivitiesApi";

export type NewFormationActivityInput = Pick<FormationActivity, "name" | "shortDescription" | "dateTime" | "venue" | "yearLevels" | "allYearLevels" | "attendanceEnabled">;

function rowToActivity(row: Record<string, unknown>): FormationActivity {
  return {
    id: String(row.id), name: String(row.name ?? ""), shortDescription: String(row.short_description ?? ""),
    dateTime: String(row.date_time ?? ""), venue: String(row.venue ?? ""),
    yearLevels: Array.isArray(row.target_year_levels) ? row.target_year_levels.map(String) : [],
    allYearLevels: Boolean(row.all_year_levels), attendanceEnabled: Boolean(row.attendance_enabled),
    createdAt: String(row.created_at ?? ""),
  };
}

export async function fetchFormationActivities(): Promise<FormationActivity[]> {
  const { data, error } = await supabase.from("formation_activities").select("*").order("date_time");
  if (error || !data) return [];
  return data.map(row => rowToActivity(row as Record<string, unknown>));
}

export async function createFormationActivity(input: NewFormationActivityInput): Promise<{ ok: boolean; error?: string }> {
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase.from("formation_activities").insert({
    name: input.name, short_description: input.shortDescription, date_time: input.dateTime, venue: input.venue,
    target_year_levels: input.yearLevels, all_year_levels: input.allYearLevels, attendance_enabled: input.attendanceEnabled,
    created_by: auth.user?.id ?? null,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function updateFormationActivity(id: string, input: NewFormationActivityInput): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("formation_activities").update({
    name: input.name, short_description: input.shortDescription, date_time: input.dateTime, venue: input.venue,
    target_year_levels: input.yearLevels, all_year_levels: input.allYearLevels, attendance_enabled: input.attendanceEnabled,
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function deleteFormationActivity(id: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("formation_activities").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}
