// tests/storage-tool/run_db_tests.mjs — Storage Tool, Phase 1, against the real migration file in memory.
// Who may use the tool, personal storage (nobody sees anybody else's), folders and names, registering an uploaded file (real size, limit, free space),
// the storage-folder rules, the settings, the activity log and "can be run twice".   Run:  node tests/storage-tool/run_db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };

const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
// The demo builder retries a few statements of older files at the very end; apply this file once more to get exactly the order of the real project.
const SQL_FILE = new URL("../../supabase_migration_storage_tool_p1.sql", import.meta.url);
await db.exec(fs.readFileSync(SQL_FILE, "utf8"));

const staffUid = name => seedId(`staff:${name}`);
const ITADMIN = staffUid("it.admin1"), A = staffUid("demo.storage"), B = staffUid("demo.storage2"), PLAIN = staffUid("demo.plain"), COUNSELOR = staffUid("demo.counselor");
const scholarUid = n => seedId(`scholar:${n}`);

async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify({ sub: uid, role })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const one = async (uid, sql, params = []) => (await rows(uid, sql, params))[0];
const fails = async (uid, sql, params, pattern) => { try { await rows(uid, sql, params); return false; } catch (e) { return pattern ? pattern.test(String(e.message)) : true; } };
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const uuid = () => randomUUID();

const mkFolder = async (uid, parent, name) => (await one(uid, "select public.storage_tool_create_folder($1, $2) r", [parent, name])).r;
const putObject = (uid, owner, id, size = 100, mime = "application/pdf") => rows(uid, "insert into storage.objects (bucket_id, name, owner, metadata) values ('storage-tool', $1, $2, $3::jsonb)", [`${owner}/${id}`, uid, JSON.stringify({ mimetype: mime, size })]);
const register = async (uid, id, folder, name, mime = "application/pdf") => (await one(uid, "select public.storage_tool_register_file($1, $2, $3, $4) r", [id, folder, name, mime])).r;

console.log("\nWho may use the tool");
const can = async uid => (await one(uid, "select public.can_use_storage_tool() c")).c;
check("the IT admin and a staff member with the tag may; staff without the tag, other tool holders and scholars may not", await can(ITADMIN) === true && await can(A) === true && await can(PLAIN) === false && await can(COUNSELOR) === false && await can(scholarUid(1)) === false);
check("somebody not signed in is refused by the function too", await (async () => { try { const r = await as(null, async tx => (await tx.query("select public.can_use_storage_tool() c")).rows[0].c, "anon"); return r === false; } catch (e) { return /permission denied/.test(String(e.message)); } })());
const blocked = /do not have access/;
check("every function refuses a staff member without the tag", await fails(PLAIN, "select public.storage_tool_usage()", [], blocked) && await fails(PLAIN, "select public.storage_tool_create_folder(null, 'x')", [], blocked)
  && await fails(PLAIN, "select public.storage_tool_register_file($1, null, 'x', null)", [uuid()], blocked) && await fails(PLAIN, "select public.storage_tool_path($1)", [uuid()], blocked)
  && await fails(scholarUid(1), "select public.storage_tool_usage()", [], blocked));
check("the tables show nothing to a staff member without the tag, even by asking directly", (await rows(PLAIN, "select count(*)::int n from storage_tool_folders"))[0].n === 0 && (await rows(PLAIN, "select count(*)::int n from storage_tool_files"))[0].n === 0 && (await rows(PLAIN, "select count(*)::int n from storage_tool_settings"))[0].n === 0);

console.log("\nPersonal storage: nobody sees anybody else's");
const fa = await mkFolder(A, null, "Reports");
const fa2 = await mkFolder(A, fa.id, "2026");
const fb = await mkFolder(B, null, "Reports");
check("each person can make folders, also inside folders, and a different person may use the same names", fa.name === "Reports" && fa2.name === "2026" && fb.name === "Reports" && fa.id !== fb.id);
check("each person sees only their own folders (the IT admin does not see anybody's either)", (await rows(A, "select id from storage_tool_folders")).length === 2 && (await rows(B, "select id from storage_tool_folders")).length === 1 && (await rows(ITADMIN, "select id from storage_tool_folders")).length === 0);
check("a folder of somebody else cannot be used as a parent, or looked up", await fails(B, "select public.storage_tool_create_folder($1, 'Spy')", [fa.id], /not found/) && await fails(B, "select public.storage_tool_path($1)", [fa.id], /not found/));
check("the path of a folder is the list of its parents, outermost first (and empty at the top)", JSON.stringify((await one(A, "select public.storage_tool_path($1) p", [fa2.id])).p.map(x => x.name)) === JSON.stringify(["Reports", "2026"]) && (await one(A, "select public.storage_tool_path(null) p")).p.length === 0);
check("nothing can be written to the tables directly (only through the functions)", await fails(A, "insert into storage_tool_folders (owner_id, name) values ($1, 'Direct')", [A], /row-level/i) && await fails(A, "update storage_tool_folders set name = 'Hacked' where id = $1", [fa.id]) === false
  && (await q("select name from storage_tool_folders where id = $1", [fa.id]))[0].name === "Reports" && await fails(A, "delete from storage_tool_files", [], /row-level|permission/i) === false);

console.log("\nNames");
check("the same name in the same folder gets a number: New folder, New folder (1), (2) ...", await (async () => { const n1 = await mkFolder(A, null, "New folder"), n2 = await mkFolder(A, null, "New folder"), n3 = await mkFolder(A, null, "new folder"); return n1.name === "New folder" && n2.name === "New folder (1)" && n3.name === "new folder (2)"; })());
check("slashes, control characters, spaces and trailing dots are cleaned; an empty or dot name is refused", (await mkFolder(A, null, "  a/b\\c\u0007 d..  ")).name === "a_b_c d"
  && await fails(A, "select public.storage_tool_create_folder(null, '   ')", [], /type a name/) && await fails(A, "select public.storage_tool_create_folder(null, '..')", [], /type a name/) && await fails(A, "select public.storage_tool_create_folder(null, null)", [], /type a name/));
check("a very long name is cut to 255 letters", (await mkFolder(A, null, "x".repeat(400))).name.length === 255);
check("the database itself refuses two active folders with the same name in one place", await (async () => { try { await q("insert into storage_tool_folders (owner_id, parent_id, name) values ($1, null, 'Reports')", [A]); return false; } catch (e) { return /unique|duplicate/i.test(String(e.message)); } })());

console.log("\nUploading: a file goes to storage, then is registered");
const myId = uuid();
check("a person can send a file only into their own part of the storage folder", await putObject(A, A, myId).then(() => true, () => false)
  && await fails(A, "insert into storage.objects (bucket_id, name, owner, metadata) values ('storage-tool', $1, $2, '{}'::jsonb)", [`${B}/${uuid()}`, A], /row-level/i)
  && await fails(PLAIN, "insert into storage.objects (bucket_id, name, owner, metadata) values ('storage-tool', $1, $2, '{}'::jsonb)", [`${PLAIN}/${uuid()}`, PLAIN], /row-level/i)
  && await fails(scholarUid(1), "insert into storage.objects (bucket_id, name, owner, metadata) values ('storage-tool', $1, $2, '{}'::jsonb)", [`${scholarUid(1)}/${uuid()}`, scholarUid(1)], /row-level/i));
const r1 = await register(A, myId, fa.id, "report.pdf");
check("registering takes the REAL size from storage and keeps the name", r1.name === "report.pdf" && r1.size === 100);
check("registering the same file twice is harmless", (await register(A, myId, fa.id, "report.pdf")).id === myId && (await q("select count(*)::int n from storage_tool_files where id = $1", [myId]))[0].n === 1);
const id2 = uuid(), id3 = uuid(), id4 = uuid();
for (const id of [id2, id3, id4]) await putObject(A, A, id);
check("a second file with the same name keeps both: report (1).pdf, report (2).pdf; the extension stays at the end", (await register(A, id2, fa.id, "report.pdf")).name === "report (1).pdf" && (await register(A, id3, fa.id, "Report.PDF")).name === "Report (2).PDF");
check("a name without an extension and a name that starts with a dot are numbered too", await (async () => { const a = uuid(), b = uuid(); await putObject(A, A, a); await putObject(A, A, b); const x = await register(A, a, null, "notes"); const y = await register(A, b, null, "notes"); const c = uuid(), d = uuid(); await putObject(A, A, c); await putObject(A, A, d); const z = await register(A, c, null, ".env"); const w = await register(A, d, null, ".env"); return x.name === "notes" && y.name === "notes (1)" && z.name === ".env" && w.name === ".env (1)"; })());
check("the same name in a DIFFERENT folder is fine", await (async () => { const id = uuid(); await putObject(A, A, id); return (await register(A, id, fa2.id, "report.pdf")).name === "report.pdf"; })());
check("a file that never reached storage cannot be registered", await fails(A, "select public.storage_tool_register_file($1, null, 'ghost.pdf', null)", [uuid()], /did not arrive/));
check("a file cannot be registered into somebody else's folder", await (async () => { const id = uuid(); await putObject(B, B, id); return fails(B, "select public.storage_tool_register_file($1, $2, 'x.pdf', null)", [id, fa.id], /folder was not found/); })());
check("another person cannot take over a file id that is already registered", await fails(B, "select public.storage_tool_register_file($1, null, 'steal.pdf', null)", [myId], /not found/));
check("a person sees only their own files", (await rows(A, "select count(*)::int n from storage_tool_files"))[0].n >= 6 && (await rows(B, "select count(*)::int n from storage_tool_files"))[0].n === 0);

console.log("\nSize limit and free space");
await rows(ITADMIN, "select public.storage_tool_settings_save(1, 30, 200)");
const big = uuid();
await putObject(A, A, big, 2 * 1048576);
check("a file bigger than the setting is refused at registration", await fails(A, "select public.storage_tool_register_file($1, null, 'big.bin', null)", [big], /larger than the allowed 1 MB/));
check("such an unregistered file can be removed again by its owner (a failed upload cleans up)", (await rows(A, "delete from storage.objects where bucket_id = 'storage-tool' and name = $1 returning name", [`${A}/${big}`])).length === 1);
check("a REGISTERED file cannot be removed from storage directly (only Trash, Phase 2)", (await rows(A, "delete from storage.objects where bucket_id = 'storage-tool' and name = $1 returning name", [`${A}/${myId}`])).length === 0 && (await q("select count(*)::int n from storage.objects where name = $1", [`${A}/${myId}`]))[0].n === 1);
check("nobody can remove another person's stored file", (await rows(B, "delete from storage.objects where bucket_id = 'storage-tool' and name = $1 returning name", [`${A}/${id4}`])).length === 0);
await rows(ITADMIN, "select public.storage_tool_settings_save(500, 30, 200)");
await q("insert into storage_tool_files (id, owner_id, folder_id, name, size_bytes, storage_path) values ($1, $2, null, 'fill.bin', 214748364800, $3)", [uuid(), B, `${B}/fill`]);
const late = uuid();
await putObject(A, A, late, 100);
check("when the whole storage is full a new file is refused", await fails(A, "select public.storage_tool_register_file($1, null, 'late.bin', null)", [late], /storage is full/));
await q("delete from storage_tool_files where name = 'fill.bin'");
check("and accepted again when there is room", (await register(A, late, null, "late.bin")).name === "late.bin");

console.log("\nNumbers and settings");
const usage = (await one(A, "select public.storage_tool_usage() u")).u;
check("usage tells what I use, what everybody uses, the whole storage and the biggest file", usage.mine_bytes > 0 && usage.total_bytes >= usage.mine_bytes && usage.quota_bytes === 200 * 1073741824 && usage.max_file_bytes === 500 * 1048576 && usage.trash_days === 30);
check("only the IT admin can change the settings, and only within sensible limits", await fails(A, "select public.storage_tool_settings_save(100, 30, 200)", [], /Only the IT admin/) && await fails(ITADMIN, "select public.storage_tool_settings_save(0, 30, 200)", [], /between 1 and 500/)
  && await fails(ITADMIN, "select public.storage_tool_settings_save(900, 30, 200)", [], /between 1 and 500/) && await fails(ITADMIN, "select public.storage_tool_settings_save(100, 0, 200)", [], /Days in Trash/) && await fails(ITADMIN, "select public.storage_tool_settings_save(100, 30, 0)", [], /at least 1 GB/));
check("settings cannot be written directly", await fails(A, "update storage_tool_settings set max_file_mb = 5000", [], /row-level|permission/i) === false && (await q("select max_file_mb from storage_tool_settings"))[0].max_file_mb === 500);

console.log("\nActivity and the storage folder");
const act = await q("select action, target_kind, target_name from storage_tool_activity where owner_id = $1 order by at", [A]);
check("every folder and upload is written to the activity log with who did it", act.filter(a => a.action === "folder_created").length >= 4 && act.filter(a => a.action === "file_uploaded").length >= 6 && (await q("select count(*)::int n from storage_tool_activity where actor_label = 'TEST Storage Staff'"))[0].n > 0);
check("a person reads only their own activity", (await rows(B, "select count(*)::int n from storage_tool_activity where owner_id = $1", [A]))[0].n === 0 && (await rows(A, "select count(*)::int n from storage_tool_activity"))[0].n === act.length);
check("the storage folder is private and has the 500 MB limit", (await q("select public, file_size_limit from storage.buckets where id = 'storage-tool'"))[0].public === false && Number((await q("select file_size_limit from storage.buckets where id = 'storage-tool'"))[0].file_size_limit) === 524288000);
check("a person reads only their own part of the storage folder", (await rows(A, "select count(*)::int n from storage.objects where bucket_id = 'storage-tool'"))[0].n >= 6 && (await rows(B, "select count(*)::int n from storage.objects where bucket_id = 'storage-tool' and name like $1", [`${A}/%`]))[0].n === 0 && (await rows(PLAIN, "select count(*)::int n from storage.objects where bucket_id = 'storage-tool'"))[0].n === 0);
check("the internal helpers cannot be called by signed-in people", await fails(A, "select public._storage_tool_clean_name('x')", [], /permission denied/) && await fails(A, "select public._storage_tool_free_name($1, null, 'x', 'file')", [A], /permission denied/) && await fails(A, "select public._storage_tool_log($1, 'x', 'file', null, 'x', null)", [A], /permission denied/));

console.log("\nSafety");
check("the migration can be run twice and keeps every folder, file and setting", await (async () => {
  try { const before = [(await q("select count(*)::int n from storage_tool_folders"))[0].n, (await q("select count(*)::int n from storage_tool_files"))[0].n];
    await db.exec(fs.readFileSync(SQL_FILE, "utf8"));
    return before[0] === (await q("select count(*)::int n from storage_tool_folders"))[0].n && before[1] === (await q("select count(*)::int n from storage_tool_files"))[0].n && (await q("select count(*)::int n from storage_tool_settings"))[0].n === 1; }
  catch (e) { console.log("   ", e.message); return false; } })());

console.log(`\n${failed === 0 ? "ALL STORAGE TOOL PHASE 1 DATABASE CHECKS PASSED" : "SOME CHECKS FAILED"} — ${passed} passed, ${failed} failed`);
await db.close();
process.exit(failed === 0 ? 0 : 1);
