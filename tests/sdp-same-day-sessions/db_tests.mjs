// tests/sdp-same-day-sessions/db_tests.mjs — a recurring SDP activity with SEVERAL SESSIONS ON THE SAME DATE: each session has its own id, its own QR codes and its own credit
// (supabase_migration_sdp_same_day_sessions.sql), 5 checks.   Run:  node tests/sdp-same-day-sessions/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import crypto from "node:crypto";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
await db.query("set timezone to 'UTC'");
const num = n => `TEST-${String(n).padStart(4, "0")}`;
const scholarUid = n => seedId(`scholar:${n}`);
const SEAD = seedId("staff:demo.sead");
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE = "supabase_migration_sdp_same_day_sessions.sql", UNDO = "undo_sdp_same_day_sessions.sql";
await db.exec(read(FILE)); await db.exec(read(FILE));      // twice: safe

const EMPTY = "'[]', '[]', '[]', '[]', '[]', '[]', '[]', '[]', '{}', '{}', '{}'";
const manila = d => new Date(d.getTime() + 8 * 3600e3).toISOString().slice(0, 10);
const at = (offset, hour) => { const b = new Date(); return new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate() + offset, hour - 8, 0, 0)).toISOString(); };
const dayDate = offset => manila(new Date(at(offset, 12)));
const occ = (offset, hour, sub, endHour = hour + 2) => ({ date: at(offset, hour), endTime: at(offset, endHour), venue: "v", ...(sub ? { subName: sub } : {}) });
// the activity of the request: 3 sessions on one day (the first is the activity's own row) and one on the next day
async function makeActivity(name = "TEST – City Education Innovation Week") {
  return (await q(`insert into sdp_activities (name, category, activity_type, date_time, end_time, recurring_dates, sub_name, credits, all_year_levels, created_by, organization, venue,
      nature, source_of_fund, objectives, target_partners, specific_role, work_plan, program_flow, budget_items, target_year_levels, target_barangays, target_clusters)
    values ($1, 'community_service', 'recurring', $2, $3, $4::jsonb, 'Kita-Kita', 1, true, $5, 'org', 'venue', ${EMPTY}) returning id`,
    [name, at(0, 9), at(0, 17), JSON.stringify([occ(0, 18, "Kahigayonan", 21), occ(0, 13, null, 23), occ(1, 8, "ORO Kwento")]), SEAD]))[0].id;
}
const act = await makeActivity();
const D1 = dayDate(0), D2 = dayDate(1);
const sessions = await q("select day::text as day, sub_name, ord, sid from public._sdp_schedule_days($1) order by ord", [act]);
const [S1, S2, S3, S4] = sessions.map(s => s.sid);

// 1. every row gets its own id (also a row saved without one); an id that is there never changes; the sessions of one day are listed one by one
await q("update sdp_activities set recurring_dates = recurring_dates || $2::jsonb where id = $1", [act, JSON.stringify([occ(1, 12, "Added later")])]);
const after = await q("select day::text as day, sub_name, sid from public._sdp_schedule_days($1) order by ord", [act]);
await q("update sdp_activities set sub_name = 'Kita-Kita (renamed)' where id = $1", [act]);
const again = await q("select sid from public._sdp_schedule_days($1) order by ord", [act]);
check("1 every row of 'Dates and venues' has its own session id, also a row saved without one; the ids never change when something else is edited; the sessions of one day are listed one by one",
  sessions.length === 4 && sessions.every(s => !!s.sid) && new Set(sessions.map(s => s.sid)).size === 4 && sessions.filter(s => s.day === D1).length === 3 && after.length === 5 && !!after[4].sid && new Set(after.map(s => s.sid)).size === 5
  && after.slice(0, 4).every((s, i) => s.sid === sessions[i].sid) && again.slice(0, 4).every((s, i) => s.sid === sessions[i].sid), JSON.stringify([sessions, after.map(x => x.sid)]));

// 2. the credits an activity allows = the number of sessions (rows), not of dates
const allowed = Number((await q("select public._sdp_allowed_occurrences($1) n", [act]))[0].n);
check("2 the credits the activity allows are the number of sessions (5 rows on 2 dates = 5), not the number of dates", allowed === 5, String(allowed));

// 3. credit by hand, one session at a time
const credit = (n, day, sid) => rows(SEAD, "select public.credit_scholar_for_day($1, $2, $3, null, null, null, $4) r", [act, num(n), day, sid]).then(r => ({ ok: true, r })).catch(e => ({ ok: false, error: String(e.message) }));
const a1 = await credit(1, D1, S1), a2 = await credit(1, D1, S2), a3 = await credit(1, D1, S3);
const again1 = await credit(1, D1, S2), wrong = await credit(1, D2, S1), other = await credit(2, D1, S2);      // another scholar can be credited for the same session
const saved = await q("select activity_day::text as d, activity_sid as s from sdp_attendance where activity_id = $1 and scholar_id_number = $2 order by occurrence_number", [act, num(1)]);
// an older credit (made before sessions: a day, no session id) belongs to the FIRST session of its day
await q("insert into sdp_attendance (activity_id, scholar_id_number, attended_date, occurrence_number, activity_day, school_year, semester) select $1, $2, current_date, 1, $3::date, school_year, semester from (select current_school_year as school_year, current_semester as semester from grading_period_settings where id) g", [act, num(3), D1]);
const legacyFirst = await credit(3, D1, S1), legacySecond = await credit(3, D1, S2);
check("3 by hand, each session of one day is credited on its own (3 sessions = 3 credits), the same session twice is refused, a session that is not on that day is refused, and an older credit counts for the FIRST session of its day only",
  a1.ok && a2.ok && a3.ok && saved.length === 3 && saved.every(s => s.d === D1) && new Set(saved.map(s => s.s)).size === 3 && !again1.ok && /already credited/.test(again1.error) && !wrong.ok && /not part of this activity/.test(wrong.error)
  && other.ok && !legacyFirst.ok && /already credited/.test(legacyFirst.error) && legacySecond.ok, JSON.stringify([a1, a2, a3, again1, wrong, legacyFirst, legacySecond]));

// 4. QR codes per session: a scholar can scan one code of EACH session of the same day (each credited, with its session), but not two of the same session
async function makeCodes(sessionRows) {          // [{ day, sid }] one voucher batch each
  const s = (await q("insert into attendance_sessions (sdp_activity_id, type, expected_attendees, duration_hours, created_by) values ($1, 'voucher', 10, 1, $2) returning id", [act, SEAD]))[0].id;
  const out = [];
  for (const [i, { day, sid }] of sessionRows.entries()) for (let k = 0; k < 2; k++) {
    const code = crypto.randomBytes(5).toString("hex").toUpperCase();
    await q("insert into attendance_codes (session_id, code, kind, batch_number, day_date, session_sid) values ($1, $2, 'voucher', $3, $4, $5)", [s, code, i + 1, day, sid]);
    out.push({ code, sid, day });
  }
  return out;
}
await q("delete from sdp_attendance where scholar_id_number = $1", [num(5)]); await q("delete from sdp_reserved_credits where scholar_id_number = $1", [num(5)]).catch(() => {});      // a clean start for the scholar who scans
const codes = await makeCodes([{ day: D1, sid: S1 }, { day: D1, sid: S2 }, { day: D2, sid: S4 }]);
const scan = async (n, code) => { try { return { ok: true, r: (await rows(scholarUid(n), "select public.redeem_attendance_code($1) r", [code]))[0].r }; } catch (e) { return { ok: false, error: String(e.message) }; } };
const pick = (sid, k = 0) => codes.filter(c => c.sid === sid)[k].code;
const sA = await scan(5, pick(S1, 0)), sB = await scan(5, pick(S2, 0)), sAgain = await scan(5, pick(S2, 1)), sC = await scan(5, pick(S4, 0));
const got = await q("select activity_sid as s, activity_day::text as d from sdp_attendance where activity_id = $1 and scholar_id_number = $2 order by occurrence_number", [act, num(5)]);
const stillFree = (await q("select redeemed_by_scholar_id r from attendance_codes where code = $1", [pick(S2, 1)]))[0].r === null;
check("4 by QR code, a scholar scans one code of each session of the same day (both credited, each remembers its session and gives its own sub-name), a second code of the same session is refused and not used up, and a session of the next day still works",
  sA.ok && sB.ok && sC.ok && sA.r.sid === S1 && sB.r.sid === S2 && sB.r.daySubName === "Kahigayonan" && sC.r.daySubName === "ORO Kwento" && !sAgain.ok && /already scanned a code for this day/.test(sAgain.error) && stillFree
  && got.length === 3 && got[0].s === S1 && got[1].s === S2 && got[2].s === S4, JSON.stringify([sA, sB, sAgain, got]));

// 5. undo: back to one credit per date (the columns and the session ids stay)
await db.exec(read(UNDO));
const back = Number((await q("select public._sdp_allowed_occurrences($1) n", [act]))[0].n);
const oldSig = (await q("select to_regprocedure('public.credit_scholar_for_day(uuid,text,date,date,text,text)') f, to_regprocedure('public.credit_scholar_for_day(uuid,text,date,date,text,text,text)') g"))[0];
const kept = Number((await q("select count(*)::int n from sdp_attendance where activity_sid is not null"))[0].n);
check("5 after the undo the credits allowed go back to one per DATE (2 dates = 2), the older form of the credit function is back, and the session ids and the credits made are kept", back === 2 && oldSig.f !== null && oldSig.g === null && kept >= 6, `${back} ${JSON.stringify(oldSig)} ${kept}`);
console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
