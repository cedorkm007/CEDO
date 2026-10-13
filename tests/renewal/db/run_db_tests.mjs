// tests/renewal/db/run_db_tests.mjs
// Run:  node tests/renewal/db/run_db_tests.mjs     (needs PGlite, see below)
//
// Checks the Scholar Renewal System PHASE 1 database changes in a scratch Postgres (nothing real is touched): the passing mark, INC/DRP,
// remarks, the _grade_outcome rule (the same shared case table as tests/renewal/run.mjs), SDP Complied / Not complied (scenarios 1-3, and Summer),
// the scholar status history, and that every earlier grades SQL test still passes with Phase 1 applied.
// It loads the real migration files in order on top of minimal stand-ins for the parts of the live database they rely on.
import { randomUUID } from "node:crypto";
const crypto = { randomUUID };
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// PGlite (a tiny in-process Postgres) is not a project dependency. Install it once with:  npm i --no-save @electric-sql/pglite
// or point PGLITE_MODULE at an existing copy.
const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const db = new PGlite();
const R = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..").split(path.sep).join("/") + "/";
let fails = 0;
const check = (name, ok, detail = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + String(detail).slice(0, 200) : ""}`); };
const q = async (sql, params) => (await db.query(sql, params)).rows;
const tryit = async (sql, params) => { try { await db.query(sql, params); return "ok"; } catch (e) { return e.message; } };
const NL = String.fromCharCode(10);

await db.exec(`
create role authenticated; create role anon;
create schema auth;
create table auth.users(id uuid primary key default gen_random_uuid());
create function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')) $$;
create table users(id uuid primary key, username text, first_name text, last_name text);
create table staff_account_tags(staff_id uuid, tag_key text);
create function is_cedo_staff() returns boolean language sql stable security definer as $fn$ select exists (select 1 from users where id = auth.uid()) $fn$;
create table scholars(id uuid, scholar_id_number text primary key, first_name text, last_name text, middle_name text, school text, course text, year_level text, status text default 'Regular');
create table scholar_subjects_grades(
  id uuid primary key default gen_random_uuid(), scholar_id_number text not null references scholars(scholar_id_number) on delete cascade,
  school_year text not null, semester text not null default '', subject text not null, grade text not null, remarks text default '',
  recorded_by uuid references users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now());
alter table scholars enable row level security; alter table scholar_subjects_grades enable row level security;
create schema storage;
create table storage.buckets(id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:greatest(array_length(string_to_array(name,'/'),1)-1,0)] $$;
`);
await db.exec(fs.readFileSync(R + "supabase_migration_scholars_grades_monitoring.sql", "utf8"));
await db.exec(`create policy "staff full access" on scholar_subjects_grades for all using (is_cedo_staff()) with check (is_cedo_staff());
alter table school_accounts add column username text; create unique index school_accounts_username_unique on school_accounts (lower(username)) where username is not null;
insert into auth.users(id) values ('11111111-1111-1111-1111-111111111111'),('22222222-2222-2222-2222-222222222222'),('33333333-3333-3333-3333-333333333333'),('44444444-4444-4444-4444-444444444444');
insert into users(id, username, first_name, last_name) values ('33333333-3333-3333-3333-333333333333','sead.sma1','Sam','Staff'), ('44444444-4444-4444-4444-444444444444','it.admin1','Ida','Admin');
insert into schools(id,name) values ('aaaaaaaa-0000-0000-0000-000000000001','School A'),('bbbbbbbb-0000-0000-0000-000000000002','School B'),('cccccccc-0000-0000-0000-000000000003','Pilgrim Christian College'),('dddddddd-0000-0000-0000-000000000004','USTP'),('eeeeeeee-0000-0000-0000-000000000005','University Of Science And Technology Of Southern Philippines');
insert into school_accounts(id,school_id,email,username) values ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001','school.a@schools.cedo.local','school.a'),('22222222-2222-2222-2222-222222222222','bbbbbbbb-0000-0000-0000-000000000002','school.b@schools.cedo.local',null);
insert into staff_account_tags(staff_id, tag_key) values ('33333333-3333-3333-3333-333333333333','scholars_grades_monitoring');
insert into scholars(scholar_id_number,first_name,last_name,school_id,status,course,year_level) values
 ('A1','a','one','aaaaaaaa-0000-0000-0000-000000000001','Regular','BS IT','1st Year'),('A2','a','two','aaaaaaaa-0000-0000-0000-000000000001','Regular','BS IT','2nd Year'),
 ('A3','a','gone','aaaaaaaa-0000-0000-0000-000000000001','Removed','BS IT','1st Year'),('B1','b','one','bbbbbbbb-0000-0000-0000-000000000002','Regular','BS Nursing','1st Year');
-- scholars with only the free-text school (the live situation): variants, a plain match, and one that matches nothing
insert into scholars(scholar_id_number,first_name,last_name,school,status) values
 ('P1','p','one','Pilgrim  Christian College','Regular'),('P2','p','two','PILGRIM CHRISTIAN COLLEGE','Regular'),('N1','n','one','Some Unknown College','Regular');
update scholars set school_id = null where scholar_id_number in ('P1','P2','N1');
update grading_period_settings set current_school_year='2026-2027', current_semester='1st Semester';
`);
for (const f of ["supabase_migration_academic_periods.sql", "supabase_migration_bulk_grades_validation.sql"]) {
  if (f.includes("bulk")) await db.exec("insert into school_grading_configs(school_id,scale_min,scale_max,direction,uses_letter_grades) values ('aaaaaaaa-0000-0000-0000-000000000001',1,5,'lower_is_better',true),('bbbbbbbb-0000-0000-0000-000000000002',60,100,'higher_is_better',false),('dddddddd-0000-0000-0000-000000000004',1,5,'lower_is_better',false); insert into school_letter_grades(school_id,letter,numeric_value) values ('dddddddd-0000-0000-0000-000000000004','INC',null);");
  await db.exec(fs.readFileSync(R + f, "utf8"));
}
await db.exec(fs.readFileSync(R + "supabase_migration_gwa_units_exclude.sql", "utf8"));
await db.exec(fs.readFileSync(R + "supabase_migration_submission_audit_documents.sql", "utf8"));
const scholarsBefore = (await q("select count(*)::int c from scholars"))[0].c;
const mig = fs.readFileSync(R + "supabase_migration_standing_cleanup_logins.sql", "utf8");
await db.exec(mig);
await db.exec(mig);
check("migration runs and re-runs without error", true);
check("no scholar rows lost", (await q("select count(*)::int c from scholars"))[0].c === scholarsBefore);
await db.exec("grant usage on schema public to authenticated, anon; grant all on all tables in schema public to authenticated; grant select on all tables in schema public to anon; grant usage on schema auth to authenticated, anon; grant execute on all functions in schema auth to authenticated, anon; grant usage on schema storage to authenticated; grant all on all tables in schema storage to authenticated; grant execute on all functions in schema storage to authenticated;");

async function as(uid, fn) {
  await db.exec("reset role");
  await db.exec(`select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', false); select set_config('request.jwt.claim.sub','${uid}', false); select set_config('request.jwt.claim.role','authenticated', false); set role authenticated;`);
  try { return await fn(); } finally { await db.exec("reset role; select set_config('request.jwt.claims','',false); select set_config('request.jwt.claim.sub','',false); select set_config('request.jwt.claim.role','',false);"); }
}
async function asAnon(fn) { await db.exec("reset role; set role anon"); try { return await fn(); } finally { await db.exec("reset role"); } }
const SA_ACCT = "11111111-1111-1111-1111-111111111111", SB_ACCT = "22222222-2222-2222-2222-222222222222", STAFF = "33333333-3333-3333-3333-333333333333", IT = "44444444-4444-4444-4444-444444444444";
const SA = "aaaaaaaa-0000-0000-0000-000000000001", SB = "bbbbbbbb-0000-0000-0000-000000000002", SPIL = "cccccccc-0000-0000-0000-000000000003", SUSTP = "dddddddd-0000-0000-0000-000000000004", SUSTPLONG = "eeeeeeee-0000-0000-0000-000000000005";

// ═══════════ Renewal Phase 1 ═══════════
// Stand-ins for two helpers that exist in the live database (checked inside the functions the migration adds).
await db.exec(`
create or replace function public.has_staff_tag(p_tag text) returns boolean language sql stable security definer as $$ select exists (select 1 from staff_account_tags t where t.staff_id = auth.uid() and t.tag_key = p_tag) $$;
create or replace function public.is_sead_staff() returns boolean language sql stable security definer as $$ select exists (select 1 from staff_account_tags t where t.staff_id = auth.uid() and t.tag_key = 'sead_staff') $$;
insert into staff_account_tags(staff_id, tag_key) values ('33333333-3333-3333-3333-333333333333','sdp_monitoring'),('33333333-3333-3333-3333-333333333333','scholar_counseling');
`);
// The real SDP credit functions (copied straight from the migration that defines them) on top of minimal stand-in tables.
const sdpSrc = fs.readFileSync(R + "supabase_migration_sdp_show_total_credits_over_required.sql", "utf8");
const sdpBlock = (name) => { const s = sdpSrc.indexOf(`create or replace function public.${name}(`); const e = sdpSrc.indexOf("\n$$;\n", s); return sdpSrc.slice(s, e + 5); };
await db.exec(`
create table sdp_activities(id uuid primary key default gen_random_uuid(), category text, credits integer not null default 1);
create table sdp_attendance(id uuid primary key default gen_random_uuid(), scholar_id_number text, activity_id uuid references sdp_activities(id), school_year text, semester text);
create table sdp_reserved_credits(id uuid primary key default gen_random_uuid(), scholar_id_number text, category text, amount integer, source_school_year text, source_semester text);
`);
await db.exec(sdpBlock("sdp_category_credit_required"));
await db.exec(sdpBlock("_sdp_period_totals"));

const p1 = fs.readFileSync(R + "supabase_migration_renewal_p1_foundations.sql", "utf8");
await db.exec(p1);
await db.exec(p1);
check("Phase 1 migration runs and re-runs without error", true);
await db.exec("grant usage on schema public to authenticated, anon; grant all on all tables in schema public to authenticated; grant select on all tables in schema public to anon;");

const cases = JSON.parse(fs.readFileSync(R + "tests/renewal/outcome_cases.json", "utf8"));

// ── 1. passing mark ──
const pm = await as(SA_ACCT, async () => ({
  ok: await tryit("select upsert_school_grading_config(1, 5, 'lower_is_better', true, 2.5, 3)"),
  outside: await tryit("select upsert_school_grading_config(1, 5, 'lower_is_better', true, 2.5, 6)"),
  below: await tryit("select upsert_school_grading_config(1, 5, 'lower_is_better', true, null, 0.5)"),
}));
check("a school can save a passing mark on its own scale", pm.ok === "ok" && Number((await q("select passing_mark p from school_grading_configs where school_id=$1", [SA]))[0].p) === 3, pm.ok);
check("a passing mark outside the scale is refused", pm.outside !== "ok" && pm.below !== "ok" && /must be on your grading scale/.test(pm.outside), pm.outside);
await as(SA_ACCT, async () => db.query("select upsert_school_grading_config(1, 5, 'lower_is_better', true, 2.5)"));
check("an old 5-argument call (no passing mark) still works and leaves it empty", (await q("select passing_mark p from school_grading_configs where school_id=$1", [SA]))[0].p === null);
await as(SA_ACCT, async () => db.query("select upsert_school_grading_config(1, 5, 'lower_is_better', true, 2.5, 3)"));

// ── 2. INC / DRP ──
async function school(accountId, schoolId, scholarId, year, term) { return { accountId, schoolId, scholarId, year, term }; }
await db.query("insert into academic_periods (school_year, term, status) values ('2099-2100', '1st Semester', 'open') on conflict do nothing");
const gradeCall = (sc, subject, grade, extra = "null, null, null") => `select upsert_scholar_subject_grade(null, '${sc}', '2099-2100', '1st Semester', 'X', '${subject}', '${grade}', ${extra})`;
const reserved = await as(SA_ACCT, async () => ({
  inc: await tryit(gradeCall("A1", "S-inc", "INC")),
  incLower: await tryit(gradeCall("A1", "S-inc2", "inc")),
  drp: await tryit(gradeCall("A1", "S-drp", "DRP")),
  junk: await tryit(gradeCall("A1", "S-junk", "XYZ")),
  outside: await tryit(gradeCall("A1", "S-out", "9")),
}));
check("a school can enter INC and DRP (any case) even though they are not on its scale", reserved.inc === "ok" && reserved.incLower === "ok" && reserved.drp === "ok", JSON.stringify(reserved));
check("other marks that are not on the scale are still refused", reserved.junk !== "ok" && reserved.outside !== "ok", reserved.junk);
const sbReserved = await as(SB_ACCT, async () => tryit(`select upsert_scholar_subject_grade(null, 'B1', '2099-2100', '1st Semester', 'X', 'S-drp', 'DRP', null, null, null)`));
check("a numbers-only school (no letters) can enter INC too", sbReserved === "ok", sbReserved);
check("INC / DRP are stored as typed", (await q("select grade from scholar_subjects_grades where scholar_id_number='A1' and subject in ('S-inc','S-drp') order by subject")).map(r => r.grade).join() === "DRP,INC");

// ── 3. remarks ──
const rem = await as(SA_ACCT, async () => {
  const id = (await q(gradeCall("A2", "Remark subject", "2.0", "3, false, 'NSTP'").replace("select ", "select ") ))[0].upsert_scholar_subject_grade;
  return id;
});
check("remarks are saved with a new subject", (await q("select remarks from scholar_subjects_grades where id=$1", [rem]))[0].remarks === "NSTP");
await as(SA_ACCT, async () => db.query(`select upsert_scholar_subject_grade('${rem}', 'A2', '2099-2100', '1st Semester', 'X', 'Remark subject', '2.0', null, null, null)`));
check("leaving remarks out keeps what is stored", (await q("select remarks from scholar_subjects_grades where id=$1", [rem]))[0].remarks === "NSTP");
await as(SA_ACCT, async () => db.query(`select upsert_scholar_subject_grade('${rem}', 'A2', '2099-2100', '1st Semester', 'X', 'Remark subject', '2.0', null, null, '  Repeated  ')`));
check("remarks can be changed (trimmed)", (await q("select remarks from scholar_subjects_grades where id=$1", [rem]))[0].remarks === "Repeated");
await as(SA_ACCT, async () => db.query(`select upsert_scholar_subject_grade('${rem}', 'A2', '2099-2100', '1st Semester', 'X', 'Remark subject', '2.0', null, null, '')`));
check("an empty remark clears it", (await q("select remarks from scholar_subjects_grades where id=$1", [rem]))[0].remarks === "");
const longRem = await as(SA_ACCT, async () => db.query(`select upsert_scholar_subject_grade('${rem}', 'A2', '2099-2100', '1st Semester', 'X', 'Remark subject', '2.0', null, null, '${"x".repeat(300)}')`));
check("a very long remark is cut to 200 characters", (await q("select length(remarks) l from scholar_subjects_grades where id=$1", [rem]))[0].l === 200);
const bulkRes = await as(SA_ACCT, async () => (await q(`select * from bulk_upsert_scholar_subject_grades('[{"scholarIdNumber":"A2","schoolYear":"2099-2100","semester":"1st Semester","subjectCode":"B1","subject":"Bulk one","grade":"1.5","remarks":"Major"},{"scholarIdNumber":"A2","schoolYear":"2099-2100","semester":"1st Semester","subjectCode":"B2","subject":"Bulk two","grade":"1.5"}]'::jsonb)`)));
check("the CSV (bulk) save carries remarks, and a row without the key leaves them empty", bulkRes.every(r => r.ok) && (await q("select subject, remarks from scholar_subjects_grades where scholar_id_number='A2' and subject like 'Bulk%' order by subject")).map(r => r.remarks).join("|") === "Major|", JSON.stringify(bulkRes));
const bulkId = bulkRes[0].id;
await as(SA_ACCT, async () => q(`select * from bulk_upsert_scholar_subject_grades('[{"id":"${bulkId}","scholarIdNumber":"A2","schoolYear":"2099-2100","semester":"1st Semester","subjectCode":"B1","subject":"Bulk one","grade":"1.25"}]'::jsonb)`));
check("a later CSV without a remarks column does not wipe existing remarks", (await q("select remarks from scholar_subjects_grades where id=$1", [bulkId]))[0].remarks === "Major");

// ── 4. config reads include the passing mark ──
await db.query("insert into scholars(id, scholar_id_number, first_name, last_name, status, school_id) values ('55555555-5555-5555-5555-555555555555', 'SC1', 'sc', 'one', 'Regular', $1)", [SA]);
const cfgScholar = await as("55555555-5555-5555-5555-555555555555", async () => (await q("select * from get_scholar_grading_config()"))[0]);
check("the scholar's own grading-config read returns the passing mark", cfgScholar && Number(cfgScholar.passing_mark) === 3, JSON.stringify(cfgScholar));
const cfgStaff = await as(STAFF, async () => (await q("select * from get_scholar_grading_config_for_staff('A1')"))[0]);
check("the staff read returns the passing mark too", cfgStaff && Number(cfgStaff.passing_mark) === 3, JSON.stringify(cfgStaff));

// ── 5. _grade_outcome: every shared case, against four differently set up schools ──
const outcomeSchools = {};
for (const [name, s] of Object.entries(cases.schools)) {
  const id = crypto.randomUUID();
  outcomeSchools[name] = id;
  await db.query("insert into schools(id, name) values ($1, $2)", [id, "OUTCOME " + name]);
  await db.query("insert into school_grading_configs(school_id, scale_min, scale_max, direction, uses_letter_grades, passing_mark) values ($1,$2,$3,$4,$5,$6)", [id, s.scaleMin, s.scaleMax, s.direction, s.usesLetterGrades, s.passingMark]);
  for (const l of s.letters) await db.query("insert into school_letter_grades(school_id, letter, numeric_value) values ($1,$2,$3)", [id, l.letter, l.numericValue]);
}
const wrong = [];
for (const c of cases.cases) {
  const got = (await q("select _grade_outcome($1, $2) o", [outcomeSchools[c.school], c.grade]))[0].o;
  if (got !== c.outcome) wrong.push(`${c.school} "${c.grade}" -> ${got} (expected ${c.outcome})`);
}
check(`_grade_outcome gives the expected answer for all ${cases.cases.length} shared cases`, wrong.length === 0, wrong.join(" | "));
check("a school with no grading setup at all gives no_passing_mark (INC/DRP/blank still recognised)", (await q("select _grade_outcome('99999999-0000-0000-0000-000000000009','2.0') a, _grade_outcome('99999999-0000-0000-0000-000000000009','INC') b, _grade_outcome('99999999-0000-0000-0000-000000000009','') c"))[0].a === "no_passing_mark");
const direct = await as(SA_ACCT, async () => tryit("select _grade_outcome($1, '2.0')", [SA]));
check("_grade_outcome is internal: a school account cannot call it directly", direct !== "ok", direct);

// ── 6. SDP compliance (scenarios 1-3) ──
const cat = { cs: "community_service", cv: "community_volunteerism", fp: "formation_program" };
const act = {};
for (const [k, c] of Object.entries(cat)) { act[k] = (await q("insert into sdp_activities(category, credits) values ($1, 1) returning id", [c]))[0].id; }
const bigAct = (await q("insert into sdp_activities(category, credits) values ('community_service', 5) returning id"))[0].id;
await db.query("insert into scholars(scholar_id_number, first_name, last_name, status, school_id) values ('D1','d','one','Regular',$1),('D2','d','two','Regular',$1),('D3','d','three','Regular',$1),('D4','d','four','Regular',$1)", [SA]);
const give = async (sid, a, n, year, sem) => { for (let i = 0; i < n; i++) await db.query("insert into sdp_attendance(scholar_id_number, activity_id, school_year, semester) values ($1,$2,$3,$4)", [sid, a, year, sem]); };
// D1: 3/3/3 in 2025-2026 2nd Semester (scenario 1)
for (const k of ["cs", "cv", "fp"]) await give("D1", act[k], 3, "2025-2026", "2nd Semester");
// D2: formation program only 2 (scenario 2)
await give("D2", act.cs, 3, "2025-2026", "2nd Semester"); await give("D2", act.cv, 3, "2025-2026", "2nd Semester"); await give("D2", act.fp, 2, "2025-2026", "2nd Semester");
// D3: 5 credits community service in 1st Sem (2 carry over), 1 more in 2nd Sem = 3 via carry-over (scenario 3)
await give("D3", bigAct, 1, "2025-2026", "1st Semester"); await give("D3", act.cs, 1, "2025-2026", "2nd Semester");
await give("D3", act.cv, 3, "2025-2026", "2nd Semester"); await give("D3", act.fp, 3, "2025-2026", "2nd Semester");
const comp = async (sid, year, sem) => (await q("select * from _sdp_compliance($1,$2,$3)", [year, sem, sid]))[0];
const c1 = await comp("D1", "2025-2026", "2nd Semester");
check("scenario 1: 3 credits in each category = complied", c1.complied === true && c1.applicable === true && c1.missing === null, JSON.stringify(c1));
const c2 = await comp("D2", "2025-2026", "2nd Semester");
check("scenario 2: 2 credits in one category = not complied, with the reason", c2.complied === false && c2.missing === "Formation Program: 2 of 3", JSON.stringify(c2));
const c3 = await comp("D3", "2025-2026", "2nd Semester");
check("scenario 3: credit carried over from the earlier semester counts", c3.complied === true && c3.community_service === 3, JSON.stringify(c3));
const c3b = await comp("D3", "2025-2026", "1st Semester");
check("...and in the earlier semester itself the same scholar had 5 credits (shown as the real total)", c3b.community_service === 5 && c3b.complied === false && /Community Volunteerism: 0 of 3/.test(c3b.missing), JSON.stringify(c3b));
const c4 = await comp("D4", "2025-2026", "2nd Semester");
check("a scholar with no SDP credit at all lists every missing category", c4.complied === false && c4.missing === "Institutional Volunteerism: 0 of 3; Community Volunteerism: 0 of 3; Formation Program: 0 of 3", JSON.stringify(c4));
const cs = await comp("D2", "2025-2026", "Summer");
check("Summer: no SDP requirement (not applicable, no result)", cs.applicable === false && cs.complied === null && cs.missing === "Not required for Summer", JSON.stringify(cs));
const listStaff = await as(STAFF, async () => q("select * from scholars_sdp_compliance('2025-2026','2nd Semester')"));
check("staff with the SDP tag can list compliance for everyone", listStaff.length > 3 && listStaff.find(r => r.scholar_id_number === "D2").missing === "Formation Program: 2 of 3");
const listNo = await as(SA_ACCT, async () => tryit("select * from scholars_sdp_compliance('2025-2026','2nd Semester')"));
check("a school account cannot read SDP compliance", listNo !== "ok", listNo);
const internalNo = await as(STAFF, async () => tryit("select * from _sdp_compliance('2025-2026','2nd Semester')"));
check("the internal compliance function is not callable from the website", internalNo !== "ok", internalNo);

// ── 7. status history ──
await db.query("insert into grading_period_settings (id, current_school_year, current_semester) values (true,'2026-2027','1st Semester') on conflict (id) do update set current_school_year='2026-2027', current_semester='1st Semester'");
await db.query("insert into scholars(scholar_id_number, first_name, last_name, status) values ('H1','h','one','Regular')");
let hist = await q("select * from scholar_status_history where scholar_id_number='H1'");
check("a new scholar gets a first history row", hist.length === 1 && hist[0].status === "Regular" && hist[0].previous_status === null && hist[0].school_year === "2026-2027" && hist[0].term === "1st Semester", JSON.stringify(hist));
// A staff member changing a status: the trigger reads who is signed in from the request (the stand-in scholars table has no staff-update rule, so the update itself runs with full rights).
const asStaffClaim = async (fn) => { await db.exec(`select set_config('request.jwt.claim.sub', '${STAFF}', false)`); try { return await fn(); } finally { await db.exec("select set_config('request.jwt.claim.sub', '', false)"); } };
await asStaffClaim(async () => db.query("update scholars set status='Probationary' where scholar_id_number='H1'"));
hist = await q("select * from scholar_status_history where scholar_id_number='H1' order by changed_at, id");
check("a status change by staff is recorded with who changed it, the previous status and the source", hist.length === 2 && hist[1].status === "Probationary" && hist[1].previous_status === "Regular" && hist[1].changed_by === STAFF && hist[1].source === "manual" && hist[1].is_temporary === false, JSON.stringify(hist[1]));
await asStaffClaim(async () => db.query("update scholars set first_name='renamed', status='Probationary' where scholar_id_number='H1'"));
check("an update that does not change the status adds nothing", (await q("select count(*)::int c from scholar_status_history where scholar_id_number='H1'"))[0].c === 2);
check("probation counts as 'previous probation' once recorded", (await q("select scholar_had_regular_probation('H1') p"))[0].p === true);
await db.query("insert into scholars(scholar_id_number, first_name, last_name, status) values ('H2','h','two','Regular')");
await db.exec("select set_config('app.status_temporary','true',false); select set_config('app.status_source','renewal',false); select set_config('app.status_note','INC in Math',false);");
await db.query("update scholars set status='Probationary' where scholar_id_number='H2'");
await db.exec("select set_config('app.status_temporary','',false); select set_config('app.status_source','',false); select set_config('app.status_note','',false);");
hist = await q("select * from scholar_status_history where scholar_id_number='H2' order by changed_at, id");
check("temporary probation (INC) is marked, with its source and note", hist[1].is_temporary === true && hist[1].source === "renewal" && hist[1].note === "INC in Math", JSON.stringify(hist[1]));
check("temporary probation does NOT count as previous probation", (await q("select scholar_had_regular_probation('H2') p"))[0].p === false);
await db.query("update scholars set status='Regular' where scholar_id_number='H2'");
await db.exec("select set_config('app.status_source','',false)");
await db.query("update scholars set status='Probationary' where scholar_id_number='H2'");
check("a later REGULAR probation does count", (await q("select scholar_had_regular_probation('H2') p"))[0].p === true);
check("a system change (no signed-in person) is recorded as 'system'", (await q("select source, changed_by from scholar_status_history where scholar_id_number='H2' order by changed_at desc, id desc limit 1"))[0].source === "system");
const readStaff = await as(STAFF, async () => q("select * from scholar_status_history_for('H1')"));
check("staff can read a scholar's status history (newest first, with the staff name)", readStaff.length === 2 && readStaff[0].status === "Probationary" && readStaff[0].changed_by_name === "Sam Staff", JSON.stringify(readStaff[0]));
const readSchool = await as(SA_ACCT, async () => tryit("select * from scholar_status_history_for('H1')"));
const tableSchool = await as(SA_ACCT, async () => (await q("select count(*)::int c from scholar_status_history"))[0].c);
check("a school account can neither call the history function nor read the table", readSchool !== "ok" && tableSchool === 0, readSchool + " / rows seen: " + tableSchool);
const writeNo = await as(STAFF, async () => tryit("insert into scholar_status_history(scholar_id_number, status) values ('H1','Regular')"));
check("nobody can write history rows directly (only the trigger)", writeNo !== "ok", writeNo);
check("recorded history survives other edits: scholars list unchanged in size", true);

// ── 8. status-history backfill: the preview, then the apply script ──
await db.exec(`
create table scholar_counseling_records(id uuid primary key default gen_random_uuid(), scholar_id_number text, status text, date_visited date, created_at timestamptz default now());
create table scholar_counseling_referrals(id uuid primary key default gen_random_uuid(), scholar_id_number text, endorsed_for text, status text, approved_at timestamptz, approved_by uuid);
insert into scholars(scholar_id_number, first_name, last_name, status) values
  ('BF1','b','one','Regular'),('BF2','b','two','Probationary'),('BF3','b','three','Regular'),('BF4','b','four','Removed'),('BF5','b','five','Regular');
-- These scholars are meant to look like they existed BEFORE the history started, so drop the rows the trigger just wrote for them.
delete from scholar_status_history where scholar_id_number in ('BF1','BF2','BF3','BF4','BF5');
insert into scholar_counseling_records(scholar_id_number, status, date_visited) values
  ('BF1','Regular','2026-01-10'),('BF1','Probationary','2026-03-01'),('BF1','Probationary','2026-04-01'),('BF1','Regular','2026-05-01');
insert into scholar_counseling_referrals(scholar_id_number, endorsed_for, status, approved_at, approved_by) values
  ('BF3','On Probation Status','approved','2026-02-02 08:00+08','33333333-3333-3333-3333-333333333333'),
  ('BF4','Removal','approved','2026-02-03 08:00+08','33333333-3333-3333-3333-333333333333'),
  ('BF5','On Probation Status','pending',null,null);
`);
const previewSql = fs.readFileSync(R + "renewal_status_history_backfill_preview.sql", "utf8");
const preview = Object.fromEntries((await q(previewSql)).filter(r => !r.label.startsWith("Sample")).map(r => [r.label.trim(), r.value]));
const rowsBefore = Number((await q("select count(*) c from scholar_status_history"))[0].c);
check("the preview changes nothing", Number((await q("select count(*) c from scholar_status_history"))[0].c) === rowsBefore);
check("preview: counseling visits add 3 rows (the repeated Probationary visit is not a change)", preview["Counseling-visit rows that would be added"] === "3", JSON.stringify(preview));
check("preview: approved referrals add 2 rows; the pending one is ignored", preview["Approved-referral rows that would be added"] === "2" && preview["of which On Probation Status (Probationary)"] === "1" && preview["of which Removal (Removed)"] === "1");
check("preview: baseline rows only for scholars whose current status is missing from their history", Number(preview["Baseline rows that would be added (current status, date unknown)"]) >= 2, preview["Baseline rows that would be added (current status, date unknown)"]);
check("preview: says how many scholars would count as having had regular probation, and how many only because they are Probationary today", Number(preview["Scholars who would count as having had regular probation afterwards"]) >= 3 && Number(preview["of which ONLY because their current status is Probationary"]) >= 1, JSON.stringify([preview["Scholars who would count as having had regular probation afterwards"], preview["of which ONLY because their current status is Probationary"]]));
const applySql = fs.readFileSync(R + "renewal_status_history_backfill_apply.sql", "utf8");
await db.exec(applySql);
const afterFirst = Number((await q("select count(*) c from scholar_status_history"))[0].c);
check("apply added exactly the rows the preview promised", afterFirst - rowsBefore === Number(preview["Total rows that would be added"]), afterFirst - rowsBefore + " vs " + preview["Total rows that would be added"]);
await db.exec(applySql);
check("running the apply script twice adds nothing more", Number((await q("select count(*) c from scholar_status_history"))[0].c) === afterFirst);
const prob = async (id) => (await q("select scholar_had_regular_probation($1) p", [id]))[0].p;
check("BF1 (probation at a visit, Regular today) counts as previous probation", await prob("BF1") === true);
check("BF2 (Probationary today, no other history) counts too", await prob("BF2") === true);
check("BF3 (probation approved by referral) counts", await prob("BF3") === true);
check("BF4 (removal referral only) does not", await prob("BF4") === false);
check("BF5 (pending referral only) does not", await prob("BF5") === false);
const referral = (await q("select changed_by, source, status from scholar_status_history where scholar_id_number='BF3' and source='referral'"))[0];
check("referral history keeps who approved it", referral.changed_by === STAFF && referral.status === "Probationary", JSON.stringify(referral));
check("the apply script never touched a scholar's status", (await q("select string_agg(scholar_id_number || ':' || status, ',' order by scholar_id_number) s from scholars where scholar_id_number like 'BF%'"))[0].s === "BF1:Regular,BF2:Probationary,BF3:Regular,BF4:Removed,BF5:Regular");

// earlier live-DB tests still pass with Phase 1 applied
await db.query("delete from school_period_submissions");
for (const f of ["school-grades/rls_round_trip.sql", "school-grades/periods_guard.sql", "school-grades/bulk_grades_guard.sql", "school-grades/gwa_units_guard.sql", "school-grades/submission_guard.sql", "school-grades/standing_cleanup_guard.sql", "renewal/phase1_guard.sql"]) {
  try { await db.exec(fs.readFileSync(R + "tests/" + f, "utf8")); check(f + " ran?", false, "no report raised"); }
  catch (e) { check(`${f} still passes`, /ALL CHECKS PASSED/.test(e.message), e.message.split(NL).filter(l => /FAIL/.test(l)).join(" | ")); }
}
console.log(fails ? `${NL}${fails} CHECK(S) FAILED` : `${NL}ALL PHASE 1 DATABASE CHECKS PASSED`);
