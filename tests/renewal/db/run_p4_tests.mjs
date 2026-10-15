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

console.log("\nA study plan template for each school (uploaded in Forms Management)");
{
  const ADMIN = seedId("staff:demo.admin");
  const lowerSchool = seedId("school:lower"), higherSchool = seedId("school:higher"), lettersSchool = seedId("school:letters");
  const defaultPath = `default/${seedId("template:default")}.pdf`, lowerPath = `${lowerSchool}/${seedId("template:lower")}.pdf`;
  const setup = (await rpc(ADMIN, "select public.renewal_study_plan_form_setup() s"))[0].s;
  check("Forms Management staff see every school and the template each one has", setup.schools.length === 4 && setup.assignments.length === 2 && setup.schools.every(s => s.name) && setup.assignments.every(a => a.file_name && a.storage_path));
  const mine = async n => await rpc(scholarUid(n), "select * from public.renewal_my_study_plan_form()");
  const m1 = await mine(1), m14 = await mine(14);
  check("a scholar gets THEIR school's template, under a tidy file name made by the system", m1.length === 1 && m1[0].storage_path === lowerPath && m1[0].is_default === false && /Lower-Is-Better/.test(m1[0].title) && /^Study Plan Form - .*Lower-Is-Better University\.pdf$/.test(m1[0].download_name), JSON.stringify(m1));
  check("a scholar of a school with no template of its own gets the default (named just 'Study Plan Form')", m14.length === 1 && m14[0].storage_path === defaultPath && m14[0].is_default === true && m14[0].download_name === "Study Plan Form.pdf", JSON.stringify(m14));
  // the file itself, through the real storage rules
  const readable = async (uid, path) => (await as(uid, async tx => (await tx.query("select count(*)::int n from storage.objects where bucket_id = 'renewal-study-plan-forms' and name = $1", [path])).rows[0].n));
  check("a scholar can read their own school's template file", (await readable(scholarUid(1), lowerPath)) === 1 && (await readable(scholarUid(14), defaultPath)) === 1);
  check("a scholar can NOT read another school's template", (await readable(scholarUid(14), lowerPath)) === 0);
  check("a scholar whose school has its own template does not need (and cannot read) the default file", (await readable(scholarUid(1), defaultPath)) === 0);
  check("the evaluator and counselor (no Forms Management tag) cannot read the templates; Forms Management staff can", (await readable(EVAL, lowerPath)) === 0 && (await readable(COUNSELOR, defaultPath)) === 0 && (await readable(ADMIN, lowerPath)) === 1);
  check("anonymous visitors cannot read a template", await (async () => { try { return (await db.transaction(async tx => { await tx.exec("set local role anon"); return (await tx.query("select count(*)::int n from storage.objects where bucket_id = 'renewal-study-plan-forms'")).rows[0].n; })) === 0; } catch { return true; } })());
  check("a scholar cannot read the table of templates, nor upload into the templates folder", await (async () => {
    if ((await as(scholarUid(1), async tx => (await tx.query("select count(*)::int n from public.renewal_study_plan_forms")).rows[0].n)) !== 0) return false;
    try { await as(scholarUid(1), async tx => tx.query("insert into storage.objects (bucket_id, name, metadata) values ('renewal-study-plan-forms', $1, '{}'::jsonb)", [`${lowerSchool}/x.pdf`])); return false; } catch { return true; }
  })());

  // uploading for a school that has none, then replacing it
  const put = async (path, mime = "application/pdf") => q("insert into storage.objects (bucket_id, name, metadata) values ('renewal-study-plan-forms', $1, $2::jsonb)", [path, JSON.stringify({ mimetype: mime, size: 3, base64: "JVBE" })]);
  const path1 = `${lettersSchool}/11111111-1111-4111-8111-111111111111.pdf`, path2 = `${lettersSchool}/22222222-2222-4222-8222-222222222222.docx`;
  await put(path1);
  const first = (await rpc(ADMIN, "select public.renewal_study_plan_form_save($1, $2, 'Letters school plan.pdf') p", [lettersSchool, path1]))[0].p;
  check("saving a template for a school that had none: its scholars get it at once, and nothing old needs deleting", first === null && (await mine(16))[0].storage_path === path1 && /^Study Plan Form - .*Letter-Grade Institute\.pdf$/.test((await mine(16))[0].download_name));
  await put(path2, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  const second = (await rpc(ADMIN, "select public.renewal_study_plan_form_save($1, $2, 'Letters school plan v2.docx') p", [lettersSchool, path2]))[0].p;
  check("replacing it (here with a Word file) returns the old file's path so it can be deleted, and the scholar now gets the new one", second === path1 && (await mine(16))[0].storage_path === path2 && /\.docx$/.test((await mine(16))[0].download_name));
  check("only ONE template per school is kept", (await q("select count(*)::int n from renewal_study_plan_forms where school_id = $1", [lettersSchool]))[0].n === 1);

  check("only Forms Management staff can save or remove (not the evaluator, counselor or a scholar)", await (async () => {
    for (const uid of [EVAL, COUNSELOR, scholarUid(1)]) {
      try { await rpc(uid, "select public.renewal_study_plan_form_save($1, $2, 'x.pdf')", [lettersSchool, path2]); return false; } catch (e) { if (!/Forms Management/.test(e.message)) return false; }
      try { await rpc(uid, "select public.renewal_study_plan_form_remove($1)", [lettersSchool]); return false; } catch (e) { if (!/Forms Management/.test(e.message)) return false; }
    }
    return true;
  })());
  check("a scholar cannot read the setup either", await (async () => { try { await rpc(scholarUid(1), "select public.renewal_study_plan_form_setup()"); return false; } catch (e) { return /Forms Management/.test(e.message); } })());
  check("a file in another school's folder, a file that was never uploaded, an unknown school and a blank name are all refused", await (async () => {
    await put(`${higherSchool}/33333333-3333-4333-8333-333333333333.pdf`);
    const tryIt = async (sql, params, re) => { try { await rpc(ADMIN, sql, params); return false; } catch (e) { return re.test(e.message); } };
    return (await tryIt("select public.renewal_study_plan_form_save($1, $2, 'x.pdf')", [lettersSchool, `${higherSchool}/33333333-3333-4333-8333-333333333333.pdf`], /not in this school/))
      && (await tryIt("select public.renewal_study_plan_form_save($1, $2, 'x.pdf')", [lettersSchool, `${lettersSchool}/never-uploaded.pdf`], /was not uploaded/))
      && (await tryIt("select public.renewal_study_plan_form_save(gen_random_uuid(), 'default/x.pdf', 'x.pdf')", [], /school was not found/))
      && (await tryIt("select public.renewal_study_plan_form_save($1, $2, '  ')", [lettersSchool, path2], /no name/))
      && (await tryIt("select public.renewal_study_plan_form_save(null, $1, 'x.pdf')", [path2], /not in this school/));
  })());

  // removing
  const removed = (await rpc(ADMIN, "select public.renewal_study_plan_form_remove($1) p", [lettersSchool]))[0].p;
  check("removing a school's template returns its path; its scholars fall back to the default", removed === path2 && (await mine(16))[0].is_default === true && (await mine(16))[0].storage_path === defaultPath);
  check("removing the default as well: a school with no template of its own gets nothing (the screen then points to the Forms tab)", await (async () => {
    await rpc(ADMIN, "select public.renewal_study_plan_form_remove(null)");
    return (await mine(14)).length === 0 && (await mine(16)).length === 0 && (await mine(1)).length === 1;
  })());
  check("removing something that is not there is harmless", (await rpc(ADMIN, "select public.renewal_study_plan_form_remove($1) p", [higherSchool]))[0].p === null);
  check("there can be only ONE default and one template per school (the database enforces it)", await (async () => { try { await q("insert into renewal_study_plan_forms (school_id, storage_path, file_name) values (null, 'default/a.pdf', 'a'), (null, 'default/b.pdf', 'b')", []); return false; } catch { return true; } })());
  check("anonymous visitors cannot call the scholar's function", await (async () => { try { await db.transaction(async tx => { await tx.exec("set local role anon"); await tx.query("select * from public.renewal_my_study_plan_form()"); }); return false; } catch { return true; } })());
  check("the templates folder only takes PDF and Word files, up to 10 MB, and is private", (await q("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'renewal-study-plan-forms'"))[0] && await (async () => { const b = (await q("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'renewal-study-plan-forms'"))[0]; return b.public === false && Number(b.file_size_limit) === 10485760 && b.allowed_mime_types.length === 3; })());
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
