// ─────────────────────────────────────────────────────────────
// src/lib/consultUrl.ts
// Consultation Tool: what goes in the ADDRESS, so a refresh brings the staff member back to the same tab, the same list (filters, search, sort, page) and the same open record.
//   ?page=scholarCounseling&ctTab=daily-records&ctPage=3&ctSearch=cruz&ctVisit=Office,Home%20Visit&ctRecord=<id>&ctMode=edit
// The default value of anything is left OUT of the address, so it stays short. Every value read from the address is checked (a wrong or old value falls back to the default, never breaks the page):
// the lists reuse the same checks as the choices they remember in the browser tab (dailyRecordsView / consultCasesView / probationView / calendarDayView), so the two can never disagree.
// No React / Supabase / window, so tests can run it alone. The code that touches the address bar is src/sead/consultUrl.ts.
// ─────────────────────────────────────────────────────────────
import { readRemembered, type RememberedView } from "./dailyRecordsView";
import { readRememberedCases, type RememberedCases } from "./consultCasesView";
import { readRememberedProbation, type RememberedProbationView } from "./probationView";
import { readRememberedCalendar, type RememberedCalendar } from "./calendarDayView";

export const CT_TABS = ["main-dashboard", "appointments", "renewal-cases", "daily-records", "probation-monitoring"] as const;
export type CtTab = (typeof CT_TABS)[number];
export const DEFAULT_TAB: CtTab = "main-dashboard";

/** Every parameter of the tool. When the person leaves the tool they are all taken out of the address. */
export const CT_PARAMS = [
  "ctTab", "ctPage", "ctSearch", "ctFrom", "ctTo", "ctVisit", "ctStatus", "ctConsultant", "ctSort", "ctGroup", "ctTerm", "ctAttention", "ctKind", "ctView", "ctDate", "ctStaff", "ctQueue", "ctApproved", "ctRecord", "ctMode",
] as const;

export type Patch = Record<string, string | null>;

/** The tab named in the address ("main-dashboard" when there is none or it is not one of the five). */
export function parseCtTab(search: string): CtTab {
  const v = new URLSearchParams(search).get("ctTab");
  return (CT_TABS as readonly string[]).includes(v ?? "") ? (v as CtTab) : DEFAULT_TAB;
}

/**
 * The address after a change, as ONE step: `patch` sets (or, with null / "", removes) parameters; `clear` first removes every parameter of the tool except the tab (a new tab starts with nothing of the old one).
 * Anything that is not a parameter of the tool (the page, other tools' parameters) is kept as it is. Returns the new "?…" text ("" when nothing is left).
 */
export function applyPatch(search: string, patch: Patch, clear = false): string {
  const p = new URLSearchParams(search);
  if (clear) for (const k of CT_PARAMS) if (k !== "ctTab") p.delete(k);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === "" || (k === "ctTab" && v === DEFAULT_TAB)) p.delete(k); else p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** The address without any parameter of the tool. */
export function stripCt(search: string): string {
  const p = new URLSearchParams(search);
  for (const k of CT_PARAMS) p.delete(k);
  const s = p.toString();
  return s ? `?${s}` : "";
}

const csv = (v: string | null): string[] => (v ? v.split(",").map(s => s.trim()).filter(Boolean) : []);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VISIT_TYPES = ["Office", "KSB Client", "Home Visit"];
const STATUSES = ["Regular", "Probationary", "On leave", "Reconsidered", "Removed"];
const has = (p: URLSearchParams, keys: string[]) => keys.some(k => p.has(k));
const pageOf = (p: URLSearchParams, key = "ctPage"): number => { const n = Math.floor(Number(p.get(key))); return Number.isFinite(n) && n >= 1 && n <= 1_000_000 ? n : 1; };
const pageParam = (n: number): string | null => (n > 1 ? String(n) : null);
const textParam = (s: string): string | null => (s.trim() ? s.trim().slice(0, 100) : null);

// ── Daily Records ──
const DAILY_KEYS = ["ctPage", "ctSearch", "ctFrom", "ctTo", "ctVisit", "ctStatus", "ctConsultant", "ctSort"];
/** The Daily Records list as the address says it; null when the address says nothing about it (then the choices remembered in the browser tab are used). */
export function dailyFromSearch(search: string): RememberedView | null {
  const p = new URLSearchParams(search);
  if (parseCtTab(search) !== "daily-records" || !has(p, DAILY_KEYS)) return null;
  const [sortKey, sortDir] = (p.get("ctSort") ?? "date-desc").split("-");
  return readRemembered(JSON.stringify({
    filters: {
      search: p.get("ctSearch") ?? "", from: p.get("ctFrom") ?? "", to: p.get("ctTo") ?? "",
      visitTypes: csv(p.get("ctVisit")).filter(v => VISIT_TYPES.includes(v)), statuses: csv(p.get("ctStatus")).filter(v => STATUSES.includes(v)), consultantIds: csv(p.get("ctConsultant")).filter(v => UUID.test(v)),
    },
    sortKey, sortDir, page: pageOf(p),
  }));
}
export function dailyToParams(v: { filters: { search: string; from: string; to: string; visitTypes: string[]; statuses: string[]; consultantIds: string[] }; sortKey: string; sortDir: string; page: number }): Patch {
  const sort = `${v.sortKey}-${v.sortDir}`;
  return {
    ctPage: pageParam(v.page), ctSearch: textParam(v.filters.search), ctFrom: v.filters.from || null, ctTo: v.filters.to || null,
    ctVisit: v.filters.visitTypes.length ? v.filters.visitTypes.join(",") : null, ctStatus: v.filters.statuses.length ? v.filters.statuses.join(",") : null,
    ctConsultant: v.filters.consultantIds.length ? v.filters.consultantIds.join(",") : null, ctSort: sort === "date-desc" ? null : sort,
  };
}

// ── Renewal Cases ──
const CASES_KEYS = ["ctPage", "ctSearch", "ctGroup", "ctTerm"];
export function casesFromSearch(search: string): RememberedCases | null {
  const p = new URLSearchParams(search);
  if (parseCtTab(search) !== "renewal-cases" || !has(p, CASES_KEYS)) return null;
  return readRememberedCases(JSON.stringify({ filters: { search: p.get("ctSearch") ?? "", term: p.get("ctTerm") ?? "", group: p.get("ctGroup") ?? "" }, page: pageOf(p) }));
}
export function casesToParams(v: { filters: { search: string; term: string; group: string }; page: number }): Patch {
  return { ctPage: pageParam(v.page), ctSearch: textParam(v.filters.search), ctGroup: v.filters.group || null, ctTerm: v.filters.term || null };
}

// ── Probationary Monitoring ──
const PROBATION_KEYS = ["ctPage", "ctSearch", "ctAttention", "ctKind", "ctSort"];
export function probationFromSearch(search: string): RememberedProbationView | null {
  const p = new URLSearchParams(search);
  if (parseCtTab(search) !== "probation-monitoring" || !has(p, PROBATION_KEYS)) return null;
  const [sortKey, sortDir] = (p.get("ctSort") ?? "name-asc").split("-");
  return readRememberedProbation(JSON.stringify({ filters: { search: p.get("ctSearch") ?? "", attention: csv(p.get("ctAttention")), kind: p.get("ctKind") ?? "" }, sortKey, sortDir, page: pageOf(p) }));
}
export function probationToParams(v: { filters: { search: string; attention: string[]; kind: string }; sortKey: string; sortDir: string; page: number }): Patch {
  const sort = `${v.sortKey}-${v.sortDir}`;
  return { ctPage: pageParam(v.page), ctSearch: textParam(v.filters.search), ctAttention: v.filters.attention.length ? v.filters.attention.join(",") : null, ctKind: v.filters.kind || null, ctSort: sort === "name-asc" ? null : sort };
}

// ── Appointments ──
const CALENDAR_KEYS = ["ctView", "ctDate", "ctStaff"];
export function calendarFromSearch(search: string): RememberedCalendar | null {
  const p = new URLSearchParams(search);
  if (parseCtTab(search) !== "appointments" || !has(p, CALENDAR_KEYS)) return null;
  return readRememberedCalendar(JSON.stringify({ view: p.get("ctView") ?? "week", anchor: p.get("ctDate"), staff: p.get("ctStaff") ?? "" }));
}
/** `today` (YYYY-MM-DD) is left out of the address: the calendar opens on today anyway. */
export function calendarToParams(v: { view: string; anchor: string | null; staff: string }, today: string): Patch {
  return { ctView: v.view === "day" ? "day" : null, ctDate: v.anchor && v.anchor !== today ? v.anchor : null, ctStaff: v.staff || null };
}

// ── Main Dashboard: the page of each of its two lists ──
export function dashboardFromSearch(search: string): { queue: number; approved: number } {
  const p = new URLSearchParams(search);
  if (parseCtTab(search) !== "main-dashboard") return { queue: 1, approved: 1 };
  return { queue: pageOf(p, "ctQueue"), approved: pageOf(p, "ctApproved") };
}
export const dashboardToParams = (v: { queue: number; approved: number }): Patch => ({ ctQueue: pageParam(v.queue), ctApproved: pageParam(v.approved) });

// ── The open record (Daily Records) ──
/** The record named in the address (its id must look like an id), and whether it is to be opened for editing. */
export function recordFromSearch(search: string): { id: string; edit: boolean } | null {
  const p = new URLSearchParams(search);
  const id = p.get("ctRecord") ?? "";
  if (parseCtTab(search) !== "daily-records" || !UUID.test(id)) return null;
  return { id, edit: p.get("ctMode") === "edit" };
}
