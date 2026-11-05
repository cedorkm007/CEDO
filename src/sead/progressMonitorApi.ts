// ─────────────────────────────────────────────────────────────
// src/sead/progressMonitorApi.ts
// SDP Progress Monitoring for staff: attach it to an activity, list the pictures scholars sent, view a picture, approve (which credits the scholar) or reject.
// Every rule is decided by the database (supabase_migration_sdp_progress_a_tables_functions.sql); these calls just ask.
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";

export type ProgressStatus = "pending" | "approved" | "rejected";
export const PROGRESS_BUCKET = "sdp-progress-photos";
export const PROGRESS_PAGE_SIZE = 50;

export interface ProgressRow {
  id: string; activityId: string; activityName: string; scholarIdNumber: string; scholarName: string; school: string; program: string; status: ProgressStatus;
  imagePath: string; placeText: string; lat: number; lng: number; accuracyM: number | null; capturedAt: string; submittedAt: string; reviewedAt: string | null; reviewerName: string; rejectReason: string;
}
export interface ProgressCounts { pending: number; approved: number; rejected: number }

/** True when the database update has not been run yet (the functions do not exist). */
export function progressMissing(e: { code?: string | null; message?: string | null } | null | undefined): boolean {
  return !!e && (e.code === "PGRST202" || e.code === "42P01" || /could not find the (function|table)|does not exist|schema cache/i.test(e.message ?? ""));
}
const NOT_READY = "Progress monitoring is not set up yet: CEDO still has to run a database update.";

export async function fetchProgressList(args: { status: ProgressStatus | "all"; activityId?: string | null; search?: string; page: number }):
  Promise<{ ok: true; rows: ProgressRow[]; total: number } | { ok: false; error: string; notReady?: boolean }> {
  const { data, error } = await supabase.rpc("sdp_progress_list", {
    p_status: args.status, p_activity_id: args.activityId || null, p_search: args.search?.trim() || null, p_limit: PROGRESS_PAGE_SIZE, p_offset: Math.max(0, args.page) * PROGRESS_PAGE_SIZE,
  });
  if (error) return progressMissing(error) ? { ok: false, error: NOT_READY, notReady: true } : { ok: false, error: error.message };
  const list = (data ?? []) as Record<string, unknown>[];
  return {
    ok: true, total: list.length ? Number(list[0].total_count ?? list.length) : 0,
    rows: list.map(r => ({
      id: String(r.id), activityId: String(r.activity_id), activityName: String(r.activity_name ?? ""), scholarIdNumber: String(r.scholar_id_number), scholarName: String(r.scholar_name ?? ""),
      school: String(r.school ?? ""), program: String(r.program ?? ""), status: r.status as ProgressStatus, imagePath: String(r.image_path), placeText: String(r.place_text ?? ""),
      lat: Number(r.taken_lat), lng: Number(r.taken_lng), accuracyM: r.accuracy_m == null ? null : Number(r.accuracy_m), capturedAt: String(r.captured_at), submittedAt: String(r.submitted_at),
      reviewedAt: r.reviewed_at ? String(r.reviewed_at) : null, reviewerName: String(r.reviewer_name ?? ""), rejectReason: String(r.reject_reason ?? ""),
    })),
  };
}

export async function fetchProgressCounts(activityId?: string | null): Promise<ProgressCounts> {
  const { data, error } = await supabase.rpc("sdp_progress_counts", { p_activity_id: activityId || null });
  const r = Array.isArray(data) ? data[0] : data;
  if (error || !r) return { pending: 0, approved: 0, rejected: 0 };
  return { pending: Number(r.pending ?? 0), approved: Number(r.approved ?? 0), rejected: Number(r.rejected ?? 0) };
}

/** The activities that have progress monitoring, for the filter above the list. */
export async function fetchProgressActivities(): Promise<{ id: string; name: string }[]> {
  const { data: m, error } = await supabase.from("sdp_progress_monitoring").select("activity_id");
  if (error || !m || m.length === 0) return [];
  const { data: acts } = await supabase.from("sdp_activities").select("id, name").in("id", m.map(x => String(x.activity_id)));
  return (acts ?? []).map(a => ({ id: String(a.id), name: String(a.name) })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function approveProgress(id: string): Promise<{ ok: true; credit: string } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("sdp_progress_approve", { p_submission_id: id });
  if (error) return { ok: false, error: progressMissing(error) ? NOT_READY : error.message };
  return { ok: true, credit: String((data as { credit?: string } | null)?.credit ?? "credited") };
}
export async function rejectProgress(id: string, reason: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.rpc("sdp_progress_reject", { p_submission_id: id, p_reason: reason.trim() || null });
  return error ? { ok: false, error: progressMissing(error) ? NOT_READY : error.message } : { ok: true };
}

export async function fetchProgressPictureUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(PROGRESS_BUCKET).createSignedUrl(path, 300);
  return error || !data ? null : data.signedUrl;
}

/** Is progress monitoring attached to this activity? (null = the database update was not run.) */
export async function fetchProgressEnabled(activityId: string): Promise<boolean | null> {
  const { data, error } = await supabase.from("sdp_progress_monitoring").select("activity_id").eq("activity_id", activityId).maybeSingle();
  if (error) return progressMissing(error) ? null : false;
  return !!data;
}
export async function enableProgress(activityId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.rpc("sdp_progress_enable", { p_activity_id: activityId });
  return error ? { ok: false, error: progressMissing(error) ? NOT_READY : error.message } : { ok: true };
}
export async function disableProgress(activityId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.rpc("sdp_progress_disable", { p_activity_id: activityId });
  return error ? { ok: false, error: progressMissing(error) ? NOT_READY : error.message } : { ok: true };
}
/** Does this activity already have QR attendance? (a light check: the session only, not its codes) */
export async function fetchHasQrAttendance(activityId: string): Promise<boolean> {
  const { data } = await supabase.from("attendance_sessions").select("id").eq("sdp_activity_id", activityId).maybeSingle();
  return !!data;
}
/** A link to the place on a map. */
export function mapLink(lat: number, lng: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;
}
