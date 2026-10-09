// ─────────────────────────────────────────────────────────────
// src/sead/schoolCleanupApi.ts
// CEDO's school clean-up tools: merge schools written in different ways, give scholars with no school one, and make the
// spelling on scholar records match the official school name. Every write is a database function that checks CEDO staff
// access itself (see supabase_migration_standing_cleanup_logins.sql).
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";

type Failure = { ok: false; error: string };

export interface SchoolAlias { id: string; alias: string; schoolId: string; schoolName: string; mergedAt: string }

export async function fetchSchoolAliases(): Promise<{ ok: true; rows: SchoolAlias[] } | Failure> {
  const { data, error } = await supabase.from("school_aliases").select("id, alias, school_id, merged_at, schools(name)").order("alias");
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: (data ?? []).map(r => {
    const row = r as unknown as { id: string; alias: string; school_id: string; merged_at: string; schools: { name?: string } | null };
    return { id: row.id, alias: row.alias, schoolId: row.school_id, schoolName: row.schools?.name ?? "", mergedAt: row.merged_at };
  }) };
}

/** How many (active) scholars are linked to a school — shown before a merge so CEDO knows what will move. */
export async function countScholarsOfSchool(schoolId: string): Promise<number> {
  const { count } = await supabase.from("scholars").select("scholar_id_number", { count: "exact", head: true }).eq("school_id", schoolId).neq("status", "Removed");
  return count ?? 0;
}

export interface MergeResult { scholarsMoved: number; aliasesAdded: number; schoolsRemoved: number; keptName: string }

/** Moves every scholar of the merged schools to the school to keep, keeps the old names as aliases, then removes the duplicates. The database refuses (with the reason) if a duplicate already has a login, submission, correction request or document. */
export async function mergeSchools(keepId: string, mergeIds: string[]): Promise<{ ok: true; result: MergeResult } | Failure> {
  const { data, error } = await supabase.rpc("merge_schools", { p_keep_id: keepId, p_merge_ids: mergeIds });
  if (error) return { ok: false, error: error.message };
  const r = (data ?? {}) as Record<string, unknown>;
  return { ok: true, result: { scholarsMoved: Number(r.scholarsMoved ?? 0), aliasesAdded: Number(r.aliasesAdded ?? 0), schoolsRemoved: Number(r.schoolsRemoved ?? 0), keptName: String(r.keptName ?? "") } };
}

export interface NoSchoolScholar {
  scholarIdNumber: string;
  name: string;
  writtenSchool: string;
  program: string;
  yearLevel: string;
}

/** Scholars (not removed) that are not linked to any school, with whatever school name is written on their record. */
export async function fetchScholarsWithoutSchool(limit: number, offset: number): Promise<{ ok: true; rows: NoSchoolScholar[]; total: number } | Failure> {
  const { data, error, count } = await supabase.from("scholars")
    .select("scholar_id_number, first_name, last_name, middle_name, school, course, year_level", { count: "exact" })
    .is("school_id", null).neq("status", "Removed")
    .order("last_name").order("first_name").order("scholar_id_number")
    .range(offset, offset + limit - 1);
  if (error) return { ok: false, error: error.message };
  return { ok: true, total: count ?? 0, rows: (data ?? []).map(r => {
    const mi = String(r.middle_name ?? "").trim();
    return {
      scholarIdNumber: String(r.scholar_id_number),
      name: [`${r.last_name ?? ""},`, r.first_name ?? "", mi ? `${mi[0]}.` : ""].filter(Boolean).join(" "),
      writtenSchool: String(r.school ?? "").trim(), program: String(r.course ?? ""), yearLevel: String(r.year_level ?? ""),
    };
  }) };
}

export async function assignScholarsSchool(scholarIds: string[], schoolId: string): Promise<{ ok: true; updated: number } | Failure> {
  const { data, error } = await supabase.rpc("assign_scholars_school", { p_scholar_ids: scholarIds, p_school_id: schoolId });
  if (error) return { ok: false, error: error.message };
  return { ok: true, updated: Number(data ?? 0) };
}

export interface SpellingVariant { schoolName: string; variant: string; scholars: number }

/** Scholar records whose written school differs from the official name of the school they are linked to. */
export async function fetchSpellingVariants(): Promise<{ ok: true; rows: SpellingVariant[] } | Failure> {
  const { data, error } = await supabase.rpc("scholar_school_spelling_variants");
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: (data as Record<string, unknown>[] ?? []).map(r => ({ schoolName: String(r.school_name), variant: String(r.variant ?? ""), scholars: Number(r.scholars) })) };
}

/** Rewrites each linked scholar's written school as the official name. Only the spelling of that one field changes. */
export async function standardizeSchoolNames(): Promise<{ ok: true; updated: number } | Failure> {
  const { data, error } = await supabase.rpc("standardize_scholar_school_names");
  if (error) return { ok: false, error: error.message };
  return { ok: true, updated: Number(data ?? 0) };
}
