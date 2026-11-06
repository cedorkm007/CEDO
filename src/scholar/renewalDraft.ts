import { SELF_GRADES_MAX_IMAGES, SELF_GRADES_MAX_SUBJECTS } from "@/lib/renewal";

/**
 * What the scholar has typed and picked while applying for renewal or entering grades, kept on the device (see src/lib/formDraft.ts) so that it is still there after
 * going to another tile, reloading the page or the phone closing the browser. Only plain data and picked files; the choices the database makes (the SDP result, who must approve) are never kept:
 * they are asked again when the form opens.
 */
export interface DraftGradeRow { code: string; subject: string; units: string; grade: string }
export interface ApplyDraft {
  step: 1 | 2 | 3;
  school: string; program: string; yearLevel: string; note: string;
  askReconsideration: boolean;
  gRows: DraftGradeRow[]; gFiles: File[]; gAck: boolean;
  incFiles: Record<string, File[]>;
}
export interface SelfGradesDraft { rows: DraftGradeRow[]; keep: { name: string; path: string }[]; newFiles: File[]; ack: boolean }

export const applyDraftKey = (scholarIdNumber: string, windowId: string) => `renewal-apply:${scholarIdNumber}:${windowId}`;
export const selfGradesDraftKey = (scholarIdNumber: string, recordId: string) => `renewal-grades:${scholarIdNumber}:${recordId}`;

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const isFile = (v: unknown): v is File => typeof Blob !== "undefined" && v instanceof Blob && typeof (v as File).name === "string";

function cleanRows(v: unknown): DraftGradeRow[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, SELF_GRADES_MAX_SUBJECTS).map(r => ({ code: str((r as DraftGradeRow)?.code, 30), subject: str((r as DraftGradeRow)?.subject, 150), units: str((r as DraftGradeRow)?.units, 5), grade: str((r as DraftGradeRow)?.grade, 12) }));
}
const cleanFiles = (v: unknown, max: number): File[] => (Array.isArray(v) ? v.filter(isFile).slice(0, max) : []);

/** Checks a draft read from the device and rebuilds it with the right shape; null when it is not a usable draft. */
export function sanitizeApplyDraft(raw: unknown, incKinds: string[]): ApplyDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const rows = cleanRows(r.gRows);
  const incRaw = (r.incFiles && typeof r.incFiles === "object" ? r.incFiles : {}) as Record<string, unknown>;
  const incFiles: Record<string, File[]> = {};
  for (const k of incKinds) incFiles[k] = cleanFiles(incRaw[k], 3);
  return {
    // what the system has for the scholar is loaded again on the second step, so a draft never reopens on the last step (it could be sent without it)
    step: r.step === 1 ? 1 : 2,
    school: str(r.school, 200), program: str(r.program, 200), yearLevel: str(r.yearLevel, 60), note: str(r.note, 1000),
    askReconsideration: r.askReconsideration === true,
    gRows: rows.length > 0 ? rows : [{ code: "", subject: "", units: "", grade: "" }],
    gFiles: cleanFiles(r.gFiles, SELF_GRADES_MAX_IMAGES), gAck: r.gAck === true,
    incFiles,
  };
}

export function sanitizeSelfGradesDraft(raw: unknown): SelfGradesDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const rows = cleanRows(r.rows);
  const keep = Array.isArray(r.keep) ? r.keep.filter(k => k && typeof (k as { path?: unknown }).path === "string" && typeof (k as { name?: unknown }).name === "string").map(k => ({ name: String((k as { name: string }).name), path: String((k as { path: string }).path) })) : [];
  return { rows: rows.length > 0 ? rows : [{ code: "", subject: "", units: "", grade: "" }], keep, newFiles: cleanFiles(r.newFiles, SELF_GRADES_MAX_IMAGES), ack: r.ack === true };
}

const rowEmpty = (r: DraftGradeRow) => !r.code.trim() && !r.subject.trim() && !r.units.trim() && !r.grade.trim();

/** Has the scholar typed or picked anything worth keeping? An untouched form saves nothing (so no "draft" is offered back for a form that was only opened). */
export function applyDraftHasContent(d: ApplyDraft, defaults: { school: string; program: string; yearLevel: string }): boolean {
  return d.school !== defaults.school || d.program !== defaults.program || d.yearLevel !== defaults.yearLevel || d.note.trim() !== "" || d.askReconsideration
    || d.gRows.some(r => !rowEmpty(r)) || d.gFiles.length > 0 || d.gAck || Object.values(d.incFiles).some(f => f.length > 0);
}
export function selfGradesDraftHasContent(d: SelfGradesDraft): boolean {
  return d.rows.some(r => !rowEmpty(r)) || d.newFiles.length > 0 || d.ack || d.keep.length > 0;
}
