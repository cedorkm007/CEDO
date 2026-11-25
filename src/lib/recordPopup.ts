// ─────────────────────────────────────────────────────────────
// src/lib/recordPopup.ts
// Consultation Tool > Daily Records: the larger record pop-up (supabase_migration_daily_records_popup.sql).
// The logic that does not need React or Supabase: the names of the saved drafts, what a stored draft looks like, which of two drafts is the newer, whether a draft differs from the form,
// the time shown as "Draft saved · 10:42 AM", inserting a quick phrase at the cursor, the first line of a text. Tests run it alone.
// ─────────────────────────────────────────────────────────────
import { EDIT_TEXT_LIMIT } from "./dailyRecordEdit";

export type DraftValues = Record<string, string | boolean>;
export interface StoredDraft { values: DraftValues; savedAt: string; base: number | null }

/** The name a draft is kept under: one per record being edited, per appointment form, or per new record of a scholar. */
export const draftKey = {
  edit: (recordId: string) => `edit:${recordId}`,
  slot: (slotId: string) => `slot:${slotId}`,
  newFor: (scholarIdNumber: string) => `new:${scholarIdNumber.trim()}`,
};

/** Where this browser tab keeps its own copy (it is cleared when the tab is closed, which matters on a shared office computer). */
export const localDraftName = (key: string) => `cedo.consultation.draft.${key}`;

/** Reads what the browser tab stored; anything that does not look right is ignored. */
export function parseStoredDraft(raw: string | null): StoredDraft | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<StoredDraft>;
    if (!v || typeof v !== "object" || !v.values || typeof v.values !== "object" || Array.isArray(v.values)) return null;
    const values: DraftValues = {};
    for (const [k, x] of Object.entries(v.values)) if (typeof x === "string" || typeof x === "boolean") values[k] = x;
    if (typeof v.savedAt !== "string" || Number.isNaN(Date.parse(v.savedAt))) return null;
    return { values, savedAt: v.savedAt, base: typeof v.base === "number" && Number.isFinite(v.base) ? v.base : null };
  } catch { return null; }
}

/** The newer of two drafts (the one saved last); null when there is none. */
export function newerDraft(a: StoredDraft | null, b: StoredDraft | null): StoredDraft | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(b.savedAt) > Date.parse(a.savedAt) ? b : a;
}

const same = (a: string | boolean | undefined, b: string | boolean | undefined): boolean =>
  typeof a === "string" && typeof b === "string" ? a.trim() === b.trim() : (a ?? "") === (b ?? "");

/** True when the form is different from where it started (spaces at the ends of the text do not count). */
export function differsFrom(values: DraftValues, baseline: DraftValues): boolean {
  const keys = new Set([...Object.keys(values), ...Object.keys(baseline)]);
  for (const k of keys) if (!same(values[k], baseline[k])) return true;
  return false;
}

/** "10:42 AM" in Philippine time. */
export function savedAtLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" });
}

/**
 * Puts a quick phrase into the text where the cursor is (or replaces what is selected). When there is text before the cursor that does not end a line, the phrase starts on a new line.
 * Returns the new text and where the cursor goes; when the phrase would make the text longer than the limit, nothing changes (`ok: false`).
 */
export function insertPhrase(text: string, start: number, end: number, phrase: string, limit = EDIT_TEXT_LIMIT): { ok: boolean; text: string; caret: number } {
  const s = Math.min(Math.max(0, Math.min(start, end)), text.length), e = Math.min(Math.max(start, end, s), text.length);
  let before = text.slice(0, s);
  const after = text.slice(e);
  let lead = "";
  if (before.length > 0 && !before.endsWith("\n")) {
    const trimmed = before.replace(/[ \t]+$/, "");      // no stray spaces before the new line
    before = trimmed;
    if (trimmed.length > 0 && !trimmed.endsWith("\n")) lead = "\n";
  }
  const next = before + lead + phrase + after;
  if (next.length > limit) return { ok: false, text, caret: s };
  return { ok: true, text: next, caret: (before + lead + phrase).length };
}

/** The first line of a text, cut to `max` characters with "…" ("—" when empty). */
export function firstLine(text: string, max = 90): string {
  const line = (text ?? "").split(/\r?\n/).map(l => l.trim()).find(l => l !== "") ?? "";
  if (!line) return "—";
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}
