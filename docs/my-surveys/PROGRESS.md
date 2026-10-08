# My Surveys — progress log

A staff form/survey builder. Built in 7 phases; each phase is confirmed by the
owner before the next one starts. Append-only: one entry per finished micro-task.

## Phase plan

1. Database tables + "My Surveys" menu item + survey list page  ← **Phase 1**
2. Survey builder (all question types, preview, auto-save)
3. Publishing: public URL, QR code, one-question-at-a-time respondent page, saving responses
4. CSV template download and upload with validation
5. Sharing and roles
6. Connection to the Research Project Monitoring tool (automatic charts)
7. Exports, closing dates, response limits, polish

## Decisions locked in Phase 1

- Tables are prefixed `my_survey_*` (not `survey_*`) because the older `research_surveys*`
  tables (scholar, activity-attached surveys for Research Project Monitoring) are a
  different system and are left untouched.
- Roles: owner = `my_surveys.owner_id`; editor/viewer = rows in `my_survey_shares`.
  `my_survey_role(survey_id)` resolves the caller's role; every RLS policy goes through
  it, so permissions are enforced by the database, not just the UI.
- Staff have NO write policy on responses/answers. Public (no-login) submissions arrive in
  Phase 3 as security-definer RPCs; `anon` has no table policy anywhere.
- Question versioning: a question row is immutable once it has answers. Editing it =
  archive the old row (`archived_at`) + insert a new row with the same `question_key` and
  `version + 1`. Answers point at the exact row that was answered.
- `my_surveys` select policy checks `owner_id = auth.uid()` directly in addition to
  `my_survey_role()`: an `INSERT … RETURNING` cannot see its own new row through the
  role function, which made "New Survey" fail until this was added (found by test).
- List page switches from cards to a table at `lg` (1024px), not `md`: from 768px the
  app's sidebar is already visible and the table overflowed (found in browser test).

## Log

### Phase 1
- Migration `supabase_migration_my_surveys_core.sql`: 7 tables, indexes, `my_survey_role()`,
  update-guard trigger, RLS, `list_my_surveys()`, `duplicate_my_survey()`. Tested in an
  in-process Postgres (PGlite): 38/38 checks pass, including a second run of the file.
- `src/mysurveys/mySurveysApi.ts`: typed wrappers (list, create, duplicate, delete, header, rename).
- `src/mysurveys/pages/MySurveysPage.tsx`: tabs (My Surveys / Shared with me), search,
  status filter, cards (<1024px) / table (≥1024px), error banner.
- `src/mysurveys/pages/SurveyBuilderPage.tsx`: Phase 1 stand-in (rename + read-only for viewers).
- `src/mysurveys/components/`: `SurveyActionsMenu`, `DeleteSurveyModal`, `SurveyStatusBadge`.
- `src/app/App.tsx` + `src/app/components/Sidebar.tsx`: `mySurveys` page, ungated, menu item
  directly under My Presentations.
- Verified in browser (live staff session, `my_surveys` calls faked because the migration is
  not applied yet): menu item, create, rename, delete confirmation, shared tab, viewer menu
  and read-only title, layouts at 360 / 487 / 768 / 1024 / 1280px with no horizontal overflow.
- `npx tsc -b --force` exit 0; eslint clean on the new files.
