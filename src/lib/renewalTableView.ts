// ─────────────────────────────────────────────────────────────
// src/lib/renewalTableView.ts
// Scholar Renewal > Applications / Renewed / Not applied: how one row of the table is WORDED and coloured (name in two lines, "1st Yr", status chips, the SDP chip, the grades chips, the two
// action slots). Plain helpers (no React, no Supabase) so tests can run them alone. NOTHING here decides anything: the data, the rules, who may press what and what a button does all stay
// where they were; this file only chooses short words and colours for what the database already said.
// ─────────────────────────────────────────────────────────────
import { gradeIndicators, gradesProgressText } from "./renewal";
import type { NeededAction } from "./renewalActions";

export type ChipTone = "green" | "red" | "amber" | "blue" | "gray";

/** "Agtarap, John Paul Mandag" -> surname "Agtarap," on the first line, given names on the second. A name with no comma stays whole on the first line. */
export function splitName(name: string): { surname: string; given: string } {
  const i = name.indexOf(",");
  if (i < 0) return { surname: name.trim(), given: "" };
  return { surname: name.slice(0, i + 1).trim(), given: name.slice(i + 1).trim() };
}

/** "1st Year" -> "1st Yr" (the full value stays in the tooltip). */
export function shortYear(year: string | null | undefined): string {
  const y = (year ?? "").trim();
  if (!y) return "—";
  return y.replace(/\byear\b/i, "Yr");
}

/** The scholarship status as a chip: Regular gray, Probationary amber, Reconsidered blue, Removed red, On leave gray (anything else gray). */
export function statusTone(status: string | null | undefined): ChipTone {
  switch ((status ?? "").trim()) {
    case "Probationary": return "amber";
    case "Reconsidered": return "blue";
    case "Removed": return "red";
    default: return "gray";
  }
}

export interface SdpRowInput { sdpApplicable: boolean; sdpComplied: boolean | null; sdpReconsideration: string | null }
export interface SdpView { chip: { text: string; tone: ChipTone }; detail: string | null; canView: boolean }
/**
 * The SDP column: ONE chip for the main state plus at most one short line of detail.
 *   Complied (green) · Not complied (red) · On hold (amber: the application is on hold for SDP credits and no reconsideration is on its way) · Not required (Summer) (gray) · Not checked (gray)
 * "SDP on hold" is no longer shown a second time under the name: it is this chip (or, when a reconsideration was requested, the "Not complied" chip with "Reconsideration requested" under it).
 * canView = the eye button that opens the SDP credits (the same cases that had the "View SDP credits" link).
 */
export function sdpView(r: SdpRowInput, stage?: string | null): SdpView {
  if (!r.sdpApplicable) return { chip: { text: "Not required (Summer)", tone: "gray" }, detail: null, canView: false };
  if (r.sdpComplied === true) return { chip: { text: "Complied", tone: "green" }, detail: r.sdpReconsideration === "approved" ? "By SDP reconsideration" : null, canView: r.sdpReconsideration === "approved" };
  if (r.sdpComplied === false) {
    const requestKnown = r.sdpReconsideration === "pending" || r.sdpReconsideration === "approved" || r.sdpReconsideration === "denied";
    const hold = stage === "sdp_on_hold" && !requestKnown;
    const detail = r.sdpReconsideration === "pending" ? "Reconsideration requested" : r.sdpReconsideration === "denied" ? "Reconsideration not approved" : hold ? "Not complied" : null;
    return { chip: hold ? { text: "On hold", tone: "amber" } : { text: "Not complied", tone: "red" }, detail, canView: true };
  }
  return { chip: { text: "Not checked", tone: "gray" }, detail: null, canView: r.sdpReconsideration === "approved" };
}

export interface GradesRowInput { gradesState: string | null; graded: number; total: number; failed: number; drp: number; inc: number; review: number }
export interface GradesView { chips: { text: string; tone: ChipTone }[]; detail: string | null }
/**
 * The Grades column: small chips on one line and a short line of detail.
 *   "Waiting for approval" (amber: the scholar's entered grades wait for the Grades Approver) · "N failed" / "N DRP" (red) · "INC" / "N to review" (amber)
 *   · with none of those: "No subjects yet" (gray) · "Waiting for grades" (gray) · "Needs review" (amber) · "Approved" (green: entered grades approved) · "All passed" (green)
 * The detail line is the count ("2 of 2 graded"), the same number the old column showed.
 */
export function gradesView(r: GradesRowInput, enteredGradesStatus?: string | null): GradesView {
  const chips: { text: string; tone: ChipTone }[] = [];
  if (enteredGradesStatus === "pending") chips.push({ text: "Waiting for approval", tone: "amber" });
  for (const g of gradeIndicators(r)) chips.push({ text: g.text, tone: g.tone === "bad" ? "red" : "amber" });
  const noSubjects = r.total <= 0 || r.gradesState === "no_grades";
  if (chips.length === 0) {
    if (noSubjects) chips.push({ text: "No subjects yet", tone: "gray" });
    else if (r.gradesState === "waiting") chips.push({ text: "Waiting for grades", tone: "gray" });
    else if (r.gradesState === "review") chips.push({ text: "Needs review", tone: "amber" });
    else if (r.gradesState === "ready") chips.push({ text: enteredGradesStatus === "approved" ? "Approved" : "All passed", tone: "green" });
    else chips.push({ text: "Not checked", tone: "gray" });
  }
  return { chips, detail: noSubjects ? null : gradesProgressText(r) };
}

/** The Actions column has two FIXED slots so the buttons line up down the table: slot 1 = decide the SDP reconsideration, slot 2 = approve the entered grades. Every other action goes into the "⋮" menu. */
export const SLOT_LABEL = { decide_sdp: "Decide SDP", approve_grades: "Approve grades" } as const;
export function actionSlots(list: NeededAction[]): { sdp: NeededAction | null; grades: NeededAction | null; rest: NeededAction[] } {
  const sdp = list.find(a => a.key === "decide_sdp") ?? null;
  const grades = list.find(a => a.key === "approve_grades") ?? null;
  return { sdp, grades, rest: list.filter(a => a !== sdp && a !== grades) };
}
