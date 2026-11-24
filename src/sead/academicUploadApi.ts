// ─────────────────────────────────────────────────────────────
// src/sead/academicUploadApi.ts
// The calls behind "Upload by file" in Grades and Academic Management (supabase_migration_academic_uploads.sql). The database cleans and matches the Scholar IDs, checks every row (again when it is saved),
// locks the school while an upload runs and decides who may do all this (the Scholar Management staff); these calls just ask.
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";
import type { UploadChecked, UploadRow, UploadState } from "@/lib/academicUpload";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));
const strOrNull = (v: unknown) => (v == null ? null : String(v));
const numOrNull = (v: unknown) => (v == null ? null : Number(v));
const isMissing = (e: { code?: string; message?: string }) => e.code === "PGRST202" || /could not find the function|does not exist/i.test(e.message ?? "");
export type UploadFailed = { ok: false; error: string; missing: boolean };
const failed = (e: { code?: string; message?: string }): UploadFailed => ({ ok: false, error: e.message ?? "Something went wrong.", missing: isMissing(e) });
const payload = (rows: UploadRow[]) => rows.map(r => ({ i: r.i, scholar_id: r.scholar_id, name: r.name, program: r.program, status: r.status, custom: r.custom }));

export async function checkChunk(schoolId: string, rows: UploadRow[]): Promise<{ ok: true; rows: UploadChecked[] } | UploadFailed> {
  const { data, error } = await supabase.rpc("academic_upload_check", { p_school: schoolId, p_rows: payload(rows) });
  if (error) return failed(error);
  return {
    ok: true,
    rows: ((((data ?? {}) as Row).rows ?? []) as Row[]).map(e => ({
      i: Number(e.i), state: (str(e.state) || "error") as UploadState, action: (str(e.action) || "none") as UploadChecked["action"], messages: ((e.messages ?? []) as unknown[]).map(String),
      scholarId: strOrNull(e.scholar_id), name: strOrNull(e.name), program: strOrNull(e.program), currentStatus: strOrNull(e.current_status), newStatus: strOrNull(e.new_status),
      currentCustom: numOrNull(e.current_custom), newCustom: numOrNull(e.new_custom), clearCustom: !!e.clear_custom,
    })),
  };
}

export async function startUpload(schoolId: string, fileName: string, total: number): Promise<{ ok: true; id: string; batchNo: number } | UploadFailed> {
  const { data, error } = await supabase.rpc("academic_upload_start", { p_school: schoolId, p_file_name: fileName, p_total: total });
  if (error) return failed(error);
  const d = (data ?? {}) as Row;
  return { ok: true, id: str(d.id), batchNo: Number(d.batch_no) };
}
export async function applyChunk(batchId: string, rows: UploadRow[]): Promise<{ ok: true; set: number; same: number; errors: number; rechecks: number } | UploadFailed> {
  const { data, error } = await supabase.rpc("academic_upload_apply", { p_batch: batchId, p_rows: payload(rows) });
  if (error) return failed(error);
  const d = (data ?? {}) as Row;
  return { ok: true, set: Number(d.set ?? 0), same: Number(d.same ?? 0), errors: Number(d.errors ?? 0), rechecks: Number(d.rechecks ?? 0) };
}
export async function finishUpload(batchId: string, errors: number): Promise<{ ok: true } | UploadFailed> {
  const { error } = await supabase.rpc("academic_upload_finish", { p_batch: batchId, p_errors: errors });
  return error ? failed(error) : { ok: true };
}

export interface PastUpload { id: string; batchNo: number; fileName: string; by: string; startedAt: string; finishedAt: string | null; state: string; totalRows: number; setCount: number; sameCount: number; errorCount: number; canUndo: boolean; undoneAt: string | null; undoKept: number | null }
export async function listUploads(schoolId: string): Promise<{ ok: true; rows: PastUpload[] } | UploadFailed> {
  const { data, error } = await supabase.rpc("academic_upload_list", { p_school: schoolId });
  if (error) return failed(error);
  return { ok: true, rows: ((data ?? []) as Row[]).map(r => ({ id: str(r.id), batchNo: Number(r.batch_no), fileName: str(r.file_name), by: str(r.by_label), startedAt: str(r.started_at), finishedAt: strOrNull(r.finished_at), state: str(r.state), totalRows: Number(r.total_rows ?? 0), setCount: Number(r.set_count ?? 0), sameCount: Number(r.same_count ?? 0), errorCount: Number(r.error_count ?? 0), canUndo: !!r.can_undo, undoneAt: strOrNull(r.undone_at), undoKept: numOrNull(r.undo_kept) })) };
}
export async function undoUpload(batchId: string): Promise<{ ok: true; restored: number; kept: number } | UploadFailed> {
  const { data, error } = await supabase.rpc("academic_upload_undo", { p_batch: batchId });
  if (error) return failed(error);
  const d = (data ?? {}) as Row;
  return { ok: true, restored: Number(d.restored ?? 0), kept: Number(d.kept ?? 0) };
}

export async function fetchTemplateRows(schoolId: string, onProgress?: (n: number) => void): Promise<{ ok: true; rows: string[][] } | UploadFailed> {
  const rows: string[][] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.rpc("academic_template_rows", { p_school: schoolId, p_offset: offset, p_limit: 1000 });
    if (error) return failed(error);
    const page = (data ?? []) as Row[];
    for (const r of page) rows.push([str(r.scholar_id_number), str(r.name), str(r.school), str(r.program), str(r.year_level), r.academic_status == null ? "Not set" : r.academic_status === "non_academic" ? "Non-academic" : "Academic", r.custom_passing_gwa == null ? "" : Number(r.custom_passing_gwa).toFixed(2)]);
    onProgress?.(rows.length);
    if (page.length < 1000) break;
  }
  return { ok: true, rows };
}
