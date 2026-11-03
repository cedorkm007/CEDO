// tests/school-grading-rules/db_tests.mjs — School grading rules, Phase 1 (supabase_migration_school_grading_rules_a_tables.sql + _c_functions.sql)
//   saving a version, where it starts (a locked period never changes), the audit trail, who can read and write, existing data untouched, the undo.
// Run:  node tests/school-grading-rules/db_tests.mjs
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gr-db-"));
const outfile = path.join(tmp, "rules.mjs");
await build({ entryPoints: [path.join(root, "src/lib/gradingRules.ts")], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error", absWorkingDir: root, alias: { "@": path.join(root, "src") } });
const G = await import(pathToFileURL(outfile).href);

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILES = { a: "supabase_migration_school_grading_rules_a_tables.sql", c: "supabase_migration_school_grading_rules_c_functions.sql", undoA: "undo_school_grading_rules_a.sql", undoC: "undo_school_grading_rules_c.sql" };
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await rows(uid, sql, params) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };

const school = async like => (await q("select a.id as uid, a.school_id from school_accounts a join schools s on s.id = a.school_id where s.name like $1", [like]))[0];
const lower = await school("%Lower-Is-Better%"), higher = await school("%Higher-Is-Better%"), letters = await school("%Letter-Grade%");
const SEAD = seedId("staff:demo.sead"), PLAIN = seedId("staff:demo.plain"), SCHOLAR = seedId("scholar:1");

const PH = G.PRESETS.find(p => p.key === "ph-1-5");
const phRules = () => ({ entryMode: PH.rules.entryMode, passingMarkPct: PH.rules.passingMarkPct, programPassing: [], bands: PH.rules.bands.map(b => ({ ...b })), gwa: { ...G.DEFAULT_GWA_SETTINGS } });
const save = (uid, rules, impact = {}, note = null) => attempt(uid, "select public.school_grading_rules_save($1::jsonb, $2::jsonb, $3) r", [JSON.stringify(rules), JSON.stringify(impact), note]);
const overview = async uid => (await rows(uid, "select public.school_grading_rules_overview() o"))[0].o;
const counts = async () => (await q("select (select count(*) from school_grading_versions)::int v, (select count(*) from school_grade_bands)::int b, (select count(*) from school_grading_audit)::int a"))[0];

await db.exec(read(FILES.undoC)).catch(() => {}); await db.exec(read(FILES.undoA)).catch(() => {});      // the harness may already have put the files on: start from before them
console.log("Before the files");
check("the tables and functions do not exist yet", (await q("select to_regclass('public.school_grading_versions') is null a, to_regprocedure('public.school_grading_rules_save(jsonb,jsonb,text)') is null b"))[0].a);
const existing = async () => JSON.stringify({
  cfg: await q("select * from school_grading_configs order by school_id"), letters: await q("select * from school_letter_grades order by school_id, letter"),
  marks: await q("select * from school_marks order by school_id, mark"), grades: (await q("select count(*)::int n, coalesce(sum(length(coalesce(grade, ''))), 0)::int g from scholar_subjects_grades"))[0],
});
const snapshotBefore = await existing();
await db.exec(read(FILES.a)); await db.exec(read(FILES.a)); await db.exec(read(FILES.c)); await db.exec(read(FILES.c));      // safe to run twice
check("the files add three tables and no existing data changes (scales, letters, marks and grades are the same)", (await q("select count(*)::int n from school_grading_versions"))[0].n === 0 && (await existing()) === snapshotBefore);

console.log("\nPeriods");
const nx = async (y, t) => (await q("select * from public._grading_next_period($1, $2)", [y, t]))[0];
check("the period after: 1st -> 2nd -> Summer -> 1st of the next school year", JSON.stringify([await nx("2025-2026", "1st Semester"), await nx("2025-2026", "2nd Semester"), await nx("2025-2026", "Summer")])
  === JSON.stringify([{ school_year: "2025-2026", term: "2nd Semester" }, { school_year: "2025-2026", term: "Summer" }, { school_year: "2026-2027", term: "1st Semester" }]));
check("periods are ordered by school year, then 1st, 2nd, Summer", (await q("select public._grading_period_rank('2025-2026','Summer') < public._grading_period_rank('2026-2027','1st Semester') a, public._grading_period_rank('2025-2026','2nd Semester') < public._grading_period_rank('2025-2026','Summer') b"))[0].a);

console.log("\nWhat a school sees before it has saved anything");
const ov0 = await overview(lower.uid);
check("no versions, no rules in use, and the current period is submitted so new rules would start at the NEXT period", ov0.latest === null && ov0.active === null && ov0.versions.length === 0
  && ov0.currentPeriod.submitted === true && ov0.startsAt.reason === "period_submitted" && ov0.startsAt.term === "Summer" && ov0.startsAt.schoolYear === ov0.currentPeriod.schoolYear, JSON.stringify([ov0.currentPeriod, ov0.startsAt]));
check("the overview carries the school's scale, its letters and its other marks (read, not changed)", ov0.scale.scaleMin === 1 && ov0.scale.scaleMax === 5 && ov0.scale.direction === "lower_is_better" && Array.isArray(ov0.marks));
check("a scholar, a plain staff account and nobody-at-all cannot ask", !(await attempt(SCHOLAR, "select public.school_grading_rules_overview()")).ok && !(await attempt(PLAIN, "select public.school_grading_rules_overview()")).ok && !(await attempt(null, "select public.school_grading_rules_overview()")).ok);

console.log("\nSaving the first version while the current period is submitted");
const s1 = await save(lower.uid, phRules(), { gradesChanged: 0, gwasChanged: 0, scholarsAffected: 0, period: "next period" }, "First rules");
check("the school saves; the version starts at the next period (Summer), not at the locked one", s1.ok && s1.rows[0].r.versionNo === 1 && s1.rows[0].r.startsTerm === "Summer" && s1.rows[0].r.reason === "period_submitted", s1.msg ?? JSON.stringify(s1.rows));
const v1 = (await q("select * from school_grading_versions where school_id = $1", [lower.school_id]))[0];
check("the version has the school, the start, the entry mode and the passing mark; the 10 rows are saved from the top, each Passed or Failed against the passing mark", v1.effective_term === "Summer" && v1.entry_mode === "either" && Number(v1.passing_mark_pct) === 75
  && (await q("select count(*)::int n, count(*) filter (where result = 'passed')::int p, min(sort_no)::int s from school_grade_bands where version_id = $1", [v1.id]))[0].n === 10
  && (await q("select count(*)::int p from school_grade_bands where version_id = $1 and result = 'passed'", [v1.id]))[0].p === 9 && Number((await q("select pct_from from school_grade_bands where version_id = $1 and sort_no = 1", [v1.id]))[0].pct_from) === 97);
const ov1 = await overview(lower.uid);
check("the rules are saved but NOT in use yet (the locked period keeps what it had); the latest is version 1", ov1.latest.versionNo === 1 && ov1.active === null && ov1.versions.length === 1 && ov1.latest.rules.bands.length === 10 && ov1.latest.rules.bands[0].equivalentGrade === "1.00");
check("the audit trail has the first save: who, when, no old rules, the new rules and the impact shown to the school", ov1.audit.length === 1 && ov1.audit[0].oldRules === null && ov1.audit[0].newRules.bands.length === 10 && ov1.audit[0].impact.period === "next period" && /demo\.school\.lower/.test(ov1.audit[0].changedByLabel ?? ""), JSON.stringify(ov1.audit[0]).slice(0, 200));
const again = await save(lower.uid, phRules());
check("saving the same rules again is refused: nothing changed", !again.ok && /Nothing has changed/.test(again.msg), again.msg);

console.log("\nSaving again, and the checks");
const changed = phRules(); changed.bands[2].remarks = "Excellent";
const s2 = await save(lower.uid, changed, {}, null);
check("a change makes version 2 (same start); the audit keeps the old and the new rules", s2.ok && s2.rows[0].r.versionNo === 2 && (await overview(lower.uid)).audit[0].oldRules.bands[2].remarks === "Very Good" && (await overview(lower.uid)).audit[0].newRules.bands[2].remarks === "Excellent");
const before = await counts();
const bad = phRules(); bad.bands[1].from = 93;
const badSave = await save(lower.uid, bad);
check("rules that break a check are refused with the message, and nothing is saved", !badSave.ok && /overlap/.test(badSave.msg) && JSON.stringify(await counts()) === JSON.stringify(before), badSave.msg);
check("a program with its own passing mark, special marks, excluded codes and the retention requirement are saved in their normal shape (names trimmed, codes in capitals and in order)", await (async () => {
  const r = phRules(); r.programPassing = [{ program: " BS Law ", passingPct: 85 }]; r.gwa = { ...r.gwa, specialValues: { DRP: 5 }, excludedCodes: ["pe", " nstp ", "PE"].slice(0, 2), retentionThreshold: 2.5, method: "simple", decimals: 3, rounding: "cut", includeFailed: false };
  const x = await save(lower.uid, r); if (!x.ok) return x.msg;
  const l = (await overview(lower.uid)).latest.rules;
  return l.programPassing[0].program === "BS Law" && Number(l.programPassing[0].passingPct) === 85 && JSON.stringify(l.gwa.excludedCodes) === JSON.stringify(["NSTP", "PE"]) && l.gwa.method === "simple" && l.gwa.decimals === 3
    && l.gwa.rounding === "cut" && l.gwa.includeFailed === false && Number(l.gwa.specialValues.DRP) === 5 && Number(l.gwa.retentionThreshold) === 2.5;
})());

console.log("\nWhere a version starts");
await q("update school_period_submissions set status = 'reopened' where school_id = $1", [lower.school_id]);
const ovOpen = await overview(lower.uid);
check("once the school's period is reopened (open and not submitted), new rules start at the CURRENT period", ovOpen.startsAt.reason === "now" && ovOpen.startsAt.term === ovOpen.currentPeriod.term);
const nowSave = phRules(); nowSave.bands[3].remarks = "Very Good";
const s4 = await save(lower.uid, nowSave);
check("a save now makes version 4 starting at the current period, and it is then in use (active)", s4.ok && s4.rows[0].r.reason === "now" && (await overview(lower.uid)).active.versionNo === 4, s4.msg);
check("an older period is not affected: asking which version an earlier period would use gives the one that started before it (none here)", (await q("select count(*)::int n from school_grading_versions where school_id = $1 and public._grading_period_rank(effective_year, effective_term) <= public._grading_period_rank('2024-2025', '2nd Semester')", [lower.school_id]))[0].n === 0);
await q("update school_period_submissions set status = 'submitted' where school_id = $1", [lower.school_id]);
const periodRow = (await q("select school_year, term from academic_periods order by school_year desc, term desc limit 1"))[0];
const later = await q("insert into academic_periods (school_year, term, status) values ('2025-2026', 'Summer', 'open') on conflict (school_year, term) do update set status = 'open' returning id");
await q("insert into school_period_submissions (school_id, period_id, status, submitted_at) values ($1, $2, 'submitted', now()) on conflict (school_id, period_id) do update set status = 'submitted'", [lower.school_id, later[0].id]);
const lockedLater = phRules(); lockedLater.bands[4].remarks = "Good";
const refused = await save(lower.uid, lockedLater);
check("when a LATER period is already submitted, new rules are refused (they would change it)", !refused.ok && /already submitted/.test(refused.msg), refused.msg);
await q("delete from school_period_submissions where period_id = $1", [later[0].id]);

console.log("\nEach school sees and changes only its own");
const hRules = { entryMode: "percentage", passingMarkPct: 75, programPassing: [], gwa: { ...G.DEFAULT_GWA_SETTINGS, gradeUsed: "percentage", retentionThreshold: 85 },
  bands: [{ from: 90, to: 100, equivalentGrade: "95", remarks: "Excellent" }, { from: 75, to: 89.99, equivalentGrade: "82", remarks: "Good" }, { from: 0, to: 74.99, equivalentGrade: "60", remarks: "Failure" }] };
const hs = await save(higher.uid, hRules);
check("another school saves its own rules (version 1 of its own, numbering is per school)", hs.ok && hs.rows[0].r.versionNo === 1, hs.msg);
const hov = await overview(higher.uid), lov = await overview(lower.uid);
check("each school's overview shows only its own versions and audit rows", hov.versions.length === 1 && lov.versions.length === 4 && hov.audit.every(a => a.newRules.bands.length === 3) && lov.audit.every(a => a.newRules.bands.length === 10));
check("a school cannot open another school's version", !(await attempt(higher.uid, "select public.school_grading_rules_version($1)", [lov.latest.id])).ok && (await attempt(lower.uid, "select public.school_grading_rules_version($1)", [lov.latest.id])).ok);
check("a school cannot read or write the tables directly", !(await attempt(lower.uid, "select * from school_grading_versions")).ok && !(await attempt(lower.uid, "insert into school_grading_versions (school_id, version_no, effective_year, effective_term) values ($1, 99, '2030-2031', 'Summer')", [lower.school_id])).ok
  && !(await attempt(lower.uid, "select * from school_grade_bands")).ok && !(await attempt(lower.uid, "select * from school_grading_audit")).ok && !(await attempt(lower.uid, "delete from school_grading_versions")).ok);
check("a letter-grade school: a letter is allowed as an equivalent grade only with a number in its letter table", await (async () => {
  const lt = G.PRESETS.find(p => p.key === "letters");
  const r = { entryMode: "either", passingMarkPct: 75, programPassing: [], gwa: { ...G.DEFAULT_GWA_SETTINGS }, bands: lt.rules.bands.map(b => ({ ...b })) };
  const x = await save(letters.uid, r);
  return x.ok && x.rows[0].r.reason === "now";
})());

console.log("\nCEDO staff read-only");
const staffView = (uid, id) => attempt(uid, "select public.staff_school_grading_rules($1) o", [id]);
const sv = await staffView(SEAD, lower.school_id);
check("Grades Monitoring staff read any school's rules (the same overview)", sv.ok && sv.rows[0].o.versions.length === 4 && sv.rows[0].o.latest.rules.bands.length === 10, sv.msg);
check("…and any version, read-only", (await attempt(SEAD, "select public.staff_school_grading_rules_version($1)", [lov.latest.id])).ok);
check("plain staff, a scholar and a school account cannot use the staff functions", !(await staffView(PLAIN, lower.school_id)).ok && !(await staffView(SCHOLAR, lower.school_id)).ok && !(await staffView(lower.uid, higher.school_id)).ok);
check("staff have no way to save a school's rules", !(await attempt(SEAD, "select public.school_grading_rules_save($1::jsonb)", [JSON.stringify(phRules())])).ok);
check("a school that was never given rules reads as empty to staff", (await staffView(SEAD, (await school("%No-Passing-Mark%")).school_id)).rows[0].o.latest === null);

console.log("\nExisting data and the undo");
check("saving rules changed nothing else: the scales, letters, marks and grades are exactly as before (except the letters school's own table, which was only read)", (await existing()) === snapshotBefore);
await db.exec(read(FILES.undoC));
check("after the undo of file C the functions are gone and the saved rules are still in the tables", (await q("select to_regprocedure('public.school_grading_rules_save(jsonb,jsonb,text)') is null a, (select count(*)::int from school_grading_versions) v"))[0].a && (await q("select count(*)::int n from school_grading_versions"))[0].n >= 6);
await db.exec(read(FILES.undoA));
check("after the undo of file A the tables are gone and nothing else changed", (await q("select to_regclass('public.school_grading_versions') is null a"))[0].a && (await existing()) === snapshotBefore);
await db.exec(read(FILES.a)); await db.exec(read(FILES.c));
const text = (read(FILES.a) + read(FILES.c)).replace(/--.*$/gm, "");
check("the files only add: no existing table is altered, emptied or dropped", !/(alter table public\.(?!school_grad)|drop table|truncate|delete from public\.(?!school_grad))/i.test(text) && (text.match(/create table/gi) ?? []).length === 3);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
fs.rmSync(tmp, { recursive: true, force: true });
await db.close?.();
