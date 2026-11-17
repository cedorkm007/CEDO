// tests/renewal-enrollment/db_tests.mjs — the Enrollment confirmation tick box of the Renewed list and the export of the confirmed enrolled (supabase_migration_renewal_enrollment_confirmation.sql), 5 checks
// Run:  node tests/renewal-enrollment/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE = "supabase_migration_renewal_enrollment_confirmation.sql", UNDO = "undo_renewal_enrollment_confirmation.sql";
async function as(uid, sql, params = []) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)", [uid, JSON.stringify({ sub: uid, role: "authenticated" })]);
    return (await tx.query(sql, params)).rows;
  });
}
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await as(uid, sql, params) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
await db.exec(read(FILE)); await db.exec(read(FILE));      // twice: safe
const EVAL = seedId("staff:demo.evaluator"), PLAIN = seedId("staff:demo.plain"), SCHOLAR = seedId("scholar:1");
// the made-up cases are numbered 41 to 47 below; they are the demo scholars TEST-0037 to TEST-0043 (the demo has 45 scholars)
const num = n => `TEST-${String(n - 4).padStart(4, "0")}`;
const Y = "2031-2032", T = "1st Semester";

// made-up renewed scholars (their school, year, names and the day they were renewed are set here, in Philippine time)
const setup = [
  // [n, school, year, last, first, middle, renewed at (UTC offset +08), stage]
  [41, "B College", "2nd Year", "Zeta", "Zed", "Q", "2031-09-10 09:00:00+08", "renewed"],
  [42, "A College", "3rd Year", "Alpha", "Ann", "", "2031-09-10 23:30:00+08", "renewed"],
  [43, "A College", "1st Year", "Beta", "Bea", "M", "2031-09-11 00:10:00+08", "renewed"],
  [44, "A College", "1st Year", "Alpha", "Abe", "R", "2031-09-15 10:00:00+08", "renewed"],
  [45, "A College", "1st Year", "Gamma", "Gus", "", null, "returned"],
  [46, "B College", "2nd Year", "Alpha", "Al", "", "2031-09-12 08:00:00+08", "renewed"],
  [47, "A College", "4th Year", "Delta", "Dee", "", "2031-09-10 10:00:00+08", "renewed"],
];
for (const [n, school, year, last, first, mid, at, stage] of setup) {
  await q("update scholars set school = $2, year_level = $3, last_name = $4, first_name = $5, middle_name = $6, barangay = 'Bgy ' || $4, course = 'BS Test' where scholar_id_number = $1", [num(n), school, year, last, first, mid]);
  await q("delete from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [num(n), Y, T]);
  await q("insert into renewal_records (scholar_id_number, school_year, term, stage, confirmed_at) values ($1, $2, $3, $4, $5)", [num(n), Y, T, stage, at]);
}
const rid = async n => (await q("select id from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [num(n), Y, T]))[0].id;

// 1. only the renewal staff can read or change it, and only a renewed scholar can be ticked
const plainSet = await attempt(PLAIN, "select * from public.renewal_enrollment_set($1, true)", [await rid(41)]);
const scholarStatus = await attempt(SCHOLAR, "select * from public.renewal_enrollment_status($1, $2, $3)", [Y, T, [num(41)]]);
const plainExport = await attempt(PLAIN, "select * from public.renewal_enrollment_export($1, $2)", [Y, T]);
const notRenewed = await attempt(EVAL, "select * from public.renewal_enrollment_set($1, true)", [await rid(45)]);
check("1 only the renewal staff can see or change the box (other staff and scholars are refused), and a scholar who is not renewed yet cannot be ticked",
  !plainSet.ok && /Not authorized/.test(plainSet.msg) && !scholarStatus.ok && !plainExport.ok && !notRenewed.ok && /Only a renewed scholar/.test(notRenewed.msg), `${plainSet.msg} | ${scholarStatus.msg} | ${notRenewed.msg}`);

// 2. tick, tick again (the first who and when are kept), untick
const t1 = (await attempt(EVAL, "select * from public.renewal_enrollment_set($1, true)", [await rid(41)])).rows?.[0];
await q("update renewal_records set enrollment_confirmed_at = enrollment_confirmed_at - interval '1 hour' where id = $1", [await rid(41)]);
const before = (await q("select enrollment_confirmed_at a, enrollment_confirmed_label l from renewal_records where id = $1", [await rid(41)]))[0];
const t2 = (await attempt(EVAL, "select * from public.renewal_enrollment_set($1, true)", [await rid(41)])).rows?.[0];
const after = (await q("select enrollment_confirmed_at a from renewal_records where id = $1", [await rid(41)]))[0];
const t3 = (await attempt(EVAL, "select * from public.renewal_enrollment_set($1, false)", [await rid(41)])).rows?.[0];
const cleared = (await q("select enrollment_confirmed_at a, enrollment_confirmed_by b, enrollment_confirmed_label l from renewal_records where id = $1", [await rid(41)]))[0];
check("2 ticking records who and when; ticking again keeps the first who and when; unticking clears them",
  t1?.confirmed === true && !!t1.confirmed_by && String(before.a) === String(after.a) && t2?.confirmed === true && t3?.confirmed === false && cleared.a === null && cleared.b === null && cleared.l === null, JSON.stringify([t1, before, after, t3, cleared]));

// 3. the list asks where the scholars of its page stand
for (const n of [41, 42, 43, 44, 46]) await attempt(EVAL, "select * from public.renewal_enrollment_set($1, true)", [await rid(n)]);
const st = (await attempt(EVAL, "select * from public.renewal_enrollment_status($1, $2, $3)", [Y, T, [num(41), num(47), num(45)]])).rows ?? [];
const s41 = st.find(r => r.scholar_id_number === num(41)), s47 = st.find(r => r.scholar_id_number === num(47));
check("3 the page of the Renewed list gets each scholar's box (ticked or not, by whom) and the day the scholar was renewed; a scholar who is not renewed is not on the list",
  st.length === 2 && s41?.confirmed === true && !!s41.confirmed_by && !!s41.renewed_at && s47?.confirmed === false && s47.confirmed_by === null && !st.some(r => r.scholar_id_number === num(45)), JSON.stringify(st));

const iso = d => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);      // a date column comes back as a Date
// 4. the export: only the ticked, only the renewed days chosen (Philippine days, both included), by school / year level / name, in pages, written once to the export log
const ex = async (from, to, offset = 0, limit = 1000) => (await attempt(EVAL, "select * from public.renewal_enrollment_export($1, $2, $3, $4, $5, $6)", [Y, T, from, to, offset, limit])).rows ?? [];
const all = await ex(null, null);
const day10 = await ex("2031-09-10", "2031-09-10");
const range = await ex("2031-09-10", "2031-09-11");
const sum = (await attempt(EVAL, "select * from public.renewal_enrollment_summary($1, $2, $3, $4)", [Y, T, "2031-09-10", "2031-09-10"])).rows?.[0];
const logsBefore = Number((await q("select count(*)::int n from renewal_export_log where what = 'allowance endorsement'"))[0].n);
const page1 = await ex(null, null, 0, 2), page2 = await ex(null, null, 2, 2);
const logsAfter = Number((await q("select count(*)::int n from renewal_export_log where what = 'allowance endorsement'"))[0].n);
check("4 the export has only the ticked scholars renewed in the chosen days (a renewal at 23:30 on the last day is in, one at 00:10 the day after is out), ordered by school, year level and name, with the fields the sheet needs; the counts match",
  all.map(r => r.scholar_id_number).join() === [44, 43, 42, 46, 41].map(num).join()
  && day10.map(r => r.scholar_id_number).sort().join() === [41, 42].map(num).join() && range.map(r => r.scholar_id_number).sort().join() === [41, 42, 43].map(num).join()
  && all[0].last_name === "Alpha" && all[0].middle_name === "R" && all[0].year_level === "1st Year" && all[0].program === "BS Test" && all[0].barangay === "Bgy Alpha" && all[0].school === "A College" && iso(all[0].renewed_on) === "2031-09-15"
  && Number(sum.renewed_in_range) === 3 && Number(sum.confirmed_in_range) === 2 && Number(sum.term_confirmed) === 5 && iso(sum.first_renewed) === "2031-09-10" && iso(sum.last_renewed) === "2031-09-15"
  && page1.length === 2 && page2.length === 2 && page1[0].scholar_id_number === num(44) && page2[0].scholar_id_number === num(42) && logsAfter - logsBefore === 1 && (await q("select row_count from renewal_export_log where what = 'allowance endorsement' order by at desc, id limit 1"))[0].row_count === 5,
  `${all.map(r => r.scholar_id_number)} | ${day10.map(r => r.scholar_id_number)} | ${range.map(r => r.scholar_id_number)} | ${JSON.stringify(sum)} | logs ${logsAfter - logsBefore} (asking for page 2 does not add a log line)`);

// 5. undo: the functions go, what was ticked is kept
await db.exec(read(UNDO));
const gone = (await q("select to_regprocedure('public.renewal_enrollment_set(uuid,boolean)') a, to_regprocedure('public.renewal_enrollment_export(text,text,date,date,integer,integer)') b"))[0];
const kept = Number((await q("select count(*)::int n from renewal_records where enrollment_confirmed_at is not null and school_year = $1 and term = $2", [Y, T]))[0].n);
check("5 after the undo the tick box functions are gone, and what was ticked is kept in the records", gone.a === null && gone.b === null && kept === 5, `${JSON.stringify(gone)} ${kept}`);
console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
