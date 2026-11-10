// tests/entered-grades-symbols/db_tests.mjs — a grade a scholar enters may only have letters, numbers and a period (5 checks, short on purpose)
// Run:  node tests/entered-grades-symbols/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import { build } from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const outfile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sym-")), "r.mjs");
await build({ entryPoints: ["src/lib/renewal.ts"], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error", alias: { "@": path.resolve("src") } });
const R = await import(pathToFileURL(outfile).href);
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const NEW = "supabase_migration_entered_grades_symbols.sql", UNDO = "undo_entered_grades_symbols.sql";
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
const send = grade => attempt(uidOf(A), "select public.renewal_self_grades_submit($1, $2::jsonb, $3::jsonb, true) id", [rec.id, JSON.stringify([{ code: "S1", subject: "One", units: 3, grade }]), JSON.stringify([{ path: `${A}/${rec.id}/grade-entries/0-s.png`, name: "s.png", mime: "image/png", size: 1234 }])]);
const line = (g) => [{ code: "S1", subject: "One", units: "3", grade: g }];

const bad = ["1,5", "A+", "1/2", "(1.0)", "1.0%", "2-3", "1;0"];
const badResults = await Promise.all(bad.map(async g => ({ g, db: await send(g), web: R.validateSelfGradeLines(line(g)) })));
check("1 the database refuses a comma, plus, slash, brackets, percent, dash and semicolon, with a clear message", badResults.every(r => !r.db.ok && /symbol that is not allowed/.test(r.db.msg)), JSON.stringify(badResults.filter(r => r.db.ok || !/symbol/.test(r.db.msg ?? "")).map(r => r.g)));
check("2 the website refuses the same grades before sending, saying to use a period", badResults.every(r => /symbol that is not allowed.*period/.test(r.web ?? "")));
const good = ["1.5", "2.25", "INC", "DRP", "B", "5", "1 .0"];
const goodResults = [];
for (const g of good) goodResults.push({ g, db: await send(g), web: R.validateSelfGradeLines(line(g)) });
check("3 numbers with a period, INC, DRP and plain letters are accepted (and a stray space inside a number is still tidied)", goodResults.every(r => r.db.ok && r.web === null), JSON.stringify(goodResults.filter(r => !r.db.ok || r.web !== null).map(r => [r.g, r.db.msg, r.web])));
check("4 nothing refused was saved (only the last accepted try is on file, tidied to 1.0)", (await q("select l.grade g from renewal_self_grade_lines l join renewal_self_grade_submissions s on s.id = l.submission_id where s.record_id = $1 and s.status in ('pending', 'approved')", [rec.id])).map(x => x.g).join(",") === "1.0");
await db.exec(read(UNDO));
check("5 after the undo the database no longer checks symbols (1,5 is saved again as before)", (await send("1,5")).ok);

console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
