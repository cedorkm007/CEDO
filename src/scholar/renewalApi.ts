// ─────────────────────────────────────────────────────────────
// src/scholar/renewalApi.ts
// The scholar's side of Scholar Renewal: see the windows and their own application, apply, flag a problem, upload the documents
// their case needs, and read their notifications. Every rule is decided by the database (see
// supabase_migration_renewal_p2_application.sql); these calls just ask.
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";
import {
  RENEWAL_DOCUMENT_BUCKET, renewalDocumentPath, validateRenewalFile, validateSelfGradeImage, validateSelfGradeLines,
  type ConsultState, type DocKind, type RenewalEvaluation, type RenewalStage, type SelfGradeDifference, type SelfGradeLine, type SelfGradesStatus, type WindowState,
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
export interface MyBooking { slotId: string; startsAt: string; endsAt: string; staffName: string; canChange: boolean; typeLabel: string | null; minutes: number | null; consultType: string | null }
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
    booking: w.booking ? (() => { const b = w.booking as Row; return { slotId: str(b.slot_id), startsAt: str(b.starts_at), endsAt: str(b.ends_at), staffName: str(b.staff_name), canChange: !!b.can_change, typeLabel: strOrNull(b.type_label), minutes: b.minutes == null ? null : Number(b.minutes), consultType: strOrNull(b.consult_type) }; })() : null,
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

/**
 * requestSdpReconsideration: the scholar lacks SDP credits and chose to ask for a reconsideration together with the application (the database refuses it at any other time, and refuses it
 * without grades). grades: the scholar entered their grades in the application form (subjects, screenshots, the tick): the images are uploaded first, then everything is sent with the
 * application in one go (supabase_migration_entered_grades_d_apply_flow.sql); if the application is refused the uploaded images are removed again.
 */
export async function applyForRenewal(args: {
  windowId: string; school: string; program: string; yearLevel: string; note: string; requestSdpReconsideration?: boolean;
  scholarIdNumber?: string; grades?: { lines: { code: string; subject: string; units: string; grade: string }[]; newFiles: File[]; acknowledged: boolean };
}): Promise<Done> {
  const base = { p_window_id: args.windowId, p_school: args.school, p_program: args.program, p_year_level: args.yearLevel, p_note: args.note };
  const g = args.grades;
  if (!g) {
    const { error } = args.requestSdpReconsideration ? await supabase.rpc("renewal_apply", { ...base, p_request_sdp_reconsideration: true }) : await supabase.rpc("renewal_apply", base);
    return error ? { ok: false, error: error.message } : { ok: true };
  }
  const problem = validateSelfGradeLines(g.lines);
  if (problem) return { ok: false, error: problem };
  if (!g.acknowledged) return { ok: false, error: "Please tick the box to say you understand." };
  if (g.newFiles.length === 0) return { ok: false, error: "Upload at least one screenshot or image of your grades." };
  for (const f of g.newFiles) { const p = validateSelfGradeImage(f, 0); if (p) return { ok: false, error: p }; }
  const uploaded: { path: string; name: string; mime: string; size: number }[] = [];
  const undo = async () => { if (uploaded.length) await supabase.storage.from(RENEWAL_DOCUMENT_BUCKET).remove(uploaded.map(u => u.path)); };
  for (const f of g.newFiles) {
    const safe = f.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80);
    const path = `${args.scholarIdNumber}/${args.windowId}/grade-entries/${crypto.randomUUID()}-${safe}`;
    const up = await supabase.storage.from(RENEWAL_DOCUMENT_BUCKET).upload(path, f, { contentType: f.type, upsert: false });
    if (up.error) { await undo(); return { ok: false, error: up.error.message }; }
    uploaded.push({ path, name: f.name, mime: f.type, size: f.size });
  }
  const { error } = await supabase.rpc("renewal_apply", {
    ...base, p_request_sdp_reconsideration: !!args.requestSdpReconsideration, p_grade_ack: g.acknowledged, p_grade_files: uploaded,
    p_grade_lines: g.lines.map(l => ({ code: l.code.trim(), subject: l.subject.trim(), units: Number(l.units.replace(",", ".")), grade: l.grade.trim() })),
  });
  if (error) { await undo(); return { ok: false, error: functionMissing(error) ? "The application form cannot carry your grades yet. Please apply without them and enter them afterwards." : error.message }; }
  return { ok: true };
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
// ── Consultation booking by TYPE and morning / afternoon (supabase_migration_consultation_types_b_booking.sql) ──
export interface ConsultType { key: string; label: string; minutes: number; suggested: boolean }
export interface OpenBlock { day: string; half: "AM" | "PM"; spots: number; freeMinutes: number }
const functionMissing = (e: { code?: string; message?: string }) => e.code === "PGRST202" || /could not find the function|does not exist/i.test(e.message ?? "");

/** The consultation types (each with its minutes). `legacy: true` means the database update has not been run yet, so the old 10-minute picker is used. */
export async function fetchConsultTypes(recordId: string): Promise<{ ok: true; types: ConsultType[] } | { ok: false; error: string; legacy?: boolean }> {
  const { data, error } = await supabase.rpc("renewal_consult_types", { p_record_id: recordId });
  if (error) return { ok: false, error: error.message, legacy: functionMissing(error) };
  return { ok: true, types: ((data ?? []) as Row[]).map(r => ({ key: str(r.key), label: str(r.label), minutes: Number(r.minutes ?? 0), suggested: !!r.suggested })) };
}
/** The mornings and afternoons that still have room for this type. */
export async function fetchOpenBlocks(recordId: string, type: string): Promise<{ ok: true; blocks: OpenBlock[] } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("renewal_open_blocks", { p_record_id: recordId, p_type: type });
  if (error) return { ok: false, error: error.message };
  return { ok: true, blocks: ((data ?? []) as Row[]).map(r => ({ day: str(r.day).slice(0, 10), half: r.half as "AM" | "PM", spots: Number(r.spots ?? 0), freeMinutes: Number(r.free_minutes ?? 0) })) };
}
export async function bookConsultationBlock(recordId: string, type: string, day: string, half: "AM" | "PM"): Promise<Done> {
  const { error } = await supabase.rpc("renewal_book_consultation", { p_record_id: recordId, p_type: type, p_day: day, p_half: half });
  return error ? { ok: false, error: error.message } : { ok: true };
}
export async function rescheduleConsultationBlock(recordId: string, type: string, day: string, half: "AM" | "PM"): Promise<Done> {
  const { error } = await supabase.rpc("renewal_reschedule_consultation", { p_record_id: recordId, p_type: type, p_day: day, p_half: half });
  return error ? { ok: false, error: error.message } : { ok: true };
}

// ── Consultations the CEDO staff referred the scholar for (the reason is chosen by staff; the scholar chooses the day and morning / afternoon) ──
export interface MyReferral {
  referralId: string; reason: string; reasonLabel: string; minutes: number; status: "awaiting_booking" | "booked"; referredAt: string;
  slotId: string | null; startsAt: string | null; endsAt: string | null; staffName: string | null; canChange: boolean;
}
/** Open referrals of the signed-in scholar. Empty (and no error) before the referral-by-reason database update has been run. */
export async function fetchMyReferrals(): Promise<{ ok: true; rows: MyReferral[] } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("consultation_my_referrals");
  if (error) return functionMissing(error) ? { ok: true, rows: [] } : { ok: false, error: error.message };
  return {
    ok: true,
    rows: ((data ?? []) as Row[]).map(r => ({
      referralId: str(r.referral_id), reason: str(r.reason), reasonLabel: str(r.reason_label), minutes: Number(r.minutes ?? 0), status: r.status as MyReferral["status"], referredAt: str(r.referred_at),
      slotId: strOrNull(r.slot_id), startsAt: strOrNull(r.starts_at), endsAt: strOrNull(r.ends_at), staffName: strOrNull(r.staff_name), canChange: !!r.can_change,
    })),
  };
}
export async function fetchReferralBlocks(referralId: string): Promise<{ ok: true; blocks: OpenBlock[] } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("referral_open_blocks", { p_referral_id: referralId });
  if (error) return { ok: false, error: error.message };
  return { ok: true, blocks: ((data ?? []) as Row[]).map(r => ({ day: str(r.day).slice(0, 10), half: r.half as "AM" | "PM", spots: Number(r.spots ?? 0), freeMinutes: Number(r.free_minutes ?? 0) })) };
}
export async function bookReferralConsultation(referralId: string, day: string, half: "AM" | "PM"): Promise<Done> {
  const { error } = await supabase.rpc("referral_book_consultation", { p_referral_id: referralId, p_day: day, p_half: half });
  return error ? { ok: false, error: error.message } : { ok: true };
}
export async function rescheduleReferralConsultation(referralId: string, day: string, half: "AM" | "PM"): Promise<Done> {
  const { error } = await supabase.rpc("referral_reschedule_consultation", { p_referral_id: referralId, p_day: day, p_half: half });
  return error ? { ok: false, error: error.message } : { ok: true };
}
export async function cancelReferralConsultation(referralId: string): Promise<Done> {
  const { error } = await supabase.rpc("referral_cancel_booking", { p_referral_id: referralId });
  return error ? { ok: false, error: error.message } : { ok: true };
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

/** The study plan template the CEDO office uploaded for this scholar's school (or the default one), or null when none was uploaded. */
export interface MyStudyPlanForm { storagePath: string; downloadName: string; title: string; isDefault: boolean }
export async function fetchMyStudyPlanForm(): Promise<MyStudyPlanForm | null> {
  const { data, error } = await supabase.rpc("renewal_my_study_plan_form");
  const row = (data as Row[] | null)?.[0];
  if (error || !row) return null;
  return { storagePath: str(row.storage_path), downloadName: str(row.download_name), title: str(row.title), isDefault: !!row.is_default };
}

const STUDY_PLAN_BUCKET = "renewal-study-plan-forms";
/** A short-lived download link for the template; the file arrives under the tidy name the system chose. Null when it cannot be opened. */
export async function fetchMyStudyPlanFormUrl(form: MyStudyPlanForm): Promise<string | null> {
  const { data, error } = await supabase.storage.from(STUDY_PLAN_BUCKET).createSignedUrl(form.storagePath, 300, { download: form.downloadName });
  return error || !data ? null : data.signedUrl;
}

// ── The Consultation tile: the scholar's own appointments (upcoming and past) ──
export interface MyAppointment { slotId: string; startsAt: string; endsAt: string; staffName: string; state: "booked" | "attended" | "no_show"; recordId: string | null; termLabel: string | null; canChange: boolean; typeLabel: string | null; minutes: number | null }

export async function fetchMyAppointments(): Promise<{ ok: true; rows: MyAppointment[] } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("consultation_my_appointments");
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    rows: ((data ?? []) as Row[]).map(r => ({
      slotId: str(r.slot_id), startsAt: str(r.starts_at), endsAt: str(r.ends_at), staffName: str(r.staff_name), state: r.state as MyAppointment["state"],
      recordId: strOrNull(r.record_id), termLabel: strOrNull(r.term_label), canChange: !!r.can_change, typeLabel: strOrNull(r.type_label), minutes: r.minutes == null ? null : Number(r.minutes),
    })),
  };
}

// ── Entering grades (supabase_migration_entered_grades_c_functions.sql) ──────────────────
export interface MySelfGrades {
  /** null = grades can be entered now; otherwise why not (in words). */
  cannotEnterReason: string | null;
  submission: { id: string; version: number; status: SelfGradesStatus; submittedAt: string; decidedAt: string | null; note: string; officialCheckedAt: string | null; differences: SelfGradeDifference[] | null } | null;
  lines: SelfGradeLine[];
  files: { name: string; path: string }[];
}

/** The scholar's newest try of entered grades for one application (or null before the database update is run). */
export async function fetchMySelfGrades(recordId: string): Promise<{ ok: true; data: MySelfGrades } | { ok: false; error: string; missing: boolean }> {
  const { data, error } = await supabase.rpc("renewal_my_self_grades", { p_record_id: recordId });
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't load your entered grades.", missing: !!error && (error.code === "PGRST202" || /could not find the function|does not exist/i.test(error.message ?? "")) };
  const d = data as Row;
  const s = d.submission as Row | null;
  return {
    ok: true,
    data: {
      cannotEnterReason: strOrNull(d.cannot_enter_reason),
      submission: s ? { id: str(s.id), version: Number(s.version), status: str(s.status) as SelfGradesStatus, submittedAt: str(s.submitted_at), decidedAt: strOrNull(s.decided_at), note: str(s.note), officialCheckedAt: strOrNull(s.official_checked_at), differences: (s.differences ?? null) as SelfGradeDifference[] | null } : null,
      lines: ((d.lines ?? []) as Row[]).map(l => ({ code: str(l.code), subject: str(l.subject), units: Number(l.units), grade: str(l.grade) })),
      files: ((d.files ?? []) as Row[]).map(f => ({ name: str(f.name), path: str(f.path) })),
    },
  };
}

/**
 * Sends the entered grades: the new images are uploaded first to the scholar's own folder (<scholar>/<application>/grade-entries/), then the database saves the try with the tick.
 * keepPaths = images of the earlier try that are kept. If saving fails, the images just uploaded are removed again.
 */
export async function submitSelfGrades(args: { recordId: string; scholarIdNumber: string; lines: { code: string; subject: string; units: string; grade: string }[]; newFiles: File[]; keepFiles: { name: string; path: string }[]; acknowledged: boolean }): Promise<Done> {
  const problem = validateSelfGradeLines(args.lines);
  if (problem) return { ok: false, error: problem };
  if (!args.acknowledged) return { ok: false, error: "Please tick the box to say you understand." };
  if (args.newFiles.length + args.keepFiles.length === 0) return { ok: false, error: "Upload at least one screenshot or image of your grades." };
  for (const f of args.newFiles) { const p = validateSelfGradeImage(f, 0); if (p) return { ok: false, error: p }; }
  const uploaded: { path: string; name: string; mime: string; size: number }[] = [];
  for (const f of args.newFiles) {
    const safe = f.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80);
    const path = `${args.scholarIdNumber}/${args.recordId}/grade-entries/${crypto.randomUUID()}-${safe}`;
    const up = await supabase.storage.from(RENEWAL_DOCUMENT_BUCKET).upload(path, f, { contentType: f.type, upsert: false });
    if (up.error) { await supabase.storage.from(RENEWAL_DOCUMENT_BUCKET).remove(uploaded.map(u => u.path)); return { ok: false, error: up.error.message }; }
    uploaded.push({ path, name: f.name, mime: f.type, size: f.size });
  }
  const files = [...args.keepFiles.map(k => ({ path: k.path, name: k.name, mime: "image/png", size: 1 })), ...uploaded];
  const { error } = await supabase.rpc("renewal_self_grades_submit", {
    p_record_id: args.recordId, p_acknowledged: args.acknowledged, p_files: files,
    p_lines: args.lines.map(l => ({ code: l.code.trim(), subject: l.subject.trim(), units: Number(l.units.replace(",", ".")), grade: l.grade.trim() })),
  });
  if (error) { if (uploaded.length) await supabase.storage.from(RENEWAL_DOCUMENT_BUCKET).remove(uploaded.map(u => u.path)); return { ok: false, error: error.message }; }
  return { ok: true };
}

/** A short-lived link to one of the scholar's own images (for the preview). */
export async function getSelfGradeImageUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(RENEWAL_DOCUMENT_BUCKET).createSignedUrl(path, 300);
  return error || !data ? null : data.signedUrl;
}
