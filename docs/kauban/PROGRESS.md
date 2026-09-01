# Kauban Integration — Progress Log

Append-only. One entry per completed micro-task. Once an entry is checked off, treat it as locked — don't redo it without a specific reason surfaced by a later milestone.

Target: `https://cedo-ten.vercel.app/kauban/`, no user registration, Supabase-backed content (videos, words, phrases only).

---

## Milestone 1 — Content & schema inventory

**Status: DONE (2026-09-01)**

Source: `Kauban App.zip` (Laravel app), used as reference-only — none of its PHP ships.

Findings:
- The Laravel app's `categories`/`phrases` DB tables (from `database/migrations/2024_12_27_0000{03,04}_*`) are **already dead** — `QuickPhraseController` and `SignQuizController` read from bundled JSON files instead (`resources/data/quick-phrases.json`, `resources/data/quiz-words.json`), per comments in the controllers themselves. No MySQL/SQLite dependency for content anymore.
- There is **no user table in active use** — `AppSetup.php` stores role choice + personal emergency contacts in a single local JSON file (`storage/app/setup.json`), explicitly because "there's one install per device, so there's no need for multi-user storage." This maps directly to browser `localStorage` in the web port — no Supabase table needed for it.
- `resources/data/quiz-words.json` (35 entries: `label`, `category`, `file`) and the `signVideoLibrary` JS map inside `speech-to-sign-language.blade.php` (35 entries: lowercase phrase → filename) are **the same dataset duplicated twice** — one canonical table will serve both the tutorial/quiz browse UI and the speech-to-sign phrase matching.
- Two video variants exist per word, same filename, different folders: `public/fsl/videos/*.mp4` (~55MB total, 35 files, short/muted — used for live speech-to-sign playback) and `public/fsl/tutorial/{category}/*.mp4` (~155MB total, 35 files, longer — used for the tutorial screen). Both need a home in Supabase Storage.
- `resources/data/emergency.json` (2 bundled contacts, 4 bundled messages) is static reference content, distinct from the per-device personal contacts in `setup.json`.
- `resources/data/quick-phrases.json`: 4 categories (Greetings, Basic Needs, Feelings, Questions), 22 phrases total, each phrase now a static built-in (per-user custom phrases were already removed — `storeUserPhrase`/`updateUserPhrase`/`deleteUserPhrase` all just return "not available in this version").

Proposed Supabase schema (matches CEDO's existing `supabase_migration_<name>.sql` convention, no `auth.users` dependency):

| Table | Columns | Source |
|---|---|---|
| `kauban_sign_categories` | id, key, label, sort_order | quiz-words.json categories (`greetings`, `family`) |
| `kauban_sign_words` | id, category_id, phrase (lowercase, for STT matching), label (display), video_filename, tutorial_filename, sort_order | quiz-words.json + signVideoLibrary (merged, de-duplicated) |
| `kauban_quick_phrase_categories` | id, name, icon, color, sort_order | quick-phrases.json |
| `kauban_quick_phrases` | id, category_id, text, sort_order | quick-phrases.json |
| `kauban_emergency_contacts` | id, name, number, color, sort_order | emergency.json (bundled only) |
| `kauban_emergency_messages` | id, message, sort_order | emergency.json (bundled only) |

Storage: one bucket `kauban-media`, `clips/<category>/<filename>.mp4` (from `public/fsl/videos/`) and `tutorial/<category>/<filename>.mp4` (from `public/fsl/tutorial/`).

Explicitly **not** ported: Laravel's `users`, `activity_logs`, `system_settings` tables and the full Admin sub-area (user management, activity logs, reports) — no accounts exist in the new architecture, so there's nothing for them to manage. Personal emergency contacts + role choice live in browser `localStorage`, not Supabase.

Not yet decided (flagged for milestone 13): whether the Drawing Pad and Sign Language "AI avatar" page (`user.Non-Deaf.sign-language`, hearing-only) need any persistence at all — initial read of their controllers shows none currently.

---

## Milestone 1b — Admin content-management design

**Status: DONE (2026-09-01)**

User requirement: an admin side whose job is to add words, phrases, and upload new videos — i.e. update Kauban's content without a redeploy.

Decision: reuse CEDO's existing staff-tool pattern instead of building a new auth system. Precedent found in `src/app/staffToolTags.ts` — every gated staff tool (Scholar Management, SDP Monitoring, Scholars' Formation, Forms Management) is a `tag` on a staff account, checked with `currentUser.tags.includes("...")` in `App.tsx` and `Sidebar.tsx`, granted by it.admin1 from the Staff Accounts page. `StaffAccountsPage.tsx` renders tag checkboxes generically off the `STAFF_TOOL_TAGS` array, so adding one new entry there is the entire access-control change needed — no new login flow.

Plan:
- Add tag `kauban_content` ("Kauban Content Management") to `staffToolTags.ts`.
- Add one `isPageAuthorizedFor` case + one page-render case in `App.tsx`, one nav item in `Sidebar.tsx` — same 3-line pattern as every other tool.
- New module `src/kauban/admin/` (mirrors the existing `src/sead/` module shape: an `*Api.ts` for Supabase calls, a page component, a `pages/`/`components/` split if it grows):
  - **Sign Words tab** — list grouped by category; add/edit modal (label, matching phrase, category, upload clip video + upload tutorial video); delete.
  - **Quick Phrases tab** — manage categories (name/icon/color/order) and the phrases inside each.
  - **Emergency Content tab** — manage the bundled hotline contacts and canned messages.
- Video upload carries over the validation rules from the original app's own `docs/SIGN_LANGUAGE_VIDEOS.md` (MP4/H.264, lowercase filename with no spaces, muted, consistent framing) — enforced client-side before the file goes to the `kauban-media` Storage bucket, so bad uploads are caught at admin-entry time instead of failing silently for end users later.
- Kauban's **public** side stays fully account-free per the original scope — this tool only sits behind the staff login CEDO already has, the same way Scholar Management Tools does.

This pulls "Admin CMS" forward in the milestone order (previously milestone 14) to right after the data layer exists, since the public screens and the admin screens will read/write the exact same Supabase tables — building admin later would mean revisiting the schema twice.

---

## Milestone 4 — Supabase schema migration

**Status: SQL WRITTEN (2026-09-01) — needs you to run it**

Wrote [`supabase_migration_kauban_content_schema.sql`](../../supabase_migration_kauban_content_schema.sql) at the repo root, matching the exact conventions found in the existing migrations:
- Six tables per the milestone-1 schema design (`kauban_sign_categories`, `kauban_sign_words`, `kauban_quick_phrase_categories`, `kauban_quick_phrases`, `kauban_emergency_contacts`, `kauban_emergency_messages`), all `uuid` PKs with `gen_random_uuid()`, `created_at`/`updated_at` timestamps, `sort_order` — same shape as `supabase_migration_formation_positions.sql`.
- `kauban_sign_words.phrase` has a `check (phrase = lower(phrase))` constraint plus a unique index, since that column is matched word-for-word against speech transcripts in the Speech-to-Sign-Language screen — it has to stay lowercase for that matching to work, so the DB enforces it rather than trusting every caller.
- Row Level Security is enabled on all six tables. **Read is open to everyone** (`for select using (true)`) since Kauban's public side has no accounts — this is public educational content, not sensitive data. **Write is restricted** to staff accounts carrying the `kauban_content` tag, via a new `is_kauban_staff()` function that checks `staff_account_tags` the same way `is_formation_staff()` already does in `supabase_migration_formation_positions.sql` — same pattern, no new security model invented.
- Video files themselves aren't in this migration — `clip_video_path`/`tutorial_video_path` are just text columns holding a Storage object path; the actual bucket and file upload is milestone 5.

I cannot run this against your live Supabase project myself (no credentials in this repo, and every existing `supabase_migration_*.sql` file here is clearly meant to be pasted into the Supabase SQL editor by a person, not auto-applied) — so this milestone is "done" on my end but needs you to actually execute the file before milestone 5 can insert any real data into it.

**Action needed from you:** open your Supabase project's SQL editor and run `supabase_migration_kauban_content_schema.sql`. Let me know once it's applied (or if it errors) so I can mark this locked and move on to milestone 5.

**Update: confirmed applied successfully.** Locked.

---

## Milestone 5 (partial) + Milestone 7 + Milestone 8 (partial) — Batch video compression/upload tool

**Status: BUILT, awaiting your Storage SQL + a live test (2026-09-01)**

You asked to add video compression + batch video upload to Kauban Content Management before the rest of the plan continued, so this pass builds the storage layer, the admin access wiring, and the first real tool inside it together rather than in three separate later sessions.

**Milestone 5 (Storage bucket) — SQL written, not yet run by you:**
- New file [`supabase_migration_kauban_media_storage.sql`](../../supabase_migration_kauban_media_storage.sql) — creates the public `kauban-media` Storage bucket, a public-read policy, and a staff-write policy reusing `is_kauban_staff()` from milestone 4's migration. Same pattern as the existing `subject-certificates` bucket in `supabase_migration_subject_passing_rate.sql`, except public (these are non-sensitive educational videos, not certificates).
- **Action needed from you:** run this file in the Supabase SQL editor (after the milestone 4 file, which is already applied). The upload tool below will fail until this bucket exists.

**Milestone 7 (Admin CMS access wiring) — DONE:**
- Added a `kauban_content` tag to [`staffToolTags.ts`](../../src/app/staffToolTags.ts), following the exact pattern the other 4 staff tools already use (no new auth code).
- Wired the `kaubanContent` page into [`App.tsx`](../../src/app/App.tsx): added to the `Page` type, `PAGE_VALUES`, `isPageAuthorizedFor`, and the render switch.
- Added the nav item + updated `hasAnySpecificTool` in [`Sidebar.tsx`](../../src/app/components/Sidebar.tsx).
- No changes needed in `StaffAccountsPage.tsx` — it renders tag checkboxes generically from `STAFF_TOOL_TAGS`, so the new tag is grantable immediately.

**Milestone 8 (partial — video handling only, word/phrase CRUD table still pending) — DONE:**
- New module `src/kauban/admin/`:
  - [`kaubanAdminApi.ts`](../../src/kauban/admin/kaubanAdminApi.ts) — category fetch/create, and `uploadSignWordVideo()` which uploads a compressed file to `kauban-media` then upserts a `kauban_sign_words` row matched by `phrase` (so a later "tutorial" batch for the same words lands on the same rows as an earlier "clip" batch, not duplicates).
  - [`videoCompression.ts`](../../src/kauban/admin/videoCompression.ts) — `compressVideo()`, lazy-loads `@ffmpeg/ffmpeg` + `@ffmpeg/util` only when actually called (not part of the main bundle for anyone else). Strips audio, caps the long edge at 720px without upscaling, re-encodes H.264/yuv420p/faststart. ffmpeg-core's ~32MB wasm binary is vendored into `public/kauban-admin/ffmpeg-core/` (see its README) so this doesn't depend on a CDN.
  - [`BatchVideoUpload.tsx`](../../src/kauban/admin/BatchVideoUpload.tsx) — pick a category + variant (clip/tutorial) once, select many `.mp4` files, edit each one's Label/matching-phrase inline, then "Compress & Upload All" runs them through `compressVideo()` sequentially (ffmpeg.wasm only handles one job at a time) and uploads each, showing before/after size and per-row status.
  - [`KaubanContentManagementPage.tsx`](../../src/kauban/admin/KaubanContentManagementPage.tsx) — the page shell; currently just renders the batch uploader, with Quick Phrases / Emergency Content sections to be added for milestones 9-10.

**New dependency:** `@ffmpeg/ffmpeg`, `@ffmpeg/util`, `@ffmpeg/core` added to `package.json`. Also had to work around a pre-existing broken install (`@tailwindcss/oxide` was missing its Windows native binding — a known npm optional-dependency bug, unrelated to Kauban) by installing `@tailwindcss/oxide-win32-x64-msvc` with `--no-save`; if `npm install` is ever run fresh on this machine and the build fails the same way again, re-run that one install.

**Verified:** `npm run type-check` and `npx eslint src/kauban` both pass clean. `npm run build` was kicked off to confirm the full production bundle; not yet confirmed at the time of this entry (see next entry once it completes).

**Not yet verified — needs a live test from you:** I have no Supabase credentials and no way to log in as a tagged staff account in this environment, so I cannot exercise the actual upload flow end-to-end myself. Once you run the milestone 5 SQL and grant yourself the `kauban_content` tag from Staff Accounts, please try uploading a couple of real FSL clips and tell me what happens — especially whether the compressed file size looks reasonable and whether playback still looks right muted.

---

## Bug fix — "Compression failed" / no progress indicator / very long wait

**Status: FIXED and verified directly (2026-09-02)**

You reported: a single-video compression ran forever with no progress shown, and a later attempt failed outright with just "Compression failed." — no detail. Rather than guess, I ran the dev server myself (`npm run dev` via `.claude/launch.json`, new — lets me preview this app going forward) and exercised `compressVideo()` directly in a real browser with a synthetic test clip, bypassing the need for your Supabase login. Found three real bugs, all now fixed:

1. **Vite dev server hangs the compression forever.** `@ffmpeg/ffmpeg` spawns its own internal Web Worker; Vite's dev-time dependency pre-bundler rewrites that in a way that leaves the worker's own script request stuck pending indefinitely — confirmed by watching the network log stall on `worker.js?worker_file&type=module`. This only affects `npm run dev`, not the production build (Rollup handles it differently), which is exactly why my earlier `npm run build` test never caught it. **Fix:** added `optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] }` to `vite.config.ts`.
2. **Wrong ffmpeg-core build vendored.** I'd vendored the **UMD** build (`@ffmpeg/core/dist/umd/`). `@ffmpeg/ffmpeg`'s worker runs as a module-type Worker and, when `importScripts` isn't available (module workers don't have it), falls back to `await import(coreURL)` expecting an ES module with a default export — the UMD build has no such export, so this always failed with "failed to import ffmpeg-core.js" once bug #1 above was no longer hiding it. **Fix:** `scripts/copy-ffmpeg-core.mjs` now copies the **ESM** build (`dist/esm/`) instead.
3. **Real errors were being swallowed.** `@ffmpeg/ffmpeg` rejects failed commands with a plain string (its own `worker.js` does `data: e.toString()`), never an `Error` instance. My catch block in `BatchVideoUpload.tsx` checked `err instanceof Error` and silently fell back to a hardcoded "Compression failed." for every real ffmpeg failure, which is exactly the unhelpful message you saw. **Fix:** now shows the string directly when that's what was thrown.

Also added a proactive `preloadFFmpeg()` call (new export in `videoCompression.ts`) that starts fetching the ~32MB engine as soon as the admin opens the batch uploader, with a "Preparing compression engine…" indicator, so that first-use network fetch is visible instead of looking like the tool is frozen.

**Verified directly** (not just type-checked): ran `compressVideo()` in a real browser against a synthetic 20KB test clip — compressed to 15KB, progress events fired correctly (`0 → 0.02 → 0.29 → 0.93 → 1`), first run (cold, includes engine load) took ~2.8s, a second run in the same session (warm) took ~0.8s. Real FSL clips are bigger and will take longer, but the actual bug — the run never finishing at all — is confirmed gone. `npm run type-check`, `npx eslint src/kauban`, and `npm run build` all still pass after these changes.

**Still worth knowing going in:** ffmpeg.wasm is genuinely slower than a native ffmpeg install (software encoding in the browser, no hardware acceleration) — fine for an admin adding one or two new words at a time, but for the original *bulk* migration of the existing ~70 FSL video files, milestone 3's original design called for a separate native Node script (`ffmpeg-static`) instead, specifically because it's much faster for that one-time job. That script still hasn't been built — worth doing before using this in-browser tool to push all 70 files at once.

---

## Milestone 8 (continued) — Video Library monitoring + delete

**Status: BUILT (2026-09-02)**

You asked for a way to see what's already uploaded, organized by category and video type, plus a way to delete a video. Added as a second tab next to the batch uploader — [`KaubanContentManagementPage.tsx`](../../src/kauban/admin/KaubanContentManagementPage.tsx) now has "Upload Videos" and "Video Library" tabs.

**[`VideoLibrary.tsx`](../../src/kauban/admin/VideoLibrary.tsx)** (new):
- Groups every `kauban_sign_words` row by its category, with a per-category count like "12 words · 9/12 clips · 4/12 tutorials" so gaps are visible at a glance.
- Each word shows its Clip and Tutorial slots side by side — a filled slot has a play button (toggles an inline `<video>` preview, muted/autoplay) and a delete button; an empty slot just reads "not uploaded."
- Deleting a video removes the Storage file and clears just that path column — the word (label/phrase/category) stays, since you might re-record and re-upload later rather than starting over.
- A separate trash icon per row deletes the whole word — both videos (if present) plus the row itself — for when a word shouldn't exist at all anymore, not just needs a new video.
- All deletes confirm first (`window.confirm`, same pattern as the existing Forms Management delete flow) since Storage deletes aren't reversible.

**New API functions in [`kaubanAdminApi.ts`](../../src/kauban/admin/kaubanAdminApi.ts):** `fetchSignWords()`, `getVideoPublicUrl()`, `deleteSignWordVideo()`, `deleteSignWord()`.

**Verified:** `npm run type-check`, `npx eslint src/kauban`, and `npm run build` all pass. **Not visually verified this time** — I tried rendering the page directly in a browser (bypassing your login, by faking a cached staff profile in `localStorage` and pointing Supabase at a placeholder URL) to at least confirm the layout renders, but the app's own data-loading effect never clears its loading spinner when every Supabase call fails outright (expected — the placeholder project doesn't exist), so it never got past a "Loading…" screen. That's a limitation of not having a real Supabase connection in this environment, not a finding about the code itself. Please try the Video Library tab for real and let me know if anything looks off.

---

## Milestone 9 — Quick Phrases manager

**Status: BUILT (2026-09-02)**

Added a third tab, "Quick Phrases", next to Upload Videos and Video Library.

**[`QuickPhrasesManager.tsx`](../../src/kauban/admin/QuickPhrasesManager.tsx)** (new):
- Lists every `kauban_quick_phrase_categories` row as a card (icon, name, color swatch), each showing its `kauban_quick_phrases` inline — click the pencil to edit a phrase's text in place, trash to delete it (confirmed first), or type into the "Add a phrase…" box and hit Enter to add one.
- Category name/icon/color are editable the same way (pencil toggles an inline form with a native color-picker input); deleting a category warns how many phrases will go with it, since the DB cascade removes them too.
- New categories/phrases just append to the end (`sort_order` = current count) — no drag-to-reorder, matching how the original app never had reordering either and it wasn't asked for here.

**New API functions in [`kaubanAdminApi.ts`](../../src/kauban/admin/kaubanAdminApi.ts):** `fetchQuickPhraseCategories`, `createQuickPhraseCategory`, `updateQuickPhraseCategory`, `deleteQuickPhraseCategory`, `fetchQuickPhrases`, `createQuickPhrase`, `updateQuickPhrase`, `deleteQuickPhrase`.

**Verified:** `npm run type-check`, `npx eslint src/kauban`, `npm run build` all pass. Not visually verified live (same Supabase-connection limitation as the Video Library entry above).

**Remaining before Admin CMS is fully done:** milestone 10 (Emergency Content manager) is the last untouched admin screen.

---

## Milestone 8 (gap filled) — Sign Words edit

**Status: BUILT (2026-09-02)**

Added the missing piece: each word row in the Video Library tab now has a pencil icon (next to the existing delete-word trash icon) that turns the row into an inline form — Label, Matching phrase, and a Category dropdown — with Save/Cancel. Saving calls the new `updateSignWord()` in `kaubanAdminApi.ts`, which re-normalizes the phrase the same way upload does (lowercase, matching the DB's own `check` constraint) before writing it. Editing the category moves the word into that category's group the next time the list reloads, same as you'd expect.

Doesn't touch the word's videos — that's still `uploadSignWordVideo` (replace) and `deleteSignWordVideo` (remove), unchanged.

**Verified:** `npm run type-check`, `npx eslint src/kauban`, `npm run build` all pass. Not visually verified live (same Supabase-connection limitation noted earlier in this log).

Admin CMS is now feature-complete except milestone 10 (Emergency Content manager).

---

## Milestone 10 — Emergency Content manager

**Status: BUILT (2026-09-02)**

Added the fourth and final tab, "Emergency Content", completing the Admin CMS (milestones 7-10).

**[`EmergencyContentManager.tsx`](../../src/kauban/admin/EmergencyContentManager.tsx)** (new):
- **Emergency Contacts** — flat list (no categories, matching the schema), each with name/number/a color swatch via native color picker. Inline add/edit/delete, same pattern as Quick Phrases.
- **Emergency Messages** — flat list of canned messages, same inline add/edit/delete.
- Explicitly does **not** touch personal contacts a visitor adds for themselves during first-run setup — those were always meant to live only in that visitor's own browser (`localStorage`, no accounts — see milestone 1's finding about `AppSetup.php`'s "one install per device" design), never in these shared tables. Said so directly in the component's doc comment so a future edit doesn't accidentally conflate the two.

**New API functions in [`kaubanAdminApi.ts`](../../src/kauban/admin/kaubanAdminApi.ts):** `fetchEmergencyContacts`, `createEmergencyContact`, `updateEmergencyContact`, `deleteEmergencyContact`, `fetchEmergencyMessages`, `createEmergencyMessage`, `updateEmergencyMessage`, `deleteEmergencyMessage`.

**Verified:** `npm run type-check`, `npx eslint src/kauban`, `npm run build` all pass. Not visually verified live (same Supabase-connection limitation noted earlier in this log).

**Admin CMS (milestones 7-10) is now fully built.** Everything from here on is either (a) the still-pending Storage/seed-data groundwork (milestone 5's native batch-compression script + upload of the existing 70 videos, milestone 6's initial data seed), or (b) the public-facing `/kauban` screens (milestones 11-16), which is the next major phase of the plan.

---

## Milestone 5 (remaining piece) + Milestone 6 — Native batch migration script + seed data SQL

**Status: BOTH WRITTEN (2026-09-02) — need you to actually run them**

**[`scripts/kauban-migrate-videos.mjs`](../../scripts/kauban-migrate-videos.mjs)** (new) — the native (real ffmpeg, not ffmpeg.wasm) batch script milestone 3's original design called for, now actually built:
- Takes `--source "<path>"` pointing at the extracted Laravel app's `public/fsl` folder (must contain `videos/` and `tutorial/<category>/` subfolders, matching the original app's own layout).
- Walks both folders, compresses every `.mp4` with the exact same settings as the in-browser compressor (`videoCompression.ts`) — strip audio, cap 720px, H.264 CRF 28 — via a real `ffmpeg-static` binary instead of WASM, then uploads each to the `kauban-media` bucket at `clips/<file>` / `tutorial/<file>` using the Supabase **service role** key (bypasses RLS — same trusted-local-script pattern as `create-admin-accounts.mjs`).
- Doesn't touch `kauban_sign_words` at all — the seed SQL below already points each word at these exact paths, so running both (in either order) is what makes videos "show up."
- Safe to re-run: each upload is `upsert: true`, and a per-file failure is caught and reported rather than stopping the whole batch.

**Bug caught and fixed while building this:** `@supabase/supabase-js`'s `createClient()` unconditionally constructs a Realtime client, which throws immediately on Node < 22 if `WebSocket` isn't a global — confirmed by hand (this script never uses realtime at all, but the crash happens regardless). Fixed with a `ws`-package polyfill at the top of the script. **Heads up:** `scripts/create-admin-accounts.mjs` calls `createClient()` the same way and likely has this exact same bug on Node 18/20 — I didn't touch that file since it's outside this milestone's scope, but if you ever hit "Node.js detected but native WebSocket not found" running it, this is why.

**[`supabase_migration_kauban_seed_content.sql`](../../supabase_migration_kauban_seed_content.sql)** (new) — every row copied directly from the original app's `quiz-words.json` / `quick-phrases.json` / `emergency.json` (no invented data): 2 sign categories, all 35 sign words (with `clip_video_path`/`tutorial_video_path` pre-set to match what the script above uploads to), 4 quick-phrase categories, all 22 quick phrases, 2 emergency contacts, 4 emergency messages. Every insert is `on conflict do nothing`, so it's safe to re-run and never clobbers anything you've since edited through the admin tool — this needed adding a small unique index to 3 tables that didn't have one yet (`kauban_quick_phrase_categories.name`, `kauban_quick_phrases (category_id, text)`, `kauban_emergency_contacts.name`, `kauban_emergency_messages.message`), documented at the top of the file.

**Verified:**
- The script's compression logic: ran it for real against a synthetic test clip (native ffmpeg via `ffmpeg-static`, not just type-checked) — compressed correctly (20410 → 16482 bytes), and separately confirmed its directory-walking (including the nested `tutorial/<category>/` structure) and error-handling against a fake source folder + fake credentials: it found both files, compressed both, and reported the (expected, since the credentials were fake) upload failures per-file without crashing.
- `npm run type-check`, `npx eslint`, `npm run build` all still pass.
- **Not verified:** an actual successful upload against your real Supabase project, and the seed SQL's execution — both need real credentials/access I don't have. Please review the SQL file yourself before running it (it's short and every value is traceable to the source JSON files cited above), then run both this SQL and the migration script (after extracting `Kauban App.zip` somewhere and pointing `--source` at its `public/fsl` folder).

Once both are run, the Admin CMS should show real content instead of an empty state, and milestones 5-6 are fully done — only the public-facing screens (11-16) remain.

**Update (2026-09-02):** Seed SQL confirmed run successfully — milestone 6 is locked. Milestone 5's video upload is **deferred by your explicit choice**: you're fine launching without videos yet and will upload them later (via `kauban-migrate-videos.mjs` for the bulk original set, or the admin Batch Video Upload tab for anything after). Not a blocker — `kauban_sign_words` rows now exist with `clip_video_path`/`tutorial_video_path` pointing at paths that don't have files behind them yet, so anything reading those paths (the admin Video Library preview, and later the public Speech-to-Sign-Language screen) will show "not uploaded"/broken video until you do. Noting this explicitly so a future session doesn't mistake it for a bug.

**Current state:** all of milestones 1-10 done, milestone 6 done, milestone 5 intentionally partial (data ready, video files pending). Next up per the plan is milestone 11 — the first of the public-facing `/kauban` screens.

---

## Milestone 11 — Public route scaffolding + role-selection shell

**Status: DONE (2026-09-02), visually verified live**

`https://cedo-ten.vercel.app/kauban/` now works as its own app, entirely separate from the staff app and the CEDO/Scholar Portal site.

**[`src/main.tsx`](../../src/main.tsx)** — added a third branch: any path starting with `/kauban` now mounts `KaubanApp` instead of falling through to the staff app (previously anything not starting with `/cedo` rendered the staff app by default — `/kauban` would have silently hit that fallback and shown the staff sign-in page).

**New module `src/kauban/`** (the public app, separate from `src/kauban/admin/`):
- **[`types.ts`](../../src/kauban/types.ts)** — `KaubanRole` ('deaf' | 'hard-of-hearing' | 'hearing', matching the original Laravel app's own session role values exactly) and `KaubanPage`.
- **[`localRole.ts`](../../src/kauban/localRole.ts)** — get/set/clear the visitor's role choice in `localStorage`. This is the direct equivalent of the original app's `AppSetup.php` (one JSON file per device) — no accounts, no server round-trip.
- **[`kaubanTools.ts`](../../src/kauban/kaubanTools.ts)** — the 9 tools with their per-role visibility, copied from the original app's actual role checks (`QuickPhraseController` redirects "hearing" away, `SpeechToSignLanguageController` is deaf-only, everything else is open to all) — not a new restriction invented here.
- **[`pages/RoleSelectionPage.tsx`](../../src/kauban/pages/RoleSelectionPage.tsx)** — the entry screen, three large accessible buttons (Deaf / Hard of Hearing / Hearing).
- **[`pages/DashboardPage.tsx`](../../src/kauban/pages/DashboardPage.tsx)** — role-filtered grid of tool cards + "Switch Role".
- **[`pages/ComingSoonPage.tsx`](../../src/kauban/pages/ComingSoonPage.tsx)** — placeholder for the 9 tool screens milestones 12-15 fill in one at a time; `KaubanApp.tsx` just swaps each `ComingSoonPage` case for the real screen as it's built, no shell rework needed later.
- **[`KaubanApp.tsx`](../../src/kauban/KaubanApp.tsx)** — root component. Follows the same manual view-state pattern as `ScholarSiteApp.tsx` rather than introducing a client-side router — `react-router` is an installed but completely unused dependency in this codebase (confirmed by grep), so a router would've been a new pattern, not a reused one.

**Scoping note:** milestone 11's own wording is "role-selection shell" specifically — the original app's onboarding also had an emergency-contacts setup step right after role choice; that's deliberately left for milestone 15 (Emergency screen) instead of half-built now, so it isn't touched twice.

**Bug caught by `npm run build` that `npm run type-check` missed:** `kaubanTools.ts` typed each tool's icon as `ComponentType<{ size?: number; ... }>`, but lucide-react's actual icon props allow `size?: string | number` — `tsc -b` (build mode, what `npm run build` actually runs) caught the resulting structural mismatch via a `propTypes` comparison; plain `tsc --noEmit` (the `type-check` script) did not. Fixed by matching lucide's real prop type. Worth remembering: `type-check` passing isn't proof `build` will too.

**Verified live, not just built** — ran the actual dev server and drove it as a user, in the browser:
- `/kauban` shows the role picker (no Supabase calls happen on this path, so this didn't hit the earlier no-credentials wall).
- Picking "Deaf" shows all 9 tools; a tool card opens its "Coming Soon" placeholder with the right title; "Back to Dashboard" returns correctly.
- Reloading `/kauban` after picking a role skips straight to the dashboard (localStorage persistence confirmed).
- "Switch Role" clears back to the picker; picking "Hearing" correctly hides Quick Phrases and Speech to Sign Language (the two role-gated tools) — filtering confirmed working both ways.
- Checked mobile viewport (375×812) — cards stack cleanly, no overflow.
- Regression-checked `/CEDO` still renders its own site correctly after the `main.tsx` change — no cross-app breakage.

Milestone 12 (Quick Phrases + Sign Language browse/tutorial + Sign Quiz screens) is next.

---

## Milestone 12 — Quick Phrases + Sign Language browse/tutorial + Sign Quiz

**Status: DONE (2026-09-02), verified as far as this environment allows**

Three real tool screens replace their `ComingSoonPage` placeholders in `KaubanApp.tsx`.

**New shared pieces:**
- **[`kaubanPublicApi.ts`](../../src/kauban/kaubanPublicApi.ts)** — read-only Supabase queries for the public site, deliberately separate from `src/kauban/admin/kaubanAdminApi.ts` (that module has writes and pulls in the video-compression code path — neither belongs in a visitor's bundle).
- **[`speechSynthesis.ts`](../../src/kauban/speechSynthesis.ts)** — thin Web Speech API wrapper, used by Quick Phrases now and the Text-to-Speech tool (milestone 14) later.
- **[`components/KaubanPageHeader.tsx`](../../src/kauban/components/KaubanPageHeader.tsx)** — shared back-button + title header, one implementation instead of copy-pasting it into every tool screen.
- **[`components/KaubanVideo.tsx`](../../src/kauban/components/KaubanVideo.tsx)** — a video slot that catches a load failure (`onError`) and shows "Video not available yet" instead of a broken player. This matters right now specifically because milestone 5 was left intentionally partial — `kauban_sign_words` rows have paths set but the actual files aren't uploaded, so every video in these screens is expected to hit this fallback until you run the migration script.

**[`pages/QuickPhrasesPage.tsx`](../../src/kauban/pages/QuickPhrasesPage.tsx)** — tap a phrase, it's shown large on screen and spoken aloud via `speechSynthesis` at the same time; a replay button on the banner in case they want to hear it again.

**[`pages/SignLanguagePage.tsx`](../../src/kauban/pages/SignLanguagePage.tsx)** — browse by category, tap a word to play its tutorial video (falls back to the clip video if only that variant exists). **Scoping deviation, noted deliberately:** the original Laravel app sent "hearing" visitors to a separate "AI avatar" translator page instead of this browse/tutorial view — building a whole AI-avatar feature was never discussed with you and is a large undertaking on its own, so all three roles get this same browse screen instead. Flagging this now rather than silently diverging from the original app's behavior.

**[`pages/SignLanguageQuizPage.tsx`](../../src/kauban/pages/SignLanguageQuizPage.tsx)** — the original blade template's exact quiz mechanics were never extracted (only `SignQuizController.php`, which just loads the word list, was read during milestone 1), so this is a standard reconstruction matching its evident purpose ("Test what you've learned"): watch a word's clip video, pick the right label from 4 choices, 10 questions per round, score shown at the end, "Try Again" reshuffles. A word whose video fails to load falls back the same way `KaubanVideo` does everywhere else.

**Verified:**
- `npm run type-check`, `npx eslint src/kauban`, `npm run build` all pass (ran the full build this time before declaring done, given milestone 11's lesson that `type-check` alone isn't sufficient).
- **Live in the browser, structurally**: navigated to all three screens, confirmed headers/back-buttons work, confirmed the loading → empty-state transition works correctly on each ("No quick phrases have been added yet." / "No sign words have been added yet." / "Not enough sign words have been added yet for a quiz.").
- **Not verified**: actual rendering with real seeded data, video playback, the quiz's answer/scoring flow, or the speech-synthesis calls — this sandbox has no reachable Supabase project, so every fetch returns empty by design (network failure caught and treated as "no data"). Once you load `/kauban` yourself with the real project connected, please check these three screens for real, especially whether the quiz feels right — its exact mechanics were reconstructed, not copied from a source I could read.

Milestone 13 (Speech-to-Sign-Language) is next — the one screen that actually needs the Web Speech API's *recognition* side (these three used only speech *synthesis*).

---

## Milestone 13 — Speech to Sign Language

**Status: DONE (2026-09-02), verified live including a real bug catch**

**[`signWordMatching.ts`](../../src/kauban/signWordMatching.ts)** — this one **is** a direct port, not a reconstruction: the greedy longest-phrase-first matching algorithm is copied from the original app's actual `speech-to-sign-language.blade.php` JS (captured word-for-word in milestone 1's log), just run against `kauban_sign_words` rows instead of a hardcoded object. Multi-word phrases ("good morning") are checked before single words so they win, exactly like the source.

**[`speechRecognition.ts`](../../src/kauban/speechRecognition.ts)** — minimal local types for the Web Speech API's recognition side (TypeScript's DOM lib doesn't reliably cover it), mirroring `speechSynthesis.ts`'s wrapper style from milestone 12.

**[`pages/SpeechToSignLanguagePage.tsx`](../../src/kauban/pages/SpeechToSignLanguagePage.tsx)** — press the mic, speak, matched words play as muted sign-language clips in sequence. **One deliberate simplification from the original, stated directly:** the source used a dual-video-element crossfade between clips for a seamless transition; this uses one `<video>` that swaps `src` on `onEnded` — a visible cut instead of a crossfade, functionally equivalent but less polished. Clips stay muted (matching the original's own autoplay-safety rule). A word with no clip uploaded yet is skipped automatically rather than showing a broken player, same pattern as `KaubanVideo` elsewhere.

**Real bug caught by live testing, not just code review:** clicking the mic and having the browser deny microphone permission left the Stop button (red, mic-off icon) showing even though recognition had actually failed and wasn't running — misleading the user into thinking it was still listening. Worse, the `onend` auto-restart logic would have kept retrying against a permission that was already permanently denied. Fixed: a `not-allowed`/`service-not-allowed` error now resets the listening state so the UI honestly reflects that it stopped, and the auto-restart doesn't fire again.

**Verified:**
- `npm run type-check`, `npx eslint src/kauban`, `npm run build` all pass.
- **Live in the browser**: confirmed the "unsupported browser" branch doesn't fire (this Chrome-based pane has `webkitSpeechRecognition`), pressed the actual mic button, watched the real permission-denied flow happen (the sandbox blocks mic access, which triggered the exact `onerror` path a real denial would), caught the stuck-button bug from that, fixed it, and re-tested to confirm the button now correctly returns to idle.
- **Not verified**: an actual successful recognition + matching + playback cycle, since that needs a real microphone this sandbox can't provide, and real video files this project doesn't have yet (milestone 5 still pending). The matching algorithm itself is worth double-checking once both exist, even though it's a direct port rather than a reconstruction.

Milestone 14 (Text-to-Speech, Speech-to-Text, Drawing Pad — all pure client-side, no backend) is next.

---

## Milestone 14 — Text to Speech, Speech to Text, Drawing Pad

**Status: DONE (2026-09-02), most thoroughly verified milestone yet — genuine end-to-end tests, not just structural ones**

All three tools are pure client-side, no Supabase involved at all — which meant, for the first time this project, I could actually verify real functionality live rather than just empty-state handling.

**[`pages/TextToSpeechPage.tsx`](../../src/kauban/pages/TextToSpeechPage.tsx)** — textarea, Speak/Stop/Clear. **Verified for real**: typed a sentence, pressed Speak, watched the button correctly change to "Speaking…" with Stop enabled — this is genuine working `speechSynthesis` behavior confirmed live, not inferred from reading the code.

**[`pages/SpeechToTextPage.tsx`](../../src/kauban/pages/SpeechToTextPage.tsx)** — mic button, live transcript area, Copy/Clear. Shares the exact same permission-error handling fixed in milestone 13 (reused, not re-implemented) — verified that fix works here too, not just on the screen it was originally found on.

**[`pages/DrawingPadPage.tsx`](../../src/kauban/pages/DrawingPadPage.tsx)** — canvas with pointer-event drawing, 7 preset colors + a custom color picker, brush size slider, Clear, and Save (downloads a PNG). No persistence anywhere, matching the original app's own `DrawingPadController` (just returns a view, nothing stored). **Verified for real**: actually drew on the canvas with a drag gesture (a real line appeared), switched color and drew again (color change applied correctly), and confirmed Clear wipes it — this is a fully working feature, confirmed by using it, not just by reading the pointer-event code and trusting it.

**Verified overall:** `npm run type-check`, `npx eslint src/kauban`, `npm run build` all pass. Live-tested Text-to-Speech (genuinely works), Drawing Pad (genuinely works, drew/colored/cleared for real), and Speech-to-Text's permission-error path (confirmed the milestone-13 fix generalizes correctly).

**Still not verified:** an actual successful speech-*recognition* result (this sandbox has no real microphone), and nothing here touches Supabase so there's nothing seed-data-related left to check for these three specifically.

All 9 tool screens are now built (milestones 11-14 complete). Only milestone 15 (Emergency screen) and milestone 16 (deploy + QA + PWA + docs handoff) remain on the original 16-milestone plan, plus the still-pending milestone 5 video upload whenever you're ready for it.

---

## Milestone 15 — Emergency screen

**Status: DONE (2026-09-02), verified live including a real scope gap caught along the way**

**[`localEmergencyContacts.ts`](../../src/kauban/localEmergencyContacts.ts)** — a visitor's own contacts, `localStorage`-only, the direct equivalent of the original app's per-device `storage/app/setup.json` personal contacts (milestone 1's finding). Never touches Supabase.

**[`pages/EmergencyPage.tsx`](../../src/kauban/pages/EmergencyPage.tsx)** — three sections, personal contacts shown first (same reasoning the original `EmergencyController` used — "usually the most relevant in an actual emergency"):
- **Your Contacts** — add/remove your own, each with a one-tap `tel:` call link.
- **Emergency Services** — the staff-managed bundled contacts (`EmergencyContentManager.tsx`, built back in milestone 10), also one-tap call links.
- **Quick Messages** — tap a canned message to show it large and speak it aloud, same interaction pattern as milestone 12's Quick Phrases screen (intentionally reused, not reinvented).

**New public reads in [`kaubanPublicApi.ts`](../../src/kauban/kaubanPublicApi.ts):** `fetchEmergencyContacts`, `fetchEmergencyMessages` — the admin API already had these for the staff tool; the public site needed its own read-only versions for the same separation-of-concerns reason as every other public fetch (see milestone 12's note on why the two API files are split).

**Scope gap caught and documented, not silently patched over:** wiring the last `case` into `KaubanApp.tsx`'s switch revealed that **"Sign Language Tools" was never actually assigned to any milestone** — it's one of the 9 dashboard tools from milestone 11, but milestones 12-15 only ever named 8 of them. There's no source detail on what this screen should contain (its Laravel controller was never read in milestone 1's investigation), so it intentionally still falls through to `ComingSoonPage` rather than inventing content for it. Flagging this now so it's a deliberate decision on record, not a thing that quietly falls through the cracks.

**Verified:**
- `npm run type-check`, `npx eslint src/kauban`, `npm run build` all pass.
- **Live in the browser, and this time the localStorage half is a genuine end-to-end test**: added a real contact ("Mom", a phone number) through the actual form, confirmed it rendered with a working `tel:` call button, **reloaded the page and confirmed it persisted**, then deleted it and confirmed it's gone. The bundled-content sections (Supabase-backed) correctly showed their empty states, same limitation as every other Supabase-reading screen in this sandbox.

**Remaining on the original 16-milestone plan:** milestone 16 (deploy, full QA, PWA manifest/service worker, docs handoff) and the still-deferred milestone 5 video upload. The undocumented "Sign Language Tools" gap noted above is also outstanding, separate from the numbered plan.

---

## Sign Language Tools gap — filled

**Status: DONE (2026-09-02), verified live**

Rather than guess at what this screen should contain, went back to the original `Kauban App.zip` and actually extracted/read `SignLanguageToolsController.php` and `resources/views/sign-language-tools.blade.php` — neither had been read during milestone 1's investigation, which is why the gap existed. Turned out to be simple: a navigation hub linking to tools that already exist, with role-based visibility. No invented content needed after all.

**[`pages/SignLanguageToolsPage.tsx`](../../src/kauban/pages/SignLanguageToolsPage.tsx)** — a direct port of the blade file's `@if(session('role') ...)` conditions:
- Text to Speech — shown unless role is "hearing"
- Speech to Sign — shown only for "deaf"
- Sign Language / Sign Language Tutorial — always shown, label switches on role (matches the original's own `@if(session('role') === 'hearing')` branch in the card itself)
- Speech to Text — shown only for "hearing"
- Sign Language Quiz — always shown

Wired into `KaubanApp.tsx`'s switch, which now handles all 9 dashboard tools explicitly — no `default` case, no `ComingSoonPage` fallback needed anymore. Deleted `pages/ComingSoonPage.tsx` since it became genuinely unused (confirmed via a grep before deleting, not assumed).

**Verified:**
- `npm run type-check`, `npx eslint src/kauban`, `npm run build` all pass — including confirming TypeScript's own exhaustiveness checking accepts the switch with no `default`, since every `KaubanPage` member now has a case.
- **Live in the browser**: navigated to the hub as the "Deaf" role and confirmed exactly the 4 expected cards appear (Text to Speech, Speech to Sign, Sign Language Tutorial, Sign Language Quiz) with Speech to Text correctly absent, then clicked into Sign Language Quiz and confirmed it actually routes to the real screen, not a placeholder.

All 9 Kauban tool screens are now fully built with no remaining gaps. Only milestone 16 (deploy, QA, PWA, docs handoff) and the deferred milestone 5 video upload remain.

---

## Dashboard cleanup + real color scheme

**Status: DONE (2026-09-02), verified live**

**1. Removed 4 redundant dashboard tiles** — Sign Language, Sign Language Quiz, Speech to Sign Language, and Text to Speech no longer appear as separate tiles on the Dashboard, per your instruction. Confirmed against the actual original source while making the change: `resources/views/layout.blade.php`'s bottom nav bar has only 5 icons total (Home, Quick Phrases, one combined "Sign Language Tools" icon, Drawing Pad, Emergency) — its `active` class check literally matches all of `sign-language-tools`, `text-to-speech`, `speech-to-sign-language`, `sign-language`, `sign-language.tutorial`, and `speech-to-text` as one nav item. The original app never had separate top-level entries for these; my earlier 9-tile dashboard was a deviation, not something carried over from the source. The 4 pages themselves are untouched and still reachable through the Sign Language Tools hub. Left Speech to Text as its own tile, exactly as you specified — didn't extend the cut to it on my own judgment.

**2. Applied the original app's actual color scheme**, found by reading `layout.blade.php`'s `<style>` block (not previously read in full — earlier work had been using an invented indigo/violet palette):
- Page background: the signature `linear-gradient(135deg, #059669, #2563EB)` (emerald to blue), with a light `#F7FAFC` rounded content card floating on top — matches `.content` in the source exactly (border-radius 20px, box-shadow, padding).
- Primary accent: `#3182CE` (replacing the invented `#4F46E5`) — buttons, focus rings, active/hover borders.
- Header nav button style: `#EBF8FF` background / `#2B6CB0` icon+text, matching `.header-nav-btn` exactly, used for every page's back button and several icon chips.
- Heading text `#2D3748`, muted text `#718096` — matches `.welcome-header h2`/`p` exactly.
- App brand title "Kauban" now uses the original's actual brand green `#10B981` (was an invented dark navy).
- Role badges ("Signed in as: X") now use the exact per-role gradients from `.user-role-badge.{deaf,hard-hearing,hearing}` — gold for Deaf, green for Hard of Hearing, blue for Hearing.

Every one of the 13 kauban page/component files was updated; confirmed with a grep afterward that no `#4F46E5`/`#1E1B3A`/`#FAF9FC` (the old invented palette) remained anywhere in the module.

**Verified:**
- `npm run type-check`, `npx eslint src/kauban`, `npm run build` all pass.
- **Live in the browser**: confirmed the Dashboard shows exactly 5 tiles (Quick Phrases, Sign Language Tools, Speech to Text, Drawing Pad, Emergency) for the Deaf role, and 4 for Hearing (Quick Phrases correctly absent) — role-based filtering still works correctly with the smaller tile set. Visually confirmed the gradient background, white content card, green brand title, and both the gold (Deaf) and blue (Hearing) role badges render matching the original's own gradient definitions.

---

## Mobile/tablet optimization + kid-friendly styling

**Status: DONE (2026-09-02), build/lint/type-check verified; interactive testing partially blocked by a tooling issue**

Most Kauban users are kids under 8 on a phone or tablet, so this pass went through all 13 kauban page/component files for touch ergonomics and a friendlier visual style, on top of the color-scheme work above.

**Mobile/touch changes:**
- Every icon-only button that was too small for a kid's finger (e.g. Emergency's remove-contact trash icon, previously bare with no padding) now has an explicit ≥44px touch target.
- Added `active:scale-*` press feedback to essentially every interactive element (buttons, cards, color swatches) — a visible "squish" on tap instead of a hover-only affordance, since hover doesn't exist on touchscreens. Kept `hover:` variants but scoped them behind `sm:` so they only apply on larger/pointer-capable screens.
- Grew the mic buttons (Speech to Text, Speech to Sign Language) from 64px to 72px, and the Dashboard/Sign Language Tools tiles now use a 2-column grid by default (was 1-column) — reads more like a kid-friendly app-icon launcher on a phone.
- Form inputs (Emergency's add-contact fields) were `text-sm` (14px), which triggers Safari's iOS auto-zoom on focus — bumped to `text-base`/`text-lg` (16px+) everywhere text gets typed.
- Added `playsInline` to `KaubanVideo.tsx`'s video element (the Speech-to-Sign-Language screen already had it) so videos don't force an unexpected fullscreen takeover on iOS.
- Reduced outer page padding on small screens (`p-3` instead of `p-4`/`p-6`) so more content fits without feeling cramped.
- Confirmed `index.html`'s viewport meta tag was already correct (`width=device-width`, no `user-scalable=no` — that would have been an accessibility regression) — no change needed there.

**Kid-friendly styling changes:**
- Added the "Fredoka" Google Font (a rounded, playful display face) via `index.html` — used only by Kauban's own headings/emphasis text (`style={{ fontFamily: "'Fredoka', sans-serif" }}`) via inline styles, not a global app change; the other two apps in this bundle never reference it.
- **[`kaubanTools.ts`](../../src/kauban/kaubanTools.ts)** now carries a distinct bright `bg`/`fg` color pair per dashboard tool instead of one uniform blue — colors are lifted from the original app's own varied per-icon SVG fills (blue, purple, orange, green, red), not invented. `SignLanguageToolsPage.tsx`'s cards got the same treatment. `RoleSelectionPage.tsx`'s three role options now echo their own role badge's color (gold/green/blue) for a cohesive thread from first screen to dashboard.
- Rounded corners pushed further (`rounded-2xl`/`3xl` throughout, was mostly `xl`/`2xl`) for a softer, bubblier look.

**Verified:**
- `npm run type-check`, `npx eslint src/kauban`, `npm run build` all pass.
- **Live, partially**: confirmed via screenshot at a 375×812 mobile viewport that the Dashboard renders correctly — colorful distinct tile icons, the Fredoka brand title, comfortable 2-column touch grid, pill-shaped Switch Role button. **Could not complete interactive testing this round** — the Browser tool's click/tap dispatch started timing out mid-session (screenshots and navigation kept working, so the page itself was fine; this looked like a tooling-side issue, not a regression in the code) after this round's changes were already visually confirmed once. Given the DrawingPad's actual pointer-event drawing logic was untouched this pass (only its touch-target sizing and animations changed) and was already verified working end-to-end in milestone 14's session, risk is low — but genuinely re-testing touch drawing, button press feedback, and the Emergency form on a real device is worth doing when you get the chance.

**Build confirmed clean (2026-09-01):** `npm run type-check`, `npx eslint src/kauban`, and a full `npm run build` all pass. Along the way, found and fixed a pre-existing broken install unrelated to Kauban (`@tailwindcss/oxide` was missing its Windows native binding — a known npm optional-dependency bug) by installing `@tailwindcss/oxide-win32-x64-msvc` with `--no-save`, so it didn't pollute the lockfile.

Also caught before committing: the vendored `ffmpeg-core.wasm` (~32MB) would have permanently bloated the git repo for no reason, since it's 100% derived from the `@ffmpeg/core` npm package already in `node_modules`. Fixed by adding [`scripts/copy-ffmpeg-core.mjs`](../../scripts/copy-ffmpeg-core.mjs) as a `postinstall` step that regenerates `public/kauban-admin/ffmpeg-core/` on every `npm install`, and gitignoring that folder instead of committing it.

**Files changed this pass:**
- New: `supabase_migration_kauban_media_storage.sql`, `src/kauban/admin/{kaubanAdminApi.ts, videoCompression.ts, BatchVideoUpload.tsx, KaubanContentManagementPage.tsx}`, `scripts/copy-ffmpeg-core.mjs`, `public/kauban-admin/README.md`
- Edited: `src/app/App.tsx`, `src/app/components/Sidebar.tsx`, `src/app/staffToolTags.ts`, `package.json`, `package-lock.json`, `.gitignore`
- Nothing has been committed to git yet — all of the above sits as uncommitted working-tree changes, awaiting your review.

---

## Persistent top + bottom navigation

**Status: DONE (2026-09-02), verified live end-to-end including navigation edge cases**

Added the original app's actual persistent navigation chrome, ported from `resources/views/layout.blade.php`'s always-present `.app-header` and `.bottom-nav` — until now every Kauban screen managed its own full-screen background and an in-page back button, with no global "you are here" or quick-jump navigation, unlike the source app.

**[`components/KaubanTopNav.tsx`](../../src/kauban/components/KaubanTopNav.tsx)** (new) — sticky top bar, shown on every screen once a role is picked: Home + Back (Back only when not already on the dashboard) on the left, the "Kauban" brand center, and a role-colored pill on the right that opens a one-item dropdown ("Switch Role") — a direct port of the original's profile-dropdown-with-one-action shape.

**[`components/KaubanBottomNav.tsx`](../../src/kauban/components/KaubanBottomNav.tsx)** (new) — the floating pill-shaped icon bar from the same source file: Home plus one icon per `KAUBAN_TOOLS` entry, each in that tool's own color (reusing the colors from the earlier kid-friendly-styling pass). The "Sign Language Tools" icon lights up as active for all 4 of its hub sub-pages too (textToSpeech, speechToSignLanguage, signLanguage, signLanguageQuiz) — ported directly from the original's own combined-route `active` check, which matched all of those against one icon.

**Smarter "Back" than a plain history stack:** pages reached through the Sign Language Tools hub return to the hub on Back, not the dashboard — `KaubanApp.tsx` computes this from a small `HUB_SUB_PAGES` list rather than tracking real navigation history (this app has no URL-per-page routing, so there's no browser history to call `.back()` on).

**Structural cleanup this required:**
- Every one of the 9 tool pages had its own `min-h-screen bg-gradient-to-br ...` wrapper — removed all 9, since the gradient background + nav shell now lives once in `KaubanApp.tsx`, wrapping whichever page is active.
- `KaubanPageHeader.tsx` lost its back-button (now redundant with TopNav's global Back) — it's just a page title/subtitle now.
- `DashboardPage.tsx` lost its own "Kauban" brand title, role badge, and "Switch Role" button — all three now live once in TopNav instead of being duplicated on the home screen specifically.
- Every page's `onBack` prop was removed entirely — navigation is fully global now, no per-page prop drilling.

**Real bug caught by the full build, not by `type-check`:** the exact same class of issue found in milestone 11 — `tsc -b` (what `npm run build` runs) didn't narrow `role: KaubanRole | null` to non-null inside `KaubanApp.tsx`'s nested `renderPage()` closure the way plain `tsc --noEmit` did, so `npm run build` failed while `type-check` had passed clean. Fixed by re-binding to an explicitly-typed `const currentRole: KaubanRole = role` right after the null check, which the closure captures instead. Worth remembering: this project's `type-check` script is not sufficient proof the build will pass — the full build must run before calling anything done, which is exactly the practice this session has been following since milestone 11.

**Verified live, thoroughly:**
- `npm run type-check`, `npx eslint src/kauban`, `npm run build` all pass (after the fix above).
- Actually drove the new nav in a browser: confirmed Home highlights correctly on the dashboard and un-highlights elsewhere, confirmed Back is hidden on the dashboard and appears everywhere else, confirmed navigating two levels deep (Dashboard → Sign Language Tools → Sign Language) then pressing Back returns to the hub specifically — not the dashboard, exercising the smarter-than-history-stack logic directly — and confirmed the role-badge dropdown opens, and its "Switch Role" action correctly returns to the role-selection screen.

---

## Milestone 16 — PWA baseline, docs handoff, final QA

**Status: DONE (2026-09-02)**

**PWA icons** — no image-editing tool is available in this environment, so icons were generated by writing an HTML5 `<canvas>` script (gradient background + a centered 👋 emoji), serving it through the Vite dev server from a temporary `public/__icon-gen.html` (files outside the actual Vite project root only render as inert static snapshots — confirmed directly — so the generator had to live inside `public/` to execute), and extracting each size as a base64 PNG via the browser tool, decoded to real files with a small local Node script. `public/kauban-icons/`: `icon-192.png`, `icon-512.png` (Android/manifest, rounded-square), `icon-512-maskable.png` (full-bleed circle, Android maskable purpose), `apple-touch-icon.png` (180×180 flat square, iOS applies its own rounding). One extraction round-tripped through a manual copy-paste and came out corrupted (valid PNG header, blank gray pixel data) — caught by actually opening the file in the browser rather than trusting the byte count; re-extracted through the same file-based decode pipeline used for the other three and confirmed visually correct. The temporary `public/__icon-gen.html` was deleted before finishing — it's scratch tooling that must never ship.

**Manifest + service worker** — `public/kauban-manifest.webmanifest` (name "Kauban", `start_url`/`scope` `/kauban`, brand-gradient theme/background colors, all 4 icon purposes) and `public/kauban-sw.js` (hand-rolled — no `vite-plugin-pwa` in this project, and Vite's hashed build filenames rule out a hardcoded precache list). Caching strategy: sign/tutorial video clips (matched by the Supabase Storage `kauban-media` path) are cache-on-first-play so an already-watched word keeps working offline; full-page `/kauban*` navigations are network-first with a cached-shell fallback; hashed `/assets/*` and `/kauban-icons/*` are cache-first (safe — content-hashed, immutable); everything else, notably every `kauban_*` table read, always goes to the network untouched, since caching staff-edited content would go stale in a way that's actively harmful (e.g. a deleted emergency contact reappearing offline). Both the manifest `<link>`/apple-touch-icon `<link>`/theme-color `<meta>` and the service-worker registration are injected conditionally from `src/main.tsx`, only when `isKaubanSite`, matching the existing pathname-dispatch pattern — the staff app and public CEDO site (same Vite build) are untouched.

**Real bug caught during QA, not by the build:** driving the app live surfaced that the "Switch Role" dropdown (`KaubanTopNav.tsx`) stayed open across page navigation when navigating via `KaubanBottomNav` specifically — clicking a bottom-nav icon while the dropdown was open navigated correctly but left the dropdown floating on top of the next page, because the bottom nav (rendered later in `KaubanApp.tsx`, same `z-30`) visually sits on top of the dropdown's full-screen close-backdrop at that pixel, so the backdrop's own `onClick` never fires. Fixed by adding a `page` prop to `KaubanTopNav` and a `useEffect(() => setMenuOpen(false), [page])` — since `KaubanTopNav` is a single persistent instance across every screen (by design, from the previous milestone), closing on any `page` change handles every navigation source at once (bottom nav, dashboard tiles, Home/Back) instead of chasing z-index stacking order. Re-verified live afterward: opened the dropdown, clicked a bottom-nav icon, confirmed the dropdown closed and the correct page loaded.

**Live QA performed:** role selection → Deaf dashboard → Sign Language Tools hub → Text to Speech → Back (correctly returns to hub) → Home → role dropdown open/close → Emergency (bundled-content empty states render correctly, "Add Your Own Contact" form present) → Drawing Pad, at both a 900×700 desktop-ish size and a 375×812 mobile viewport. One Browser-pane tab became stuck mid-session (clicks timed out while screenshots/navigation kept working — a tooling issue, not an app regression; confirmed by reproducing the exact same click cleanly in a freshly opened tab). Not independently re-verified this pass since they were untouched and already confirmed working in earlier milestones: Quick Phrases, Sign Language Tutorial/Quiz, Speech-to-Sign-Language, Text-to-Speech's actual speech synthesis, Drawing Pad's pointer drawing, and a real touch device (all testing here was via the emulated mobile viewport, not a physical phone/tablet).

**Environment note, not a code defect:** this machine has no local `.env`/`.env.local` with real Supabase credentials — `src/lib/supabase.ts` throws at import time without them, which crashes every route (staff app, public CEDO site, and Kauban alike, since they share one Vite entry point), not something specific to this milestone's changes. A temporary `.env.local` with placeholder (non-functional) credentials was added to unblock structural QA — it's gitignored, never touched git, and is clearly commented as a placeholder; real Supabase-backed data (actual quick phrases, sign words, bundled emergency content) was therefore not exercised live this pass, only the empty/loading states. Documented in the new [README.md](README.md) under "Local development note" so this doesn't surprise a future session. Left in place rather than deleted, since removing it would just reproduce the crash for the next person who runs `npm run dev` here — swap in real values whenever real data-driven testing is needed.

**Docs handoff:** [README.md](README.md) — architecture summary, the Admin CMS's 4 tabs (Upload / Video Library / Quick Phrases / Emergency Content) and what each does, how a new sign word + video flows from upload to being live on all 3 places that read it (tutorial browse, quiz, speech-to-sign matching), the PWA caching strategy, and the local-dev Supabase-env requirement. Explicitly supersedes the original Laravel app's `SIGN_LANGUAGE_VIDEOS.md` (manual-copy-to-a-local-folder workflow), which no longer applies now that all content management goes through the Admin CMS.

**Build confirmed clean:** `npm run type-check`, `npx eslint src/kauban src/main.tsx`, and a full `npm run build` all pass — including after the dropdown-close fix found during QA, run a second time to confirm. Verified the 4 new PWA files land in `dist/` (`kauban-icons/*.png` ×4, `kauban-manifest.webmanifest`, `kauban-sw.js`).

**Not done, and deliberately left to you:** the actual `git push` / triggering a production Vercel deploy. Nothing in this milestone has been committed to git yet — it sits as uncommitted working-tree changes alongside the previous milestone's, awaiting your review, per this session's standing rule that pushing/deploying needs your explicit go-ahead.

**Files changed this pass:**
- New: `public/kauban-icons/{icon-192.png, icon-512.png, icon-512-maskable.png, apple-touch-icon.png}`, `public/kauban-manifest.webmanifest`, `public/kauban-sw.js`, `docs/kauban/README.md`
- Edited: `src/main.tsx` (conditional PWA head tags + SW registration), `src/kauban/components/KaubanTopNav.tsx` (dropdown-close fix), `src/kauban/KaubanApp.tsx` (passes `page` to `KaubanTopNav`), `docs/kauban/MILESTONES.md` (milestone 16 marked DONE)
- Local-only, gitignored, not part of the diff: `.env.local` (placeholder Supabase credentials, see the environment note above)
