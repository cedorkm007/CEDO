// tests/grade-warnings/db_tests.mjs — warnings while a scholar types the grades of the renewal: what each says, and the database refusing what the school does not allow (5 checks, short on purpose)
// Run:  node tests/grade-warnings/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import { build } from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const outfile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gw-")), "g.mjs");
await build({ entryPoints: ["src/lib/gradeCheck.ts"], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error" });
const G = await import(pathToFileURL(outfile).href);
const src = rel => fs.readFileSync(rel, "utf8").split("\r\n").join("\n");
const rules = { scaleMin: 1, scaleMax: 5, usesLetterGrades: false, letters: ["A", "B"], marks: ["F", "D/F"] };
const letterRules = { ...rules, usesLetterGrades: true };

check("1 a symbol says which grade and what is allowed; a comma says to use a period (with the corrected grade)",
  /^The grade "A\+" has a symbol that is not allowed\. Use only letters, numbers and a period/.test(G.gradeWarning("A+", rules) ?? "")
  && G.gradeWarning("1,5", rules) === 'The grade "1,5" uses a comma. Write the decimal point as a period (for example 1.5).'
  && /symbol.*not allowed/.test(G.gradeWarning("(1.0)", null) ?? ""));
check("2 a number off the school's scale says so with the scale; 1.1, 5 and '1 .0' are fine; the units must be above 0 and at most 20",
  G.gradeWarning("0.9", rules) === "Grade 0.9 is outside your grading scale (1 to 5)." && G.gradeWarning("5.5", rules) === "Grade 5.5 is outside your grading scale (1 to 5)."
  && ["1.1", "5", "1 .0", "1.25"].every(g => G.gradeWarning(g, rules) === null) && G.gradeWarning("1.2.3", rules) !== null
  && G.unitsWarning("0") === "The units must be a number above 0 and at most 20." && G.unitsWarning("21") !== null && G.unitsWarning("3") === null && G.unitsWarning("x") === "The units must be a number, for example 3 or 1.5.");
check("3 INC, DRP and the school's other marks are fine; a letter is fine only when the school uses letters; anything else lists what the school allows",
  ["INC", "drp", "F", "d/f"].every(g => G.gradeWarning(g, rules) === null) && G.gradeWarning("A", rules) !== null && G.gradeWarning("A", letterRules) === null
  && /is not a grade your school uses\. Use a number from 1 to 5, or one of: A, B, F, D\/F, INC, DRP\./.test(G.gradeWarning("Z", letterRules) ?? ""));

// the database refuses what the school does not allow (same words)
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
await db.exec(read("undo_entered_grades_e.sql"));
await db.exec(read("supabase_migration_entered_grades_school_rules.sql")); await db.exec(read("supabase_migration_entered_grades_school_rules.sql"));      // twice: safe
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
await q("update renewal_windows set testers = null, school_ids = null, opens_on = current_date - 3, closes_on = current_date + 20, late_allowed = true where id = $1", [win.id]).catch(() => {});
const Y = win.school_year, T = win.term;
const basis = (await q("select * from public._renewal_basis($1, $2)", [Y, T]))[0];
const LOWER = (await q("select id from schools where name like '%Lower-Is-Better%'"))[0].id;
await q("insert into academic_periods (school_year, term, status) values ($1, $2, 'open') on conflict (school_year, term) do nothing", [basis.basis_school_year, basis.basis_term]);
await q("delete from school_period_submissions where school_id = $1", [LOWER]);
let A = null;
for (const s of (await q("select scholar_id_number s from scholars where school_id = $1 and status not in ('Removed', 'On leave') order by 1", [LOWER])).map(r => r.s)) {
  if ((await q("select count(*)::int n from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [s, Y, T]))[0].n === 0) { const r = await attempt(uidOf(s), "select public.renewal_apply($1, 'School', 'Program', '2nd Year', '') id", [win.id]); if (!r.ok) continue; }
  A = s; break;
}
if (!A) throw new Error("no scholar to test with");
const rec = (await q("select * from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [A, Y, T]))[0];
const send = grade => attempt(uidOf(A), "select public.renewal_self_grades_submit($1, $2::jsonb, $3::jsonb, true) id", [rec.id, JSON.stringify([{ code: "S1", subject: "One", units: 3, grade }]), JSON.stringify([{ path: `${A}/${rec.id}/grade-entries/0-s.png`, name: "s.png", mime: "image/png", size: 1234 }])]);
const cfg = (await q("select scale_min, scale_max from school_grading_configs where school_id = $1", [LOWER]))[0];
const off = await send("9.0"), unknown = await send("ZZ"), good = await send("1.5");
check("4 the database refuses a grade off the school's scale or not used by the school, with the school's own words; a grade on the scale is accepted",
  !off.ok && new RegExp(`Grade 9\\.0 is outside your grading scale \\(${Number(cfg.scale_min)} to ${Number(cfg.scale_max)}\\)`).test(off.msg) && !unknown.ok && /not on your grading scale/.test(unknown.msg) && good.ok, `${off.msg} | ${unknown.msg} | ${good.msg}`);
const form = src("src/scholar/components/dashboard/SelfGradesForm.tsx"), section = src("src/scholar/components/dashboard/SelfGradesSection.tsx"), panel = src("src/scholar/components/dashboard/RenewalPanel.tsx");
check("5 the form shows each warning under its row as it is typed (naming the subject and the error), a red summary, and Next / Send wait until nothing is flagged",
  form.includes('role="alert"') && form.includes("Subject {i + 1} grade: {issues[i].grade}") && form.includes("Fix the grade") && form.includes("gradeWarning(r.grade, rules)")
  && section.includes("rowsWithWarnings(rows, gradeRules).length > 0") && panel.includes("gradeFormProblem(gRows, gFiles.length, gAck, gradeRules)"));

console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
