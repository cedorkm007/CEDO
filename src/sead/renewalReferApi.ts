import { supabase } from "@/lib/supabase";

/** The calls behind "Refer for Consultation" (Scholar Renewal > Applications): the evaluator books the scholar's renewal consultation (supabase_migration_renewal_refer_consultation.sql). The database checks who may. */
type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));
type Failed = { ok: false; error: string; missing: boolean };
const failed = (e: { code?: string; message?: string }): Failed => ({ ok: false, error: e.message ?? "Something went wrong.", missing: e.code === "PGRST202" || /could not find the function|does not exist/i.test(e.message ?? "") });

export interface ReferType { key: string; label: string; minutes: number; suggested: boolean }
export interface ReferBlock { day: string; half: "AM" | "PM"; spots: number; freeMinutes: number }
export interface ReferStaff { staffId: string; name: string; freeMinutes: number }

export async function fetchReferTypes(recordId: string): Promise<{ ok: true; types: ReferType[] } | Failed> {
  const { data, error } = await supabase.rpc("renewal_refer_types", { p_record_id: recordId });
  if (error) return failed(error);
  return { ok: true, types: ((data ?? []) as Row[]).map(r => ({ key: str(r.key), label: str(r.label), minutes: Number(r.minutes ?? 0), suggested: !!r.suggested })) };
}
export async function fetchReferBlocks(recordId: string, type: string): Promise<{ ok: true; blocks: ReferBlock[] } | Failed> {
  const { data, error } = await supabase.rpc("renewal_refer_open_blocks", { p_record_id: recordId, p_type: type });
  if (error) return failed(error);
  return { ok: true, blocks: ((data ?? []) as Row[]).map(r => ({ day: str(r.day).slice(0, 10), half: r.half === "PM" ? "PM" : "AM", spots: Number(r.spots ?? 0), freeMinutes: Number(r.free_minutes ?? 0) })) };
}
export async function fetchReferStaff(type: string, day: string, half: "AM" | "PM"): Promise<{ ok: true; staff: ReferStaff[] } | Failed> {
  const { data, error } = await supabase.rpc("renewal_refer_block_staff", { p_type: type, p_day: day, p_half: half });
  if (error) return failed(error);
  return { ok: true, staff: ((data ?? []) as Row[]).map(r => ({ staffId: str(r.staff_id), name: str(r.staff_name), freeMinutes: Number(r.free_minutes ?? 0) })) };
}
export async function referBook(recordId: string, type: string, day: string, half: "AM" | "PM", staffId: string | null): Promise<{ ok: true } | Failed> {
  const { error } = await supabase.rpc("renewal_refer_book", { p_record_id: recordId, p_type: type, p_day: day, p_half: half, ...(staffId ? { p_staff: staffId } : {}) });
  return error ? failed(error) : { ok: true };
}
