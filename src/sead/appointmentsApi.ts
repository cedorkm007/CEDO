// ─────────────────────────────────────────────────────────────
// src/sead/appointmentsApi.ts
// Consultation staff's side of the appointment system (the "Appointments" subtab of the Scholar Consultation Tool, the pre-filled
// Daily Record, and the renewal info in Probationary Monitoring). Who may do what is decided by the database (the
// "scholar_counseling" tag); these calls just ask. See supabase_migration_renewal_p3_appointments.sql.
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";
import type { RenewalStage } from "@/lib/renewal";

export type Done = { ok: true } | { ok: false; error: string };
type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));
const strOrNull = (v: unknown) => (v == null ? null : String(v));
const num = (v: unknown) => (v == null ? 0 : Number(v));

export interface AvailabilityRange { id: string; startsAt: string; endsAt: string; slotCount: number; bookedCount: number; staffId?: string; staffName?: string }

export async function fetchMyAvailability(fromIso: string, toIso: string): Promise<{ ok: true; rows: AvailabilityRange[] } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("counseling_my_availability", { p_from: fromIso, p_to: toIso });
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: ((data ?? []) as Row[]).map(r => ({ id: str(r.id), startsAt: str(r.starts_at), endsAt: str(r.ends_at), slotCount: num(r.slot_count), bookedCount: num(r.booked_count) })) };
}

export type SlotState = "open" | "booked" | "attended" | "no_show";
export interface CalendarSlot {
  slotId: string; availabilityId: string; startsAt: string; endsAt: string; state: SlotState; scholarIdNumber: string | null; scholarName: string | null;
  recordId: string | null; termLabel: string | null; stage: RenewalStage | null; caseSummary: string | null; noShowCount: number; isSummer: boolean; hardCopy: boolean; dailyRecordId: string | null;
  staffId?: string; staffName?: string;
}

export async function fetchMySlots(fromIso: string, toIso: string): Promise<{ ok: true; rows: CalendarSlot[] } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("counseling_my_slots", { p_from: fromIso, p_to: toIso });
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    rows: ((data ?? []) as Row[]).map(r => ({
      slotId: str(r.slot_id), availabilityId: str(r.availability_id), startsAt: str(r.starts_at), endsAt: str(r.ends_at), state: r.state as SlotState,
      scholarIdNumber: strOrNull(r.scholar_id_number), scholarName: strOrNull(r.scholar_name), recordId: strOrNull(r.record_id), termLabel: strOrNull(r.term_label),
      stage: (r.stage ?? null) as RenewalStage | null, caseSummary: strOrNull(r.case_summary), noShowCount: num(r.no_show_count), isSummer: !!r.is_summer, hardCopy: !!r.hard_copy, dailyRecordId: strOrNull(r.daily_record_id),
    })),
  };
}

// ── The evaluator's READ-ONLY view of every consultation staff member's calendar ──
export interface CalendarStaff { staffId: string; staffName: string }

export async function fetchCalendarStaff(): Promise<{ ok: true; rows: CalendarStaff[] } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("renewal_calendar_staff");
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: ((data ?? []) as Row[]).map(r => ({ staffId: str(r.staff_id), staffName: str(r.staff_name) })) };
}
export async function fetchCalendarAvailability(fromIso: string, toIso: string, staffId: string | null): Promise<{ ok: true; rows: AvailabilityRange[] } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("renewal_calendar_availability", { p_from: fromIso, p_to: toIso, p_staff: staffId });
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: ((data ?? []) as Row[]).map(r => ({ id: str(r.id), startsAt: str(r.starts_at), endsAt: str(r.ends_at), slotCount: num(r.slot_count), bookedCount: num(r.booked_count), staffId: str(r.staff_id), staffName: str(r.staff_name) })) };
}
export async function fetchCalendarSlots(fromIso: string, toIso: string, staffId: string | null): Promise<{ ok: true; rows: CalendarSlot[] } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("renewal_calendar_slots", { p_from: fromIso, p_to: toIso, p_staff: staffId });
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    rows: ((data ?? []) as Row[]).map(r => ({
      slotId: str(r.slot_id), availabilityId: str(r.availability_id), startsAt: str(r.starts_at), endsAt: str(r.ends_at), state: r.state as SlotState,
      scholarIdNumber: strOrNull(r.scholar_id_number), scholarName: strOrNull(r.scholar_name), recordId: strOrNull(r.record_id), termLabel: strOrNull(r.term_label),
      stage: (r.stage ?? null) as RenewalStage | null, caseSummary: strOrNull(r.case_summary), noShowCount: num(r.no_show_count), isSummer: false, hardCopy: false, dailyRecordId: null,
      staffId: str(r.staff_id), staffName: str(r.staff_name),
    })),
  };
}

export interface AffectedBooking { slotId: string; startsAt: string; scholarIdNumber: string; name: string }
export type SaveRangeResult = { ok: true } | { ok: false; needsConfirm: true; booked: AffectedBooking[] } | { ok: false; needsConfirm?: false; error: string };

function toAffected(rows: Row[] | undefined): AffectedBooking[] {
  return (rows ?? []).map(b => ({ slotId: str(b.slot_id), startsAt: str(b.starts_at), scholarIdNumber: str(b.scholar_id_number), name: str(b.name) }));
}

/** Create (id null) or edit a range. If scholars have booked slots that the change would remove, the answer says so and nothing changes until `confirm` is true. */
export async function saveAvailability(id: string | null, startsAtIso: string, endsAtIso: string, confirm = false): Promise<SaveRangeResult> {
  const { data, error } = await supabase.rpc("counseling_availability_save", { p_id: id, p_starts: startsAtIso, p_ends: endsAtIso, p_confirm: confirm });
  if (error) return { ok: false, error: error.message };
  const d = (data ?? {}) as Row;
  if (d.ok === false && d.needs_confirm) return { ok: false, needsConfirm: true, booked: toAffected(d.booked as Row[]) };
  return { ok: true };
}

export async function deleteAvailability(id: string, confirm = false): Promise<SaveRangeResult> {
  const { data, error } = await supabase.rpc("counseling_availability_delete", { p_id: id, p_confirm: confirm });
  if (error) return { ok: false, error: error.message };
  const d = (data ?? {}) as Row;
  if (d.ok === false && d.needs_confirm) return { ok: false, needsConfirm: true, booked: toAffected(d.booked as Row[]) };
  return { ok: true };
}

export interface AttendedPrefill {
  slotId: string; recordId: string; scholarIdNumber: string; scholarName: string; status: string; failedSubjects: string;
  incItems: { itemId: string; subject: string; deadline: string | null }[]; isSummer: boolean; termLabel: string; dateVisited: string;
}

export async function markSlot(slotId: string, outcome: "attended" | "no_show"): Promise<{ ok: true; prefill: AttendedPrefill | null } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("counseling_mark_slot", { p_slot_id: slotId, p_outcome: outcome });
  if (error) return { ok: false, error: error.message };
  const d = (data ?? {}) as Row;
  if (outcome === "no_show") return { ok: true, prefill: null };
  return {
    ok: true,
    prefill: {
      slotId: str(d.slot_id), recordId: str(d.record_id), scholarIdNumber: str(d.scholar_id_number), scholarName: str(d.scholar_name), status: str(d.status), failedSubjects: str(d.failed_subjects),
      incItems: ((d.inc_items ?? []) as Row[]).map(i => ({ itemId: str(i.item_id), subject: str(i.subject), deadline: strOrNull(i.deadline) })),
      isSummer: !!d.is_summer, termLabel: str(d.term_label), dateVisited: str(d.date_visited),
    },
  };
}

/** The pre-filled Daily Record of an appointment. For INC the days given to comply are required (they set the deadline); for Summer the hard copy can be ticked. */
export async function saveConsultationRecord(input: {
  slotId: string; scholarIdNumber: string; status: string; dateVisited: string; failedSubjects: string; findings: string; staffRecommendations: string; visitType: string;
  daysGiven: number | null; hardCopy: boolean | null;
}): Promise<Done> {
  const { error } = await supabase.rpc("counseling_save_daily_record", {
    p_slot_id: input.slotId, p_scholar_id_number: input.scholarIdNumber, p_status: input.status, p_date_visited: input.dateVisited, p_failed_subjects: input.failedSubjects,
    p_findings: input.findings, p_staff_recommendations: input.staffRecommendations, p_visit_type: input.visitType, p_days_given: input.daysGiven, p_hard_copy: input.hardCopy,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function setHardCopyReceived(recordId: string, received: boolean): Promise<Done> {
  const { error } = await supabase.rpc("counseling_set_hard_copy", { p_record_id: recordId, p_received: received });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function extendIncDeadline(itemId: string, newDeadline: string, reason: string): Promise<Done> {
  const { error } = await supabase.rpc("renewal_extend_inc_deadline", { p_item_id: itemId, p_new_deadline: newDeadline, p_reason: reason });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export interface ProbationRenewalInfo {
  scholarIdNumber: string; recordId: string; termLabel: string; stage: RenewalStage; temporaryInc: boolean;
  incItems: { itemId: string; subject: string; deadline: string | null; daysLeft: number | null }[];
  studyPlans: { fileName: string; storagePath: string; uploadedAt: string }[];
}

export async function fetchProbationRenewalInfo(): Promise<{ ok: true; byScholar: Map<string, ProbationRenewalInfo[]> } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("counseling_probation_renewal_info");
  if (error) return { ok: false, error: error.message };
  const map = new Map<string, ProbationRenewalInfo[]>();
  for (const r of (data ?? []) as Row[]) {
    const info: ProbationRenewalInfo = {
      scholarIdNumber: str(r.scholar_id_number), recordId: str(r.record_id), termLabel: str(r.term_label), stage: r.stage as RenewalStage, temporaryInc: !!r.temp_probation || !!r.temporary_inc,
      incItems: ((r.inc_items ?? []) as Row[]).map(i => ({ itemId: str(i.item_id), subject: str(i.subject), deadline: strOrNull(i.deadline), daysLeft: i.days_left == null ? null : Number(i.days_left) })),
      studyPlans: ((r.study_plans ?? []) as Row[]).map(d => ({ fileName: str(d.file_name), storagePath: str(d.storage_path), uploadedAt: str(d.uploaded_at) })),
    };
    if (!map.has(info.scholarIdNumber)) map.set(info.scholarIdNumber, []);
    map.get(info.scholarIdNumber)!.push(info);
  }
  return { ok: true, byScholar: map };
}

/** The pre-filled Daily Record of an appointment already marked Attended (for when the form was closed before it was saved). */
export async function fetchSlotPrefill(slotId: string): Promise<{ ok: true; prefill: AttendedPrefill } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("counseling_slot_prefill", { p_slot_id: slotId });
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't load the appointment." };
  const d = data as Row;
  return {
    ok: true,
    prefill: {
      slotId: str(d.slot_id), recordId: str(d.record_id), scholarIdNumber: str(d.scholar_id_number), scholarName: str(d.scholar_name), status: str(d.status), failedSubjects: str(d.failed_subjects),
      incItems: ((d.inc_items ?? []) as Row[]).map(i => ({ itemId: str(i.item_id), subject: str(i.subject), deadline: strOrNull(i.deadline) })),
      isSummer: !!d.is_summer, termLabel: str(d.term_label), dateVisited: str(d.date_visited),
    },
  };
}
