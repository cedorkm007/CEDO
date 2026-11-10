// ─────────────────────────────────────────────────────────────
// src/sead/renewalDocumentsApi.ts
// Scholar Renewal > Documents: the study plans, letters from the dean and clearances scholars send, and where each one stands (waiting, returned, approved).
// The database (supabase_migration_renewal_documents_approver.sql) lists them; the approve / return call is reviewDocument() in renewalApi.ts. `missing: true` = that database update has not been run yet.
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";
import type { DocKind } from "@/lib/renewal";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));
const num = (v: unknown) => (v == null ? 0 : Number(v));
const isMissing = (e: { code?: string; message?: string }) => e.code === "PGRST202" || /could not find the function|does not exist/i.test(e.message ?? "");
type Failed = { ok: false; error: string; missing: boolean };
const failed = (e: { code?: string; message?: string }): Failed => ({ ok: false, error: e.message ?? "Something went wrong.", missing: isMissing(e) });

export type DocumentsFilter = "pending" | "returned" | "accepted" | "all";
export const DOCUMENTS_PAGE_SIZE = 25;

export interface QueueDocument {
  id: string; kind: DocKind; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string; status: "submitted" | "returned" | "accepted"; reviewerComment: string | null; reviewedAt: string | null; storagePath: string;
  recordId: string; stage: string; schoolYear: string; term: string; scholarIdNumber: string; scholarName: string; school: string; program: string; yearLevel: string;
}
export type DocumentsCounts = Record<DocumentsFilter, number>;

export async function fetchDocumentsQueue(status: DocumentsFilter, query: string, page: number): Promise<{ ok: true; rows: QueueDocument[]; total: number } | Failed> {
  const { data, error } = await supabase.rpc("renewal_documents_queue", { p_status: status, p_query: query.trim() || null, p_limit: DOCUMENTS_PAGE_SIZE, p_offset: (page - 1) * DOCUMENTS_PAGE_SIZE });
  if (error) return failed(error);
  const list = (data ?? []) as Row[];
  return {
    ok: true, total: list.length ? num(list[0].total_rows) : 0,
    rows: list.map(r => ({
      id: str(r.document_id), kind: str(r.kind) as DocKind, fileName: str(r.file_name), mimeType: str(r.mime_type), sizeBytes: num(r.size_bytes), uploadedAt: str(r.uploaded_at), status: str(r.status) as QueueDocument["status"],
      reviewerComment: r.reviewer_comment == null ? null : str(r.reviewer_comment), reviewedAt: r.reviewed_at == null ? null : str(r.reviewed_at), storagePath: str(r.storage_path),
      recordId: str(r.record_id), stage: str(r.stage), schoolYear: str(r.school_year), term: str(r.term), scholarIdNumber: str(r.scholar_id_number), scholarName: str(r.scholar_name),
      school: str(r.school), program: str(r.program), yearLevel: str(r.year_level),
    })),
  };
}

export async function fetchDocumentsCounts(): Promise<{ ok: true; counts: DocumentsCounts } | Failed> {
  const { data, error } = await supabase.rpc("renewal_documents_counts");
  if (error) return failed(error);
  const c = (data ?? {}) as Row;
  return { ok: true, counts: { pending: num(c.pending), returned: num(c.returned), accepted: num(c.accepted), all: num(c.all) } };
}
