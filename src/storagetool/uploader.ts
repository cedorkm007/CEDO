// ─────────────────────────────────────────────────────────────
// src/storagetool/uploader.ts
// Sends ONE file straight from the browser to storage (never through the website's server, which cannot take big requests), shows its progress,
// lets it be cancelled, and then registers it in the database. Small files (up to 6 MB) go in one request; bigger ones are sent in 6 MB pieces
// with the resumable ("tus") method, so a bad connection continues where it stopped.
// ─────────────────────────────────────────────────────────────
import * as tus from "tus-js-client";
import { supabase } from "@/lib/supabase";
import { STORAGE_TOOL_BUCKET, discardUnregistered, registerFile } from "./storageToolApi";
import { SMALL_UPLOAD_BYTES, UPLOAD_CHUNK_BYTES } from "./storageToolLogic";

export type UploadResult = { ok: true; name: string } | { ok: false; error: string; cancelled?: boolean };

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

/** Supabase answers storage errors as {"message": "..."}; make that readable. */
function readableStorageError(status: number, body: string): string {
  let message = "";
  try { message = String((JSON.parse(body) as { message?: string }).message ?? ""); } catch { /* not JSON */ }
  if (status === 413 || /exceeded the maximum/i.test(message)) return "The file is larger than the storage allows.";
  if (status === 401 || status === 403 || /row-level security/i.test(message)) return "You do not have access to upload here.";
  if (status === 409) return "A file with that storage name already exists. Please try again.";
  return message || `The upload failed (${status || "no connection"}).`;
}

function sendSmall(file: File, path: string, token: string, onProgress: (percent: number) => void, signal: AbortSignal): Promise<{ ok: true } | { ok: false; error: string; cancelled?: boolean }> {
  return new Promise(resolve => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${SUPABASE_URL}/storage/v1/object/${STORAGE_TOOL_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`);
    xhr.setRequestHeader("authorization", `Bearer ${token}`);
    xhr.setRequestHeader("apikey", SUPABASE_KEY);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("cache-control", "max-age=3600");
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100))); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve({ ok: true }) : resolve({ ok: false, error: readableStorageError(xhr.status, xhr.responseText) }));
    xhr.onerror = () => resolve({ ok: false, error: "The connection was lost. Please try again." });
    xhr.onabort = () => resolve({ ok: false, error: "Cancelled.", cancelled: true });
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    if (signal.aborted) return resolve({ ok: false, error: "Cancelled.", cancelled: true });
    xhr.send(file);
  });
}

function sendLarge(file: File, path: string, token: string, onProgress: (percent: number) => void, signal: AbortSignal): Promise<{ ok: true } | { ok: false; error: string; cancelled?: boolean }> {
  return new Promise(resolve => {
    const upload = new tus.Upload(file, {
      endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: { authorization: `Bearer ${token}`, apikey: SUPABASE_KEY, "x-upsert": "false" },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: UPLOAD_CHUNK_BYTES,
      metadata: { bucketName: STORAGE_TOOL_BUCKET, objectName: path, contentType: file.type || "application/octet-stream", cacheControl: "3600" },
      onError: error => {
        const res = (error as { originalResponse?: { getStatus(): number; getBody(): string } }).originalResponse;
        resolve({ ok: false, error: res ? readableStorageError(res.getStatus(), res.getBody()) : "The connection was lost. Please try again." });
      },
      onProgress: (sent, total) => onProgress(Math.min(99, Math.round((sent / total) * 100))),
      onSuccess: () => resolve({ ok: true }),
    });
    signal.addEventListener("abort", () => { void upload.abort(true).then(() => resolve({ ok: false, error: "Cancelled.", cancelled: true })); }, { once: true });
    if (signal.aborted) return resolve({ ok: false, error: "Cancelled.", cancelled: true });
    upload.start();
  });
}

/** Sends the file, then registers it. If registering fails (too big, storage full ...) the stored file is removed again. */
export async function uploadFile(file: File, folderId: string | null, name: string, onProgress: (percent: number) => void, signal: AbortSignal): Promise<UploadResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  if (!session) return { ok: false, error: "You are signed out. Please sign in again." };
  const fileId = crypto.randomUUID();
  const path = `${session.user.id}/${fileId}`;
  const sent = file.size <= SMALL_UPLOAD_BYTES ? await sendSmall(file, path, session.access_token, onProgress, signal) : await sendLarge(file, path, session.access_token, onProgress, signal);
  if (!sent.ok) { await discardUnregistered(path); return sent; }
  if (signal.aborted) { await discardUnregistered(path); return { ok: false, error: "Cancelled.", cancelled: true }; }
  onProgress(99);
  const registered = await registerFile(fileId, folderId, name, file.type);
  if (!registered.ok) { await discardUnregistered(path); return { ok: false, error: registered.error }; }
  onProgress(100);
  return { ok: true, name: registered.value.name };
}
