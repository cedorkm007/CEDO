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

**Build confirmed clean (2026-09-01):** `npm run type-check`, `npx eslint src/kauban`, and a full `npm run build` all pass. Along the way, found and fixed a pre-existing broken install unrelated to Kauban (`@tailwindcss/oxide` was missing its Windows native binding — a known npm optional-dependency bug) by installing `@tailwindcss/oxide-win32-x64-msvc` with `--no-save`, so it didn't pollute the lockfile.

Also caught before committing: the vendored `ffmpeg-core.wasm` (~32MB) would have permanently bloated the git repo for no reason, since it's 100% derived from the `@ffmpeg/core` npm package already in `node_modules`. Fixed by adding [`scripts/copy-ffmpeg-core.mjs`](../../scripts/copy-ffmpeg-core.mjs) as a `postinstall` step that regenerates `public/kauban-admin/ffmpeg-core/` on every `npm install`, and gitignoring that folder instead of committing it.

**Files changed this pass:**
- New: `supabase_migration_kauban_media_storage.sql`, `src/kauban/admin/{kaubanAdminApi.ts, videoCompression.ts, BatchVideoUpload.tsx, KaubanContentManagementPage.tsx}`, `scripts/copy-ffmpeg-core.mjs`, `public/kauban-admin/README.md`
- Edited: `src/app/App.tsx`, `src/app/components/Sidebar.tsx`, `src/app/staffToolTags.ts`, `package.json`, `package-lock.json`, `.gitignore`
- Nothing has been committed to git yet — all of the above sits as uncommitted working-tree changes, awaiting your review.
