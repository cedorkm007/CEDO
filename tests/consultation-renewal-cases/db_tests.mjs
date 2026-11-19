// tests/consultation-renewal-cases/db_tests.mjs — Consultation Tool, Renewal Cases in PAGES (supabase_migration_consultation_renewal_cases_paging.sql): nothing cut off at 1,000, one term at a time with the current term first,
// documents of ONE case on request, the numbers on the group buttons, the undo (5 checks)
// Run:  node tests/consultation-renewal-cases/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE = "supabase_migration_consultation_renewal_cases_paging.sql", UNDO = "undo_consultation_renewal_cases_paging.sql";
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
const page = (uid, a = {}) => attempt(uid, "select * from public.renewal_consult_cases_page($1, $2, $3, $4, $5, $6, $7)",
  [a.sy ?? null, a.term ?? null, a.group ?? null, a.search ?? "", a.limit ?? 50, a.offset ?? 0, a.id ?? null]);
const counts = (uid, a = {}) => attempt(uid, "select * from public.renewal_consult_case_counts($1, $2, $3)", [a.sy ?? null, a.term ?? null, a.search ?? ""]);

// the renewal windows: the current term, the previous term, an older one, and a window only for chosen test scholars (never the current term)
await q("delete from renewal_records"); await q("delete from renewal_windows");
const win = {};
for (const [k, sy, term, opens] of [["cur", "2026-2027", "1st Semester", "2026-10-01"], ["prev", "2025-2026", "2nd Semester", "2026-03-01"], ["old", "2025-2026", "1st Semester", "2025-10-01"]])
  win[k] = (await q("insert into renewal_windows (school_year, term, opens_on, closes_on) values ($1, $2, $3, $4) returning id", [sy, term, opens, "2026-12-31"]))[0].id;
await q("insert into renewal_windows (school_year, term, opens_on, closes_on, testers) values ('2027-2028', '1st Semester', '2026-10-05', '2027-12-31', array['NOBODY'])");

// 1,130 scholars; 1,100 open cases in the current term (more than the 1,000 a single request can return), 30 in the previous term, 10 in an older one (+ 5 closed ones that must never show)
await q("set session_replication_role = replica");
await q(`insert into scholars (id, scholar_id_number, first_name, last_name, middle_name, birthday, email, contact_no, school, course, status, barangay, year_level, house_unit_no, street, city_municipality, province_region, country, zip_code, emergency_contact_name, emergency_contact_relationship, emergency_contact_number)
         select gen_random_uuid(), 'RC-' || lpad(g::text, 5, '0'), 'RCTEST', 'Case' || lpad(g::text, 5, '0'), 'T', '2005-05-05', 'rc' || g || '@demo.local', '09170000000', 'Test School', 'BS Test', 'Regular', 'B', '2nd Year', '1', 'S', 'C', 'P', 'Philippines', '0000', 'G', 'Parent', '09170000001'
         from generate_series(1, 1130) g`);
const STAGES = "(array['ready_for_endorsement', 'needs_study_plan_consultation', 'inc_waiting_compliance', 'endorsed_for_approval'])";
await q(`insert into renewal_records (scholar_id_number, school_year, term, window_id, stage) select 'RC-' || lpad(g::text, 5, '0'), '2026-2027', '1st Semester', $1, ${STAGES}[(g % 4) + 1] from generate_series(1, 1100) g`, [win.cur]);
await q(`insert into renewal_records (scholar_id_number, school_year, term, window_id, stage) select 'RC-' || lpad(g::text, 5, '0'), '2025-2026', '2nd Semester', $1, ${STAGES}[(g % 4) + 1] from generate_series(1101, 1130) g`, [win.prev]);
await q(`insert into renewal_records (scholar_id_number, school_year, term, window_id, stage) select 'RC-' || lpad(g::text, 5, '0'), '2025-2026', '1st Semester', $1, 'inc_deadline_passed' from generate_series(1, 10) g`, [win.old]);
await q(`insert into renewal_records (scholar_id_number, school_year, term, window_id, stage) select 'RC-' || lpad(g::text, 5, '0'), '2025-2026', '2nd Semester', $1, 'renewed' from generate_series(1, 5) g`, [win.prev]);
const ONE = (await q("select id from renewal_records where scholar_id_number = 'RC-00001' and school_year = '2026-2027'"))[0].id;
await q("insert into renewal_documents (record_id, scholar_id_number, kind, storage_path, file_name, mime_type, size_bytes, status) values ($1, 'RC-00001', 'study_plan', 'RC-00001/x/study_plan/plan.pdf', 'plan.pdf', 'application/pdf', 10, 'submitted')", [ONE]);
await q("set session_replication_role = origin");

// 1. only consultation staff; one request never returns more than 200 rows
const plain = await page(PLAIN), plainC = await counts(PLAIN), plainT = await attempt(PLAIN, "select * from public.renewal_consult_case_terms()"), plainD = await attempt(PLAIN, "select public.renewal_consult_case_documents($1)", [ONE]);
const big = await page(COUNSELOR, { limit: 5000 });
check("1 only consultation staff can ask (the cases, the numbers, the terms and a case's documents), and one request never returns more than 200 cases (however much is asked)",
  [plain, plainC, plainT, plainD].every(r => !r.ok && /Only the consultation staff/i.test(r.msg)) && big.ok && big.rows.length === 200, `${plain.msg} ${big.rows?.length}`);

// 2. the terms: the current term is the newest window that has opened (the test-scholars-only window is skipped), with how many cases are open in each
const terms = (await attempt(COUNSELOR, "select * from public.renewal_consult_case_terms()")).rows;
const cur = terms.find(t => t.is_current);
check("2 the terms come newest first with their open counts (1,100 / 30 / 10; the 5 renewed ones are not open), and the current term is 1st Semester 2026-2027 (a window only for test scholars is never the current term)",
  terms.length === 3 && cur && cur.school_year === "2026-2027" && cur.term === "1st Semester" && Number(cur.open_count) === 1100 && Number(terms[1].open_count) === 30 && Number(terms[2].open_count) === 10 && terms.filter(t => t.is_current).length === 1, JSON.stringify(terms));

// 3. nothing is cut off at 1,000: the pages of the current term together give all 1,100 cases once, with the true total; the previous term and all terms are one choice away
const seen = new Set(), totals = new Set(); let pages = 0;
for (let off = 0; ; off += 50) {
  const r = await page(COUNSELOR, { sy: "2026-2027", term: "1st Semester", offset: off });
  if (!r.ok || r.rows.length === 0) break;
  pages++; r.rows.forEach(x => { seen.add(x.record_id); totals.add(String(x.total_count)); });
  if (r.rows.length < 50) break;
}
const first = (await page(COUNSELOR, { sy: "2026-2027", term: "1st Semester" })).rows;
const prevT = await page(COUNSELOR, { sy: "2025-2026", term: "2nd Semester" }), allT = await page(COUNSELOR, { limit: 1 });
check("3 reading the pages of the current term one after the other gives all 1,100 cases (more than the 1,000 a single request can return), each once, with the true total on every page, ready-to-endorse first; the previous term shows its 30 and all terms 1,140",
  seen.size === 1100 && pages === 22 && totals.size === 1 && [...totals][0] === "1100" && first[0].grp === "ready" && first.every(x => x.school_year === "2026-2027")
  && Number(prevT.rows[0].total_count) === 30 && Number(allT.rows[0].total_count) === 1140, `${seen.size} ${pages} ${[...totals]} ${first[0]?.grp} ${prevT.rows[0]?.total_count} ${allT.rows[0]?.total_count}`);

// 4. the groups and their numbers, the search, and the summary of the documents (the list of documents is NOT in the page; it comes for ONE case)
const cnt = (await counts(COUNSELOR, { sy: "2026-2027", term: "1st Semester" })).rows[0];
const ready = await page(COUNSELOR, { sy: "2026-2027", term: "1st Semester", group: "ready", limit: 1 }), work = await page(COUNSELOR, { sy: "2026-2027", term: "1st Semester", group: "work", limit: 1 }), sent = await page(COUNSELOR, { sy: "2026-2027", term: "1st Semester", group: "sent", limit: 1 });
const byId = await page(COUNSELOR, { search: "rc-00001", sy: "2026-2027", term: "1st Semester" }), pct = await page(COUNSELOR, { search: "100%" });
const one = (await page(COUNSELOR, { id: ONE })).rows, noOne = (await page(COUNSELOR, { id: "00000000-0000-0000-0000-000000000000" })).rows;
const docs = (await attempt(COUNSELOR, "select public.renewal_consult_case_documents($1) d", [ONE])).rows[0].d;
check("4 the numbers on the group buttons match the groups (ready 275, documents and consultation 550, endorsed 275), the search finds a case by Scholar ID in any capitals ('%' is just a letter), a case alone can be read again, and its documents come on request (the page only says '1 waiting for you')",
  Number(cnt.ready_count) === ready.rows[0].total_count * 1 && Number(cnt.work_count) === Number(work.rows[0].total_count) && Number(cnt.sent_count) === Number(sent.rows[0].total_count) && Number(cnt.ready_count) + Number(cnt.work_count) + Number(cnt.sent_count) === 1100
  && byId.rows.length === 1 && byId.rows[0].scholar_id_number === "RC-00001" && pct.rows.length === 0 && one.length === 1 && one[0].docs_submitted === 1 && one[0].docs_accepted === 0 && !("documents" in one[0]) && noOne.length === 0
  && docs.documents.length === 1 && docs.documents[0].file_name === "plan.pdf" && docs.documents[0].status === "submitted", `${JSON.stringify(cnt)} ${ready.rows[0]?.total_count}/${work.rows[0]?.total_count}/${sent.rows[0]?.total_count}`);

// 5. the index exists; the undo removes the new functions and the index only (the older function and every case stay)
const idx = Number((await q("select count(*)::int n from pg_indexes where indexname = 'renewal_records_consult_case_idx'"))[0].n);
const recs = Number((await q("select count(*)::int n from renewal_records"))[0].n);
await db.exec(read(UNDO));
const gone = (await q("select to_regprocedure('public.renewal_consult_cases_page(text,text,text,text,integer,integer,uuid)') a, to_regprocedure('public.renewal_consult_case_documents(uuid)') b, to_regprocedure('public.renewal_consult_case_counts(text,text,text)') c, to_regprocedure('public.renewal_consult_case_terms()') d, to_regprocedure('public.renewal_consult_cases()') old"))[0];
const idxAfter = Number((await q("select count(*)::int n from pg_indexes where indexname = 'renewal_records_consult_case_idx'"))[0].n);
check("5 the index exists; after the undo the new functions and the index are gone while the older function and every renewal case stay",
  idx === 1 && gone.a === null && gone.b === null && gone.c === null && gone.d === null && gone.old !== null && idxAfter === 0 && Number((await q("select count(*)::int n from renewal_records"))[0].n) === recs, `${idx} ${JSON.stringify(gone)} ${idxAfter}`);
console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
