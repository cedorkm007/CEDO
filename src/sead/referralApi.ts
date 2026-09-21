import { supabase } from "@/lib/supabase";

export interface SubjectMatrixRow {
  subjectCode: string;
  semesterAcademicYear: string;
  yearLevel: string;
}

export type PreviousSemesterStatus = "Retained" | "On Probation" | "Special Recon";
export const PREVIOUS_SEMESTER_STATUSES: PreviousSemesterStatus[] = ["Retained", "On Probation", "Special Recon"];

export type EndorsedFor = "On Probation Status" | "Removal" | "Renewal";
export const ENDORSED_FOR_OPTIONS: EndorsedFor[] = ["On Probation Status", "Removal", "Renewal"];

export type ReferralStatus = "pending" | "forwarded_to_division_head" | "reconsideration_requested" | "approved";

export interface StaffOption {
  id: string;
  name: string;
}

/** For the "Refer to" dropdown — every staff member tagged for the Scholar Counseling Tool. */
export async function fetchCounselingStaffOptions(): Promise<StaffOption[]> {
  const { data, error } = await supabase.rpc("list_scholar_counseling_staff");
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(r => ({ id: String(r.id), name: String(r.name ?? "") }));
}

export interface NewReferralInput {
  scholarIdNumber: string;
  referredTo: string;
  previousSemesterStatus: PreviousSemesterStatus;
  failedSubjects: SubjectMatrixRow[];
  lackingGrades: SubjectMatrixRow[];
  endorsedFor: EndorsedFor;
}

export async function createReferral(input: NewReferralInput): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc("create_scholar_counseling_referral", {
    p_scholar_id_number: input.scholarIdNumber,
    p_referred_to: input.referredTo,
    p_previous_semester_status: input.previousSemesterStatus,
    p_failed_subjects: input.failedSubjects,
    p_lacking_grades: input.lackingGrades,
    p_endorsed_for: input.endorsedFor,
    // Computed client-side in Asia/Manila time rather than left to the
    // RPC's own `current_date` default, which runs in the DB session's
    // (UTC) timezone — before 8am Philippine time that's still
    // "yesterday" in UTC, one day behind what the referring staff sees.
    p_referral_date: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }),
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export interface OpenReferralInfo {
  id: string;
  status: ReferralStatus;
}

/** Open (not-yet-approved) referral per scholar — used to render "Refer"/"Referred" on Scholars Information. */
export async function fetchOpenReferralStatuses(scholarIdNumbers: string[]): Promise<Map<string, OpenReferralInfo>> {
  const map = new Map<string, OpenReferralInfo>();
  if (scholarIdNumbers.length === 0) return map;
  const { data, error } = await supabase.from("scholar_counseling_referrals")
    .select("id, scholar_id_number, status").in("scholar_id_number", scholarIdNumbers).neq("status", "approved");
  if (error || !data) return map;
  for (const r of data as { id: string; scholar_id_number: string; status: ReferralStatus }[]) map.set(r.scholar_id_number, { id: r.id, status: r.status });
  return map;
}

export interface QueuedReferral {
  id: string;
  scholarIdNumber: string;
  name: string;
  course: string;
  yearLevel: string;
  school: string;
  barangay: string;
  contactNo: string;
  previousSemesterStatus: PreviousSemesterStatus;
  failedSubjects: SubjectMatrixRow[];
  lackingGrades: SubjectMatrixRow[];
  endorsedFor: EndorsedFor;
  remarks: string;
  status: ReferralStatus;
  referredByName: string;
  referralDate: string;
  reconsiderationReason: string | null;
  createdAt: string;
}

function rowToQueuedReferral(r: Record<string, unknown>): QueuedReferral {
  return {
    id: String(r.id),
    scholarIdNumber: String(r.scholar_id_number),
    name: String(r.name ?? ""),
    course: String(r.course ?? ""),
    yearLevel: String(r.year_level ?? ""),
    school: String(r.school ?? ""),
    barangay: String(r.barangay ?? ""),
    contactNo: String(r.contact_no ?? ""),
    previousSemesterStatus: r.previous_semester_status as PreviousSemesterStatus,
    failedSubjects: (r.failed_subjects as SubjectMatrixRow[] | null) ?? [],
    lackingGrades: (r.lacking_grades as SubjectMatrixRow[] | null) ?? [],
    endorsedFor: r.endorsed_for as EndorsedFor,
    remarks: String(r.remarks ?? ""),
    status: r.status as ReferralStatus,
    referredByName: String(r.referred_by_name ?? ""),
    referralDate: String(r.referral_date ?? ""),
    reconsiderationReason: (r.reconsideration_reason as string | null) ?? null,
    createdAt: String(r.created_at ?? ""),
  };
}

/** The signed-in counseling staff's own queue — oldest first (FIFO); only the first entry should be actionable in the UI. */
export async function fetchReferralQueue(): Promise<QueuedReferral[]> {
  const { data, error } = await supabase.rpc("scholar_counseling_queue");
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(rowToQueuedReferral);
}

export async function forwardReferralToDivisionHead(
  referralId: string, remarks: string, endorsedFor: EndorsedFor,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc("forward_referral_to_division_head", {
    p_referral_id: referralId, p_remarks: remarks, p_endorsed_for: endorsedFor,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function requestReferralReconsideration(referralId: string, reason: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc("request_referral_reconsideration", { p_referral_id: referralId, p_reason: reason });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function approveReferral(referralId: string, signaturePath: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc("approve_referral", { p_referral_id: referralId, p_signature_path: signaturePath });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * One referral by id — used to render the read-only "view" mode and the
 * Division Head's approval panel. A dedicated RPC (rather than a
 * PostgREST embedded select across scholars/users) since this app avoids
 * relying on cross-table embed RLS for arbitrary staff — see
 * get_scholar_counseling_referral() (supabase_migration_scholar_counseling_referrals.sql).
 */
export async function fetchReferralById(referralId: string): Promise<QueuedReferral | null> {
  const { data, error } = await supabase.rpc("get_scholar_counseling_referral", { p_referral_id: referralId }).maybeSingle();
  if (error || !data) return null;
  return rowToQueuedReferral(data as Record<string, unknown>);
}

export interface DashboardSummary {
  ksbClientCount: number;
  homeVisitedCount: number;
  probationaryCount: number;
  onLeaveCount: number;
  reconsideredCount: number;
  removedCount: number;
  pendingCount: number;
  reconsiderationCount: number;
  monthLabel: string;
  clientsServedThisMonth: number;
}

export async function fetchDashboardSummary(): Promise<DashboardSummary | null> {
  const { data, error } = await supabase.rpc("scholar_counseling_dashboard_summary").maybeSingle();
  if (error || !data) return null;
  const r = data as Record<string, unknown>;
  return {
    ksbClientCount: Number(r.ksb_client_count ?? 0),
    homeVisitedCount: Number(r.home_visited_count ?? 0),
    probationaryCount: Number(r.probationary_count ?? 0),
    onLeaveCount: Number(r.on_leave_count ?? 0),
    reconsideredCount: Number(r.reconsidered_count ?? 0),
    removedCount: Number(r.removed_count ?? 0),
    pendingCount: Number(r.pending_count ?? 0),
    reconsiderationCount: Number(r.reconsideration_count ?? 0),
    monthLabel: String(r.month_label ?? ""),
    clientsServedThisMonth: Number(r.clients_served_this_month ?? 0),
  };
}

/** The signed-in staff member's own display name — for the read-only "Refer by" field. */
export async function fetchMyStaffName(): Promise<string> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return "";
  const { data } = await supabase.from("users").select("first_name, last_name").eq("id", auth.user.id).maybeSingle();
  if (!data) return "";
  return `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim();
}

// ── Signatures ──────────────────────────────────────────────────────

const SIGNATURES_BUCKET = "staff-signatures";

export async function fetchMySignaturePath(): Promise<string | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data, error } = await supabase.from("staff_signatures").select("storage_path").eq("staff_id", auth.user.id).maybeSingle();
  if (error || !data) return null;
  return data.storage_path as string;
}

/** Signed URL for a private signature file (5 min) — the bucket is private since a signature is sensitive. */
export async function fetchSignatureUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(SIGNATURES_BUCKET).createSignedUrl(path, 300);
  if (error || !data) return null;
  return data.signedUrl;
}

/** Uploads a processed (transparent-background) signature PNG and records it for reuse. */
export async function uploadSignature(blob: Blob): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "Not signed in." };
  const path = `${auth.user.id}/signature.png`;
  const { error: uploadError } = await supabase.storage.from(SIGNATURES_BUCKET)
    .upload(path, blob, { contentType: "image/png", upsert: true });
  if (uploadError) return { ok: false, error: uploadError.message };
  const { error: rpcError } = await supabase.rpc("upsert_staff_signature", { p_storage_path: path });
  if (rpcError) return { ok: false, error: rpcError.message };
  return { ok: true, path };
}
