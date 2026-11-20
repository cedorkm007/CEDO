// tests/consultation-booking-referred-by/db_tests.mjs — the booked appointment's pop-up shows "Referred by: <name>" (supabase_migration_consultation_booking_referred_by.sql), 4 checks
// Run:  node tests/consultation-booking-referred-by/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE = "supabase_migration_consultation_booking_referred_by.sql", UNDO = "undo_consultation_booking_referred_by.sql";
async function as(uid, sql, params = []) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)", [uid, JSON.stringify({ sub: uid, role: "authenticated" })]);
    return (await tx.query(sql, params)).rows;
  });
}
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await as(uid, sql, params) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
await db.exec(read(FILE)); await db.exec(read(FILE));      // twice: safe
const COUNSELOR = seedId("staff:demo.counselor"), PLAIN = seedId("staff:demo.plain"), EVAL = seedId("staff:demo.evaluator"), ADMIN = seedId("staff:demo.admin");
const referrer = (uid, slotId) => attempt(uid, "select public.counseling_slot_referrer($1) r", [slotId]);

// an appointment the evaluator referred (the scholar booked it from the referral) and one the scholar booked for their own renewal; plus an appointment of ANOTHER consultant
const SCH = (await q("select scholar_id_number s from scholars order by scholar_id_number limit 3")).map(r => r.s);
const own = (await q("select x.id from counseling_slots x where x.staff_id = $1 and x.state = 'booked' and x.record_id is not null order by x.starts_at limit 1", [COUNSELOR]))[0];
await q("set session_replication_role = replica");
const ref = (await q(`insert into scholar_counseling_referrals (scholar_id_number, referred_by, referred_to, previous_semester_status, endorsed_for, status, failed_subjects, lacking_grades, remarks, reason)
                      values ($1, $2, $3, 'Retained', 'Renewal', 'booked', '[]'::jsonb, '[]'::jsonb, '', 'INC') returning id`, [SCH[0], EVAL, COUNSELOR]))[0].id;
const av = (await q("insert into counseling_availability (staff_id, starts_at, ends_at) values ($1, now() + interval '3 days', now() + interval '3 days 2 hours') returning id", [COUNSELOR]))[0].id;
const referred = (await q(`insert into counseling_slots (availability_id, staff_id, starts_at, ends_at, state, record_id, referral_id, scholar_id_number, booked_at, minutes)
                           values ($1, $2, now() + interval '3 days 1 hour', now() + interval '3 days 1 hour 10 minutes', 'booked', null, $3, $4, now(), 10) returning id`, [av, COUNSELOR, ref, SCH[0]]))[0].id;
const ref2 = (await q(`insert into scholar_counseling_referrals (scholar_id_number, referred_by, referred_to, previous_semester_status, endorsed_for, status, failed_subjects, lacking_grades, remarks, reason)
                       values ($1, $2, $3, 'Retained', 'Renewal', 'booked', '[]'::jsonb, '[]'::jsonb, '', 'GWA') returning id`, [SCH[1], EVAL, ADMIN]))[0].id;
const av2 = (await q("insert into counseling_availability (staff_id, starts_at, ends_at) values ($1, now() + interval '4 days', now() + interval '4 days 2 hours') returning id", [ADMIN]))[0].id;
const others = (await q(`insert into counseling_slots (availability_id, staff_id, starts_at, ends_at, state, record_id, referral_id, scholar_id_number, booked_at, minutes)
                         values ($1, $2, now() + interval '4 days 1 hour', now() + interval '4 days 1 hour 10 minutes', 'booked', null, $3, $4, now(), 10) returning id`, [av2, ADMIN, ref2, SCH[1]]))[0].id;
await q("set session_replication_role = origin");
const evalName = (await q("select btrim(first_name || ' ' || last_name) n from users where id = $1", [EVAL]))[0].n;

// 1. an appointment that came from a referral names the staff member who referred
const r1 = await referrer(COUNSELOR, referred);
check("1 an appointment booked from a referral says who referred the scholar (the evaluator's name, as the other pop-up lines name staff)",
  r1.ok && r1.rows[0].r.referred_by === evalName && evalName.length > 3, JSON.stringify(r1));

// 2. an appointment the scholar booked for their own renewal has no referrer
const r2 = await referrer(COUNSELOR, own.id);
check("2 an appointment the scholar booked for their own renewal has no referrer (the answer is empty, so the pop-up shows no 'Referred by' line)",
  r2.ok && r2.rows[0].r.referred_by === null, JSON.stringify(r2));

// 3. only consultation staff, and only about their own appointments
const rPlain = await referrer(PLAIN, referred), rOther = await referrer(COUNSELOR, others), rNone = await referrer(COUNSELOR, "00000000-0000-0000-0000-000000000000");
check("3 only consultation staff can ask, and only about their own appointments (another consultant's appointment and a made-up one are refused)",
  !rPlain.ok && /Only consultation staff|Not authorized|consultation/i.test(rPlain.msg) && !rOther.ok && /not found/i.test(rOther.msg) && !rNone.ok && /not found/i.test(rNone.msg), `${rPlain.msg} | ${rOther.msg} | ${rNone.msg}`);

// 4. the undo removes the function only (the older pop-up function and every booking stay)
const slotsBefore = Number((await q("select count(*)::int n from counseling_slots"))[0].n), refsBefore = Number((await q("select count(*)::int n from scholar_counseling_referrals"))[0].n);
await db.exec(read(UNDO));
const gone = (await q("select to_regprocedure('public.counseling_slot_referrer(uuid)') a, to_regprocedure('public.counseling_slot_scholar_info(uuid)') b"))[0];
check("4 after the undo the function is gone while the booking pop-up's other function and every booking and referral stay",
  gone.a === null && gone.b !== null && Number((await q("select count(*)::int n from counseling_slots"))[0].n) === slotsBefore && Number((await q("select count(*)::int n from scholar_counseling_referrals"))[0].n) === refsBefore, JSON.stringify(gone));
console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
