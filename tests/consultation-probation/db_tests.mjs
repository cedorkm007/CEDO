// tests/consultation-probation/db_tests.mjs — Consultation Tool, Probationary Monitoring in PAGES (supabase_migration_consultation_probation_paging.sql): nothing cut off at 1,000, filters by the database, only the current and previous term, documents of ONE scholar on request (5 checks)
// Run:  node tests/consultation-probation/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE = "supabase_migration_consultation_probation_paging.sql", UNDO = "undo_consultation_probation_paging.sql";
async function as(uid, sql, params = []) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)", [uid, JSON.stringify({ sub: uid, role: "authenticated" })]);
    return (await tx.query(sql, params)).rows;
  });
}
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await as(uid, sql, params) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
await db.exec(read(FILE)); await db.exec(read(FILE));      // twice: safe
const COUNSELOR = seedId("staff:demo.counselor"), PLAIN = seedId("staff:demo.plain");
const page = (uid, a = {}) => attempt(uid, `select * from public.scholar_probation_monitoring_page($1, $2, $3, $4, $5, $6, $7)`,
  [a.search ?? "", a.attention ?? null, a.kind ?? null, a.sort ?? "name", a.dir ?? "asc", a.limit ?? 50, a.offset ?? 0]);
const detail = (uid, id) => attempt(uid, "select public.scholar_probation_renewal_detail($1) d", [id]);

// the renewal windows: the current term, the previous term, an older one, and a window only for chosen test scholars (never counted as a term)
await q("delete from renewal_records"); await q("delete from renewal_windows");
const win = {};
for (const [k, sy, term, opens] of [["cur", "2026-2027", "1st Semester", "2026-10-01"], ["prev", "2025-2026", "2nd Semester", "2026-03-01"], ["old", "2025-2026", "1st Semester", "2025-10-01"]])
  win[k] = (await q("insert into renewal_windows (school_year, term, opens_on, closes_on) values ($1, $2, $3, $4) returning id", [sy, term, opens, "2026-12-31"]))[0].id;
await q("insert into renewal_windows (school_year, term, opens_on, closes_on, testers) values ('2027-2028', '1st Semester', '2026-10-05', '2027-12-31', array['NOBODY'])");

// 1,150 probationary scholars (more than the 1,000 a single request can return) + 6 named ones with known renewals
await q("set session_replication_role = replica");
await q(`insert into scholars (id, scholar_id_number, first_name, last_name, middle_name, birthday, email, contact_no, school, course, status, barangay, year_level, house_unit_no, street, city_municipality, province_region, country, zip_code, emergency_contact_name, emergency_contact_relationship, emergency_contact_number)
         select gen_random_uuid(), 'PB-' || lpad(g::text, 5, '0'), 'PBTEST', 'Bulk' || lpad(g::text, 5, '0'), 'T', '2005-05-05', 'pb' || g || '@demo.local', '09170000000', 'Test School', 'BS Test', 'Probationary', 'B', '2nd Year', '1', 'S', 'C', 'P', 'Philippines', '0000', 'G', 'Parent', '09170000001'
         from generate_series(1, 1150) g`);
const S = n => `PB-${String(n).padStart(5, "0")}`;
const [S1, S2, S3, S4, S5, S6] = [1, 2, 3, 4, 5, 6].map(S);
const rec = async (sid, w, sy, term, temp = false) => (await q("insert into renewal_records (scholar_id_number, school_year, term, window_id, stage, temp_probation) values ($1, $2, $3, $4, 'inc_waiting_compliance', $5) returning id", [sid, sy, term, win[w], temp]))[0].id;
const inc = (r, sid, subj, dl) => q("insert into renewal_inc_items (record_id, scholar_id_number, subject_code, subject, state, deadline) values ($1, $2, $3, $3, 'open', $4)", [r, sid, subj, dl]);
const plan = (r, sid) => q("insert into renewal_documents (record_id, scholar_id_number, kind, storage_path, file_name, mime_type, size_bytes) values ($1, $2, 'study_plan', $3, 'plan.pdf', 'application/pdf', 10)", [r, sid, `${sid}/${r}/study_plan/plan.pdf`]);
const in3 = (await q("select (current_date + 3)::text d"))[0].d, past5 = (await q("select (current_date - 5)::text d"))[0].d, far = (await q("select (current_date + 40)::text d"))[0].d;
const r1 = await rec(S1, "cur", "2026-2027", "1st Semester", true); await inc(r1, S1, "MATH1", in3); await plan(r1, S1);          // temporary, deadline soon, study plan
const r2 = await rec(S2, "prev", "2025-2026", "2nd Semester"); await inc(r2, S2, "ENG1", past5);                                    // previous term, deadline passed, no study plan
const r3 = await rec(S3, "old", "2025-2026", "1st Semester", true); await inc(r3, S3, "SCI1", in3); await plan(r3, S3);                // three terms back: must not count
const r5 = await rec(S5, "cur", "2026-2027", "1st Semester"); await plan(r5, S5);                                                      // study plan only
const r6 = await rec(S6, "cur", "2026-2027", "1st Semester"); await inc(r6, S6, "HIS1", null); await inc(r6, S6, "HIS2", far);        // deadline not set + one far away
await q("set session_replication_role = origin");      // the fixtures skip the document rules (they are not what is tested here)
const total = Number((await q("select count(*)::int n from scholars where status = 'Probationary'"))[0].n);

// 1. only consultation staff; one request never returns more than 500 rows
const plain = await page(PLAIN), big = await page(COUNSELOR, { limit: 5000 }), plainDetail = await detail(PLAIN, S1);
check("1 only consultation staff can ask (the list and a scholar's details), and one request never returns more than 500 rows (however much is asked)",
  !plain.ok && /Only consultation staff|Not authorized/i.test(plain.msg) && !plainDetail.ok && big.ok && big.rows.length === 500, `${plain.msg} ${plainDetail.msg} ${big.rows?.length}`);

// 2. nothing is cut off at 1,000: the pages together give every probationary scholar once, with the true total on each page
const seen = new Set(), totals = new Set(); let pages = 0;
for (let off = 0; ; off += 50) {
  const r = await page(COUNSELOR, { offset: off });
  if (!r.ok || r.rows.length === 0) break;
  pages++; r.rows.forEach(x => { seen.add(x.scholar_id_number); totals.add(String(x.total_count)); });
  if (r.rows.length < 50) break;
}
check(`2 reading the pages one after the other gives all ${total} probationary scholars (more than the 1,000 a single request can return), each once, with the true total on every page`,
  total >= 1156 && seen.size === total && pages === Math.ceil(total / 50) && totals.size === 1 && [...totals][0] === String(total), `${seen.size}/${total} pages ${pages} totals ${[...totals]}`);

// 3. the filters, the search and the sort are done by the database, and only the current + previous term count
const ids = r => r.rows.map(x => x.scholar_id_number);
const soon = await page(COUNSELOR, { attention: ["soon"] }), passed2 = await page(COUNSELOR, { attention: ["passed"] }), either = await page(COUNSELOR, { attention: ["soon", "passed"] });
const noPlan = await page(COUNSELOR, { attention: ["no_study_plan"], limit: 1 }), temp = await page(COUNSELOR, { kind: "temporary" }), regular = await page(COUNSELOR, { kind: "regular", limit: 1 });
const byDeadline = await page(COUNSELOR, { sort: "deadline", limit: 4 }), byName = await page(COUNSELOR, { sort: "name", dir: "desc", limit: 2 });
const find = await page(COUNSELOR, { search: S3.toLowerCase() }), pct = await page(COUNSELOR, { search: "100%" });
const nameDescIds = (await q("select scholar_id_number s from scholars where status = 'Probationary' order by lower(last_name) desc, lower(first_name) desc, scholar_id_number limit 2")).map(r => r.s);
const s3row = find.rows[0], s6row = (await page(COUNSELOR, { search: S6 })).rows[0], s1row = (await page(COUNSELOR, { search: S1 })).rows[0];
check("3 'INC deadline soon' / 'passed' / 'study plan missing' and 'temporary' / 'regular' work in the database and the total follows them; the older third term is left out; the sort by nearest deadline puts the passed one first; a '%' typed in the search is just a letter",
  JSON.stringify(ids(soon)) === JSON.stringify([S1]) && JSON.stringify(ids(passed2)) === JSON.stringify([S2]) && ids(either).length === 2 && Number(soon.rows[0].total_count) === 1
  && Number(noPlan.rows[0].total_count) === total - 2 && JSON.stringify(ids(temp)) === JSON.stringify([S1]) && Number(regular.rows[0].total_count) === total - 1
  && s3row && s3row.open_inc_count === 0 && s3row.temporary === false && s3row.has_study_plan === false
  && s6row.open_inc_count === 2 && s6row.passed_inc_count === 0 && s1row.has_study_plan === true && s1row.temporary === true && s1row.open_inc_count === 1
  && ids(byDeadline)[0] === S2 && ids(byDeadline)[1] === S1 && JSON.stringify(ids(byName)) === JSON.stringify(nameDescIds) && pct.ok && pct.rows.length === 0,
  `soon ${ids(soon)} passed ${ids(passed2)} noPlan ${noPlan.rows[0]?.total_count}/${total - 2} temp ${ids(temp)} byDeadline ${ids(byDeadline)} s3 ${JSON.stringify(s3row)}`);

// 4. the documents of ONE scholar, on request; the old term is not in it
const d1 = JSON.parse(JSON.stringify((await detail(COUNSELOR, S1)).rows[0].d)), d3 = (await detail(COUNSELOR, S3)).rows[0].d, d6 = (await detail(COUNSELOR, S6)).rows[0].d;
check("4 a scholar's details (INC items with their deadline and the uploaded study plan files) come for ONE scholar when asked; the scholar of the older third term has nothing; a scholar without a deadline set shows both INC items",
  d1.length === 1 && d1[0].inc_items.length === 1 && d1[0].inc_items[0].days_left === 3 && d1[0].study_plans.length === 1 && d1[0].study_plans[0].file_name === "plan.pdf" && d1[0].temporary_inc === true
  && d3.length === 0 && d6.length === 1 && d6[0].inc_items.length === 2 && d6[0].study_plans.length === 0, JSON.stringify([d1, d3, d6]).slice(0, 400));

// 5. the three indexes exist; the undo removes the new functions and indexes only (the older list and every record stay)
const idx = Number((await q("select count(*)::int n from pg_indexes where indexname in ('scholars_probationary_name_idx', 'renewal_inc_items_open_idx', 'renewal_records_scholar_term_idx')"))[0].n);
const recsBefore = Number((await q("select count(*)::int n from renewal_records"))[0].n), scBefore = total;
await db.exec(read(UNDO));
const gone = (await q("select to_regprocedure('public.scholar_probation_monitoring_page(text,text[],text,text,text,integer,integer,integer,integer)') a, to_regprocedure('public.scholar_probation_renewal_detail(text,integer)') b, to_regprocedure('public._probation_recent_terms(integer)') c, to_regprocedure('public.scholar_probation_monitoring_list(text)') old1, to_regprocedure('public.counseling_probation_renewal_info()') old2"))[0];
const idxAfter = Number((await q("select count(*)::int n from pg_indexes where indexname in ('scholars_probationary_name_idx', 'renewal_inc_items_open_idx', 'renewal_records_scholar_term_idx')"))[0].n);
check("5 the three indexes exist; after the undo the new functions and indexes are gone while the older list functions and every scholar and renewal stay",
  idx === 3 && gone.a === null && gone.b === null && gone.c === null && gone.old1 !== null && gone.old2 !== null && idxAfter === 0
  && Number((await q("select count(*)::int n from renewal_records"))[0].n) === recsBefore && Number((await q("select count(*)::int n from scholars where status = 'Probationary'"))[0].n) === scBefore, `${idx} ${JSON.stringify(gone)} ${idxAfter}`);
console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
