// ─────────────────────────────────────────────────────────────
// src/lib/academicStatus.ts
// The academic status of a program OF A SCHOOL (Academic / Non-academic), the passing GWA of a school (on the school's own scale) and a special program with its own passing GWA.
// Plain helpers (no Supabase / React) so tests can run them alone. The rules themselves are decided by the database (supabase_migration_academic_per_school.sql); this only words them.
// ─────────────────────────────────────────────────────────────

export type AcademicStatus = "academic" | "non_academic";
export const ACADEMIC_STATUS_LABEL: Record<AcademicStatus, string> = { academic: "Academic", non_academic: "Non-academic" };

/** A program (or a school) written in different ways ("BS Nursing", " bs  nursing ") is one: the same rule as the database (_program_key). */
export function programKey(program: string | null | undefined): string {
  return String(program ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** The key of a scholar's school + program in the status map (the programs are set PER SCHOOL). */
export const academicStatusKey = (school: string | null | undefined, program: string | null | undefined): string => `${programKey(school)}|${programKey(program)}`;

/** What the Information list shows for a scholar's program in their school: Academic, Non-academic, "Not set" (counts as Academic until the staff place the program), or "" when the scholar has no program. */
export function academicStatusText(map: ReadonlyMap<string, AcademicStatus>, school: string | null | undefined, course: string | null | undefined): string {
  if (!programKey(course)) return "";
  const s = map.get(academicStatusKey(school, course));
  return s ? ACADEMIC_STATUS_LABEL[s] : "Not set";
}

/** The scale a school's GWA is on (the school's own grading setup; the percent, 0 to 100, when the school's GWA uses percentages). */
export interface GwaScale { min: number; max: number; direction: "lower_is_better" | "higher_is_better" }
export const STANDARD_GWA_SCALE: GwaScale = { min: 1, max: 5, direction: "lower_is_better" };
const best = (sc: GwaScale) => (sc.direction === "higher_is_better" ? sc.max : sc.min);
/** A scale for display: "1.00 to 5.00 (1.00 is the best)". */
export const describeScale = (sc: GwaScale): string => `${sc.min.toFixed(2)} to ${sc.max.toFixed(2)} (${best(sc).toFixed(2)} is the best)`;

/** A problem with a typed passing GWA (on the school's own scale; the standard 1.00 to 5.00 when none is given); null when it is fine. An empty text means "not set" and is fine when `allowEmpty`. */
export function passingGwaProblem(text: string, allowEmpty = true, scale: GwaScale = STANDARD_GWA_SCALE): string | null {
  const t = text.trim().replace(",", ".");
  if (t === "") return allowEmpty ? null : "Type the passing GWA.";
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return `A passing GWA is a number such as ${((scale.min + scale.max) / 2).toFixed(2)} (the scale of this school is ${describeScale(scale)}).`;
  const n = Number(t);
  if (n < scale.min || n > scale.max) return `A passing GWA of this school is a number from ${scale.min.toFixed(2)} to ${scale.max.toFixed(2)} (${best(scale).toFixed(2)} is the best).`;
  return null;
}
/** The typed passing GWA as a number (null when empty). */
export const parsePassingGwa = (text: string): number | null => (text.trim() === "" ? null : Number(text.trim().replace(",", ".")));
/** A passing GWA for display: 2.5 -> "2.50"; null -> "not set". */
export const formatPassingGwa = (n: number | null | undefined): string => (n == null ? "not set" : n.toFixed(2));

/** What the passing GWA means, in plain words (shown above the settings). */
export const PASSING_GWA_EXPLANATION = "The passing GWA is set PER SCHOOL, on that school's own grading scale (shown below). In the renewal, a scholar whose GWA is WORSE than the passing GWA of their program's group in their school needs to book a consultation, even with no failed subject. Leave it empty to switch the rule off for that group.";
