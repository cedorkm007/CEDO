// ─────────────────────────────────────────────────────────────
// src/lib/gradeEvidence.ts
// Pure helpers shared by the School Portal, the staff Scholars' Grades Monitoring tool and their tests (no Supabase,
// no React): the audit trail's wording, supporting-document rules and storage paths, and date/size formatting.
// See supabase_migration_submission_audit_documents.sql for what the database enforces on its side.
// ─────────────────────────────────────────────────────────────

// ── Audit trail ──────────────────────────────────────────────
export type AuditSource = "manual" | "csv" | "staff" | "correction" | "system";

export interface AuditEntry {
  id: number;
  changedAt: string;
  action: "insert" | "update" | "delete";
  source: AuditSource;
  actorType: "school" | "staff" | "system";
  actorLabel: string | null;
  scholarIdNumber: string;
  schoolYear: string;
  semester: string;
  oldSubjectCode: string | null; newSubjectCode: string | null;
  oldSubject: string | null; newSubject: string | null;
  oldGrade: string | null; newGrade: string | null;
  oldUnits: number | null; newUnits: number | null;
  oldExclude: boolean | null; newExclude: boolean | null;
}

export const SOURCE_LABEL: Record<AuditSource, string> = {
  manual: "Manual entry",
  csv: "CSV upload",
  staff: "CEDO staff",
  correction: "Approved correction",
  system: "System",
};

/** "Santos School" / "Sam Staff" / "System" — who made the change. */
export function actorName(e: Pick<AuditEntry, "actorType" | "actorLabel">): string {
  if (e.actorLabel) return e.actorLabel;
  return e.actorType === "school" ? "School" : e.actorType === "staff" ? "CEDO staff" : "System";
}

const show = (v: string | null) => (v == null || v === "" ? "no grade" : v);
const unitsText = (v: number | null) => (v == null ? "no units" : `${v} unit${v === 1 ? "" : "s"}`);

/** One readable line for an audit entry: what changed, from what, to what. */
export function describeAuditEntry(e: AuditEntry): string {
  const name = e.newSubject ?? e.oldSubject ?? "(subject)";
  if (e.action === "insert") {
    const bits = [`grade ${show(e.newGrade)}`];
    if (e.newUnits != null) bits.push(unitsText(e.newUnits));
    if (e.newExclude) bits.push("excluded from GWA");
    return `Added “${name}” — ${bits.join(", ")}`;
  }
  if (e.action === "delete") return `Removed “${name}” (was ${show(e.oldGrade)})`;
  const changes: string[] = [];
  if (e.oldGrade !== e.newGrade) changes.push(`grade ${show(e.oldGrade)} → ${show(e.newGrade)}`);
  if (e.oldUnits !== e.newUnits) changes.push(`units ${e.oldUnits ?? "none"} → ${e.newUnits ?? "none"}`);
  if (e.oldExclude !== e.newExclude) changes.push(e.newExclude ? "now excluded from GWA" : "now counted in GWA");
  if (e.oldSubject !== e.newSubject) changes.push(`renamed “${e.oldSubject ?? ""}” → “${e.newSubject ?? ""}”`);
  if (e.oldSubjectCode !== e.newSubjectCode) changes.push(`code ${e.oldSubjectCode || "none"} → ${e.newSubjectCode || "none"}`);
  return `${name}: ${changes.length > 0 ? changes.join("; ") : "updated"}`;
}

// ── Dates and sizes ──────────────────────────────────────────
/** "Oct 9, 2026, 2:30 PM" in the office's time zone (Philippines). */
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" });
}

export function formatDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" });
}

export function fileSizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Supporting documents ─────────────────────────────────────
export const DOCUMENT_BUCKET = "grade-documents";
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENTS_PER_SCHOLAR_PERIOD = 5;
export const ALLOWED_DOCUMENT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export const DOCUMENT_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp";

export interface GradeDocument {
  id: string;
  scholarIdNumber: string;
  periodId: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
}

/** The first reason a file cannot be attached, or null when it can. */
export function validateDocumentFile(file: { name: string; type: string; size: number }, existingCount: number): string | null {
  if (existingCount >= MAX_DOCUMENTS_PER_SCHOLAR_PERIOD) return `A scholar can have at most ${MAX_DOCUMENTS_PER_SCHOLAR_PERIOD} documents per period. Remove one first.`;
  if (!(ALLOWED_DOCUMENT_TYPES as readonly string[]).includes(file.type)) return "Only PDF, JPG, PNG or WebP files can be attached.";
  if (file.size <= 0) return "That file is empty.";
  if (file.size > MAX_DOCUMENT_BYTES) return `“${file.name}” is ${fileSizeLabel(file.size)} — files can be at most 10 MB.`;
  return null;
}

/** A file name that is safe in a storage path: no slashes or odd characters, spaces become underscores, extension kept, at most 80 characters. */
export function safeFileName(rawName: string): string {
  // Only the last part of a path: a name containing folders (with / or the backslash) cannot add folders to the storage path.
  const leaf = rawName.split("/").pop() ?? rawName;
  const name = leaf.split(String.fromCharCode(92)).pop() ?? leaf;
  const dot = name.lastIndexOf(".");
  const base = (dot > 0 ? name.slice(0, dot) : name).normalize("NFKD").replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").replace(/^[_.-]+|[_.-]+$/g, "");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  const trimmed = (base || "document").slice(0, 70);
  return ext ? `${trimmed}.${ext}` : trimmed;
}

/** `<school id>/<period id>/<scholar id>/<unique>-<file name>` — the folder layout the database's storage rules expect. */
export function documentStoragePath(schoolId: string, periodId: string, scholarIdNumber: string, fileName: string, unique: string): string {
  return `${schoolId}/${periodId}/${scholarIdNumber}/${unique}-${safeFileName(fileName)}`;
}
