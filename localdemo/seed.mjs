// localdemo/seed.mjs — the hypothetical data for the local demo. Everything here is invented: names start with "TEST", school names
// start with "TEST –", and the throwaway logins below exist only inside the private local database.
import crypto from "node:crypto";
import { hashPassword } from "./jwt.mjs";

export const DEMO_PASSWORD = "Demo#2026";
export const MAIN_PERIOD = { schoolYear: "2025-2026", semester: "2nd Semester" };   // the semester the Phase 1 screens look at
export const CURRENT_PERIOD = MAIN_PERIOD;   // the portals open on the semester that has the TEST grades

export const seedId = key => id(key);
const id = key => { const h = crypto.createHash("sha1").update("localdemo:" + key).digest("hex"); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; };

// ── Schools (one per grading style) ──
const SCHOOLS = [
  { key: "lower", name: "TEST – Lower-Is-Better University", username: "demo.school.lower", submitted: true, cfg: { min: 1, max: 5, dir: "lower_is_better", letters: false, passing: 3.0, retention: 2.0 } },
  { key: "higher", name: "TEST – Higher-Is-Better College", username: "demo.school.higher", submitted: true, cfg: { min: 60, max: 100, dir: "higher_is_better", letters: false, passing: 75, retention: 85 } },
  { key: "letters", name: "TEST – Letter-Grade Institute", username: "demo.school.letters", submitted: false, cfg: { min: 0, max: 4, dir: "higher_is_better", letters: true, passing: 1.0, retention: null },
    letters: [["A", 4], ["B", 3], ["C", 2], ["D", 1], ["F", 0]] },
  { key: "nopass", name: "TEST – No-Passing-Mark School", username: "demo.school.nopass", submitted: true, cfg: { min: 1, max: 5, dir: "lower_is_better", letters: false, passing: null, retention: null } },
];

// ── Staff (one account per role) ──
const STAFF = [
  { username: "demo.admin", first: "TEST", last: "Super Admin", role: "super_admin", sead: true, tags: ["scholar_management", "scholars_grades_monitoring", "sdp_monitoring", "scholar_counseling", "sead_division_head", "scholar_renewal_evaluator", "forms_management"], label: "Super admin (all SEAD tools)" },
  { username: "demo.sead", first: "TEST", last: "SEAD Staff", role: "staff", sead: true, tags: ["scholar_management", "scholars_grades_monitoring", "sdp_monitoring"], label: "SEAD staff (Grades Monitoring, SDP, Scholars)" },
  { username: "demo.counselor", first: "TEST", last: "Counselor", role: "staff", sead: true, tags: ["scholar_counseling"], label: "Scholar counselor" },
  { username: "demo.evaluator", first: "TEST", last: "Renewal Evaluator", role: "staff", sead: true, tags: ["scholar_renewal_evaluator"], label: "Scholar Renewal Evaluator" },
  { username: "demo.divhead", first: "TEST", last: "Division Head", role: "staff", sead: true, tags: ["sead_division_head"], label: "Division Head" },
  { username: "it.admin1", first: "TEST", last: "IT Admin", role: "staff", sead: false, tags: [], label: "IT admin" },
];

// ── SDP activities: category + credits each attendance is worth ──
const ACTS = {
  cs3: { name: "TEST – Community Service Day", category: "community_service", credits: 3 },
  cv3: { name: "TEST – Volunteer Drive", category: "community_volunteerism", credits: 3 },
  fp3: { name: "TEST – Formation Seminar", category: "formation_program", credits: 3 },
  fp2: { name: "TEST – Short Formation Talk", category: "formation_program", credits: 2 },
  fp3b: { name: "TEST – Second Formation Seminar", category: "formation_program", credits: 3 },
};
const FULL_SDP = ["cs3", "cv3", "fp3"];

// ── Scholars: each one shows a different Phase 1 situation (grades are for MAIN_PERIOD) ──
const g = (...marks) => marks;
const SCHOLARS = [
  { n: 1, school: "lower", last: "All Passed", grades: g("1.5", "2.0", "1.75", "2.25"), sdp: FULL_SDP },
  { n: 2, school: "lower", last: "Equal To Passing Mark", grades: g("3.0", "1.5", "2.0"), sdp: FULL_SDP },
  { n: 3, school: "lower", last: "One Failed", grades: g("5.0", "1.5", "2.0"), sdp: FULL_SDP },
  { n: 4, school: "lower", last: "Two Failed", grades: g("5.0", "3.25", "1.5"), sdp: FULL_SDP },
  { n: 5, school: "lower", last: "One Failed Previous Probation", grades: g("5.0", "1.5", "2.0"), sdp: FULL_SDP, status: "Probationary", probation: "regular" },
  { n: 6, school: "lower", last: "Has DRP", grades: g("DRP", "1.5", "2.0"), sdp: FULL_SDP },
  { n: 7, school: "lower", last: "Has INC", grades: g("INC", "1.5", "2.0"), sdp: FULL_SDP },
  { n: 8, school: "lower", last: "Waiting For A Grade", grades: g("1.5", null, "2.0"), sdp: FULL_SDP },
  { n: 9, school: "lower", last: "Needs Review", grades: g("W", "1.5", "2.0"), sdp: FULL_SDP },
  { n: 10, school: "lower", last: "SDP Short", grades: g("1.5", "2.0", "1.75"), sdp: ["cs3", "cv3", "fp2"] },
  { n: 11, school: "lower", last: "On Leave", grades: g(), sdp: [], status: "On leave" },
  { n: 12, school: "lower", last: "Removed", grades: g(), sdp: [], status: "Removed" },
  { n: 13, school: "lower", last: "Reconsidered One Failed", grades: g("5.0", "1.5"), sdp: FULL_SDP, status: "Reconsidered" },
  { n: 14, school: "higher", last: "Higher Passed", grades: g("88", "92", "79", "85"), sdp: FULL_SDP },
  { n: 15, school: "higher", last: "Higher Failed", grades: g("70", "90", "82"), sdp: FULL_SDP },
  { n: 16, school: "letters", last: "Letter Passed", grades: g("A", "B", "D", "C"), sdp: FULL_SDP },
  { n: 17, school: "letters", last: "Letter Failed", grades: g("F", "B", "A"), sdp: FULL_SDP },
  { n: 18, school: "nopass", last: "No Passing Mark", grades: g("1.5", "2.0", "5.0"), sdp: FULL_SDP },
  // more of the user's Phase 1 scenarios (numbers in the walkthrough table)
  { n: 19, school: "lower", last: "SDP Met By Carry-Over", grades: g("1.5", "2.0"), sdp: ["cs3", "cv3"], sdp1: ["fp3", "fp3b"] },
  { n: 20, school: "lower", last: "Failed In Excluded Subject", grades: g("1.5", ["5.0", true], "2.0"), sdp: FULL_SDP },
  { n: 21, school: "lower", last: "DRP And Failed", grades: g("DRP", "5.0", "1.5"), sdp: FULL_SDP },
  { n: 22, school: "lower", last: "Failed And INC", grades: g("5.0", "INC", "1.5"), sdp: FULL_SDP },
  { n: 23, school: "lower", last: "INC Now Failing", grades: g("5.0", "1.5", "2.0"), sdp: FULL_SDP, remarkFirst: "Was INC, now graded" },
  { n: 24, school: "lower", last: "Past Temporary Probation Lifted", grades: g("5.0", "2.0"), sdp: FULL_SDP, probation: "temporary-lifted" },
  { n: 25, school: "lower", last: "INC Then Probationary", grades: g("5.0", "2.0"), sdp: FULL_SDP, status: "Probationary", probation: "temporary-then-regular" },
  // Phase 2 scholars
  { n: 26, school: "lower", last: "INC Deadline Set", grades: g("INC", "1.5"), sdp: FULL_SDP, renewal: { window: "w1", inc: { consult: -2, days: 14 } } },
  { n: 27, school: "lower", last: "INC To Resolve Failing", grades: g("INC", "1.5"), sdp: FULL_SDP, renewal: { window: "w1", inc: { consult: -2, days: 14 } } },
  { n: 28, school: "lower", last: "INC Deadline Passed", grades: g("INC", "1.5"), sdp: FULL_SDP, renewal: { window: "w1", inc: { consult: -40, days: 30 } } },
  { n: 29, school: "lower", last: "Late Application", grades: g(), sdp: [], basis2024: true, renewal: { window: "w3" } },
  { n: 30, school: "lower", last: "Summer All Passed No SDP", grades: g("1.5", "2.0"), sdp: [] },
  { n: 31, school: "letters", last: "Summer Incomplete Grades", grades: g("A", "B"), sdp: FULL_SDP },
  { n: 33, school: "lower", last: "INC 30 Days Given", grades: g("INC", "1.5"), sdp: FULL_SDP, renewal: { window: "w1", inc: { consult: -5, days: 30 } } },
  // Phase 3 scholars: each has a consultation booked with demo.counselor at a different time, so every appointment action can be tried
  { n: 34, school: "lower", last: "Consult INC Today", grades: g("INC", "1.5"), sdp: FULL_SDP, renewal: { window: "w1" }, booking: { hours: -0.7 } },
  { n: 35, school: "lower", last: "Consult One Failed Today", grades: g("5.0", "1.5"), sdp: FULL_SDP, renewal: { window: "w1", plan: "accepted" }, booking: { hours: -1.2 } },
  { n: 36, school: "lower", last: "Consult Summer Today", grades: g("1.5", "2.0"), sdp: [], renewal: { window: "w2", prospectus: true }, booking: { hours: -1.7 } },
  { n: 37, school: "lower", last: "Consult Tomorrow", grades: g("5.0", "1.5"), sdp: FULL_SDP, renewal: { window: "w1", plan: "accepted" }, booking: { hours: 30 } },
  { n: 38, school: "lower", last: "Consult Under 12 Hours", grades: g("5.0", "1.5"), sdp: FULL_SDP, renewal: { window: "w1", plan: "accepted" }, booking: { hours: 8 } },
  // study plan uploaded, waiting for the evaluator's approval: the scholar cannot book until it is approved
  // INC letter uploaded, waiting for the evaluator's approval: the scholar cannot book until it is approved
  { n: 40, school: "lower", last: "INC Letter To Approve", grades: g("INC", "1.5"), sdp: FULL_SDP, renewal: { window: "w1", letter: "submitted" } },
  { n: 39, school: "lower", last: "Study Plan To Approve", grades: g("5.0", "1.5"), sdp: FULL_SDP, renewal: { window: "w1", plan: "submitted" } },
];
export const SCHOLAR_LAST = Object.fromEntries(SCHOLARS.map(s => [s.n, s.last]));
const SUBJECTS = ["Mathematics", "English", "Science", "History"];
const REMARKS = { 23: ["Was INC, now graded", null, null], 3: ["Failed the major subject", null, null], 6: ["Dropped in week 3", null, null], 7: ["Missing final project", null, null] };
const sidNum = n => `TEST-${String(n).padStart(4, "0")}`;

export const ACCOUNTS = {
  staff: STAFF.map(s => ({ role: s.label, login: s.username })),
  schools: SCHOOLS.map(s => ({ role: `School portal – ${s.name}`, login: s.username })),
  scholars: SCHOLARS.map(s => ({ role: `Scholar – ${s.last}`, login: sidNum(s.n) })),
  password: DEMO_PASSWORD,
};

export async function seedDb(db) {
  const hash = hashPassword(DEMO_PASSWORD);   // one shared throwaway password (hashing per account would only slow the build)
  const authUser = async (uid, email) => db.query(
    "insert into auth.users (id, email, encrypted_password) values ($1, $2, $3) on conflict (id) do nothing", [uid, email, hash]);

  // Periods
  const period = {};
  for (const [sy, term] of [["2025-2026", "1st Semester"], ["2025-2026", "2nd Semester"], ["2025-2026", "Summer"], ["2026-2027", "1st Semester"]]) {
    const pid = id(`period:${sy}:${term}`);
    await db.query("insert into academic_periods (id, school_year, term, status) values ($1,$2,$3,'open') on conflict (id) do nothing", [pid, sy, term]);
    period[`${sy}|${term}`] = pid;
  }
  await db.query("insert into grading_period_settings (id, current_school_year, current_semester) values (true,$1,$2) on conflict (id) do update set current_school_year = excluded.current_school_year, current_semester = excluded.current_semester",
    [CURRENT_PERIOD.schoolYear, CURRENT_PERIOD.semester]);
  const mainPeriodId = period[`${MAIN_PERIOD.schoolYear}|${MAIN_PERIOD.semester}`];

  // Schools + their login + grading rules
  for (const s of SCHOOLS) {
    const sid = id(`school:${s.key}`), uid = id(`schoolacct:${s.key}`), email = `${s.username.replace(/\./g, "-")}@demo.local`;
    await db.query("insert into schools (id, name) values ($1,$2) on conflict (id) do nothing", [sid, s.name]);
    await authUser(uid, email);
    await db.query("insert into school_accounts (id, school_id, email, username) values ($1,$2,$3,$4) on conflict (id) do nothing", [uid, sid, email, s.username]);
    await db.query(`insert into school_grading_configs (school_id, scale_min, scale_max, direction, uses_letter_grades, retention_threshold, passing_mark)
      values ($1,$2,$3,$4,$5,$6,$7) on conflict (school_id) do nothing`, [sid, s.cfg.min, s.cfg.max, s.cfg.dir, s.cfg.letters, s.cfg.retention, s.cfg.passing]);
    for (const [letter, value] of s.letters ?? []) await db.query("insert into school_letter_grades (school_id, letter, numeric_value) values ($1,$2,$3)", [sid, letter, value]);
    if (s.submitted) await db.query("insert into school_period_submissions (school_id, period_id, status, submitted_at) values ($1,$2,'submitted', now())", [sid, mainPeriodId]);
  }

  // Staff
  const divCode = (await db.query("select code from divisions order by code limit 1")).rows[0]?.code ?? "SEAD";
  for (const u of STAFF) {
    const uid = id(`staff:${u.username}`), email = `${u.username.replace(/\./g, "-")}@demo.local`;
    await authUser(uid, email);
    await db.query(`insert into users (id, username, last_name, first_name, middle_name, suffix, nickname, designation, position, nature_of_work, mobile_phone, email, division, role, profile_picture, is_sead_staff)
      values ($1,$2,$3,$4,'','','','','','','',$5,$6,$7,'',$8) on conflict (id) do nothing`, [uid, u.username, u.last, u.first, email, divCode, u.role, u.sead]);
    for (const tag of u.tags) await db.query("insert into staff_account_tags (staff_id, tag_key) values ($1,$2)", [uid, tag]);
  }

  // SDP activities
  const actId = {};
  for (const [key, a] of Object.entries(ACTS)) {
    actId[key] = id(`act:${key}`);
    await db.query(`insert into sdp_activities (id, name, category, nature, source_of_fund, objectives, target_partners, specific_role, work_plan, program_flow, budget_items, recurring_dates, credits, all_year_levels, target_year_levels, target_barangays, target_clusters)
      values ($1,$2,$3,'[]','[]','[]','[]','[]','[]','[]','[]','[]',$4,true,'{}','{}','{}') on conflict (id) do nothing`, [actId[key], a.name, a.category, a.credits]);
  }

  // Scholars
  for (const s of SCHOLARS) {
    const sch = SCHOOLS.find(x => x.key === s.school);
    const sid = id(`school:${s.school}`), uid = id(`scholar:${s.n}`), num = sidNum(s.n), email = `test-${String(s.n).padStart(4, "0")}@demo.local`;
    await authUser(uid, email);
    await db.query(`insert into scholars (id, scholar_id_number, first_name, last_name, middle_name, birthday, email, contact_no, school, course, status, barangay, year_level, house_unit_no, street, city_municipality, province_region, country, zip_code, school_id,
        emergency_contact_name, emergency_contact_relationship, emergency_contact_number)
      values ($1,$2,'TEST',$3,'T','2005-05-05',$4,'09170000000',$5,'BS Test Studies',$6,'Barangay Test','2nd Year','1','Test Street','Test City','Test Province','Philippines','0000',$7,'TEST Guardian','Parent','09170000001')
      on conflict (id) do nothing`, [uid, num, s.last, email, sch.name, s.status ?? "Regular", sid]);
    // grades for the main semester
    for (let i = 0; i < s.grades.length; i++) {
      const rem = REMARKS[s.n]?.[i] ?? "";
      const [mark, excluded] = Array.isArray(s.grades[i]) ? s.grades[i] : [s.grades[i], false];
      await db.query(`insert into scholar_subjects_grades (scholar_id_number, school_year, semester, subject, subject_code, grade, remarks, units, recorded_by_school_id, period_id, exclude_from_gwa)
        values ($1,$2,$3,$4,$5,$6,$7,3,$8,$9,$10)`, [num, MAIN_PERIOD.schoolYear, MAIN_PERIOD.semester, excluded ? "TEST – NSTP (excluded from GWA)" : `TEST – ${SUBJECTS[i]}`, `TST${100 + i}`, mark, rem ?? "", sid, mainPeriodId, excluded]);
    }
    // SDP attendance in the main semester
    for (const k of s.sdp) await db.query("insert into sdp_attendance (activity_id, scholar_id_number, attended_date, school_year, semester) values ($1,$2,'2026-04-15',$3,$4)", [actId[k], num, MAIN_PERIOD.schoolYear, MAIN_PERIOD.semester]);
    for (const k of s.sdp1 ?? []) await db.query("insert into sdp_attendance (activity_id, scholar_id_number, attended_date, school_year, semester) values ($1,$2,'2025-10-15',$3,'1st Semester')", [actId[k], num, MAIN_PERIOD.schoolYear]);
    const addHistory = (status, prev, temporary, term, when, note) => db.query(`insert into scholar_status_history (scholar_id_number, status, previous_status, is_temporary, school_year, term, source, note, changed_at)
      values ($1,$2,$3,$4,'2025-2026',$5,'manual',$6,$7)`, [num, status, prev, temporary, term, note, when]);
    if (s.probation === "temporary-lifted") { await addHistory("Probationary", "Regular", true, "1st Semester", "2025-12-01", "TEST – temporary probation while an INC was open"); await addHistory("Regular", "Probationary", false, "1st Semester", "2026-01-15", "TEST – INC resolved, probation lifted"); }
    if (s.probation === "temporary-then-regular") { await addHistory("Probationary", "Regular", true, "1st Semester", "2025-12-01", "TEST – temporary probation while an INC was open"); await addHistory("Probationary", "Probationary", false, "1st Semester", "2026-01-15", "TEST – INC turned into a failing grade: regular probation"); }
    // a regular (non-temporary) probation earlier, so "previous probation" is true for this scholar
    if (s.probation === "regular") {
      await db.query(`insert into scholar_status_history (scholar_id_number, status, previous_status, is_temporary, school_year, term, source, note, changed_at)
        values ($1,'Probationary','Regular',false,'2025-2026','1st Semester','manual','TEST – earlier probation', '2025-12-01')`, [num]);
    }
  }
  // ── Phase 2: renewal windows, an earlier semester for the late-application scholar, and a few applications made through the real functions ──
  const day = n => { const d = new Date(Date.now() + 8 * 3600 * 1000 + n * 86400000); return d.toISOString().slice(0, 10); };   // Manila date, n days from today
  const windows = { w1: ["2026-2027", "1st Semester", day(-12), day(18)], w2: ["2025-2026", "Summer", day(-12), day(18)], w3: ["2025-2026", "1st Semester", day(-120), day(-100)] };
  const windowId = {};
  for (const [k, [sy, term, opens, closes]] of Object.entries(windows)) {
    windowId[k] = id(`window:${k}`);
    await db.query("insert into renewal_windows (id, school_year, term, opens_on, closes_on, late_allowed, created_by) values ($1,$2,$3,$4,$5,true,$6)", [windowId[k], sy, term, opens, closes, id("staff:demo.evaluator")]);
  }
  // Scholar 29 applies late for 1st Semester 2025-2026, which is judged on 2nd Semester 2024-2025: give them those grades and SDP credits.
  const lowerId = id("school:lower"), p2425 = id("period:2024-2025:2nd Semester");
  await db.query("insert into academic_periods (id, school_year, term, status) values ($1,'2024-2025','2nd Semester','closed') on conflict (id) do nothing", [p2425]);
  await db.query("insert into school_period_submissions (school_id, period_id, status, submitted_at) values ($1,$2,'submitted', now())", [lowerId, p2425]);
  for (const [i, mark] of ["1.5", "2.0"].entries()) {
    await db.query(`insert into scholar_subjects_grades (scholar_id_number, school_year, semester, subject, subject_code, grade, remarks, units, recorded_by_school_id, period_id)
      values ($1,'2024-2025','2nd Semester',$2,$3,$4,'',3,$5,$6)`, [sidNum(29), `TEST – ${SUBJECTS[i]}`, `TST${100 + i}`, mark, lowerId, p2425]);
  }
  for (const k of FULL_SDP) await db.query("insert into sdp_attendance (activity_id, scholar_id_number, attended_date, school_year, semester) values ($1,$2,'2025-04-15','2024-2025','2nd Semester')", [actId[k], sidNum(29)]);

  // Run a function as a signed-in person (the database reads who is calling from this setting).
  const as = async (uid, fn) => db.transaction(async tx => { await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]); return fn(tx); });
  const inc = {};
  for (const s of SCHOLARS.filter(x => x.renewal)) {
    const w = windows[s.renewal.window], sch = SCHOOLS.find(x => x.key === s.school);
    const rid = await as(id(`scholar:${s.n}`), async tx => (await tx.query("select public.renewal_apply($1, $2, 'BS Test Studies', '2nd Year', '') as r", [windowId[s.renewal.window], sch.name])).rows[0].r);
    if (s.renewal.inc) inc[s.n] = rid;
  }
  // The consultation staff set the days to comply (the Daily Record does this in the next phase).
  for (const s of SCHOLARS.filter(x => x.renewal?.inc)) {
    await as(id("staff:demo.counselor"), async tx => {
      const item = (await tx.query("select id from renewal_inc_items where record_id = $1", [inc[s.n]])).rows[0];
      await tx.query("select public.renewal_set_inc_deadline($1, $2::date, $3, '')", [item.id, day(s.renewal.inc.consult), s.renewal.inc.days]);
    });
  }
  // ── Phase 3: consultation availability (real function) and the bookings above (inserted directly: some are in the past or under 12 hours away) ──
  const slotOnDay = (days, hour) => new Date(`${day(days)}T${String(hour).padStart(2, "0")}:00:00+08:00`).toISOString();
  for (const d of [1, 2, 3, 4, 6]) await as(id("staff:demo.counselor"), async tx => tx.query("select public.counseling_availability_save(null, $1, $2, false)", [slotOnDay(d, 9), slotOnDay(d, 11)]));
  for (const d of [1, 3]) await as(id("staff:demo.admin"), async tx => tx.query("select public.counseling_availability_save(null, $1, $2, false)", [slotOnDay(d, 13), slotOnDay(d, 14)]));
  for (const s of SCHOLARS.filter(x => x.booking)) {
    const rec = (await db.query("select id from renewal_records where scholar_id_number = $1 order by created_at desc limit 1", [sidNum(s.n)])).rows[0].id;
    const start = new Date(Date.now() + s.booking.hours * 3600000), end = new Date(start.getTime() + 600000);
    const counselor = id("staff:demo.counselor");
    const av = (await db.query("insert into counseling_availability (staff_id, starts_at, ends_at) values ($1,$2,$3) returning id", [counselor, start.toISOString(), end.toISOString()])).rows[0].id;
    await db.query(`insert into counseling_slots (availability_id, staff_id, starts_at, ends_at, state, record_id, scholar_id_number, booked_at, reminded_day_at)
      values ($1,$2,$3,$4,'booked',$5,$6, now() - interval '2 days', $7)`, [av, counselor, start.toISOString(), end.toISOString(), rec, sidNum(s.n), s.booking.hours > 0 && s.booking.hours < 24 ? null : new Date().toISOString()]);   // a booking within the next day has not had its 1-day reminder yet: the demo scheduler sends it
    await db.query("insert into counseling_booking_history (record_id, scholar_id_number, slot_starts_at, staff_id, action, actor_label) values ($1,$2,$3,$4,'booked','Scholar')", [rec, sidNum(s.n), start.toISOString(), counselor]);
    if (s.renewal.prospectus) await seedDoc(rec, s.n, "prospectus", "submitted");
  }
  // uploaded documents (a small real PDF is stored so the link opens)
  async function seedDoc(rec, n, kind, status) {
    const path = `${sidNum(n)}/${rec}/${kind}/seed-${kind}.pdf`;
    await db.query("insert into storage.buckets (id, name, public) values ('renewal-documents','renewal-documents', false) on conflict (id) do nothing");
    await db.query("insert into storage.objects (bucket_id, name, metadata) values ('renewal-documents', $1, $2::jsonb)", [path, JSON.stringify({ mimetype: "application/pdf", size: 24, base64: Buffer.from("%PDF-1.4 demo " + kind).toString("base64") })]);
    await db.query("insert into renewal_documents (record_id, scholar_id_number, kind, storage_path, file_name, mime_type, size_bytes, status) values ($1,$2,$3,$4,$5,'application/pdf',24,$6)",
      [rec, sidNum(n), kind, path, `${kind.replace("_", "-")}.pdf`, status]);
  }
  for (const s of SCHOLARS.filter(x => x.renewal?.letter)) {
    const rec = (await db.query("select id from renewal_records where scholar_id_number = $1 order by created_at desc limit 1", [sidNum(s.n)])).rows[0].id;
    await seedDoc(rec, s.n, "inc_letter", s.renewal.letter);
  }
  for (const s of SCHOLARS.filter(x => x.renewal?.plan)) {
    const rec = (await db.query("select id from renewal_records where scholar_id_number = $1 order by created_at desc limit 1", [sidNum(s.n)])).rows[0].id;
    await seedDoc(rec, s.n, "study_plan", s.renewal.plan);
  }
  // The blank study plan form, as the office would add it in Forms Management (the Renewal tile links to it).
  const formId = id("form:study-plan");
  await db.query("insert into form_materials (id, title, kind, url, description, file_name) values ($1, 'Study Plan Form', 'pdf', '', 'Fill this in and upload it with your renewal.', 'study-plan-form.pdf')", [formId]);
  await db.query("insert into form_material_conditions (material_id, condition_type, all_year_levels) values ($1, 'year_level', true)", [formId]);
  await db.query("insert into storage.buckets (id, name, public) values ('form-materials','form-materials', false) on conflict (id) do nothing");
  await db.query("insert into storage.objects (bucket_id, name, metadata) values ('form-materials', $1, $2::jsonb)", [`${formId}/file.pdf`, JSON.stringify({ mimetype: "application/pdf", size: 30, base64: Buffer.from("%PDF-1.4 demo study plan form (general)").toString("base64") })]);
  // Each school has its own study plan template, uploaded in Forms Management > "Renewal study plans": one for every school that has its own,
  // and a default for the rest (here the lower-is-better school has its own; the other three use the default).
  const template = async (schoolKey, ext, label) => {
    const path = `${schoolKey ? id("school:" + schoolKey) : "default"}/${id("template:" + (schoolKey ?? "default"))}.${ext}`;
    const mime = ext === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    await db.query("insert into storage.objects (bucket_id, name, metadata) values ('renewal-study-plan-forms', $1, $2::jsonb)", [path, JSON.stringify({ mimetype: mime, size: 40, base64: Buffer.from("%PDF-1.4 demo study plan template (" + label + ")").toString("base64") })]);
    await as(id("staff:demo.admin"), async tx => { await tx.query("select public.renewal_study_plan_form_save($1, $2, $3)", [schoolKey ? id("school:" + schoolKey) : null, path, `${label}.${ext}`]); });
  };
  await template(null, "pdf", "study-plan-template-default");
  await template("lower", "pdf", "study-plan-template-lower-is-better");

  // Loading the scholars made the status-history trigger record a "System" row dated today for each one; the real database has none until a status changes.
  await db.query("delete from scholar_status_history where source = 'system'");
}
