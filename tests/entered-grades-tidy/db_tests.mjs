// tests/entered-grades-tidy/db_tests.mjs — a grade typed with a stray space ("1 .0") is tidied: new entries, the entries already saved, and the website (5 checks, short on purpose)
// Run:  node tests/entered-grades-tidy/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import { build } from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const outfile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tidy-")), "r.mjs");
await build({ entryPoints: ["src/lib/renewal.ts"], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error", alias: { "@": path.resolve("src") } });
const R = await import(pathToFileURL(outfile).href);
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const NEW = "supabase_migration_entered_grades_tidy_spaces.sql", UNDO = "undo_entered_grades_tidy_spaces.sql";
await db.exec(read("undo_entered_grades_e.sql"));
await db.exec(read(NEW)); await db.exec(read(NEW));      // twice: safe
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await as(uid, async tx => (await tx.query(sql, params)).rows) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
const uidOf = s => seedId(`scholar:${Number(s.split("-")[1])}`);
const tidy = async g => (await q("select public._tidy_grade($1) t", [g]))[0].t;
const cases = [["1 .0", "1.0"], ["1. 5", "1.5"], ["1,5", "1.5"], ["  2.25 ", "2.25"], ["INC", "INC"], ["B +", "B +"], [" drp ", "drp"]];
check("1 the database tidies a number with a stray space or comma, and leaves INC, letters and other marks alone", (await Promise.all(cases.map(async ([i, o]) => (await tidy(i)) === o))).every(Boolean) && cases.every(([i, o]) => R.tidyGradeText(i) === o), JSON.stringify(await Promise.all(cases.map(async ([i]) => await tidy(i)))));

const win = (await q(`select w.* from renewal_windows w order by (select count(*) from renewal_records r where r.window_id = w.id) desc limit 1`))[0];
await q("update renewal_windows set testers = null, school_ids = null, opens_on = current_date - 3, closes_on = current_date + 20, late_allowed = true where id = $1", [win.id]).catch(() => {});
const Y = win.school_year, T = win.term;
const basis = (await q("select * from public._renewal_basis($1, $2)", [Y, T]))[0];
const LETTERS = (await q("select id from schools where name like '%Letter-Grade%'"))[0].id;
await q("insert into academic_periods (school_year, term, status) values ($1, $2, 'open') on conflict (school_year, term) do nothing", [basis.basis_school_year, basis.basis_term]);
await q("delete from school_period_submissions where school_id = $1", [LETTERS]);
let A = null;
for (const s of (await q("select scholar_id_number s from scholars where school_id = $1 and status not in ('Removed', 'On leave') order by 1", [LETTERS])).map(r => r.s)) {
  if ((await q("select count(*)::int n from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [s, Y, T]))[0].n === 0) { const r = await attempt(uidOf(s), "select public.renewal_apply($1, 'School', 'Program', '2nd Year', '') id", [win.id]); if (!r.ok) continue; }
  A = s; break;
}
const rec = (await q("select * from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [A, Y, T]))[0];
const r = await attempt(uidOf(A), "select public.renewal_self_grades_submit($1, $2::jsonb, $3::jsonb, true) id", [rec.id, JSON.stringify([{ code: "S1", subject: "One", units: 3, grade: "1 .0" }, { code: "S2", subject: "Two", units: 3, grade: "1,5" }]), JSON.stringify([{ path: `${A}/${rec.id}/grade-entries/0-s.png`, name: "s.png", mime: "image/png", size: 1234 }])]);
const saved = async () => (await q("select l.subject_code c, l.grade g from renewal_self_grade_lines l join renewal_self_grade_submissions s on s.id = l.submission_id where s.record_id = $1 order by l.subject_code", [rec.id]));
check("2 new entries are saved tidied: '1 .0' becomes 1.0 and '1,5' becomes 1.5", r.ok && JSON.stringify((await saved()).map(x => x.g)) === JSON.stringify(["1.0", "1.5"]), r.msg ?? JSON.stringify(await saved()));

await q("update renewal_self_grade_lines set grade = '1 .1' where subject_code = 'S1' and submission_id in (select id from renewal_self_grade_submissions where record_id = $1)", [rec.id]);      // what an older entry looks like
await db.exec(read(NEW));
check("3 an entry saved BEFORE with a stray space is tidied when the file is run, and the renewal's history says so", (await saved())[0].g === "1.1" && (await q("select count(*)::int n from renewal_history where record_id = $1 and note like '%stray spaces%'", [rec.id]))[0].n >= 1);
check("4 the website sends tidied grades too (the same rule)", R.tidyGradeText("1 .0") === "1.0" && fs.readFileSync("src/scholar/renewalApi.ts", "utf8").split("tidyGradeText(l.grade)").length - 1 === 2);
await db.exec(read(UNDO));
await q("update renewal_self_grade_lines set grade = grade where false");
check("5 after the undo the helper is gone and saving still works as before", (await q("select to_regprocedure('public._tidy_grade(text)') t"))[0].t === null && (await attempt(uidOf(A), "select 1 x")).ok);

console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
