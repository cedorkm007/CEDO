// tests/renewal-dashboard-speed/db_tests.mjs — the Scholar Renewal dashboard no longer asks the window question for every scholar (3 checks, short on purpose)
// Run:  node tests/renewal-dashboard-speed/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const NEW = "supabase_migration_renewal_dashboard_speed.sql", UNDO = "undo_renewal_dashboard_speed.sql";
const EVAL = seedId("staff:demo.evaluator");
async function dash(y, t) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)", [EVAL, JSON.stringify({ sub: EVAL, role: "authenticated" })]);
    const r = (await tx.query("select public.renewal_dashboard($1, $2) d", [y, t])).rows[0].d;
    delete r.generated_at;
    return JSON.stringify(r);
  });
}
const win = (await q("select school_year, term from renewal_windows order by (select count(*) from renewal_records r where r.window_id = renewal_windows.id) desc limit 1"))[0];
const body = async () => (await q("select pg_get_functiondef('public.renewal_dashboard(text,text)'::regprocedure) f"))[0].f;

await db.exec(read(UNDO));
const before = await dash(win.school_year, win.term);
const oldBody = await body();
await db.exec(read(NEW)); await db.exec(read(NEW));      // twice: safe
const after = await dash(win.school_year, win.term);
console.log("The dashboard");
check("1 every number is exactly the same as before (applied, not applied, by school, by stage, INC, consultations, documents, Division Head ...)", before === after && JSON.parse(after).totals.can_renew > 0, before === after ? "" : "numbers differ");
const newBody = await body();
check("2 the window question is answered once as a set, not asked again for every scholar", newBody.includes("_renewal_window_members") && !newBody.includes("_renewal_window_includes") && oldBody.includes("_renewal_window_includes"));
await db.exec(read(UNDO));
check("3 the undo puts the old dashboard back, and the file can be put on again", (await body()).includes("_renewal_window_includes") && (await db.exec(read(NEW)), (await body()).includes("_renewal_window_members")));
console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
