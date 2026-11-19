// tests/consultation-dashboard/db_tests.mjs — Consultation Tool, Main Dashboard (supabase_migration_consultation_dashboard_paging.sql): every number equals the total of the tab it belongs to, the two lists that grow
// (Scholars to be Consulted, Approved Referrals) in pages with nothing cut off at 1,000, the undo (5 checks)
// Run:  node tests/consultation-dashboard/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE = "supabase_migration_consultation_dashboard_paging.sql", UNDO = "undo_consultation_dashboard_paging.sql";
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
const queue = (uid, off = 0, lim = 20) => attempt(uid, "select * from public.scholar_counseling_queue_page($1, $2)", [lim, off]);
const approved = (uid, a = {}) => attempt(uid, "select * from public.scholar_counseling_approved_page($1, $2, $3)", [a.search ?? "", a.limit ?? 20, a.offset ?? 0]);
const dayPage = (uid, a) => attempt(uid, "select * from public.scholar_counseling_daily_records_page($1, $2, $3, $4, $5, $6, 'date', 'desc', 1, 0, false)", [a.search ?? "", a.from ?? null, a.to ?? null, a.visit ?? null, null, a.who ?? null]);

// the data: scholars of every status, visits of every type on different days (today, the 1st, last month, tomorrow), referrals (30 pending, 5 for reconsideration, 1,150 approved, some of another staff member)
const SCH = (await q("select scholar_id_number s from scholars order by scholar_id_number limit 40")).map(r => r.s);
await q("update scholars set status = 'Probationary' where scholar_id_number = any ($1::text[])", [SCH.slice(0, 6)]);
await q("update scholars set status = 'On leave' where scholar_id_number = any ($1::text[])", [SCH.slice(6, 9)]);
await q("update scholars set status = 'Reconsidered' where scholar_id_number = any ($1::text[])", [SCH.slice(9, 11)]);
await q("update scholars set status = 'Removed' where scholar_id_number = any ($1::text[])", [SCH.slice(11, 12)]);
const today = (await q("select (now() at time zone 'Asia/Manila')::date::text d"))[0].d, monthStart = `${today.slice(0, 8)}01`;
await q("delete from scholar_counseling_records");
await q(`insert into scholar_counseling_records (scholar_id_number, status, consulted_by, date_visited, findings, visit_type)
         select ($1::text[])[(g % 40) + 1], 'Regular', case when g % 3 = 0 then $3::uuid else $2::uuid end,
                (array[$4::date, $5::date, ($5::date - 3), ($4::date + 1)])[(g % 4) + 1], 'DASH-' || g, (array['Office', 'KSB Client', 'Home Visit'])[(g % 3) + 1]
         from generate_series(1, 240) g`, [SCH, COUNSELOR, ADMIN, today, monthStart]);
await q("set session_replication_role = replica");
await q("delete from scholar_counseling_referrals");
const ref = (n, who, status, extra = "") => q(`insert into scholar_counseling_referrals (scholar_id_number, referred_by, referred_to, previous_semester_status, endorsed_for, status, failed_subjects, lacking_grades, remarks, created_at, approved_at ${extra ? ", " + extra.split("=")[0] : ""})
  select ($1::text[])[(g % 40) + 1], $2::uuid, $3::uuid, 'Retained', 'Renewal', $4, '[]'::jsonb, '[]'::jsonb, '', now() - (g * interval '1 minute'), now() - (g * interval '1 minute') ${extra ? ", " + extra.split("=")[1] : ""} from generate_series(1, ${n}) g`, [SCH, ADMIN, who, status]);
await ref(30, COUNSELOR, "pending"); await ref(5, COUNSELOR, "reconsideration_requested"); await ref(1150, COUNSELOR, "approved"); await ref(7, ADMIN, "pending"); await ref(9, ADMIN, "approved");
await q("set session_replication_role = origin");

// 1. only consultation staff
const plain = await Promise.all([counts(PLAIN), queue(PLAIN), approved(PLAIN)]);
check("1 only consultation staff can ask (the numbers, the queue and the approved referrals)",
  plain.every(r => !r.ok && /Only the consultation staff/i.test(r.msg)) && (await counts(COUNSELOR)).ok, JSON.stringify(plain.map(r => r.msg)));

// 2. every number equals the total of the tab it belongs to
const c = (await counts(COUNSELOR)).rows[0];
const probTab = (await attempt(COUNSELOR, "select * from public.scholar_probation_monitoring_page('', null, null, 'name', 'asc', 1, 0)")).rows[0];
const ksbTab = (await dayPage(COUNSELOR, { visit: ["KSB Client"] })).rows[0], homeTab = (await dayPage(COUNSELOR, { visit: ["Home Visit"] })).rows[0];
const servedTab = (await dayPage(COUNSELOR, { from: monthStart, to: today, who: [COUNSELOR] })).rows[0];
const oldQueue = (await attempt(COUNSELOR, "select count(*)::int n from public.scholar_counseling_queue()")).rows[0].n, oldApproved = (await attempt(COUNSELOR, "select count(*)::int n from public.scholar_counseling_approved_referrals()")).rows[0].n;
const direct = async st => Number((await q("select count(*)::int n from scholars where status = $1", [st]))[0].n);
const servedDirect = Number((await q("select count(*)::int n from scholar_counseling_records where consulted_by = $1 and date_visited between $2 and $3", [COUNSELOR, monthStart, today]))[0].n);
check("2 every number on the dashboard is the total of its tab: Probationary = Probationary Monitoring; KSB Client and Home Visited = Daily Records with that Visit type; Clients Served = Daily Records for you from the 1st to today (the visit tomorrow is not counted); Pending + For Reconsideration = Scholars to be Consulted; Approved = Approved Referrals; the status counts = the scholars with that status",
  Number(c.probationary_count) === Number(probTab.total_count) && Number(c.probationary_count) === await direct("Probationary") && Number(c.ksb_client_count) === Number(ksbTab.total_count) && Number(c.home_visited_count) === Number(homeTab.total_count)
  && Number(c.clients_served_this_month) === Number(servedTab.total_count) && Number(c.clients_served_this_month) === servedDirect && servedDirect > 0
  && Number(c.pending_count) === 30 && Number(c.reconsideration_count) === 5 && Number(c.pending_count) + Number(c.reconsideration_count) === oldQueue && Number(c.approved_count) === 1150 && Number(c.approved_count) === oldApproved
  && Number(c.on_leave_count) === await direct("On leave") && Number(c.reconsidered_count) === await direct("Reconsidered") && Number(c.removed_count) === await direct("Removed") && c.me === COUNSELOR && c.month_label === (await q("select to_char($1::date, 'FMMonth YYYY') m", [today]))[0].m,
  `${JSON.stringify(c)} prob ${probTab.total_count} ksb ${ksbTab.total_count} home ${homeTab.total_count} served ${servedTab.total_count}/${servedDirect}`);

// 3. Scholars to be Consulted: pages, oldest first, the same rows in the same order as the old list, only your own
const p1 = (await queue(COUNSELOR, 0)).rows, p2 = (await queue(COUNSELOR, 20)).rows;
const oldIds = (await attempt(COUNSELOR, "select id from public.scholar_counseling_queue()")).rows.map(r => r.id), mineAdmin = (await queue(ADMIN)).rows;
check("3 Scholars to be Consulted comes in pages of 20 with the true total (35: 20 + 15), the very same cases in the very same order (oldest first) as the full list, and each staff member sees only their own",
  p1.length === 20 && p2.length === 15 && p1.every(r => Number(r.total_count) === 35) && JSON.stringify([...p1, ...p2].map(r => r.id)) === JSON.stringify(oldIds) && mineAdmin.length === 7 && Number(mineAdmin[0].total_count) === 7
  && new Date(p1[0].created_at) <= new Date(p1[19].created_at), `${p1.length} ${p2.length} ${mineAdmin.length}`);

// 4. Approved Referrals: nothing cut off at 1,000 (1,150), newest first, with a search
const seen = new Set(), totals = new Set(); let pages = 0, last = null, ordered = true;
for (let off = 0; ; off += 100) {
  const r = await approved(COUNSELOR, { limit: 100, offset: off });
  if (!r.ok || r.rows.length === 0) break;
  pages++; r.rows.forEach(x => { seen.add(x.id); totals.add(String(x.total_count)); if (last && new Date(x.approved_at) > new Date(last)) ordered = false; last = x.approved_at; });
  if (r.rows.length < 100) break;
}
const bySearch = await approved(COUNSELOR, { search: SCH[3].toLowerCase(), limit: 100 }), pct = await approved(COUNSELOR, { search: "100%" }), bigLim = await approved(COUNSELOR, { limit: 5000 });
check("4 Approved Referrals: all 1,150 (more than the 1,000 a single request can return) come in pages, each once, newest first, with the true total on every page; a search by Scholar ID finds them (a '%' is just a letter); one request never gives more than 100",
  seen.size === 1150 && pages === 12 && totals.size === 1 && [...totals][0] === "1150" && ordered && bySearch.rows.length > 0 && bySearch.rows.every(r => r.scholar_id_number === SCH[3]) && Number(bySearch.rows[0].total_count) === bySearch.rows.length
  && pct.rows.length === 0 && bigLim.rows.length === 100, `${seen.size} ${pages} ${[...totals]} ${ordered}`);

// 5. the indexes exist; the undo removes the new functions and indexes only (the older dashboard functions and every record stay)
const idx = Number((await q("select count(*)::int n from pg_indexes where indexname in ('scholar_counseling_referrals_to_status_idx', 'scholar_counseling_referrals_approved_idx')"))[0].n);
const refsBefore = Number((await q("select count(*)::int n from scholar_counseling_referrals"))[0].n), recsBefore = Number((await q("select count(*)::int n from scholar_counseling_records"))[0].n);
await db.exec(read(UNDO));
const gone = (await q("select to_regprocedure('public.scholar_counseling_dashboard_counts()') a, to_regprocedure('public.scholar_counseling_queue_page(integer,integer)') b, to_regprocedure('public.scholar_counseling_approved_page(text,integer,integer)') c, to_regprocedure('public.scholar_counseling_dashboard_summary()') old1, to_regprocedure('public.scholar_counseling_queue()') old2, to_regprocedure('public.scholar_counseling_approved_referrals()') old3"))[0];
const idxAfter = Number((await q("select count(*)::int n from pg_indexes where indexname in ('scholar_counseling_referrals_to_status_idx', 'scholar_counseling_referrals_approved_idx')"))[0].n);
check("5 the two indexes exist; after the undo the new functions and indexes are gone while the older dashboard functions and every referral and visit stay",
  idx === 2 && gone.a === null && gone.b === null && gone.c === null && gone.old1 !== null && gone.old2 !== null && gone.old3 !== null && idxAfter === 0
  && Number((await q("select count(*)::int n from scholar_counseling_referrals"))[0].n) === refsBefore && Number((await q("select count(*)::int n from scholar_counseling_records"))[0].n) === recsBefore, `${idx} ${JSON.stringify(gone)} ${idxAfter}`);
console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
