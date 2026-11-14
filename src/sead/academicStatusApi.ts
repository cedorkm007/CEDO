// ─────────────────────────────────────────────────────────────
// src/sead/academicStatusApi.ts
// The calls behind Scholar Management Tools > Scholars > "Grades and Academic Management": the passing GWAs, the programs and their academic status, and the status map for the Information list.
// Who may do what is decided by the database (supabase_migration_academic_status.sql); these calls just ask.
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";
import type { AcademicStatus } from "@/lib/academicStatus";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));
const numOrNull = (v: unknown) => (v == null ? null : Number(v));
const isMissing = (e: { code?: string; message?: string }) => e.code === "PGRST202" || /could not find the function|does not exist/i.test(e.message ?? "");
export type Done = { ok: true } | { ok: false; error: string };

export interface AcademicProgramRow { key: string; program: string; scholars: number; status: AcademicStatus | null; specialPassingGwa: number | null }
export interface AcademicSettings {
  academicPassingGwa: number | null; nonAcademicPassingGwa: number | null; updatedAt: string | null;
  programs: AcademicProgramRow[];
  schoolsNotStandard: { school: string; scholars: number; scale: string }[];
}

export async function fetchAcademicSettings(): Promise<{ ok: true; settings: AcademicSettings } | { ok: false; error: string; missing: boolean }> {
  const { data, error } = await supabase.rpc("academic_settings_get");
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't load the settings.", missing: !!error && isMissing(error) };
  const d = data as Row;
  return {
    ok: true,
    settings: {
      academicPassingGwa: numOrNull(d.academic_passing_gwa), nonAcademicPassingGwa: numOrNull(d.non_academic_passing_gwa), updatedAt: d.updated_at == null ? null : str(d.updated_at),
      programs: ((d.programs ?? []) as Row[]).map(p => ({ key: str(p.key), program: str(p.program), scholars: Number(p.scholars ?? 0), status: (p.academic_status == null ? null : str(p.academic_status)) as AcademicStatus | null, specialPassingGwa: numOrNull(p.special_passing_gwa) })),
      schoolsNotStandard: ((d.schools_not_standard ?? []) as Row[]).map(s => ({ school: str(s.school), scholars: Number(s.scholars ?? 0), scale: str(s.scale) })),
    },
  };
}

export async function saveAcademicPassingGwa(academic: number | null, nonAcademic: number | null): Promise<Done> {
  const { error } = await supabase.rpc("academic_settings_save", { p_academic: academic, p_non_academic: nonAcademic });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** status null = take the program out (it is "not set" again). special = the program's own passing GWA, or null. */
export async function saveAcademicProgram(program: string, status: AcademicStatus | null, special: number | null): Promise<Done> {
  const { error } = await supabase.rpc("academic_program_save", { p_program: program, p_status: status, p_special: special });
  return error ? { ok: false, error: error.message } : { ok: true };
}

let cache: { at: number; map: Map<string, AcademicStatus> } | null = null;
/** program key -> status, for the Information list (kept for a minute). When the database update is not run yet the map is empty. */
export async function fetchAcademicStatusMap(): Promise<Map<string, AcademicStatus>> {
  if (cache && Date.now() - cache.at < 60_000) return cache.map;
  const { data, error } = await supabase.rpc("academic_status_map");
  const map = new Map<string, AcademicStatus>();
  if (!error) for (const r of (data ?? []) as Row[]) map.set(str(r.program_key), str(r.academic_status) as AcademicStatus);
  cache = { at: Date.now(), map };
  return map;
}
export const forgetAcademicStatusMap = () => { cache = null; };
