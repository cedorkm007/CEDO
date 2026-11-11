// tests/refer-not-after-attended/db_tests.mjs — "Refer for Consultation" is not offered once the scholar is booked or has attended (3 checks, short on purpose)
// Run:  node tests/refer-not-after-attended/db_tests.mjs
import { build } from "esbuild";
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "refer-")), "a.mjs");
await build({ entryPoints: ["src/lib/renewalActions.ts"], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "error", alias: { "@": path.resolve("src") } });
const A = await import(pathToFileURL(out).href);
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const NEW = "supabase_migration_refer_not_after_attended.sql", UNDO = "undo_refer_not_after_attended.sql";
const EVAL = seedId("staff:demo.evaluator");
async function attempt(sql, params = []) {
  try { return { ok: true, rows: await db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)", [EVAL, JSON.stringify({ sub: EVAL, role: "authenticated" })]);
    return (await tx.query(sql, params)).rows; }) }; } catch (e) { return { ok: false, msg: String(e.message) }; }
}
await db.exec(read(UNDO)).catch(() => {});
await db.exec(read(NEW)); await db.exec(read(NEW));      // twice: safe

const row = { failed: 1, drp: 0, inc: 0 };
const facts = over => ({ recordId: "r", stage: "needs_study_plan_consultation", isLate: false, appliedAt: null, docsToReview: 0, consultationRequired: true, consultationDoneAt: null, nextConsultation: null, gradesStatus: "school", dhReferralId: null, dhStatus: null, referralStatus: null, ...over });
check("1 on the screen the button shows only for a scholar who is not booked and has not attended: not when a consultation is booked, not when the staff marked the scholar as attended",
  A.canReferForConsultation(row, facts({})) === true && A.canReferForConsultation(row, facts({ nextConsultation: "2026-11-20T01:00:00Z" })) === false
  && A.canReferForConsultation(row, facts({ consultationDoneAt: "2026-11-10T01:00:00Z" })) === false);
const rec = (await q("select r.id, r.scholar_id_number from renewal_records r where r.stage = 'needs_study_plan_consultation' and r.consultation_done_at is null and (r.evaluation ->> 'failed_effective')::int > 0 order by r.scholar_id_number limit 1"))[0];
const open = (await q("select public._renewal_can_refer(r) c from renewal_records r where r.id = $1", [rec.id]))[0].c;
await q("update renewal_records set consultation_done_at = now() where id = $1", [rec.id]);
const afterDone = (await q("select public._renewal_can_refer(r) c from renewal_records r where r.id = $1", [rec.id]))[0].c;
check("2 in the database a case with a failed subject can be referred until the staff mark the consultation attended, and then it cannot", open === true && afterDone === false, `${open} ${afterDone}`);
const refused = await attempt("select public.renewal_refer_book($1, 'initial', current_date + 3, 'AM')", [rec.id]);
await db.exec(read(UNDO));
const back = (await q("select public._renewal_can_refer(r) c from renewal_records r where r.id = $1", [rec.id]))[0].c;
check("3 a referral of a scholar who already attended is refused with a clear message; after the undo the old rule is back", !refused.ok && /already attended the consultation/.test(refused.msg) && back === true, `${refused.msg} ${back}`);
console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
