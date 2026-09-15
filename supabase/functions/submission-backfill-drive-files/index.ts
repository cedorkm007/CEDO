// One-time migration off Google Drive: moves files uploaded before the
// Submission Activity feature switched to Supabase Storage (see
// supabase_migration_submission_supabase_storage.sql) into the new
// "submission-uploads" bucket.
//
// Idempotent/resumable by construction: each call selects rows still
// missing storage_path (deliberately NOT offset-based — a row drops out
// of this query the instant it's migrated), processes a small batch, and
// reports whether any are left. A crash mid-batch, a repeated click, or
// two overlapping calls are all harmless — the final per-row UPDATE only
// ever touches a row still `storage_path is null`.
//
// PDFs get the same structural pdf-lib resave the client applies to new
// uploads. JPEGs are carried over as-is — Deno's Edge Runtime has no
// native canvas/image codec, and adding a WASM one solely for a one-time
// backfill of already-existing files is disproportionate; the compression
// requirement is for new uploads, which the client already handles.
// Every other file type is carried over unchanged too.
//
// Never deletes or modifies anything in Google Drive — only ever reads
// (downloadFile is a GET). The original Drive files are left untouched
// indefinitely; deciding what to do with them is a separate, later,
// manual decision.
import { corsHeaders } from "../_shared/cors.ts";
import { requireFormsManagementStaff } from "../_shared/verifyFormsManagementStaff.ts";
import { getGoogleAccessToken, downloadFile } from "../_shared/googleDrive.ts";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";

// Small on purpose: each row does a full Drive download + (for PDFs) a
// pdf-lib resave + a Storage upload + a DB update, all awaited
// sequentially. A batch of 20 was observed hitting the Edge Function
// platform's execution-time limit (HTTP 546) partway through a real
// 928-file backfill run — this keeps one invocation comfortably inside
// that limit even for a slow Drive response or a large PDF, at the cost
// of more round trips (harmless — the client just loops more times).
const BATCH_SIZE = 5;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function fileExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx >= 0 ? fileName.slice(idx) : "";
}

interface BackfillFailure { uploadId: string; fileName: string; error: string }

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { admin } = await requireFormsManagementStaff(req);

    const { count: total } = await admin
      .from("submission_uploads")
      .select("id", { count: "exact", head: true })
      .is("storage_path", null)
      .neq("drive_file_id", "");

    const { data: rows, error: rowsError } = await admin
      .from("submission_uploads")
      .select("id, original_file_name, mime_type, drive_file_id, scholar_id")
      .is("storage_path", null)
      .neq("drive_file_id", "")
      .limit(BATCH_SIZE);
    if (rowsError) return jsonResponse({ error: rowsError.message }, 500);

    if (!rows || rows.length === 0) {
      return jsonResponse({ total: total ?? 0, processed: 0, succeeded: 0, failed: 0, done: true, failures: [] }, 200);
    }

    const accessToken = await getGoogleAccessToken();
    let succeeded = 0;
    const failures: BackfillFailure[] = [];

    for (const row of rows) {
      const uploadId = String(row.id);
      const fileName = String(row.original_file_name ?? "");
      try {
        const driveFileId = String(row.drive_file_id ?? "");
        let bytes = await downloadFile(accessToken, driveFileId);
        const mimeType = String(row.mime_type ?? "application/octet-stream");

        if (mimeType === "application/pdf") {
          try {
            const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
            bytes = await pdfDoc.save({ useObjectStreams: true });
          } catch {
            // Malformed/unusual PDF pdf-lib can't round-trip — carry the
            // original bytes over unchanged rather than failing the whole
            // backfill row over a compression nicety.
          }
        }

        const extension = fileExtension(fileName);
        const storagePath = `${row.scholar_id}/${uploadId}${extension}`;
        const { error: uploadError } = await admin.storage
          .from("submission-uploads")
          .upload(storagePath, bytes, { contentType: mimeType, upsert: true });
        if (uploadError) throw new Error(uploadError.message);

        const { error: updateError } = await admin
          .from("submission_uploads")
          .update({ storage_path: storagePath, file_size_bytes: bytes.byteLength })
          .eq("id", uploadId)
          .is("storage_path", null);
        if (updateError) throw new Error(updateError.message);

        succeeded++;
      } catch (thrown) {
        const message = thrown instanceof Error ? thrown.message : String(thrown);
        console.error(`Backfill failed for upload ${uploadId} (${fileName}):`, message);
        failures.push({ uploadId, fileName, error: message });
      }
    }

    return jsonResponse(
      {
        total: total ?? rows.length,
        processed: rows.length,
        succeeded,
        failed: failures.length,
        done: false,
        failures,
      },
      200,
    );
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    console.error("submission-backfill-drive-files unexpected error:", thrown);
    return jsonResponse({ error: "Unexpected error while migrating files." }, 500);
  }
});
