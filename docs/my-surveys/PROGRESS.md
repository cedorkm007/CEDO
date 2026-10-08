# My Surveys — progress log

A staff form/survey builder. Built in 7 phases; each phase is confirmed by the
owner before the next one starts. Append-only: one entry per finished micro-task.

## Phase plan

1. Database tables + "My Surveys" menu item + survey list page  (done, committed)
2. Survey builder (all question types, preview, auto-save)  (done, committed)
3. Publishing: public URL, QR code, one-question-at-a-time respondent page, saving responses  (done, committed)
4. CSV template download and upload with validation  (done, committed)
5. Sharing and roles  (done, committed)
6. Connection to the Research Project Monitoring tool (automatic charts)  ← **Phase 6**
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

## Decisions locked in Phase 2

- One ordered list of "items": a section header starts a section and every question after it
  belongs to it until the next header (Google-Forms model). Position is the single source of
  truth; the server derives `section_id` from it on every save.
- The whole survey is saved atomically through `save_my_survey()` (one transaction), not
  row-by-row from the browser. It loads through `get_my_survey_doc()` (one round trip).
- Edit conflicts: every save carries the revision the client last saw. If someone else saved
  since, the server writes nothing and returns {conflict}; the builder shows who/when and
  offers "Load their version" or "Keep my version". The survey row is locked during a save.
  While idle the builder polls the revision (10s) and refreshes silently.
- Versioning: a question with answers is never rewritten. Changing its wording, type, scale
  or set of options archives it and creates version + 1 (same `question_key`); changing only
  required / help text / order does not. Deleting an answered question archives it. A new
  version has no answers, so further edits to it are in place (typing never piles up versions).
- UI identity of a card is `questionKey`, not the row id (the id changes when a question is
  versioned; keying on it collapsed the card and dropped focus mid-typing -- found in testing).
- The Preview renders `SurveyRunner`, the same component the public page will use in Phase 3,
  so Preview = what respondents see. The runner uses plain React only (no icon/chart libraries).
- Respondent text uses explicit px sizes (the project root font size is 15px, so Tailwind
  `text-base` rendered 15px, under the 16px requirement). The runner uses container-query
  breakpoints (`@lg:`) so a phone-width screen gets phone styling even inside the Preview frame.
- The last question's button reads "Review & submit"; the review screen holds the final "Submit".

### Phase 2 log
- Migration `supabase_migration_my_surveys_builder.sql`: `get_my_survey_doc`, `save_my_survey`.
  40/40 checks pass in an in-process Postgres (ordering, sections, conflicts, permissions,
  versioning, archiving, duplicate-after-save), including a second run of the file.
- Builder: `src/mysurveys/builder/*` (auto-save hook, question/section cards, add menu,
  preview overlay, confirm modal); `pages/SurveyBuilderPage.tsx` replaces the Phase 1 stand-in.
- Respondent screens: `src/mysurveys/respondent/SurveyRunner.tsx`, `QuestionField.tsx`.
- Verified in a browser against the real SQL (local Postgres shim): create/reword/add questions,
  one save + one version while typing, both conflict choices, drag-and-drop, viewer read-only,
  full preview walk-through (consent, section intro, required gating, Enter, swipe, Change from
  review, submit), live-mode progress restore after refresh and clearing after submit,
  360px / 820px layouts without sideways scrolling.
- `npx tsc -b --force` exit 0, `npm run build` exit 0, eslint clean.

## Decisions locked in Phase 3

- The public page is its own HTML entry, `survey.html` (served at `/s/<slug>` by a rewrite in
  `vercel.json`; the dev server does the same via a small plugin in `vite.config.ts`). The staff
  app bundle is several MB, so a respondent on slow data must not download it. The public page
  is ~59 KB gzipped in total (React + the respondent screens + 4 KB of CSS) and the staff app's
  output file names are unchanged (`index` keeps its name in the multi-entry build).
- The public page uses plain `fetch()` against the two public functions, not the supabase-js
  client (the biggest thing it would otherwise download), system fonts, and its own tiny
  Tailwind stylesheet that scans only the respondent screens.
- `anon` has no table access. The only way in is `get_public_survey(slug)` and
  `submit_my_survey_response(...)` (security definer, all checks server-side, one transaction).
- Slug: 9 chars from a 31-char alphabet (no 0/o/1/i/l), ~44 bits, rejection-sampled from
  `gen_random_uuid()` bytes. Reopening a survey keeps the same slug (printed QR codes keep working).
- Closing date and response limit are enforced by the server on every read/submit (and the survey
  closes itself when the limit is hit). They close the survey LAZILY: the status column changes
  the next time a respondent or the Publish dialog touches it, so the survey LIST can still say
  "Open" for a survey past its closing date until then (Phase 7 polish: compute it in the list).
- Settings UI (thank-you message, one response per device, closing date/time, response limit)
  was built now because the publish dialog is where they live and the server enforces them in the
  same function; Phase 7 keeps exports and polish.
- "One response per device" is browser-based (a random id in localStorage): it discourages repeat
  answers but cannot stop another phone or a private window.
- Staff actions that change the survey (settings / publish / close) go through
  `useSurveyDoc.serverAction`: save pending edits, carry the revision, reload on success, and show
  the same conflict banner on conflict.
- Found by tests: appending a plain string to a `text[]` in plpgsql is parsed as an array literal
  (use `array_append`).

### Phase 3 log
- Migration `supabase_migration_my_surveys_publishing.sql` (adds functions only; no Phase 1/2
  function is redefined): `generate_my_survey_slug`, `get_public_survey`,
  `submit_my_survey_response`, `get_my_survey_publish_info`, `save_my_survey_settings`,
  `set_my_survey_status`. 59/59 checks pass in an in-process Postgres (readiness problems, slug
  quality, anon isolation, every bad-answer case, one-per-device, limit, closing date, reopen,
  survey edited mid-response, Phase 1/2 behaviour untouched), including a second run of the file.
- Public page: `survey.html`, `src/mysurveys/public/*`.
- Staff: `builder/PublishDialog.tsx`, `components/LinkAndQr.tsx`, `components/ShareLinkModal.tsx`,
  `publishApi.ts`; Publish/Share button in the builder; "Get Link / QR" enabled in the list.
- Verified in a browser against the real SQL (local Postgres shim, anonymous role for the public
  page): publish, link + QR (QR decoded back to the exact URL with a scanner library), custom
  thank-you, submit, stored answers, one-per-device, limit closing the survey, closed page,
  reopen with the same slug, manual close, list "Get Link / QR".
- `npx tsc -b --force` exit 0, `npm run build` exit 0, eslint clean.

## Decisions locked in Phase 4

- Parsing and validation happen in the browser (`src/mysurveys/csv/`) so people get row-by-row
  messages before anything exists; creating is ONE server call, `create_my_survey_from_doc`,
  which makes a Draft and fills it through `save_my_survey` in a single transaction (the server
  re-validates everything). A failure rolls the whole thing back -- no half-made survey.
- Row numbers are SPREADSHEET row numbers: row 1 is the header, blank and `#` rows still count.
  That is why the template keeps its column names in row 1 and puts its instructions in `#` rows
  at the BOTTOM (ignored on upload) instead of the top: "Row 4" is the third question the person
  typed, matching what they see in Excel / Google Sheets.
- Every row is checked and ALL problems are reported together; if there is any error nothing is
  created. Warnings (ignored columns, options on a text question, repeated question text, a
  section name that comes back later) are shown in the preview and never block creation.
- Real-world files handled: UTF-8 with/without BOM, UTF-16 ("Unicode Text"), Windows-1252
  (Excel's plain CSV, with a notice), CRLF/LF/CR, commas / doubled quotes / line breaks inside
  quoted cells, `;` and tab separators (chosen by which one yields the recognised column names).
- Header matching is forgiving (case, spaces, "required (yes/no)", any column order, unknown
  extra columns ignored with a warning); `question_type` is forgiving about case/spaces/hyphens
  but strict about the name (a typo is an error with a did-you-mean suggestion).
- Section rule: a section header is created each time the `section` value changes; a blank value
  stays in the current section. The template downloaded from the app uploads cleanly as-is.
- The existing `src/sead/csvUtils.ts` is untouched (its parser comma-only and drops blank lines,
  which would break row numbers); only its `downloadCsv` (adds the BOM Excel needs) is reused.

### Phase 4 log
- Migration `supabase_migration_my_surveys_csv_import.sql`: `create_my_survey_from_doc`.
  11/11 checks pass in an in-process Postgres (draft owned by the caller, round trip, privacy,
  anon denied, invalid document rejected AND rolled back, server re-validation, item limit,
  publishable afterwards), including a second run of the file.
- CSV engine: `csv/csvText.ts`, `csv/surveyCsv.ts` -- 59/59 unit checks (template round trip, spec
  example error "Row 4: unknown question_type 'mutiple_choice'", row numbering, quoting, UTF-8,
  Windows-1252, UTF-16, semicolons, header variants, every field rule, limits).
- UI: `components/CsvImportModal.tsx`, `csvImportApi.ts`; the list page's button is now live.
- Verified in a browser against the real SQL (local Postgres shim): template download (BOM, file
  name, spec rows), uploading that template, a file with 5 mistakes (rows listed, nothing created,
  no Create button), an Excel-style semicolon + Windows-1252 file with accents / quoted commas,
  title edit, create, builder opens on the new Draft, Publish shows no readiness problems,
  phone-width layout without sideways scrolling.
- `npx tsc -b --force` exit 0, `npm run build` exit 0, eslint clean.

## Decisions locked in Phase 5

- The permission model was built in Phase 1 (RLS + `my_survey_role()`), so Phase 5 adds only the
  functions the Share dialog needs, each of which checks the caller's role itself (security
  definer): `search_staff_for_survey_share` (owner), `list_my_survey_access` (any member),
  `set_my_survey_share` (owner), `remove_my_survey_share` (owner removes anyone; anyone else may
  remove only themself = "Remove from my list"). `granted_by` is stamped server-side.
- Staff search needs 2+ characters (no directory dump), matches first/last/full name, email and
  username, treats `%` and `_` literally, never returns the owner, caps at 15, and tells the owner
  who already has access.
- Roles are exactly as specced: owner (delete + sharing), editor (edit questions/settings,
  publish/close, view responses), viewer (view survey + responses). Roles can only be Editor or
  Viewer when granted; ownership cannot be transferred or granted.
- Sharing only controls which STAFF can open the survey. The public link (Phase 3) is separate.
- If a person's access changes while they have the builder open: the refused save is NOT retried
  (it can never succeed). The hook re-reads the survey -- a demoted editor gets it read-only with
  a notice; a removed person gets a "no longer have access" screen. The 10s poll now also notices
  a role change or lost access (it uses `get_my_survey_publish_info`, which returns revision + role,
  and nothing when access is gone), so an idle collaborator finds out without having to edit.
- No in-app notification when something is shared: the existing notification system is built around
  task/deliverable tracking (src/app/App.tsx), not a generic feed, so hooking into it would be a
  new feature. The survey simply appears under "Shared with me".
- Builder top bar: "Share" (people, owner only) is new; the public-link button is now "Link & QR"
  once published (it used to say "Share"). All three are icon-only below the `sm` breakpoint.
- Simultaneous editing (Phase 2's revision check) is now exercised with real shared users in the
  tests: the second editor's stale save gets a conflict naming the first, and nothing is overwritten.

### Phase 5 log
- Migration `supabase_migration_my_surveys_sharing.sql`: 4 functions. 46/46 checks pass in an
  in-process Postgres (search rules and wildcard safety, add/change/duplicate/self/unknown/invalid
  role, who-can-do-what for owner/editor/viewer/stranger/anon, direct table writes still blocked by
  policy, two editors conflicting, demoted editor refused with a permission message, removal and
  leaving, responses hidden from removed people, owner delete cascades), incl. a second run.
- UI: `components/ShareDialog.tsx`, `shareApi.ts`; list menu "Share" (owner) / "Remove from my
  list" (everyone else); builder "Share" button; access-lost screen; hook handling.
- Verified in a browser against the real SQL, acting as the owner and as a collaborator: search by
  name, add as Editor/Viewer, change role, remove, "Already Editor", 1-letter search makes no
  call, Shared-with-me menu for an editor (no Share/Delete), builder as editor (no Share button),
  demotion while typing (one refused save, read-only + notice, earlier edit intact), removal while
  open (access-lost screen within one poll), leave-survey confirmation, 360px layout.
- `npx tsc -b --force` exit 0, `npm run build` exit 0, eslint clean.

## Decisions locked in Phase 6

- Connection to Research Project Monitoring (RPM): no import/export step. Responses already live in
  `my_survey_*` (Phase 3); RPM's **Survey Results** tab now has a second dropdown group,
  "My Surveys (yours or shared with you)", so each survey is its own dataset. The existing
  `research_surveys*` system is untouched (only an additive edit to
  `src/sead/pages/research/SurveyResultsSubtab.tsx`: 37 lines added, 4 changed; the old dropdown
  contents and views behave exactly as before).
- Access rule (the owner's choice, option 1): ONLY the survey's owner and the people it is shared with.
  RPM itself is still gated by the `research_project_monitoring` tag, so tag holders see just the
  surveys they own or were shared on -- never other people's. Staff WITHOUT the tag use
  My Surveys > **View Responses** (same charts, same server rule). Enforced by
  `get_my_survey_results`, which checks the caller's role on that survey (any role).
- One server function does the aggregation in one round trip (no per-row RLS cost, no downloading
  answer rows): per question the answered count, option counts (zero-count options kept), scale
  distribution + mean + median, date/time value counts, the latest 300 text answers + total, plus
  responses per day in the viewer's time zone (bad time zone falls back to UTC).
- Charts: single choice/dropdown -> bar or pie toggle; checkboxes -> bar (% of respondents, since
  people tick several); scale/rating -> mean/median tiles + column distribution (every value
  labelled); date -> column per date; time -> column per hour of day; short answer/paragraph ->
  newest-first list or word cloud (same layout code as the Quest / Presentations clouds).
- Question versions: every version that has answers is returned as its own row, flagged archived when
  replaced or removed. Each question card shows "N versions", each version's wording and response
  count, and a picker: "All versions" (combined by option label / value, only when all versions are the
  same kind of question) or a single version. If the type changed between versions they are never
  combined: one section per version. A removed question that has answers is still shown, marked
  "Removed from the survey". Versions with no answers are left out.
- Live updates: `my_survey_responses` is added to `supabase_realtime` (guarded, re-runnable) and the
  panel refetches on changes to THAT survey's responses (throttled to once per 3s) via the existing
  `useRealtimeRefresh`; a 30s poll is a safety net so a dropped connection can't leave charts stale.
- Staff-only: recharts and the chart code are not in the public respondent bundle (checked in the
  production build).
- NOT in this phase (per the plan): exports to CSV/Excel (Phase 7) and a per-response table (the
  exports will carry one row per response).

### Phase 6 log
- Migration `supabase_migration_my_surveys_results.sql`: `get_my_survey_results` + realtime
  publication. 32/32 checks pass in an in-process Postgres, driven through the real publish and
  public-submit functions (counts per option, zero options, checkbox respondents vs selections,
  scale stats, date/time values, text newest-first, absent data per type, per-day timeline in two time
  zones + invalid zone, versioning with reworded + removed questions, access for editor/viewer,
  denied for strangers/anon/removed people, publication added and safe to re-run).
- UI: `src/mysurveys/results/` (api + grouping/merging helpers, charts, question card, panel),
  `pages/SurveyResultsPage.tsx`; list menu "View Responses" is live; builder gets a "Responses" button.
- Verified in a browser against the real SQL (local Postgres shim, 42 -> 45 responses, 2 versions of one
  question): summary, per-day chart, every chart type, bar/pie toggle, version picker (all / v1),
  word cloud, the page picking up 3 new responses by itself, the RPM tab showing both groups with
  an existing activity survey still rendering as before, 360px layout without sideways scrolling.
  NOT verifiable here: the realtime push itself (needs the migration on the live project); the
  polling safety net was verified.
- `npx tsc -b --force` exit 0, `npm run build` exit 0, eslint clean on `src/mysurveys`.
