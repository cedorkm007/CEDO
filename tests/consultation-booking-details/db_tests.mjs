// tests/consultation-booking-details/db_tests.mjs — the booking pop-up of the Consultation Tool > Appointments: course, year level, barangay, school and GWA (supabase_migration_consultation_booking_details.sql), 5 checks
// Run:  node tests/consultation-booking-details/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE = "supabase_migration_consultation_booking_details.sql", UNDO = "undo_consultation_booking_details.sql";
async function as(uid, sql, params = []) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)", [uid, JSON.stringify({ sub: uid, role: "authenticated" })]);
    return (await tx.query(sql, params)).rows;
  });
}
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await as(uid, sql, params) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
await db.exec(read(FILE)); await db.exec(read(FILE));      // twice: safe
const COUNSELOR = seedId("staff:demo.counselor"), PLAIN = seedId("staff:demo.plain");
const LOWER = (await q("select id from schools where name like '%Lower-Is-Better%'"))[0].id;
const info = async slotId => (await attempt(COUNSELOR, "select public.counseling_slot_scholar_info($1) i", [slotId])).rows?.[0]?.i;

// two booked appointments of the demo counselor, with a renewal and a scholar of the 1-5 school
const booked = await q(`select x.id, x.record_id, x.scholar_id_number s from counseling_slots x join scholars sc on sc.scholar_id_number = x.scholar_id_number
                        where x.staff_id = $1 and x.state = 'booked' and x.record_id is not null and sc.school_id = $2 order by x.starts_at limit 2`, [COUNSELOR, LOWER]);
const [A, B] = booked;
await q("update scholars set course = 'BS Information Technology', year_level = '3rd Year', barangay = 'Macasandig', school = 'TEST – Lower-Is-Better University' where scholar_id_number = $1", [A.s]);
await q("update scholars set course = '', year_level = null, barangay = '  ' where scholar_id_number = $1", [B.s]).catch(() => q("update scholars set course = '', year_level = '', barangay = '  ' where scholar_id_number = $1", [B.s]));
const rec = (await q("select school_year, term from renewal_records where id = $1", [A.record_id]))[0];
const basis = (await q("select * from public._renewal_basis($1, $2)", [rec.school_year, rec.term]))[0];

// 1. only the consultation staff who own the appointment can ask; nothing is changed
const plain = await attempt(PLAIN, "select public.counseling_slot_scholar_info($1)", [A.id]);
const nothing = await attempt(COUNSELOR, "select public.counseling_slot_scholar_info('00000000-0000-0000-0000-000000000000')");
check("1 only consultation staff can ask, and only about an appointment of their own that is booked (anything else is refused)",
  !plain.ok && /Only consultation staff/.test(plain.msg) && !nothing.ok && /not found/.test(nothing.msg), `${plain.msg} | ${nothing.msg}`);

// 2. the course, year level, barangay and school of the scholar's record; empty values come back as nothing
await q("update renewal_records set evaluation = evaluation || '{\"gwa\": 2.63}'::jsonb where id = $1", [A.record_id]);
const iA = await info(A.id), iB = await info(B.id);
check("2 the pop-up gets the scholar's course, year level, barangay and school from the scholar's record; a value that is empty on the record comes back empty (the screen says 'Not saved')",
  iA?.course === "BS Information Technology" && iA.year_level === "3rd Year" && iA.barangay === "Macasandig" && iA.school === "TEST – Lower-Is-Better University" && iB?.course === null && iB.year_level === null && iB.barangay === null, JSON.stringify([iA, iB]));

// 3. the GWA is the one the renewal's last check stored, with the semester it is of and the school's scale
check("3 the GWA is the one the renewal's own check stored (2.63), with the semester the renewal looks at and the scale of the scholar's school (1 to 5, lower is better)",
  Number(iA.gwa) === 2.63 && iA.gwa_year === basis.basis_school_year && iA.gwa_term === basis.basis_term && Number(iA.scale_min) === 1 && Number(iA.scale_max) === 5 && iA.scale_direction === "lower_is_better", JSON.stringify(iA));

// 4. with no stored GWA it is worked out from the grades of that semester; a referral (no renewal) uses the latest semester that has grades; no grades = no GWA
await q("update renewal_records set evaluation = evaluation - 'gwa' where id = $1", [A.record_id]);
await q("delete from scholar_subjects_grades where scholar_id_number = any($1::text[])", [[A.s, B.s]]);
for (const [code, grade] of [["T1", "2.0"], ["T2", "3.0"]]) await q("insert into scholar_subjects_grades (scholar_id_number, school_year, semester, subject, subject_code, grade, units) values ($1, $2, $3, $4, $5, $6, 3)", [A.s, basis.basis_school_year, basis.basis_term, `Subject ${code}`, code, grade]);
const worked = await info(A.id);
await q("update counseling_slots set record_id = null where id = $1", [B.id]);
await q("insert into scholar_subjects_grades (scholar_id_number, school_year, semester, subject, subject_code, grade, units) values ($1, '2098-2099', '1st Semester', 'Old', 'O1', '1.0', 3), ($1, '2099-2100', '2nd Semester', 'New', 'N1', '4.0', 3)", [B.s]);
const referral = await info(B.id);
await q("delete from scholar_subjects_grades where scholar_id_number = $1", [B.s]);
const none = await info(B.id);
check("4 with no stored GWA it is worked out from the grades of the semester (2.0 and 3.0, 3 units each = 2.50); a referral with no renewal uses the latest semester that has grades (4.00 of 2099-2100); with no grades there is no GWA",
  Number(worked.gwa) === 2.5 && worked.gwa_year === basis.basis_school_year && Number(referral.gwa) === 4 && referral.gwa_year === "2099-2100" && referral.gwa_term === "2nd Semester" && none.gwa === null && none.gwa_year === null, JSON.stringify([worked, referral, none]));

// 5. undo
await db.exec(read(UNDO));
const gone = (await q("select to_regprocedure('public.counseling_slot_scholar_info(uuid)') f, to_regprocedure('public._scholar_gwa_of_period(text,text,text)') g"))[0];
check("5 after the undo the function is gone and nothing else was changed (the appointments are still booked)", gone.f === null && gone.g === null && Number((await q("select count(*)::int n from counseling_slots where state = 'booked'"))[0].n) >= 2);
console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
