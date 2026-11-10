// tests/documents-for-failures/db_tests.mjs — one or two failed subjects now need the letter from the dean, the study plan and the clearance, like an INC (5 checks, short on purpose)
// Run:  node tests/documents-for-failures/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const NEW = "supabase_migration_documents_for_failures.sql", UNDO = "undo_documents_for_failures.sql";
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
const recOf = async s => (await q("select * from renewal_records where scholar_id_number = $1 order by created_at desc limit 1", [s]))[0];
const docs = async s => { const r = await recOf(s); const e = (await q("select public._renewal_evaluate($1, $2, $3) e", [s, r.school_year, r.term]))[0].e; return e.required_documents ?? []; };
const kinds = async s => (await docs(s)).map(d => d.kind).sort().join();
const ALL = "clearance,inc_letter,study_plan";

console.log("Documents for failed subjects");
const b = await recOf("TEST-0035"), c = await recOf("TEST-0041");
check("1 one failed subject (rule B): the letter from the dean, the study plan and the clearance are needed, and the letter is called 'Letter from your dean'", b.rule_code === "B" && await kinds("TEST-0035") === ALL && (await docs("TEST-0035")).some(d => d.label === "Letter from your dean"), await kinds("TEST-0035"));
check("2 two or more failed subjects (rule C): the same three documents are needed too", c.rule_code === "C2" && await kinds("TEST-0041") === ALL, `${c.rule_code} ${await kinds("TEST-0041")}`);
check("3 an INC still needs the three (as before), and a scholar with everything passed needs none", await kinds("TEST-0027") === ALL && await kinds("TEST-0046") === "");

// the application is refused without the documents when a typed grade is a failure
const win = (await q(`select w.* from renewal_windows w order by (select count(*) from renewal_records r where r.window_id = w.id) desc limit 1`))[0];
await q("update renewal_windows set testers = null, school_ids = null, opens_on = current_date - 3, closes_on = current_date + 20, late_allowed = true where id = $1", [win.id]).catch(() => {});
const basis = (await q("select * from public._renewal_basis($1, $2)", [win.school_year, win.term]))[0];
const LETTERS = (await q("select id from schools where name like '%Letter-Grade%'"))[0].id;
await q("insert into academic_periods (school_year, term, status) values ($1, $2, 'open') on conflict (school_year, term) do nothing", [basis.basis_school_year, basis.basis_term]);
await q("delete from school_period_submissions where school_id = $1", [LETTERS]);
const S = (await q("select s.scholar_id_number s from scholars s where s.school_id = $1 and s.status not in ('Removed', 'On leave') and not exists (select 1 from renewal_records r where r.scholar_id_number = s.scholar_id_number and r.school_year = $2 and r.term = $3) order by 1 limit 1", [LETTERS, win.school_year, win.term]))[0].s;
const lines = JSON.stringify([{ code: "S1", subject: "One", units: 3, grade: "F" }]);
const files = JSON.stringify([{ path: `${S}/${win.id}/grade-entries/0-s.png`, name: "s.png", mime: "image/png", size: 1234 }]);
const apply = docsJson => attempt(uidOf(S), "select public.renewal_apply($1, 'School', 'Program', '2nd Year', '', false, $2::jsonb, $3::jsonb, true, $4::jsonb) id", [win.id, lines, files, docsJson]);
const outcome = (await q("select public._grade_outcome($1, 'F') o", [LETTERS]))[0].o;
const refused = await apply("[]");
const wrongDocs = JSON.stringify(["inc_letter", "study_plan", "clearance"].map(k => ({ kind: k, path: `${S}/${win.id}/inc-docs/${k}/x.pdf`, name: "x.pdf", mime: "application/pdf", size: 10 })));
check("4 a typed failing grade without the three documents is refused ('You have a failed subject ...'); with them the application goes through", (outcome === "failed") && !refused.ok && /You have a failed subject.*letter from your dean/.test(refused.msg) && (await apply(wrongDocs)).ok, `${outcome} ${refused.msg}`);
await db.exec(read(UNDO));
check("5 after the undo only the study plan is needed for one failed subject, and two failed subjects need none (as before)", await kinds("TEST-0035") === "study_plan" && await kinds("TEST-0041") === "");

console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
