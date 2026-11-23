// ─────────────────────────────────────────────────────────────
// src/lib/sdpCreditedView.ts
// SDP Monitoring > an activity > Credited Scholars: the plain rules of the tab: the one date format, names with accents (Ñ), when a semester chip is shown, the wording of each reason, the sort and semester
// choices, the rows per page, and which part of a page of "Not credited" can be credited. No React / Supabase, so tests can run it alone. The credits themselves are chosen, counted, sorted and paged by the database.
// ─────────────────────────────────────────────────────────────
import { normalizeTerm, periodKey, termLabel } from "./academicPeriods";

export type CreditedSide = "credited" | "not_credited";
export const PAGE_SIZE_CHOICES = [25, 50] as const;
export const DEFAULT_PAGE_SIZE = 25;
export const pickPageSize = (n: unknown): number => (PAGE_SIZE_CHOICES as readonly number[]).includes(Number(n)) ? Number(n) : DEFAULT_PAGE_SIZE;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** The ONE date format of the pop-up: "Nov 23, 2026". Takes a day ("2026-11-23") or a full timestamp; "—" when there is none. No time zone is applied to a plain day. */
export function formatCreditDate(value: string | null | undefined): string {
  if (!value) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return "—";
  const month = Number(m[2]);
  if (month < 1 || month > 12) return "—";
  return `${MONTHS[month - 1]} ${Number(m[3])}, ${m[1]}`;
}

/**
 * A name written in capitals except for its accented letters ("IBAñEZ": the database uppercased it without knowing Ñ) is shown fully in capitals ("IBAÑEZ").
 * A name in normal mixed case ("Ibañez") or already right is left alone. Only how it is SHOWN changes; the stored name is never touched.
 */
export function fixAccentCase(name: string): string {
  if (!name) return name;
  const letters = [...name].filter(ch => ch.toLowerCase() !== ch.toUpperCase());
  const lowerPlain = letters.filter(ch => ch === ch.toLowerCase() && /[a-z]/.test(ch));
  const lowerAccented = letters.filter(ch => ch === ch.toLowerCase() && !/[a-z]/.test(ch));
  const upper = letters.filter(ch => ch === ch.toUpperCase() && ch !== ch.toLowerCase());
  return lowerPlain.length === 0 && lowerAccented.length > 0 && upper.length >= 2 ? name.toLocaleUpperCase("es") : name;
}
export const fullName = (first: string | null | undefined, last: string | null | undefined): string => fixAccentCase(`${first ?? ""} ${last ?? ""}`.replace(/\s+/g, " ").trim());

/** "2026-2027|1st Semester" for a credit's semester; "" when the credit counts in no semester. */
export const creditSemesterKey = (schoolYear: string | null | undefined, semester: string | null | undefined): string =>
  schoolYear && semester ? periodKey(schoolYear, semester) : "";
export const creditSemesterLabel = (schoolYear: string | null | undefined, semester: string | null | undefined): string =>
  schoolYear && semester ? `${schoolYear} · ${termLabel(normalizeTerm(semester) ?? semester)}` : "No semester";

/**
 * The semester chip of a credit: shown ONLY when it is DIFFERENT from the semester chosen in "Counts in" (amber, so a mistake stands out); a credit in the chosen semester shows nothing but a light dash.
 */
export function semesterChip(schoolYear: string | null | undefined, semester: string | null | undefined, selectedKey: string): { show: boolean; label: string } {
  const key = creditSemesterKey(schoolYear, semester);
  return { show: key !== selectedKey, label: creditSemesterLabel(schoolYear, semester) };
}

/** The reason under a scholar in "Not credited" (the database sends a code; the wording is here, the same as the old amber section). */
export function reasonText(code: string): string {
  switch (code) {
    case "survey": return "Waiting for the scholar to answer the survey; the credit is added once it is answered.";
    case "no_category": return "This activity has no SDP category, so it gives no credit.";
    case "banked": return "Had already completed this category, so the credit is saved for a later semester.";
    default: return "Attended, but no credit was recorded (for example, the category was chosen after they scanned). Use “Credit selected” or “Credit these scholars” to add it.";
  }
}

export type CreditedSort = "date_desc" | "date_asc" | "name_asc" | "name_desc";
export const SORT_CHOICES: { value: CreditedSort; label: string }[] = [
  { value: "date_desc", label: "Date: newest first" }, { value: "date_asc", label: "Date: oldest first" }, { value: "name_asc", label: "Name: A–Z" }, { value: "name_desc", label: "Name: Z–A" },
];
export function sortParams(s: CreditedSort): { key: "name" | "date"; dir: "asc" | "desc" } {
  return s === "name_asc" ? { key: "name", dir: "asc" } : s === "name_desc" ? { key: "name", dir: "desc" } : s === "date_asc" ? { key: "date", dir: "asc" } : { key: "date", dir: "desc" };
}

export interface SemesterCount { schoolYear: string | null; semester: string | null; n: number }
/** The semester filter's choice → what the database is asked: "" = all, "none" = credits without a semester, otherwise "school year|term". */
export function semesterFilterParams(choice: string): { schoolYear: string | null; semester: string | null; noSemester: boolean } {
  if (choice === "none") return { schoolYear: null, semester: null, noSemester: true };
  const i = choice.indexOf("|");
  return choice && i > 0 ? { schoolYear: choice.slice(0, i), semester: choice.slice(i + 1), noSemester: false } : { schoolYear: null, semester: null, noSemester: false };
}
/** The semesters offered in the filter: only the ones this activity's credits are in, with how many (plus "No semester" when some have none). */
export function semesterFilterOptions(list: SemesterCount[]): { value: string; label: string }[] {
  return list.map(s => ({ value: s.schoolYear && s.semester ? periodKey(s.schoolYear, s.semester) : "none", label: `${creditSemesterLabel(s.schoolYear, s.semester)} (${s.n})` }));
}

/** The tick-boxes of a page: "Select all on this page" ticks every row that is allowed (in Not credited: only those that can be credited). */
export function toggleAllOnPage(selected: Set<string>, pageIds: string[], on: boolean): Set<string> {
  const n = new Set(selected);
  for (const id of pageIds) { if (on) n.add(id); else n.delete(id); }
  return n;
}
export const allOnPageSelected = (selected: Set<string>, pageIds: string[]): boolean => pageIds.length > 0 && pageIds.every(id => selected.has(id));

/** The sentence under the title: crediting adds credit, it does not complete the category. */
export function creditingNote(categoryLabel: string, credits: number): string {
  return `Crediting a scholar adds ${credits} credit${credits === 1 ? "" : "s"} toward ${categoryLabel}.`;
}

/** What the amber warning says when the activity has no category is kept as it was; this is the wording of a confirmation before crediting. */
export function confirmCreditText(n: number, activityName: string, semesterLabel: string): string {
  return `Credit ${n} scholar${n === 1 ? "" : "s"} who attended “${activityName}” but ${n === 1 ? "has" : "have"} no credit? Their credit is counted in ${semesterLabel}.`;
}
