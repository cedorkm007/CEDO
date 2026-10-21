// tests/sdp-update/phase7_db_tests.mjs — SDP Monitoring update, Phase 7: tightening the rules inside the staff area (the four hand-made tables that matter most).
//   A staff_account_tags: only the IT administrator changes who has which tool
//   B users: nobody can make themselves an administrator; only it.admin1 changes user name / division / adds / deletes
//   C sead_scholar_account_log and D division_change_log: can only grow
//   and every undo file puts the live rule ("staff full access") back, and every file can be run twice
// Run:  node tests/sdp-update/phase7_db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const staff = name => seedId(`staff:${name}`);
const PLAIN = staff("demo.plain"), SEAD = staff("demo.sead"), ADMIN = staff("demo.admin"), DIVADMIN = staff("demo.seadhead"), IT = staff("it.admin1");
const SCHOLAR = seedId("scholar:5");
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)",
      [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = [], role) => as(uid, async tx => (await tx.query(sql, params)).rows, role);
const refused = async (uid, sql, params, role) => { try { await rows(uid, sql, params, role); return false; } catch (e) { return /row-level security|permission denied/i.test(String(e.message)); } };
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const count = async sql => Number((await q(sql))[0].n);
const read = f => fs.readFileSync(f, "utf8");
const FILES = { a: "supabase_migration_sdp_update_p7_a_staff_tags.sql", b: "supabase_migration_sdp_update_p7_b_users.sql", c: "supabase_migration_sdp_update_p7_c_scholar_account_log.sql", d: "supabase_migration_sdp_update_p7_d_division_change_log.sql" };
const UNDO = { a: "undo_sdp_update_p7_a.sql", b: "undo_sdp_update_p7_b.sql", c: "undo_sdp_update_p7_c.sql", d: "undo_sdp_update_p7_d.sql" };

console.log("\nA. Who has which tool (staff_account_tags)");
const tagsTotal = await count("select count(*) n from staff_account_tags");
check("a staff member can still read the tags (their own and everybody's: the Staff Accounts page needs them)", (await rows(PLAIN, "select count(*) n from staff_account_tags"))[0].n == tagsTotal && tagsTotal > 0);
check("a staff member with no tools cannot give themselves a tool", await refused(PLAIN, "insert into staff_account_tags (staff_id, tag_key) values ($1, 'sdp_monitoring')", [PLAIN]));
check("nor can a staff member remove or change anybody's tag (nothing happens)", (await rows(SEAD, "delete from staff_account_tags where staff_id = $1 returning id", [PLAIN])).length === 0
  && (await rows(PLAIN, "update staff_account_tags set tag_key = 'x' returning id")).length === 0 && await count("select count(*) n from staff_account_tags") === tagsTotal);
check("even SEAD staff and the Super Admin cannot", await refused(SEAD, "insert into staff_account_tags (staff_id, tag_key) values ($1, 'storage_tool')", [SEAD]) && await refused(ADMIN, "insert into staff_account_tags (staff_id, tag_key) values ($1, 'storage_tool')", [PLAIN]));
const added = await rows(IT, "insert into staff_account_tags (staff_id, tag_key) values ($1, 'storage_tool') returning id", [PLAIN]);
check("the IT administrator can add a tag and remove it again", added.length === 1 && (await rows(IT, "delete from staff_account_tags where id = $1 returning id", [added[0].id])).length === 1);
check("a scholar and a visitor see no tags and cannot add any", (await rows(SCHOLAR, "select * from staff_account_tags").catch(() => [])).length === 0 && (await rows(null, "select * from staff_account_tags", [], "anon").catch(() => [])).length === 0
  && await refused(SCHOLAR, "insert into staff_account_tags (staff_id, tag_key) values ($1, 'sdp_monitoring')", [SCHOLAR]));
check("the server functions (service key) are not affected", (await rows(null, "insert into staff_account_tags (staff_id, tag_key) values ($1, 'storage_tool') returning id", [PLAIN], "service_role")).length === 1);
await q("delete from staff_account_tags where staff_id = $1 and tag_key = 'storage_tool'", [PLAIN]);

console.log("\nB. Staff accounts (users)");
const usersTotal = await count("select count(*) n from users");
check("every staff member can still read the staff list", (await rows(PLAIN, "select count(*) n from users"))[0].n == usersTotal);
check("a scholar and a visitor read nothing", (await rows(SCHOLAR, "select id from users").catch(() => [])).length === 0 && (await rows(null, "select id from users", [], "anon").catch(() => [])).length === 0);
const mine = await rows(PLAIN, "update users set first_name = 'Renamed', mobile_phone = '09170000000' where id = $1 returning first_name, mobile_phone", [PLAIN]);
check("a staff member can still edit their own profile details", mine[0]?.first_name === "Renamed" && mine[0]?.mobile_phone === "09170000000");
const tried = await rows(PLAIN, "update users set role = 'super_admin', is_admin = true, username = 'hacker', division = 'XX', is_sead_staff = true, nickname = 'Nick' where id = $1 returning role, is_admin, username, division, is_sead_staff, nickname", [PLAIN]);
check("a staff member who tries to make themselves an administrator (role, admin flag, user name, division, SEAD flag) keeps all of those unchanged; the harmless detail in the same save is kept", tried[0]?.role === "staff" && tried[0]?.is_admin === false && tried[0]?.username === "demo.plain" && tried[0]?.division !== "XX" && tried[0]?.is_sead_staff === false && tried[0]?.nickname === "Nick", JSON.stringify(tried));
check("a profile save that still holds an old role (as the website sends the whole record) still works and changes nothing it should not", (await rows(PLAIN, "update users set last_name = 'Plain Staff', role = 'staff', is_admin = false where id = $1 returning id", [PLAIN])).length === 1);
check("a staff member cannot change anybody else's record (nothing happens)", (await rows(PLAIN, "update users set first_name = 'X', role = 'super_admin' where id = $1 returning id", [SEAD])).length === 0 && (await q("select first_name, role from users where id = $1", [SEAD]))[0].role === "staff");
check("a division admin cannot promote themselves or others either", (await rows(DIVADMIN, "update users set role = 'super_admin' where id = $1 returning role", [DIVADMIN]))[0]?.role === "division_admin" && (await rows(DIVADMIN, "update users set role = 'super_admin' where id = $1 returning id", [PLAIN])).length === 0);
const promoted = await rows(ADMIN, "update users set role = 'division_admin', is_admin = true where id = $1 returning role, is_admin", [PLAIN]);
check("a Super Admin can promote or demote somebody (the Admin Management page)", promoted[0]?.role === "division_admin" && promoted[0]?.is_admin === true);
const demoted = await rows(ADMIN, "update users set role = 'staff', is_admin = false, username = 'taken.over', division = 'XX' where id = $1 returning role, is_admin, username, division", [PLAIN]);
check("…but a Super Admin cannot change somebody's user name or division", demoted[0]?.role === "staff" && demoted[0]?.username === "demo.plain" && demoted[0]?.division !== "XX");
const moved = await rows(IT, "update users set division = 'XX', username = 'demo.plain2' where id = $1 returning division, username", [PLAIN]);
check("the IT administrator can change a division and a user name (the Staff Accounts page)", moved[0]?.division === "XX" && moved[0]?.username === "demo.plain2");
await q("update users set division = (select division from users where id = $1), username = 'demo.plain' where id = $2", [SEAD, PLAIN]);
check("a staff member cannot add or delete staff rows", await refused(PLAIN, "insert into users (id, username, last_name, first_name, email, division, role) values (gen_random_uuid(), 'x.y', 'X', 'Y', 'x@y.z', 'SEAD', 'staff')")
  && (await rows(PLAIN, "delete from users where id = $1 returning id", [SEAD])).length === 0 && await count("select count(*) n from users") === usersTotal);
const newId = (await q("select gen_random_uuid() u"))[0].u;
await q("insert into auth.users (id, email) values ($1, 'p7.test@demo.local') on conflict do nothing", [newId]);
check("the IT administrator can add and delete a staff row", (await rows(IT, "insert into users (id, username, last_name, first_name, email, division, role) values ($1, 'p7.test', 'T', 'T', 'p7.test@demo.local', 'SEAD', 'staff') returning id", [newId])).length === 1
  && (await rows(IT, "delete from users where id = $1 returning id", [newId])).length === 1);
check("the server functions (service key) can still change a role", (await rows(null, "update users set role = 'division_admin' where id = $1 returning role", [PLAIN], "service_role"))[0]?.role === "division_admin");
await q("update users set role = 'staff', is_admin = false where id = $1", [PLAIN]);
check("the helper that says who is a Super Admin is not open to visitors", await refused(null, "select public._p7_is_super_admin()", [], "anon"));

console.log("\nC. Scholar account history (sead_scholar_account_log)");
const logTotal = await count("select count(*) n from sead_scholar_account_log");
await q("insert into sead_scholar_account_log (action, scholar_id_number, scholar_name, performed_by, performed_by_name, source, description) values ('added', 'TEST-0001', 'T T', $1, 'x', 'single', 'seed line')", [SEAD]);
check("staff can read the history", (await rows(PLAIN, "select count(*) n from sead_scholar_account_log"))[0].n == logTotal + 1);
check("staff can add a line with their own account as 'performed by'", (await rows(SEAD, "insert into sead_scholar_account_log (action, scholar_id_number, scholar_name, performed_by, performed_by_name, source, description) values ('updated', 'TEST-0001', 'T T', $1, 'x', 'single', 'my line') returning id", [SEAD])).length === 1);
check("…but not a line made to look as if somebody else did it", await refused(SEAD, "insert into sead_scholar_account_log (action, scholar_id_number, scholar_name, performed_by, performed_by_name, source, description) values ('updated', 'TEST-0001', 'T T', $1, 'x', 'single', 'forged')", [PLAIN]));
check("nobody can edit or delete a line through the website (nothing happens)", (await rows(SEAD, "update sead_scholar_account_log set description = 'edited' returning id")).length === 0 && (await rows(SEAD, "delete from sead_scholar_account_log returning id")).length === 0
  && (await rows(ADMIN, "delete from sead_scholar_account_log returning id")).length === 0 && await count("select count(*) n from sead_scholar_account_log") === logTotal + 2);
check("a scholar and a visitor can neither read nor add", (await rows(SCHOLAR, "select id from sead_scholar_account_log").catch(() => [])).length === 0 && await refused(SCHOLAR, "insert into sead_scholar_account_log (action, scholar_id_number, performed_by, source) values ('added', 'T', $1, 'single')", [SCHOLAR]));
check("the server functions (service key) can still add and change lines", (await rows(null, "update sead_scholar_account_log set description = 'by server' where description = 'my line' returning id", [], "service_role")).length === 1);

console.log("\nD. Division change history (division_change_log)");
const divTotal = await count("select count(*) n from division_change_log");
check("staff can read it", (await rows(PLAIN, "select count(*) n from division_change_log"))[0].n == divTotal);
check("the IT administrator can add a line with their own account as 'changed by'", (await rows(IT, "insert into division_change_log (staff_id, old_division, new_division, changed_by, changed_by_name) values ($1, 'A', 'B', $2, 'IT') returning id", [PLAIN, IT])).length === 1);
check("a line made to look as if somebody else changed it, or added by other staff, is refused", await refused(IT, "insert into division_change_log (staff_id, old_division, new_division, changed_by, changed_by_name) values ($1, 'A', 'B', $2, 'x')", [PLAIN, SEAD]) && await refused(PLAIN, "insert into division_change_log (staff_id, old_division, new_division, changed_by, changed_by_name) values ($1, 'A', 'B', $1, 'x')", [PLAIN]));
check("nobody can edit or delete a line through the website", (await rows(IT, "update division_change_log set new_division = 'Z' returning id")).length === 0 && (await rows(IT, "delete from division_change_log returning id")).length === 0 && await count("select count(*) n from division_change_log") === divTotal + 1);

console.log("\nThe undo files and running twice");
for (const k of ["a", "b", "c", "d"]) { await db.exec(read(UNDO[k])); }
check("after the undo files the live rule is back (any staff account can again change tags, roles and history)",
  (await rows(PLAIN, "insert into staff_account_tags (staff_id, tag_key) values ($1, 'storage_tool') returning id", [PLAIN])).length === 1
  && (await rows(PLAIN, "update users set role = 'super_admin' where id = $1 returning role", [SEAD]))[0]?.role === "super_admin"
  && (await rows(PLAIN, "delete from division_change_log returning id")).length > 0);
check("…and the new helper and guard are gone", await count("select count(*) n from pg_proc where proname in ('_p7_users_guard', '_p7_is_super_admin')") === 0 && await count("select count(*) n from pg_trigger where tgname = 'p7_users_guard'") === 0);
// restore what the check above scrambled, then re-apply twice
await q("update users set role = 'staff' where id = $1", [SEAD]);
await q("delete from staff_account_tags where staff_id = $1 and tag_key = 'storage_tool'", [PLAIN]);
for (const k of ["a", "b", "c", "d"]) { await db.exec(read(FILES[k])); await db.exec(read(FILES[k])); }
check("run twice, the files put the new rules back (and only once)", await count("select count(*) n from pg_policies where tablename = 'staff_account_tags'") === 2 && await count("select count(*) n from pg_policies where tablename = 'users'") === 4
  && await count("select count(*) n from pg_policies where tablename = 'sead_scholar_account_log'") === 2 && await count("select count(*) n from pg_policies where tablename = 'division_change_log'") === 2);
check("…and they refuse again", await refused(PLAIN, "insert into staff_account_tags (staff_id, tag_key) values ($1, 'sdp_monitoring')", [PLAIN]));
check("every file sets a short wait limit so it cannot hold up the live site", Object.values(FILES).concat(Object.values(UNDO)).every(f => /set lock_timeout = '5s'/.test(read(f))));
check("each file changes only its own table", Object.entries(FILES).every(([k, f]) => { const t = { a: "staff_account_tags", b: "users", c: "sead_scholar_account_log", d: "division_change_log" }[k]; return [...read(f).matchAll(/(?:alter table|\bon) public\.([a-z_]+)/g)].every(m => m[1] === t); }));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
