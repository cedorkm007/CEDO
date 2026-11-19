// tests/consultation-paging/db_tests.mjs — Consultation Tool, Daily Records in PAGES (supabase_migration_consultation_daily_records_paging.sql): nothing cut off at 1,000 rows, filters and sorting by the database, the export, the indexes (5 checks)
// Run:  node tests/consultation-paging/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE = "supabase_migration_consultation_daily_records_paging.sql", UNDO = "undo_consultation_daily_records_paging.sql";
async function as(uid, sql, params = []) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)", [uid, JSON.stringify({ sub: uid, role: "authenticated" })]);
    return (await tx.query(sql, params)).rows;
  });
}
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await as(uid, sql, params) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
await db.exec(read(FILE)); await db.exec(read(FILE));      // twice: safe
const COUNSELOR = seedId("staff:demo.counselor"), PLAIN = seedId("staff:demo.plain"), OTHER = seedId("staff:demo.admin");
await q("insert into staff_account_tags (staff_id, tag_key) values ($1, 'scholar_counseling') on conflict do nothing", [OTHER]);
const page = (uid, a = {}) => attempt(uid, `select * from public.scholar_counseling_daily_records_page($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
  [a.search ?? "", a.from ?? null, a.to ?? null, a.visit ?? null, a.status ?? null, a.who ?? null, a.sort ?? "date", a.dir ?? "desc", a.limit ?? 50, a.offset ?? 0, a.log ?? false]);

// 1,230 made-up records over 45 scholars, 2 consultants, all visit types and statuses
await q("delete from scholar_counseling_records");
const IDS = (await q("select scholar_id_number s from scholars order by scholar_id_number limit 40")).map(r => r.s);      // 40 scholars that exist
await q(`insert into scholar_counseling_records (scholar_id_number, status, consulted_by, date_visited, failed_subjects, findings, staff_recommendations, visit_type)
         select ($3::text[])[(g % 40) + 1], (array['Regular', 'Probationary', 'On leave', 'Reconsidered'])[(g % 4) + 1], case when g % 3 = 0 then $2::uuid else $1::uuid end,
                date '2026-11-01' - (g % 700), '', 'PAGING-' || g, '', (array['Office', 'KSB Client', 'Home Visit'])[(g % 3) + 1]
         from generate_series(1, 1230) g`, [COUNSELOR, OTHER, IDS]);

// 1. only consultation staff; the limit never goes over 500
const plain = await page(PLAIN);
const big = await page(COUNSELOR, { limit: 5000 });
check("1 only consultation staff can ask, and one request never returns more than 500 rows (however much is asked)", !plain.ok && /Not authorized/.test(plain.msg) && big.ok && big.rows.length === 500, `${plain.msg} ${big.rows?.length}`);

// 2. nothing is cut off at 1,000: every page together gives all 1,230, with the true total on each, no row twice
const seen = new Set(); let totals = new Set(), pages = 0;
for (let off = 0; ; off += 50) {
  const r = await page(COUNSELOR, { offset: off });
  if (!r.ok || r.rows.length === 0) break;
  pages++; r.rows.forEach(x => { seen.add(x.id); totals.add(String(x.total_count)); });
  if (r.rows.length < 50) break;
}
const first = (await page(COUNSELOR)).rows;
check("2 reading the pages one after the other gives all 1,230 records (more than the 1,000 a single request can return), each exactly once, with the true total on every page, newest first",
  seen.size === 1230 && pages === 25 && totals.size === 1 && [...totals][0] === "1230" && first.length === 50 && new Date(first[0].date_visited).getTime() >= new Date(first[49].date_visited).getTime(), `${seen.size} ${pages} ${[...totals]}`);

// 3. search, dates, visit type, status, consultant, sort: all done by the database, and the total follows them
const byId = await page(COUNSELOR, { search: IDS[6].toLowerCase() }), pct = await page(COUNSELOR, { search: "100%" }), under = await page(COUNSELOR, { search: "a_b" });
const ranged = await page(COUNSELOR, { from: "2026-10-01", to: "2026-10-31", limit: 500 });
const combo = await page(COUNSELOR, { visit: ["Office"], status: ["Regular"], who: [OTHER], limit: 500 });
const nameAsc = (await page(COUNSELOR, { sort: "name", dir: "asc", limit: 100 })).rows, nameDesc = (await page(COUNSELOR, { sort: "name", dir: "desc", limit: 100 })).rows;
const expectNames = async dir => (await q(`select r.id from scholar_counseling_records r join scholars s on s.scholar_id_number = r.scholar_id_number order by lower(s.last_name) ${dir}, lower(s.first_name) ${dir}, r.date_visited desc, r.created_at desc, r.id limit 100`)).map(r => r.id);
const sameIds = (a, b) => a.length === b.length && a.every((x, i) => x.id === b[i]);
const expectCombo = Number((await q("select count(*)::int n from scholar_counseling_records where visit_type = 'Office' and status = 'Regular' and consulted_by = $1", [OTHER]))[0].n);
const expectRange = Number((await q("select count(*)::int n from scholar_counseling_records where date_visited between '2026-10-01' and '2026-10-31'"))[0].n);
check("3 the search (Scholar ID or name, any capitals), the date range, the visit type, the status, the consultant and the sort all work in the database and the total follows them; a '%' or '_' typed in the search is just a letter, not 'match everything'",
  byId.ok && byId.rows.length > 0 && byId.rows.every(x => x.scholar_id_number === IDS[6]) && Number(byId.rows[0].total_count) === byId.rows.length && pct.rows.length === 0 && under.rows.length === 0
  && Number(ranged.rows[0].total_count) === expectRange && ranged.rows.every(x => new Date(x.date_visited).toISOString().slice(0, 7) === "2026-10") && combo.rows.length === expectCombo && expectCombo > 0 && combo.rows.every(x => x.visit_type === "Office" && x.status === "Regular" && x.consulted_by_id === OTHER)
  && sameIds(nameAsc, await expectNames("asc")) && sameIds(nameDesc, await expectNames("desc")) && nameAsc[0].id !== nameDesc[0].id, `${expectRange} ${ranged.rows?.[0]?.total_count} | ${expectCombo} ${combo.rows?.length}`);

// 4. the export reads page after page (500 at a time) and is written to the export log once, when it starts, with its filters
const logsBefore = Number((await q("select count(*)::int n from renewal_export_log where what = 'consultation daily records'"))[0].n);
const got = []; for (let off = 0; ; off += 500) { const r = await page(COUNSELOR, { visit: ["Office"], offset: off, limit: 500, log: true }); if (!r.ok || r.rows.length === 0) break; got.push(...r.rows); if (r.rows.length < 500) break; }
const logs = await q("select by_label, row_count, filter_text from renewal_export_log where what = 'consultation daily records' order by at desc limit 3");
check("4 the export reads all the records that match (410 Office visits, in pages of 500), and writes ONE line to the export log (who, how many, which filters), not one per page",
  got.length === 410 && new Set(got.map(x => x.id)).size === 410 && logs.length === logsBefore + 1 && logs[0].row_count === 410 && /visit type Office/.test(logs[0].filter_text), `${got.length} ${JSON.stringify(logs[0])}`);

// 5. the consultants list, the indexes, and the undo (the old function and the records stay)
const who = (await attempt(COUNSELOR, "select * from public.scholar_counseling_consultants()")).rows ?? [];
const idx = (await q("select count(*)::int n from pg_indexes where indexname in ('scholar_counseling_records_date_page_idx', 'scholar_counseling_records_consulted_by_idx', 'scholar_counseling_records_visit_type_idx', 'scholar_counseling_records_status_idx', 'scholars_lower_scholar_id_idx')"))[0].n;
await db.exec(read(UNDO));
const gone = (await q("select to_regprocedure('public.scholar_counseling_daily_records_page(text,date,date,text[],text[],uuid[],text,text,integer,integer,boolean)') a, to_regprocedure('public.scholar_counseling_daily_records(text)') b"))[0];
const idxAfter = (await q("select count(*)::int n from pg_indexes where indexname like 'scholar_counseling_records_%_idx' and indexname <> 'scholar_counseling_records_scholar_id_idx' and indexname <> 'scholar_counseling_records_date_visited_idx'"))[0].n;
check("5 the Consultant filter lists the two staff who logged visits, the five indexes exist, and after the undo the new function and indexes are gone while the older function and all 1,230 records stay",
  who.length === 2 && Number(idx) === 5 && gone.a === null && gone.b !== null && Number(idxAfter) === 0 && Number((await q("select count(*)::int n from scholar_counseling_records"))[0].n) === 1230, `${who.length} ${idx} ${JSON.stringify(gone)} ${idxAfter}`);
console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
