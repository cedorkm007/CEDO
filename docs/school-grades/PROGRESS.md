# Scholar Grades improvements — progress log

Seven phases, each delivered as a folder mirroring repo paths + a zip in `_deliverables/`, and each confirmed by the owner before the next starts.

1. Fix manual grade entry not showing saved grades (+ test)  ← **Phase 1**
2. Academic periods + period selectors (+ data migration)
3. Bulk CSV with period selection and validate-then-save
4. Units-weighted GWA
5. School Portal design revisions
6. Submission and locking, audit trail, supporting documents
7. Scholarship standing, cleanup tools, logins, search, exports

---

## 2026-10-09 — Phase 1: investigation (read-only)

Read: `src/school/*` (schoolApi, ScholarGradeEntryModal, ScholarsDrilldownPanel, BulkGradeUploadModal, GradingConfigPanel, SchoolPortalPage), `src/sead/ScholarsGradesMonitoring*`, `src/sead/components/ScholarGradesTable.tsx`, `src/scholar/.../SubjectsGradesPanel.tsx`, `src/lib/gwa.ts`, `supabase_migration_scholars_grades_monitoring.sql`, and the live data (service-role, read-only).

Findings, in the order the owner asked:
- **School year/semester on save vs. the period the table filters by:** match. Both grade rows in the database are `2026-2027 / 1st Semester`, the same as `grading_period_settings`.
- **Database read rules vs. write rules:** the policy `school manages own scholars grades` is `FOR ALL` with the same `exists (scholars … school_id = current_school_id())` test on USING and WITH CHECK, so whatever a school can write it can read. (Live policy text can drift from the tracked SQL in this codebase; `tests/school-grades/rls_round_trip.sql` re-checks it against the live database.)
- **Wrong/duplicate scholar record:** no. The school account `test` has exactly one scholar (`007`), linked to that school; both grade rows are on `007`.
- **Silent failure / no refresh:** YES — this is the cause. The save works; the screen never shows it:
  1. The school's scholar table has only Scholar ID / Name / Enter Grades columns — there is no place a saved grade could appear.
  2. After Save the entry modal just closes (`onClose()`); nothing is re-read and no confirmation is shown.
  3. `fetchScholarGrades` swallows errors and returns `[]`, so a failed read looks like "no grades".
  4. The trash button only removes the row from the screen; the database row stays and comes back next time.
  5. Rows with a blank subject name are silently dropped on Save.

Plan: show Subjects / Graded / GWA per scholar in the table for the current period, keep the entry modal open after saving, re-read from the database and verify each saved row, show "Saved: 1.75 · 1st Semester 2026-2027", delete removed rows for real, block blank-subject rows with a message, surface read errors. No database changes.

## 2026-10-09 — Phase 1: changes made (no database changes)

- `src/school/gradeSaveLogic.ts` (new): pure rules — confirmation text, read-back check, blank-subject check, per-scholar Subjects/Graded/GWA summary.
- `src/school/schoolApi.ts`: added `fetchScholarGradesChecked` (reports a failed read), `fetchGradesForScholars` (paged, > 1000 rows), `deleteGradeRows` (verifies the delete count). `fetchScholarGrades` unchanged for existing callers (BulkGradeUploadModal).
- `src/school/components/ScholarGradeEntryModal.tsx`: stays open after Save, re-reads and verifies, shows "Saved: 1.75 · 1st Semester 2026-2027", really deletes removed subjects on Save, blocks blank-subject rows with a message, shows load errors, labels inputs.
- `src/school/components/ScholarsDrilldownPanel.tsx`: new Subjects / Graded / GWA columns for the current period (read back from the database), refreshes after a save or bulk upload, shows load errors with Retry and a notice when no period is set.
- Tests: `tests/school-grades/run.mjs` (13 logic checks, pass), `tests/school-grades/rls_round_trip.sql` (6 checks; passes against the migration's real policies in a scratch Postgres; to be run once against the live database by the owner).
- Verification: `tsc -b --force` clean, eslint clean on `src/school` and `tests/school-grades`. Not exercised in a browser (no school login available to the assistant).

## 2026-10-09 — Phase 1 confirmed by the owner; Phase 2 started
- Owner decision: existing subjects without units count as **1 unit** (Phase 4), and are still flagged for the school to complete.
- Phase 2 read-through done: BulkGradeUploadModal (fetches current period itself), SubjectsGradesPanel (groups by "year — semester", no selector), ScholarsGradesMonitoring page/tabs (Schools tab uses the current period prop; Scholars tab shows all periods), monitoring RPCs already take (year, semester) text so only the UI needs a selector there, SDP uses grading_period_settings text columns.

## 2026-10-09 — Phase 2: academic periods (built, awaiting the owner's migration run + confirmation)

Database — `supabase_migration_academic_periods.sql` (nothing deleted; safe to re-run):
- New `academic_periods` (school_year, term = 1st Semester / 2nd Semester / Summer, status open / closed / archived, optional submission_deadline). Any signed-in account can read; only staff with `scholars_grades_monitoring` change it, via RPCs.
- `scholar_subjects_grades.period_id` (+ `legacy_semester`). Existing grades are linked, not moved: the current grading period becomes an Open period; every other (year, semester) already holding grades becomes a Closed period. Spelling variants of a semester ("2nd Sem", "First Semester", "Midyear") are rewritten to the standard term, original kept in `legacy_semester`. A semester label that is not recognisable is left exactly as written and unlinked (reported by the result query at the end of the migration).
- Guard trigger: a SCHOOL account can only add/change/delete grades in an Open period; a missing, Closed or Archived period is refused with a clear message. Staff/other writers are not restricted (a write to a brand-new period creates it, Open). New rows always get `period_id`.
- `upsert_academic_period()` (staff) and an updated `set_current_grading_period()` (validates year/term, creates the period if new, refuses Archived, stores the standard term). The SDP credit period still reads the same settings row.

App:
- Staff Scholars' Grades Monitoring: "Viewing period" dropdown (default = current) for both subtabs; "Manage periods" modal (add, open/close/archive, deadline); changing the Current Grading Period now asks for confirmation and warns it also changes the SDP credit period; the Scholars tab's View Grades shows the selected period with a "Show all periods" toggle.
- School Portal > Scholars: period dropdown with status/deadline; grade entry and bulk upload follow the selected period and are read-only/disabled when it is not Open.
- Scholar Subjects and Grades: period dropdown (current period if the scholar has grades in it, else "All periods").
- New: `src/lib/academicPeriods.ts`, `src/lib/academicPeriodsApi.ts`, `src/app/components/PeriodSelect.tsx`, `src/sead/components/AcademicPeriodsModal.tsx`.

Verification: `tsc -b --force` and eslint clean; `node tests/school-grades/run.mjs` 20/20; migration + guard checked in a scratch Postgres against messy legacy data (all pass, re-run safe, no rows lost); `tests/school-grades/periods_guard.sql` for the live database; SQL and TypeScript term normalizers agree on 36 inputs. Not exercised in a browser (no school/staff login available to the assistant).

## 2026-10-09 — Phase 2 confirmed by the owner; Phase 3 started (bulk CSV, validate-then-save)

## 2026-10-09 — Phase 3: bulk CSV, validate-then-save (built, awaiting the owner's migration run + confirmation)

Database — `supabase_migration_bulk_grades_validation.sql` (run AFTER the Phase 2 migration; nothing deleted; safe to re-run):
- `scholar_subjects_grades.units` (optional, > 0). Stored now because the template has a units column; Phase 4 uses it for the weighted GWA (blank = 1 unit there).
- `_school_grade_error()` + the Phase 2 guard trigger now also check, for SCHOOL accounts only, that a grade is on the school's own scale (numeric within min-max) or in its letter table (if letters are on). Blank is always fine. A school with no saved grading scale cannot save a grade (blank "declared" subjects are still allowed). Checked on insert, and on update only when the grade itself changes. This makes the rule hold for the bulk upload, the grade-entry screen and any direct write.
- `upsert_scholar_subject_grade()` gained an optional `p_units` (updates keep stored units when it is omitted); `bulk_upsert_scholar_subject_grades()` passes units through. Old 7-argument calls still work.

App:
- `src/school/bulkGradeLogic.ts` (new, pure): template builder, whole-file checks (period Open, grading scale exists, required columns, EVERY row's school_year/semester must equal the chosen period or the whole file is rejected), per-row checks (scholar ID must be one of the school's scholars — matched by ID, never name; grade on scale/letters; units positive; no duplicate scholar+subject code (or name when no code)), warnings (overwrites an existing grade; blank grade keeps the existing one; subject name changes; name in file doesn't resemble the scholar on that ID), preview counts, payload, summary text and error report.
- `BulkGradeUploadModal.tsx` (rewritten): 1 choose an Open period -> 2 download the pre-filled template -> 3 upload -> 4 preview every row (Valid / Warning / Error / No change, with reasons, filterable) with NOTHING saved -> "Save valid rows" or Cancel -> summary ("48 saved, 2 skipped") + "Download error report (CSV)" listing skipped rows and rows the database refused.
- `ScholarsDrilldownPanel.tsx`: the Bulk Upload button now sits in the period bar (all levels) and uploads for the whole school, not just one year level/program.
- `schoolApi.ts` / `types.ts`: units added to rows and calls.

Verification: tsc + eslint clean; `node tests/school-grades/run.mjs` 42/42; migration checked in a scratch Postgres on top of Phases 1-2 (30 checks, all pass, re-run safe, earlier live tests still pass); `bulk_grades_guard.sql` for the live database; modal server-rendered in three states without errors. Not exercised in a browser (no school login available to the assistant).

## 2026-10-09 — Phase 3 confirmed by the owner; Phase 4 started (units-weighted GWA)

## 2026-10-09 — Phase 4: units-weighted GWA (built, awaiting the owner's migration run + confirmation)

Owner decision applied: a subject with no units counts as **1 unit** and is flagged for the school to complete.

Database — `supabase_migration_gwa_units_exclude.sql` (run AFTER the Phase 3 migration; nothing changed in existing rows; safe to re-run):
- `scholar_subjects_grades.exclude_from_gwa boolean not null default false` — every existing subject keeps counting.
- `upsert_scholar_subject_grade()` gains optional `p_exclude_from_gwa` (omitted/null keeps the stored flag; a new subject starts false); `bulk_upsert_scholar_subject_grades()` passes an optional `excludeFromGwa`. The CSV template has no such column (per the spec's column list), so an upload never changes the flag of an existing subject. Older 7- and 8-argument calls still work.

App:
- `src/lib/gwa.ts` — THE one calculation: GWA = sum(grade x units) / sum(units) over subjects whose grade resolves to a number and that are not excluded; no units = 1; nothing resolves = null ("—"). New helpers: `gwaDetail`, `needsUnits`, `effectiveUnits`, `DEFAULT_UNITS`. `computeGwa`/`formatGwa` keep their signatures, so the school summary, the staff drill-down and the scholar panel all pick it up. A test fails if a second GWA formula appears or a view stops importing this one.
- School Portal grade entry: Units box and "Exclude from GWA" checkbox per subject, live GWA preview ("weighted by units", subjects/units counted, excluded count), subjects without units highlighted with a note; units validated (positive number; saved units can be changed but not cleared); the save read-back now also checks units and the flag. Scholar table: GWA column is weighted; "N need units" chip per scholar and a period-level notice.
- Staff drill-down and scholar panel: Units column, "not in GWA" tag on excluded subjects, "(weighted by units)" beside the GWA.
- Fix (found while planning this): a downloaded template has blank placeholder rows for scholars with no subjects yet; the upload now ignores completely empty rows instead of listing them as errors ("N empty template rows were ignored"); an entirely untouched template is refused with a plain message.

Verification: tsc + eslint clean on every changed file (one unrelated pre-existing lint error remains in an untouched scholar file); `node tests/school-grades/run.mjs` 59/59; migration checked in a scratch Postgres on top of Phases 1-3 (all pass, re-run safe, earlier live tests still pass); `gwa_units_guard.sql` for the live database. Not exercised in a browser (no school/staff/scholar login available to the assistant).

## 2026-10-09 — Phase 4 confirmed by the owner; Phase 5 started (School Portal design revisions, section 9 a-k)

## 2026-10-09 — Phase 5: School Portal design revisions (built, awaiting the owner's confirmation) — NO database change

Section 9 of the brief, item by item:
- **a) Header:** the school's full name (wraps, never truncated) + an Account menu: Change password (current password verified, 8+ characters, confirmation), Help / Contact CEDO (step-by-step guide + the office's own letterhead contact details), Sign out; shows "Signed in as <username>". Dialogs are content-sized with proper dialog semantics (Esc, focus trap, focus returns to the Account button).
- **b) Period bar:** always under the header — "School Year 2026-2027 · 1st Semester", a "Change period" dropdown, "Deadline: Oct 21, 2026 (12 days left)" and "Status: In progress" (Not started / In progress / Ready to submit; "Submitted" arrives with Phase 6), plus a Closed/Archived chip. Sticky on larger screens only.
- **c) Summary row:** Total scholars | Complete | Declared, not graded | Not set up, an overall progress bar, and the **Submit grades** button — disabled until 100% complete, and for now disabled always with a note: the submit action itself is Phase 6 (submission + locking).
- **d) Toolbar:** search by name or ID (any word order), Download template and Upload CSV for the selected period, plus a view toggle.
- **e) Year-level cards:** progress bar + "x of y complete", year levels in order (1st, 2nd, ... "(Not set)" last), grid that fills the width.
- **f) Breadcrumbs:** Scholars > 5th Year > BS Education, each level clickable.
- **g) Table view:** one table of all scholars with Year level / Program / Status filters; columns Scholar ID, Name, Program, Year, Subjects, Graded, Status, GWA, Actions; status as chips WITH text labels.
- **h) Grade entry:** Phase 4's editable table kept; added the allowed range/letters hint ("Allowed: 1 to 5, or INC, DRP"), per-row error on a grade outside the scale (with aria-invalid), and Save is blocked until grades are on the scale.
- **i) Grading scale not set up:** red banner "Set up your grading scale before entering grades" on the Scholars tab (with a button to the Grading System tab); entry and CSV upload are blocked until it is saved. The Grading System tab now says so, reports save failures (it used to show "Saved." even if the save failed) and tells the rest of the portal to re-read the scale.
- **j) Empty states:** no scholars; no subjects yet (guidance adapts to: scale missing / period not Open / ready); no search results; no filter results; empty grade-entry window.
- **k) Accessibility:** readable text 14px+ (tables 14.5px), helper greys darkened to slate-700, link blue #0077b6 (4.9:1), visible keyboard focus everywhere, every input labelled, tables with captions/scope, progress bars with values, status never colour-only, phone/tablet layouts (tables scroll sideways instead of squeezing). Automated axe-core audit (WCAG 2.0/2.1 A+AA) on the page, the account dialog and the grade-entry window: 0 violations (shared staff Modal had an unlabeled close button, so the School Portal got its own dialog; the staff app's Modal is untouched).

New files: `src/school/portalLogic.ts`, `useSchoolData.ts`, `templateDownload.ts`, `helpContent.ts`, components `portalParts.tsx`, `SchoolPeriodBar.tsx`, `ScholarsSummary.tsx`, `ScholarsTable.tsx`, `SchoolAccountMenu.tsx`, `SchoolDialog.tsx`. Rewritten: `ScholarsDrilldownPanel.tsx`, `SchoolPortalPage.tsx`, `GradingConfigPanel.tsx`. Edited: `ScholarGradeEntryModal.tsx`, `BulkGradeUploadModal.tsx` (shared template download, readable text), `schoolApi.ts` (username, change password), `SchoolSiteApp.tsx`.

Verification: tsc + eslint clean; `node tests/school-grades/run.mjs` 76/76; production build; browser check of the real layout with sample data (desktop 1200px, phone 375px, table view, drill-down + breadcrumbs, grading-scale-missing / closed-period / no-scholars states, account menu + both dialogs, grade-entry validation and live GWA preview) with an axe-core audit. The sample-data preview page and axe copy were temporary and are not part of the delivery. NOT exercised against the live database from a real school login (none available to the assistant): sign-in, saving, template download and the real change-password call.

## 2026-10-09 — Phase 5 confirmed and committed (715999e); Phase 6 started (submission + locking, audit trail, documents)

## 2026-10-09 — Phase 6: submission + locking, audit trail, supporting documents (built, awaiting the owner's migration run + confirmation)

Database — `supabase_migration_submission_audit_documents.sql` (run AFTER the Phase 4 migration; nothing deleted; safe to re-run):
- **Submission + locking:** `school_period_submissions` (one row per school per period: submitted / reopened) + `school_submission_events` history. `submit_school_period()` requires an Open period, a saved grading scale and EVERY (non-removed) scholar complete, and is refused if already submitted. After submitting, the Phase 2/3 guard trigger blocks a school from adding, changing or deleting grades. Staff and other writers are not locked.
- **Correction requests:** `grade_correction_requests` + `request_grade_correction()` (reason of at least 5 characters, optional proposed grade checked against the school's scale, one open request per grade), `cancel_grade_correction()`, `review_grade_correction()` (staff; a reason is required to reject). Approval lets the school change THAT grade once (the trigger marks it applied, then it locks again). `reopen_school_period()` (staff, reason required) unlocks a whole submission so subjects can be added/removed and the school can submit again; open requests are cancelled. `grades_submission_overview()` gives staff each school's state next to completion %.
- **Audit trail:** `scholar_grade_audit`, written by a trigger on every insert / change / delete of a subject: who (school name / staff name / system), when, old and new values, and how (manual entry, CSV upload — the bulk function marks its own transaction —, approved correction, CEDO staff). Nobody can edit, delete or forge entries; a school reads only its own school's, staff read all.
- **Documents:** private bucket `grade-documents` (10 MB, PDF/JPG/PNG/WebP), `grade_documents` rows, files stored at `<school>/<period>/<scholar>/<file>`. Schools add (Open period, up to 5 per scholar per period) and read only their own; they can remove only until submitted; staff with the monitoring tag read all.
- **Fix:** scholars with status "Removed" are no longer counted in a school's completion % (the staff RPCs) and are not listed in the portal — one was linked to a school and would have made 100% (and submitting) impossible.

App:
- School Portal: **Submit grades** is real now (enabled only when ready; the confirm dialog says plainly that grades lock); submitted/reopened banners; the period bar shows Submitted / Reopened by CEDO; locked grade-entry window with per-subject **Request correction**, "Approved — change it, then Save", and "Correction requested"; new **Corrections** tab (own requests, CEDO's decision and reason, cancel, open the grades); in the grade-entry window: supporting documents (attach / view / remove while allowed) and a collapsible change history.
- Staff (Scholars' Grades Monitoring): the Schools tab shows each school's submission status + waiting correction requests next to completion %, and a **Reopen submission** action (reason required); new **Correction requests** subtab (approve / reject with a reason); View Grades shows the scholar's documents and change history.
- New: `src/lib/gradeEvidence.ts` (+ `gradeEvidenceApi.ts`), `src/app/components/GradeEvidence.tsx`, `src/school/submissionLogic.ts`, `submissionApi.ts`, components `SubmitGradesDialog`, `CorrectionRequestDialog`, `CorrectionsPanel`, `SchoolEvidenceSections`, staff `gradesReviewApi.ts`, `ScholarsGradesMonitoringCorrectionsTab.tsx`.
- Fixes found while testing: (Phase 5) Table view made the page scroll sideways on a phone — a hidden screen-reader label escaped the scrolling table; fixed. The shared staff dialog's close button had no accessible name — labelled.

Verification: tsc + eslint clean; `node tests/school-grades/run.mjs` 88/88; the migration checked in a scratch Postgres on top of Phases 1-5 (74 checks, including cross-school isolation, locking, one-time corrections, reopen/resubmit, audit integrity, documents + storage rules; re-run safe; all earlier live tests still pass); `submission_guard.sql` for the live database (passes with and without a staff account in the scratch DB); production build; browser check against a fake backend — submit then locked, Request correction (validation, exact call), upload (storage path + record; a bad type is refused with no request), history, Corrections tab (filters, cancel, open grades), reopened and not-ready states, phone width; staff: school cards, approve/reject, reopen; axe-core: 0 violations on every School Portal state (the shared staff dialog's two findings were fixed). NOT exercised against the live database from real school/staff logins (none available to the assistant): real uploads to Supabase Storage and the real signed-URL download.

## 2026-10-09 — Phase 6 confirmed by the owner; Phase 7 started (scholarship standing, cleanup tools, logins, search, exports)

## 2026-10-09 — Phase 7: scholarship standing, school clean-up, logins, paged search, Excel export (built, awaiting the owner's migration run + confirmation)

Database — `supabase_migration_standing_cleanup_logins.sql` (run AFTER the Phase 6 migration; nothing deleted; safe to re-run):
- **Standing:** `school_grading_configs.retention_threshold` (null = none saved) and `upsert_school_grading_config(..., p_retention_threshold)` (must be on the school's own scale). Standing itself is computed in the app by ONE shared module (`src/lib/standing.ts`): Below requirement / At risk (within 0.25 on a small scale, 3 points on a large one — the margin counts as at risk) / Good standing; "No GWA yet" and "No requirement set" are reported as such, never guessed.
- **School clean-up:** `school_aliases` (old names kept after a merge), `resolve_school_id()`, a trigger that keeps a scholar's written school name and school link in step (the official spelling is written), a one-time link of existing scholars to their school where the name matches, `merge_schools()` (moves scholars, keeps old names as aliases, copies the grading setup if the kept school has none, REFUSES with the reason if a duplicate already has a login, submission, correction request or document), `assign_scholars_school()`, `scholar_school_spelling_variants()` + `standardize_scholar_school_names()` (only runs when CEDO presses the button — the existing spellings are not rewritten automatically).
- **Paged scholar list:** `scholars_grades_monitoring_scholars_page()` (search / school / program / year level, exact total count, Removed scholars left out) and `scholar_filter_options()`. The old 200-row list function is left in place.
- **Logins:** `resolve_school_login_email()` now resolves a USERNAME or the login EMAIL (the school name no longer signs anyone in); `set_school_username()` (IT administrator only); `school_password_reset_requests` + `request_school_password_reset()` (public, reveals nothing about which accounts exist, one open request per account) + `mark_school_reset_handled()`.

App:
- School Portal: Retention requirement field in Grading System (read back as a sentence, with the at-risk rule explained); Standing column, filter and summary line; login page takes "Username or email" and has a "Forgot password?" dialog.
- Staff (Scholars' Grades Monitoring): Scholars tab rewritten — search, school / program / year-level / standing filters, 50 per page with "Showing 51–100 of 7,136", GWA + standing columns for the viewed period (standing filter reads up to 2,000 matches and says when it was cut); new **Clean-up** tab (merge schools with duplicate suggestions and a confirm step showing how many scholars move, scholars with no school set + bulk assign, spelling differences + Standardize, old names/aliases); **Export to Excel** (By school / By program / Scholars sheets: completion, submission status, average GWA, standing; one period or all).
- IT admin (Staff Accounts → School accounts): set / change a school's username, "no username yet" flag, accounts that asked for a reset listed first; resetting closes the request.
- Scholar forms: school chosen from a list (not typed). New: `src/lib/standing.ts`, `gradesReport.ts`, `schoolNames.ts`, `src/sead/scholarsMonitoringData.ts`, `schoolCleanupApi.ts`, `gradesExport.ts`, components `SchoolSelect`, `GradesExportDialog`, page `ScholarsGradesMonitoringCleanupTab`.
- Small fixes on the staff page: low-contrast link/tab colours darkened (axe found them); "1 of 1 scholar" wording.

Verification: tsc + eslint clean; `node tests/school-grades/run.mjs` 99/99; the migration checked in a scratch Postgres on top of Phases 1-6 (57 checks + `standing_cleanup_guard.sql` 10/10 + the five earlier SQL tests still pass); production build; browser check with sample data (staff Scholars tab filters/paging/standing filter, Clean-up merge / assign / standardize, Excel file downloaded and opened — 3 sheets, correct counts; school Standing column/filter/summary and retention validation; login page + Forgot-password dialog; IT username form; phone width 375px — no sideways scroll) with an axe-core WCAG A/AA audit: 0 violations on every screen checked. The sample-data preview page and axe copy were temporary and are not part of the delivery. NOT exercised against the live database from a real login (none available to the assistant): the live SQL test is for the owner to run.
