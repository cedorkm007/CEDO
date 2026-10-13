// localdemo/seed.mjs — the hypothetical data for the local demo. Everything here is invented: names start with "TEST", school names
// start with "TEST –", and the throwaway logins below exist only inside the private local database.
import crypto from "node:crypto";
import { hashPassword } from "./jwt.mjs";

export const DEMO_PASSWORD = "Demo#2026";
export const MAIN_PERIOD = { schoolYear: "2025-2026", semester: "2nd Semester" };   // the semester the Phase 1 screens look at
export const CURRENT_PERIOD = MAIN_PERIOD;   // the portals open on the semester that has the TEST grades

const id = key => { const h = crypto.createHash("sha1").update("localdemo:" + key).digest("hex"); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; };

// ── Schools (one per grading style) ──
const SCHOOLS = [
  { key: "lower", name: "TEST – Lower-Is-Better University", username: "demo.school.lower", submitted: false, cfg: { min: 1, max: 5, dir: "lower_is_better", letters: false, passing: 3.0, retention: 2.0 } },
  { key: "higher", name: "TEST – Higher-Is-Better College", username: "demo.school.higher", submitted: true, cfg: { min: 60, max: 100, dir: "higher_is_better", letters: false, passing: 75, retention: 85 } },
  { key: "letters", name: "TEST – Letter-Grade Institute", username: "demo.school.letters", submitted: false, cfg: { min: 0, max: 4, dir: "higher_is_better", letters: true, passing: 1.0, retention: null },
    letters: [["A", 4], ["B", 3], ["C", 2], ["D", 1], ["F", 0]] },
  { key: "nopass", name: "TEST – No-Passing-Mark School", username: "demo.school.nopass", submitted: true, cfg: { min: 1, max: 5, dir: "lower_is_better", letters: false, passing: null, retention: null } },
];

// ── Staff (one account per role) ──
const STAFF = [
  { username: "demo.admin", first: "TEST", last: "Super Admin", role: "super_admin", sead: true, tags: ["scholar_management", "scholars_grades_monitoring", "sdp_monitoring", "scholar_counseling", "sead_division_head"], label: "Super admin (all SEAD tools)" },
  { username: "demo.sead", first: "TEST", last: "SEAD Staff", role: "staff", sead: true, tags: ["scholar_management", "scholars_grades_monitoring", "sdp_monitoring"], label: "SEAD staff (Grades Monitoring, SDP, Scholars)" },
  { username: "demo.counselor", first: "TEST", last: "Counselor", role: "staff", sead: true, tags: ["scholar_counseling"], label: "Scholar counselor" },
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
  { n: 24, school: "lower", last: "Past Temporary Probation Lifted", grades: g("1.5", "2.0"), sdp: FULL_SDP, probation: "temporary-lifted" },
  { n: 25, school: "lower", last: "INC Then Probationary", grades: g("1.75", "2.0"), sdp: FULL_SDP, status: "Probationary", probation: "temporary-then-regular" },
];
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
  // Loading the scholars made the status-history trigger record a "System" row dated today for each one; the real database has none until a status changes.
  await db.query("delete from scholar_status_history where source = 'system'");
}
