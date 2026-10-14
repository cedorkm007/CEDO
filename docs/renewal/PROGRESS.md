# Scholar Renewal System — progress log (append-only)

Working rules (from the owner): each phase on its own branch and pull request; nothing merges to `main` until the owner writes
"Approved, next phase"; previews must use the staging project with hypothetical TEST data (never real scholar data); every phase ends
with a walkthrough and then STOPS for the owner's comments. No email anywhere (in-portal + web push only). "Division Head", never a
person's name.

## 2026-10-13 — Phase 0 (plan) approved
Plan: `Renewal_System_Phase0_Plan.txt`. Decisions confirmed by the owner:
- A renewal for a term checks the semester just finished: 1st Sem ← previous 2nd Sem; 2nd Sem ← the same year's 1st Sem; Summer ← the same year's 2nd Sem.
- INC and DRP are marks every school may enter. "Renewed" is a result on the renewal record, not a scholar status.
- Summer renewal is optional (scholars taking summer classes only).
- The Division Head still signs the Referral Form and may change only the printed signatory name. Division Head outcomes for 2+ failed (or 1 failed with previous probation): **Removed** or **Reconsidered** (a Reconsidered scholar returns to the normal list with status Reconsidered and can get a CSR, after evaluator confirmation). Removed uses the proper Removed flow (login switched off).
- Defaults accepted for: no passing mark (nothing guessed), waiting for grades (= school has submitted), who is on the "Not applied" list, program code on the CSR, automatic consultation notice, booking cutoff 12 h, free-text remarks, no automatic change after confirmation, CSR number printed + verified on the QR page, server-built PDF, one new tag ("Scholar Renewal Evaluator"), "Removed" visible on the public QR page. The CSR's QR is plain (no badge). Evaluator and IT admin can edit the signatories.

## 2026-10-13 — Phase 1 (foundations) built on branch `renewal/phase-1-foundations`
Not pushed yet: waiting for the staging project (so the Vercel preview cannot touch real data).

Database — `supabase_migration_renewal_p1_foundations.sql` (run AFTER the Phase 7 grades migration; additive, safe to re-run):
- `school_grading_configs.passing_mark` and `upsert_school_grading_config(..., p_passing_mark)` (must be on the school's scale; the old 5-argument call still works).
- INC and DRP accepted for every school (`_school_grade_error`). `_grade_outcome(school, grade)` = the one database rule: ungraded / passed / failed / inc / drp / review / no_passing_mark. DRP counts as failed; INC is separate; "Exclude from GWA" is ignored (those subjects still count); equal to the passing mark passes.
- Remarks on a subject: `upsert_scholar_subject_grade(..., p_remarks)` and the CSV save carry them (an absent key keeps what is stored; blank clears; 200 characters).
- `get_scholar_grading_config` and `..._for_staff` also return `passing_mark`.
- SDP: `_sdp_compliance` (internal) and `scholars_sdp_compliance(year, semester)` — Complied = ≥3 credits in each of the 3 categories including carry-over; the reason ("Formation Program: 2 of 3"); Summer = no requirement.
- Status history: `scholar_status_history` + trigger on every status change (who, when, term, source, temporary yes/no), `scholar_status_history_for()` for staff, internal `scholar_had_regular_probation()` (temporary INC probation does NOT count).
- Backfill is NOT part of the migration: `renewal_status_history_backfill_preview.sql` (read-only) then, only after the owner approves the numbers, `renewal_status_history_backfill_apply.sql`.

App:
- `src/lib/subjectOutcome.ts` (mirror of `_grade_outcome`; a shared case table `tests/renewal/outcome_cases.json` is run against BOTH), `src/app/components/OutcomeBadge.tsx`.
- School Portal: Passing mark field in Grading System (read back as a sentence); Remarks / tag box per subject; Failed / DRP / INC / Needs-review badge + row highlight + "Needs attention" summary in the grade-entry window (and a banner if no passing mark); failed/INC chips in the scholars table; CSV template gets an optional `remarks` column; INC and DRP always allowed (hint lists them).
- Staff: grade table shows the flags and remarks; Scholars tab gets a "Failed / INC" column; SDP Checklist gets a semester picker (incl. Summer), a Complied / Not complied badge with the reason, and a filter; scholar preview window shows "Scholarship Status History".
- Scholar portal: own grades show the same flags and remarks.
- Summer was already a term everywhere it is needed (periods, SDP ordering, Financial Assistance); verified, plus the SDP Checklist now lists it.

Verification: `tsc` and `eslint` clean; `node tests/school-grades/run.mjs` 99/99 (three tests updated for the intended changes: INC/DRP allowed, remarks column, hint wording); `node tests/renewal/run.mjs` 26/26; 64 database checks in a scratch Postgres (`node tests/renewal/db/run_db_tests.mjs`, needs PGlite) including every earlier SQL guard still passing and the backfill preview/apply; production build; browser check of every changed screen with sample data and an axe-core audit (phone width too).
Not verified against a real Supabase project yet (no staging).

## 2026-10-13 — Local demo replaces the staging project
The owner found a staging project too much work and asked for local testing instead. Built `localdemo/` + `scripts/localdemo/start.mjs`:
`npm run demo` builds a private PGlite database from the real migration files (+ `localdemo/schema/tables.json` for tables made by hand), loads hypothetical TEST data (`localdemo/seed.mjs`: 4 schools, 5 staff, 25 scholars matching the Phase 1 scenarios), starts a local Supabase stand-in on 127.0.0.1:54321 and the real website on 127.0.0.1:5173. `npm run demo:reset` starts again from the original data. The launcher overrides `VITE_SUPABASE_URL` (the local `.env.local` points at the real project) and refuses to start for any non-local host.
Checked by signing in as school, staff and scholar and opening the Phase 1 screens; no request left this computer. Walkthrough: `Renewal_Phase1_Walkthrough_LOCAL.txt`. Not available in the demo: account creation/reset functions, Drive upload, live updates, push.

## 2026-10-13 — Phase 1 approved; Phase 2 (online application, rules, evaluator board) built on branch `renewal/phase-2-application`
Owner's answers to the Phase 1 questions: remarks stay free text; a mark like "W" goes to the evaluator as "Needs review"; remark edits are NOT audited. "Approved, next phase."
Phase 1 branch pushed (with the local-demo tooling). Phase 2 is stacked on it; nothing merged to `main`.

Database — `supabase_migration_renewal_p2_application.sql` (run AFTER the Phase 1 migration; additive, safe to run twice):
- New tag key `scholar_renewal_evaluator`; helpers `is_renewal_evaluator()`, `can_view_renewals()` (evaluator, consultation staff, Division Head may READ).
- Tables: `renewal_windows`, `renewal_records` (one per scholar per term, with the evaluation snapshot), `renewal_history`, `renewal_documents` (+ private bucket `renewal-documents`), `renewal_inc_items` + `renewal_inc_extensions`, `scholar_notifications`.
- THE RULES: `_renewal_evaluate(scholar, year, term)` (read-only, one function) → stage, rule code, plain rule text, required documents. `_renewal_recheck()` stores the answer, keeps INC items and temporary probation in step, and notifies. Automatic re-checks on: grades change, school submits/reopens, SDP credit added/removed, document added.
- Scholar functions: `renewal_my_overview`, `renewal_my_preview`, `renewal_apply`, `renewal_resubmit`, `renewal_flag_problem`, `scholar_notifications_list/mark_read`.
- Evaluator functions: `renewal_window_save/delete`, `renewal_board`, `renewal_not_applied`, `renewal_inc_list`, `renewal_record_detail`, `renewal_confirm`, `renewal_return`, `renewal_late_decide`, `renewal_mark_not_required`, `renewal_decide_inc`; and `renewal_set_inc_deadline` (used by the Daily Record in Phase 3; also callable by the evaluator).
- Decisions made while building (tell the owner): INC deadline passing is noticed when the board / INC list is opened (the scheduler comes in Phase 3); temporary INC probation is lifted when the INC is settled either way (a passing grade, or counted as failed — the real status then comes from the normal rules); confirming a "1 failed" case sets Probationary (not temporary); a document upload is only allowed for a kind the case currently needs; consultation / hard-copy flags exist on the record but nothing sets them until Phase 3 (Phase 2 data for scenarios 11 and 14 is seeded).

Website: `src/lib/renewal.ts` (wording), `src/scholar/renewalApi.ts`, `src/sead/renewalApi.ts`; scholar Renewal tile (`RenewalPanel.tsx`: apply in 3 steps, tracker, documents, flag a problem, history) and the notification bell (`NotificationBell.tsx`); staff tool "Scholar Renewal" (`src/sead/ScholarRenewalPage.tsx` + `src/sead/renewal/*`: Applications, Late, Not applied, INC, Windows, detail page). Local demo: evaluator account `demo.evaluator`, 33 TEST scholars, three renewal windows, seeded applications (INC with deadlines, a late application), storage now stores real uploads and signed links.

Verification: 123 database checks (`tests/renewal/db/run_p2_tests.mjs`), 39 website checks (`tests/renewal/run.mjs`), Phase 1 checks still pass (64 / 99), `tsc` clean, production build; browser checks of the scholar apply flow, the evaluator board / detail / confirm, an upload through the website's own storage client; axe-core audit of the new screens (headings and dialogs fixed; the remaining findings are existing parts of the portal).
Not done (later phases): booking and the consultation flow (Phase 3), tracker polish and study-plan form link (4), Division Head / removal decisions (5), push + scheduler + staff notifications (6), reports (7), CSR + QR status (8).

## 2026-10-13 — Owner's answers to the Phase 2 questions ("Approved, next phase")
1. The Scholar Renewal tool stays gated by its tag, granted by it.admin1 on the Staff Accounts page (the tag list there is the same shared list; nothing else needed).
2. A "1 failed subject" case is NOT confirmed by the evaluator: when the study plan and consultation are done the evaluator ENDORSES the scholar for Probationary to the Division Head, who approves (Division Head decision is Phase 5). New stages `ready_to_endorse` and `endorsed_division_head` (endorsed cases are left alone by the automatic re-checks); `renewal_endorse()`; `renewal_confirm()` refuses these cases.
3. Only counseling staff set an INC deadline (`renewal_set_inc_deadline` now requires the consultation tag). The evaluator can still extend a deadline that has passed, as a decision (`renewal_decide_inc`).
4. Nothing is merged to `main` until Phase 8.
5. Phase 3 approved.
Tests: Phase 2 database checks now 129 (new endorse / counseling-only checks).

## 2026-10-14 — Phase 3 (appointments) built on branch `renewal/phase-3-appointments` (stacked on Phase 2; nothing merged — owner: no merge until Phase 8)
Database — `supabase_migration_renewal_p3_appointments.sql` (run AFTER the Phase 2 file; additive, safe to run twice):
- `counseling_availability` (ranges), `counseling_slots` (10-minute slots, one scholar each, one booked slot per renewal enforced by a unique index), `counseling_booking_history`; new columns on `renewal_records` (`no_show_count`) and `scholar_counseling_records` (slot, renewal, days given, hard copy).
- Scholar: `renewal_open_slots` (all staff, ≥12 h ahead, ≤60 days), `renewal_book_slot`, `renewal_reschedule_slot`, `renewal_cancel_booking` (12-hour rule); `renewal_my_overview` now returns the booking.
- Staff: `counseling_availability_save/delete` (warn + notify when booked slots would go), `counseling_my_availability`, `counseling_my_slots`, `counseling_mark_slot` (attended / no-show), `counseling_slot_prefill`, `counseling_save_daily_record` (INC days given → deadline; Summer hard copy), `counseling_set_hard_copy`, `renewal_extend_inc_deadline`, `counseling_probation_renewal_info`; `renewal_set_inc_deadline` is counseling-only.
- Scheduler: `renewal_scheduled_jobs()` (1-day and 1-hour reminders + INC deadline sweep), scheduled every 5 min with pg_cron when the extension is on (guarded). The local demo runs it once a minute.
- The Phase 2 file now drops `renewal_board` first so it can be re-run after Phase 3 (run the phase files in order).
Website: Appointments subtab in the Scholar Consultation Tool (`src/sead/appointments/*`, `appointmentsApi.ts`), pre-filled Daily Record (`AddDailyRecordModal` takes `prefill`), Probationary Monitoring renewal column (temporary INC, deadline, Extend, study plans), booking inside the scholar's Renewal tile, appointment info on the evaluator's board / detail.
Tests: `tests/renewal/db/run_p3_tests.mjs` 88 checks; Phase 2 129; website 49; Phase 1 64 / grades 99; tsc + build clean.
Walkthrough: `Renewal_Phase3_Walkthrough.txt` (also lists what changed in Phase 2 after the owner's answers).

## 2026-10-14 — Owner's answers to the Phase 3 questions (applied on `renewal/phase-3-appointments`)
- Q1: a scholar whose case needs a STUDY PLAN cannot book a consultation until the evaluator APPROVES it. `_renewal_consult_state()` (ok / study_plan_missing / study_plan_pending / not_needed) gates `renewal_open_slots` and `renewal_book_slot`; `renewal_review_document()` (evaluator: approve, or return with a comment) notifies the scholar; `_renewal_evaluate` marks required documents `approved` and a case is not "ready to endorse" until the plan is approved. Website: waiting messages in the Renewal tile, Approve / Return buttons on the evaluator's detail page, "Documents to review" filter on the board. Cases without a study plan (2+ failed, INC only, Summer) book as before.
- Q2: "60 days" = how far ahead scholars can SEE open times (12 hours to 60 days from now); kept at 60 — explained to the owner.
- Q3: the evaluator sees every counselor's calendar READ-ONLY: new "Consultations" tab (`renewal_calendar_staff/availability/slots`; `AppointmentsTab readOnly`).
Tests: Phase 3 database 101, Phase 2 129, website 51. Demo: new TEST-0039 (plan waiting for approval); TEST-0035/37/38 have approved plans.
