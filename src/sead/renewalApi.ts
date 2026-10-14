// ─────────────────────────────────────────────────────────────
// src/sead/renewalApi.ts
// The staff side of Scholar Renewal (the "Scholar Renewal" tool). Who may do what is decided by the database: everything the
// evaluator changes goes through functions that check the "scholar_renewal_evaluator" tag; the board, lists and detail can also be
// read by consultation staff and the Division Head. These calls just ask. See supabase_migration_renewal_p2_application.sql.
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";
import { RENEWAL_DOCUMENT_BUCKET, type DocKind, type RenewalEvaluation, type RenewalStage } from "@/lib/renewal";

export type Done = { ok: true } | { ok: false; error: string };
export type Loaded<T> = { ok: true; rows: T[] } | { ok: false; error: string };
type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));
const strOrNull = (v: unknown) => (v == null ? null : String(v));
const num = (v: unknown) => (v == null ? 0 : Number(v));

/** testers: scholar IDs when the window is TESTERS ONLY (nobody else sees it, is alerted or counted); an empty list = a normal window for everyone. */
export interface RenewalWindowRow { id: string; schoolYear: string; term: string; opensOn: string; closesOn: string; lateAllowed: boolean; note: string; testers: string[] }

export async function fetchRenewalWindows(): Promise<Loaded<RenewalWindowRow>> {
  const { data, error } = await supabase.from("renewal_windows").select("*").order("opens_on", { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: ((data ?? []) as Row[]).map(r => ({ id: str(r.id), schoolYear: str(r.school_year), term: str(r.term), opensOn: str(r.opens_on), closesOn: str(r.closes_on), lateAllowed: !!r.late_allowed, note: str(r.note), testers: Array.isArray(r.testers) ? (r.testers as unknown[]).map(str) : [] })) };
}

/** `testers`: the scholar IDs for a testers-only window, [] to open the window to everyone, undefined to leave it as it is (the call then also works before the Phase 8b SQL is installed). */
export async function saveRenewalWindow(w: { id: string | null; schoolYear: string; term: string; opensOn: string; closesOn: string; lateAllowed: boolean; note: string; testers?: string[] }): Promise<Done> {
  const { error } = await supabase.rpc("renewal_window_save", {
    p_id: w.id, p_school_year: w.schoolYear.trim(), p_term: w.term, p_opens_on: w.opensOn, p_closes_on: w.closesOn, p_late_allowed: w.lateAllowed, p_note: w.note,
    ...(w.testers === undefined ? {} : { p_testers: w.testers }),
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** What clearing a testers-only window removed, and the files that stay in the private folders. */
export interface ClearedTestData { records: number; slotsReleased: number; referrals: number; certificates: number; filesLeft: string[] }
export async function clearWindowTestData(id: string): Promise<{ ok: true; cleared: ClearedTestData } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("renewal_window_clear_test_data", { p_id: id });
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't clear the test data." };
  const d = data as Row;
  return { ok: true, cleared: { records: num(d.records), slotsReleased: num(d.slots_released), referrals: num(d.referrals), certificates: num(d.certificates), filesLeft: ((d.files_left ?? []) as unknown[]).map(str) } };
}

export async function deleteRenewalWindow(id: string): Promise<Done> {
  const { error } = await supabase.rpc("renewal_window_delete", { p_id: id });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export interface BoardRow {
  recordId: string; scholarIdNumber: string; name: string; school: string; program: string; yearLevel: string; stage: RenewalStage; isLate: boolean;
  lateDecision: string | null; appliedAt: string | null; ruleCode: string | null; failedCount: number; incCount: number; sdpComplied: boolean | null; sdpMissing: string | null;
  consultationRequired: boolean; consultationDone: boolean; noShow: boolean; scholarNote: string; updatedAt: string; result: string | null;
  /** When the scholar's booked consultation starts (null when none is booked). */
  nextConsultation: string | null; noShowCount: number;
  /** Documents the scholar uploaded that the evaluator has not reviewed yet. */
  docsToReview: number;
}

export async function fetchRenewalBoard(schoolYear: string, term: string): Promise<Loaded<BoardRow>> {
  const { data, error } = await supabase.rpc("renewal_board", { p_school_year: schoolYear, p_term: term });
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    rows: ((data ?? []) as Row[]).map(r => ({
      recordId: str(r.record_id), scholarIdNumber: str(r.scholar_id_number), name: str(r.name), school: str(r.school), program: str(r.program), yearLevel: str(r.year_level),
      stage: r.stage as RenewalStage, isLate: !!r.is_late, lateDecision: strOrNull(r.late_decision), appliedAt: strOrNull(r.applied_at), ruleCode: strOrNull(r.rule_code),
      failedCount: num(r.failed_count), incCount: num(r.inc_count), sdpComplied: r.sdp_complied == null ? null : !!r.sdp_complied, sdpMissing: strOrNull(r.sdp_missing),
      consultationRequired: !!r.consultation_required, consultationDone: !!r.consultation_done, noShow: !!r.no_show_flag, scholarNote: str(r.scholar_note), updatedAt: str(r.updated_at), result: strOrNull(r.result),
      nextConsultation: strOrNull(r.next_consultation), noShowCount: num(r.no_show_count), docsToReview: num(r.docs_to_review),
    })),
  };
}

export interface NotAppliedRow { scholarIdNumber: string; name: string; school: string; program: string; yearLevel: string; status: string }

export async function fetchNotApplied(schoolYear: string, term: string): Promise<Loaded<NotAppliedRow>> {
  const { data, error } = await supabase.rpc("renewal_not_applied", { p_school_year: schoolYear, p_term: term });
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: ((data ?? []) as Row[]).map(r => ({ scholarIdNumber: str(r.scholar_id_number), name: str(r.name), school: str(r.school), program: str(r.program), yearLevel: str(r.year_level), status: str(r.status) })) };
}

export async function markNotRequired(scholarIdNumber: string, schoolYear: string, term: string, reason: string): Promise<Done> {
  const { error } = await supabase.rpc("renewal_mark_not_required", { p_scholar_id_number: scholarIdNumber, p_school_year: schoolYear, p_term: term, p_reason: reason });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export interface IncRow {
  itemId: string; recordId: string; scholarIdNumber: string; name: string; school: string; subjectCode: string; subject: string;
  consultationDate: string | null; daysGiven: number | null; deadline: string | null; daysLeft: number | null; stage: RenewalStage;
}

export async function fetchIncList(schoolYear: string, term: string): Promise<Loaded<IncRow>> {
  const { data, error } = await supabase.rpc("renewal_inc_list", { p_school_year: schoolYear, p_term: term });
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    rows: ((data ?? []) as Row[]).map(r => ({
      itemId: str(r.item_id), recordId: str(r.record_id), scholarIdNumber: str(r.scholar_id_number), name: str(r.name), school: str(r.school), subjectCode: str(r.subject_code), subject: str(r.subject),
      consultationDate: strOrNull(r.consultation_date), daysGiven: r.days_given == null ? null : Number(r.days_given), deadline: strOrNull(r.deadline), daysLeft: r.days_left == null ? null : Number(r.days_left), stage: r.stage as RenewalStage,
    })),
  };
}

export type IncDecision = { action: "extend"; reason: string; newDeadline: string } | { action: "count_failed"; reason: string } | { action: "set_status"; reason: string; status: "Probationary" | "Regular" | "removal" } | { action: "other"; reason: string };

export async function decideInc(itemId: string, d: IncDecision): Promise<Done> {
  const { error } = await supabase.rpc("renewal_decide_inc", {
    p_item_id: itemId, p_action: d.action, p_reason: d.reason, p_new_deadline: d.action === "extend" ? d.newDeadline : null, p_status: d.action === "set_status" ? d.status : null,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function confirmRenewal(recordId: string, note: string): Promise<Done> {
  const { error } = await supabase.rpc("renewal_confirm", { p_record_id: recordId, p_note: note });
  return error ? { ok: false, error: error.message } : { ok: true };
}
/** A "1 failed subject" case: the evaluator endorses the scholar for Probationary to the Division Head. */
export async function endorseRenewal(recordId: string, note: string): Promise<Done> {
  const { error } = await supabase.rpc("renewal_endorse", { p_record_id: recordId, p_note: note });
  return error ? { ok: false, error: error.message } : { ok: true };
}
/** Approve or return one uploaded document. Only the study plan holds anything up: until it is approved the scholar cannot book a consultation. */
export async function reviewDocument(documentId: string, approve: boolean, comment: string): Promise<Done> {
  const { error } = await supabase.rpc("renewal_review_document", { p_document_id: documentId, p_approve: approve, p_comment: comment });
  return error ? { ok: false, error: error.message } : { ok: true };
}
export async function returnRenewal(recordId: string, comment: string): Promise<Done> {
  const { error } = await supabase.rpc("renewal_return", { p_record_id: recordId, p_comment: comment });
  return error ? { ok: false, error: error.message } : { ok: true };
}
export async function decideLateApplication(recordId: string, accept: boolean, reason: string): Promise<Done> {
  const { error } = await supabase.rpc("renewal_late_decide", { p_record_id: recordId, p_accept: accept, p_reason: reason });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export interface DetailDocument { id: string; kind: DocKind; fileName: string; mimeType: string; sizeBytes: number; status: string; uploadedAt: string; storagePath: string }
export interface DetailIncItem {
  id: string; subjectCode: string; subject: string; state: string; consultationDate: string | null; daysGiven: number | null; deadline: string | null; decision: string | null; decisionReason: string | null;
  extensions: { oldDeadline: string | null; newDeadline: string; reason: string; by: string; at: string }[];
}
export interface RenewalDetail {
  record: {
    id: string; schoolYear: string; term: string; stage: RenewalStage; basisSchoolYear: string | null; basisTerm: string | null; appliedAt: string | null; isLate: boolean; lateDecision: string | null;
    lateReason: string | null; confirmedSchool: string | null; confirmedProgram: string | null; confirmedYearLevel: string | null; scholarNote: string; scholarNoteAt: string | null;
    ruleCode: string | null; ruleText: string | null; consultationRequired: boolean; consultationDoneAt: string | null; hardCopyReceivedAt: string | null; noShow: boolean; tempProbation: boolean;
    evaluatorComment: string | null; confirmedAt: string | null; result: string | null; notRequiredReason: string | null;
    divisionHeadDecision: string | null; divisionHeadDecidedAt: string | null; divisionHeadNote: string | null;
  };
  scholar: { scholarIdNumber: string; name: string; school: string; program: string; yearLevel: string; status: string; contactNo: string };
  evaluation: RenewalEvaluation;
  documents: DetailDocument[];
  history: { at: string; fromStage: string | null; toStage: string; actor: string; note: string }[];
  incItems: DetailIncItem[];
  appointments: { startsAt: string | null; action: string; staff: string; actor: string; note: string; at: string }[];
  nextConsultation: { startsAt: string; staff: string } | null;
  statusHistory: { status: string; previousStatus: string | null; isTemporary: boolean; schoolYear: string | null; term: string | null; changedAt: string; source: string; note: string }[];
}

export async function fetchRenewalDetail(recordId: string): Promise<{ ok: true; detail: RenewalDetail } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("renewal_record_detail", { p_record_id: recordId });
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't load this renewal." };
  const d = data as Row, r = d.record as Row, s = d.scholar as Row;
  return {
    ok: true,
    detail: {
      record: {
        id: str(r.id), schoolYear: str(r.school_year), term: str(r.term), stage: r.stage as RenewalStage, basisSchoolYear: strOrNull(r.basis_school_year), basisTerm: strOrNull(r.basis_term), appliedAt: strOrNull(r.applied_at),
        isLate: !!r.is_late, lateDecision: strOrNull(r.late_decision), lateReason: strOrNull(r.late_reason), confirmedSchool: strOrNull(r.confirmed_school), confirmedProgram: strOrNull(r.confirmed_program),
        confirmedYearLevel: strOrNull(r.confirmed_year_level), scholarNote: str(r.scholar_note), scholarNoteAt: strOrNull(r.scholar_note_at), ruleCode: strOrNull(r.rule_code), ruleText: strOrNull(r.rule_text),
        consultationRequired: !!r.consultation_required, consultationDoneAt: strOrNull(r.consultation_done_at), hardCopyReceivedAt: strOrNull(r.hard_copy_received_at), noShow: !!r.no_show_flag, tempProbation: !!r.temp_probation,
        evaluatorComment: strOrNull(r.evaluator_comment), confirmedAt: strOrNull(r.confirmed_at), result: strOrNull(r.result), notRequiredReason: strOrNull(r.not_required_reason),
        divisionHeadDecision: strOrNull(r.division_head_decision), divisionHeadDecidedAt: strOrNull(r.division_head_decided_at), divisionHeadNote: strOrNull(r.division_head_note),
      },
      scholar: { scholarIdNumber: str(s.scholar_id_number), name: str(s.name), school: str(s.school), program: str(s.program), yearLevel: str(s.year_level), status: str(s.status), contactNo: str(s.contact_no) },
      evaluation: (d.evaluation ?? {}) as RenewalEvaluation,
      documents: ((d.documents ?? []) as Row[]).map(x => ({ id: str(x.id), kind: x.kind as DocKind, fileName: str(x.file_name), mimeType: str(x.mime_type), sizeBytes: num(x.size_bytes), status: str(x.status), uploadedAt: str(x.uploaded_at), storagePath: str(x.storage_path) })),
      history: ((d.history ?? []) as Row[]).map(x => ({ at: str(x.at), fromStage: strOrNull(x.from_stage), toStage: str(x.to_stage), actor: str(x.actor), note: str(x.note) })),
      incItems: ((d.inc_items ?? []) as Row[]).map(x => {
        const i = x.item as Row;
        return {
          id: str(i.id), subjectCode: str(i.subject_code), subject: str(i.subject), state: str(i.state), consultationDate: strOrNull(i.consultation_date), daysGiven: i.days_given == null ? null : Number(i.days_given),
          deadline: strOrNull(i.deadline), decision: strOrNull(i.decision), decisionReason: strOrNull(i.decision_reason),
          extensions: ((x.extensions ?? []) as Row[]).map(e => ({ oldDeadline: strOrNull(e.old_deadline), newDeadline: str(e.new_deadline), reason: str(e.reason), by: str(e.changed_by_label), at: str(e.changed_at) })),
        };
      }),
      appointments: ((d.appointments ?? []) as Row[]).map(a => ({ startsAt: strOrNull(a.starts_at), action: str(a.action), staff: str(a.staff), actor: str(a.actor), note: str(a.note), at: str(a.at) })),
      nextConsultation: d.next_consultation ? (() => { const n = d.next_consultation as Row; return { startsAt: str(n.starts_at), staff: str(n.staff) }; })() : null,
      statusHistory: ((d.status_history ?? []) as Row[]).map(x => ({ status: str(x.status), previousStatus: strOrNull(x.previous_status), isTemporary: !!x.is_temporary, schoolYear: strOrNull(x.school_year), term: strOrNull(x.term), changedAt: str(x.changed_at), source: str(x.source), note: str(x.note) })),
    },
  };
}

export async function getStaffRenewalDocumentUrl(storagePath: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const { data, error } = await supabase.storage.from(RENEWAL_DOCUMENT_BUCKET).createSignedUrl(storagePath, 300);
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't open the file." };
  return { ok: true, url: data.signedUrl };
}

/** A scholar the evaluator can pick (for the testers-only window). */
export interface ScholarChoice { scholarIdNumber: string; name: string; school: string; program: string; yearLevel: string; status: string }
const toChoice = (r: Row): ScholarChoice => ({ scholarIdNumber: str(r.scholar_id_number), name: str(r.name), school: str(r.school), program: str(r.program), yearLevel: str(r.year_level), status: str(r.status) });

/** Finds scholars by part of a name or ID (at least 2 letters), and/or looks up already chosen IDs. */
export async function lookupScholars(args: { query?: string; ids?: string[] }): Promise<{ ok: true; rows: ScholarChoice[] } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("renewal_scholar_lookup", { p_query: args.query ?? null, p_ids: args.ids ?? null });
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: ((data ?? []) as Row[]).map(toChoice) };
}
