// tests/consultation-bulk-records/db_tests.mjs — Bulk Add of past Daily Records (supabase_migration_consultation_bulk_records.sql), 5 checks
// Run:  node tests/consultation-bulk-records/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE = "supabase_migration_consultation_bulk_records.sql", UNDO = "undo_consultation_bulk_records.sql";
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
const num = n => `TEST-${String(n).padStart(4, "0")}`;
const run = (uid, rows, dry) => attempt(uid, "select public.counseling_bulk_records($1::jsonb, $2) r", [JSON.stringify(rows), dry]).then(r => r.ok ? { ok: true, r: r.rows[0].r } : r);
const manilaToday = new Date(Date.now() + 8 * 3600e3);
const dayStr = offset => new Date(Date.UTC(manilaToday.getUTCFullYear(), manilaToday.getUTCMonth(), manilaToday.getUTCDate() + offset)).toISOString().slice(0, 10);
const count = async () => Number((await q("select count(*)::int n from scholar_counseling_records where findings like 'BULK-%' or scholar_id_number in ($1, $2)", [num(1), num(2)]))[0].n);
await q("delete from scholar_counseling_records where scholar_id_number in ($1, $2)", [num(1), num(2)]);
const cur2 = (await q("select status from scholars where scholar_id_number = $1", [num(2)]))[0].status;

const rows = [
  { id: num(1), date: "2026-09-15", status: "regular", visit_type: "home visit", failed: "Calculus 2", findings: "BULK-1", recommendations: "Weekly check-in" },        // 1 fine (the words are matched whatever the capitals)
  { id: num(2).toLowerCase(), date: "2026-09-16", status: "", visit_type: "", failed: "", findings: "BULK-2", recommendations: "" },                           // 2 fine: the Scholar ID in small letters, the rest empty
  { id: "NOPE-1", date: "2026-09-15", status: "", visit_type: "", failed: "", findings: "BULK-3", recommendations: "" },                                    // 3 no such scholar
  { id: num(3), date: "2026-02-30", status: "", visit_type: "", failed: "", findings: "BULK-4", recommendations: "" },                                      // 4 not a real date
  { id: num(3), date: dayStr(5), status: "", visit_type: "", failed: "", findings: "BULK-5", recommendations: "" },                                          // 5 in the future
  { id: num(3), date: "2026-09-15", status: "Gold", visit_type: "", failed: "", findings: "BULK-6", recommendations: "" },                                  // 6 not a status
  { id: num(3), date: "2026-09-15", status: "", visit_type: "Phone", failed: "", findings: "BULK-7", recommendations: "" },                                 // 7 not a visit type
  { id: num(1), date: "2026-09-15", status: "regular", visit_type: "home visit", failed: "Calculus 2", findings: "BULK-1", recommendations: "Weekly check-in" },  // 8 the same as row 1
];

// 1. only consultation staff, at most 500 rows
const plain = await run(PLAIN, rows, true);
const many = await run(COUNSELOR, Array.from({ length: 501 }, () => ({ id: num(1), date: "2026-09-15" })), true);
check("1 only consultation staff can use it, and not more than 500 rows at a time", !plain.ok && /Not authorized/.test(plain.msg) && !many.ok && /500/.test(many.msg), `${plain.msg} | ${many.msg}`);

// 2. the check (dry run): each row is told what is wrong, in plain words; nothing is saved
const before = await count();
const dry = (await run(COUNSELOR, rows, true)).r ?? [];
const by = i => dry.find(x => x.i === i);
check("2 a dry run says for each row what is wrong (no such scholar, not a real date, in the future, not a status, not a visit type), says the same row twice is already recorded, and saves nothing",
  dry.length === 8 && by(1).ok && by(1).status === "Regular" && by(1).visit_type === "Home Visit" && by(1).name && by(2).ok && by(2).scholar_id === num(2) && by(2).status === cur2 && by(2).visit_type === "Office"
  && !by(3).ok && /No scholar/.test(by(3).error) && !by(4).ok && /not a valid date/.test(by(4).error) && !by(5).ok && /future/.test(by(5).error) && !by(6).ok && /not one of Regular/.test(by(6).error) && !by(7).ok && /not Office/.test(by(7).error)
  && by(8).ok && by(8).duplicate === true && by(1).duplicate === false && (await count()) === before, JSON.stringify(dry.map(x => [x.i, x.ok, x.duplicate, x.error])));

// 3. the real run adds the good rows, like one added by hand (consulted by the uploader), once
const real = (await run(COUNSELOR, rows, false)).r ?? [];
const saved = await q("select scholar_id_number s, status, visit_type, date_visited::text d, failed_subjects f, findings, staff_recommendations r, consulted_by c from scholar_counseling_records where findings in ('BULK-1', 'BULK-2') order by findings");
check("3 the real run saves the good rows only (2 records), each as one added by hand: the consulted-by is the staff member who uploads, an empty status is the scholar's current status, an empty visit type is Office; the repeated row is skipped",
  saved.length === 2 && saved[0].s === num(1) && saved[0].status === "Regular" && saved[0].visit_type === "Home Visit" && saved[0].d === "2026-09-15" && saved[0].f === "Calculus 2" && saved[0].r === "Weekly check-in" && saved[0].c === COUNSELOR
  && saved[1].s === num(2) && saved[1].status === cur2 && saved[1].visit_type === "Office" && saved[1].c === COUNSELOR && real.filter(x => x.ok && !x.duplicate).length === 2 && real[7].duplicate === true, JSON.stringify(saved));

// 4. uploading the same file again adds nothing
const again = (await run(COUNSELOR, rows, false)).r ?? [];
const afterAgain = await q("select count(*)::int n from scholar_counseling_records where findings in ('BULK-1', 'BULK-2')");
check("4 uploading the same file again adds nothing (the two good rows are now 'already recorded')", again[0].duplicate === true && again[1].duplicate === true && Number(afterAgain[0].n) === 2, JSON.stringify(again.slice(0, 2)));

// 5. undo
await db.exec(read(UNDO));
const gone = (await q("select to_regprocedure('public.counseling_bulk_records(jsonb,boolean)') f"))[0].f;
check("5 after the undo the function is gone and the records that were added stay", gone === null && Number((await q("select count(*)::int n from scholar_counseling_records where findings in ('BULK-1', 'BULK-2')"))[0].n) === 2);
console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
