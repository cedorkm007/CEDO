// tests/bridging/db_tests.mjs — Bridging Phase 1 database: registration, consent, access rules, requests, undo (5 checks, short on purpose)
// Run:  node tests/bridging/db_tests.mjs        (throwaway in-memory database; nothing real is touched)
import { openBridgingDb, bridgingRegisterStandIn } from "../../scripts/bridgingdemo/db.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const db = await openBridgingDb({ install: false });
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const file = async f => { try { await db.exec(fs.readFileSync(f, "utf8")); return { ok: true }; } catch (e) { await db.exec("rollback").catch(() => {}); return { ok: false, msg: String(e.message) }; } };
async function as(role, uid, sql, p = []) {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return (await tx.query(sql, p)).rows;
  });
}
const attempt = async (...a) => { try { return { ok: true, rows: await as(...a) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
const consent = (extra = {}) => ({ agreed: true, version: 1, under18: false, guardianName: "", guardianAgreed: false, ...extra });
const call = await bridgingRegisterStandIn(db);
// the server function, as the website calls it
const register = async (username, details, password = "Practice#2026", ip = "10.0.0.1") => (await call({ username, password, details }, ip)).json;
const uidOf = async username => (await q("select id from auth.users where email = $1", [`${username}@bridging.cedo.local`]))[0]?.id;
const accounts = async () => (await q("select count(*)::int c from auth.users"))[0].c;
const me = async uid => (await as("authenticated", uid, "select bridging_me() r"))[0].r;

// 1. the file refuses the main database, installs twice
await db.exec("create table public.scholars (id int)");
const refused = await file("bridging_sql/bridging_phase1_setup.sql");
await db.exec("drop table public.scholars");
const run1 = await file("bridging_sql/bridging_phase1_setup.sql"), run2 = await file("bridging_sql/bridging_phase1_setup.sql");
const seed = await file("bridging_sql/bridging_phase1_test_schools.sql"), seed2 = await file("bridging_sql/bridging_phase1_test_schools.sql");
const options = (await as("anon", null, "select bridging_options() r"))[0].r;
const hs = options.schools.find(s => s.name === "TEST National High School"), college = options.schools.find(s => s.name === "TEST City College");
check("1 the setup file stops on the main CEDO database, installs (and re-installs) on a new one, and the sign-in screen gets schools, subjects and the notice",
  !refused.ok && /MAIN CEDO/.test(refused.msg) && run1.ok && run2.ok && seed.ok && seed2.ok && options.schools.length === 3 && options.subjects.length === 4 && options.notice.version === 1 && options.settings.under18Mode === "guardian",
  `${refused.msg} ${run1.msg ?? ""} ${run2.msg ?? ""} ${seed.msg ?? ""}`);

// 2. teacher: pending, invisible to students until approved
const teacherForm = { role: "teacher", lastName: "Reyes", firstName: "Ana", middleName: "N/A", schoolId: hs.id, levels: ["g7", "g8"], subjects: ["math"], employeeId: "E1", consent: consent() };
const noId = await register("test.teacher", { ...teacherForm, employeeId: "" });
const wrongLevel = await register("test.teacher", { ...teacherForm, levels: ["c1"] });
const short = await register("test.teacher", teacherForm, "Short#12");
const leftover = await accounts();
const t = await register("test.teacher", teacherForm);
const taken = await register("test.teacher", teacherForm);
const tid = await uidOf("test.teacher");
const teachers = async () => (await as("anon", null, "select bridging_teachers($1, 'g7') r", [hs.id]))[0].r;
const before = await teachers();
await file("bridging_sql/bridging_phase1_approve_test_teacher.sql");
const after = await teachers();
check("2 a teacher needs a 10-character password, an ID or work email and levels the school offers; a refused registration leaves no half-made account; the teacher starts pending and is offered to students only after approval",
  !noId.ok && !wrongLevel.ok && /at least 10/.test(short.error) && leftover === 0 && t.ok && taken.error === "That username is already taken." && before.length === 0 && after.length === 1 && after[0].name === "Reyes, Ana" && (await me(tid)).status === "active",
  `${noId.error} ${wrongLevel.error} ${short.error} ${leftover} ${t.error ?? ""} ${taken.error} ${JSON.stringify(after)}`);

// 3. student: consent rules, level fits the school, teacher link, duplicate warning
const studentForm = { role: "student", lastName: "Cruz", firstName: "Juan", middleName: "N/A", schoolId: hs.id, level: "g7", teacher: { id: tid }, consent: consent({ under18: true }) };
const noGuardian = await register("juan.cruz", studentForm);
const noAgree = await register("juan.cruz", { ...studentForm, consent: consent({ agreed: false }) });
const badLevel = await register("juan.cruz", { ...studentForm, level: "c1", consent: consent() });
const r1 = await register("juan.cruz", { ...studentForm, consent: consent({ under18: true, guardianName: "Pedro Cruz", guardianAgreed: true }) });
const count = await accounts();
const dup = await register("juan.cruz2", { ...studentForm, teacher: { name: "Mr. Santos" }, consent: consent() });
const dupLeft = (await accounts()) - count;
const dupOk = await register("juan.cruz2", { ...studentForm, teacher: { name: "Mr. Santos" }, consent: consent(), confirmDuplicate: true });
const other = await register("maria", { role: "student", lastName: "Lim", firstName: "Maria", middleName: "N/A", otherSchool: "Unlisted School", level: "als_jhs", teacher: null, consent: consent() });
const s1 = await uidOf("juan.cruz"), s2 = await uidOf("juan.cruz2"), s3 = await uidOf("maria");
const m1 = await me(s1), m2 = await me(s2), m3 = await me(s3);
const kept = await q("select under_18, guardian_name, notice_version from bridging_consents where user_id = $1", [s1]);
check("3 a student under 18 needs a guardian, must agree, and picks a level the school offers; consent is saved; a teacher with an account waits to confirm, one without needs nothing; the same name warns first; an unlisted school becomes a request",
  /guardian/.test(noGuardian.error) && !noAgree.ok && !badLevel.ok && r1.ok && m1.teacher.status === "pending"
  && kept[0].under_18 === true && kept[0].guardian_name === "Pedro Cruz" && dup.duplicate === true && dupLeft === 0 && dupOk.ok && m2.teacher.status === "no_account"
  && other.ok && m3.schoolListed === false && m3.openRequests.includes("school_not_listed"),
  `${noGuardian.error} ${badLevel.error} ${r1.error ?? ""} ${JSON.stringify(dup)} ${dupLeft} ${other.error ?? ""} ${JSON.stringify(m1.teacher)} ${JSON.stringify(m2.teacher)}`);

// 4. access rules and requests
const mine = await as("authenticated", s1, "select user_id from bridging_profiles");
const cannot = [
  await attempt("anon", null, "select * from bridging_profiles"),
  await attempt("authenticated", s1, "update bridging_profiles set status = 'active'"),
  await attempt("authenticated", s1, "insert into bridging_requests (user_id, kind) values ($1, 'delete_account')", [s1]),
  await attempt("authenticated", s1, "select * from bridging_settings"),
  await attempt("anon", null, "select bridging_me()"),
  await attempt("authenticated", s1, "select _bridging_set_teacher($1, null, null)", [s1]),
  await attempt("anon", null, "select bridging_register($1, '{}'::jsonb)", [s1]),
  await attempt("authenticated", s1, "select bridging_register($1, '{}'::jsonb)", [s1]),
];
// and too many registrations from one address are stopped
const limit = [];
for (let i = 0; i < 3; i++) limit.push((await as("service_role", null, "select bridging_rate_limit('test', '1.2.3.4', 2, 100) ok"))[0].ok);
await as("authenticated", s1, "select bridging_update_profile($1::jsonb)", [JSON.stringify({ lastName: "Cruz", firstName: "Juan", middleName: "Dy", level: "g8" })]);
await as("authenticated", s1, "select bridging_request('school_change', $1::jsonb)", [JSON.stringify({ schoolId: college.id })]);
await as("authenticated", s1, "select bridging_request('delete_account', '{}'::jsonb)");
await as("authenticated", s1, "select bridging_cancel_request('delete_account')");
await as("anon", null, "select bridging_forgot_password('JUAN.CRUZ')");
await as("anon", null, "select bridging_forgot_password('juan.cruz')");
await as("anon", null, "select bridging_forgot_password('nobody')");
const m4 = await me(s1);
const resets = await q("select count(*)::int c from bridging_requests where kind = 'password_reset'");
check("4 a student reads only their own row and cannot change tables, call helpers or call registration directly; repeated attempts from one address are stopped; name and level change at once, school change and deletion are requests; a forgotten password is noted once and says nothing about who exists",
  mine.length === 1 && mine[0].user_id === s1 && cannot.every(c => !c.ok) && limit.join() === "true,true,false" && m4.level === "g8" && m4.middleName === "Dy" && m4.schoolId === hs.id
  && m4.openRequests.sort().join() === "password_reset,school_change" && resets[0].c === 1, `${mine.length} ${cannot.map(c => c.ok).join()} ${JSON.stringify(m4.openRequests)} ${resets[0].c}`);

// 5. a new notice must be agreed again; undo removes everything
await db.exec("insert into bridging_notices (version, body_en, body_ceb) values (2, 'new', 'bag-o')");
const need = (await me(s2)).needsConsent;
const old = await attempt("authenticated", s2, "select bridging_accept_notice($1::jsonb)", [JSON.stringify(consent())]);
const ok2 = await attempt("authenticated", s2, "select bridging_accept_notice($1::jsonb)", [JSON.stringify(consent({ version: 2 }))]);
const done = (await me(s2)).needsConsent;
const undo = await file("bridging_sql/undo_bridging_phase1_setup.sql");
const gone = (await q("select to_regclass('public.bridging_profiles') is null a, to_regprocedure('public.bridging_register(jsonb)') is null b"))[0];
const redo = await file("bridging_sql/bridging_phase1_setup.sql");
check("5 a changed notice asks everyone to agree again; the undo file removes it all and the setup can be run again",
  need === true && !old.ok && ok2.ok && done === false && undo.ok && gone.a && gone.b && redo.ok, `${need} ${old.msg} ${ok2.msg ?? ""} ${undo.msg ?? ""} ${redo.msg ?? ""}`);

console.log(`${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
await db.close();
process.exit(failed ? 1 : 0);
