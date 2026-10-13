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
