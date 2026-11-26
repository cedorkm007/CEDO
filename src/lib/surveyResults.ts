// Survey Results: how many scholars completed / are pending / declined / were released, for each activity of a survey.

export interface ActivityCountRow { id: string; name: string; detached: boolean; completed: number; in_progress: number; declined: number; released: number }

export function activityCounts(
  activities: { id: string; name: string; detached: boolean }[],
  roster: { activityId?: string | null; activityName?: string; status: "completed" | "in_progress" | "declined" | "released" }[],
): ActivityCountRow[] {
  const rows = new Map<string, ActivityCountRow>();
  const row = (id: string, name: string, detached: boolean) => {
    if (!rows.has(id)) rows.set(id, { id, name, detached, completed: 0, in_progress: 0, declined: 0, released: 0 });
    return rows.get(id)!;
  };
  for (const a of activities) row(a.id, a.name, a.detached);
  for (const r of roster) if (r.activityId) row(r.activityId, r.activityName ?? "Activity", true)[r.status] += 1;
  return [...rows.values()];
}
