// The rules and the request handler of the Storage Tool's PUBLIC upload page (no account). Used by the edge function "storage-tool-public" (Deno), by the
// local demo's stand-in, and by the tests (Node), so all three run exactly the same code. It uses only the standard Web Crypto API and plain objects.
//
// Everything a visitor can do is here: look at a link, open it (name, lock key), start an upload (the server decides the storage spot and creates a
// one-time upload address), finish it (the server looks at the stored file: size and the first bytes), and see their own uploads of the visit.
// There is no function to delete, rename, move or read anything else. The database functions it calls are in supabase_migration_storage_tool_p3.sql.

// ── What is allowed ─────────────────────────────────────────
export type Sniff = "pdf" | "jpg" | "png" | "gif" | "webp" | "zip" | "ole" | "mp4" | "text";
export interface TypeInfo { label: string; mime: string; sniff: Sniff }

/** The types a link may allow. The key is the file ending (lowercase). */
export const TYPE_CATALOG: Record<string, TypeInfo> = {
  pdf: { label: "PDF", mime: "application/pdf", sniff: "pdf" },
  jpg: { label: "JPG picture", mime: "image/jpeg", sniff: "jpg" },
  jpeg: { label: "JPEG picture", mime: "image/jpeg", sniff: "jpg" },
  png: { label: "PNG picture", mime: "image/png", sniff: "png" },
  gif: { label: "GIF picture", mime: "image/gif", sniff: "gif" },
  webp: { label: "WebP picture", mime: "image/webp", sniff: "webp" },
  docx: { label: "Word (.docx)", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sniff: "zip" },
  xlsx: { label: "Excel (.xlsx)", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sniff: "zip" },
  pptx: { label: "PowerPoint (.pptx)", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", sniff: "zip" },
  doc: { label: "Word (.doc)", mime: "application/msword", sniff: "ole" },
  xls: { label: "Excel (.xls)", mime: "application/vnd.ms-excel", sniff: "ole" },
  ppt: { label: "PowerPoint (.ppt)", mime: "application/vnd.ms-powerpoint", sniff: "ole" },
  csv: { label: "CSV", mime: "text/csv", sniff: "text" },
  txt: { label: "Text", mime: "text/plain", sniff: "text" },
  zip: { label: "ZIP", mime: "application/zip", sniff: "zip" },
  mp4: { label: "MP4 video", mime: "video/mp4", sniff: "mp4" },
};

/** Never accepted, whatever a link says: programs, scripts, web pages and SVG pictures (which can carry scripts). */
export const ALWAYS_BLOCKED = new Set([
  "exe", "bat", "cmd", "com", "msi", "ps1", "psm1", "vbs", "vbe", "js", "jse", "mjs", "cjs", "sh", "bash", "jar", "scr", "pif", "lnk", "reg", "dll", "sys", "app", "apk", "ipa",
  "html", "htm", "xhtml", "svg", "php", "py", "rb", "pl", "hta", "wsf", "cpl", "msc", "iso", "dmg", "bin", "elf", "so", "dylib",
]);

export function fileExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 && i < name.length - 1 ? name.slice(i + 1).toLowerCase() : "";
}

/** The file's name as saved: no folders, no control characters, no surrounding spaces or trailing dots, at most 255 letters. Empty when nothing is left. */
export function cleanUploadName(name: string): string {
  const last = String(name ?? "").split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  return last.replace(/[\u0000-\u001f\u007f]+/g, "").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 255);
}

// ── What a file's first bytes say ───────────────────────────
const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, from: number, to: number) => Array.from(b.slice(from, to)).map(c => String.fromCharCode(c)).join("");

/** A program, a script or a web page, recognised by its content (not its name). */
export function looksDangerous(head: Uint8Array): boolean {
  if (startsWith(head, [0x4d, 0x5a])) return true;                          // MZ: Windows program
  if (startsWith(head, [0x7f, 0x45, 0x4c, 0x46])) return true;              // ELF: Linux program
  if (startsWith(head, [0xcf, 0xfa, 0xed, 0xfe]) || startsWith(head, [0xce, 0xfa, 0xed, 0xfe]) || startsWith(head, [0xfe, 0xed, 0xfa, 0xce]) || startsWith(head, [0xfe, 0xed, 0xfa, 0xcf])) return true;   // Mach-O
  if (startsWith(head, [0xca, 0xfe, 0xba, 0xbe])) return true;              // Java class / universal binary
  if (startsWith(head, [0x23, 0x21])) return true;                          // "#!" a script
  const text = ascii(head, 0, Math.min(head.length, 1024)).toLowerCase();
  if (/<\s*(script|html|!doctype html|svg|iframe)/.test(text)) return true;
  return false;
}

function isMostlyText(head: Uint8Array): boolean {
  if (head.length === 0) return false;
  for (const c of head) if (c === 0) return false;                         // a NUL byte: binary
  let odd = 0;
  for (const c of head) if (c < 9 || (c > 13 && c < 32)) odd++;
  return odd / head.length < 0.02;
}

/** Does the beginning of the file match what its ending says? */
export function sniffMatches(ext: string, head: Uint8Array): boolean {
  const info = TYPE_CATALOG[ext];
  if (!info) return false;
  switch (info.sniff) {
    case "pdf": return startsWith(head, [0x25, 0x50, 0x44, 0x46]) || ascii(head, 0, 1024).includes("%PDF-");
    case "jpg": return startsWith(head, [0xff, 0xd8, 0xff]);
    case "png": return startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "gif": return ascii(head, 0, 6) === "GIF87a" || ascii(head, 0, 6) === "GIF89a";
    case "webp": return ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP";
    case "zip": return startsWith(head, [0x50, 0x4b, 0x03, 0x04]) || startsWith(head, [0x50, 0x4b, 0x05, 0x06]);
    case "ole": return startsWith(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    case "mp4": return ascii(head, 4, 8) === "ftyp";
    case "text": return isMostlyText(head);
  }
}

/** The verdict on a stored file: its ending must be allowed by the link, must not be a blocked one, and the first bytes must match the ending. */
export function checkContent(ext: string, head: Uint8Array): { ok: true } | { ok: false; error: string } {
  if (looksDangerous(head)) return { ok: false, error: "This file looks like a program or a web page, so it was not accepted." };
  if (!sniffMatches(ext, head)) return { ok: false, error: `This file does not look like a real .${ext} file (its content does not match its name), so it was not accepted.` };
  return { ok: true };
}

export interface LinkRules { allowedTypes: string[]; maxFileMb: number }
/** Before anything is sent: the name, the ending and the size. */
export function checkStart(name: string, size: number, rules: LinkRules): { ok: true; name: string; ext: string; mime: string } | { ok: false; error: string } {
  const clean = cleanUploadName(name);
  if (!clean) return { ok: false, error: "Please choose a file with a name." };
  const ext = fileExtension(clean);
  if (!ext) return { ok: false, error: "This file has no ending (like .pdf), so it cannot be accepted." };
  if (ALWAYS_BLOCKED.has(ext)) return { ok: false, error: `Files ending in .${ext} are never accepted.` };
  // a double ending such as "report.pdf.exe" is judged by its LAST ending, but a blocked ending hidden in front of an allowed one is refused too
  const parts = clean.toLowerCase().split(".").slice(1);
  if (parts.slice(0, -1).some(p => ALWAYS_BLOCKED.has(p) && p !== ext)) return { ok: false, error: "This file name looks like a program with a second ending, so it was not accepted." };
  const allowed = rules.allowedTypes.map(t => t.toLowerCase());
  const same = (a: string, b: string) => a === b || (a === "jpeg" && b === "jpg") || (a === "jpg" && b === "jpeg");
  if (!TYPE_CATALOG[ext] || !allowed.some(a => same(a, ext))) return { ok: false, error: `Files ending in .${ext} are not accepted here. Allowed: ${allowed.map(a => "." + a).join(", ")}.` };
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: "This file is empty, so it was not accepted." };
  if (size > rules.maxFileMb * 1048576) return { ok: false, error: `This file is bigger than the allowed ${rules.maxFileMb} MB.` };
  return { ok: true, name: clean, ext, mime: TYPE_CATALOG[ext].mime };
}

// ── Lock key (a password for the link) ──────────────────────
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const encoder = new TextEncoder();

async function pbkdf2(key: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey("raw", encoder.encode(key), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, material, 256));
}
/** "pbkdf2$100000$<salt>$<hash>": made in the browser when the lock key is set, so the key itself is never sent to or stored by the database. */
export async function hashLockKey(key: string, iterations = 100000): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${iterations}$${b64(salt)}$${b64(await pbkdf2(key, salt, iterations))}`;
}
export async function verifyLockKey(key: string, stored: string): Promise<boolean> {
  const m = /^pbkdf2\$(\d+)\$([A-Za-z0-9+/=_-]+)\$([A-Za-z0-9+/=_-]+)$/.exec(stored ?? "");
  if (!m || !key) return false;
  const expected = unb64(m[3]), actual = await pbkdf2(key, unb64(m[2]), Number(m[1]));
  if (expected.length !== actual.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= expected[i] ^ actual[i];   // constant time
  return diff === 0;
}

export async function sha256Hex(text: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)))).map(b => b.toString(16).padStart(2, "0")).join("");
}
export function randomToken(bytes = 32): string {
  return b64(crypto.getRandomValues(new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ── The request handler ─────────────────────────────────────
type Rpc = <T = unknown>(name: string, args: Record<string, unknown>) => Promise<{ data: T | null; error: { message: string } | null }>;
export interface PublicDeps {
  rpc: Rpc;
  storage: {
    /** A one-time address the browser can send ONE file to, for exactly this storage spot. */
    signedUpload(path: string): Promise<{ url: string } | { error: string }>;
    /** The stored file's size, or null when nothing is stored there. */
    stat(path: string): Promise<{ size: number } | null>;
    /** The first bytes of the stored file. */
    head(path: string, bytes: number): Promise<Uint8Array | null>;
    remove(paths: string[]): Promise<void>;
  };
  ipSalt: string;
  /** Cloudflare Turnstile, when a key has been set (null = no CAPTCHA). */
  turnstile?: { verify(token: string, ip: string): Promise<boolean> } | null;
}
export interface PublicResult { status: number; json: Record<string, unknown> }

const fail = (status: number, error: string, extra: Record<string, unknown> = {}): PublicResult => ({ status, json: { error, ...extra } });
const GONE = "This upload link is no longer active.";
const LIMITS = { open: [10, 40], lockfail: [8, 24], start: [150, 800], finish: [200, 1000], mine: [300, 2000], info: [120, 600] } as const;

interface LinkRow {
  found: boolean; id: string; owner_id: string; folder_id: string; folder_name: string | null; folder_ok: boolean; title: string; instructions: string; lock_hash: string | null;
  status: string; max_files_per_person: number | null; max_file_mb: number; allowed_types: string[]; require_email: boolean; require_phone: boolean; allow_subfolders: boolean;
  subfolders: { id: string; name: string; location: string }[];
}

export async function handlePublic(deps: PublicDeps, body: Record<string, unknown>, ip: string): Promise<PublicResult> {
  const action = String(body.action ?? "");
  const token = String(body.token ?? "");
  if (!/^[a-f0-9]{64}$/.test(token)) return fail(404, GONE);
  const ipHash = await sha256Hex(`${deps.ipSalt}:${ip}`);

  const got = await deps.rpc<LinkRow>("storage_tool_public_link_get", { p_token: token });
  const link = got.data;
  if (got.error || !link || !link.found || !link.folder_ok) return fail(404, GONE);
  const active = link.status === "active";
  const limited = async (kind: keyof typeof LIMITS) => !(await deps.rpc<boolean>("storage_tool_public_rate", { p_link_id: link.id, p_ip_hash: ipHash, p_kind: kind, p_per_hour: LIMITS[kind][0], p_per_day: LIMITS[kind][1] })).data;
  const tooMany = () => fail(429, "Too many tries from your connection. Please wait a little and try again.");

  if (action === "info") {
    if (await limited("info")) return tooMany();
    if (!active) return { status: 200, json: { active: false, status: link.status } };
    return {
      status: 200,
      json: {
        active: true, status: "active", folderName: link.folder_name, title: link.title, instructions: link.instructions, needsLockKey: link.lock_hash !== null,
        requireEmail: link.require_email, requirePhone: link.require_phone, maxFileMb: link.max_file_mb, maxFilesPerPerson: link.max_files_per_person,
        allowedTypes: link.allowed_types.filter(t => TYPE_CATALOG[t]).map(t => ({ ext: t, label: TYPE_CATALOG[t].label })),
        allowSubfolders: link.allow_subfolders, subfolders: link.allow_subfolders ? link.subfolders : [], captcha: Boolean(deps.turnstile),
      },
    };
  }
  if (!active) return fail(410, GONE);

  if (action === "open") {
    if (await limited("open")) return tooMany();
    if (deps.turnstile && !(await deps.turnstile.verify(String(body.captchaToken ?? ""), ip))) return fail(400, "Please complete the check that you are a person, then try again.");
    if (link.lock_hash) {
      if (await limited("lockfail")) return tooMany();
      if (!(await verifyLockKey(String(body.lockKey ?? ""), link.lock_hash))) return fail(403, "The lock key is not right.", { code: "lock" });
    }
    const sessionToken = randomToken(32);
    const created = await deps.rpc<string>("storage_tool_public_session_create", {
      p_link_id: link.id, p_name: String(body.name ?? ""), p_email: String(body.email ?? ""), p_phone: String(body.phone ?? ""), p_session_hash: await sha256Hex(sessionToken), p_ip_hash: ipHash,
    });
    if (created.error) return fail(400, created.error.message);
    return { status: 200, json: { sessionToken } };
  }

  // everything below needs an open visit of THIS link
  const sessionToken = String(body.sessionToken ?? "");
  const session = (await deps.rpc<{ id?: string; link_id?: string; file_count?: number }>("storage_tool_public_session_get", { p_session_hash: await sha256Hex(sessionToken) })).data;
  if (!session || !session.id || session.link_id !== link.id) return fail(401, "Your visit has expired. Please open the link again.", { code: "session" });

  const requestedFolder = body.folderId ? String(body.folderId) : null;
  const folderAllowed = (id: string | null) => id === null || id === link.folder_id || (link.allow_subfolders && link.subfolders.some(s => s.id === id));

  if (action === "start") {
    if (await limited("start")) return tooMany();
    if (!folderAllowed(requestedFolder)) return fail(400, "That folder is not part of this link.");
    if (link.max_files_per_person !== null && Number(session.file_count ?? 0) >= link.max_files_per_person) return fail(400, `You have reached the limit of ${link.max_files_per_person} files for this link.`);
    const verdict = checkStart(String(body.fileName ?? ""), Number(body.size), { allowedTypes: link.allowed_types, maxFileMb: link.max_file_mb });
    if (!verdict.ok) return fail(400, verdict.error);
    const fileId = crypto.randomUUID();
    const path = `public/${link.id}/${fileId}`;
    const signed = await deps.storage.signedUpload(path);
    if ("error" in signed) return fail(500, "The upload could not be started. Please try again.");
    return { status: 200, json: { fileId, uploadUrl: signed.url, fileName: verdict.name } };
  }

  if (action === "finish") {
    if (await limited("finish")) return tooMany();
    const fileId = String(body.fileId ?? "");
    if (!/^[0-9a-f-]{36}$/.test(fileId)) return fail(400, "Unknown upload.");
    if (!folderAllowed(requestedFolder)) return fail(400, "That folder is not part of this link.");
    const path = `public/${link.id}/${fileId}`;
    const cleanName = cleanUploadName(String(body.fileName ?? ""));
    const stat = await deps.storage.stat(path);
    if (!stat) return fail(400, "The file did not arrive. Please try again.");
    const rejected = async (error: string) => { await deps.storage.remove([path]); return fail(422, error); };
    const verdict = checkStart(cleanName, stat.size, { allowedTypes: link.allowed_types, maxFileMb: link.max_file_mb });
    if (!verdict.ok) return rejected(verdict.error);
    const head = await deps.storage.head(path, 4096);
    if (!head) return rejected("The file could not be checked, so it was not accepted.");
    const content = checkContent(verdict.ext, head);
    if (!content.ok) return rejected(content.error);
    const reg = await deps.rpc<{ name: string; size: number }>("storage_tool_public_register", {
      p_session_id: session.id, p_file_id: fileId, p_folder_id: requestedFolder, p_name: verdict.name, p_mime: verdict.mime, p_size: stat.size, p_storage_path: path,
    });
    if (reg.error || !reg.data) return rejected(reg.error?.message ?? "The file could not be saved.");
    return { status: 200, json: { name: reg.data.name, size: reg.data.size } };
  }

  if (action === "mine") {
    if (await limited("mine")) return tooMany();
    const mine = await deps.rpc<{ name: string; size_bytes: number; at: string }[]>("storage_tool_public_mine", { p_session_id: session.id });
    return { status: 200, json: { files: (mine.data ?? []).map(f => ({ name: f.name, size: f.size_bytes, at: f.at })) } };
  }
  return fail(400, "Unknown request.");
}
