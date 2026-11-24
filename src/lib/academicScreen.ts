// ─────────────────────────────────────────────────────────────
// src/lib/academicScreen.ts
// Grades and Academic Management > the school screen: the words and the small rules behind it (no React, no Supabase, so tests can run it alone).
// ─────────────────────────────────────────────────────────────
export type ScreenStatus = "academic" | "non_academic" | "not_set";
export const SCREEN_STATUS_LABEL: Record<ScreenStatus, string> = { academic: "Academic", non_academic: "Non-academic", not_set: "Not set" };
export const SCREEN_PAGE_SIZE = 50;
export const SCREEN_SQL = "supabase_migration_academic_status_screen.sql";

export interface ScreenFilter { search: string; status: ScreenStatus | ""; programs: string[]; years: string[]; scholarship: string[]; custom: boolean | null; includeRemoved: boolean }
export const EMPTY_FILTER: ScreenFilter = { search: "", status: "", programs: [], years: [], scholarship: [], custom: null, includeRemoved: false };

/** The filter as the database wants it (only what is set). */
export function filterToJson(f: ScreenFilter): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (f.search.trim()) o.search = f.search.trim();
  if (f.status) o.status = f.status;
  if (f.programs.length) o.programs = f.programs;
  if (f.years.length) o.years = f.years;
  if (f.scholarship.length) o.scholarship = f.scholarship;
  if (f.custom !== null) o.custom = f.custom;
  if (f.includeRemoved) o.include_removed = true;
  return o;
}
export const filterIsEmpty = (f: ScreenFilter) => Object.keys(filterToJson(f)).length === 0;

export interface ScreenImpact {
  total: number; willChange: number; same: number; fromNotSet: number; fromAcademic: number; fromNonAcademic: number;
  customSet: number; customCleared: number; openRenewals: number; recheckRenewals: number; ruleOn: boolean; academicPassingGwa: number | null; nonAcademicPassingGwa: number | null;
}
const n = (v: number) => v.toLocaleString("en-US");
const plural = (v: number, one: string, many: string) => `${n(v)} ${v === 1 ? one : many}`;

/** What a change would do, in plain sentences (shown before anything is saved). */
export function impactLines(i: ScreenImpact, target: ScreenStatus): string[] {
  const lines: string[] = [];
  if (i.total === 0) return ["No scholar is chosen."];
  lines.push(`${plural(i.willChange, "scholar changes", "scholars change")} to ${SCREEN_STATUS_LABEL[target]}${i.same > 0 ? `; ${plural(i.same, "already has", "already have")} it and ${i.same === 1 ? "is" : "are"} left alone` : ""}.`);
  if (i.willChange > 0) {
    const from = [[i.fromNotSet, "Not set"], [i.fromAcademic, "Academic"], [i.fromNonAcademic, "Non-academic"]].filter(([c]) => (c as number) > 0).map(([c, l]) => `${n(c as number)} from ${l}`);
    if (from.length) lines.push(`They are now: ${from.join(", ")}.`);
    if (i.customSet > 0) lines.push(`${plural(i.customSet, "scholar gets", "scholars get")} a custom passing GWA.`);
    if (i.customCleared > 0) lines.push(`${plural(i.customCleared, "scholar loses", "scholars lose")} their custom passing GWA.`);
    lines.push(i.openRenewals === 0 ? "None of them has an open renewal."
      : i.recheckRenewals === 0 ? `${plural(i.openRenewals, "of them has", "of them have")} an open renewal, but the passing GWA used does not change, so no renewal needs to be checked again.`
      : `${plural(i.recheckRenewals, "open renewal", "open renewals")} will be checked again because the passing GWA used changes${i.openRenewals > i.recheckRenewals ? ` (${n(i.openRenewals - i.recheckRenewals)} other open renewal${i.openRenewals - i.recheckRenewals === 1 ? "" : "s"} ${i.openRenewals - i.recheckRenewals === 1 ? "is" : "are"} not affected)` : ""}. ${i.recheckRenewals <= 10 ? "They are checked right away." : "The count is shown on the screen while they are checked."}`);
    lines.push(i.ruleOn
      ? `The school's passing GWA is Academic ${i.academicPassingGwa?.toFixed(2) ?? "not set"} and Non-academic ${i.nonAcademicPassingGwa?.toFixed(2) ?? "not set"}: the status changes which number the renewal compares the GWA with.`
      : "This school has no passing GWA set, so the GWA rule is off for it: the status changes no renewal result for now.");
  }
  return lines;
}

/** The status of a scholar in one line: "Non-academic · passing GWA 2.75" or "Not set · checked as Academic · passing GWA 2.00" (+ the scholar's GWA when known: "… · GWA 2.90 is below"). */
export function statusLine(status: string | null | undefined, isSet: boolean, passing: number | null | undefined, gwa?: number | null, low?: boolean): string {
  const base = isSet ? (SCREEN_STATUS_LABEL[(status ?? "academic") as ScreenStatus] ?? "Academic") : "Not set · checked as Academic";
  const pass = passing == null ? " · no passing GWA set (the GWA rule is off)" : ` · passing GWA ${Number(passing).toFixed(2)}`;
  const g = gwa == null || passing == null ? "" : ` · scholar GWA ${Number(gwa).toFixed(2)} ${low ? "is below" : "is enough"}`;
  return `${base}${pass}${g}`;
}

/** The Information list cell: "Non-academic (passing GWA 2.75)", "Not set (counts as Academic)", or "" when the status could not be read. */
export function infoStatusText(i: { status: string; isSet: boolean; passingGwa: number | null } | undefined): string {
  if (!i) return "";
  const pass = i.passingGwa == null ? "" : ` (passing GWA ${Number(i.passingGwa).toFixed(2)})`;
  return i.isSet ? `${SCREEN_STATUS_LABEL[i.status as ScreenStatus] ?? "Academic"}${pass}` : `Not set (counts as Academic)${pass}`;
}

/** The progress of the re-check: "Re-checking 340 renewals… 120 done". */
export function recheckText(total: number, left: number): string {
  const done = Math.max(0, total - left);
  return left > 0 ? `Re-checking ${n(left + done)} renewal${left + done === 1 ? "" : "s"}… ${n(done)} done` : `All ${n(total)} renewal${total === 1 ? "" : "s"} checked.`;
}

const HOW: Record<string, string> = { manual: "Changed one scholar", selection: "Changed chosen scholars", matching: "Changed all matching a filter", file: "Set by file", migration: "Moved from the program", upload: "Upload", undo: "Undone" };
export const howText = (h: string) => HOW[h] ?? h;
export const statusText = (s: string | null | undefined) => (s ? SCREEN_STATUS_LABEL[s as ScreenStatus] ?? s : "Not set");
/** One history row in words: "Not set → Non-academic (custom passing GWA 2.50)". */
export function changeText(oldStatus: string | null, newStatus: string | null, oldGwa: number | null, newGwa: number | null): string {
  const g = (v: number | null) => (v == null ? "" : ` (custom ${v.toFixed(2)})`);
  return `${statusText(oldStatus)}${g(oldGwa)} → ${statusText(newStatus)}${g(newGwa)}`;
}
