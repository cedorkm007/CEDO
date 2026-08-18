import { supabase } from "@/lib/supabase";
import type { FormationActivity } from "@/scholar/formationActivitiesApi";
import type { AttendanceType, AttendanceCode, AttendanceSession } from "./sdpMonitorApi";

export type NewFormationActivityInput = Pick<FormationActivity, "name" | "shortDescription" | "dateTime" | "endTime" | "venue" | "yearLevels" | "allYearLevels" | "attendanceEnabled">;

function localDateTimeToIso(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
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

export async function fetchFormationActivities(): Promise<FormationActivity[]> {
  const { data, error } = await supabase.from("formation_activities").select("*").order("date_time");
  if (error || !data) return [];
  return data.map(row => rowToActivity(row as Record<string, unknown>));
}

export async function createFormationActivity(input: NewFormationActivityInput): Promise<{ ok: boolean; error?: string; id?: string }> {
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase.from("formation_activities").insert({
    name: input.name, short_description: input.shortDescription, date_time: localDateTimeToIso(input.dateTime), end_time: localDateTimeToIso(input.endTime), venue: input.venue,
    target_year_levels: input.yearLevels, all_year_levels: input.allYearLevels, attendance_enabled: input.attendanceEnabled,
    created_by: auth.user?.id ?? null,
  }).select("id").single();
  return error || !data ? { ok: false, error: error?.message || "Couldn't create the activity." } : { ok: true, id: data.id };
}

export async function updateFormationActivity(id: string, input: NewFormationActivityInput): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("formation_activities").update({
    name: input.name, short_description: input.shortDescription, date_time: localDateTimeToIso(input.dateTime), end_time: localDateTimeToIso(input.endTime), venue: input.venue,
    target_year_levels: input.yearLevels, all_year_levels: input.allYearLevels, attendance_enabled: input.attendanceEnabled,
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function deleteFormationActivity(id: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("formation_activities").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

function randomCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let result = "";
  for (let index = 0; index < 7; index++) result += alphabet[Math.floor(Math.random() * alphabet.length)];
  return result;
}

export async function enableFormationAttendance(activityId: string, type: AttendanceType, participantCount: number, voucherHours = 1): Promise<{ ok: boolean; error?: string }> {
  const { data: auth } = await supabase.auth.getUser();
  const { data: session, error: sessionError } = await supabase.from("attendance_sessions").insert({
    formation_activity_id: activityId, type, expected_attendees: participantCount,
    duration_hours: type === "voucher" ? voucherHours : null, created_by: auth.user?.id ?? null,
  }).select("id").single();
  if (sessionError || !session) return { ok: false, error: sessionError?.message || "Couldn't enable attendance." };
  const codes = type === "time_in_time_out"
    ? Array.from({ length: participantCount * 2 }, (_, index) => ({ session_id: session.id, code: randomCode(), kind: index < participantCount ? "time_in" : "time_out", batch_number: 1 }))
    : Array.from({ length: participantCount }, () => ({ session_id: session.id, code: randomCode(), kind: "voucher", batch_number: 1 }));
  const { error } = await supabase.from("attendance_codes").insert(codes);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Adds capacity after attendance has been enabled. Time-in/time-out adds a matching pair per scholar. */
export async function addFormationAttendanceCodes(sessionId: string, type: AttendanceType, participantCount: number): Promise<{ ok: boolean; error?: string }> {
  if (participantCount < 1) return { ok: false, error: "Enter a number greater than 0." };
  const { data: latestBatch } = await supabase.from("attendance_codes").select("batch_number").eq("session_id", sessionId).order("batch_number", { ascending: false }).limit(1).maybeSingle();
  const batchNumber = Number(latestBatch?.batch_number ?? 0) + 1;
  const codes = type === "time_in_time_out"
    ? [
        ...Array.from({ length: participantCount }, () => ({ session_id: sessionId, code: randomCode(), kind: "time_in", batch_number: batchNumber })),
        ...Array.from({ length: participantCount }, () => ({ session_id: sessionId, code: randomCode(), kind: "time_out", batch_number: batchNumber })),
      ]
    : Array.from({ length: participantCount }, () => ({ session_id: sessionId, code: randomCode(), kind: "voucher", batch_number: batchNumber }));
  const { error: codesError } = await supabase.from("attendance_codes").insert(codes);
  if (codesError) return { ok: false, error: codesError.message };
  const { data: session, error: sessionError } = await supabase.from("attendance_sessions").select("expected_attendees").eq("id", sessionId).single();
  if (sessionError) return { ok: false, error: sessionError.message };
  const { error: updateError } = await supabase.from("attendance_sessions")
    .update({ expected_attendees: Number(session.expected_attendees ?? 0) + participantCount }).eq("id", sessionId);
  return updateError ? { ok: false, error: updateError.message } : { ok: true };
}

export async function fetchFormationAttendanceSession(activityId: string): Promise<{ session: AttendanceSession; codes: AttendanceCode[] } | null> {
  const { data: row } = await supabase.from("attendance_sessions").select("*").eq("formation_activity_id", activityId).maybeSingle();
  if (!row) return null;
  const { data: codeRows } = await supabase.from("attendance_codes").select("*").eq("session_id", row.id).order("kind").order("created_at");
  return {
    session: { id: row.id, type: row.type, expectedAttendees: row.expected_attendees, voucherHours: row.duration_hours, createdAt: row.created_at },
    codes: (codeRows ?? []).map(code => ({ id: code.id, code: code.code, kind: code.kind, batchNumber: Number(code.batch_number ?? 1), redeemedByScholarId: code.redeemed_by_scholar_id, redeemedAt: code.redeemed_at })),
  };
}
