// tests/renewal-multi-windows/db_tests.mjs — SEVERAL renewal windows per term (a different schedule for each school)
//   (supabase_migration_renewal_multi_windows_a_constraint.sql + _b_functions.sql)
// Run:  node tests/renewal-multi-windows/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILES = ["supabase_migration_renewal_window_schools_a_column.sql", "supabase_migration_renewal_window_schools_b_functions.sql", "supabase_migration_renewal_multi_windows_a_constraint.sql", "supabase_migration_renewal_multi_windows_b_functions.sql"];
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await rows(uid, sql, params) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };

// the demo applies the files in the order they were committed; on the real project the order is the one listed here, so they are applied again here, last
for (const f of FILES) await db.exec(read(f));
const EVALUATOR = seedId("staff:demo.evaluator"), COUNSELOR = seedId("staff:demo.counselor");
const ymd = d => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const day = n => { const d = new Date(Date.now() + 8 * 3600 * 1000 + n * 86400000); return d.toISOString().slice(0, 10); };
const school = async key => (await q("select id from schools where name like $1", [`%${key}%`]))[0].id;
const [LOWER, HIGHER, LETTERS, NOPASS] = [await school("Lower-Is-Better"), await school("Higher-Is-Better"), await school("Letter-Grade"), await school("No-Passing")];
const uidOf = s => seedId(`scholar:${Number(s.split("-")[1])}`);
const base = (await q("select * from renewal_windows w order by (select count(*) from renewal_records r where r.window_id = w.id) desc limit 1"))[0];     // 1st Semester 2026-2027, for all schools
const Y = base.school_year, T = base.term;
await q("update renewal_windows set testers = null, school_ids = null where id = $1", [base.id]);
const save = (o = {}) => attempt(EVALUATOR, "select public.renewal_window_save($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9::uuid[]) id",
  [o.id ?? null, o.year ?? Y, o.term ?? T, o.opens ?? day(-1), o.closes ?? day(20), true, o.note ?? "", o.testers ?? null, o.schools ?? null]);
const scholarsOf = async schoolId => (await q("select scholar_id_number s from scholars where school_id = $1 and status not in ('Removed', 'On leave') order by scholar_id_number", [schoolId])).map(r => r.s);
const sees = async s => (await rows(uidOf(s), "select public.renewal_my_overview() o"))[0].o.windows.filter(w => w.window.school_year === Y && w.window.term === T).map(w => w.window.id);
const notApplied = async () => Number((await rows(EVALUATOR, "select public.renewal_dashboard($1, $2) d", [Y, T]))[0].d.totals.not_applied);

console.log("One term, several windows");
const before = await notApplied();
const higherScholars = await scholarsOf(HIGHER), lowerScholars = await scholarsOf(LOWER), lettersScholars = await scholarsOf(LETTERS);
check("the demo has scholars in several schools", higherScholars.length >= 2 && lowerScholars.length >= 2 && lettersScholars.length >= 1);
// a scholar of the Higher school applies in the general window BEFORE that school gets its own window
const earlyBird = higherScholars.find(s => true);
await q("delete from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [earlyBird, Y, T]);
const early = await attempt(uidOf(earlyBird), "select public.renewal_apply($1, 'School', 'Program', '2nd Year', '') r", [base.id]);
check("a scholar of the Higher school applies in the general window (before that school has its own)", early.ok, early.msg);

const wHigher = await save({ schools: [HIGHER], opens: day(0), closes: day(5), note: "Higher school: early schedule" });
check("a second window for the SAME term is accepted when it is for particular schools", wHigher.ok, wHigher.msg);
check("two windows now exist for the term", (await q("select count(*)::int n from renewal_windows where school_year = $1 and term = $2", [Y, T]))[0].n === 2);
const clash = await save({ schools: [HIGHER, LETTERS], opens: day(2), closes: day(9) });
check("a school cannot be in two windows of a term: the message names the school", !clash.ok && /only one window of a term/.test(clash.msg) && /Higher/.test(clash.msg), clash.msg);
const wLetters = await save({ schools: [LETTERS], opens: day(3), closes: day(30), note: "Letter-Grade: later schedule" });
check("another school gets its own window with its own dates", wLetters.ok, wLetters.msg);
const second = await save({ schools: null });
check("a term has only one 'all schools' window", !second.ok && /one "all schools" window/.test(second.msg), second.msg);
const testersToo = await save({ testers: [lowerScholars[0]], schools: [NOPASS] });
check("a testers-only window cannot be added to a term that has other windows", !testersToo.ok && /testers-only window must be the only window/.test(testersToo.msg), testersToo.msg);
const idHigher = wHigher.rows[0].id, idLetters = wLetters.rows[0].id;
check("a window cannot be edited to take a school that is in another window", !(await save({ id: idHigher, schools: [HIGHER, LETTERS], opens: day(0), closes: day(5) })).ok);
check("…and cannot be changed to 'all schools' while another all-schools window exists", !(await save({ id: idHigher, schools: [], opens: day(0), closes: day(5) })).ok);
check("its dates can be edited", (await save({ id: idHigher, opens: day(0), closes: day(6) })).ok && ymd((await q("select closes_on from renewal_windows where id = $1", [idHigher]))[0].closes_on) === day(6));

console.log("\nWho belongs to which window");
const has = async (wid, s) => (await q("select public._renewal_window_has_scholar($1, $2) v", [wid, s]))[0].v;
check("a scholar of the Letter-Grade school is in the Letter-Grade window, not the general one nor the Higher one", await has(idLetters, lettersScholars[0]) && !(await has(base.id, lettersScholars[0])) && !(await has(idHigher, lettersScholars[0])));
check("a scholar of the Lower school (no window of their own) is in the general window only", await has(base.id, lowerScholars[0]) && !(await has(idHigher, lowerScholars[0])) && !(await has(idLetters, lowerScholars[0])));
check("every scholar of the term is still counted exactly once: the 'not applied' total did not change (except for the one who applied)", await notApplied() === before - 1, `${await notApplied()} vs ${before}`);

console.log("\nWhat a scholar sees and can do");
const higherNew = higherScholars.find(s => s !== earlyBird);
check("a scholar of the Higher school sees ONLY their school's window", JSON.stringify(await sees(higherNew)) === JSON.stringify([idHigher]), JSON.stringify(await sees(higherNew)));
check("a scholar of the Lower school sees ONLY the general window", JSON.stringify(await sees(lowerScholars[0])) === JSON.stringify([base.id]));
check("a scholar of the Letter-Grade school sees ONLY theirs, with its own dates", JSON.stringify(await sees(lettersScholars[0])) === JSON.stringify([idLetters]));
check("a Higher-school scholar who applied BEFORE their school got its own window keeps seeing that application, and is not shown a second window to apply in", JSON.stringify(await sees(earlyBird)) === JSON.stringify([base.id]), JSON.stringify(await sees(earlyBird)));
check("each scholar's window row is the only one the database lets them read", (await rows(uidOf(higherNew), "select count(*)::int n from renewal_windows where school_year = $1 and term = $2", [Y, T]))[0].n === 1
  && (await rows(uidOf(lowerScholars[0]), "select count(*)::int n from renewal_windows where school_year = $1 and term = $2", [Y, T]))[0].n === 1
  && (await rows(COUNSELOR, "select count(*)::int n from renewal_windows where school_year = $1 and term = $2", [Y, T]))[0].n === 3);
const wrong = await attempt(uidOf(lowerScholars[1]), "select public.renewal_apply($1, 'School', 'Program', '2nd Year', '') r", [idHigher]);
check("a scholar applying in another school's window is refused, and told it is not open for their school", !wrong.ok && /not open for your school/.test(wrong.msg), wrong.msg);
const general = await attempt(uidOf(higherNew), "select public.renewal_apply($1, 'School', 'Program', '2nd Year', '') r", [base.id]);
check("a scholar of a school that has its own window cannot apply in the general window either", !general.ok && /not open for your school/.test(general.msg), general.msg);
await q("delete from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [higherNew, Y, T]);
const own = await attempt(uidOf(higherNew), "select public.renewal_apply($1, 'School', 'Program', '2nd Year', '') r", [idHigher]);
check("…and CAN apply in their own", own.ok, own.msg);
check("the application is saved in their own window", (await q("select window_id from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [higherNew, Y, T]))[0].window_id === idHigher);
await q("delete from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [higherNew, Y, T]);

console.log("\nAlerts, the dashboard and the School Portal");
await q("delete from scholar_notifications"); await q("delete from renewal_notice_log");
await q("update renewal_windows set opens_on = $2, closes_on = $3 where id = $1", [idHigher, day(0), day(9)]);
await q("update renewal_windows set opens_on = $2, closes_on = $3 where id = $1", [idLetters, day(7), day(30)]);
await q("select public.renewal_notification_jobs(now())");
const alerts = await q("select n.scholar_id_number s, sc.school_id from scholar_notifications n join scholars sc on sc.scholar_id_number = n.scholar_id_number where n.kind = 'window_open'");
check("'Renewal is now open' goes to the scholars of the window that opened today (the Higher school) and nobody else", alerts.length > 0 && alerts.every(a => a.school_id === HIGHER), JSON.stringify(alerts.slice(0, 3)));
await q("delete from scholar_notifications"); await q("delete from renewal_notice_log");
await q("update renewal_windows set closes_on = $2 where id = $1", [idHigher, day(3)]);
await q("select public.renewal_notification_jobs(now())");
const closing = await q("select n.scholar_id_number s, sc.school_id from scholar_notifications n join scholars sc on sc.scholar_id_number = n.scholar_id_number where n.kind = 'window_closing'");
check("'closes in 3 days' goes to the scholars of THAT window who have not applied", closing.length > 0 && closing.every(a => a.school_id === HIGHER) && !closing.some(a => a.s === earlyBird), JSON.stringify(closing.slice(0, 3)));
const dash = (await rows(EVALUATOR, "select public.renewal_dashboard($1, $2) d", [Y, T]))[0].d;
check("the dashboard header shows the first opening to the last closing of the term and how many windows there are", Number(dash.window.windows) === 3 && ymd(dash.window.closes_on) === day(30) && dash.window.is_open === true, JSON.stringify(dash.window));
const schoolUid = async id => (await q("select a.id uid from school_accounts a where a.school_id = $1 limit 1", [id]))[0].uid;
const hw = await rows(await schoolUid(HIGHER), "select * from public.school_renewal_windows()");
const lw = await rows(await schoolUid(LOWER), "select * from public.school_renewal_windows()");
check("the School Portal shows the Higher school only ITS window and the Lower school only the general one", hw.filter(w => w.school_year === Y && w.term === T).length === 1 && ymd(hw.find(w => w.school_year === Y && w.term === T).closes_on) === day(3)
  && lw.filter(w => w.school_year === Y && w.term === T).length === 1 && ymd(lw.find(w => w.school_year === Y && w.term === T).closes_on) === ymd(base.closes_on));

console.log("\nThe test window and old windows");
await q("delete from renewal_windows where id = any ($1)", [[idHigher, idLetters]]);
check("with the extra windows gone, the term has one window again and everybody is back in it", (await q("select count(*)::int n from renewal_windows where school_year = $1 and term = $2", [Y, T]))[0].n === 1 && await has(base.id, lettersScholars[0]) && await has(base.id, higherScholars[0]));
const tw = await save({ id: base.id, testers: [lowerScholars[0]], opens: ymd(base.opens_on), closes: ymd(base.closes_on) });
check("the term's only window can become a testers-only window (as before)", tw.ok, tw.msg);
const afterTest = await save({ schools: [HIGHER], opens: day(0), closes: day(5) });
check("another window cannot be added while the term has a testers-only window (finish the test first)", !afterTest.ok && /testers-only window \(a test\)/.test(afterTest.msg), afterTest.msg);
await save({ id: base.id, testers: [], opens: ymd(base.opens_on), closes: ymd(base.closes_on) });
check("once it is opened to everyone, another window can be added again", (await save({ schools: [HIGHER], opens: day(0), closes: day(5) })).ok);

console.log("\nThe files");
check("file A changes only the windows table (drops the one-per-term rule, adds an index), with a lock limit; file B changes no table and deletes nothing", /lock_timeout = '5s'/.test(read(FILES[2])) && !/\b(truncate|drop table)\b/i.test(read(FILES[2]) + read(FILES[3])) && !/delete from (?!public\.push_outbox)/i.test(read(FILES[2]) + read(FILES[3])) && !/alter table/i.test(read(FILES[3])));
await q("delete from renewal_windows where school_year = $1 and term = $2 and id <> $3", [Y, T, base.id]);
await db.exec(read("undo_renewal_multi_windows_b.sql"));
check("the undo of B puts the old functions back (a term with one window works as before)", !(await q("select 1 from pg_proc where proname = '_renewal_window_has_scholar'")).length && (await notApplied()) >= 0);
await save({ schools: [HIGHER], opens: day(0), closes: day(5) }).catch(() => null);
await db.exec(read(FILES[3]));
await save({ schools: [HIGHER], opens: day(0), closes: day(5) });
const undoA = await attempt(null, "select 1").then(() => db.exec(read("undo_renewal_multi_windows_a.sql")).then(() => ({ ok: true }), e => ({ ok: false, msg: String(e.message) })));
check("the undo of A STOPS (changes nothing) while a term has two windows", !undoA.ok && /STOPPED/.test(undoA.msg), undoA.msg);
await q("delete from renewal_windows where school_year = $1 and term = $2 and id <> $3", [Y, T, base.id]);
await db.exec(read("undo_renewal_multi_windows_a.sql"));
const dup = await attempt(null, "select 1").then(() => q("insert into renewal_windows (school_year, term, opens_on, closes_on) values ($1, $2, current_date, current_date + 3)", [Y, T])).then(() => ({ ok: true }), e => ({ ok: false, msg: String(e.message) }));
check("after the undo of A a second window for the same term is refused by the table again", !dup.ok && /duplicate key|unique/i.test(dup.msg), dup.msg);
await db.exec(read(FILES[2])); await db.exec(read(FILES[3]));
check("they can be put back after the undo, twice is safe", (await db.exec(read(FILES[2])), await db.exec(read(FILES[3])), true) && (await q("select 1 from pg_proc where proname = '_renewal_window_has_scholar'")).length === 1);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
