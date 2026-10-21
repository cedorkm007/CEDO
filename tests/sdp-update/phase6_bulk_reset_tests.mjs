// tests/sdp-update/phase6_bulk_reset_tests.mjs — SDP Monitoring update, Phase 6: the one-time "never signed in" reset (sql_oneoff/p6_step2 and p6_step3).
// Run:  node tests/sdp-update/phase6_bulk_reset_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const COUNT = read("sql_oneoff/p6_step2_COUNT_never_signed_in_readonly.sql");
const RESET = read("sql_oneoff/p6_step3_RESET_never_signed_in_run_until_empty.sql");
// Run a file the way the SQL editor does: all the statements together, the answer being the last one's rows.
async function run(sql) {
  const results = await db.exec(sql);
  return results[results.length - 1]?.rows ?? [];
}

// A known starting point: nobody has signed in; one scholar, one staff and one school have; one scholar is switched off; one already has a temporary password.
await q("update auth.users set last_sign_in_at = null");
const staffIds = (await q("select id from users where lower(username) <> 'it.admin1' order by username")).map(r => r.id);
const scholars = await q("select id, scholar_id_number from scholars order by scholar_id_number");
const signedInScholar = scholars[0].id, bannedScholar = scholars[1].id, alreadyFlagged = scholars[2].id;
await q("update auth.users set last_sign_in_at = now() where id = any($1::uuid[])", [[signedInScholar, staffIds[0]]]);
await q("update auth.users set banned_until = now() + interval '100 years' where id = $1", [bannedScholar]);
await q("update scholars set status = 'Removed' where id = $1", [scholars[3].id]);
await q("insert into account_password_flags (user_id, temp_hash, reason) values ($1, 'x', 'test')", [alreadyFlagged]);
const itAdmin = (await q("select id from users where lower(username) = 'it.admin1'"))[0].id;

console.log("\nThe count (read-only)");
const before = await q("select count(*) n, max(updated_at) m from auth.users");
const counts = Object.fromEntries((await run(COUNT)).map(r => [r.kind, r]));
check("it lists Staff, School and Scholar", ["Staff", "School", "Scholar"].every(k => counts[k]));
const expectScholars = Number((await q(`select count(*) n from scholars s join auth.users au on au.id = s.id where au.last_sign_in_at is null and (au.banned_until is null or au.banned_until < now())
  and s.status is distinct from 'Removed' and not exists (select 1 from account_password_flags f where f.user_id = s.id)`))[0].n);
check("scholars that will be reset = never signed in, not switched off, not Removed, not already given a temporary password", Number(counts.Scholar.will_get_a_new_temporary_password) === expectScholars && expectScholars > 0, JSON.stringify(counts.Scholar));
check("accounts that have signed in are reported separately", Number(counts.Scholar.have_signed_in) === 1 && Number(counts.Staff.have_signed_in) === 1);
const after = await q("select count(*) n, max(updated_at) m from auth.users");
check("the count changes nothing", before[0].n === after[0].n && String(before[0].m) === String(after[0].m));

console.log("\nThe reset");
const hashesBefore = Object.fromEntries((await q("select id, encrypted_password h from auth.users")).map(r => [r.id, r.h]));
const list = await run(RESET);
const total = Number(Object.values(counts).reduce((s, c) => s + Number(c.will_get_a_new_temporary_password), 0));
check("the list has one row for every counted account (all fit in one round here)", list.length === total && total > 0, `${list.length} vs ${total}`);
check("each row has kind, login, name and a temporary password", list.every(r => r.kind && r.login && r.name && /^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/.test(r.temporary_password)));
check("every password has capitals, small letters and digits, and no look-alike characters", list.every(r => /[A-Z]/.test(r.temporary_password) && /[a-z]/.test(r.temporary_password) && /\d/.test(r.temporary_password) && !/[0OIl1]/.test(r.temporary_password)));
check("every password is different", new Set(list.map(r => r.temporary_password)).size === list.length);
const ok = await q("select count(*) n from auth.users au where au.encrypted_password = extensions.crypt($1, au.encrypted_password) and au.id = $2", [list.find(r => r.kind === "Scholar").temporary_password, (await q("select id from scholars where scholar_id_number = $1", [list.find(r => r.kind === "Scholar").login]))[0].id]);
check("the new password really is what the account now checks against", Number(ok[0].n) === 1);
const ids = new Set(list.map(r => r.login));
check("an account that already signed in is untouched", (await q("select encrypted_password h from auth.users where id = $1", [signedInScholar]))[0].h === hashesBefore[signedInScholar] && (await q("select encrypted_password h from auth.users where id = $1", [staffIds[0]]))[0].h === hashesBefore[staffIds[0]]);
const untouched = await q("select id, encrypted_password h from auth.users where id = any($1::uuid[])", [[bannedScholar, scholars[3].id, alreadyFlagged, itAdmin]]);
check("a switched-off account, a Removed scholar, the one already given a temporary password and it.admin1 are untouched", untouched.length === 4 && untouched.every(r => r.h === hashesBefore[r.id]));
check("none of those appear in the list", !list.some(r => [scholars[1].scholar_id_number, scholars[2].scholar_id_number, scholars[3].scholar_id_number, "it.admin1"].includes(r.login)));
const flagged = Number((await q("select count(*) n from account_password_flags where reason = 'first_sign_in_reset'"))[0].n);
check("every reset account is marked \"must choose a new password\"", flagged === list.length);
const aSchoolar = list.find(r => r.kind === "Scholar");
const uid = (await q("select id from scholars where scholar_id_number = $1", [aSchoolar.login]))[0].id;
const needs = await db.transaction(async tx => {
  await tx.exec("set local role authenticated");
  await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true)", [uid]);
  return (await tx.query("select public.my_password_change_required() r")).rows[0].r;
});
check("a reset person is made to choose a new password when they sign in", needs === true);

console.log("\nRunning it again");
check("a second run finds nothing left to do", (await run(RESET)).length === 0);
check("the count now says none are waiting", (await run(COUNT)).every(r => Number(r.will_get_a_new_temporary_password) === 0));

console.log("\nRe-issuing when the list from step 3 was lost");
const REISSUE = read("sql_oneoff/p6_step3b_REISSUE_lost_list_run_until_empty.sql"), SHOW = read("sql_oneoff/p6_step3c_SHOW_held_list_readonly.sql"), DROP = read("sql_oneoff/p6_step3d_DELETE_held_list.sql");
const firstList = list.filter(r => r.kind === "Scholar");
const hashOfScholar = async id => (await q("select au.encrypted_password h from auth.users au join scholars s on s.id = au.id where s.scholar_id_number = $1", [id]))[0].h;
const matches = async (id, pw) => Number((await q("select count(*) n from auth.users au join scholars s on s.id = au.id where s.scholar_id_number = $1 and au.encrypted_password = extensions.crypt($2, au.encrypted_password)", [id, pw]))[0].n) === 1;
// one of the reset scholars signs in meanwhile: they must be skipped
const signedInLater = firstList[0].login;
await q("update auth.users set last_sign_in_at = now() where id = (select id from scholars where scholar_id_number = $1)", [signedInLater]);
const hashBeforeSkip = await hashOfScholar(signedInLater);
const re = await run(REISSUE);
check("it re-issues exactly the scholars step 3 reset that have still never signed in", re.length === firstList.length - 1 && !re.some(r => r.login === signedInLater), re.length + " vs " + (firstList.length - 1));
check("each gets a NEW password in the same readable shape", re.every(r => /^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/.test(r.temporary_password)) && re.every(r => !firstList.some(o => o.login === r.login && o.temporary_password === r.temporary_password)));
const sample = re[0];
check("the new password is the one the account now checks against, and the old one is gone", await matches(sample.login, sample.temporary_password) && !(await matches(sample.login, firstList.find(o => o.login === sample.login).temporary_password)));
check("the person is still made to choose a new password", Number((await q("select count(*) n from account_password_flags f join scholars s on s.id = f.user_id where s.scholar_id_number = any($1::text[]) and f.reason = 'first_sign_in_reissue' and f.temp_hash = (select encrypted_password from auth.users where id = f.user_id)", [re.map(r => r.login)]))[0].n) === re.length);
check("someone who signed in meanwhile is untouched", (await hashOfScholar(signedInLater)) === hashBeforeSkip);
const shown = await run(SHOW);
check("the same list is held, so it can be shown again", shown.length === re.length && shown.every(r => re.some(x => x.login === r.login && x.temporary_password === r.temporary_password)));
check("running it again finds nothing left", (await run(REISSUE)).length === 0);
check("nobody on the website can read the held list", await db.transaction(async tx => { await tx.exec("set local role authenticated"); try { await tx.query("select * from public.p6_held_temporary_passwords"); return false; } catch (e) { return /permission denied/i.test(String(e.message)); } }));
await db.exec(DROP);
check("deleting the held list leaves no password stored", Number((await q("select count(*) n from pg_tables where tablename = 'p6_held_temporary_passwords'"))[0].n) === 0);

console.log("\nIn rounds (more accounts than one round holds)");
await db.exec("delete from account_password_flags where reason = 'first_sign_in_reset'");
await q("update auth.users set last_sign_in_at = null where id = any($1::uuid[])", [scholars.map(s => s.id)]);
const small = RESET.replace("limit 800", "limit 5");
const r1 = await run(small), r2 = await run(small);
check("a round of 5 gives 5 accounts, the next round gives different ones, and nobody appears twice", r1.length === 5 && r2.length > 0 && !r2.some(r => r1.some(x => x.login === r.login && x.kind === r.kind)));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
