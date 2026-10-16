// tests/storage-tool/run_p3_db_tests.mjs — Storage Tool, Phase 3, against the real migration files in memory.
// Sharing with staff (view < upload < edit, inside the share only), the owner keeps ownership, storage rules by file row, upload-only links and
// everything the server function relies on (sessions, limits, rate limit, registering, notices).   Run:  node tests/storage-tool/run_p3_db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };

const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const FILES = ["p1", "p2", "p3"].map(n => new URL(`../../supabase_migration_storage_tool_${n}.sql`, import.meta.url));
for (const f of FILES) await db.exec(fs.readFileSync(f, "utf8"));

const staffUid = name => seedId(`staff:${name}`);
const ITADMIN = staffUid("it.admin1"), A = staffUid("demo.storage"), B = staffUid("demo.storage2"), C = staffUid("demo.plain");
const uuid = () => randomUUID();

async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify({ sub: uid, role })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = [], role) => as(uid, async tx => (await tx.query(sql, params)).rows, role);
const one = async (uid, sql, params = []) => (await rows(uid, sql, params))[0];
const svc = (sql, params = []) => rows(null, sql, params, "service_role");
const fails = async (uid, sql, params, pattern, role) => { try { await rows(uid, sql, params, role); return false; } catch (e) { return pattern ? pattern.test(String(e.message)) : true; } };
const q = async (sql, params = []) => (await db.query(sql, params)).rows;

const folder = async (uid, parent, name) => (await one(uid, "select public.storage_tool_create_folder($1, $2) r", [parent, name])).r;
const putObject = (uid, id, size = 100, mime = "application/pdf") => rows(uid, "insert into storage.objects (bucket_id, name, owner, metadata) values ('storage-tool', $1, $2, $3::jsonb)", [`${uid}/${id}`, uid, JSON.stringify({ mimetype: mime, size })]);
const file = async (uid, folderId, name, size = 100) => { const id = uuid(); await putObject(uid, id, size); return (await one(uid, "select public.storage_tool_register_file($1, $2, $3, 'application/pdf') r", [id, folderId, name])).r; };
const items = list => JSON.stringify(list.map(([kind, id]) => ({ kind, id })));
const browse = async (uid, id) => (await one(uid, "select public.storage_tool_browse($1) b", [id])).b;
const share = (uid, kind, id, to, perm) => rows(uid, "select public.storage_tool_share_set($1, $2, $3, $4)", [kind, id, to, perm]);

console.log("\nSharing with staff");
const docs = await folder(A, null, "Docs"), sub = await folder(A, docs.id, "Sub"), secret = await folder(A, null, "Secret");
const fd = await file(A, docs.id, "doc.pdf"), fs1 = await file(A, sub.id, "deep.pdf"), fsec = await file(A, secret.id, "hidden.pdf");
check("nothing is shared at first: another person cannot browse, read or find a folder", await fails(B, "select public.storage_tool_browse($1)", [docs.id], /not found/) && (await one(B, "select public.storage_tool_shared_with_me() s")).s.length === 0
  && await fails(B, "select public.storage_tool_subtree($1)", [docs.id], /not found/) && await fails(B, "select public.storage_tool_details('file', $1)", [fd.id], /not found/));
check("only the owner can share; the person must be able to use the tool; not with yourself; a file cannot be shared as 'upload'", await fails(B, "select public.storage_tool_share_set('folder', $1, $2, 'view')", [docs.id, A], /Only the owner/)
  && await fails(A, "select public.storage_tool_share_set('folder', $1, $2, 'view')", [docs.id, C], /cannot use the Storage Tool/) && await fails(A, "select public.storage_tool_share_set('folder', $1, $2, 'view')", [docs.id, A], /yourself/)
  && await fails(A, "select public.storage_tool_share_set('file', $1, $2, 'upload')", [fd.id, B], /viewing or editing/) && await fails(A, "select public.storage_tool_share_set('folder', $1, $2, 'owner')", [docs.id, B], /view, upload or edit/));
await share(A, "folder", docs.id, B, "view");
const bView = await browse(B, docs.id);
check("shared for VIEW: the folder, its files and sub-folders (inheritance) are visible with the level and the owner's name; the shared item is listed under 'Shared with me'", bView.level === 1 && bView.files.some(f => f.name === "doc.pdf") && bView.folders.some(f => f.name === "Sub") && bView.owner_name === "TEST Storage Staff"
  && (await browse(B, sub.id)).level === 1 && (await one(B, "select public.storage_tool_shared_with_me() s")).s.map(x => x.name).join() === "Docs");
check("the path shows only what the person may see (not the owner's folders above the share)", JSON.stringify((await browse(B, sub.id)).path.map(p => p.name)) === JSON.stringify(["Docs", "Sub"]));
check("what is NOT shared stays hidden (a sibling folder, the top of the owner's storage)", await fails(B, "select public.storage_tool_browse($1)", [secret.id], /not found/) && (await browse(B, null)).level === 4 && (await browse(B, null)).folders.length === 0);
check("with view the person can read details and the contents (for copying and ZIP), and the stored file is readable; others' files are not", (await one(B, "select public.storage_tool_details('file', $1) d", [fd.id])).d.name === "doc.pdf"
  && (await one(B, "select public.storage_tool_subtree($1) s", [docs.id])).s.files.length === 2 && (await rows(B, "select name from storage.objects where bucket_id = 'storage-tool' and name = $1", [`${A}/${fd.id}`])).length === 1
  && (await rows(B, "select name from storage.objects where bucket_id = 'storage-tool' and name = $1", [`${A}/${fsec.id}`])).length === 0);
check("with view the person can NOT add, rename, move, delete or share anything", await fails(B, "select public.storage_tool_create_folder($1, 'x')", [docs.id], /not found/) && await fails(B, "select public.storage_tool_rename('file', $1, 'x')", [fd.id], /not found/)
  && await fails(B, "select public.storage_tool_move($1::jsonb, null)", [items([["file", fd.id]])], /not found/) && await fails(B, "select public.storage_tool_trash($1::jsonb)", [items([["file", fd.id]])], /not found/)
  && await fails(B, "select public.storage_tool_share_set('folder', $1, $2, 'view')", [docs.id, ITADMIN], /Only the owner/));
check("the person was told", (await q("select count(*)::int n from notifications where type = 'storage' and user_id = $1 and message like '%shared the folder \"Docs\"%'", [B]))[0].n === 1);
await share(A, "folder", docs.id, B, "upload");
const upId = uuid(); await putObject(B, upId, 321);
const upRow = (await one(B, "select public.storage_tool_register_file($1, $2, 'from-b.pdf', 'application/pdf') r", [upId, docs.id])).r;
const bFolder = await folder(B, sub.id, "B made this");
check("shared for UPLOAD: the person adds files and folders; the file belongs to the OWNER (but is stored under the uploader's id) and says who uploaded it", (await browse(B, docs.id)).level === 2
  && (await q("select owner_id, uploaded_by, storage_path from storage_tool_files where id = $1", [upId]))[0].owner_id === A && (await q("select uploaded_by from storage_tool_files where id = $1", [upId]))[0].uploaded_by === B && upRow.name === "from-b.pdf"
  && (await q("select owner_id from storage_tool_folders where id = $1", [bFolder.id]))[0].owner_id === A && (await browse(A, docs.id)).files.some(f => f.name === "from-b.pdf"));
check("with upload the person still cannot rename, move or delete, not even their own upload", await fails(B, "select public.storage_tool_rename('file', $1, 'x')", [upId], /not found/) && await fails(B, "select public.storage_tool_trash($1::jsonb)", [items([["file", upId]])], /not found/));
check("a person cannot upload into a folder that is only shared for view, or register into somebody's folder with no share", await (async () => { const id = uuid(); await putObject(B, id); return fails(B, "select public.storage_tool_register_file($1, $2, 'x.pdf', null)", [id, secret.id], /not found/); })());
check("the usage and the 200 GB count belong to the owner: the owner's number includes what others uploaded", (await one(A, "select public.storage_tool_usage() u")).u.mine_bytes >= 321 + 300 && (await one(B, "select public.storage_tool_usage() u")).u.mine_bytes === 0);
await share(A, "folder", docs.id, B, "edit");
check("shared for EDIT: rename, move inside the share and delete work on items INSIDE it", (await one(B, "select public.storage_tool_rename('file', $1, 'edited.pdf') r", [upId])).r.name === "edited.pdf"
  && (await one(B, "select public.storage_tool_move($1::jsonb, $2) r", [items([["file", upId]]), sub.id])).r.moved === 1 && (await one(B, "select public.storage_tool_rename('folder', $1, 'B renamed') r", [bFolder.id])).r.name === "B renamed");
check("the shared folder itself stays the owner's to rename, move or delete; moving out of the share into one's own storage is refused", await fails(B, "select public.storage_tool_rename('folder', $1, 'mine now')", [docs.id], /not found/) && await fails(B, "select public.storage_tool_trash($1::jsonb)", [items([["folder", docs.id]])], /not found/)
  && await fails(B, "select public.storage_tool_move($1::jsonb, null)", [items([["file", upId]])], /same storage|not found/) && await (async () => { const mine = await folder(B, null, "Mine"); return fails(B, "select public.storage_tool_move($1::jsonb, $2)", [items([["file", upId]]), mine.id], /same storage/); })());
await rows(B, "select public.storage_tool_trash($1::jsonb)", [items([["file", upId]])]);
check("what an editor deletes goes to the OWNER's Trash (and is gone from the folder)", (await one(A, "select public.storage_tool_trash_list() l")).l.items.some(i => i.name === "edited.pdf") && (await one(B, "select public.storage_tool_trash_list() l")).l.items.length === 0 && !(await browse(A, sub.id)).files.some(f => f.name === "edited.pdf"));
check("the owner deletes it forever: the stored file under the EDITOR's prefix can be removed by the owner only, and only from the Trash", await (async () => {
  const path = `${B}/${upId}`;
  const byEditor = await rows(B, "delete from storage.objects where bucket_id = 'storage-tool' and name = $1 returning name", [path]);
  const prepared = (await one(A, "select public.storage_tool_forever_prepare($1::jsonb) p", [items([["file", upId]])])).p;
  const byOwner = await rows(A, "delete from storage.objects where bucket_id = 'storage-tool' and name = $1 returning name", [path]);
  const fin = (await one(A, "select public.storage_tool_forever_finish($1::jsonb) r", [items([["file", upId]])])).r;
  return byEditor.length === 0 && prepared.includes(path) && byOwner.length === 1 && fin.deleted_files === 1;
})());
check("a trashed folder is no longer reachable through the share", await (async () => { await rows(A, "select public.storage_tool_trash($1::jsonb)", [items([["folder", sub.id]])]); const gone = await fails(B, "select public.storage_tool_browse($1)", [sub.id], /not found/); await rows(A, "select public.storage_tool_restore($1::jsonb)", [items([["folder", sub.id]])]); return gone; })());
check("who an item is shared with is visible to the owner only; permissions can be changed and removed", (await one(A, "select public.storage_tool_shares_of('folder', $1) s", [docs.id])).s.length === 1 && (await one(B, "select public.storage_tool_shares_of('folder', $1) s", [docs.id])).s.length === 0
  && await (async () => { await rows(A, "select public.storage_tool_share_remove('folder', $1, $2)", [docs.id, B]); return (await fails(B, "select public.storage_tool_browse($1)", [docs.id], /not found/)) && (await one(A, "select public.storage_tool_shares_of('folder', $1) s", [docs.id])).s.length === 0; })());
check("a single FILE can be shared (view) without its folder: only that file is reachable", await (async () => {
  await share(A, "file", fsec.id, B, "view");
  const list = (await one(B, "select public.storage_tool_shared_with_me() s")).s;
  const ok = list.length === 1 && list[0].kind === "file" && (await one(B, "select public.storage_tool_details('file', $1) d", [fsec.id])).d.name === "hidden.pdf" && (await rows(B, "select name from storage.objects where bucket_id = 'storage-tool' and name = $1", [`${A}/${fsec.id}`])).length === 1
    && await fails(B, "select public.storage_tool_browse($1)", [secret.id], /not found/);
  await rows(A, "select public.storage_tool_share_remove('file', $1, $2)", [fsec.id, B]);
  return ok;
})());
check("a person who loses the tool tag loses access to what was shared", await (async () => {
  await share(A, "folder", docs.id, B, "view");
  await q("delete from staff_account_tags where staff_id = $1 and tag_key = 'storage_tool'", [B]);
  const blocked = await fails(B, "select public.storage_tool_browse($1)", [docs.id], /do not have access/);
  await q("insert into staff_account_tags (staff_id, tag_key) values ($1, 'storage_tool')", [B]);
  await rows(A, "select public.storage_tool_share_remove('folder', $1, $2)", [docs.id, B]);
  return blocked;
})());
check("search for people to share with: staff who can use the tool, never me, never without the tag", await (async () => {
  const hit = (await one(A, "select public.storage_tool_staff_search('storage') s")).s;
  return hit.some(x => x.id === B) && !hit.some(x => x.id === A) && !hit.some(x => x.id === C) && (await one(A, "select public.storage_tool_staff_search('s') s")).s.length === 0 && await fails(C, "select public.storage_tool_staff_search('storage')", [], /do not have access/);
})());
check("the owner's own storage behaves as before: private, folders 'My storage' level 4, nothing shown of others", (await browse(A, null)).level === 4 && (await browse(A, null)).folders.length >= 2 && (await browse(B, null)).files.length === 0);

console.log("\nUpload links (the owner's side)");
const link = (await one(A, "select public.storage_tool_link_create($1, $2::jsonb) l", [docs.id, JSON.stringify({ title: "Signed MOAs", instructions: "Upload your signed MOA here", max_file_mb: 10, max_files_per_person: 2, allowed_types: ["pdf", "PNG", "docx", "bad type!"], require_email: true, allow_subfolders: true })])).l;
check("the owner of a folder makes a link: a long random code, the settings are kept, the types are tidied, it starts active", link.token.length === 64 && link.status === "active" && link.max_file_mb === 10 && link.max_files_per_person === 2 && link.allowed_types.sort().join() === "docx,pdf,png" && link.require_email === true && link.has_lock === false && link.uploads === 0);
check("nobody else can make a link for somebody's folder, and the lists show only my own links", await fails(B, "select public.storage_tool_link_create($1, '{}'::jsonb)", [docs.id], /Only the owner/) && (await one(A, "select public.storage_tool_links_list(null) l")).l.length === 1 && (await one(B, "select public.storage_tool_links_list(null) l")).l.length === 0
  && (await rows(B, "select id from storage_tool_links")).length === 0 && (await rows(A, "select id from storage_tool_links")).length === 1);
check("the settings are checked (sizes, counts, types, the lock key's form)", await fails(A, "select public.storage_tool_link_create($1, $2::jsonb)", [docs.id, JSON.stringify({ max_file_mb: 900 })], /between 1 and 500/) && await fails(A, "select public.storage_tool_link_create($1, $2::jsonb)", [docs.id, JSON.stringify({ allowed_types: ["???"] })], /at least one file type/)
  && await fails(A, "select public.storage_tool_link_create($1, $2::jsonb)", [docs.id, JSON.stringify({ lock_hash: "plain-password" })], /not in the right form/) && await fails(A, "select public.storage_tool_link_create($1, $2::jsonb)", [docs.id, JSON.stringify({ max_files_per_person: 0 })], /between 1 and 1000/));
const LOCK = "pbkdf2$100000$c2FsdHNhbHQ=$aGFzaGhhc2hoYXNo";
const upd = (await one(A, "select public.storage_tool_link_update($1, $2::jsonb) l", [link.id, JSON.stringify({ lock_hash: LOCK, expires_at: new Date(Date.now() + 86400000).toISOString() })])).l;
check("a lock key and an expiry can be added, then removed ('' removes, absent keeps)", upd.has_lock === true && upd.expires_at !== null && (await one(A, "select public.storage_tool_link_update($1, $2::jsonb) l", [link.id, JSON.stringify({ title: "Signed MOAs 2026" })])).l.has_lock === true
  && (await one(A, "select public.storage_tool_link_update($1, $2::jsonb) l", [link.id, JSON.stringify({ lock_hash: "", expires_at: "" })])).l.has_lock === false);
check("pause, resume and revoke; a revoked link stays revoked and cannot be changed", (await one(A, "select public.storage_tool_link_set_status($1, 'paused') l", [link.id])).l.status === "paused" && (await one(A, "select public.storage_tool_link_set_status($1, 'active') l", [link.id])).l.status === "active"
  && await fails(B, "select public.storage_tool_link_set_status($1, 'revoked')", [link.id], /not found/) && await (async () => { const tmp = (await one(A, "select public.storage_tool_link_create($1, '{}'::jsonb) l", [docs.id])).l; await rows(A, "select public.storage_tool_link_set_status($1, 'revoked')", [tmp.id]);
    return (await fails(A, "select public.storage_tool_link_set_status($1, 'active')", [tmp.id], /stays revoked/)) && (await fails(A, "select public.storage_tool_link_update($1, '{}'::jsonb)", [tmp.id], /revoked link cannot be changed/)); })());

console.log("\nWhat the public page needs (service role only)");
const get = async t => (await svc("select public.storage_tool_public_link_get($1) g", [t]))[0].g;
check("the visitor-facing functions cannot be called by signed-in people or anybody else", await fails(A, "select public.storage_tool_public_link_get($1)", [link.token], /permission denied/) && await fails(null, "select public.storage_tool_public_link_get($1)", [link.token], /permission denied/, "anon")
  && await fails(A, "select public.storage_tool_public_register($1, $2, null, 'x', 'x', 1, 'x')", [uuid(), uuid()], /permission denied/) && await fails(A, "select public.storage_tool_notify_uploads()", [], /permission denied/));
const g1 = await get(link.token);
check("looking a link up by its code: unknown codes are 'not found'; sub-folders are listed when allowed; the lock hash is only in the server's answer", (await get("nope")).found === false && g1.found && g1.folder_name === "Docs" && g1.status === "active" && g1.subfolders.some(s => s.name === "Sub") && g1.lock_hash === null && g1.max_file_mb === 10);
check("expired, paused and revoked links answer with their state", await (async () => {
  await q("update storage_tool_links set expires_at = now() - interval '1 minute' where id = $1", [link.id]); const e = (await get(link.token)).status;
  await q("update storage_tool_links set expires_at = null, status = 'paused' where id = $1", [link.id]); const p = (await get(link.token)).status;
  await q("update storage_tool_links set status = 'active' where id = $1", [link.id]); return e === "expired" && p === "paused";
})());
const sess = async (name = "Maria Cruz", email = "maria@example.test", phone = "", hash = "h" + uuid()) => (await svc("select public.storage_tool_public_session_create($1, $2, $3, $4, $5, 'ip1') s", [link.id, name, email, phone, hash]))[0].s;
check("a visit needs a name (and the email / phone the link asks for), and only works on an active link", await fails(null, "select public.storage_tool_public_session_create($1, 'M', '', '', 'h1', 'ip')", [link.id], /type your name/, "service_role") && await fails(null, "select public.storage_tool_public_session_create($1, 'Maria', 'no-at', '', 'h2', 'ip')", [link.id], /email/, "service_role")
  && await (async () => { await q("update storage_tool_links set status = 'paused' where id = $1", [link.id]); const r = await fails(null, "select public.storage_tool_public_session_create($1, 'Maria', 'm@x.test', '', 'h3', 'ip')", [link.id], /no longer active/, "service_role"); await q("update storage_tool_links set status = 'active' where id = $1", [link.id]); return r; })());
const rate = async n => { let last = true; for (let i = 0; i < n; i++) last = (await svc("select public.storage_tool_public_rate($1, 'ipx', 'start', 3, 10) r", [link.id]))[0].r; return last; };
check("the rate limit lets a visitor's address do 3 calls an hour and then says no; another address is not affected", await rate(3) === true && (await svc("select public.storage_tool_public_rate($1, 'ipx', 'start', 3, 10) r", [link.id]))[0].r === false && (await svc("select public.storage_tool_public_rate($1, 'ipy', 'start', 3, 10) r", [link.id]))[0].r === true);
const s1 = await sess("Maria Cruz");
const reg = async (sessionId, name, size = 500, folderId = null) => { const id = uuid(); return (await svc("select public.storage_tool_public_register($1, $2, $3, $4, 'application/pdf', $5, $6) r", [sessionId, id, folderId, name, size, `public/${link.id}/${id}`]))[0].r; };
const r1 = await reg(s1, "moa.pdf"), r2 = await reg(s1, "moa.pdf");
check("registering an upload puts it in the link's folder, owned by the folder's owner, with the uploader's name; the same name keeps both", r1.name === "moa.pdf" && r2.name === "moa (1).pdf" && (await q("select owner_id, uploader_label, link_id, uploaded_by from storage_tool_files where id = $1", [r1.id]))[0].uploader_label === "Maria Cruz"
  && (await q("select owner_id from storage_tool_files where id = $1", [r1.id]))[0].owner_id === A && (await q("select uploaded_by from storage_tool_files where id = $1", [r1.id]))[0].uploaded_by === null);
check("the per-person limit (2 files) stops a third file, and the visitor sees only their own uploads", await (async () => { try { await reg(s1, "third.pdf"); return false; } catch (e) { return /limit of 2 files/.test(String(e.message)); } })() && (await svc("select public.storage_tool_public_mine($1) m", [s1]))[0].m.length === 2
  && (await svc("select public.storage_tool_public_mine($1) m", [await sess("Other Person")]))[0].m.length === 0);
const s2 = await sess("Juan Dela Cruz");
check("the link's size limit is enforced again at registration (10 MB here)", await (async () => { try { await reg(s2, "big.pdf", 11 * 1048576); return false; } catch (e) { return /larger than the allowed 10 MB/.test(String(e.message)); } })());
check("sub-folders: allowed only when the link says so and only inside the link's folder", (await reg(s2, "in-sub.pdf", 100, sub.id)).name === "in-sub.pdf" && await (async () => { try { await reg(s2, "outside.pdf", 100, secret.id); return false; } catch (e) { return /not part of this link/.test(String(e.message)); } })()
  && await (async () => { await q("update storage_tool_links set allow_subfolders = false where id = $1", [link.id]); try { await reg(s2, "x.pdf", 100, sub.id); return false; } catch (e) { return /not part of this link/.test(String(e.message)); } finally { await q("update storage_tool_links set allow_subfolders = true where id = $1", [link.id]); } })());
check("a revoked, paused or expired link accepts nothing more, not even for a visit that was already open", await (async () => { await q("update storage_tool_links set status = 'paused' where id = $1", [link.id]); try { await reg(s2, "late.pdf"); return false; } catch (e) { return /no longer active/.test(String(e.message)); } finally { await q("update storage_tool_links set status = 'active' where id = $1", [link.id]); } })());
check("a visit that does not exist or is older than 12 hours is refused", await (async () => { try { await reg(uuid(), "x.pdf"); return false; } catch (e) { return /expired/.test(String(e.message)); } })() && (await svc("select public.storage_tool_public_session_get('unknown') s"))[0].s.id === undefined);
check("the owner sees the visitors and what each uploaded; the link shows its counts", await (async () => { const v = (await one(A, "select public.storage_tool_link_visitors($1) v", [link.id])).v; const l = (await one(A, "select public.storage_tool_links_list($1) l", [docs.id])).l.find(x => x.id === link.id); return v.length === 2 && v.find(x => x.name === "Maria Cruz").files === 2 && l.uploads === 3 && l.visitors === 2; })() && await fails(B, "select public.storage_tool_link_visitors($1)", [link.id], /not found/));
check("the owner can read an uploaded file (stored under the link's prefix) and nobody else can; the owner can remove it only from the Trash", await (async () => {
  await q("insert into storage.objects (bucket_id, name, metadata) values ('storage-tool', $1, $2::jsonb)", [`public/${link.id}/${r1.id}`, JSON.stringify({ size: 500, mimetype: "application/pdf" })]);
  await q("update storage_tool_files set storage_path = $1 where id = $2", [`public/${link.id}/${r1.id}`, r1.id]);
  const owner = (await rows(A, "select name from storage.objects where name = $1", [`public/${link.id}/${r1.id}`])).length === 1, other = (await rows(B, "select name from storage.objects where name = $1", [`public/${link.id}/${r1.id}`])).length === 0;
  const early = (await rows(A, "delete from storage.objects where name = $1 returning name", [`public/${link.id}/${r1.id}`])).length === 0;
  await rows(A, "select public.storage_tool_trash($1::jsonb)", [items([["file", r1.id]])]);
  const late = (await rows(A, "delete from storage.objects where name = $1 returning name", [`public/${link.id}/${r1.id}`])).length === 1;
  return owner && other && early && late;
})());

console.log("\nNotices");
await q("update storage_tool_upload_sessions set last_upload_at = now() where link_id = $1", [link.id]);
check("no notice while the visitor is still uploading (less than a minute since the last file)", (await svc("select public.storage_tool_notify_uploads() n"))[0].n === 0);
await q("update storage_tool_upload_sessions set last_upload_at = now() - interval '2 minutes' where link_id = $1", [link.id]);
check("one notice per visit to the person who made the link, grouped: 'Maria Cruz uploaded 2 files to \"Docs\"'", (await svc("select public.storage_tool_notify_uploads() n"))[0].n === 2 && (await q("select message from notifications where type = 'storage' and user_id = $1 and title = 'Storage Tool: new uploads' and message like 'Maria Cruz uploaded 2 files%'", [A])).length === 1
  && (await q("select count(*)::int n from notifications where type = 'storage' and user_id = $1 and title = 'Storage Tool: new uploads'", [A]))[0].n === 2);
check("the same upload is never announced twice; later files of the same visit are announced as the extra number", (await svc("select public.storage_tool_notify_uploads() n"))[0].n === 0 && await (async () => { await reg(s2, "more.pdf"); await q("update storage_tool_upload_sessions set last_upload_at = now() - interval '2 minutes' where id = $1", [s2]); await svc("select public.storage_tool_notify_uploads()"); return (await q("select 1 from notifications where type = 'storage' and message like 'Juan Dela Cruz uploaded 1 file %'"))[0] !== undefined; })());

console.log("\nActivity and safety");
const acts = new Set((await q("select distinct action from storage_tool_activity where owner_id = $1", [A])).map(r => r.action));
check("sharing, links and public uploads are all in the owner's activity log (a visitor is named 'Maria Cruz (via link)')", ["shared", "share_changed", "share_removed", "link_created", "link_changed", "link_paused", "link_resumed", "link_revoked"].every(a => acts.has(a)) && (await q("select 1 from storage_tool_activity where actor_label = 'Maria Cruz (via link)'")).length >= 2);
check("the SQL files can be run again in order (p1, p2, p3) and keep every share, link and file", await (async () => {
  try { const before = [(await q("select count(*)::int n from storage_tool_links"))[0].n, (await q("select count(*)::int n from storage_tool_files"))[0].n, (await q("select count(*)::int n from storage_tool_shares"))[0].n];
    for (const f of FILES) await db.exec(fs.readFileSync(f, "utf8"));
    return before.join() === [(await q("select count(*)::int n from storage_tool_links"))[0].n, (await q("select count(*)::int n from storage_tool_files"))[0].n, (await q("select count(*)::int n from storage_tool_shares"))[0].n].join(); }
  catch (e) { console.log("   ", e.message); return false; } })());
check("the helper functions cannot be called by signed-in people", await fails(A, "select public._storage_tool_level($1, null)", [A], /permission denied/) && await fails(A, "select public._storage_tool_can_edit($1, 'file', $2)", [A, fd.id], /permission denied/));

console.log(`\n${failed === 0 ? "ALL STORAGE TOOL PHASE 3 DATABASE CHECKS PASSED" : "SOME CHECKS FAILED"} — ${passed} passed, ${failed} failed`);
await db.close();
process.exit(failed === 0 ? 0 : 1);
