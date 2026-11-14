// ─────────────────────────────────────────────────────────────
// src/sead/academicStatusApi.ts
// The calls behind Scholar Management Tools > Scholars > "Grades and Academic Management": the schools, the passing GWA of a school, its programs and their academic status, and the status map for the Information list.
// Who may do what is decided by the database (supabase_migration_academic_per_school.sql); these calls just ask.
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";
import { academicStatusKey, type AcademicStatus, type GwaScale } from "@/lib/academicStatus";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));
const numOrNull = (v: unknown) => (v == null ? null : Number(v));
const isMissing = (e: { code?: string; message?: string }) => e.code === "PGRST202" || /could not find the function|does not exist/i.test(e.message ?? "");
export type Done = { ok: true } | { ok: false; error: string };

export interface AcademicProgramRow { key: string; program: string; scholars: number; status: AcademicStatus | null; specialPassingGwa: number | null }
export interface AcademicSchoolRow {
  id: string; name: string; scholars: number; notSet: number;
  /** The school's own scale (null when the school has no grading setup yet: no passing GWA can be set for it). */
  scale: GwaScale | null; scaleKind: "scale" | "percent" | null;
  academicPassingGwa: number | null; nonAcademicPassingGwa: number | null;
}
export interface AcademicSettings { schools: AcademicSchoolRow[]; schoolId: string | null; programs: AcademicProgramRow[] }

/** The schools and the programs of the chosen school (the first school when none is chosen yet). */
export async function fetchAcademicSettings(schoolId?: string | null): Promise<{ ok: true; settings: AcademicSettings } | { ok: false; error: string; missing: boolean }> {
  const { data, error } = await supabase.rpc("academic_settings_get", { p_school: schoolId ?? null });
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't load the settings.", missing: !!error && isMissing(error) };
  const d = data as Row;
  return {
    ok: true,
    settings: {
      schoolId: d.school == null ? null : str(d.school),
      schools: ((d.schools ?? []) as Row[]).map(s => ({
        id: str(s.id), name: str(s.name), scholars: Number(s.scholars ?? 0), notSet: Number(s.not_set ?? 0),
        scale: s.has_setup ? { min: Number(s.scale_min), max: Number(s.scale_max), direction: (str(s.direction) === "higher_is_better" ? "higher_is_better" : "lower_is_better") as GwaScale["direction"] } : null,
        scaleKind: s.has_setup ? (str(s.kind) === "percent" ? "percent" : "scale") : null,
        academicPassingGwa: numOrNull(s.academic_passing_gwa), nonAcademicPassingGwa: numOrNull(s.non_academic_passing_gwa),
      })),
      programs: ((d.programs ?? []) as Row[]).map(p => ({ key: str(p.key), program: str(p.program), scholars: Number(p.scholars ?? 0), status: (p.academic_status == null ? null : str(p.academic_status)) as AcademicStatus | null, specialPassingGwa: numOrNull(p.special_passing_gwa) })),
    },
  };
}

export async function saveAcademicPassingGwa(schoolId: string, academic: number | null, nonAcademic: number | null): Promise<Done> {
  const { error } = await supabase.rpc("academic_settings_save", { p_school: schoolId, p_academic: academic, p_non_academic: nonAcademic });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** status null = take the program out (it is "not set" again). special = the program's own passing GWA, or null. */
export async function saveAcademicProgram(schoolId: string, program: string, status: AcademicStatus | null, special: number | null): Promise<Done> {
  const { error } = await supabase.rpc("academic_program_save", { p_school: schoolId, p_program: program, p_status: status, p_special: special });
  return error ? { ok: false, error: error.message } : { ok: true };
}

let cache: { at: number; map: Map<string, AcademicStatus> } | null = null;
/** "school|program" key -> status, for the Information list (kept for a minute). When the database update is not run yet the map is empty. */
export async function fetchAcademicStatusMap(): Promise<Map<string, AcademicStatus>> {
  if (cache && Date.now() - cache.at < 60_000) return cache.map;
  const { data, error } = await supabase.rpc("academic_status_map");
  const map = new Map<string, AcademicStatus>();
  if (!error) for (const r of (data ?? []) as Row[]) map.set(academicStatusKey(str(r.school_name), str(r.program_key)), str(r.academic_status) as AcademicStatus);
  cache = { at: Date.now(), map };
  return map;
}
export const forgetAcademicStatusMap = () => { cache = null; };
