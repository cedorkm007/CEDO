// Survey Results: how a survey was asked, and how many scholars completed / are pending / declined / were released for each activity.

export const TRIGGER_LABELS: Record<string, string> = {
  qr: "QR scan or code", scanner: "Scanning Tools", manual: "Manual credit", picture: "Picture approval", reconsideration: "SDP reconsideration", none: "Not recorded",
};
export const triggerLabel = (trigger: string | null | undefined): string => TRIGGER_LABELS[trigger || "none"] ?? trigger ?? "";

export interface RosterRow {
  activityId?: string | null; activityType?: string | null; activityName?: string; trigger?: string | null;
  status: "completed" | "in_progress" | "declined" | "released";
}
export interface ActivityCountRow { id: string; name: string; detached: boolean; completed: number; in_progress: number; declined: number; released: number }

/** Every reconsideration request counts together, as one line. */
export const RECONSIDERATION = "reconsideration";
export const activityKey = (r: RosterRow): string | null => (r.activityType === RECONSIDERATION ? RECONSIDERATION : r.activityId ?? null);

export function activityCounts(activities: { id: string; name: string; detached: boolean }[], roster: RosterRow[]): ActivityCountRow[] {
  const rows = new Map<string, ActivityCountRow>();
  const row = (id: string, name: string, detached: boolean) => {
    if (!rows.has(id)) rows.set(id, { id, name, detached, completed: 0, in_progress: 0, declined: 0, released: 0 });
    return rows.get(id)!;
  };
  for (const a of activities) row(a.id, a.name, a.detached);
  for (const r of roster) {
    const key = activityKey(r);
    if (!key) continue;
    row(key, key === RECONSIDERATION ? "SDP reconsideration" : r.activityName ?? "Activity", key !== RECONSIDERATION)[r.status] += 1;
  }
  return [...rows.values()];
}

/** The rows of the chosen activity ("" = all) that were asked the chosen way ("" = any). */
export const filterRoster = <T extends RosterRow>(roster: T[], activity: string, trigger: string): T[] =>
  roster.filter(r => (!activity || activityKey(r) === activity) && (!trigger || (r.trigger || "none") === trigger));

/** A short code of the "Who was asked" list: it changes when a response arrives, is answered further, finished, deleted or restored. */
export const rosterSignature = (roster: (RosterRow & { scholarIdNumber: string; updatedAt?: string | null })[]): string =>
  roster.map(r => [r.scholarIdNumber, r.activityId ?? "", r.status, r.trigger ?? "", r.updatedAt ?? ""].join("|")).sort().join(";");

// Which sections have their results (charts and answers) hidden: remembered in this browser, per survey.
type KeyStore = Pick<Storage, "getItem" | "setItem">;
const hiddenKey = (surveyId: string) => `survey-results-hidden:${surveyId}`;
export function readHiddenSections(surveyId: string, store?: KeyStore): string[] {
  try {
    const value: unknown = JSON.parse((store ?? localStorage).getItem(hiddenKey(surveyId)) ?? "[]");
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch { return []; }
}
export function writeHiddenSections(surveyId: string, hidden: string[], store?: KeyStore): void {
  try { (store ?? localStorage).setItem(hiddenKey(surveyId), JSON.stringify(hidden)); } catch { /* private window: the choice lasts until the page is closed */ }
}

/** Items under their section headings, sections in survey order; items without a section come first. Empty sections are left out. */
export function bySection<T>(items: T[], sections: { id: string; title: string; description: string }[], sectionOf: (item: T) => string | null | undefined) {
  const known = new Set(sections.map(s => s.id));
  const loose = items.filter(i => !known.has(sectionOf(i) ?? ""));
  const filled = sections.map(s => ({ key: s.id, title: s.title, description: s.description, items: items.filter(i => sectionOf(i) === s.id) })).filter(g => g.items.length > 0);
  return loose.length > 0 ? [{ key: "none", title: filled.length > 0 ? "Not in a section" : "Results", description: "", items: loose }, ...filled] : filled;
}
