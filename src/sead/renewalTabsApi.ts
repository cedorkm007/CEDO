// ─────────────────────────────────────────────────────────────
// src/sead/renewalTabsApi.ts
// Scholar Renewal > Applications / Renewed / Not applied. The lists and their numbers are worked out by the database (supabase_migration_renewal_tabs.sql); these calls just ask.
// `missing: true` = that database update has not been run yet (the tab then says so).
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";
import type { ScholarEligibility } from "@/lib/renewal";
import type { RenewalListTab, RenewalSubTab } from "@/lib/renewalTabs";
import type { ScholarListRow } from "./renewalScholarListApi";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));
const strOrNull = (v: unknown) => (v == null ? null : String(v));
const num = (v: unknown) => (v == null ? 0 : Number(v));
const isMissing = (e: { code?: string; message?: string }) => e.code === "PGRST202" || /could not find the function|does not exist/i.test(e.message ?? "");

export const RENEWAL_LIST_PAGE_SIZE = 25;

export interface RenewalListFilters {
  query: string; schoolIds: string[]; yearLevels: string[]; programs: string[]; statuses: string[];
  /** complied | not_complied | null */ sdp: string | null;
  /** in | not_in | null */ grades: string | null;
}
export const EMPTY_RENEWAL_LIST_FILTERS: RenewalListFilters = { query: "", schoolIds: [], yearLevels: [], programs: [], statuses: [], sdp: null, grades: null };

/** A row of one of the three lists: the Scholar List's row, plus the application and (Renewed) the status before and after. */
export interface RenewalListRow extends ScholarListRow { recordId: string | null; stage: string | null; isLate: boolean; fromStatus: string | null; toStatus: string | null; sub: RenewalSubTab }
export interface RenewalListOptions { schools: { id: string | null; name: string }[]; yearLevels: string[]; programs: string[]; statuses: string[]; scholars: number; checked: number; lastChecked: string | null }

type Failed = { ok: false; error: string; missing: boolean };
const failed = (e: { code?: string; message?: string }): Failed => ({ ok: false, error: e.message ?? "Something went wrong.", missing: isMissing(e) });
const filterArgs = (f: RenewalListFilters) => ({
  p_query: f.query.trim() || null, p_schools: f.schoolIds.length ? f.schoolIds : null, p_year_levels: f.yearLevels.length ? f.yearLevels : null,
  p_programs: f.programs.length ? f.programs : null, p_statuses: f.statuses.length ? f.statuses : null, p_sdp: f.sdp, p_grades: f.grades,
});

export async function fetchRenewalList(schoolYear: string, term: string, tab: RenewalListTab, sub: RenewalSubTab, f: RenewalListFilters, page: number): Promise<{ ok: true; rows: RenewalListRow[]; total: number } | Failed> {
  const { data, error } = await supabase.rpc("renewal_tab_list", {
    p_school_year: schoolYear, p_term: term, p_tab: tab, p_sub: sub, ...filterArgs(f), p_limit: RENEWAL_LIST_PAGE_SIZE, p_offset: (page - 1) * RENEWAL_LIST_PAGE_SIZE,
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
      recordId: strOrNull(r.record_id), stage: strOrNull(r.stage), isLate: !!r.is_late, fromStatus: strOrNull(r.from_status), toStatus: strOrNull(r.to_status), sub: str(r.sub) as RenewalSubTab,
    })),
  };
}

/** The number of scholars on each sub-tab of a list (with the same filters). */
export async function fetchRenewalListCounts(schoolYear: string, term: string, tab: RenewalListTab, f: RenewalListFilters): Promise<{ ok: true; counts: Partial<Record<RenewalSubTab, number>> } | Failed> {
  const { data, error } = await supabase.rpc("renewal_tab_counts", { p_school_year: schoolYear, p_term: term, p_tab: tab, ...filterArgs(f) });
  if (error) return failed(error);
  const counts: Partial<Record<RenewalSubTab, number>> = {};
  for (const r of (data ?? []) as Row[]) counts[str(r.sub) as RenewalSubTab] = num(r.n);
  return { ok: true, counts };
}

export async function fetchRenewalListOptions(schoolYear: string, term: string): Promise<{ ok: true; options: RenewalListOptions } | Failed> {
  const { data, error } = await supabase.rpc("renewal_tab_options", { p_school_year: schoolYear, p_term: term });
  if (error) return failed(error);
  const o = (data ?? {}) as Row;
  return {
    ok: true,
    options: {
      schools: ((o.schools ?? []) as Row[]).map(s => ({ id: strOrNull(s.id), name: str(s.name) })), yearLevels: ((o.year_levels ?? []) as string[]).map(String), programs: ((o.programs ?? []) as string[]).map(String),
      statuses: ((o.statuses ?? []) as string[]).map(String), scholars: num(o.scholars), checked: num(o.checked), lastChecked: strOrNull(o.last_checked),
    },
  };
}
