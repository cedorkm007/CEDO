// ─────────────────────────────────────────────────────────────
// src/lib/gradeEvidenceApi.ts
// Reads of the audit trail and supporting documents, shared by the School Portal and the staff tool. Who sees what
// is decided by the database (a school sees only its own school's rows; staff with the scholars_grades_monitoring
// tag see all) — these calls just ask. See supabase_migration_submission_audit_documents.sql.
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";
import { DOCUMENT_BUCKET, type AuditEntry, type AuditSource, type GradeDocument } from "./gradeEvidence";

export type Loaded<T> = { ok: true; rows: T[] } | { ok: false; error: string };

function toAudit(r: Record<string, unknown>): AuditEntry {
  const num = (v: unknown) => (v == null ? null : Number(v));
  const str = (v: unknown) => (v == null ? null : String(v));
  return {
    id: Number(r.id), changedAt: String(r.changed_at), action: r.action as AuditEntry["action"], source: r.source as AuditSource,
    actorType: r.actor_type as AuditEntry["actorType"], actorLabel: str(r.actor_label),
    scholarIdNumber: String(r.scholar_id_number), schoolYear: String(r.school_year ?? ""), semester: String(r.semester ?? ""),
    oldSubjectCode: str(r.old_subject_code), newSubjectCode: str(r.new_subject_code),
    oldSubject: str(r.old_subject), newSubject: str(r.new_subject),
    oldGrade: str(r.old_grade), newGrade: str(r.new_grade),
    oldUnits: num(r.old_units), newUnits: num(r.new_units),
    oldExclude: r.old_exclude == null ? null : !!r.old_exclude, newExclude: r.new_exclude == null ? null : !!r.new_exclude,
  };
}

/** The change history of one scholar's subjects/grades, newest first. Pass `periodId` to see only one period. */
export async function fetchGradeAudit(scholarIdNumber: string, periodId?: string | null, limit = 200): Promise<Loaded<AuditEntry>> {
  let query = supabase.from("scholar_grade_audit").select("*").eq("scholar_id_number", scholarIdNumber);
  if (periodId) query = query.eq("period_id", periodId);
  const { data, error } = await query.order("changed_at", { ascending: false }).order("id", { ascending: false }).limit(limit);
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: (data ?? []).map(r => toAudit(r as Record<string, unknown>)) };
}

function toDocument(r: Record<string, unknown>): GradeDocument {
  return {
    id: String(r.id), scholarIdNumber: String(r.scholar_id_number), periodId: String(r.period_id), storagePath: String(r.storage_path),
    fileName: String(r.file_name), mimeType: String(r.mime_type), sizeBytes: Number(r.size_bytes ?? 0), uploadedAt: String(r.uploaded_at),
  };
}

/** The supporting documents attached for one scholar in one period, oldest first. */
export async function fetchGradeDocuments(scholarIdNumber: string, periodId: string): Promise<Loaded<GradeDocument>> {
  const { data, error } = await supabase.from("grade_documents").select("*")
    .eq("scholar_id_number", scholarIdNumber).eq("period_id", periodId).order("uploaded_at");
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: (data ?? []).map(r => toDocument(r as Record<string, unknown>)) };
}

/** A short-lived link to open a private document (the bucket is not public). */
export async function getDocumentUrl(storagePath: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const { data, error } = await supabase.storage.from(DOCUMENT_BUCKET).createSignedUrl(storagePath, 300);
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't open the file." };
  return { ok: true, url: data.signedUrl };
}
