// ─────────────────────────────────────────────────────────────
// src/lib/consultCasesView.ts
// Consultation Tool > Renewal Cases: the plain rules of the list: the three groups, which term is shown, what is remembered, how a case's documents are summed up in one line,
// and how a live update is joined into the list on screen (only the cases that changed are replaced; a case that came or went is offered as "Refresh", never moved under the person's hand).
// No React / Supabase, so tests can run it alone. The cases are chosen, counted and paged by the database.
// ─────────────────────────────────────────────────────────────

export type CaseGroup = "" | "ready" | "work" | "sent";
export const CASE_GROUPS: { key: CaseGroup; label: string; hint: string }[] = [
  { key: "", label: "All open cases", hint: "Cases that are ready to endorse come first, then the cases that still need documents or the consultation, then the ones waiting for the evaluator." },
  { key: "ready", label: "Ready to endorse", hint: "The consultation was attended and the three documents are approved. Choose the new scholarship status." },
  { key: "work", label: "Documents and consultation", hint: "Approve or return the documents the scholars sent. A scholar books the consultation without waiting for them." },
  { key: "sent", label: "Endorsed — waiting for the evaluator", hint: "The Scholar Renewal evaluator approves the endorsement, then the scholar is renewed. The evaluator may send it back to you." },
];
export const CASE_GROUP_LABEL: Record<string, string> = { ready: "Ready to endorse", work: "Documents and consultation", sent: "Endorsed — waiting for the evaluator" };
export const CASES_PAGE_SIZE = 25;

/** A term in the selector is written "2026-2027|1st Semester"; "all" = every term; "" = the current term (the default). */
export const ALL_TERMS = "all";
export const termKey = (schoolYear: string, term: string): string => `${schoolYear}|${term}`;
export function splitTermKey(key: string): { schoolYear: string; term: string } | null {
  const i = key.indexOf("|");
  return i > 0 && i < key.length - 1 ? { schoolYear: key.slice(0, i), term: key.slice(i + 1) } : null;
}
export interface CaseTermInfo { schoolYear: string; term: string; label: string; openCount: number; isCurrent: boolean }
/** The term whose cases are shown: the remembered / chosen one when it is a term that exists (or "all"), otherwise the current term, otherwise the newest. */
export function pickTerm(chosen: string, terms: CaseTermInfo[]): string {
  if (chosen === ALL_TERMS) return ALL_TERMS;
  if (chosen && terms.some(t => termKey(t.schoolYear, t.term) === chosen)) return chosen;
  const cur = terms.find(t => t.isCurrent) ?? terms[0];
  return cur ? termKey(cur.schoolYear, cur.term) : ALL_TERMS;
}
/** How many open cases are in the terms OTHER than the shown one (for "N more open cases are in older terms"). */
export function otherTermsOpen(shown: string, terms: CaseTermInfo[]): number {
  if (shown === ALL_TERMS) return 0;
  return terms.filter(t => termKey(t.schoolYear, t.term) !== shown).reduce((n, t) => n + t.openCount, 0);
}

export interface CasesFilters { search: string; term: string; group: CaseGroup }
export const EMPTY_CASES_FILTERS: CasesFilters = { search: "", term: "", group: "" };
export const casesFiltersActive = (f: CasesFilters): boolean => f.search.trim() !== "" || f.group !== "";

// ── remembered while the person opens a case and comes back (also after another tool or a reload) ──
export interface RememberedCases { filters: CasesFilters; page: number }
export const CASES_REMEMBER_KEY = "cedo.consultation.renewalCases.view";
export function readRememberedCases(raw: string | null): RememberedCases | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<RememberedCases>;
    const f = v.filters as Partial<CasesFilters> | undefined;
    if (!f || typeof f !== "object") return null;
    return {
      filters: {
        search: typeof f.search === "string" ? f.search.slice(0, 100) : "",
        term: typeof f.term === "string" && (f.term === ALL_TERMS || splitTermKey(f.term)) ? f.term : "",
        group: f.group === "ready" || f.group === "work" || f.group === "sent" ? f.group : "",
      },
      page: Number.isFinite(v.page) && (v.page as number) >= 1 ? Math.floor(v.page as number) : 1,
    };
  } catch { return null; }
}

/** The one-line sum of a case's documents, so the list needs no document list: "2 waiting for you · 1 approved · 1 returned". */
export function docsSummary(c: { docsSubmitted: number; docsAccepted: number; docsReturned: number; requiredCount: number }): string {
  const parts: string[] = [];
  if (c.docsSubmitted > 0) parts.push(`${c.docsSubmitted} waiting for you`);
  if (c.docsAccepted > 0) parts.push(`${c.docsAccepted} approved`);
  if (c.docsReturned > 0) parts.push(`${c.docsReturned} returned`);
  if (parts.length === 0) return c.requiredCount > 0 ? `none sent yet (${c.requiredCount} needed)` : "none sent yet";
  return parts.join(" · ");
}

/**
 * Joins a fresh read of the SAME page into the list on screen.
 *   - the same cases (in any order): every case that is different is replaced in place; `changedIds` says which, so their documents (when open) are read again;
 *   - cases came or went: the list on screen is left alone and `listChanged` says how many (the screen offers "Refresh").
 */
export function mergeLive<T extends { recordId: string }>(shown: T[], fresh: T[]): { rows: T[]; changedIds: string[]; listChanged: number } {
  const shownIds = new Set(shown.map(r => r.recordId)), freshIds = new Set(fresh.map(r => r.recordId));
  let listChanged = 0;
  for (const id of freshIds) if (!shownIds.has(id)) listChanged++;
  for (const id of shownIds) if (!freshIds.has(id)) listChanged++;
  if (listChanged > 0) return { rows: shown, changedIds: [], listChanged };
  const byId = new Map(fresh.map(r => [r.recordId, r]));
  const changedIds: string[] = [];
  const rows = shown.map(r => {
    const n = byId.get(r.recordId)!;
    if (JSON.stringify(n) === JSON.stringify(r)) return r;
    changedIds.push(r.recordId);
    return n;
  });
  return { rows, changedIds, listChanged: 0 };
}
