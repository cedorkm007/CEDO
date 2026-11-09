// tests/self-grades-units/db_tests.mjs — scholar manual entry of grades: the most units one subject can have is 20, not 12 (5 checks, kept short on purpose)
// Run:  node tests/self-grades-units/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

const outfile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sgu-")), "r.mjs");
await build({ entryPoints: ["src/lib/renewal.ts"], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error", alias: { "@": path.resolve("src") } });
const V = await import(pathToFileURL(outfile).href);
let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
await db.exec(read("undo_entered_grades_e.sql"));      // the later "grades must be in before applying" rule has its own test
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await as(uid, async tx => (await tx.query(sql, params)).rows) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
const uidOf = s => seedId(`scholar:${Number(s.split("-")[1])}`);
const win = (await q(`select w.* from renewal_windows w order by (select count(*) from renewal_records r where r.window_id = w.id) desc limit 1`))[0];
await q("update renewal_windows set testers = null where id = $1", [win.id]);
await q("update renewal_windows set school_ids = null where id = $1", [win.id]).catch(() => {});
await q("update renewal_windows set opens_on = current_date - 3, closes_on = current_date + 20, late_allowed = true where id = $1", [win.id]);
const Y = win.school_year, T = win.term;
const basis = (await q("select * from public._renewal_basis($1, $2)", [Y, T]))[0];
const NEWFILE = "supabase_migration_self_grades_max_units_20.sql", UNDO = "undo_self_grades_max_units_20.sql";
await db.exec(read("supabase_migration_sdp_reconsideration_a_tables.sql")).catch(() => {});
const LETTERS = (await q("select id from schools where name like '%Letter-Grade%'"))[0].id;
await q("insert into academic_periods (school_year, term, status) values ($1, $2, 'open') on conflict (school_year, term) do nothing", [basis.basis_school_year, basis.basis_term]);
const PERIOD = (await q("select id from academic_periods where school_year = $1 and term = $2", [basis.basis_school_year, basis.basis_term]))[0].id;
await q("delete from school_period_submissions where school_id = $1 and period_id = $2", [LETTERS, PERIOD]);
const scholars = (await q("select scholar_id_number s from scholars where school_id = $1 and status not in ('Removed', 'On leave') order by 1", [LETTERS])).map(r => r.s);
const ready = [];
for (const s of scholars) {
  if ((await q("select count(*)::int n from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [s, Y, T]))[0].n === 0) { const r = await attempt(uidOf(s), "select public.renewal_apply($1, 'School', 'Program', '2nd Year', '') id", [win.id]); if (!r.ok) continue; }
  ready.push(s);
}
if (ready.length < 3) throw new Error("the demo has too few scholars to test with");
await db.exec(read(NEWFILE)); await db.exec(read(NEWFILE));      // twice: safe
const rec = async s => (await q("select * from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [s, Y, T]))[0];
const files = (s, r) => JSON.stringify([{ path: `${s}/${r.id}/grade-entries/0-shot.png`, name: "shot0.png", mime: "image/png", size: 12345 }]);
const lines = units => JSON.stringify([{ code: "SUBJ1", subject: "Subject 1", units, grade: "A" }]);
const submit = async (s, units) => { const r = await rec(s); return attempt(uidOf(s), "select public.renewal_self_grades_submit($1, $2::jsonb, $3::jsonb, true) id", [r.id, lines(units), files(s, r)]); };

const [A, B, C] = ready;
// kept to 5 checks on purpose (a short run): the website rule, the accepted and refused amounts, the table rule, and the undo
const L = JSON.stringify;
console.log("The scholar's limit is 20");
check("1 the website's own check allows 20 and says 0.5 to 20 beyond it", V.validateSelfGradeLines([{ code: "A", subject: "A", units: "20", grade: "1.0" }]) === null && /0.5 to 20/.test(V.validateSelfGradeLines([{ code: "A", subject: "A", units: "20.5", grade: "1.0" }]) ?? ""));
const r20 = await submit(A, 20), r13 = await submit(B, 13);
check("2 the database accepts 20 and 13 units (13 was refused before)", r20.ok && r13.ok, (r20.msg ?? "") + (r13.msg ?? ""));
const r21 = await submit(C, 20.5), r0 = await submit(C, 0);
check("3 the database refuses 20.5 and 0, saying 0.5 to 20", !r21.ok && !r0.ok && /0.5 to 20/.test(r21.msg) && /0.5 to 20/.test(r0.msg), (r21.msg ?? "") + (r0.msg ?? ""));
const sub = (await q("select id from renewal_self_grade_submissions limit 1"))[0].id;
const ins = u => q("insert into renewal_self_grade_lines (submission_id, subject_code, subject, units, grade) values ($1, 'T', 'T', $2, 'A')", [sub, u]).then(() => true, () => false);
check("4 the table itself accepts exactly 20 and refuses 21", await ins(20) && !(await ins(21)));
// the undo: it refuses while a saved subject has more than 12 units, and once those are gone it puts 12 back; the file then puts 20 back
await db.exec(read(UNDO)).then(() => {}, async () => { await db.exec("rollback"); });
await q("delete from renewal_self_grade_lines where units > 12");
await db.exec(read(UNDO));
const rd = await rec(C), back12 = await attempt(uidOf(C), "select public.renewal_self_grades_submit($1, $2::jsonb, $3::jsonb, true) id", [rd.id, lines(13), files(C, rd)]);
await db.exec(read(NEWFILE));
check("5 the undo puts 12 back (13 refused) and the file puts 20 back", !back12.ok && /0.5 to 12/.test(back12.msg) && (await q("select pg_get_constraintdef(oid) d from pg_constraint where conrelid = 'public.renewal_self_grade_lines'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%units%'"))[0].d.includes("20"));

console.log(`
${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
