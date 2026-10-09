// ─────────────────────────────────────────────────────────────
// src/sead/scholarsMonitoringData.ts
// Data for the staff Scholars tab and the Excel export: the scholar list with filters and paging, each school's grading setup
// (scale, letters, retention requirement), and every scholar's GWA + scholarship standing for the viewed period. The GWA, the
// "complete" rule and the standing all come from the shared libraries (src/lib/gwa.ts, standing.ts), never re-implemented here.
// See supabase_migration_standing_cleanup_logins.sql for the database side.
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";
import { fetchGradesForScholars } from "@/school/schoolApi";
import { gwaDetail, type GradeLike, type LetterGrade } from "@/lib/gwa";
import { scholarStanding, type StandingConfig, type StandingResult } from "@/lib/standing";
import type { GradingPeriod } from "./scholarsGradesMonitoringApi";

export interface StaffScholar {
  scholarIdNumber: string;
  firstName: string;
  lastName: string;
  middleName: string;
  schoolId: string | null;
  schoolName: string;
  program: string;
  yearLevel: string;
}

export interface ScholarFilters {
  search?: string;
  schoolId?: string;
  program?: string;
  yearLevel?: string;
}

type Failure = { ok: false; error: string };

function toScholar(r: Record<string, unknown>): StaffScholar {
  return {
    scholarIdNumber: String(r.scholar_id_number), firstName: String(r.first_name ?? ""), lastName: String(r.last_name ?? ""), middleName: String(r.middle_name ?? ""),
    schoolId: r.school_id ? String(r.school_id) : null, schoolName: String(r.school_name ?? ""), program: String(r.program ?? ""), yearLevel: String(r.year_level ?? ""),
  };
}

/** One page of scholars matching the filters, with the TOTAL that match (so the screen can say "51-100 of 7,136"). */
export async function fetchScholarsPage(filters: ScholarFilters, limit: number, offset: number): Promise<{ ok: true; rows: StaffScholar[]; total: number } | Failure> {
  const { data, error } = await supabase.rpc("scholars_grades_monitoring_scholars_page", {
    p_search: filters.search?.trim() || null, p_school_id: filters.schoolId || null, p_program: filters.program || null,
    p_year_level: filters.yearLevel || null, p_limit: limit, p_offset: offset,
  });
  if (error) return { ok: false, error: error.message };
  const rows = (data as Record<string, unknown>[] ?? []);
  return { ok: true, rows: rows.map(toScholar), total: rows.length > 0 ? Number(rows[0].total_count) : 0 };
}

/** Every scholar matching the filters (in pages of 500) up to `cap` — used when the screen has to look at all of them (standing filter, Excel export). `capped` is true when more exist than were loaded. */
export async function fetchAllMatching(filters: ScholarFilters, cap: number): Promise<{ ok: true; rows: StaffScholar[]; total: number; capped: boolean } | Failure> {
  const rows: StaffScholar[] = [];
  let total = 0;
  for (let offset = 0; offset < cap; offset += 500) {
    const page = await fetchScholarsPage(filters, Math.min(500, cap - offset), offset);
    if (!page.ok) return page;
    total = page.total;
    rows.push(...page.rows);
    if (page.rows.length < 500 || rows.length >= total) break;
  }
  return { ok: true, rows, total, capped: total > rows.length };
}

export async function fetchFilterOptions(schoolId?: string): Promise<{ programs: string[]; yearLevels: string[] }> {
  const { data, error } = await supabase.rpc("scholar_filter_options", { p_school_id: schoolId || null });
  if (error || !data) return { programs: [], yearLevels: [] };
  const rows = data as { kind: string; value: string }[];
  return { programs: rows.filter(r => r.kind === "program").map(r => r.value), yearLevels: rows.filter(r => r.kind === "year_level").map(r => r.value) };
}

export interface SchoolSummary { id: string; name: string }

export async function fetchSchoolSummaries(): Promise<SchoolSummary[]> {
  const { data, error } = await supabase.from("schools").select("id, name").order("name");
  if (error || !data) return [];
  return data.map(r => ({ id: String(r.id), name: String(r.name) }));
}

export interface SchoolSetup {
  config: (StandingConfig & { usesLetterGrades: boolean }) | null;
  letters: LetterGrade[];
}

/** Every school's grading scale, letters and retention requirement, keyed by school id (staff can read them all). */
export async function fetchSchoolSetups(): Promise<Map<string, SchoolSetup>> {
  const [cfg, lets] = await Promise.all([
    supabase.from("school_grading_configs").select("school_id, scale_min, scale_max, direction, uses_letter_grades, retention_threshold"),
    supabase.from("school_letter_grades").select("school_id, letter, numeric_value"),
  ]);
  const letters = new Map<string, LetterGrade[]>();
  for (const r of lets.data ?? []) {
    const id = String(r.school_id);
    const list = letters.get(id) ?? [];
    list.push({ letter: String(r.letter), numericValue: r.numeric_value == null ? null : Number(r.numeric_value) });
    letters.set(id, list);
  }
  const out = new Map<string, SchoolSetup>();
  for (const r of cfg.data ?? []) {
    const id = String(r.school_id);
    const usesLetterGrades = !!r.uses_letter_grades;
    out.set(id, {
      config: {
        scaleMin: Number(r.scale_min), scaleMax: Number(r.scale_max), direction: r.direction as StandingConfig["direction"], usesLetterGrades,
        retentionThreshold: r.retention_threshold == null ? null : Number(r.retention_threshold),
      },
      letters: usesLetterGrades ? letters.get(id) ?? [] : [],
    });
  }
  return out;
}

export interface ScholarStandingInfo {
  subjects: number;
  graded: number;
  gwa: number | null;
  standing: StandingResult;
}

/** GWA and standing of each given scholar for one period (their subjects are read in pages of 1000). */
export async function loadScholarStandings(
  scholars: Pick<StaffScholar, "scholarIdNumber" | "schoolId">[], period: GradingPeriod, setups: Map<string, SchoolSetup>,
): Promise<{ ok: true; byScholar: Map<string, ScholarStandingInfo> } | Failure> {
  const byScholar = new Map<string, ScholarStandingInfo>();
  if (!period.schoolYear || !period.semester || scholars.length === 0) {
    for (const s of scholars) byScholar.set(s.scholarIdNumber, { subjects: 0, graded: 0, gwa: null, standing: "no_gwa" });
    return { ok: true, byScholar };
  }
  const result = await fetchGradesForScholars(scholars.map(s => s.scholarIdNumber), period);
  if (!result.ok) return result;
  const grouped = new Map<string, GradeLike[]>();
  for (const g of result.rows) {
    const list = grouped.get(g.scholarIdNumber) ?? [];
    list.push({ grade: g.grade, units: g.units, excludeFromGwa: g.excludeFromGwa });
    grouped.set(g.scholarIdNumber, list);
  }
  for (const s of scholars) {
    const grades = grouped.get(s.scholarIdNumber) ?? [];
    const setup = s.schoolId ? setups.get(s.schoolId) : undefined;
    const gwa = gwaDetail(grades, setup?.letters ?? []).gwa;
    byScholar.set(s.scholarIdNumber, {
      subjects: grades.length, graded: grades.filter(g => g.grade.trim() !== "").length, gwa, standing: scholarStanding(gwa, setup?.config ?? null),
    });
  }
  return { ok: true, byScholar };
}
