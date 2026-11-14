// ─────────────────────────────────────────────────────────────
// src/lib/academicStatus.ts
// The academic status of a program (Academic / Non-academic), the passing GWA (the standard scale: 1.00 best to 5.00, lower is better) and a special program with its own passing GWA.
// Plain helpers (no Supabase / React) so tests can run them alone. The rules themselves are decided by the database (supabase_migration_academic_status.sql); this only words them.
// ─────────────────────────────────────────────────────────────

export type AcademicStatus = "academic" | "non_academic";
export const ACADEMIC_STATUS_LABEL: Record<AcademicStatus, string> = { academic: "Academic", non_academic: "Non-academic" };

/** A program written in different ways ("BS Nursing", " bs  nursing ") is one program: the same rule as the database (_program_key). */
export function programKey(program: string | null | undefined): string {
  return String(program ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** What the Information list shows for a scholar's program: Academic, Non-academic, "Not set" (counts as Academic until the staff place the program), or "" when the scholar has no program. */
export function academicStatusText(map: ReadonlyMap<string, AcademicStatus>, course: string | null | undefined): string {
  const key = programKey(course);
  if (!key) return "";
  const s = map.get(key);
  return s ? ACADEMIC_STATUS_LABEL[s] : "Not set";
}

/** A problem with a typed passing GWA (1.00 to 5.00); null when it is fine. An empty text means "not set" and is fine when `allowEmpty`. */
export function passingGwaProblem(text: string, allowEmpty = true): string | null {
  const t = text.trim().replace(",", ".");
  if (t === "") return allowEmpty ? null : "Type the passing GWA.";
  if (!/^\d(\.\d{1,2})?$/.test(t)) return "A passing GWA is a number such as 2.50 (1.00 is the best, 5.00 the worst).";
  const n = Number(t);
  if (n < 1 || n > 5) return "A passing GWA is a number from 1.00 to 5.00 (1.00 is the best).";
  return null;
}
/** The typed passing GWA as a number (null when empty). */
export const parsePassingGwa = (text: string): number | null => (text.trim() === "" ? null : Number(text.trim().replace(",", ".")));
/** A passing GWA for display: 2.5 -> "2.50"; null -> "not set". */
export const formatPassingGwa = (n: number | null | undefined): string => (n == null ? "not set" : n.toFixed(2));

/** What the passing GWA means, in plain words (shown above the settings). */
export const PASSING_GWA_EXPLANATION = "The passing GWA is on the standard scale: 1.00 is the best and 5.00 the worst. In the renewal, a scholar whose GWA is WORSE (a bigger number) than the passing GWA of their program's group needs to book a consultation, even with no failed subject. Leave it empty to switch the rule off for that group.";
