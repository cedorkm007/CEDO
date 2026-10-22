// tests/sdp-update/phase9_db_tests.mjs — SDP Monitoring update, Phase 9, file A: functions a visitor does not need are closed.
//   visitors keep only the pages' own functions and the rule helpers; signed-in people keep everything they use; internal helpers are closed to signed-in people too;
//   the undo restores exactly what was closed; running twice changes nothing.
// Run:  node tests/sdp-update/phase9_db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE = "supabase_migration_sdp_update_p9_a_close_functions.sql", UNDO = "undo_sdp_update_p9_a.sql";
const VISITOR = ["resolve_staff_login_email", "resolve_scholar_login_email", "resolve_school_login_email", "request_school_password_reset", "get_public_scholar_emergency_info", "join_presentation_session", "submit_presentation_response", "get_presentation_session_state", "get_financial_assistance_status", "get_public_survey", "submit_my_survey_response"];
const BY_DESIGN = `select oid::regprocedure::text s from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and ((p.prorettype = 'trigger'::regtype)
  or exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  or exists (select 1 from pg_policies pol where coalesce(pol.qual,'') || ' ' || coalesce(pol.with_check,'') ~ ('\\m' || p.proname || '\\('))
  or exists (select 1 from pg_depend d where d.refclassid = 'pg_proc'::regclass and d.refobjid = p.oid and d.deptype in ('n', 'a') and d.classid in ('pg_attrdef'::regclass, 'pg_constraint'::regclass, 'pg_rewrite'::regclass, 'pg_class'::regclass, 'pg_policy'::regclass)))`;
const execSet = async role => new Set((await q(`select oid::regprocedure::text s from pg_proc where pronamespace = 'public'::regnamespace and prokind = 'f' and has_function_privilege('${role}', oid, 'execute')`)).map(r => r.s));
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const denied = async (uid, sql, role) => { try { await as(uid, tx => tx.query(sql), role); return false; } catch (e) { return /permission denied for function/i.test(String(e.message)); } };
const notDenied = async (uid, sql, role) => { try { await as(uid, tx => tx.query(sql), role); return true; } catch (e) { return !/permission denied for function/i.test(String(e.message)); } };
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(dir + "/" + e.name) : [dir + "/" + e.name]);
const rpcNamesInWebsite = () => { const names = new Set(); for (const f of walk("src").filter(f => /\.(ts|tsx)$/.test(f))) for (const m of read(f).matchAll(/rpc\(\s*["'`]([a-z0-9_]+)["'`]/gi)) names.add(m[1]); return names; };

console.log("\nVisitors (not signed in)");
const anon = await execSet("anon");
const byDesign = new Set((await q(BY_DESIGN)).map(r => r.s));
const open = [...anon].filter(s => !byDesign.has(s));
check("the only functions visitors can still run (besides rule helpers, triggers and extension functions) are the eleven their pages call", open.length === VISITOR.length && VISITOR.every(v => open.some(s => s.split("(")[0].replace(/^public\./, "") === v)), open.join(", "));
check("a visitor can still call the sign-in look-up and the public survey page", await notDenied(null, "select public.resolve_staff_login_email('nobody')", "anon") && await notDenied(null, "select public.get_public_survey('x')", "anon"));
check("a visitor can no longer run the helpers that hand out data", await denied(null, "select public._sdp_period_totals('2025-2026', '1st Semester')", "anon")
  && await denied(null, "select public.get_scholar_grading_config_for_staff('TEST-0001')", "anon") && await denied(null, "select public.scholars_sdp_checklist_page('2025-2026', '1st Semester', '', 'all', 'name', 'asc', 1, 10)", "anon"));
check("a visitor asking a protected table still gets an empty answer, not an error (the rule helpers stay open)", await notDenied(null, "select count(*) from users", "anon") && await notDenied(null, "select count(*) from scholars", "anon") && await notDenied(null, "select count(*) from kauban_sign_words", "anon"));

console.log("\nSigned-in people");
const SEAD = seedId("staff:demo.sead"), SCHOLAR = seedId("scholar:5"), PLAIN = seedId("staff:demo.plain");
check("the server functions (service key) can still run a closed function", await notDenied(null, "select public._sdp_period_totals('2025-2026', '1st Semester')", "service_role"));
check("staff keep the functions their screens use", await notDenied(SEAD, "select * from public.scholars_sdp_checklist_page('2025-2026', '1st Semester', '', 'all', 'name', 'asc', 1, 10)") && await notDenied(PLAIN, "select public.is_cedo_staff()") && await notDenied(SEAD, "select public.get_current_grading_period()"));
check("a scholar keeps their own functions", await notDenied(SCHOLAR, "select public.my_password_change_required()") && await notDenied(SCHOLAR, "select public.current_scholar_id_number()"));
check("a helper that a table definition uses (a column default) stays open, so saves keep working", await notDenied(SEAD, "select public._school_key('Some School')"));
check("internal helpers (underscore names) are closed to signed-in people too", await denied(SEAD, "select public._sdp_period_totals('2025-2026', '1st Semester')") && await denied(SCHOLAR, "select public._scholar_subject_pct('TEST-0001', gen_random_uuid())"));
const names = rpcNamesInWebsite();
const auth = await execSet("authenticated"); const authNames = new Set([...auth].map(s => s.replace(/^public\./, "").split("(")[0]));
const missing = [...names].filter(n => !authNames.has(n));
check("every function the website calls is still open to signed-in people (checked against the website's own code)", names.size > 100 && missing.length === 0, "missing: " + missing.join(", "));
const closedRows = await q("select signature, closed_from from p9_closed_functions");
check("no function the website calls is among the internal helpers closed to signed-in people", closedRows.filter(r => r.closed_from === "signed-in").every(r => !names.has(r.signature.replace(/^public\./, "").split("(")[0])));

console.log("\nThe closed list, the undo and running twice");
const lockedAway = async () => { try { await as(SEAD, tx => tx.query("select * from public.p9_closed_functions")); return false; } catch (e) { return /permission denied/i.test(String(e.message)); } };
check("the closed list holds every function that was closed, and it is locked away from the website", closedRows.length > 100 && await lockedAway());
const closedVisitors = closedRows.filter(r => r.closed_from === "visitors").map(r => r.signature);
const closedSignedIn = closedRows.filter(r => r.closed_from === "signed-in").map(r => r.signature);
await db.exec(read(FILE));
check("running the file again changes nothing", Number((await q("select count(*) n from p9_closed_functions"))[0].n) === closedRows.length && (await execSet("anon")).size === anon.size);
await db.exec(read(UNDO));
const anonBack = await execSet("anon"), authBack = await execSet("authenticated");
check("the undo gives visitors back exactly the functions that were closed (and removes the list)", closedVisitors.every(s => anonBack.has(s)) && anonBack.size === anon.size + closedVisitors.length && (await q("select to_regclass('public.p9_closed_functions') t"))[0].t === null);
check("…and gives signed-in people the internal helpers back", closedSignedIn.length > 0 && closedSignedIn.every(s => authBack.has(s)));
await db.exec(read(FILE));
const anonRedo = await execSet("anon");
check("closing again after the undo works", anonRedo.size === anon.size, [...anonRedo].filter(s => !anon.has(s)).slice(0, 6).join(", ") + " | " + [...anon].filter(s => !anonRedo.has(s)).slice(0, 6).join(", "));
check("the file sets a short wait limit and changes no table rule", /set lock_timeout = '5s'/.test(read(FILE)) && !/create policy|drop policy/i.test(read(FILE)));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
