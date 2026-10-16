// ─────────────────────────────────────────────────────────────
// src/publicupload/publicUploadApi.ts
// The upload page for people outside CEDO talks ONLY to the "storage-tool-public" function (supabase/functions/storage-tool-public); it never reads a
// table or a stored file. See supabase/functions/_shared/storageToolPublic.ts for every rule the server applies.
// ─────────────────────────────────────────────────────────────
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export type Reply<T> = { ok: true; value: T } | { ok: false; error: string; status: number; code?: string };

export interface LinkInfoPublic {
  active: true; folderName: string; title: string; instructions: string; needsLockKey: boolean; requireEmail: boolean; requirePhone: boolean;
  maxFileMb: number; maxFilesPerPerson: number | null; allowedTypes: { ext: string; label: string }[]; allowSubfolders: boolean; subfolders: { id: string; name: string; location: string }[]; captcha: boolean;
}
export type InfoReply = LinkInfoPublic | { active: false; status: string };
export interface MyFile { name: string; size: number; at: string }

async function call<T>(body: Record<string, unknown>): Promise<Reply<T>> {
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/storage-tool-public`, { method: "POST", headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, body: JSON.stringify(body) });
  } catch {
    return { ok: false, error: "The connection was lost. Please check your internet and try again.", status: 0 };
  }
  let json: Record<string, unknown> = {};
  try { json = (await res.json()) as Record<string, unknown>; } catch { /* no body */ }
  if (!res.ok) return { ok: false, error: String(json.error ?? `Something went wrong (${res.status}).`), status: res.status, code: json.code ? String(json.code) : undefined };
  return { ok: true, value: json as T };
}

export const fetchInfo = (token: string) => call<InfoReply>({ action: "info", token });
export const openVisit = (token: string, p: { name: string; email: string; phone: string; lockKey: string; captchaToken: string }) => call<{ sessionToken: string }>({ action: "open", token, ...p });
export const startFile = (token: string, sessionToken: string, fileName: string, size: number, folderId: string | null) => call<{ fileId: string; uploadUrl: string; fileName: string }>({ action: "start", token, sessionToken, fileName, size, folderId });
export const finishFile = (token: string, sessionToken: string, fileId: string, fileName: string, folderId: string | null) => call<{ name: string; size: number }>({ action: "finish", token, sessionToken, fileId, fileName, folderId });
export const myFiles = (token: string, sessionToken: string) => call<{ files: MyFile[] }>({ action: "mine", token, sessionToken });

/** Sends the file's bytes to the one-time address the server made. Shows progress; can be cancelled. */
export function sendToAddress(url: string, file: File, onProgress: (percent: number) => void, signal: AbortSignal): Promise<{ ok: true } | { ok: false; error: string; cancelled?: boolean }> {
  return new Promise(resolve => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("apikey", SUPABASE_KEY);
    xhr.setRequestHeader("x-upsert", "false");
    const form = new FormData();
    form.append("cacheControl", "3600");
    form.append("", file);
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100))); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve({ ok: true }) : resolve({ ok: false, error: xhr.status === 413 ? "The file is larger than the storage allows." : `The file could not be sent (${xhr.status}).` }));
    xhr.onerror = () => resolve({ ok: false, error: "The connection was lost. Please try again." });
    xhr.onabort = () => resolve({ ok: false, error: "Cancelled.", cancelled: true });
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    if (signal.aborted) return resolve({ ok: false, error: "Cancelled.", cancelled: true });
    xhr.send(form);
  });
}
