// tests/renewal/db/run_p4_tests.mjs — Phase 4 database checks: the scholar's own appointments list for the Consultation tile.
// (The Renewal tracker and the "what to do next" wording need nothing new in the database; they are tested in tests/renewal/run.mjs.)
// Same setup as the earlier database suites: every real migration file, in memory, plus the demo's TEST data.
// Run:  node tests/renewal/db/run_p4_tests.mjs
import { buildDb } from "../../../localdemo/build.mjs";
import { seedDb, seedId } from "../../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);

const num = n => `TEST-${String(n).padStart(4, "0")}`;
const scholarUid = n => seedId(`scholar:${n}`);
const COUNSELOR = seedId("staff:demo.counselor"), EVAL = seedId("staff:demo.evaluator");
async function as(uid, fn) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)", [uid, JSON.stringify({ sub: uid, role: "authenticated" })]);
    return fn(tx);
  });
}
const rpc = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;

console.log("\nThe scholar's own appointments (Consultation tile)");
{
  // seeded: TEST-0034 (booked, started 40 min ago), 0035, 0036, 0037 (in ~30 h), 0038 (in ~8 h)
  const a37 = await rpc(scholarUid(37), "select * from public.consultation_my_appointments()");
  check("a scholar sees their own booked appointment with the staff name and the term", a37.length === 1 && a37[0].state === "booked" && a37[0].staff_name && /1st Semester 2026-2027/.test(a37[0].term_label));
  check("30 hours ahead: it can still be changed", a37[0].can_change === true);
  const a38 = await rpc(scholarUid(38), "select * from public.consultation_my_appointments()");
  check("8 hours ahead: it can no longer be changed online", a38.length === 1 && a38[0].can_change === false);
  check("a scholar never sees another scholar's appointments", a37.every(a => a.slot_id !== a38[0].slot_id) && (await rpc(scholarUid(1), "select * from public.consultation_my_appointments()")).length === 0);
  check("a staff member (not a scholar) cannot use it", await (async () => { try { await rpc(COUNSELOR, "select * from public.consultation_my_appointments()"); return false; } catch (e) { return /Not signed in as a scholar/.test(e.message); } })());
  check("anonymous visitors cannot call it", await (async () => { try { await db.transaction(async tx => { await tx.exec("set local role anon"); await tx.query("select * from public.consultation_my_appointments()"); }); return false; } catch { return true; } })());

  // history: attended and missed ones appear after the upcoming one; upcoming comes first
  const slot34 = (await q("select id from counseling_slots where scholar_id_number = $1", [num(34)]))[0].id;
  await rpc(COUNSELOR, "select public.counseling_mark_slot($1,'attended')", [slot34]);
  const slot35 = (await q("select id from counseling_slots where scholar_id_number = $1", [num(35)]))[0].id;
  await rpc(COUNSELOR, "select public.counseling_mark_slot($1,'no_show')", [slot35]);
  const a34 = await rpc(scholarUid(34), "select * from public.consultation_my_appointments()");
  const a35 = await rpc(scholarUid(35), "select * from public.consultation_my_appointments()");
  check("an attended appointment stays in the list as 'attended'", a34.length === 1 && a34[0].state === "attended" && a34[0].can_change === false);
  check("a missed appointment shows as 'no_show'", a35.length === 1 && a35[0].state === "no_show");
  // a scholar with a past attended AND a new upcoming booking: upcoming first
  const rec35 = (await q("select id from renewal_records where scholar_id_number = $1", [num(35)]))[0].id;
  const free = await q("select id from counseling_slots where state = 'open' and starts_at > now() + interval '20 hours' order by starts_at limit 1");
  await rpc(scholarUid(35), "select public.renewal_book_slot($1,$2)", [rec35, free[0].id]);
  const mixed = await rpc(scholarUid(35), "select * from public.consultation_my_appointments()");
  check("upcoming appointments come first, then the earlier ones", mixed.length === 2 && mixed[0].state === "booked" && mixed[1].state === "no_show");
  check("open slots are never listed as anyone's appointment", (await rpc(scholarUid(35), "select * from public.consultation_my_appointments()")).every(a => a.state !== "open"));
}

console.log("\nA different study plan form for each school");
{
  const ADMIN = seedId("staff:demo.admin");
  const lowerSchool = seedId("school:lower"), higherSchool = seedId("school:higher");
  const formLower = seedId("form:study-plan-lower"), formDefault = seedId("form:study-plan");
  const setup = (await rpc(ADMIN, "select public.renewal_study_plan_form_setup() s"))[0].s;
  check("Forms Management staff see every school and what is chosen", setup.schools.length === 4 && setup.assignments.length === 2 && setup.schools.every(s => s.name));
  const mine = async n => await rpc(scholarUid(n), "select * from public.renewal_my_study_plan_form()");
  const m1 = await mine(1), m14 = await mine(14);
  check("a scholar gets THEIR school's form (not the default)", m1.length === 1 && m1[0].material_id === formLower && m1[0].is_default === false && /Lower-Is-Better/.test(m1[0].title));
  check("a scholar of a school with no form of its own gets the default", m14.length === 1 && m14[0].material_id === formDefault && m14[0].is_default === true);
  // the file itself: allowed for the chosen form of one's own school, refused for another school's form
  const visible = async (n, formId) => (await as(scholarUid(n), async tx => (await tx.query("select count(*)::int n from storage.objects where bucket_id = 'form-materials' and name = $1", [formId + "/file.pdf"])).rows[0].n));
  check("the lower school's scholar can download their school's form (though it stays locked in the Forms tab)", (await visible(1, formLower)) === 1);
  check("a scholar of another school cannot download that school's form", (await visible(14, formLower)) === 0);
  check("the default form (visible in the Forms tab to everyone) can be downloaded by everyone", (await visible(14, formDefault)) === 1 && (await visible(1, formDefault)) === 1);
  // A form that is LOCKED for everyone by another rule (a program nobody is in) can still be downloaded by exactly the schools it was chosen for.
  const formLocked = seedId("form:study-plan-locked-test");
  await q("insert into form_materials (id, title, kind, url, description, file_name) values ($1, 'Study Plan Form – TEST Letter-Grade Institute', 'pdf', '', '', 'locked.pdf')", [formLocked]);
  await q("insert into form_material_conditions (material_id, condition_type, course) values ($1, 'course', 'NO SUCH PROGRAM')", [formLocked]);
  await q("insert into storage.objects (bucket_id, name, metadata) values ('form-materials', $1, '{\"mimetype\":\"application/pdf\",\"size\":3,\"base64\":\"JVBE\"}'::jsonb)", [formLocked + "/file.pdf"]);
  const lettersSchool = seedId("school:letters");
  check("a locked form cannot be downloaded by anyone before it is chosen for a school", (await visible(16, formLocked)) === 0);
  await rpc(ADMIN, "select public.renewal_study_plan_form_set($1, $2)", [lettersSchool, formLocked]);
  check("once chosen for a school, ITS scholars can download it even though it is locked", (await visible(16, formLocked)) === 1 && (await mine(16))[0].material_id === formLocked);
  check("scholars of other schools still cannot download that locked form", (await visible(14, formLocked)) === 0 && (await visible(1, formLocked)) === 0);
  await rpc(ADMIN, "select public.renewal_study_plan_form_set($1, null)", [lettersSchool]);
  check("clearing the choice takes the access away again", (await visible(16, formLocked)) === 0);
  check("in the normal Forms tab that form stays LOCKED (its own unlock condition is not met), yet the Renewal tile still gives it", (await rpc(scholarUid(1), "select id, is_unlocked from public.get_my_form_materials()")).every(r => r.id !== formLower || r.is_unlocked === false));
  // changing the choices
  check("only Forms Management staff can choose (not the evaluator, counselor or a scholar)", await (async () => {
    for (const uid of [EVAL, COUNSELOR, scholarUid(1)]) { try { await rpc(uid, "select public.renewal_study_plan_form_set(null, $1)", [formDefault]); return false; } catch (e) { if (!/Forms Management/.test(e.message)) return false; } }
    return true;
  })());
  check("a scholar cannot read the setup either", await (async () => { try { await rpc(scholarUid(1), "select public.renewal_study_plan_form_setup()"); return false; } catch (e) { return /Forms Management/.test(e.message); } })());
  await rpc(ADMIN, "select public.renewal_study_plan_form_set($1, null)", [lowerSchool]);
  check("clearing a school's own form: its scholars fall back to the default", (await mine(1))[0].material_id === formDefault);
  await rpc(ADMIN, "select public.renewal_study_plan_form_set($1, $2)", [higherSchool, formLower]);
  check("choosing a form for another school works, and replaces any earlier choice", (await mine(14))[0].material_id === formLower && (await q("select count(*)::int n from renewal_study_plan_forms where school_id = $1", [higherSchool]))[0].n === 1);
  await rpc(ADMIN, "select public.renewal_study_plan_form_set(null, null)");
  await rpc(ADMIN, "select public.renewal_study_plan_form_set($1, null)", [higherSchool]);
  check("with nothing chosen the scholar gets no form (the screen then points to the Forms tab)", (await mine(14)).length === 0);
  check("an unknown school or form is refused", await (async () => {
    try { await rpc(ADMIN, "select public.renewal_study_plan_form_set(gen_random_uuid(), $1)", [formDefault]); return false; } catch (e) { if (!/school was not found/.test(e.message)) return false; }
    try { await rpc(ADMIN, "select public.renewal_study_plan_form_set(null, gen_random_uuid())"); return false; } catch (e) { return /form was not found/.test(e.message); }
  })());
  check("there can be only ONE default and one choice per school (the database enforces it)", await (async () => { try { await q("insert into renewal_study_plan_forms (school_id, material_id) values (null, $1), (null, $1)", [formDefault]); return false; } catch { return true; } })());
  check("anonymous visitors cannot call the scholar's function", await (async () => { try { await db.transaction(async tx => { await tx.exec("set local role anon"); await tx.query("select * from public.renewal_my_study_plan_form()"); }); return false; } catch { return true; } })());
}

console.log("\nSafety: running the Phase 4 migration twice changes nothing");
{
  let ok = true;
  try { await db.exec(fs.readFileSync(new URL("../../../supabase_migration_renewal_p4_tracker.sql", import.meta.url), "utf8")); } catch (e) { ok = false; console.log("   ", e.message); }
  check("the migration can be run twice", ok);
}

console.log(`\n${failed === 0 ? "ALL PHASE 4 DATABASE CHECKS PASSED" : "SOME CHECKS FAILED"} — ${passed} passed, ${failed} failed`);
await db.close();
process.exit(failed === 0 ? 0 : 1);
