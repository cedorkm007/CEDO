// ─────────────────────────────────────────────────────────────
// src/sead/sdpReconsiderationApi.ts
// The staff side of SDP reconsideration requests (Scholar Renewal > SDP Reconsideration). Who may decide is checked by the database (it.admin1 and the accounts he gives the
// tag "SDP Reconsideration Approver"); the renewal evaluator and consultation staff can only read. See supabase_migration_sdp_reconsideration_c_renewal.sql.
// `missing: true` = that database update has not been run yet.
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";
import type { SdpReconsiderationStatus } from "@/lib/renewal";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));
const strOrNull = (v: unknown) => (v == null ? null : String(v));
const num = (v: unknown) => (v == null ? 0 : Number(v));
const isMissing = (e: { code?: string; message?: string }) => e.code === "PGRST202" || /could not find the function|does not exist/i.test(e.message ?? "");
type Failed = { ok: false; error: string; missing: boolean };
const failed = (e: { code?: string; message?: string }): Failed => ({ ok: false, error: e.message ?? "Something went wrong.", missing: isMissing(e) });

export const SDP_RECONSIDERATION_PAGE_SIZE = 20;
export type SdpReconsiderationFilter = "pending" | "approved" | "denied" | "all";

export interface SdpReconsiderationPrevious { schoolYear: string; term: string; status: SdpReconsiderationStatus; lacking: Record<string, number>; decidedAt: string | null }
export interface SdpReconsiderationRow {
  id: string; scholarIdNumber: string; name: string; school: string; program: string; yearLevel: string; scholarStatus: string;
  schoolYear: string; term: string; basisSchoolYear: string; basisTerm: string; status: SdpReconsiderationStatus; lacking: Record<string, number>;
  requestedAt: string; decidedAt: string | null; decidedByLabel: string | null; decisionNote: string; recordId: string | null;
  previous: SdpReconsiderationPrevious[]; nextSchoolYear: string; nextSemester: string; canDecide: boolean;
  /** Where the scholar's grades stand: school (uploaded by the school), approved, pending, returned, none. null before supabase_migration_entered_grades_d_apply_flow.sql is run (then nothing is held back). */
  gradesStatus: string | null; gradesComplete: boolean | null;
}

/** Why a request cannot be approved yet, or null when it can (the grades are complete, or the database update that checks this is not installed). */
export function sdpApprovalBlockedText(r: Pick<SdpReconsiderationRow, "gradesStatus" | "gradesComplete">): string | null {
  if (r.gradesComplete !== false) return null;
  const why: Record<string, string> = { pending: "The scholar's entered grades are still waiting for the Grades Approver.", returned: "The Grades Approver returned the scholar's grades and they have not been corrected yet.", none: "The scholar has not entered grades and the school has not uploaded them." };
  return `Cannot be approved yet: ${why[r.gradesStatus ?? "none"] ?? why.none} You can still deny the request.`;
}

const lackingOf = (v: unknown): Record<string, number> => Object.fromEntries(Object.entries((v ?? {}) as Row).map(([k, n]) => [k, num(n)]));

export async function fetchSdpReconsiderations(filter: SdpReconsiderationFilter, query: string, page: number): Promise<{ ok: true; rows: SdpReconsiderationRow[]; total: number } | Failed> {
  const { data, error } = await supabase.rpc("sdp_reconsideration_list", { p_status: filter, p_query: query.trim() || null, p_limit: SDP_RECONSIDERATION_PAGE_SIZE, p_offset: (page - 1) * SDP_RECONSIDERATION_PAGE_SIZE });
  if (error) return failed(error);
  const list = (data ?? []) as Row[];
  return {
    ok: true, total: list.length ? num(list[0].total_rows) : 0,
    rows: list.map(r => ({
      id: str(r.id), scholarIdNumber: str(r.scholar_id_number), name: str(r.name), school: str(r.school), program: str(r.program), yearLevel: str(r.year_level), scholarStatus: str(r.scholar_status),
      schoolYear: str(r.school_year), term: str(r.term), basisSchoolYear: str(r.basis_school_year), basisTerm: str(r.basis_term), status: str(r.status) as SdpReconsiderationStatus, lacking: lackingOf(r.lacking),
      requestedAt: str(r.requested_at), decidedAt: strOrNull(r.decided_at), decidedByLabel: strOrNull(r.decided_by_label), decisionNote: str(r.decision_note), recordId: strOrNull(r.record_id),
      previous: ((r.previous ?? []) as Row[]).map(p => ({ schoolYear: str(p.school_year), term: str(p.term), status: str(p.status) as SdpReconsiderationStatus, lacking: lackingOf(p.lacking), decidedAt: strOrNull(p.decided_at) })),
      nextSchoolYear: str(r.next_school_year), nextSemester: str(r.next_semester), canDecide: !!r.can_decide,
      gradesStatus: r.grades_status == null ? null : str(r.grades_status), gradesComplete: r.grades_complete == null ? null : !!r.grades_complete,
    })),
  };
}

export interface SdpReconsiderationCounts { pending: number; approved: number; denied: number; canDecide: boolean }
export async function fetchSdpReconsiderationCounts(): Promise<{ ok: true; counts: SdpReconsiderationCounts } | Failed> {
  const { data, error } = await supabase.rpc("sdp_reconsideration_counts");
  if (error) return failed(error);
  const r = (((data ?? []) as Row[])[0] ?? {}) as Row;
  return { ok: true, counts: { pending: num(r.pending), approved: num(r.approved), denied: num(r.denied), canDecide: !!r.can_decide } };
}

/** Approve or deny. A denial needs a reason (the database checks it too). Returns "approved", "denied" or "not_needed" (the credits became complete before the decision). */
export async function decideSdpReconsideration(id: string, approve: boolean, note: string): Promise<{ ok: true; result: string } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("renewal_sdp_reconsideration_decide", { p_request_id: id, p_approve: approve, p_note: note });
  return error ? { ok: false, error: error.message } : { ok: true, result: str(data) };
}
