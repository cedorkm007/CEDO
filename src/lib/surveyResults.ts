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
