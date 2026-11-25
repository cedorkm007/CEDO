// ─────────────────────────────────────────────────────────────
// src/lib/dailyRecordEdit.ts
// Consultation Tool > Daily Records: editing the Findings and the Staff recommendations after the visit (supabase_migration_daily_records_edit.sql).
// Only the staff member who wrote the record can edit it (the database enforces it; this file only decides whether to SHOW the Edit button).
// No React / Supabase, so tests can run it alone.
// ─────────────────────────────────────────────────────────────

export const EDIT_TEXT_LIMIT = 20000;
export const EDIT_REASON_LIMIT = 500;

/** Show the Edit button only to the person who wrote the record. */
export const canEditRecord = (consultedById: string | null | undefined, me: string | null | undefined): boolean => !!consultedById && !!me && consultedById === me;

/** "Nov 25, 2026, 10:42 AM" in Philippine time. */
export function formatEditTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/** "Edited · Nov 25, 2026 by Maria Cruz" (and "· 3 times" after the second edit); null when the record was never edited. */
export function editedLine(r: { editCount: number; lastEditedAt: string | null; editedByName: string }): string | null {
  if (!r.editCount || r.editCount < 1) return null;
  const when = r.lastEditedAt ? new Date(r.lastEditedAt).toLocaleDateString("en-US", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" }) : "";
  return `Edited${when ? ` · ${when}` : ""}${r.editedByName ? ` by ${r.editedByName}` : ""}${r.editCount > 1 ? ` · ${r.editCount} times` : ""}`;
}

/** True when the typed text differs from what is saved (spaces at the ends do not count: the database trims them). */
export const editChanged = (saved: { findings: string; staffRecommendations: string }, findings: string, recs: string): boolean =>
  findings.trim() !== saved.findings.trim() || recs.trim() !== saved.staffRecommendations.trim();

/** What is wrong with the typed text, or "" when it can be saved. */
export function textProblem(findings: string, recs: string, reason: string): string {
  if (findings.trim().length > EDIT_TEXT_LIMIT) return `The findings are too long (the limit is ${EDIT_TEXT_LIMIT.toLocaleString("en-US")} characters).`;
  if (recs.trim().length > EDIT_TEXT_LIMIT) return `The staff recommendations are too long (the limit is ${EDIT_TEXT_LIMIT.toLocaleString("en-US")} characters).`;
  if (reason.trim().length > EDIT_REASON_LIMIT) return `The reason is too long (the limit is ${EDIT_REASON_LIMIT} characters).`;
  return "";
}
