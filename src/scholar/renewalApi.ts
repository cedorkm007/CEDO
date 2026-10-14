// ─────────────────────────────────────────────────────────────
// src/scholar/renewalApi.ts
// The scholar's side of Scholar Renewal: see the windows and their own application, apply, flag a problem, upload the documents
// their case needs, and read their notifications. Every rule is decided by the database (see
// supabase_migration_renewal_p2_application.sql); these calls just ask.
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";
import {
  RENEWAL_DOCUMENT_BUCKET, renewalDocumentPath, validateRenewalFile,
  type ConsultState, type DocKind, type RenewalEvaluation, type RenewalStage, type WindowState,
} from "@/lib/renewal";

export type Done = { ok: true } | { ok: false; error: string };

export interface RenewalWindow { id: string; schoolYear: string; term: string; opensOn: string; closesOn: string; lateAllowed: boolean; note: string }
export interface RenewalDocument { id: string; kind: DocKind; fileName: string; mimeType: string; sizeBytes: number; status: "submitted" | "accepted" | "returned"; reviewerComment: string | null; uploadedAt: string; storagePath: string }
export interface RenewalIncItem { id: string; subjectCode: string; subject: string; state: string; consultationDate: string | null; daysGiven: number | null; deadline: string | null }
export interface RenewalHistoryEntry { at: string; toStage: string; actor: string; note: string }
export interface MyRenewalRecord {
  id: string; stage: RenewalStage; isLate: boolean; lateReason: string | null; appliedAt: string | null; ruleCode: string | null; ruleText: string | null;
  evaluation: RenewalEvaluation; scholarNote: string; evaluatorComment: string | null; result: string | null; confirmedAt: string | null; noShowFlag: boolean;
}
export interface MyBooking { slotId: string; startsAt: string; endsAt: string; staffName: string; canChange: boolean }
export interface OpenSlot { slotId: string; startsAt: string; endsAt: string; staffName: string }
export interface MyRenewalWindow {
  window: RenewalWindow; state: WindowState; record: MyRenewalRecord | null;
  documents: RenewalDocument[]; history: RenewalHistoryEntry[]; incItems: RenewalIncItem[];
  /** The consultation the scholar has booked for this renewal (if any). */
  booking: MyBooking | null;
  /** Does this renewal still need a consultation that has not happened? (the database decides) */
  consultNeeded: boolean;
  /** Why a consultation can (not) be booked yet: ok, study_plan_missing, study_plan_pending (waiting for the evaluator's approval) or not_needed. */
  consultState: ConsultState;
}
export interface MyRenewalOverview { scholar: { scholarIdNumber: string; school: string; program: string; yearLevel: string; status: string }; windows: MyRenewalWindow[] }

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));
const strOrNull = (v: unknown) => (v == null ? null : String(v));

function toWindow(r: Row): RenewalWindow {
  return { id: str(r.id), schoolYear: str(r.school_year), term: str(r.term), opensOn: str(r.opens_on), closesOn: str(r.closes_on), lateAllowed: !!r.late_allowed, note: str(r.note) };
}
function toDocument(r: Row): RenewalDocument {
  return {
    id: str(r.id), kind: r.kind as DocKind, fileName: str(r.file_name), mimeType: str(r.mime_type), sizeBytes: Number(r.size_bytes ?? 0),
    status: r.status as RenewalDocument["status"], reviewerComment: strOrNull(r.reviewer_comment), uploadedAt: str(r.uploaded_at), storagePath: str(r.storage_path),
  };
}
function toRecord(r: Row): MyRenewalRecord {
  return {
    id: str(r.id), stage: r.stage as RenewalStage, isLate: !!r.is_late, lateReason: strOrNull(r.late_reason), appliedAt: strOrNull(r.applied_at),
    ruleCode: strOrNull(r.rule_code), ruleText: strOrNull(r.rule_text), evaluation: (r.evaluation ?? {}) as RenewalEvaluation, scholarNote: str(r.scholar_note),
    evaluatorComment: strOrNull(r.evaluator_comment), result: strOrNull(r.result), confirmedAt: strOrNull(r.confirmed_at), noShowFlag: !!r.no_show_flag,
  };
}

export async function fetchMyRenewals(): Promise<{ ok: true; overview: MyRenewalOverview } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("renewal_my_overview");
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't load your renewal." };
  const d = data as Row;
  const sc = (d.scholar ?? {}) as Row;
  const windows = ((d.windows ?? []) as Row[]).map(w => ({
    window: toWindow(w.window as Row), state: w.state as WindowState,
    record: w.record ? toRecord(w.record as Row) : null,
    documents: ((w.documents ?? []) as Row[]).map(toDocument),
    history: ((w.history ?? []) as Row[]).map(h => ({ at: str(h.at), toStage: str(h.to_stage), actor: str(h.actor), note: str(h.note) })),
    booking: w.booking ? (() => { const b = w.booking as Row; return { slotId: str(b.slot_id), startsAt: str(b.starts_at), endsAt: str(b.ends_at), staffName: str(b.staff_name), canChange: !!b.can_change }; })() : null,
    consultNeeded: !!w.consult_needed,
    consultState: ((w.consult_state as string | null) ?? "not_needed") as MyRenewalWindow["consultState"],
    incItems: ((w.inc_items ?? []) as Row[]).map(i => ({
      id: str(i.id), subjectCode: str(i.subject_code), subject: str(i.subject), state: str(i.state),
      consultationDate: strOrNull(i.consultation_date), daysGiven: i.days_given == null ? null : Number(i.days_given), deadline: strOrNull(i.deadline),
    })),
  }));
  return { ok: true, overview: { scholar: { scholarIdNumber: str(sc.scholar_id_number), school: str(sc.school), program: str(sc.program), yearLevel: str(sc.year_level), status: str(sc.status) }, windows } };
}

/** What the system has for the scholar for this term (SDP result and grades), before they apply. Writes nothing. */
export async function previewMyRenewal(windowId: string): Promise<{ ok: true; evaluation: RenewalEvaluation } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("renewal_my_preview", { p_window_id: windowId });
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't load your SDP and grades." };
  return { ok: true, evaluation: data as RenewalEvaluation };
}

export async function applyForRenewal(args: { windowId: string; school: string; program: string; yearLevel: string; note: string }): Promise<Done> {
  const { error } = await supabase.rpc("renewal_apply", { p_window_id: args.windowId, p_school: args.school, p_program: args.program, p_year_level: args.yearLevel, p_note: args.note });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function resubmitRenewal(recordId: string, note: string): Promise<Done> {
  const { error } = await supabase.rpc("renewal_resubmit", { p_record_id: recordId, p_note: note });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function flagRenewalProblem(recordId: string, note: string): Promise<Done> {
  const { error } = await supabase.rpc("renewal_flag_problem", { p_record_id: recordId, p_note: note });
  return error ? { ok: false, error: error.message } : { ok: true };
}

// ── Consultation booking ──
/** Open 10-minute slots of ALL consultation staff, at least 12 hours from now. */
export async function fetchOpenSlots(recordId: string): Promise<{ ok: true; slots: OpenSlot[] } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("renewal_open_slots", { p_record_id: recordId });
  if (error) return { ok: false, error: error.message };
  return { ok: true, slots: ((data ?? []) as Row[]).map(r => ({ slotId: str(r.slot_id), startsAt: str(r.starts_at), endsAt: str(r.ends_at), staffName: str(r.staff_name) })) };
}
export async function bookConsultation(recordId: string, slotId: string): Promise<Done> {
  const { error } = await supabase.rpc("renewal_book_slot", { p_record_id: recordId, p_slot_id: slotId });
  return error ? { ok: false, error: error.message } : { ok: true };
}
export async function rescheduleConsultation(recordId: string, newSlotId: string): Promise<Done> {
  const { error } = await supabase.rpc("renewal_reschedule_slot", { p_record_id: recordId, p_new_slot_id: newSlotId });
  return error ? { ok: false, error: error.message } : { ok: true };
}
export async function cancelConsultation(recordId: string): Promise<Done> {
  const { error } = await supabase.rpc("renewal_cancel_booking", { p_record_id: recordId });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Checks the file, uploads it to the scholar's own folder, then records it. If recording fails (for example the document is not needed) the file is removed again. */
export async function uploadRenewalDocument(args: { file: File; scholarIdNumber: string; recordId: string; kind: DocKind; existingOfKind: number }): Promise<Done> {
  const problem = validateRenewalFile(args.file, args.existingOfKind);
  if (problem) return { ok: false, error: problem };
  const path = renewalDocumentPath(args.scholarIdNumber, args.recordId, args.kind, args.file.name, crypto.randomUUID());
  const up = await supabase.storage.from(RENEWAL_DOCUMENT_BUCKET).upload(path, args.file, { contentType: args.file.type, upsert: false });
  if (up.error) return { ok: false, error: up.error.message };
  const { error } = await supabase.from("renewal_documents").insert({
    record_id: args.recordId, scholar_id_number: args.scholarIdNumber, kind: args.kind, storage_path: path,
    file_name: args.file.name, mime_type: args.file.type, size_bytes: args.file.size,
  });
  if (error) {
    await supabase.storage.from(RENEWAL_DOCUMENT_BUCKET).remove([path]);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function deleteRenewalDocument(doc: Pick<RenewalDocument, "id" | "storagePath">): Promise<Done> {
  const { data, error } = await supabase.from("renewal_documents").delete().eq("id", doc.id).select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "This document can't be removed any more." };
  await supabase.storage.from(RENEWAL_DOCUMENT_BUCKET).remove([doc.storagePath]);
  return { ok: true };
}

export async function getRenewalDocumentUrl(storagePath: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const { data, error } = await supabase.storage.from(RENEWAL_DOCUMENT_BUCKET).createSignedUrl(storagePath, 300);
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't open the file." };
  return { ok: true, url: data.signedUrl };
}

// ── Notifications (the bell) ──
export interface ScholarNotification { id: string; kind: string; title: string; body: string; recordId: string | null; createdAt: string; readAt: string | null }

export async function fetchScholarNotifications(limit = 30): Promise<{ ok: true; rows: ScholarNotification[] } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("scholar_notifications_list", { p_limit: limit });
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: ((data ?? []) as Row[]).map(r => ({ id: str(r.id), kind: str(r.kind), title: str(r.title), body: str(r.body), recordId: strOrNull(r.record_id), createdAt: str(r.created_at), readAt: strOrNull(r.read_at) })) };
}

export async function markScholarNotificationsRead(ids?: string[]): Promise<Done> {
  const { error } = await supabase.rpc("scholar_notifications_mark_read", { p_ids: ids ?? null });
  return error ? { ok: false, error: error.message } : { ok: true };
}
