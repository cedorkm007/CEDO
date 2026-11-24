// ─────────────────────────────────────────────────────────────
// src/sead/academicBulkApi.ts
// The calls behind "Set by file" in Scholar Management Tools > Scholars > Grades and Academic Management (supabase_migration_academic_scholar_overrides.sql). The database checks every row (again when it is saved),
// matches the scholars by Scholar ID only, and decides who may do this (the Scholar Management staff); these calls just ask.
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";
import type { AcademicBulkChecked, AcademicBulkRow } from "@/lib/academicBulk";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));
const strOrNull = (v: unknown) => (v == null ? null : String(v));
const isMissing = (e: { code?: string; message?: string }) => e.code === "PGRST202" || /could not find the function|does not exist/i.test(e.message ?? "");
export type BulkFailed = { ok: false; error: string; missing: boolean };
const failed = (e: { code?: string; message?: string }): BulkFailed => ({ ok: false, error: e.message ?? "Something went wrong.", missing: isMissing(e) });
const payload = (rows: AcademicBulkRow[]) => rows.map(r => ({ i: r.i, scholar_id: r.scholar_id, name: r.name, school: r.school, program: r.program, status: r.status }));

/** STEP 1: the database checks every row and saves NOTHING. */
export async function checkAcademicBulk(rows: AcademicBulkRow[]): Promise<{ ok: true; rows: AcademicBulkChecked[] } | BulkFailed> {
  const { data, error } = await supabase.rpc("academic_bulk_check", { p_rows: payload(rows) });
  if (error) return failed(error);
  const list = (((data ?? {}) as Row).rows ?? []) as Row[];
  return {
    ok: true,
    rows: list.map(e => ({
      i: Number(e.i), state: (str(e.state) || "error") as AcademicBulkChecked["state"], action: (str(e.action) || "none") as AcademicBulkChecked["action"], messages: ((e.messages ?? []) as unknown[]).map(String),
      scholarId: strOrNull(e.scholar_id), name: strOrNull(e.name), school: strOrNull(e.school), program: strOrNull(e.program), programStatus: strOrNull(e.program_status), currentStatus: strOrNull(e.current_status), newStatus: strOrNull(e.new_status),
    })),
  };
}

export interface AcademicSaveResult { i: number; outcome: "set" | "reset" | "skipped" | "error"; message: string | null }
/** STEP 2: the rows are checked again and the own status is set or taken away. */
export async function saveAcademicBulk(rows: AcademicBulkRow[]): Promise<{ ok: true; set: number; reset: number; skipped: number; errors: number; results: AcademicSaveResult[] } | BulkFailed> {
  const { data, error } = await supabase.rpc("academic_bulk_save", { p_rows: payload(rows) });
  if (error) return failed(error);
  const r = (data ?? {}) as Row;
  return { ok: true, set: Number(r.set ?? 0), reset: Number(r.reset ?? 0), skipped: Number(r.skipped ?? 0), errors: Number(r.errors ?? 0), results: ((r.results ?? []) as Row[]).map(x => ({ i: Number(x.i), outcome: str(x.outcome) as AcademicSaveResult["outcome"], message: strOrNull(x.message) })) };
}

export interface AcademicOverrideRow { scholarId: string; name: string; school: string; program: string; status: string; programStatus: string }
/** Everyone who has an own academic status now. */
export async function fetchAcademicOverrides(): Promise<{ ok: true; rows: AcademicOverrideRow[] } | BulkFailed> {
  const { data, error } = await supabase.rpc("academic_overrides_list");
  if (error) return failed(error);
  return { ok: true, rows: ((data ?? []) as Row[]).map(r => ({ scholarId: str(r.scholar_id_number), name: str(r.name), school: str(r.school), program: str(r.program), status: str(r.academic_status), programStatus: str(r.program_status) })) };
}
