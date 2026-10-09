// ─────────────────────────────────────────────────────────────
// src/school/submissionApi.ts
// What a school does about submission, corrections and documents. The database enforces every rule (see
// supabase_migration_submission_audit_documents.sql); a failed call returns the database's own message, which is
// written to be shown to the school.
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";
import { documentStoragePath, DOCUMENT_BUCKET, validateDocumentFile, type GradeDocument } from "@/lib/gradeEvidence";
import type { CorrectionRequest, CorrectionStatus, Submission, SubmissionState } from "./submissionLogic";

type Done = { ok: true } | { ok: false; error: string };

function toSubmission(r: Record<string, unknown>): Submission {
  return {
    id: String(r.id), periodId: String(r.period_id), status: r.status as SubmissionState,
    submittedAt: r.submitted_at ? String(r.submitted_at) : null, scholarsTotal: r.scholars_total == null ? null : Number(r.scholars_total),
    submitCount: Number(r.submit_count ?? 1), reopenedAt: r.reopened_at ? String(r.reopened_at) : null, reopenNote: r.reopen_note ? String(r.reopen_note) : null,
  };
}

/** This school's submission for one period, or null when it has not submitted (RLS limits the read to the signed-in school). */
export async function fetchMySubmission(periodId: string): Promise<{ ok: true; submission: Submission | null } | { ok: false; error: string }> {
  const { data, error } = await supabase.from("school_period_submissions").select("*").eq("period_id", periodId).maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, submission: data ? toSubmission(data as Record<string, unknown>) : null };
}

export async function submitPeriod(periodId: string): Promise<Done> {
  const { error } = await supabase.rpc("submit_school_period", { p_period_id: periodId });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export function toCorrection(r: Record<string, unknown>): CorrectionRequest {
  const str = (v: unknown) => (v == null ? null : String(v));
  return {
    id: String(r.id), schoolId: String(r.school_id), periodId: String(r.period_id), gradeId: str(r.grade_id),
    scholarIdNumber: String(r.scholar_id_number), subjectCode: String(r.subject_code ?? ""), subject: String(r.subject),
    currentGrade: str(r.current_grade), proposedGrade: str(r.proposed_grade), reason: String(r.reason ?? ""),
    status: r.status as CorrectionStatus, requestedAt: String(r.requested_at), reviewedByLabel: str(r.reviewed_by_label),
    reviewedAt: str(r.reviewed_at), reviewNote: str(r.review_note), appliedAt: str(r.applied_at),
  };
}

/** Every correction request this school has made (all periods), newest first. */
export async function fetchMyCorrections(): Promise<{ ok: true; rows: CorrectionRequest[] } | { ok: false; error: string }> {
  const { data, error } = await supabase.from("grade_correction_requests").select("*").order("requested_at", { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: (data ?? []).map(r => toCorrection(r as Record<string, unknown>)) };
}

export async function requestCorrection(gradeId: string, reason: string, proposedGrade: string): Promise<Done> {
  const { error } = await supabase.rpc("request_grade_correction", { p_grade_id: gradeId, p_reason: reason.trim(), p_proposed_grade: proposedGrade.trim() || null });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function cancelCorrection(requestId: string): Promise<Done> {
  const { error } = await supabase.rpc("cancel_grade_correction", { p_request_id: requestId });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Attaches a supporting document: checks the file, uploads it to the school's own folder, then records it. If recording
 * fails (for example the period is not Open) the uploaded file is removed again so nothing is left orphaned.
 */
export async function uploadGradeDocument(args: {
  file: File; schoolId: string; periodId: string; scholarIdNumber: string; existingCount: number;
}): Promise<{ ok: true; document: GradeDocument } | { ok: false; error: string }> {
  const problem = validateDocumentFile(args.file, args.existingCount);
  if (problem) return { ok: false, error: problem };
  const path = documentStoragePath(args.schoolId, args.periodId, args.scholarIdNumber, args.file.name, crypto.randomUUID());
  const upload = await supabase.storage.from(DOCUMENT_BUCKET).upload(path, args.file, { contentType: args.file.type, upsert: false });
  if (upload.error) return { ok: false, error: upload.error.message };
  const { data, error } = await supabase.from("grade_documents").insert({
    school_id: args.schoolId, scholar_id_number: args.scholarIdNumber, period_id: args.periodId, storage_path: path,
    file_name: args.file.name, mime_type: args.file.type, size_bytes: args.file.size,
  }).select("*").single();
  if (error || !data) {
    await supabase.storage.from(DOCUMENT_BUCKET).remove([path]);
    return { ok: false, error: error?.message ?? "Couldn't record the document." };
  }
  const r = data as Record<string, unknown>;
  return { ok: true, document: {
    id: String(r.id), scholarIdNumber: String(r.scholar_id_number), periodId: String(r.period_id), storagePath: String(r.storage_path),
    fileName: String(r.file_name), mimeType: String(r.mime_type), sizeBytes: Number(r.size_bytes), uploadedAt: String(r.uploaded_at),
  } };
}

/** Removes a document (only possible while the period is Open and not submitted — the database refuses otherwise). The record goes first; the file only if that worked. */
export async function deleteGradeDocument(doc: Pick<GradeDocument, "id" | "storagePath">): Promise<Done> {
  const { data, error } = await supabase.from("grade_documents").delete().eq("id", doc.id).select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "This document can't be removed — the period is submitted or no longer Open." };
  await supabase.storage.from(DOCUMENT_BUCKET).remove([doc.storagePath]);
  return { ok: true };
}
