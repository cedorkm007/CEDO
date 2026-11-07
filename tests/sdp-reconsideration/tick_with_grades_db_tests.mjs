// tests/sdp-reconsideration/tick_with_grades_db_tests.mjs — a scholar who lacks SDP credits AND must enter grades can tick the SDP reconsideration and apply with both at once
// Run:  node tests/sdp-reconsideration/tick_with_grades_db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
async function as(uid, fn) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)", [uid, JSON.stringify({ sub: uid, role: "authenticated" })]);
    return fn(tx);
  });
}
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await as(uid, async tx => (await tx.query(sql, params)).rows) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };

const win = (await q("select * from renewal_windows where school_year = '2026-2027' and term = '1st Semester'"))[0];
await q("update renewal_windows set testers = null, school_ids = null where id = $1", [win.id]);
await q("update renewal_windows set opens_on = current_date - 3, closes_on = current_date + 20 where id = $1", [win.id]);
const basis = (await q("select * from public._renewal_basis($1, $2)", [win.school_year, win.term]))[0];
// the letters school has NOT uploaded its grades: its scholars must enter them; two of them lack SDP credits
const letters = (await q("select scholar_id_number s from scholars where school like '%Letter-Grade%' and status not in ('Removed','On leave') order by 1")).map(r => r.s);
const [A, B] = letters;
for (const s of [A, B]) await q("delete from sdp_attendance where scholar_id_number = $1 and school_year = $2 and semester = $3", [s, basis.basis_school_year, basis.basis_term]);
const uidOf = s => seedId(`scholar:${Number(s.split("-")[1])}`);
const lines = JSON.stringify([{ code: "MATH1", subject: "Algebra", units: 3, grade: "A" }]);
const files = s => JSON.stringify([{ path: `${s}/${win.id}/grade-entries/0-shot.png`, name: "shot.png", mime: "image/png", size: 1234 }]);
const apply = (s, ask, l = lines) => attempt(uidOf(s), "select public.renewal_apply($1, 'School', 'Program', '2nd Year', '', $2, $3::jsonb, $4::jsonb, true) id", [win.id, ask, l, files(s)]);

console.log("What the form is told");
const pv = (await as(uidOf(A), async tx => (await tx.query("select public.renewal_my_preview($1) p", [win.id])).rows[0].p));
check("the scholar lacks SDP credits, has no request, and the school has not uploaded the grades (so the form asks for the grades; the tick is now offered at once)", pv.sdp.complied === false && pv.sdp.reconsideration === undefined && pv.grades.school_submitted === false && pv.grades_in_form === true && Object.values(pv.sdp.lacking).reduce((n, v) => n + Number(v), 0) > 0, JSON.stringify({ c: pv.sdp.complied, r: pv.sdp.reconsideration ?? null, g: pv.grades.school_submitted }));

console.log("\nApplying with the tick AND the grades together");
check("the order of the two does not matter to the database: nothing is sent without grades (the application is refused)", !(await apply(A, true, "[]")).ok && (await q("select count(*)::int n from renewal_records where scholar_id_number = $1", [A]))[0].n === 0);
const ok = await apply(A, true);
check("ticked + grades entered: the application is accepted", ok.ok, ok.msg);
check("the application, the entered grades (waiting for the Grades Approver) and the SDP reconsideration request (waiting for the approver) were all made", (await q("select count(*)::int n from renewal_records where scholar_id_number = $1", [A]))[0].n === 1
  && (await q("select count(*)::int n from renewal_self_grade_submissions where scholar_id_number = $1 and status = 'pending'", [A]))[0].n === 1
  && (await q("select status from sdp_reconsideration_requests where scholar_id_number = $1 and school_year = $2 and term = $3", [A, win.school_year, win.term]))[0]?.status === "pending");
const okB = await apply(B, false);
check("not ticked: the application is accepted without a request (nothing is added behind the scholar's back)", okB.ok && (await q("select count(*)::int n from sdp_reconsideration_requests where scholar_id_number = $1", [B]))[0].n === 0, okB.msg);
console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
