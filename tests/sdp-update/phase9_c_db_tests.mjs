// tests/sdp-update/phase9_c_db_tests.mjs — Phase 9 follow-up (C): staff with Forms Management can open the submission files they manage.
//   before: only Scholar Management staff read the stored files; after: Forms Management OR Scholar Management; nobody else; nobody gains write rights; undo restores.
// Run:  node tests/sdp-update/phase9_c_db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE = "supabase_migration_sdp_update_p9_c_submission_files_forms_management.sql", UNDO = "undo_sdp_update_p9_c.sql";
// The live project defines is_sead_staff() by the Scholar Management TAG; the project files hold an older flag version. Use the live one here.
await q(`create or replace function public.is_sead_staff() returns boolean language sql stable security definer as $fn$
  select exists (select 1 from public.staff_account_tags t where t.staff_id = auth.uid() and t.tag_key = 'scholar_management');
$fn$`);
const FORMS_ONLY = seedId("staff:demo.plain"), SEAD = seedId("staff:demo.sead"), NO_TOOL = seedId("staff:demo.storage"), SCHOLAR = seedId("scholar:5");
await q("insert into staff_account_tags (staff_id, tag_key) values ($1, 'forms_management')", [FORMS_ONLY]);
await q("insert into storage.buckets (id, name, public) values ('some-other-bucket', 'some-other-bucket', false) on conflict (id) do nothing");
await q("insert into storage.objects (bucket_id, name) values ('submission-uploads', 'activity-1/file-a.pdf'), ('some-other-bucket', 'x.pdf')").catch(async () => {
  await q("insert into storage.objects (id, bucket_id, name) values (gen_random_uuid(), 'submission-uploads', 'activity-1/file-a.pdf'), (gen_random_uuid(), 'some-other-bucket', 'x.pdf')");
});
async function as(uid, sql, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true)", [uid ?? "", role]);
    return (await tx.query(sql)).rows;
  });
}
const seen = async uid => (await as(uid, "select name from storage.objects where bucket_id = 'submission-uploads'")).length;
const policySql = async () => (await q("select qual from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'staff reads submission uploads'"))[0]?.qual ?? "";

await db.exec(read(UNDO));   // the state on the live project before this file
console.log("\nBefore (as on the live project)");
check("Scholar Management staff open the files", await seen(SEAD) === 1);
check("a staff member with ONLY Forms Management cannot (the reported problem)", await seen(FORMS_ONLY) === 0);

await db.exec(read(FILE));
console.log("\nAfter the file");
check("the Forms Management person can now open the files", await seen(FORMS_ONLY) === 1);
check("Scholar Management staff still can", await seen(SEAD) === 1);
check("staff with neither tool, a scholar and a visitor still cannot", await seen(NO_TOOL) === 0 && await seen(SCHOLAR) === 0 && await seen(null).catch(() => 0) === 0);
check("other buckets are not affected", (await as(FORMS_ONLY, "select name from storage.objects where bucket_id = 'some-other-bucket'")).length === 0);
check("only READING is widened: the Forms Management person still cannot upload, change or delete a file", await as(FORMS_ONLY, "insert into storage.objects (bucket_id, name) values ('submission-uploads', 'activity-1/hack.pdf') returning name").then(r => r.length === 0, () => true)
  && (await as(FORMS_ONLY, "delete from storage.objects where bucket_id = 'submission-uploads' returning name")).length === 0
  && Number((await q("select count(*) n from storage.objects where bucket_id = 'submission-uploads'"))[0].n) === 1);
await db.exec(read(FILE));
check("running the file twice leaves one rule with the same effect", Number((await q("select count(*) n from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'staff reads submission uploads'"))[0].n) === 1 && /forms_management/.test(await policySql()));
await db.exec(read(UNDO));
check("the undo puts the earlier rule back (the Forms Management person is shut out again)", await seen(FORMS_ONLY) === 0 && await seen(SEAD) === 1 && !/forms_management/.test(await policySql()));
await db.exec(read(FILE));
check("it can be put back after the undo", await seen(FORMS_ONLY) === 1);
check("each file sets a short wait limit and changes only this one rule", [FILE, UNDO].every(f => /set lock_timeout = '5s'/.test(read(f)) && (read(f).match(/create policy/g) || []).length === 1));
const list = await db.exec(read("sql_oneoff/p9_c_who_cannot_open_submission_files_readonly.sql"));
const rows = list[list.length - 1].rows;
check("the read-only list shows who has Forms Management but not Scholar Management, by sign-in name", rows.length >= 1 && rows.every(r => r.username && "has_forms_management" in r) && rows.every(r => r.has_scholar_management || /CANNOT/.test(r.submission_files)));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
