import { supabase } from "@/lib/supabase";
import type { TagResult } from "@/lib/renewalTagging";

/** The calls behind Scholar Renewal > Scholar tagging. The database decides who may tag (it.admin1 and the accounts it appoints); the screen only shows what the database allows. */
type Row = Record<string, unknown>;
const isMissing = (e: { code?: string; message?: string }) => e.code === "PGRST202" || /could not find the function|does not exist/i.test(e.message ?? "");
const str = (v: unknown) => (v == null ? "" : String(v));
type Failed = { ok: false; error: string; missing: boolean };
const failed = (e: { code?: string; message?: string }): Failed => ({ ok: false, error: e.message ?? "Something went wrong.", missing: isMissing(e) });

export interface TagTerm { schoolYear: string; term: string }
export interface TaggedRow {
  scholarIdNumber: string; name: string; school: string; program: string; yearLevel: string; scholarStatus: string; taggedAt: string; taggedByLabel: string;
  recordId: string | null; stage: string | null; renewed: boolean; autoApprove: boolean;
}
export const TAGGED_PAGE_SIZE = 25;

export async function fetchTagTerms(): Promise<{ ok: true; terms: TagTerm[] } | Failed> {
  const { data, error } = await supabase.rpc("renewal_tag_terms");
  if (error) return failed(error);
  return { ok: true, terms: ((data ?? []) as Row[]).map(r => ({ schoolYear: str(r.school_year), term: str(r.term) })) };
}

export async function fetchCanTag(): Promise<boolean> {
  const { data, error } = await supabase.rpc("can_tag_renewed_scholars");
  return !error && data === true;
}

export async function fetchTaggedList(schoolYear: string, term: string, query: string, page: number): Promise<{ ok: true; rows: TaggedRow[]; total: number } | Failed> {
  const { data, error } = await supabase.rpc("renewal_tagged_list", { p_school_year: schoolYear, p_term: term, p_query: query.trim() || null, p_limit: TAGGED_PAGE_SIZE, p_offset: (page - 1) * TAGGED_PAGE_SIZE });
  if (error) return failed(error);
  const list = (data ?? []) as Row[];
  return {
    ok: true, total: list.length ? Number(list[0].total_rows) || 0 : 0,
    rows: list.map(r => ({
      scholarIdNumber: str(r.scholar_id_number), name: str(r.name), school: str(r.school), program: str(r.program), yearLevel: str(r.year_level), scholarStatus: str(r.scholar_status),
      taggedAt: str(r.tagged_at), taggedByLabel: str(r.tagged_by_label), recordId: r.record_id == null ? null : str(r.record_id), stage: r.stage == null ? null : str(r.stage), renewed: r.renewed === true, autoApprove: r.auto_approve === true,
    })),
  };
}

export async function tagScholars(schoolYear: string, term: string, ids: string[], autoApprove = false): Promise<{ ok: true; result: TagResult } | Failed> {
  const { data, error } = await supabase.rpc("renewal_tag_scholars", { p_school_year: schoolYear, p_term: term, p_ids: ids, p_auto_approve: autoApprove });
  if (error) return failed(error);
  const r = (data ?? {}) as Row;
  return { ok: true, result: { tagged: Number(r.tagged) || 0, updated: Number(r.updated) || 0, already: Number(r.already) || 0, notFound: ((r.not_found ?? []) as unknown[]).map(str), skipped: ((r.skipped ?? []) as unknown[]).map(str) } };
}

export async function untagScholars(schoolYear: string, term: string, ids: string[]): Promise<{ ok: true; removed: number } | Failed> {
  const { data, error } = await supabase.rpc("renewal_untag_scholars", { p_school_year: schoolYear, p_term: term, p_ids: ids });
  if (error) return failed(error);
  return { ok: true, removed: Number(data) || 0 };
}
