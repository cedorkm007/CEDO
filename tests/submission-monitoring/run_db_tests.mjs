// tests/submission-monitoring/run_db_tests.mjs — Forms Management > Submission Files: the Accepted / Needs Resubmission / Pending totals and the
// scholar lists now follow ONE created submission activity (or all), against the real migration files in memory.
// Run:  node tests/submission-monitoring/run_db_tests.mjs   (the website checks are in the same file at the end)
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");

const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const SQL = read("supabase_migration_submission_status_by_activity.sql");
await db.exec(SQL);

const staffUid = name => seedId(`staff:${name}`);
const FORMS = staffUid("demo.admin"), PLAIN = staffUid("demo.plain"), SEAD = staffUid("demo.sead"), COUNSELOR = staffUid("demo.counselor");
const scholarUid = n => seedId(`scholar:${n}`);

async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify({ sub: uid, role })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const fails = async (uid, sql, params, pattern) => { try { await rows(uid, sql, params); return false; } catch (e) { return pattern ? pattern.test(String(e.message)) : true; } };
const q = async (sql, params = []) => (await db.query(sql, params)).rows;

// Two created activities. Scholars 1-4 uploaded to "Photo" (1: accepted + pending, 2: accepted, 3: needs resubmission, 4: pending); scholars 2 and 5 to "Report".
const photo = randomUUID(), report = randomUUID(), empty = randomUUID();
for (const [id, name] of [[photo, "Photo Submission"], [report, "Annual Report"], [empty, "Not Used Yet"]]) await q("insert into submission_activities (id, name, target_year_levels) values ($1, $2, '{}')", [id, name]);
const up = async (n, activity, status, label = "File") => q("insert into submission_uploads (scholar_id, activity_id, field_label_snapshot, status) values ($1, $2, $3, $4)", [scholarUid(n), activity, label, status]);
await up(1, photo, "accepted"); await up(1, photo, "uploaded"); await up(2, photo, "accepted"); await up(3, photo, "needs_resubmission"); await up(4, photo, "uploaded");
await up(2, report, "uploaded"); await up(5, report, "accepted", "Cover"); await up(5, report, "accepted", "Body");
const counts = async (uid, activity) => Object.fromEntries((await rows(uid, "select * from public.submission_files_status_counts($1)", [activity])).map(r => [r.status, Number(r.scholar_count)]));
const list = (uid, status, activity) => rows(uid, "select * from public.submission_files_status_scholars($1, $2)", [status, activity]);

console.log("\nTotals for one created submission activity");
check("Photo Submission: 2 scholars accepted (1 and 2), 1 needs resubmission (3), 2 pending (1 and 4)", JSON.stringify(await counts(FORMS, photo)) === JSON.stringify({ accepted: 2, needs_resubmission: 1, uploaded: 2 }));
check("Annual Report: 1 pending (2) and 1 accepted (5, who has two files but counts once)", await (async () => { const c = await counts(FORMS, report); return c.uploaded === 1 && c.accepted === 1 && c.needs_resubmission === undefined; })());
check("an activity nobody uploaded to has no totals at all (the screen shows zeros)", Object.keys(await counts(FORMS, empty)).length === 0);
check("all activities together count every scholar once per status", await (async () => { const c = await counts(FORMS, null); return c.accepted === 3 && c.uploaded === 3 && c.needs_resubmission === 1; })());

console.log("\nThe scholars behind each total");
const acc = await list(FORMS, "accepted", photo);
check("the Photo list of Accepted has exactly scholars 1 and 2, with how many of their files are accepted and for which activity", acc.length === 2 && acc.every(r => r.activity_names.length === 1 && r.activity_names[0] === "Photo Submission") && acc.some(r => r.scholar_id_number === "TEST-0001" && Number(r.file_count) === 1));
check("the same scholar can be in two lists of one activity (1 is accepted AND pending in Photo)", (await list(FORMS, "uploaded", photo)).map(r => r.scholar_id_number).sort().join() === "TEST-0001,TEST-0004");
check("the list is as long as its total, for every activity and status", await (async () => {
  for (const a of [photo, report, null]) { const c = await counts(FORMS, a); for (const st of ["accepted", "needs_resubmission", "uploaded"]) if ((await list(FORMS, st, a)).length !== (c[st] ?? 0)) return false; }
  return true;
})());
check("a scholar with two accepted files in Annual Report is listed once with 2 files", await (async () => { const r = (await list(FORMS, "accepted", report)); return r.length === 1 && Number(r[0].file_count) === 2; })());
check("all activities: a scholar with files in two activities lists both activity names", await (async () => { const r = (await list(FORMS, "uploaded", null)).find(x => x.scholar_id_number === "TEST-0002"); return !!r && r.activity_names.join("|") === "Annual Report"; })());
check("an unknown status is refused", await fails(FORMS, "select * from public.submission_files_status_scholars('bogus', null)", [], /Unknown status/));

console.log("\nWho may read");
check("staff with the Forms Management tag may; SEAD staff may; staff without either and scholars may not", (await counts(FORMS, photo)).accepted === 2 && (await counts(SEAD, photo)).accepted === 2
  && await fails(PLAIN, "select * from public.submission_files_status_counts(null)", [], /Not authorized/) && await fails(PLAIN, "select * from public.submission_files_status_scholars('accepted', null)", [], /Not authorized/) && await fails(scholarUid(1), "select * from public.submission_files_status_counts(null)", [], /Not authorized/));
check("a Forms Management account that is NOT 'scholar management' can read (the old pair of functions refused such an account)", await (async () => {
  await q("delete from staff_account_tags where staff_id = $1 and tag_key = 'scholar_management'", [FORMS]);
  const c = await counts(FORMS, photo);
  return c.accepted === 2;
})());
check("nothing is open to anonymous callers, and the helper cannot be called directly", await (async () => { try { await as(null, async tx => (await tx.query("select * from public.submission_files_status_counts(null)")).rows, "anon"); return false; } catch (e) { return /permission denied/.test(String(e.message)); } })() && await fails(FORMS, "select public._can_view_submission_files()", [], /permission denied/));
check("the SQL file can be run twice", await (async () => { try { await db.exec(SQL); return true; } catch (e) { console.log("   ", e.message); return false; } })());

console.log("\nThe screen");
const tab = read("src/sead/pages/SubmissionFileBrowserTab.tsx"), panel = read("src/sead/components/SubmissionStatusScholarsPanel.tsx"), api = read("src/sead/submissionActivitiesApi.ts"), roster = read("src/sead/pages/SubmissionRosterPanel.tsx");
check("the totals follow a chosen created activity (the newest by default) with an 'All submission activities' option", /fetchSubmissionActivities\(\)/.test(tab) && /setStatusActivityId\(created\[0\]\?\.id \?\? null\)/.test(tab) && /All submission activities/.test(tab) && /fetchSubmissionUploadStatusCounts\(statusActivityId\)/.test(tab));
check("the list gets the same activity, and has the three exports (CSV, PDF, Word) of exactly the scholars shown", /activityId=\{statusActivityId\}/.test(tab) && /fetchSubmissionScholarsByStatus\(status, activityId\)/.test(panel) && /ExportButtonGroup/.test(panel) && /sorted\.map\(r => exportColumns/.test(panel) && /new jsPDF/.test(panel) && /generateSubmissionRosterReport/.test(panel));
check("the exports say which status, activity and filters they contain", /Status = \$\{label\}/.test(panel) && /Activity = \$\{activityName\}/.test(panel) && /Year Level = /.test(panel) && /Scholar ID/.test(panel));
check("the API uses the new functions and falls back to the old ones only for 'all activities' while the SQL file is not installed", /submission_files_status_counts/.test(api) && /submission_files_status_scholars/.test(api) && /activityId === null && isMissingFunction\(error\)/.test(api) && /latest database update/.test(api));
check("the SQL functions exist, read only, and every file counted belongs to an existing activity", /create or replace function public\.submission_files_status_counts\(p_activity_id uuid default null\)/.test(SQL) && /join public\.submission_activities sa on sa\.id = su\.activity_id/.test(SQL) && !/\b(insert|update|delete)\b/i.test(SQL.replace(/--.*$/gm, "").replace(/'[^']*'/g, "")));
check("the roster's own CSV export writes the file name first and the content second (they were swapped)", /downloadCsv\(`Submission_Roster_/.test(roster) && !/downloadCsv\(csv,/.test(roster));

console.log(`\n${failed === 0 ? "ALL SUBMISSION STATUS CHECKS PASSED" : "SOME CHECKS FAILED"} — ${passed} passed, ${failed} failed`);
await db.close();
process.exit(failed === 0 ? 0 : 1);
