// tests/storage-tool/run_p2_db_tests.mjs — Storage Tool, Phase 2, against the real migration files in memory.
// Rename, move (no folder into itself, names never overwritten), search, details, Trash (a folder is one item; restore; delete forever; the automatic
// clean-up), the folder tree, and "can be run twice".   Run:  node tests/storage-tool/run_p2_db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };

const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const P1 = new URL("../../supabase_migration_storage_tool_p1.sql", import.meta.url), P2 = new URL("../../supabase_migration_storage_tool_p2.sql", import.meta.url);
await db.exec(fs.readFileSync(P1, "utf8"));
await db.exec(fs.readFileSync(P2, "utf8"));

const staffUid = name => seedId(`staff:${name}`);
const ITADMIN = staffUid("it.admin1"), A = staffUid("demo.storage"), B = staffUid("demo.storage2"), PLAIN = staffUid("demo.plain");
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
const fails = async (uid, sql, params, pattern, role) => { try { await rows(uid, sql, params, role); return false; } catch (e) { return pattern ? pattern.test(String(e.message)) : true; } };
const q = async (sql, params = []) => (await db.query(sql, params)).rows;

const folder = async (uid, parent, name) => (await one(uid, "select public.storage_tool_create_folder($1, $2) r", [parent, name])).r;
const putObject = (uid, id, size = 100, mime = "application/pdf") => rows(uid, "insert into storage.objects (bucket_id, name, owner, metadata) values ('storage-tool', $1, $2, $3::jsonb)", [`${uid}/${id}`, uid, JSON.stringify({ mimetype: mime, size })]);
const file = async (uid, folderId, name, size = 100, mime = "application/pdf") => { const id = uuid(); await putObject(uid, id, size, mime); return (await one(uid, "select public.storage_tool_register_file($1, $2, $3, $4) r", [id, folderId, name, mime])).r; };
const items = list => JSON.stringify(list.map(([kind, id]) => ({ kind, id })));
const names = async (uid, kind, parent) => (await rows(uid, kind === "folder" ? "select name from storage_tool_folders where deleted_at is null and parent_id is not distinct from $1 order by name" : "select name from storage_tool_files where deleted_at is null and folder_id is not distinct from $1 order by name", [parent])).map(r => r.name);

const blocked = /do not have access/;
console.log("\nAccess");
check("every new function refuses a staff member without the tag", await (async () => {
  const calls = ["select public.storage_tool_rename('file', $1, 'x')", "select public.storage_tool_move('[]'::jsonb, null)", "select public.storage_tool_trash('[]'::jsonb)", "select public.storage_tool_trash_list()", "select public.storage_tool_restore('[]'::jsonb)",
    "select public.storage_tool_forever_prepare('[]'::jsonb)", "select public.storage_tool_forever_finish('[]'::jsonb)", "select public.storage_tool_search('abc')", "select public.storage_tool_details('root', null)", "select public.storage_tool_folder_tree()", "select public.storage_tool_subtree($1)"];
  for (const c of calls) { const params = c.includes("$1") ? [uuid()] : []; if (!(await fails(PLAIN, c, params, blocked))) return false; }
  return true;
})());
check("the clean-up functions can be called only with the service role", await fails(A, "select public.storage_tool_purge_claim(10)", [], /permission denied/) && await fails(ITADMIN, "select public.storage_tool_purge_finish('{}'::uuid[])", [], /permission denied/)
  && await fails(null, "select public.storage_tool_purge_claim(10)", [], /permission denied/, "anon") && (await rows(null, "select public.storage_tool_purge_claim(10) c", [], "service_role")).length === 1);
check("the helpers cannot be called by signed-in people", await fails(A, "select public._storage_tool_descendants($1)", [uuid()], /permission denied/) && await fails(A, "select public._storage_tool_location(null)", [], /permission denied/) && await fails(A, "select * from public._storage_tool_items('[]'::jsonb)", [], /permission denied/));

console.log("\nRename");
const docs = await folder(A, null, "Docs"), arch = await folder(A, null, "Archive"), sub = await folder(A, docs.id, "Sub");
const f1 = await file(A, docs.id, "report.pdf"), f2 = await file(A, docs.id, "notes.txt"), f3 = await file(A, arch.id, "report.pdf");
check("a file can be renamed; the new name is cleaned", (await one(A, "select public.storage_tool_rename('file', $1, ' final/report.pdf ') r", [f1.id])).r.name === "final_report.pdf" && (await names(A, "file", docs.id)).includes("final_report.pdf"));
check("renaming to a name that is taken keeps both: notes (1).txt", (await one(A, "select public.storage_tool_rename('file', $1, 'final_report.pdf') r", [f2.id])).r.name === "final_report (1).pdf");
check("renaming only the letter case works and does not add a number", (await one(A, "select public.storage_tool_rename('file', $1, 'FINAL_REPORT.PDF') r", [f1.id])).r.name === "FINAL_REPORT.PDF");
check("renaming to the very same name keeps it", (await one(A, "select public.storage_tool_rename('file', $1, 'FINAL_REPORT.PDF') r", [f1.id])).r.name === "FINAL_REPORT.PDF");
check("a folder can be renamed; a taken name gets a number; an empty name is refused", (await one(A, "select public.storage_tool_rename('folder', $1, 'Docs') r", [sub.id])).r.name === "Docs" && (await one(A, "select public.storage_tool_rename('folder', $1, 'Archive') r", [docs.id])).r.name === "Archive (1)"
  && await fails(A, "select public.storage_tool_rename('folder', $1, '  ')", [docs.id], /type a name/));
await rows(A, "select public.storage_tool_rename('folder', $1, 'Docs')", [docs.id]);
await rows(A, "select public.storage_tool_rename('folder', $1, 'Sub')", [sub.id]);
check("somebody else's file or folder cannot be renamed, and a wrong kind is refused", await fails(B, "select public.storage_tool_rename('file', $1, 'x')", [f1.id], /not found/) && await fails(B, "select public.storage_tool_rename('folder', $1, 'x')", [docs.id], /not found/) && await fails(A, "select public.storage_tool_rename('shortcut', $1, 'x')", [docs.id], /file or a folder/));
check("the stored file never changes when a file is renamed (its path is its id)", (await q("select storage_path from storage_tool_files where id = $1", [f1.id]))[0].storage_path === `${A}/${f1.id}`);

console.log("\nMove");
const a1 = await folder(A, null, "Alpha"), a2 = await folder(A, a1.id, "Beta"), a3 = await folder(A, a2.id, "Gamma");
check("a folder cannot be moved into itself or into one of its own folders", await fails(A, "select public.storage_tool_move($1::jsonb, $2)", [items([["folder", a1.id]]), a1.id], /into itself/) && await fails(A, "select public.storage_tool_move($1::jsonb, $2)", [items([["folder", a1.id]]), a3.id], /into itself/));
check("moving a folder into another keeps what is inside", (await one(A, "select public.storage_tool_move($1::jsonb, $2) r", [items([["folder", a3.id]]), a1.id])).r.moved === 1 && (await q("select parent_id from storage_tool_folders where id = $1", [a3.id]))[0].parent_id === a1.id);
check("several files and a folder move at once; a taken name gets a number", await (async () => {
  const g1 = await file(A, null, "report.pdf"), g2 = await file(A, null, "x.txt");
  const r = (await one(A, "select public.storage_tool_move($1::jsonb, $2) r", [items([["file", g1.id], ["file", g2.id]]), arch.id])).r;
  return r.moved === 2 && (await names(A, "file", arch.id)).sort().join("|") === "report (1).pdf|report.pdf|x.txt";
})());
check("a name taken at the top of the storage also gets a number when something moves there", await (async () => {
  const t1 = await file(A, null, "top.txt"); const t2 = await file(A, arch.id, "top.txt");
  await rows(A, "select public.storage_tool_move($1::jsonb, null)", [items([["file", t2.id]])]);
  return (await names(A, "file", null)).sort().join("|").includes("top (1).txt") && t1.name === "top.txt";
})());
check("moving something where it already is changes nothing", (await one(A, "select public.storage_tool_move($1::jsonb, $2) r", [items([["folder", a2.id]]), a1.id])).r.moved === 0);
check("only my own folders are targets and only my own items move", await fails(B, "select public.storage_tool_move($1::jsonb, $2)", [items([["file", f1.id]]), null], /not found/) && await fails(B, "select public.storage_tool_move($1::jsonb, $2)", [items([["folder", (await folder(B, null, "Mine")).id]]), a1.id], /not found/));
check("a bad or empty list is refused", await fails(A, "select public.storage_tool_move('[]'::jsonb, null)", [], /Nothing was chosen/) && await fails(A, "select public.storage_tool_move('{}'::jsonb, null)", [], /Nothing was chosen/));
check("the stored file never moves (only the database row does)", (await q("select storage_path from storage_tool_files where id = $1", [f3.id]))[0].storage_path === `${A}/${f3.id}`);

console.log("\nTree, contents, details, search");
const tree = (await one(A, "select public.storage_tool_folder_tree() t")).t;
check("the folder tree lists my folders only", tree.length >= 6 && tree.every(x => x.id && "parent_id" in x && x.name) && (await one(B, "select public.storage_tool_folder_tree() t")).t.length === 1);
const subtree = (await one(A, "select public.storage_tool_subtree($1) s", [a1.id])).s;
check("the contents of a folder: itself, every folder inside and every file inside", subtree.folders.length === 3 && subtree.folders.some(f => f.id === a1.id) && subtree.folders.some(f => f.id === a3.id) && await fails(B, "select public.storage_tool_subtree($1)", [a1.id], /not found/));
const det = (await one(A, "select public.storage_tool_details('folder', $1) d", [a1.id])).d;
check("details of a folder: where it is, how many folders and files (all levels) and how big", det.folders === 2 && det.files === 0 && det.location === "My storage" && det.size_bytes === 0 && (await one(A, "select public.storage_tool_details('folder', $1) d", [docs.id])).d.files === 2);
const fd = (await one(A, "select public.storage_tool_details('file', $1) d", [f1.id])).d;
check("details of a file: name, type, size, who uploaded, when, and where it is", fd.name === "FINAL_REPORT.PDF" && fd.size_bytes === 100 && fd.mime_type === "application/pdf" && fd.location === "My storage / Docs" && fd.uploaded_by === "TEST Storage Staff" && fd.created_at && fd.modified_at);
check("details of the whole storage; somebody else's item is not found", (await one(A, "select public.storage_tool_details('root', null) d")).d.files >= 5 && await fails(B, "select public.storage_tool_details('file', $1)", [f1.id], /not found/));
const hit = async (uid, text) => (await one(uid, "select public.storage_tool_search($1) s", [text])).s;
check("search finds files and folders by part of the name, ignoring case, and says where they are", (await hit(A, "REPORT")).length >= 2 && (await hit(A, "alp")).some(x => x.kind === "folder" && x.name === "Alpha") && (await hit(A, "final")).find(x => x.kind === "file").location === "My storage / Docs");
check("search needs 2 letters, treats % and _ as plain letters, and never shows another person's items", (await hit(A, "r")).length === 0 && (await hit(A, "%%")).length === 0 && (await hit(A, "_e")).length === 0 && (await hit(B, "report")).length === 0 && (await hit(B, "Mine")).length === 1);

console.log("\nTrash");
const big = await folder(A, null, "Project"), big2 = await folder(A, big.id, "Plans"), bf1 = await file(A, big.id, "a.pdf", 1000), bf2 = await file(A, big2.id, "b.pdf", 2000);
const single = await file(A, big.id, "solo.pdf", 500);
await rows(A, "select public.storage_tool_trash($1::jsonb)", [items([["file", single.id]])]);
const tr = (await one(A, "select public.storage_tool_trash($1::jsonb) r", [items([["folder", big.id]]) ])).r;
check("deleting a folder moves it and everything inside it to Trash (nothing is removed from storage)", tr.trashed === 1 && tr.files === 2 && (await q("select count(*)::int n from storage_tool_files where deleted_at is not null and trashed_root_id = $1", [big.id]))[0].n === 2
  && (await q("select count(*)::int n from storage.objects where name in ($1, $2)", [`${A}/${bf1.id}`, `${A}/${bf2.id}`]))[0].n === 2);
check("trashed items disappear from the folder and from search", !(await names(A, "folder", null)).includes("Project") && (await hit(A, "a.pdf")).length === 0 && (await hit(A, "Plans")).length === 0);
const list = (await one(A, "select public.storage_tool_trash_list() l")).l;
check("Trash shows ONE line for the folder (with its size and item count) and one for the file deleted earlier, with the days left", list.items.length === 2 && list.trash_days === 30
  && list.items.find(i => i.id === big.id).size_bytes === 3000 && list.items.find(i => i.id === big.id).item_count === 3 && list.items.find(i => i.id === single.id).location === "My storage / Project" && list.items.every(i => i.days_left === 30));
check("somebody else's Trash is empty, and trashed items cannot be renamed, moved or deleted again", (await one(B, "select public.storage_tool_trash_list() l")).l.items.length === 0 && await fails(A, "select public.storage_tool_rename('file', $1, 'x')", [bf1.id], /not found/)
  && await fails(A, "select public.storage_tool_move($1::jsonb, null)", [items([["file", bf1.id]])], /not found/) && await fails(A, "select public.storage_tool_trash($1::jsonb)", [items([["folder", big.id]])], /not found/));
check("a deleted folder's name is free again", (await folder(A, null, "Project")).name === "Project");
const rs = (await one(A, "select public.storage_tool_restore($1::jsonb) r", [items([["folder", big.id]])])).r;
check("restoring a folder brings back everything inside it; the name is numbered because the name is taken now", rs.restored === 1 && (await names(A, "folder", null)).includes("Project (1)") && (await q("select count(*)::int n from storage_tool_files where deleted_at is null and folder_id in ($1, $2)", [big.id, big2.id]))[0].n === 2
  && (await q("select count(*)::int n from storage_tool_files where trashed_root_id = $1", [big.id]))[0].n === 0);
check("a file deleted on its own, whose folder was restored later, goes back into that folder", await (async () => { const r = (await one(A, "select public.storage_tool_restore($1::jsonb) r", [items([["file", single.id]])])).r; return r.restored === 1 && r.to_top === 0 && (await q("select folder_id from storage_tool_files where id = $1", [single.id]))[0].folder_id === big.id; })());
check("a file whose folder is itself in Trash goes to the top of the storage when restored alone", await (async () => {
  const pf = await folder(A, null, "Parent"), cf = await file(A, pf.id, "child.pdf");
  await rows(A, "select public.storage_tool_trash($1::jsonb)", [items([["file", cf.id]])]);
  await rows(A, "select public.storage_tool_trash($1::jsonb)", [items([["folder", pf.id]])]);
  const r = (await one(A, "select public.storage_tool_restore($1::jsonb) r", [items([["file", cf.id]])])).r;
  return r.to_top === 1 && (await q("select folder_id from storage_tool_files where id = $1", [cf.id]))[0].folder_id === null;
})());
check("only items in the Trash can be restored", await fails(A, "select public.storage_tool_restore($1::jsonb)", [items([["file", f1.id]])], /not in the Trash/) && await fails(A, "select public.storage_tool_restore($1::jsonb)", [items([["folder", docs.id]])], /not in the Trash/));

console.log("\nDelete forever");
const gone = await folder(A, null, "Gone"), gf = await file(A, gone.id, "x.pdf", 700), gf2 = await file(A, gone.id, "y.pdf", 300);
await rows(A, "select public.storage_tool_trash($1::jsonb)", [items([["folder", gone.id]])]);
const paths = (await one(A, "select public.storage_tool_forever_prepare($1::jsonb) p", [items([["folder", gone.id]])])).p;
check("step 1 lists the stored files behind the chosen Trash items; items not in Trash are refused", paths.length === 2 && paths.includes(`${A}/${gf.id}`) && await fails(A, "select public.storage_tool_forever_prepare($1::jsonb)", [items([["folder", docs.id]])], /not in the Trash/) && await fails(B, "select public.storage_tool_forever_prepare($1::jsonb)", [items([["folder", gone.id]])], /not in the Trash/));
check("a file that is NOT in Trash cannot be removed from storage, one that IS in the owner's Trash can; nobody else can remove it", (await rows(A, "delete from storage.objects where bucket_id = 'storage-tool' and name = $1 returning name", [`${A}/${f1.id}`])).length === 0
  && (await rows(B, "delete from storage.objects where bucket_id = 'storage-tool' and name = $1 returning name", [`${A}/${gf.id}`])).length === 0);
const stillThere = (await one(A, "select public.storage_tool_forever_finish($1::jsonb) r", [items([["folder", gone.id]])])).r;
check("step 2 keeps everything whose stored file is still there (nothing is lost by mistake)", stillThere.deleted_files === 0 && stillThere.left_in_trash === 2 && (await q("select count(*)::int n from storage_tool_files where trashed_root_id = $1", [gone.id]))[0].n === 2);
check("after the website removed the stored files, step 2 deletes the rows and the emptied folder", (await rows(A, "delete from storage.objects where bucket_id = 'storage-tool' and name = any($1) returning name", [paths])).length === 2 && await (async () => {
  const r = (await one(A, "select public.storage_tool_forever_finish($1::jsonb) r", [items([["folder", gone.id]])])).r;
  return r.deleted_files === 2 && r.left_in_trash === 0 && (await q("select count(*)::int n from storage_tool_folders where id = $1", [gone.id]))[0].n === 0;
})());
check("the usage numbers drop when files are gone for good", (await one(A, "select public.storage_tool_usage() u")).u.mine_bytes < 5000 + 100 * 12 + 4000);

console.log("\nAutomatic clean-up after the days in Trash");
const old = await folder(A, null, "Old"), of1 = await file(A, old.id, "o1.pdf", 111), of2 = await file(A, null, "o2.pdf", 222), fresh = await file(A, null, "fresh.pdf", 333);
await rows(A, "select public.storage_tool_trash($1::jsonb)", [items([["folder", old.id], ["file", of2.id], ["file", fresh.id]])]);
await rows(ITADMIN, "select public.storage_tool_settings_save(500, 7, 200)");
await q("update storage_tool_files set deleted_at = now() - interval '8 days' where trashed_root_id in ($1, $2)", [old.id, of2.id]);
await q("update storage_tool_folders set deleted_at = now() - interval '8 days' where trashed_root_id = $1", [old.id]);
const due = (await rows(null, "select public.storage_tool_purge_claim(100) c", [], "service_role"))[0].c;
check("the clean-up finds only what has been in Trash longer than the settings say (7 days here)", due.length === 2 && due.every(d => d.path.startsWith(`${A}/`)) && !due.some(d => d.id === fresh.id));
check("it deletes no row while the stored file still exists", (await rows(null, "select public.storage_tool_purge_finish($1::uuid[]) r", [due.map(d => d.id)], "service_role"))[0].r.deleted_files === 0);
await q("delete from storage.objects where name = any($1)", [due.map(d => d.path)]);
const fin = (await rows(null, "select public.storage_tool_purge_finish($1::uuid[]) r", [due.map(d => d.id)], "service_role"))[0].r;
check("once the stored files are gone it deletes the rows and the expired empty folder, and keeps the newer item", fin.deleted_files === 2 && fin.deleted_folders === 1 && (await q("select count(*)::int n from storage_tool_files where id = $1", [fresh.id]))[0].n === 1 && (await q("select count(*)::int n from storage_tool_folders where id = $1", [old.id]))[0].n === 0);
check("the clean-up is written to the activity log", (await q("select count(*)::int n from storage_tool_activity where action = 'purged' and actor_label = 'Automatic clean-up' and owner_id = $1", [A]))[0].n === 2);
await rows(ITADMIN, "select public.storage_tool_settings_save(500, 30, 200)");

console.log("\nActivity and safety");
const acts = new Set((await q("select distinct action from storage_tool_activity where owner_id = $1", [A])).map(r => r.action));
check("renaming, moving, trashing, restoring and deleting forever are all written to the activity log", ["renamed", "moved", "trashed", "restored", "deleted_forever", "purged"].every(a => acts.has(a)));
check("nobody sees another person's activity", (await rows(B, "select count(*)::int n from storage_tool_activity where owner_id = $1", [A]))[0].n === 0);
check("the SQL files can be run twice and keep every folder and file", await (async () => {
  try { const before = [(await q("select count(*)::int n from storage_tool_folders"))[0].n, (await q("select count(*)::int n from storage_tool_files"))[0].n];
    await db.exec(fs.readFileSync(P1, "utf8")); await db.exec(fs.readFileSync(P2, "utf8"));
    return before[0] === (await q("select count(*)::int n from storage_tool_folders"))[0].n && before[1] === (await q("select count(*)::int n from storage_tool_files"))[0].n; }
  catch (e) { console.log("   ", e.message); return false; } })());
check("the schedule helper explains itself when the timer extensions are off", /Switch on the pg_cron and pg_net/.test((await q("select public.storage_tool_purge_schedule('https://x.example/f', 's') r"))[0].r));

console.log(`\n${failed === 0 ? "ALL STORAGE TOOL PHASE 2 DATABASE CHECKS PASSED" : "SOME CHECKS FAILED"} — ${passed} passed, ${failed} failed`);
await db.close();
process.exit(failed === 0 ? 0 : 1);
