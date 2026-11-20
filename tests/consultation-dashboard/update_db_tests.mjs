// tests/consultation-dashboard/update_db_tests.mjs — Main Dashboard update (supabase_migration_consultation_dashboard_all_visits.sql): "Clients Served" counts every consultant's visits, and On Leave / Reconsidered / Removed open
// a list of the scholars (in pages, nothing cut off at 1,000); the undo (5 checks)
// Run:  node tests/consultation-dashboard/update_db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE = "supabase_migration_consultation_dashboard_all_visits.sql", UNDO = "undo_consultation_dashboard_all_visits.sql";
async function as(uid, sql, params = []) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)", [uid, JSON.stringify({ sub: uid, role: "authenticated" })]);
    return (await tx.query(sql, params)).rows;
  });
}
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await as(uid, sql, params) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
await db.exec(read(FILE)); await db.exec(read(FILE));      // twice: safe
const COUNSELOR = seedId("staff:demo.counselor"), PLAIN = seedId("staff:demo.plain"), ADMIN = seedId("staff:demo.admin");
await q("insert into staff_account_tags (staff_id, tag_key) values ($1, 'scholar_counseling') on conflict do nothing", [ADMIN]);
const counts = uid => attempt(uid, "select * from public.scholar_counseling_dashboard_counts()");
const list = (uid, a = {}) => attempt(uid, "select * from public.scholar_counseling_status_scholars_page($1, $2, $3, $4)", [a.status ?? "Removed", a.search ?? "", a.limit ?? 20, a.offset ?? 0]);
const dayPage = (uid, a) => attempt(uid, "select * from public.scholar_counseling_daily_records_page('', $1, $2, null, null, null, 'date', 'desc', 1, 0, false)", [a.from ?? null, a.to ?? null]);

// the data: visits of two consultants on different days (today, the 1st of the month, last month, tomorrow); 1,150 removed scholars + a few on leave and reconsidered
const today = (await q("select (now() at time zone 'Asia/Manila')::date::text d"))[0].d, monthStart = `${today.slice(0, 8)}01`;
const SCH = (await q("select scholar_id_number s from scholars order by scholar_id_number limit 40")).map(r => r.s);
await q("delete from scholar_counseling_records");
await q(`insert into scholar_counseling_records (scholar_id_number, status, consulted_by, date_visited, findings, visit_type)
         select ($1::text[])[(g % 40) + 1], 'Regular', case when g % 3 = 0 then $3::uuid else $2::uuid end,
                (array[$4::date, $5::date, ($5::date - 3), ($4::date + 1)])[(g % 4) + 1], 'DASH-' || g, 'Office' from generate_series(1, 120) g`, [SCH, COUNSELOR, ADMIN, today, monthStart]);
await q("update scholars set status = 'Regular' where status in ('On leave', 'Reconsidered', 'Removed')");
await q("update scholars set status = 'On leave' where scholar_id_number = any ($1::text[])", [SCH.slice(0, 3)]);
await q("update scholars set status = 'Reconsidered' where scholar_id_number = any ($1::text[])", [SCH.slice(3, 5)]);
await q("set session_replication_role = replica");
await q(`insert into scholars (id, scholar_id_number, first_name, last_name, middle_name, birthday, email, contact_no, school, course, status, barangay, year_level, house_unit_no, street, city_municipality, province_region, country, zip_code, emergency_contact_name, emergency_contact_relationship, emergency_contact_number)
         select gen_random_uuid(), 'RM-' || lpad(g::text, 5, '0'), 'RMTEST', 'Gone' || lpad(g::text, 5, '0'), 'T', '2005-05-05', 'rm' || g || '@demo.local', '09170000000', 'Test School', 'BS Test', 'Removed', 'B', '2nd Year', '1', 'S', 'C', 'P', 'Philippines', '0000', 'G', 'Parent', '09170000001'
         from generate_series(1, 1150) g`);
await q("set session_replication_role = origin");

// 1. only consultation staff; a made-up status is refused; one request never gives more than 100
const plain = await list(PLAIN), bad = await list(COUNSELOR, { status: "Regular" }), nul = await attempt(COUNSELOR, "select * from public.scholar_counseling_status_scholars_page(null)"), big = await list(COUNSELOR, { limit: 5000 });
check("1 only consultation staff can open the list; only On leave, Reconsidered, Removed (or Probationary) can be asked for; one request never gives more than 100",
  !plain.ok && /Only the consultation staff/i.test(plain.msg) && !bad.ok && /Choose On leave/i.test(bad.msg) && !nul.ok && big.ok && big.rows.length === 100, `${plain.msg} ${bad.msg} ${big.rows?.length}`);

// 2. Clients Served = every consultant's visits from the 1st to today (the same for every staff member), = the Daily Records total for those dates with no consultant chosen
const cC = (await counts(COUNSELOR)).rows[0], cA = (await counts(ADMIN)).rows[0];
const tab = (await dayPage(COUNSELOR, { from: monthStart, to: today })).rows[0];
const direct = Number((await q("select count(*)::int n from scholar_counseling_records where date_visited between $1 and $2", [monthStart, today]))[0].n);
const mine = Number((await q("select count(*)::int n from scholar_counseling_records where consulted_by = $1 and date_visited between $2 and $3", [COUNSELOR, monthStart, today]))[0].n);
check("2 'Clients Served' is the visits of EVERY consultant from the 1st of the month to today: the same number for every staff member, equal to the Daily Records total for those dates, more than one consultant's own, and the visit tomorrow is not counted",
  Number(cC.clients_served_this_month) === direct && Number(cA.clients_served_this_month) === direct && Number(tab.total_count) === direct && direct > mine && mine > 0, `${cC.clients_served_this_month} ${cA.clients_served_this_month} ${tab.total_count} direct ${direct} mine ${mine}`);

// 3. Removed: 1,150 scholars (more than the 1,000 a single request can return) in pages, each once, in name order, the true total on every page, and it is the dashboard number
const seen = new Set(), totals = new Set(); let pages = 0, last = "", ordered = true;
for (let off = 0; ; off += 100) {
  const r = await list(COUNSELOR, { limit: 100, offset: off });
  if (!r.ok || r.rows.length === 0) break;
  pages++; r.rows.forEach(x => { seen.add(x.scholar_id_number); totals.add(String(x.total_count)); if (x.name.toLowerCase() < last) ordered = false; last = x.name.toLowerCase(); });
  if (r.rows.length < 100) break;
}
const removedNow = Number((await counts(COUNSELOR)).rows[0].removed_count);
check("3 the Removed list gives all 1,150 scholars in pages (more than the 1,000 a single request can return), each once, in name order, with the true total on every page; that total is the number on the dashboard",
  seen.size === 1150 && pages === 12 && totals.size === 1 && [...totals][0] === "1150" && ordered && removedNow === 1150, `${seen.size} ${pages} ${[...totals]} ${ordered} ${removedNow}`);

// 4. On leave and Reconsidered lists equal their dashboard numbers; search by Scholar ID / name (a '%' is just a letter); the row has the scholar's details
const onLeave = await list(COUNSELOR, { status: "On leave" }), recon = await list(COUNSELOR, { status: "Reconsidered" });
const byId = await list(COUNSELOR, { search: "rm-00007" }), byName = await list(COUNSELOR, { search: "gone00123" }), pct = await list(COUNSELOR, { search: "100%" });
check("4 the On leave (3) and Reconsidered (2) lists have the very numbers of the dashboard; the search finds a scholar by Scholar ID or name in any capitals ('%' is just a letter); each row has name, course, year and school",
  Number(cC.on_leave_count) === 3 && onLeave.rows.length === 3 && Number(onLeave.rows[0].total_count) === 3 && Number(cC.reconsidered_count) === 2 && recon.rows.length === 2
  && byId.rows.length === 1 && byId.rows[0].scholar_id_number === "RM-00007" && byName.rows.length === 1 && pct.rows.length === 0 && byId.rows[0].course === "BS Test" && byId.rows[0].school === "Test School" && /Gone00007/.test(byId.rows[0].name),
  `${cC.on_leave_count}/${onLeave.rows.length} ${cC.reconsidered_count}/${recon.rows.length} ${byId.rows.length} ${byName.rows.length}`);

// 5. the undo: Clients Served is the staff member's own again, the list function is gone, no record is touched
const recsBefore = Number((await q("select count(*)::int n from scholar_counseling_records"))[0].n), scBefore = Number((await q("select count(*)::int n from scholars"))[0].n);
await db.exec(read(UNDO));
const after = (await counts(COUNSELOR)).rows[0];
const gone = (await q("select to_regprocedure('public.scholar_counseling_status_scholars_page(text,text,integer,integer)') a, to_regprocedure('public.scholar_counseling_dashboard_counts()') b"))[0];
check("5 after the undo 'Clients Served' is the signed-in staff member's own again, the list function is gone, the dashboard function is still there, and no visit or scholar was touched",
  Number(after.clients_served_this_month) === mine && gone.a === null && gone.b !== null && Number((await q("select count(*)::int n from scholar_counseling_records"))[0].n) === recsBefore && Number((await q("select count(*)::int n from scholars"))[0].n) === scBefore, `${after.clients_served_this_month} vs ${mine} ${JSON.stringify(gone)}`);
console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
