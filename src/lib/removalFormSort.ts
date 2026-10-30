// ─────────────────────────────────────────────────────────────
// src/lib/removalFormSort.ts
// Ordering the list of scholarship termination forms by name, year level, school or program (plain maths, no React, so tests can run it alone).
// ─────────────────────────────────────────────────────────────
export type RemovalSortKey = "name" | "yearLevel" | "school" | "program";
export interface RemovalSortable { name: string; yearLevel: string; school: string; program: string }

/** "1st Year" -> 1, "3rd Year" -> 3; anything without a number goes last. */
export const yearRank = (y: string): number => { const n = /(\d+)/.exec(y ?? "")?.[1]; return n ? Number(n) : 99; };
const text = (a: string, b: string) => (a ?? "").localeCompare(b ?? "", undefined, { sensitivity: "base" });

/** A copy of the list ordered by the chosen column (year levels in their natural order, the rest alphabetically); equal rows are ordered by name. `dir` -1 reverses it. */
export function sortRemovalForms<T extends RemovalSortable>(items: readonly T[], key: RemovalSortKey, dir: 1 | -1 = 1): T[] {
  const byKey = (a: T, b: T) => (key === "yearLevel" ? yearRank(a.yearLevel) - yearRank(b.yearLevel) || text(a.yearLevel, b.yearLevel) : text(a[key], b[key]));
  return [...items].sort((a, b) => (byKey(a, b) || text(a.name, b.name)) * dir);
}
