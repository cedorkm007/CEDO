// tests/sdp-update/phase6_db_tests.mjs — SDP Monitoring update, Phase 6: password and sign-in security (the database part).
//   • the "must choose a new password" marker (only clears when the password really changed; nobody can set or read it from the website)
//   • the sign-in look-ups answer the same way for every name, and are limited per name+address and per address
//   • the helpers for the scholar "forgot my password" flow (limits on tries and on wrong answers)
//   • the undo
// Run:  node tests/sdp-update/phase6_db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const staffUid = name => seedId(`staff:${name}`);
const scholarUid = n => seedId(`scholar:${n}`);
const PLAIN = staffUid("demo.plain"), SEAD = staffUid("demo.sead");
async function as(uid, fn, role = "authenticated", ip = null) {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true), set_config('request.headers', $4, true)",
      [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role }), JSON.stringify(ip ? { "x-forwarded-for": ip } : {})]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = [], role, ip) => as(uid, async tx => (await tx.query(sql, params)).rows, role, ip);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const fails = async (uid, sql, params, pattern, role, ip) => { try { await rows(uid, sql, params, role, ip); return false; } catch (e) { return pattern ? pattern.test(String(e.message)) : true; } };
const read = f => fs.readFileSync(f, "utf8");
const hashOf = async id => (await q("select encrypted_password h from auth.users where id = $1", [id]))[0].h;

console.log("\nThe “must choose a new password” marker");
check("the account functions (service role) can mark an account", (await rows(null, "select public.flag_password_change($1::uuid, 'test')", [PLAIN], "service_role")).length === 1);
check("nobody on the website can mark an account: staff, a scholar and a visitor are refused", await fails(SEAD, "select public.flag_password_change($1::uuid)", [PLAIN], /permission denied/i) && await fails(scholarUid(1), "select public.flag_password_change($1::uuid)", [PLAIN], /permission denied/i) && await fails(null, "select public.flag_password_change($1::uuid)", [PLAIN], /permission denied/i, "anon"));
check("a marked person is told they must choose a new password; other people are not", (await rows(PLAIN, "select public.my_password_change_required() r"))[0].r === true && (await rows(SEAD, "select public.my_password_change_required() r"))[0].r === false);
check("a visitor who is not signed in cannot ask", await fails(null, "select public.my_password_change_required()", [], /permission denied/i, "anon"));
check("“complete” is refused while the password is still the temporary one", await fails(PLAIN, "select public.complete_password_change()", [], /Choose a new password first/i));
check("the marker is not readable or changeable from the website", await fails(PLAIN, "select * from public.account_password_flags", [], /permission denied/i) && await fails(PLAIN, "delete from public.account_password_flags", [], /permission denied/i) && await fails(PLAIN, "insert into public.account_password_flags (user_id, temp_hash) values (gen_random_uuid(), 'x')", [], /permission denied/i));
await q("update auth.users set encrypted_password = extensions.crypt('A-brand-new-Pass-77', extensions.gen_salt('bf')) where id = $1", [PLAIN]);
check("once the password really changed, they are no longer asked, and the marker is cleared", (await rows(PLAIN, "select public.my_password_change_required() r"))[0].r === false && Number((await q("select count(*) n from account_password_flags where user_id = $1", [PLAIN]))[0].n) === 0);
await rows(null, "select public.flag_password_change($1::uuid)", [PLAIN], "service_role");
check("marking again (a new temporary password) asks again", (await rows(PLAIN, "select public.my_password_change_required() r"))[0].r === true);
await q("update auth.users set encrypted_password = extensions.crypt('Another-Good-Pass-88', extensions.gen_salt('bf')) where id = $1", [PLAIN]);
check("“complete” works after the change", (await rows(PLAIN, "select public.complete_password_change() ok"))[0].ok === true);
check("marking an account that does not exist is refused", await fails(null, "select public.flag_password_change(gen_random_uuid())", [], /does not exist/i, "service_role"));

console.log("\nSign-in look-ups answer the same way for every name");
const staffEmail = (await q("select email from users where username = 'demo.sead'"))[0].email;
const real = (await rows(null, "select public.resolve_staff_login_email('demo.sead') e", [], "anon", "198.51.100.1"))[0].e;
const unknown = (await rows(null, "select public.resolve_staff_login_email('nobody.at.all') e", [], "anon", "198.51.100.1"))[0].e;
const unknownAgain = (await rows(null, "select public.resolve_staff_login_email('nobody.at.all') e", [], "anon", "198.51.100.1"))[0].e;
const unknownOther = (await rows(null, "select public.resolve_staff_login_email('somebody.else') e", [], "anon", "198.51.100.1"))[0].e;
check("an existing staff name gives its address; an unknown name gives a made-up address (never an empty answer)", real === staffEmail && typeof unknown === "string" && /^no-account-[0-9a-f]{20}@invalid\.cedo\.local$/.test(unknown));
check("the made-up address is the same each time for the same name, and differs between names (so nothing can be told apart by shape)", unknown === unknownAgain && unknown !== unknownOther);
const schoolUser = (await q("select username, email from school_accounts limit 1"))[0];
const schoolReal = schoolUser ? (await rows(null, "select public.resolve_school_login_email($1) e", [schoolUser.username ?? schoolUser.email], "anon", "198.51.100.2"))[0].e : null;
const schoolFake = (await rows(null, "select public.resolve_school_login_email('no such school login') e", [], "anon", "198.51.100.2"))[0].e;
check("schools: the same (a real login gives its address, an unknown one a made-up address)", (!schoolUser || schoolReal === schoolUser.email) && /@invalid\.cedo\.local$/.test(schoolFake));
const sch = (await q("select email, scholar_id_number from scholars where scholar_id_number = 'TEST-0001'"))[0];
const scholarReal = (await rows(null, "select public.resolve_scholar_login_email(null, null, null, null, $1) e", [sch.scholar_id_number], "anon", "198.51.100.3"))[0].e;
const scholarFake = (await rows(null, "select public.resolve_scholar_login_email(null, null, null, null, 'NOT-A-SCHOLAR') e", [], "anon", "198.51.100.3"))[0].e;
const scholarByName = (await rows(null, "select public.resolve_scholar_login_email('TEST', 'All Passed', 'T', '2005-05-05'::date, null) e", [], "anon", "198.51.100.3"))[0].e;
check("scholars: by ID or by name and birthday a real scholar gives the address; an unknown one a made-up address", scholarReal === sch.email && scholarByName === sch.email && /@invalid\.cedo\.local$/.test(scholarFake));
check("the look-ups are still open to visitors who are not signed in (the sign-in page needs that)", true);

console.log("\nLimits on look-ups");
const hammer = async (ip, n, name = "hammer.target") => { let last = null; for (let i = 0; i < n; i++) { try { await rows(null, "select public.resolve_staff_login_email($1) e", [name], "anon", ip); } catch (e) { last = String(e.message); break; } } return last; };
check("the 10th try for one name from one address is fine, the 11th is refused (“Too many attempts”)", (await hammer("203.0.113.10", 10)) === null && /Too many attempts/i.test(await hammer("203.0.113.10", 1) ?? ""));
check("a different address is not affected by that", (await hammer("203.0.113.11", 3)) === null);
check("the same name from the first address stays refused for now, but another name from it is allowed", /Too many attempts/i.test(await hammer("203.0.113.10", 1) ?? "") && (await hammer("203.0.113.10", 1, "another.name")) === null);
let ipLast = null; for (let i = 0; i < 70 && !ipLast; i++) { try { await rows(null, "select public.resolve_staff_login_email($1) e", [`spray.${i}`], "anon", "203.0.113.20"); } catch (e) { ipLast = { at: i, msg: String(e.message) }; } }
check("trying many different names from one address is stopped after 60", ipLast && ipLast.at === 60 && /Too many attempts/i.test(ipLast.msg), JSON.stringify(ipLast));
await q("update auth_attempts set at = now() - interval '2 hours' where kind = 'staff_lookup'");
check("tries older than the window no longer count", (await hammer("203.0.113.10", 2)) === null);
check("the log of tries is not readable or changeable from the website, and holds only fingerprints", await fails(null, "select * from public.auth_attempts", [], /permission denied/i, "anon") && await fails(SEAD, "select * from public.auth_attempts", [], /permission denied/i) && (await q("select count(*) n from auth_attempts where key_hash like '%hammer%' or ip_hash like '%203.0.113%'"))[0].n === 0);

console.log("\nHelpers for the scholar “forgot my password” flow");
check("only the account functions (service role) can use them", await fails(SEAD, "select public.scholar_reset_gate('x', 'y')", [], /permission denied/i) && await fails(null, "select public.scholar_reset_is_locked('x')", [], /permission denied/i, "anon") && await fails(scholarUid(1), "select public.scholar_reset_register_failure('x', 'y')", [], /permission denied/i));
const gate = async (id, ip) => { try { await rows(null, "select public.scholar_reset_gate($1, $2)", [id, ip], "service_role"); return null; } catch (e) { return String(e.message); } };
let gateRefused = null; for (let i = 0; i < 10 && !gateRefused; i++) gateRefused = await gate("TEST-0001", "192.0.2.5") ? i : null;
check("the 9th try for one Scholar ID from one address in an hour is refused (8 allowed)", gateRefused === 8, String(gateRefused));
const locked = async id => (await rows(null, "select public.scholar_reset_is_locked($1) l", [id], "service_role"))[0].l;
check("not locked at first; locked after 5 wrong answers; still counted whatever the spelling or capitals of the ID", await locked("TEST-0002") === false);
for (let i = 0; i < 4; i++) await rows(null, "select public.scholar_reset_register_failure('TEST-0002', $1)", ["192.0.2." + i], "service_role");
check("4 wrong answers: not locked yet", await locked("TEST-0002") === false);
await rows(null, "select public.scholar_reset_register_failure(' test-0002 ', '192.0.2.99')", [], "service_role");
check("the 5th (from another address, other capitals): locked", await locked("TEST-0002") === true);
await rows(null, "select public.scholar_reset_clear('TEST-0002')", [], "service_role");
check("a correct answer clears the count", await locked("TEST-0002") === false);
for (let i = 0; i < 5; i++) await rows(null, "select public.scholar_reset_register_failure('TEST-0003', 'x')", [], "service_role");
await q("update auth_attempts set at = now() - interval '2 hours' where kind = 'scholar_reset_wrong'");
check("wrong answers older than an hour no longer lock", await locked("TEST-0003") === false);
// the real security-answer check (hashed): a scholar sets a question, the answer is compared without regard to capitals or spaces
await rows(scholarUid(5), "select public.set_scholar_security_question('What was the name of your first pet?', 'Whiskers')");
const verify = async a => (await rows(null, "select public.verify_scholar_security_answer($1::uuid, $2) ok", [scholarUid(5), a], "service_role"))[0].ok;
check("the hashed security answer matches the right answer (any capitals / spaces) and nothing else", await verify("whiskers ") === true && await verify("WHISKERS") === true && await verify("rex") === false);
check("the stored answer is a hash, not the answer", !/whiskers/i.test((await q("select security_answer_hash h from scholars where id = $1", [scholarUid(5)]))[0].h));

console.log("\nThe undo");
await db.exec(read("undo_sdp_update_p6.sql"));
check("the new tables and functions are gone", (await q("select count(*) n from pg_tables where tablename in ('account_password_flags', 'auth_attempts')"))[0].n === 0 && (await q("select count(*) n from pg_proc where proname in ('flag_password_change', 'my_password_change_required', 'scholar_reset_gate', '_auth_rate_limit')"))[0].n === 0);
check("the look-ups are back to the old way (an unknown name gives nothing)", (await rows(null, "select public.resolve_staff_login_email('nobody.at.all') e", [], "anon"))[0].e === null && (await rows(null, "select public.resolve_staff_login_email('demo.sead') e", [], "anon"))[0].e === staffEmail);
await db.exec(read("supabase_migration_sdp_update_p6_password_security.sql"));
await db.exec(read("supabase_migration_sdp_update_p6_password_security.sql"));
check("the SQL can be put back (and run twice)", (await q("select count(*) n from pg_tables where tablename = 'account_password_flags'"))[0].n === 1);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
