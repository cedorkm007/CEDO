// ─────────────────────────────────────────────────────────────
// src/lib/renewalReport.ts
// The pure part of the renewal reports (Phase 7): reading the dashboard's numbers, grouping stages the way the evaluator's board does, and turning
// the export rows into the sheets of the Excel file. No Supabase / React imports, so tests can run it alone. The numbers themselves are made by the
// database (renewal_dashboard, renewal_export_data); nothing here decides a renewal.
// ─────────────────────────────────────────────────────────────
import { BOARD_GROUPS, STAGE_INFO, stageTitle, termLabelOf, type RenewalStage } from "@/lib/renewal";

export type ReportCell = string | number | null;
export interface ReportSheet { name: string; headers: string[]; rows: ReportCell[][] }

type Row = Record<string, unknown>;
const n = (v: unknown): number => (v == null || v === "" ? 0 : Number(v));
const s = (v: unknown): string => (v == null ? "" : String(v));
const sOrNull = (v: unknown): string | null => (v == null || v === "" ? null : String(v));

export interface DashboardData {
  schoolYear: string; term: string; termLabel: string;
  window: { opensOn: string; closesOn: string; lateAllowed: boolean; daysLeft: number; isOpen: boolean } | null;
  totals: {
    canRenew: number; applied: number; notApplied: number; notRequired: number; late: number; lateWaiting: number; lateDeclined: number; renewed: number;
    renewedRegular: number; renewedProbationary: number; renewedReconsidered: number; removed: number; returned: number; avgDaysToRenew: number | null;
  };
  byStage: Record<string, number>; byRule: Record<string, number>;
  bySchool: { school: string; applied: number; renewed: number; removed: number; pending: number; notApplied: number }[];
  perDay: { day: string; applied: number; renewed: number }[];
  sdpAndGrades: { sdpOnHold: number; waitingGrades: number; reviewNeeded: number; withFailed: number; withInc: number };
  inc: { open: number; noDeadline: number; dueIn7Days: number; overdue: number; resolvedPassed: number; failedOrCounted: number };
  consultations: { required: number; done: number; bookedUpcoming: number; attended: number; noShows: number; needBooking: number };
  documents: { waitingReview: number; approved: number; returned: number };
  divisionHead: { waiting: number; sentBack: number; approvedProbationary: number; reconsidered: number; removed: number };
  /** What the Excel export can be narrowed to (the schools, year levels and programs that exist). */
  filterOptions: { schools: string[]; yearLevels: string[]; programs: string[] };
}

/** The database's answer, in the shape the screen and the Excel file use. */
export function parseDashboard(raw: unknown): DashboardData {
  const d = (raw ?? {}) as Row;
  const t = (d.totals ?? {}) as Row, sg = (d.sdp_and_grades ?? {}) as Row, inc = (d.inc ?? {}) as Row, c = (d.consultations ?? {}) as Row, doc = (d.documents ?? {}) as Row, dh = (d.division_head ?? {}) as Row;
  const w = d.window as Row | null | undefined;
  const counts = (v: unknown): Record<string, number> => Object.fromEntries(Object.entries((v ?? {}) as Row).map(([k, x]) => [k, n(x)]));
  return {
    schoolYear: s(d.school_year), term: s(d.term), termLabel: s(d.term_label),
    window: w ? { opensOn: s(w.opens_on), closesOn: s(w.closes_on), lateAllowed: !!w.late_allowed, daysLeft: n(w.days_left), isOpen: !!w.is_open } : null,
    totals: {
      canRenew: n(t.can_renew), applied: n(t.applied), notApplied: n(t.not_applied), notRequired: n(t.not_required), late: n(t.late), lateWaiting: n(t.late_waiting), lateDeclined: n(t.late_declined),
      renewed: n(t.renewed), renewedRegular: n(t.renewed_regular), renewedProbationary: n(t.renewed_probationary), renewedReconsidered: n(t.renewed_reconsidered), removed: n(t.removed),
      returned: n(t.returned), avgDaysToRenew: t.avg_days_to_renew == null ? null : Number(t.avg_days_to_renew),
    },
    byStage: counts(d.by_stage), byRule: counts(d.by_rule),
    bySchool: ((d.by_school ?? []) as Row[]).map(r => ({ school: s(r.school), applied: n(r.applied), renewed: n(r.renewed), removed: n(r.removed), pending: n(r.pending), notApplied: n(r.not_applied) })),
    perDay: ((d.per_day ?? []) as Row[]).map(r => ({ day: s(r.day).slice(0, 10), applied: n(r.applied), renewed: n(r.renewed) })),
    sdpAndGrades: { sdpOnHold: n(sg.sdp_on_hold), waitingGrades: n(sg.waiting_grades), reviewNeeded: n(sg.review_needed), withFailed: n(sg.with_failed), withInc: n(sg.with_inc) },
    inc: { open: n(inc.open), noDeadline: n(inc.no_deadline), dueIn7Days: n(inc.due_in_7_days), overdue: n(inc.overdue), resolvedPassed: n(inc.resolved_passed), failedOrCounted: n(inc.failed_or_counted) },
    consultations: { required: n(c.required), done: n(c.done), bookedUpcoming: n(c.booked_upcoming), attended: n(c.attended), noShows: n(c.no_shows), needBooking: n(c.need_booking) },
    documents: { waitingReview: n(doc.waiting_review), approved: n(doc.approved), returned: n(doc.returned) },
    divisionHead: { waiting: n(dh.waiting), sentBack: n(dh.sent_back), approvedProbationary: n(dh.approved_probationary), reconsidered: n(dh.reconsidered), removed: n(dh.removed) },
    filterOptions: (() => {
      const o = (d.filter_options ?? {}) as Row;
      const list = (v: unknown) => ((v ?? []) as unknown[]).map(x => s(x)).filter(x => x !== "");
      return { schools: list(o.schools), yearLevels: list(o.year_levels), programs: list(o.programs) };
    })(),
  };
}

// ── Narrowing the Excel export ──────────────────────────────
/** What the person ticked before pressing "Download Excel". An empty list means "all". `groups` are the board's group keys plus "not_applied". */
export interface ExportFilter { schools: string[]; yearLevels: string[]; programs: string[]; groups: string[] }
export const NO_FILTER: ExportFilter = { schools: [], yearLevels: [], programs: [], groups: [] };
export const NOT_APPLIED_GROUP = { key: "not_applied", label: "Not applied yet" };
export const isFiltered = (f: ExportFilter): boolean => f.schools.length + f.yearLevels.length + f.programs.length + f.groups.length > 0;

/** The status groups a person can tick: the board's groups (without the empty ones) and "Not applied yet". */
export const FILTER_GROUPS: { key: string; label: string }[] = [...BOARD_GROUPS.map(g => ({ key: g.key, label: g.label })), NOT_APPLIED_GROUP];

/** The arguments of renewal_export_data for a filter (null = no narrowing on that field). */
export function exportFilterArgs(f: ExportFilter): { p_schools: string[] | null; p_year_levels: string[] | null; p_programs: string[] | null; p_stages: string[] | null } {
  const stages = f.groups.flatMap(key => key === NOT_APPLIED_GROUP.key ? ["not_applied"] : [...(BOARD_GROUPS.find(g => g.key === key)?.stages ?? [])]);
  const orNull = (a: string[]) => (a.length ? a : null);
  return { p_schools: orNull(f.schools), p_year_levels: orNull(f.yearLevels), p_programs: orNull(f.programs), p_stages: orNull(stages) };
}

/** One line saying what the file was narrowed to ("All scholars" when nothing was ticked). */
export function describeFilter(f: ExportFilter): string {
  const parts = [
    f.schools.length ? `School: ${f.schools.join(", ")}` : "", f.yearLevels.length ? `Year level: ${f.yearLevels.join(", ")}` : "", f.programs.length ? `Program: ${f.programs.join(", ")}` : "",
    f.groups.length ? `Status: ${f.groups.map(k => FILTER_GROUPS.find(g => g.key === k)?.label ?? k).join(", ")}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "All scholars";
}

/** The stages grouped the way the evaluator's board groups them (one stage in one group), with how many applications sit in each group. */
export function stageGroupCounts(byStage: Record<string, number>): { key: string; label: string; count: number; stages: { stage: string; title: string; count: number }[] }[] {
  return BOARD_GROUPS.map(g => {
    const stages = g.stages.map(st => ({ stage: st, title: stageTitle(st), count: byStage[st] ?? 0 })).filter(x => x.count > 0);
    return { key: g.key, label: g.label, count: stages.reduce((a, x) => a + x.count, 0), stages };
  });
}

/** "12 of 40 (30%)" – a share written out, never dividing by zero. */
export function percentText(part: number, whole: number): string {
  if (whole <= 0) return `${part} of ${whole}`;
  return `${part} of ${whole} (${Math.round((part / whole) * 100)}%)`;
}
export const percentOf = (part: number, whole: number): number => (whole <= 0 ? 0 : Math.round((part / whole) * 100));

/** The last up-to-N days of the per-day series, with a gap-free day list, for a small bar chart. */
export function lastDays(perDay: { day: string; applied: number; renewed: number }[], count: number): { day: string; applied: number; renewed: number }[] {
  if (perDay.length === 0) return [];
  const by = new Map(perDay.map(r => [r.day, r]));
  const end = new Date(perDay[perDay.length - 1].day + "T00:00:00Z");
  const out: { day: string; applied: number; renewed: number }[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 86400000).toISOString().slice(0, 10);
    out.push(by.get(d) ?? { day: d, applied: 0, renewed: 0 });
  }
  return out;
}

// ── The Excel file ──────────────────────────────────────────
export interface ExportData { applications: Row[]; notApplied: Row[]; inc: Row[]; consultations: Row[]; exportedAt: string }
export function parseExportData(raw: unknown): ExportData {
  const d = (raw ?? {}) as Row;
  const list = (v: unknown) => ((v ?? []) as Row[]);
  return { applications: list(d.applications), notApplied: list(d.not_applied), inc: list(d.inc), consultations: list(d.consultations), exportedAt: s(d.exported_at) };
}

/**
 * Adds the certificate number of each scholar to the application rows (from renewal_export_csr, Phase 8). Scholars without a certificate keep empty cells,
 * and when the answer is missing altogether (Phase 8 not installed yet) the rows are returned unchanged.
 */
export function attachCsrNumbers(data: ExportData, raw: unknown): ExportData {
  if (!Array.isArray(raw)) return data;
  const byScholar = new Map<string, Row>();
  for (const c of raw as Row[]) byScholar.set(s(c.scholar_id_number), c);
  return { ...data, applications: data.applications.map(r => { const c = byScholar.get(s(r.scholar_id_number)); return c ? { ...r, csr_number: s(c.csr_number), csr_issued_at: c.issued_at } : r; }) };
}

/** A date or moment as "2026-10-14" in Philippine time (what the office reads), or "" when empty. */
export function manilaDate(value: unknown): string {
  const v = sOrNull(value);
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const t = new Date(v);
  return Number.isNaN(t.getTime()) ? "" : new Date(t.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}
export function manilaDateTime(value: unknown): string {
  const v = sOrNull(value);
  if (!v) return "";
  const t = new Date(v);
  if (Number.isNaN(t.getTime())) return "";
  return new Date(t.getTime() + 8 * 3600000).toISOString().slice(0, 16).replace("T", " ");
}

const DOC_STATUS: Record<string, string> = { accepted: "Approved", submitted: "Waiting for review", returned: "Returned" };
export const docStatusText = (v: unknown): string => DOC_STATUS[s(v)] ?? "";
const RESULT: Record<string, string> = { renewed: "Renewed", renewed_probationary: "Renewed (Probationary)", reconsidered: "Renewed (Reconsidered)", removed: "Removed" };
export const resultText = (v: unknown): string => RESULT[s(v)] ?? "";
const DH_DECISION: Record<string, string> = { approved_probationary: "Approved — Probationary", removed: "Removed", reconsidered: "Reconsidered" };
export const divisionHeadText = (v: unknown): string => DH_DECISION[s(v)] ?? "";
const INC_STATE: Record<string, string> = { open: "Open", resolved_passed: "Completed — passed", resolved_failed: "Completed — failed", counted_failed: "Counted as failed", decided: "Decided by the evaluator" };
const SLOT_STATE: Record<string, string> = { booked: "Booked", attended: "Attended", no_show: "No-show" };

export function sdpText(r: Row): string {
  if (r.sdp_applicable === false || r.sdp_applicable == null) return r.sdp_complied == null ? "" : "Not required";
  if (r.sdp_complied === true) return "Complied";
  if (r.sdp_complied === false) return `Not complied: ${s(r.sdp_missing)}`.trim().replace(/:$/, "");
  return "";
}
const yesNo = (v: unknown): string => (v ? "Yes" : "No");

/** Free text for a cell. The workbook writer stores every text cell as plain text (never as a formula), so a note that starts with = + - or @ stays text. */
export function safeText(value: unknown): string {
  return s(value);
}

export function exportFileName(termLabel: string, at = new Date(), filtered = false): string {
  const base = termLabel.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "Renewal";
  const day = new Date(at.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  return `Scholar-Renewal-${base}${filtered ? "-filtered" : ""}-${day}.xlsx`;
}

/** The sheets of the workbook: Summary, Applications, Not applied, By school, INC, Consultations. */
export function buildReportSheets(dash: DashboardData, data: ExportData, filter: ExportFilter = NO_FILTER): ReportSheet[] {
  const t = dash.totals;
  const summary: ReportCell[][] = [
    ["Renewal term", dash.termLabel],
    ["This file contains", describeFilter(filter)],
    ["Scholars in this file", data.applications.length + data.notApplied.length],
    ["The numbers below are for the whole term, whatever the filter", ""],
    ["Window opens", dash.window?.opensOn ?? ""], ["Window closes", dash.window?.closesOn ?? ""],
    ["Report made (Philippine time)", manilaDateTime(data.exportedAt)],
    ["", ""],
    ["Scholars who can renew", t.canRenew], ["Applied", t.applied], ["Not applied yet", t.notApplied], ["Not required this term", t.notRequired],
    ["Late applications", t.late], ["  waiting for acceptance", t.lateWaiting], ["  declined", t.lateDeclined], ["Returned to the scholar", t.returned],
    ["", ""],
    ["Renewed", t.renewed], ["  Renewed — regular", t.renewedRegular], ["  Renewed — Probationary", t.renewedProbationary], ["  Renewed — Reconsidered", t.renewedReconsidered], ["Removed", t.removed],
    ["Average days from application to renewal", t.avgDaysToRenew],
    ["", ""],
    ["SDP on hold", dash.sdpAndGrades.sdpOnHold], ["Waiting for grades", dash.sdpAndGrades.waitingGrades], ["Needing the evaluator's review", dash.sdpAndGrades.reviewNeeded],
    ["With a failed subject", dash.sdpAndGrades.withFailed], ["With an INC subject", dash.sdpAndGrades.withInc],
    ["", ""],
    ["Open INC subjects", dash.inc.open], ["  without a deadline yet", dash.inc.noDeadline], ["  due within 7 days", dash.inc.dueIn7Days], ["  overdue", dash.inc.overdue],
    ["INC completed — passed", dash.inc.resolvedPassed], ["INC failed or counted as failed", dash.inc.failedOrCounted],
    ["", ""],
    ["Consultations required", dash.consultations.required], ["  done", dash.consultations.done], ["  booked (upcoming)", dash.consultations.bookedUpcoming], ["  still to be booked", dash.consultations.needBooking],
    ["Appointments attended", dash.consultations.attended], ["Missed appointments (no-shows)", dash.consultations.noShows],
    ["", ""],
    ["Documents waiting for review", dash.documents.waitingReview], ["Documents approved", dash.documents.approved], ["Documents returned", dash.documents.returned],
    ["", ""],
    ["With the Division Head", dash.divisionHead.waiting], ["Sent back to the evaluator", dash.divisionHead.sentBack],
    ["Division Head: approved Probationary", dash.divisionHead.approvedProbationary], ["Division Head: reconsidered", dash.divisionHead.reconsidered], ["Division Head: removed", dash.divisionHead.removed],
    ["", ""],
    ["Applications by stage", ""],
    ...Object.entries(dash.byStage).sort((a, b) => b[1] - a[1]).map(([st, c]): ReportCell[] => ["  " + stageTitle(st), c]),
    ["", ""],
    ["Applications by rule", ""],
    ...Object.entries(dash.byRule).sort((a, b) => a[0].localeCompare(b[0])).map(([rule, c]): ReportCell[] => ["  " + rule, c]),
  ];

  const applications: ReportSheet = {
    name: "Applications",
    headers: ["Scholar ID", "Name", "School", "Program", "Year level", "Scholarship status now", "Stage", "Rule", "Grades checked", "Failed subjects", "Open INC", "Earlier probation", "SDP",
      "Study plan", "INC letter", "Prospectus", "Consultation required", "Consultation done", "Next consultation", "No-shows", "Applied late", "Late decision", "Division Head decision",
      "Division Head decided", "Result", "Applied", "Confirmed", "Evaluator's note", "Scholar's note", "CSR number", "CSR made"],
    rows: data.applications.map((r): ReportCell[] => [
      s(r.scholar_id_number), safeText(r.name), safeText(r.school), safeText(r.program), s(r.year_level), s(r.scholar_status),
      s(r.stage) in STAGE_INFO ? STAGE_INFO[s(r.stage) as RenewalStage].title : s(r.stage), s(r.rule_code), s(r.basis), n(r.failed_count), n(r.inc_open), yesNo(r.previous_probation), sdpText(r),
      docStatusText(r.study_plan), docStatusText(r.inc_letter), docStatusText(r.prospectus), yesNo(r.consultation_required), manilaDate(r.consultation_done_at), manilaDateTime(r.next_consultation), n(r.no_shows),
      yesNo(r.late), s(r.late_decision), divisionHeadText(r.division_head_decision), manilaDate(r.division_head_decided_at), resultText(r.result), manilaDate(r.applied_at), manilaDate(r.confirmed_at),
      safeText(r.evaluator_note || r.not_required_reason), safeText(r.scholar_note), s(r.csr_number), manilaDate(r.csr_issued_at),
    ]),
  };
  const notApplied: ReportSheet = {
    name: "Not applied",
    headers: ["Scholar ID", "Name", "School", "Program", "Year level", "Scholarship status"],
    rows: data.notApplied.map((r): ReportCell[] => [s(r.scholar_id_number), safeText(r.name), safeText(r.school), safeText(r.program), s(r.year_level), s(r.scholar_status)]),
  };
  const bySchool: ReportSheet = {
    name: "By school",
    headers: ["School", "Applied", "Renewed", "Removed", "Still in progress", "Not applied yet", "Share applied"],
    rows: dash.bySchool.filter(x => filter.schools.length === 0 || filter.schools.includes(x.school)).map((x): ReportCell[] => [safeText(x.school), x.applied, x.renewed, x.removed, x.pending, x.notApplied, percentText(x.applied, x.applied + x.notApplied)]),
  };
  const inc: ReportSheet = {
    name: "INC",
    headers: ["Scholar ID", "Name", "School", "Subject code", "Subject", "State", "Consultation", "Days given", "Deadline", "Days left", "Evaluator's decision", "Reason"],
    rows: data.inc.map((r): ReportCell[] => [s(r.scholar_id_number), safeText(r.name), safeText(r.school), s(r.subject_code), safeText(r.subject), INC_STATE[s(r.state)] ?? s(r.state), manilaDate(r.consultation_date),
      r.days_given == null ? null : n(r.days_given), manilaDate(r.deadline), r.days_left == null ? null : n(r.days_left), s(r.decision), safeText(r.decision_reason)]),
  };
  const consultations: ReportSheet = {
    name: "Consultations",
    headers: ["Scholar ID", "Name", "Date and time (Philippine time)", "Status", "Consultation staff"],
    rows: data.consultations.map((r): ReportCell[] => [s(r.scholar_id_number), safeText(r.name), manilaDateTime(r.starts_at), SLOT_STATE[s(r.state)] ?? s(r.state), safeText(r.staff)]),
  };
  return [{ name: "Summary", headers: ["Measure", "Value"], rows: summary }, applications, notApplied, bySchool, inc, consultations];
}

export { termLabelOf };
