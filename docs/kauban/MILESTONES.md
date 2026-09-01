# Kauban Integration — Milestone Plan

Target: `https://cedo-ten.vercel.app/kauban/`. Supabase-backed content (videos, words, phrases only — no user registration). Detailed narrative log per micro-task lives in [PROGRESS.md](PROGRESS.md); this file is the checklist. A milestone marked DONE is locked — it does not get redone unless a later milestone surfaces a real defect in it.

| # | Milestone | Status |
|---|---|---|
| 1 | Content & schema inventory — extract data shape from the Laravel app's migrations/seeders/JSON files and the FSL video filename map; design the target Supabase schema (6 tables, no user tables) | **DONE** |
| 2 | Admin content-management access design — reuse CEDO's existing staff tag-gating pattern (`kauban_content` tag) instead of a new auth system; scope the Sign Words / Quick Phrases / Emergency Content manager screens | **DONE** (design) |
| 3 | Video compression tooling design — a one-time batch script for the existing ~210MB of assets, plus a permanent client-side (`ffmpeg.wasm`) compression step in the admin video uploader | **DONE** (design) |
| 4 | Supabase schema migration — write and apply `supabase_migration_kauban_content_schema.sql` creating the 6 content tables | **DONE** — applied, confirmed by you |
| 5 | Storage bucket setup — create the `kauban-media` bucket; run the batch compressor over the existing 70 video files, then upload | **SQL written** (`supabase_migration_kauban_media_storage.sql`) — awaiting you to run it; the *existing* 70-file batch migration into it is still pending |
| 6 | Seed initial content — insert the existing 35 sign words, 22 quick phrases, and default emergency contacts/messages into the new tables | Not started |
| 7 | Admin CMS access wiring — add the `kauban_content` tag to `staffToolTags.ts`, the nav item in `Sidebar.tsx`, and the gated page case in `App.tsx` | **DONE** |
| 8 | Admin CMS: Sign Words manager — CRUD UI + dual video upload (clip + tutorial) with the in-browser compressor | **Video upload/compression built** — batch uploader done; a plain metadata-only edit/delete table view is still pending |
| 9 | Admin CMS: Quick Phrases manager — CRUD for categories and phrases | Not started |
| 10 | Admin CMS: Emergency Content manager — CRUD for bundled contacts and messages | Not started |
| 11 | Public route scaffolding — new `/kauban` section (no auth) + role-selection shell (Deaf/HoH/Non-deaf) persisted to `localStorage` | Not started |
| 12 | Public: Quick Phrases + Sign Language browse/tutorial + Sign Quiz screens, reading from Supabase | Not started |
| 13 | Public: Speech-to-Sign-Language screen — Web Speech API recognition matched against the Supabase word table, same muted-autoplay sequencing as the original | Not started |
| 14 | Public: Text-to-Speech, Speech-to-Text, Drawing Pad — pure client-side, no backend needed | Not started |
| 15 | Public: Emergency screen — bundled content from Supabase, personal contacts in `localStorage` | Not started |
| 16 | Deploy at `/kauban/`, full functional + mobile/accessibility QA, PWA baseline (manifest + service worker), docs handoff (supersedes the old `SIGN_LANGUAGE_VIDEOS.md` local-filesystem instructions) | Not started |

**Explicitly out of scope for this plan:** Laravel's `users`/`activity_logs`/`system_settings` tables, its full Admin sub-area (user management, activity logs, reports), and any account system for Kauban's public side — none of these exist in the new architecture. APK wrapping (Bubblewrap/TWA around the finished PWA) is the natural next phase after milestone 16, not part of it.
