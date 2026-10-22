// tests/sdp-update/phase9_b_db_tests.mjs — SDP Monitoring update, Phase 9, file B: everyone still on the old default password (123456) must choose a new one.
//   staff and schools first; scholars only once the switch is turned on; nobody else; the marker clears only when the password really changed; undo restores Phase 6.
// Run:  node tests/sdp-update/phase9_b_db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE = "supabase_migration_sdp_update_p9_b_force_change_default_password.sql", UNDO = "undo_sdp_update_p9_b.sql";
const STAFF_A = seedId("staff:demo.plain"), STAFF_B = seedId("staff:demo.sead"), SCHOLAR_C = seedId("scholar:5"), SCHOLAR_D = seedId("scholar:6");
const SCHOOL_E = (await q("select id from school_accounts order by id limit 1"))[0].id;
const setPw = (id, pw) => q("update auth.users set encrypted_password = extensions.crypt($2, extensions.gen_salt('bf', 4)) where id = $1", [id, pw]);
async function as(uid, sql, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true)", [uid ?? "", role]);
    return (await tx.query(sql)).rows;
  });
}
const required = async uid => (await as(uid, "select public.my_password_change_required() r"))[0].r;
const flags = async () => (await q("select user_id, reason from account_password_flags where reason = 'default_password'")).map(r => r.user_id);

// Real accounts use bcrypt: three still on 123456 (a staff member, a scholar, the school), the rest on something else, one on a stored password that is not bcrypt at all.
await q("delete from account_password_flags");
for (const id of [STAFF_B, SCHOLAR_D]) await setPw(id, "Another-Good-Pass-91");
for (const id of [STAFF_A, SCHOLAR_C, SCHOOL_E]) await setPw(id, "123456");
await q("update auth.users set encrypted_password = 'not-a-bcrypt-hash' where id = $1", [seedId("staff:demo.admin")]);

console.log("\nStaff and schools first");
check("the switch starts with staff and schools ON and scholars OFF", JSON.stringify((await q("select staff_and_schools s, scholars c from p9_default_password_settings"))[0]) === JSON.stringify({ s: true, c: false }));
check("a staff member still on 123456 must choose a new password", await required(STAFF_A) === true);
check("the school account still on 123456 must too", await required(SCHOOL_E) === true);
check("a staff member on a real password is not asked", await required(STAFF_B) === false);
check("a stored password that is not a standard hash is skipped, not an error", await required(seedId("staff:demo.admin")) === false);
check("a scholar on 123456 is NOT asked yet (the scholars switch is off)", await required(SCHOLAR_C) === false);
check("a scholar on a real password is not asked", await required(SCHOLAR_D) === false);
check("the people found are marked, and only they", (await flags()).sort().join() === [STAFF_A, SCHOOL_E].sort().join());
check("a visitor not signed in is not asked, and cannot ask", (await as(null, "select public.my_password_change_required() r", "authenticated"))[0].r === false
  && await as(null, "select public.my_password_change_required() r", "anon").then(() => false, e => /permission denied/i.test(String(e.message))));

console.log("\nChoosing a new password");
check("“I have chosen” is refused while the password is still 123456", await as(STAFF_A, "select public.complete_password_change()").then(() => false, e => /Choose a new password first/i.test(String(e.message))));
await setPw(STAFF_A, "123456");   // a new scrambling of the SAME password is not a change
check("saving the same password again (a different scrambling) does not get them past it", await required(STAFF_A) === true);
await setPw(STAFF_A, "Their-Own-Strong-Pass-33");
check("once the password really changed they are no longer asked, and the marker is gone", await required(STAFF_A) === false && !(await flags()).includes(STAFF_A));
check("“I have chosen” now works", (await as(STAFF_A, "select public.complete_password_change() ok"))[0].ok === true);

console.log("\nTurning it on for scholars");
await db.exec(read("sql_oneoff/p9_b2_turn_on_for_scholars.sql"));
check("with the scholars switch on, a scholar still on 123456 must choose a new password", await required(SCHOLAR_C) === true);
check("a scholar on a real password is still not asked", await required(SCHOLAR_D) === false);
await db.exec(read("sql_oneoff/p9_b3_turn_off_for_scholars.sql"));
check("turning it off again removes the scholars' markers and stops asking", await required(SCHOLAR_C) === false && !(await flags()).includes(SCHOLAR_C));
check("staff and schools are not affected by turning the scholars' switch off", await required(SCHOOL_E) === true);

console.log("\nEarlier behaviour is kept");
await q("insert into account_password_flags (user_id, temp_hash, reason) select id, encrypted_password, 'temporary_password' from auth.users where id = $1", [SCHOLAR_D]);
check("an account given a temporary password is still asked (Phase 6), whatever the switch says", await required(SCHOLAR_D) === true);
await setPw(SCHOLAR_D, "Chosen-By-The-Scholar-55");
check("…and is released when its password really changed", await required(SCHOLAR_D) === false);

console.log("\nThe locked switch, running twice, and the undo");
check("the switch table cannot be read or changed from the website", await as(STAFF_B, "select * from public.p9_default_password_settings").then(() => false, e => /permission denied/i.test(String(e.message))));
await db.exec(read(FILE));
check("running the file again changes nothing (one switch row, the same setting)", Number((await q("select count(*) n from p9_default_password_settings"))[0].n) === 1 && (await q("select staff_and_schools s from p9_default_password_settings"))[0].s === true);
await db.exec(read(UNDO));
check("after the undo only the Phase 6 behaviour is left: nobody is asked just for using 123456, the added markers and the switch are gone", await required(SCHOOL_E) === false && (await flags()).length === 0 && (await q("select to_regclass('public.p9_default_password_settings') t"))[0].t === null);
await db.exec(read(FILE));
check("the file can be put back after an undo", await required(SCHOOL_E) === true);
check("every file sets a short wait limit", [FILE, UNDO, "sql_oneoff/p9_b2_turn_on_for_scholars.sql", "sql_oneoff/p9_b3_turn_off_for_scholars.sql"].every(f => /set lock_timeout = '5s'/.test(read(f))));
const listing = (await db.exec(read("sql_oneoff/p9_b0_list_staff_on_default_password_readonly.sql")));
check("the read-only list shows sign-in names and whether each is still on 123456, and nothing else", listing[listing.length - 1].rows.every(r => r.kind && r.sign_in_name && typeof r.still_on_123456 === "boolean") && listing[listing.length - 1].rows.some(r => r.still_on_123456));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
