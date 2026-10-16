// tests/storage-tool/run_p4_db_tests.mjs — Storage Tool, Phase 4, against the real migration files in memory.
// The activity screen, the IT admin's overview and settings, handing a person's files over, the push text, and a few end-to-end checks across all phases
// (an upload link that expires, the quota, the Trash timer).   Run:  node tests/storage-tool/run_p4_db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };

const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const FILES = ["p1", "p2", "p3", "p4"].map(n => new URL(`../../supabase_migration_storage_tool_${n}.sql`, import.meta.url));
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
const activity = async (uid, folderId = null, limit = 50, before = null) => (await one(uid, "select public.storage_tool_activity_list($1, $2, $3) r", [folderId, limit, before])).r;

console.log("\nThe activity screen");
const reports = await folder(A, null, "Reports"), y26 = await folder(A, reports.id, "2026"), other = await folder(A, null, "Other");
const f1 = await file(A, y26.id, "jan.pdf", 500), f2 = await file(A, other.id, "elsewhere.pdf", 700);
await rows(A, "select public.storage_tool_rename('file', $1, 'january.pdf')", [f1.id]);
await rows(A, "select public.storage_tool_share_set('folder', $1, $2, 'edit')", [reports.id, B]);
await rows(B, "select public.storage_tool_create_folder($1, 'Made by B')", [y26.id]);
await rows(A, "select public.storage_tool_trash($1::jsonb)", [items([["file", f2.id]])]);
const all = await activity(A);
check("the owner sees what happened in the storage, newest first, with who did it and where", all.items.length >= 8 && all.items[0].action === "trashed" && all.items.every((x, i, a) => i === 0 || a[i - 1].at >= x.at)
  && all.items.some(x => x.action === "file_uploaded" && x.name === "jan.pdf" && x.location === "My storage / Reports / 2026" && x.actor === "TEST Storage Staff"));
check("what an editor did is in the OWNER's list under the editor's name", all.items.some(x => x.action === "folder_created" && x.name === "Made by B" && x.actor === "TEST Storage Staff Two"));
check("sharing, renaming and deleting are all written", ["shared", "renamed", "trashed", "folder_created", "file_uploaded"].every(a => all.items.some(x => x.action === a)) && all.items.find(x => x.action === "shared").detail.permission === "edit");
const inReports = await activity(A, reports.id);
check("one folder: only what happened inside it (and to it), not the other folders", inReports.items.some(x => x.name === "jan.pdf") && inReports.items.some(x => x.name === "Made by B") && !inReports.items.some(x => x.name === "elsewhere.pdf" || x.name === "Other"));
check("it pages: 50 at a time by default, a smaller page says there is more, and 'before' continues where the page ended", await (async () => {
  const first = await activity(A, null, 3);
  const next = await activity(A, null, 3, first.items[2].at);
  return first.items.length === 3 && first.has_more === true && next.items.length >= 1 && next.items.every(x => x.at < first.items[2].at) && (await activity(A, null, 500)).has_more === false;
})());
check("nobody else sees the activity: the editor sees none of the owner's list, a person without the tool is refused, and the folder must be the person's own",
  (await activity(B)).items.every(x => x.name !== "jan.pdf") && await fails(C, "select public.storage_tool_activity_list(null, 5, null)", [], /do not have access/) && await fails(B, "select public.storage_tool_activity_list($1, 5, null)", [reports.id], /not found/));
check("the table itself cannot be written or read directly by the website", await fails(A, "insert into storage_tool_activity (owner_id, action, target_kind) values ($1, 'x', 'file')", [A]) && (await rows(B, "select id from storage_tool_activity where owner_id = $1", [A])).length === 0);

console.log("\nThe IT admin's overview and settings");
const ov = (await one(ITADMIN, "select public.storage_tool_admin_overview() o")).o;
const pa = ov.people.find(p => p.id === A);
check("the admin sees each person: files, folders, bytes, trash bytes, shares, links and who still has access", !!pa && pa.has_access === true && pa.files === 1 && pa.folders >= 3 && Number(pa.bytes) === 1200 && Number(pa.trash_bytes) === 700 && pa.shares === 1 && ov.settings.total_quota_gb === 200 && Number(ov.total_bytes) === 1200);
check("people without the tool and without files are not listed; it.admin1 always is", !ov.people.some(p => p.id === C) && ov.people.some(p => p.id === ITADMIN));
check("everybody else is refused", await fails(A, "select public.storage_tool_admin_overview()", [], /Only the IT admin/) && await fails(C, "select public.storage_tool_admin_overview()", [], /Only the IT admin/));
await rows(ITADMIN, "select public.storage_tool_settings_save(120, 14, 150)");
check("the admin saves the three limits (bad numbers are refused, other people cannot)", (await one(A, "select public.storage_tool_usage() u")).u.max_file_bytes === 120 * 1048576 && (await one(A, "select public.storage_tool_usage() u")).u.trash_days === 14
  && await fails(ITADMIN, "select public.storage_tool_settings_save(900, 14, 150)", [], /1 and 500/) && await fails(ITADMIN, "select public.storage_tool_settings_save(120, 0, 150)", [], /Days in Trash/) && await fails(A, "select public.storage_tool_settings_save(120, 14, 150)", [], /Only the IT admin/));
await rows(ITADMIN, "select public.storage_tool_settings_save(500, 30, 200)");

console.log("\nHanding a person's files over");
const link = (await one(A, "select public.storage_tool_link_create($1, $2::jsonb) l", [reports.id, JSON.stringify({ title: "Send reports" })])).l;
await rows(A, "select public.storage_tool_share_set('folder', $1, $2, 'view')", [other.id, ITADMIN]);
await rows(B, "select public.storage_tool_share_set('folder', $1, $2, 'view')", [(await folder(B, null, "B's folder")).id, A]);
await q("delete from staff_account_tags where staff_id = $1", [A]); await q("delete from notifications where user_id = $1", [A]);   // other tables that point at the person are cleared first, so only the Storage Tool is being tested here
check("while a person still owns files they cannot be deleted (the database refuses; the delete function explains it)", await (async () => { try { await q("delete from public.users where id = $1", [A]); return false; } catch (e) { return /storage_tool/i.test(String(e.message)); } })());
check("only the admin can hand over; the receiver must be able to use the tool; two different people; there must be something to hand over",
  await fails(A, "select public.storage_tool_admin_transfer($1, $2)", [A, B], /Only the IT admin/) && await fails(ITADMIN, "select public.storage_tool_admin_transfer($1, $2)", [A, C], /must be able to use/)
  && await fails(ITADMIN, "select public.storage_tool_admin_transfer($1, $1)", [A], /two different/) && await fails(ITADMIN, "select public.storage_tool_admin_transfer($1, $2)", [C, B], /nothing in the Storage Tool/));
const before = { folders: (await q("select count(*)::int n from storage_tool_folders where owner_id = $1", [A]))[0].n, files: (await q("select count(*)::int n from storage_tool_files where owner_id = $1", [A]))[0].n };
const bTop = (await browse(B, null)).folders.map(f => f.name);
const done = (await one(ITADMIN, "select public.storage_tool_admin_transfer($1, $2) r", [A, ITADMIN])).r;
check("everything moves to the receiver: folders and files (also the Trash), their shares and links; nothing is left with the old person", before.folders > 0 && before.files === 2 && done.files === 2 && done.folders === before.folders
  && (await q("select count(*)::int n from storage_tool_folders where owner_id = $1", [A]))[0].n === 0 && (await q("select count(*)::int n from storage_tool_files where owner_id = $1", [A]))[0].n === 0
  && (await q("select owner_id from storage_tool_links where id = $1", [link.id]))[0].owner_id === ITADMIN && done.links === 1);
check("the old top of their storage sits inside one new folder at the top of the receiver's storage; the Trash came along", await (async () => {
  const top = await browse(ITADMIN, null);
  const holder = top.folders.find(f => f.id === done.folder_id);
  const inside = await browse(ITADMIN, done.folder_id);
  const trash = (await one(ITADMIN, "select public.storage_tool_trash_list() l")).l.items;
  return !!holder && /^From TEST Storage Staff \(handed over \d{4}-\d{2}-\d{2}\)$/.test(holder.name) && ["Reports", "Other"].every(n => inside.folders.some(f => f.name === n)) && trash.some(i => i.name === "elsewhere.pdf");
})());
check("a share that pointed at the receiver is dropped (nobody shares with themselves); the shares the person gave to others now come from the receiver; what was shared WITH the old person ended", (await q("select count(*)::int n from storage_tool_shares where owner_id = $1 and shared_with = $1", [ITADMIN]))[0].n === 0
  && (await q("select count(*)::int n from storage_tool_shares where shared_with = $1", [A]))[0].n === 0 && (await q("select owner_id from storage_tool_shares where shared_with = $1 and permission = 'edit'", [B]))[0].owner_id === ITADMIN);
check("the person who was given a share still reaches it, now owned by the receiver; the stored files are still readable", (await browse(B, reports.id)).level === 3 && (await browse(B, reports.id)).owner_name.length > 0
  && (await rows(ITADMIN, "select name from storage.objects where bucket_id = 'storage-tool' and name = $1", [`${A}/${f1.id}`])).length === 1);
check("the receiver got a notice; the activity history came along and says what was handed over", (await q("select count(*)::int n from notifications where type = 'storage' and user_id = $1 and title like '%handed over%'", [ITADMIN]))[0].n === 1
  && (await activity(ITADMIN)).items.some(x => x.action === "handed_over" && x.detail.files === 2) && (await activity(ITADMIN)).items.some(x => x.name === "jan.pdf"));
check("now the old account can be deleted, and nothing of the Storage Tool is lost with it", await (async () => {
  await q("delete from public.users where id = $1", [A]);
  return (await q("select count(*)::int n from storage_tool_files where owner_id = $1", [ITADMIN]))[0].n === 2;
})());

console.log("\nPush text");
await q("insert into push_subscriptions (owner_kind, staff_id, endpoint, p256dh, auth) values ('staff', $1, 'https://push.example/dev1', 'k', 'a')", [B]);
await rows(ITADMIN, "select public.storage_tool_share_set('folder', $1, $2, 'view')", [(await browse(ITADMIN, null)).folders[0].id, B]);
const pushed = (await q("select title, body, url from push_outbox where staff_id = $1 order by created_at desc limit 1", [B]))[0];
check("a Storage Tool notice is pushed with a generic text (no names or file names on a lock screen) that opens the Storage Tool", !!pushed && pushed.title === "Storage Tool" && pushed.url === "/?page=storageTool" && !/Staff|share|folder/i.test(pushed.body));
await q("insert into notifications (id, type, user_id, user_name, title, message, \"timestamp\", read, reference_id) values (gen_random_uuid(), 'renewal', $1, '', 't', 'm', now(), false, 'x')", [B]);
check("renewal and other notices are pushed as before", (await q("select title, url from push_outbox where staff_id = $1 order by created_at desc limit 1", [B]))[0].title === "Scholar Renewal");

console.log("\nAcross the phases");
const dest = await folder(B, null, "Collect");
const exp = (await one(B, "select public.storage_tool_link_create($1, $2::jsonb) l", [dest.id, JSON.stringify({ title: "Short link", expires_at: new Date(Date.now() + 3600e3).toISOString() })])).l;
const info = async () => (await svc("select public.storage_tool_public_link_get($1) l", [exp.token]))[0].l;
check("an upload link works until its end date, then the page says it is no longer active (status 'expired' for the owner)", (await info()).status === "active" && await (async () => {
  await q("update storage_tool_links set expires_at = now() - interval '1 minute' where id = $1", [exp.id]);
  const gone = (await info()).status !== "active";
  const ownerView = (await one(B, "select public.storage_tool_links_list($1) l", [dest.id])).l[0].status;
  return gone && ownerView === "expired" && await fails(null, "select public.storage_tool_public_session_create($1, 'Late', '', '', 'h-late', 'ip')", [exp.id], /no longer active/, "service_role");
})());
check("the end date can be moved forward again and the link is open again", await (async () => {
  const again = (await one(B, "select public.storage_tool_link_update($1, $2::jsonb) l", [exp.id, JSON.stringify({ expires_at: new Date(Date.now() + 86400e3).toISOString() })])).l;
  return again.status === "active" && (await info()).status === "active";
})());
check("the Trash timer: an item older than the setting is removed by the automatic clean-up, a newer one is kept", await (async () => {
  const keep = await file(B, dest.id, "keep.pdf"), old = await file(B, dest.id, "old.pdf");
  await rows(B, "select public.storage_tool_trash($1::jsonb)", [items([["file", keep.id], ["file", old.id]])]);
  await q("update storage_tool_files set deleted_at = now() - interval '31 days' where id = $1", [old.id]);
  const claimed = (await svc("select public.storage_tool_purge_claim(50) c"))[0].c;
  const ids = claimed.map(c => c.id);
  await q("delete from storage.objects where bucket_id = 'storage-tool' and name = any($1)", [claimed.map(c => c.path)]);
  await svc("select public.storage_tool_purge_finish($1::uuid[])", [ids]);
  return ids.includes(old.id) && !ids.includes(keep.id) && (await q("select count(*)::int n from storage_tool_files where id = $1", [keep.id]))[0].n === 1 && (await q("select count(*)::int n from storage_tool_files where id = $1", [old.id]))[0].n === 0;
})());
check("the migration files can all be run again without harm (twice, in order)", await (async () => { for (const f of FILES) await db.exec(fs.readFileSync(f, "utf8")); return (await q("select count(*)::int n from storage_tool_links"))[0].n === 2; })());
check("the Phase 4 functions are not callable by visitors or by people without the tool", await fails(null, "select public.storage_tool_admin_overview()", [], /permission denied|Only the IT admin/, "anon") && await fails(null, "select public.storage_tool_activity_list(null, 5, null)", [], /permission denied/, "anon"));

console.log(`\n${failed ? "SOME CHECKS FAILED" : "ALL STORAGE TOOL PHASE 4 DATABASE CHECKS PASSED"} — ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
