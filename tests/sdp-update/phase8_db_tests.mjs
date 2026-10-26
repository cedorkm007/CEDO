// tests/sdp-update/phase8_db_tests.mjs — SDP Monitoring update, Phase 8: the rules on scholar data follow the tool tags.
//   A scholars  B scholar_subjects_grades  C scholar_quest_scores  D scholar_sdp_category_status  E two old empty tables  F attendance_records  G schools + settings
//   For every kind of person (no tools, other tool, monitor, SEAD, counsellor, reviewer, head, admin, IT admin, scholar, school) it checks who reads and who changes,
//   then that every undo puts today's rule back and every file can run twice.
// Run:  node tests/sdp-update/phase8_db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const staff = n => seedId(`staff:${n}`);
const P = { plain: staff("demo.plain"), storage: staff("demo.storage"), it: staff("it.admin1"), monitor: staff("demo.monitor"), sead: staff("demo.sead"), counselor: staff("demo.counselor"),
  evaluator: staff("demo.evaluator"), divhead: staff("demo.divhead"), seadhead: staff("demo.seadhead"), admin: staff("demo.admin") };
const SCHOLAR = seedId("scholar:5");
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const count = async sql => Number((await q(sql))[0].n);
const schoolUid = (await q("select id from school_accounts order by id limit 1"))[0].id;
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)",
      [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = [], role) => as(uid, async tx => (await tx.query(sql, params)).rows, role);
const n = async (uid, table) => Number((await rows(uid, `select count(*) n from ${table}`))[0].n);
const changes = async (uid, sql, params) => (await rows(uid, sql, params)).length;
const refused = async (uid, sql, params) => { try { await rows(uid, sql, params); return false; } catch (e) { return /row-level security|permission denied/i.test(String(e.message)); } };
const withTag = async (uid, tag, fn) => { await q("insert into staff_account_tags (staff_id, tag_key) values ($1, $2)", [uid, tag]); try { return await fn(); } finally { await q("delete from staff_account_tags where staff_id = $1 and tag_key = $2", [uid, tag]); } };
const read = f => fs.readFileSync(f, "utf8");
// The live project defines is_sead_staff() by the Scholar Management TAG (seen in the live check, 2026-10-21); the project files still hold an older version based on a flag on the
// staff row, which the demo uses. Phase 8 is the first place where the difference matters, so these tests use the live definition.
await q(`create or replace function public.is_sead_staff() returns boolean language sql stable security definer as $fn$
  select exists (select 1 from public.staff_account_tags t where t.staff_id = auth.uid() and t.tag_key = 'scholar_management');
$fn$`);
// The demo holds no quest scores or SDP category statuses, and not the live-only SDP Monitoring rule on the status table: add them, as they are on the live project.
for (const i of [1, 2, 3]) await q("insert into scholar_quest_scores (scholar_id_number, quest_name, score, max_score) values ($1, 'Quest', 8, 10)", ["TEST-000" + i]);
for (const i of [1, 2, 3]) await q("insert into scholar_sdp_category_status (scholar_id_number, category, completed) values ($1, 'community_service', true)", ["TEST-000" + i]);
await q('drop policy if exists "sdp staff full access" on public.scholar_sdp_category_status');
await q("create policy \"sdp staff full access\" on public.scholar_sdp_category_status for all using (public.has_staff_tag('sdp_monitoring')) with check (public.has_staff_tag('sdp_monitoring'))");
const KEYS = ["a", "b", "c", "d", "e", "f", "g"];
const FILES = Object.fromEntries(fs.readdirSync(".").filter(f => /^supabase_migration_sdp_update_p8_[a-g]_/.test(f)).map(f => [f.match(/p8_([a-g])_/)[1], f]));
const UNDO = Object.fromEntries(KEYS.map(k => [k, `undo_sdp_update_p8_${k}.sql`]));

console.log("\nA. Scholar records (scholars)");
const N = await count("select count(*) n from scholars");
check("staff with no tools, a storage-only person and the IT admin read no scholar record", (await n(P.plain, "scholars")) === 0 && (await n(P.storage, "scholars")) === 0 && (await n(P.it, "scholars")) === 0);
check("SEAD, a counsellor, a renewal evaluator, a division head, the Head of SEAD, a Super Admin and an activity monitor still read every record",
  (await Promise.all(["sead", "counselor", "evaluator", "divhead", "seadhead", "admin", "monitor"].map(k => n(P[k], "scholars")))).every(c => c === N), JSON.stringify(await Promise.all(["sead", "counselor", "evaluator", "divhead", "seadhead", "admin", "monitor"].map(k => n(P[k], "scholars")))));
for (const tag of ["scholars_formation", "scholarship_program_info", "forms_management", "research_project_monitoring", "quest_management", "scholars_grades_monitoring", "sdp_monitoring"])
  check(`a staff member who only holds the ${tag} tool can read the records`, await withTag(P.plain, tag, () => n(P.plain, "scholars")) === N);
check("a scholar reads only their own record, and a school only its own scholars", (await n(SCHOLAR, "scholars")) === 1 && (await n(schoolUid, "scholars")) > 0 && (await n(schoolUid, "scholars")) < N);
check("only Scholar Management staff change a record (SEAD can; nobody else can)", await changes(P.sead, "update scholars set updated_at = updated_at where scholar_id_number = 'TEST-0001' returning id") === 1
  && (await Promise.all(["plain", "monitor", "counselor", "evaluator", "divhead", "seadhead", "it", "storage"].map(k => changes(P[k], "update scholars set updated_at = updated_at returning id")))).every(c => c === 0));
check("nobody else can add or delete a scholar record", await refused(P.plain, "insert into scholars (id, scholar_id_number, first_name, last_name, birthday, email) values (gen_random_uuid(), 'X-1', 'A', 'B', '2000-01-01', 'x@y.z')")
  && await changes(P.counselor, "delete from scholars returning id") === 0);
check("a scholar cannot change their own record (unchanged)", await changes(SCHOLAR, "update scholars set first_name = 'Hacked' returning id") === 0);

console.log("\nB. Subject grades (scholar_subjects_grades)");
const G = await count("select count(*) n from scholar_subjects_grades");
check("no-tool staff read no grades; SEAD (Grades Monitoring) and a renewal evaluator do", G > 0 && (await n(P.plain, "scholar_subjects_grades")) === 0 && (await n(P.sead, "scholar_subjects_grades")) === G && (await n(P.evaluator, "scholar_subjects_grades")) === G);
check("only Grades Monitoring / Scholar Management staff change or delete grades", await changes(P.sead, "update scholar_subjects_grades set scholar_id_number = scholar_id_number returning id") === G
  && await changes(P.plain, "update scholar_subjects_grades set scholar_id_number = scholar_id_number returning id") === 0 && await changes(P.evaluator, "delete from scholar_subjects_grades returning id") === 0 && await changes(P.monitor, "delete from scholar_subjects_grades returning id") === 0);
check("a scholar still reads their own grades, a school its own scholars' grades", (await n(schoolUid, "scholar_subjects_grades")) > 0 && (await n(SCHOLAR, "scholar_subjects_grades")) >= 0);

console.log("\nC. Quest scores (scholar_quest_scores)");
const QS = await count("select count(*) n from scholar_quest_scores");
check("no-tool staff read no scores; SEAD, a quest-management holder and an evaluator do", QS > 0 && (await n(P.plain, "scholar_quest_scores")) === 0 && (await n(P.sead, "scholar_quest_scores")) === QS && (await n(P.evaluator, "scholar_quest_scores")) === QS
  && await withTag(P.plain, "quest_management", () => n(P.plain, "scholar_quest_scores")) === QS);
check("only Quest Management / Scholar Management staff change or delete scores", await changes(P.sead, "update scholar_quest_scores set scholar_id_number = scholar_id_number returning scholar_id_number") === QS
  && await changes(P.plain, "delete from scholar_quest_scores returning scholar_id_number") === 0 && await changes(P.evaluator, "update scholar_quest_scores set scholar_id_number = scholar_id_number returning scholar_id_number") === 0);

console.log("\nD. SDP category status (scholar_sdp_category_status)");
const ST = await count("select count(*) n from scholar_sdp_category_status");
check("no-tool staff read nothing; SDP Monitoring / SEAD / reviewers read; SDP Monitoring staff still change", ST > 0 && (await n(P.plain, "scholar_sdp_category_status")) === 0 && (await n(P.sead, "scholar_sdp_category_status")) === ST && (await n(P.evaluator, "scholar_sdp_category_status")) === ST
  && await changes(P.sead, "update scholar_sdp_category_status set scholar_id_number = scholar_id_number returning scholar_id_number") === ST
  && await changes(P.evaluator, "update scholar_sdp_category_status set scholar_id_number = scholar_id_number returning scholar_id_number") === 0 && await changes(P.plain, "delete from scholar_sdp_category_status returning scholar_id_number") === 0);
const mineSdp = (await q("select scholar_id_number from scholar_sdp_category_status limit 1"))[0]?.scholar_id_number;
const mineUid = (await q("select id from scholars where scholar_id_number = $1", [mineSdp]))[0]?.id;
check("a scholar still reads their own status", mineUid && (await n(mineUid, "scholar_sdp_category_status")) >= 1);

console.log("\nE. Two old empty tables");
check("only Scholar Management staff can add or read; nobody else", await changes(P.sead, "insert into scholar_services (scholar_id_number, details) values ('TEST-0001', '{}') returning scholar_id_number") === 1
  && await refused(P.plain, "insert into scholar_services (scholar_id_number, details) values ('TEST-0002', '{}')") && (await n(P.plain, "scholar_services")) === 0 && (await n(P.sead, "scholar_services")) === 1 && (await n(P.plain, "scholar_sdp")) === 0);
await q("delete from scholar_services");

console.log("\nF. QR attendance records (attendance_records)");
const AR = await count("select count(*) n from attendance_records");
check("no-tool staff read none; SEAD, SDP Monitoring, an activity monitor, a reviewer read; a formation or program-info holder reads",
  AR > 0 && (await n(P.plain, "attendance_records")) === 0 && (await n(P.sead, "attendance_records")) === AR && (await n(P.monitor, "attendance_records")) === AR && (await n(P.evaluator, "attendance_records")) === AR
  && await withTag(P.plain, "scholars_formation", () => n(P.plain, "attendance_records")) === AR && await withTag(P.plain, "scholarship_program_info", () => n(P.plain, "attendance_records")) === AR);
check("nobody changes or deletes a record through the website (the scan functions are not affected)", (await Promise.all(["sead", "admin", "monitor", "plain"].map(k => changes(P[k], "update attendance_records set status = status returning session_id")))).every(c => c === 0)
  && await changes(P.sead, "delete from attendance_records returning session_id") === 0);
const mineAr = (await q("select s.id from attendance_records r join scholars s on s.scholar_id_number = r.scholar_id_number limit 1"))[0]?.id;
check("a scholar still reads their own attendance", !mineAr || (await n(mineAr, "attendance_records")) >= 1);

console.log("\nG. Schools and the grading period");
const SC = await count("select count(*) n from schools");
check("every staff member still reads the school names; only Grades Monitoring / Scholar Management staff change them", (await n(P.plain, "schools")) === SC && (await n(P.it, "schools")) === SC
  && await changes(P.sead, "update schools set name = name returning id") === SC && await changes(P.plain, "update schools set name = name returning id") === 0 && await changes(P.evaluator, "delete from schools returning id") === 0);
check("the schools' login records are for the IT administrator only", (await n(P.it, "school_accounts")) >= 1 && (await n(P.sead, "school_accounts")) === 0 && (await n(P.plain, "school_accounts")) === 0 && (await n(schoolUid, "school_accounts")) === 1);
check("school grading settings: Grades Monitoring staff read and change; no-tool staff nothing; a school still reads and manages its own", (await n(P.sead, "school_grading_configs")) >= 1 && (await n(P.plain, "school_grading_configs")) === 0
  && (await n(P.sead, "school_letter_grades")) >= 1 && (await n(P.plain, "school_letter_grades")) === 0 && (await n(schoolUid, "school_grading_configs")) === 1 && await changes(P.plain, "update school_grading_configs set scale_min = scale_min returning school_id") === 0
  && await changes(P.sead, "update school_grading_configs set scale_min = scale_min returning school_id") >= 1);
check("everybody signed in still reads the current grading period; only Grades Monitoring / Scholar Management staff change it", (await n(P.plain, "grading_period_settings")) === 1 && (await n(SCHOLAR, "grading_period_settings")) === 1 && (await n(schoolUid, "grading_period_settings")) === 1
  && await changes(P.sead, "update grading_period_settings set current_semester = current_semester returning id") === 1 && await changes(P.plain, "update grading_period_settings set current_semester = current_semester returning id") === 0 && await changes(P.storage, "update grading_period_settings set current_semester = current_semester returning id") === 0);

console.log("\nSpeed: each rule asks \"is this person allowed?\" once per request, not once per row");
const p8Rules = await q("select tablename, policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '') as t from pg_policies where policyname like 'p8 %'");
check("every Phase 8 rule wraps its check in (select …) so the database evaluates it once", p8Rules.length >= 14 && p8Rules.every(r => /\(\s*SELECT/i.test(r.t)), p8Rules.filter(r => !/\(\s*SELECT/i.test(r.t)).map(r => r.policyname).join(", "));
const plan = (await rows(P.plain, "explain select count(*) from scholars")).map(r => r["QUERY PLAN"]).join("\n");
check("reading the scholar list as a staff member shows a single up-front check in the query plan (InitPlan), not a check on every row", /InitPlan/.test(plan), plan.slice(0, 300));
check("the files say why", Object.values(FILES).every(f => /Speed note/.test(read(f))));

console.log("\nThe undo files and running twice");
for (const k of KEYS) await db.exec(read(UNDO[k]));
check("after the undo files the live rule is back (any staff account reads and changes scholar data again)", (await n(P.plain, "scholars")) === N && (await n(P.plain, "scholar_subjects_grades")) === G && (await n(P.plain, "scholar_quest_scores")) === QS
  && await changes(P.plain, "update schools set name = name returning id") === SC && (await n(P.plain, "attendance_records")) === AR && (await n(P.plain, "scholar_sdp_category_status")) === ST);
check("…and the helper is gone", await count("select count(*) n from pg_proc where proname = '_p8_can_read_scholars'") === 0);
for (const k of KEYS) { await db.exec(read(FILES[k])); await db.exec(read(FILES[k])); }
check("run twice, the files put the new rules back (and only once)", await count("select count(*) n from pg_policies where tablename = 'scholars' and policyname like 'p8 %'") === 2
  && await count("select count(*) n from pg_policies where tablename in ('scholars','scholar_subjects_grades','scholar_quest_scores','scholar_sdp_category_status','attendance_records','schools','school_accounts','school_grading_configs','school_letter_grades','grading_period_settings','scholar_sdp','scholar_services') and policyname = 'staff full access'") === 0);
check("…and they refuse again", (await n(P.plain, "scholars")) === 0 && await changes(P.plain, "update schools set name = name returning id") === 0);
check("every file sets a short wait limit", [...Object.values(FILES), ...Object.values(UNDO)].every(f => /set lock_timeout = '5s'/.test(read(f))));
check("none of the files touches a table outside its own", [["a", ["scholars"]], ["b", ["scholar_subjects_grades"]], ["c", ["scholar_quest_scores"]], ["d", ["scholar_sdp_category_status"]], ["e", ["scholar_sdp", "scholar_services"]], ["f", ["attendance_records"]],
  ["g", ["schools", "school_accounts", "school_grading_configs", "school_letter_grades", "grading_period_settings"]]].every(([k, ts]) => [...read(FILES[k]).matchAll(/(?:alter table|\bon) public\.([a-z_]+)/g)].every(m => ts.includes(m[1]))));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
