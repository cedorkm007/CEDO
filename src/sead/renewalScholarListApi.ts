// ─────────────────────────────────────────────────────────────
// src/sead/renewalScholarListApi.ts
// Scholar Renewal > Scholar List. The numbers are worked out by the database (supabase_migration_renewal_scholar_list.sql) with the same renewal check an application uses;
// these calls just ask. `missing: true` = that database update has not been run yet (the tab then says so).
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";
import type { ScholarEligibility } from "@/lib/renewal";
import type { ScholarActionFacts } from "@/lib/renewalActions";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));
const strOrNull = (v: unknown) => (v == null ? null : String(v));
const num = (v: unknown) => (v == null ? 0 : Number(v));
const isMissing = (e: { code?: string; message?: string }) => e.code === "PGRST202" || /could not find the function|does not exist/i.test(e.message ?? "");

export const SCHOLAR_LIST_PAGE_SIZE = 25;

export interface ScholarListFilters { query: string; schoolIds: string[]; yearLevels: string[]; programs: string[]; eligibility: ScholarEligibility[] }
export const EMPTY_SCHOLAR_LIST_FILTERS: ScholarListFilters = { query: "", schoolIds: [], yearLevels: [], programs: [], eligibility: [] };

export interface ScholarListRow {
  scholarIdNumber: string; name: string; status: string; schoolId: string | null; school: string; yearLevel: string; program: string;
  sdpApplicable: boolean; sdpComplied: boolean | null; sdpMissing: string | null;
  /** The scholar's SDP reconsideration request for the term: pending | approved | denied | not_needed, or null (needs the SDP reconsideration database update). */
  sdpReconsideration: string | null;
  gradesState: string | null; graded: number; total: number; failed: number; drp: number; inc: number; review: number;
  eligibility: ScholarEligibility[]; computedAt: string | null;
}
export interface ScholarListMatrixRow { schoolId: string | null; school: string; ready: number; consultation: number; sdpReconsideration: number; waiting: number; review: number; total: number }
export interface ScholarListOptions { schools: { id: string | null; name: string }[]; yearLevels: string[]; programs: string[]; scholars: number; checked: number; lastChecked: string | null }
export interface ScholarSdpCredits {
  basisSchoolYear: string; basisTerm: string; required: number;
  sdp: { applicable: boolean; complied: boolean | null; missing: string | null; communityService: number; communityVolunteerism: number; formationProgram: number;
    /** What each category needs for this semester (3, plus credits owed); empty before the SDP reconsideration database update. */
    required: Record<string, number>; byReconsideration: boolean; reconsideration: { status: string; note: string | null; decidedAt: string | null } | null };
  credits: { activity: string; category: string | null; credits: number; attendedDate: string | null; activityDay: string | null }[];
  reserved: { category: string; amount: number; fromSchoolYear: string | null; fromSemester: string | null; claimed: boolean }[];
}

type Failed = { ok: false; error: string; missing: boolean };
const failed = (e: { code?: string; message?: string }): Failed => ({ ok: false, error: e.message ?? "Something went wrong.", missing: isMissing(e) });
const filterArgs = (f: ScholarListFilters) => ({ p_query: f.query.trim() || null, p_schools: f.schoolIds.length ? f.schoolIds : null, p_year_levels: f.yearLevels.length ? f.yearLevels : null, p_programs: f.programs.length ? f.programs : null });

export async function fetchScholarList(schoolYear: string, term: string, f: ScholarListFilters, page: number): Promise<{ ok: true; rows: ScholarListRow[]; total: number } | Failed> {
  const { data, error } = await supabase.rpc("renewal_scholar_list", {
    p_school_year: schoolYear, p_term: term, ...filterArgs(f), p_eligibility: f.eligibility.length ? f.eligibility : null, p_limit: SCHOLAR_LIST_PAGE_SIZE, p_offset: (page - 1) * SCHOLAR_LIST_PAGE_SIZE,
  });
  if (error) return failed(error);
  const list = (data ?? []) as Row[];
  return {
    ok: true, total: list.length ? num(list[0].total_rows) : 0,
    rows: list.map(r => ({
      scholarIdNumber: str(r.scholar_id_number), name: str(r.name), status: str(r.scholar_status), schoolId: strOrNull(r.school_id), school: str(r.school), yearLevel: str(r.year_level), program: str(r.program),
      sdpApplicable: r.sdp_applicable == null ? true : !!r.sdp_applicable, sdpComplied: r.sdp_complied == null ? null : !!r.sdp_complied, sdpMissing: strOrNull(r.sdp_missing), sdpReconsideration: strOrNull(r.sdp_reconsideration),
      gradesState: strOrNull(r.grades_state), graded: num(r.graded), total: num(r.total), failed: num(r.failed), drp: num(r.drp), inc: num(r.inc), review: num(r.review),
      eligibility: ((r.eligibility ?? []) as string[]) as ScholarEligibility[], computedAt: strOrNull(r.computed_at),
    })),
  };
}

/** Where the scholars of one page of the list stand (application, grades, referrals), for the Action needed and Renewal status columns. `missing: true` = supabase_migration_renewal_actions_needed.sql has not been run yet. */
export async function fetchScholarActions(schoolYear: string, term: string, ids: string[]): Promise<{ ok: true; facts: Record<string, ScholarActionFacts> } | Failed> {
  if (ids.length === 0) return { ok: true, facts: {} };
  const { data, error } = await supabase.rpc("renewal_scholar_actions", { p_school_year: schoolYear, p_term: term, p_ids: ids });
  if (error) return failed(error);
  const facts: Record<string, ScholarActionFacts> = {};
  for (const r of (data ?? []) as Row[]) {
    facts[str(r.scholar_id_number)] = {
      recordId: strOrNull(r.record_id), stage: strOrNull(r.stage), isLate: !!r.is_late, appliedAt: strOrNull(r.applied_at), docsToReview: num(r.docs_to_review),
      consultationRequired: !!r.consultation_required, consultationDoneAt: strOrNull(r.consultation_done_at), nextConsultation: strOrNull(r.next_consultation),
      gradesStatus: str(r.grades_status) || "none", dhReferralId: strOrNull(r.dh_referral_id), dhStatus: strOrNull(r.dh_status), referralStatus: strOrNull(r.referral_status),
    };
  }
  return { ok: true, facts };
}

export async function fetchScholarListMatrix(schoolYear: string, term: string, f: ScholarListFilters): Promise<{ ok: true; rows: ScholarListMatrixRow[] } | Failed> {
  const { data, error } = await supabase.rpc("renewal_scholar_list_matrix", { p_school_year: schoolYear, p_term: term, ...filterArgs(f) });
  if (error) return failed(error);
  return { ok: true, rows: ((data ?? []) as Row[]).map(r => ({ schoolId: strOrNull(r.school_id), school: str(r.school), ready: num(r.ready), consultation: num(r.consultation), sdpReconsideration: num(r.sdp_reconsideration), waiting: num(r.waiting), review: num(r.review), total: num(r.total) })) };
}

export async function fetchScholarListOptions(schoolYear: string, term: string): Promise<{ ok: true; options: ScholarListOptions } | Failed> {
  const { data, error } = await supabase.rpc("renewal_scholar_list_options", { p_school_year: schoolYear, p_term: term });
  if (error) return failed(error);
  const o = (data ?? {}) as Row;
  return {
    ok: true,
    options: {
      schools: ((o.schools ?? []) as Row[]).map(s => ({ id: strOrNull(s.id), name: str(s.name) })), yearLevels: ((o.year_levels ?? []) as string[]).map(String), programs: ((o.programs ?? []) as string[]).map(String),
      scholars: num(o.scholars), checked: num(o.checked), lastChecked: strOrNull(o.last_checked),
    },
  };
}

/** One step of "check everybody again" (the database does up to `limit` scholars per step). The first step passes no `since`; the database's own clock then marks the start of the round and returns it, and
 *  the steps after it hand it back, until `remaining` is 0. */
export async function refreshScholarListStep(schoolYear: string, term: string, since: string | null, limit = 100): Promise<{ ok: true; done: number; remaining: number; total: number; since: string } | Failed> {
  const { data, error } = await supabase.rpc("renewal_scholar_list_refresh", { p_school_year: schoolYear, p_term: term, p_since: since, p_limit: limit });
  if (error) return failed(error);
  const r = ((data ?? []) as Row[])[0] ?? {};
  return { ok: true, done: num(r.done), remaining: num(r.remaining), total: num(r.total), since: str(r.since) };
}

export async function fetchScholarSdpCredits(scholarIdNumber: string, schoolYear: string, term: string): Promise<{ ok: true; credits: ScholarSdpCredits } | Failed> {
  const { data, error } = await supabase.rpc("renewal_scholar_sdp_credits", { p_scholar_id_number: scholarIdNumber, p_school_year: schoolYear, p_term: term });
  if (error) return failed(error);
  const d = (data ?? {}) as Row;
  const s = (d.sdp ?? {}) as Row;
  return {
    ok: true,
    credits: {
      basisSchoolYear: str(d.basis_school_year), basisTerm: str(d.basis_term), required: num(d.required),
      sdp: { applicable: s.applicable == null ? true : !!s.applicable, complied: s.complied == null ? null : !!s.complied, missing: strOrNull(s.missing), communityService: num(s.community_service), communityVolunteerism: num(s.community_volunteerism), formationProgram: num(s.formation_program),
        required: Object.fromEntries(Object.entries((s.required ?? {}) as Row).map(([k, n]) => [k, num(n)])), byReconsideration: !!s.by_reconsideration,
        reconsideration: s.reconsideration ? { status: str((s.reconsideration as Row).status), note: strOrNull((s.reconsideration as Row).note), decidedAt: strOrNull((s.reconsideration as Row).decided_at) } : null },
      credits: ((d.credits ?? []) as Row[]).map(c => ({ activity: str(c.activity), category: strOrNull(c.category), credits: num(c.credits), attendedDate: strOrNull(c.attended_date), activityDay: strOrNull(c.activity_day) })),
      reserved: ((d.reserved ?? []) as Row[]).map(c => ({ category: str(c.category), amount: num(c.amount), fromSchoolYear: strOrNull(c.from_school_year), fromSemester: strOrNull(c.from_semester), claimed: !!c.claimed })),
    },
  };
}
