// tests/storage-tool/run_public_tests.mjs — the public upload page end to end: the real request handler (supabase/functions/_shared/storageToolPublic.ts)
// running against the real migration files in memory, with a pretend storage. These are the scenarios 8-14 of the plan: lock key, expiry, a person
// uploading, trying things they must not, disallowed types, an .exe renamed to .pdf, same names, a revoked link.   Run:  node tests/storage-tool/run_public_tests.mjs
import { build } from "esbuild";
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) globalThis.crypto = webcrypto;
let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stp-"));
const outfile = path.join(tmp, "public.mjs");
await build({ entryPoints: [path.join(root, "supabase/functions/_shared/storageToolPublic.ts")], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error" });
const P = await import(pathToFileURL(outfile).href);

const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
for (const n of ["p1", "p2", "p3"]) await db.exec(fs.readFileSync(path.join(root, `supabase_migration_storage_tool_${n}.sql`), "utf8"));
const A = seedId("staff:demo.storage"), B = seedId("staff:demo.storage2");

async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify({ sub: uid, role })]);
    return fn(tx);
  });
}
const mine = (sql, params = []) => as(A, async tx => (await tx.query(sql, params)).rows);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;

// The pretend storage: stored bytes by path. "Uploading" = the test puts bytes there (what the browser does with the one-time address).
const store = new Map();
const deps = {
  rpc: async (name, args) => {
    try {
      const rows = await as(null, async tx => {
        const keys = Object.keys(args), sql = `select public.${name}(${keys.map((k, i) => `$${i + 1}`).join(", ")}) as r`;
        return (await tx.query(sql, keys.map(k => args[k]))).rows;
      }, "service_role");
      return { data: rows[0].r, error: null };
    } catch (e) { return { data: null, error: { message: String(e.message) } }; }
  },
  storage: {
    signedUpload: async p => ({ url: `https://storage.test/upload/${p}?token=once` }),
    stat: async p => (store.has(p) ? { size: store.get(p).length } : null),
    head: async (p, n) => (store.has(p) ? store.get(p).slice(0, n) : null),
    remove: async paths => { for (const p of paths) store.delete(p); },
  },
  ipSalt: "test-salt",
  turnstile: null,
};
let ipCounter = 0;
const call = (body, ip = "10.0.0." + (++ipCounter)) => P.handlePublic(deps, body, ip);
const bytes = (...parts) => Uint8Array.from(parts.flatMap(p => (typeof p === "string" ? Array.from(p, c => c.charCodeAt(0)) : p)));
const PDF = bytes("%PDF-1.7\n1 0 obj\n"), PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "....IHDR"), EXE = bytes([0x4d, 0x5a, 0x90, 0x00], "This program cannot be run in DOS mode"), DOCX = bytes([0x50, 0x4b, 0x03, 0x04], "word/document.xml"), TXT = bytes("hello, this is a plain note\n");

// A folder tree for the owner, and a locked link with limits.
const docs = (await mine("select public.storage_tool_create_folder(null, 'Signed MOAs') r"))[0].r, sub = (await mine("select public.storage_tool_create_folder($1, 'Sub') r", [docs.id]))[0].r, secret = (await mine("select public.storage_tool_create_folder(null, 'Secret') r"))[0].r;
const lockHash = await P.hashLockKey("open sesame", 1000);
const link = (await mine("select public.storage_tool_link_create($1, $2::jsonb) l", [docs.id, JSON.stringify({ title: "MOA drop box", instructions: "Upload your signed MOA here", max_file_mb: 1, max_files_per_person: 3, allowed_types: ["pdf", "png", "docx", "txt"], require_email: true, allow_subfolders: true, lock_hash: lockHash })]))[0].l;
const open = (over = {}, ip) => call({ action: "open", token: link.token, name: "Maria Cruz", email: "maria@example.test", lockKey: "open sesame", ...over }, ip);
const setLink = (sql, params = []) => q(`update storage_tool_links set ${sql} where id = $1`, [link.id, ...params]);

console.log("\nThe link and the lock key");
check("the lock key is made in the browser style 'pbkdf2$...' and checked in constant time; a wrong or empty key never matches", /^pbkdf2\$1000\$/.test(lockHash) && await P.verifyLockKey("open sesame", lockHash) && !(await P.verifyLockKey("open Sesame", lockHash)) && !(await P.verifyLockKey("", lockHash)) && !(await P.verifyLockKey("open sesame", "garbage")) && !(await P.verifyLockKey("x", null)));
const info = await call({ action: "info", token: link.token });
check("the page can look a link up: folder, instructions, what is asked, limits and allowed types; never the lock hash or the owner", info.status === 200 && info.json.active === true && info.json.folderName === "Signed MOAs" && info.json.needsLockKey === true && info.json.requireEmail === true && info.json.maxFileMb === 1
  && info.json.allowedTypes.map(t => t.ext).sort().join() === "docx,pdf,png,txt" && !JSON.stringify(info.json).includes("pbkdf2") && !JSON.stringify(info.json).includes(A) && info.json.subfolders.some(s => s.name === "Sub"));
check("a wrong, unknown or badly formed link code gives the friendly 'no longer active' answer", (await call({ action: "info", token: "f".repeat(64) })).status === 404 && (await call({ action: "info", token: "../etc/passwd" })).status === 404 && (await call({ action: "info" })).json.error === "This upload link is no longer active.");
check("without the right lock key nobody gets in; with it they do", (await open({ lockKey: "" })).status === 403 && (await open({ lockKey: "wrong" })).json.code === "lock" && (await open()).status === 200);
check("a name is required, and the email the link asks for", (await open({ name: " " })).status === 400 && /name/i.test((await open({ name: "" })).json.error) && (await open({ email: "not-an-email" })).status === 400 && /email/i.test((await open({ email: "" })).json.error));
check("guessing the lock key is limited: after 8 wrong tries from one address the answer is 'too many tries'", await (async () => { const ip = "9.9.9.9"; let last; for (let i = 0; i < 10; i++) last = await open({ lockKey: "guess" + i }, ip); return last.status === 429; })());
check("opening a link is limited per address too (10 an hour)", await (async () => { const ip = "8.8.8.8"; let last; for (let i = 0; i < 12; i++) last = await open({}, ip); return last.status === 429; })());

console.log("\nUploading");
const visit = async (name = "Maria Cruz") => (await open({ name })).json.sessionToken;
const maria = await visit("Maria Cruz");
const start = (session, over = {}) => call({ action: "start", token: link.token, sessionToken: session, fileName: "moa.pdf", size: PDF.length, ...over });
const finish = (session, started, over = {}) => call({ action: "finish", token: link.token, sessionToken: session, fileId: started.json.fileId, fileName: "moa.pdf", ...over });
const put = (started, content) => store.set(`public/${link.id}/${started.json.fileId}`, content);
check("starting an upload needs an open visit of THIS link (a made-up or another link's visit is refused)", (await start("nope")).status === 401 && (await start("")).json.code === "session");
const s1 = await start(maria);
check("the server chooses the storage spot and gives a one-time address for it; the visitor never chooses a path", s1.status === 200 && /^[0-9a-f-]{36}$/.test(s1.json.fileId) && s1.json.uploadUrl.includes(`public/${link.id}/${s1.json.fileId}`) && s1.json.fileName === "moa.pdf");
put(s1, PDF);
const f1 = await finish(maria, s1);
check("a real PDF is checked (size, first bytes) and saved in the folder with the uploader's name; the folder's owner owns it", f1.status === 200 && f1.json.name === "moa.pdf" && (await q("select owner_id, uploader_label, link_id, storage_path from storage_tool_files where name = 'moa.pdf'"))[0].owner_id === A
  && (await q("select uploader_label from storage_tool_files where name = 'moa.pdf'"))[0].uploader_label === "Maria Cruz");
const s2 = await start(maria); put(s2, PDF); const f2 = await finish(maria, s2);
check("the same file name twice: both are kept ('moa (1).pdf')", f2.status === 200 && f2.json.name === "moa (1).pdf");
check("two different visitors uploading the same name: both kept, and each sees only their own uploads", await (async () => {
  const juan = await visit("Juan Dela Cruz"); const s = await start(juan); put(s, PDF); const r = await finish(juan, s);
  const seeJuan = (await call({ action: "mine", token: link.token, sessionToken: juan })).json.files, seeMaria = (await call({ action: "mine", token: link.token, sessionToken: maria })).json.files;
  return r.json.name === "moa (2).pdf" && seeJuan.length === 1 && seeMaria.length === 2 && !seeMaria.some(f => f.name === "moa (2).pdf");
})());
check("the per-person limit (3 files) stops the fourth", await (async () => { const s3 = await start(maria); put(s3, PDF); await finish(maria, s3); const s4 = await start(maria); return s4.status === 400 && /limit of 3 files/.test(s4.json.error); })());

console.log("\nFiles that must not be accepted");
const hold = await visit("Peter Tester");
const rejectedAtStart = async (fileName, size = 100) => (await start(hold, { fileName, size }));
check("endings the link does not allow are refused before anything is sent (and the message lists what is allowed)", (await rejectedAtStart("photo.jpg")).status === 400 && /Allowed: \.docx, \.pdf/.test((await rejectedAtStart("photo.jpg")).json.error) && (await rejectedAtStart("sheet.xlsx")).status === 400);
check("programs, scripts and web pages are refused whatever the link allows, also with a second ending", (await rejectedAtStart("setup.exe")).status === 400 && (await rejectedAtStart("run.bat")).status === 400 && (await rejectedAtStart("x.html")).status === 400 && (await rejectedAtStart("logo.svg")).status === 400
  && (await rejectedAtStart("report.pdf.exe")).status === 400 && (await rejectedAtStart("setup.exe.pdf")).status === 400 && (await rejectedAtStart("noending")).status === 400);
check("empty files and files over the link's size (1 MB) are refused", (await rejectedAtStart("a.pdf", 0)).status === 400 && /bigger than the allowed 1 MB/.test((await rejectedAtStart("a.pdf", 2 * 1048576)).json.error));
check("a folder that is not part of the link (the owner's other folder) is refused; an inside sub-folder is fine", (await start(hold, { folderId: secret.id })).status === 400 && (await start(hold, { folderId: sub.id })).status === 200);
const exe = await start(hold, { fileName: "invoice.pdf", size: EXE.length }); put(exe, EXE); const exeResult = await finish(hold, exe, { fileName: "invoice.pdf" });
check("an .exe renamed to .pdf is caught by its content: refused, and the stored file is deleted at once", exeResult.status === 422 && /program|web page/.test(exeResult.json.error) && ![...store.keys()].some(k => k.endsWith(exe.json.fileId)) && (await q("select count(*)::int n from storage_tool_files where name = 'invoice.pdf'"))[0].n === 0);
const mismatch = await start(hold, { fileName: "scan.pdf", size: PNG.length }); put(mismatch, PNG);
check("a picture named .pdf is refused because its content does not match its name", (await finish(hold, mismatch, { fileName: "scan.pdf" })).status === 422 && ![...store.keys()].some(k => k.endsWith(mismatch.json.fileId)));
const binTxt = await start(hold, { fileName: "notes.txt", size: 40 }); put(binTxt, bytes("ok", [0, 1, 2, 3], "binary"));
check("a 'text' file with binary content is refused; a real text file and a real Word file are accepted", (await finish(hold, binTxt, { fileName: "notes.txt" })).status === 422 && await (async () => { const t = await start(hold, { fileName: "notes.txt", size: TXT.length }); put(t, TXT); const d = await start(hold, { fileName: "memo.docx", size: DOCX.length }); put(d, DOCX); return (await finish(hold, t, { fileName: "notes.txt" })).status === 200 && (await finish(hold, d, { fileName: "memo.docx" })).status === 200; })());
const swapped = await start(hold, { fileName: "a.pdf", size: 100 }); put(swapped, PDF);
check("a file whose real size or name differs from what was announced is judged again at the end (a PDF finished under an .exe name is refused)", (await finish(hold, swapped, { fileName: "a.exe" })).status === 422);
const oversize = await start(hold, { fileName: "big.pdf", size: 100 }); { const big = new Uint8Array(2 * 1048576 + 5); big.set(bytes("%PDF-")); put(oversize, big); }
check("a file that turns out bigger than the link allows (announced small, sent big) is refused and deleted", (await finish(hold, oversize, { fileName: "big.pdf" })).status === 422 && ![...store.keys()].some(k => k.endsWith(oversize.json.fileId)));
check("finishing something that was never sent says so", (await call({ action: "finish", token: link.token, sessionToken: hold, fileId: "0".repeat(8) + "-0000-0000-0000-" + "0".repeat(12), fileName: "x.pdf" })).status === 400 && (await call({ action: "finish", token: link.token, sessionToken: hold, fileId: "../x", fileName: "x.pdf" })).status === 400);

console.log("\nThings a visitor must not be able to do");
check("there is no way to delete, rename, move, list or read anything: every other request is refused", await (async () => { for (const action of ["delete", "rename", "move", "list", "read", "download", "share"]) if ((await call({ action, token: link.token, sessionToken: maria })).status !== 400) return false; return true; })());
check("a visit of one link is useless on another link", await (async () => {
  const other = (await mine("select public.storage_tool_link_create($1, '{}'::jsonb) l", [secret.id]))[0].l;
  const r = await call({ action: "start", token: other.token, sessionToken: maria, fileName: "a.pdf", size: 10 });
  return r.status === 401;
})());
check("the stored files are not reachable by a visitor: nothing is returned except names and sizes of their own uploads", JSON.stringify((await call({ action: "mine", token: link.token, sessionToken: maria })).json).includes("public/") === false);
check("with a CAPTCHA configured, opening without passing it is refused", await (async () => { const withCaptcha = { ...deps, turnstile: { verify: async t => t === "good" } }; const noPass = await P.handlePublic(withCaptcha, { action: "open", token: link.token, name: "Maria", email: "m@x.test", lockKey: "open sesame", captchaToken: "bad" }, "7.7.7.7"); const pass = await P.handlePublic(withCaptcha, { action: "open", token: link.token, name: "Maria", email: "m@x.test", lockKey: "open sesame", captchaToken: "good" }, "7.7.7.8"); const infoCaptcha = await P.handlePublic(withCaptcha, { action: "info", token: link.token }, "7.7.7.9"); return noPass.status === 400 && pass.status === 200 && infoCaptcha.json.captcha === true; })());

console.log("\nPaused, expired and revoked links");
const alive = await visit("Late Comer");
await setLink("status = 'paused'");
check("a paused link shows 'no longer active' and accepts nothing, even for a visit that was already open", (await call({ action: "info", token: link.token })).json.active === false && (await start(alive)).status === 410 && (await open()).status === 410);
await setLink("status = 'active', expires_at = now() - interval '1 minute'");
check("an expired link does the same", (await call({ action: "info", token: link.token })).json.status === "expired" && (await start(alive)).status === 410);
await setLink("status = 'active', expires_at = null");
const pending = await start(alive); put(pending, PDF);
await mine("select public.storage_tool_link_set_status($1, 'revoked')", [link.id]);
check("a revoked link stops everything at once, including an upload that was started but not finished", (await finish(alive, pending)).status === 410 && (await open()).status === 410 && (await call({ action: "info", token: link.token })).json.active === false);

console.log("\nWhat the owner sees");
const files = await q("select name, uploader_label, owner_id from storage_tool_files where link_id = $1 order by name", [link.id]);
check("every accepted file is in the owner's folder with the visitor's name, and nothing else was saved", files.length === 6 && files.every(f => f.owner_id === A) && files.some(f => f.uploader_label === "Juan Dela Cruz") && !files.some(f => f.name === "invoice.pdf" || f.name === "scan.pdf"));
await q("update storage_tool_upload_sessions set last_upload_at = now() - interval '5 minutes' where link_id = $1", [link.id]);
await as(null, async tx => tx.query("select public.storage_tool_notify_uploads()"), "service_role");
check("the owner gets one grouped notice per visit (e.g. 'Maria Cruz uploaded 3 files ...')", (await q("select message from notifications where type = 'storage' and user_id = $1 and message like 'Maria Cruz uploaded 3 files%'", [A])).length === 1 && (await q("select count(*)::int n from notifications where type = 'storage' and title = 'Storage Tool: new uploads' and user_id = $1", [A]))[0].n >= 3);
check("the stand-in storage deps never saw a path outside public/<link>/", [...store.keys()].every(k => k.startsWith(`public/${link.id}/`)));

console.log(`\n${failed === 0 ? "ALL PUBLIC UPLOAD CHECKS PASSED" : "SOME CHECKS FAILED"} — ${passed} passed, ${failed} failed`);
await db.close();
process.exit(failed === 0 ? 0 : 1);
