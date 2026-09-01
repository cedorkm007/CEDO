# Kauban — Overview & Content Management Guide

Kauban is a sign-language/speech accessibility tool for deaf and hard-of-hearing
users, served at `/kauban` from the same Vite build/Vercel deployment as the
rest of this repo. It's a from-scratch React port of a standalone Laravel app
(`Kauban App.zip`, reference-only — no PHP ships); see
[PROGRESS.md](PROGRESS.md) for the full milestone-by-milestone build log and
[MILESTONES.md](MILESTONES.md) for the checklist.

This doc **supersedes the original Laravel app's `SIGN_LANGUAGE_VIDEOS.md`**,
which described manually copying video files into a folder on one person's
local machine (`storage/app/public/fsl/...`). That workflow no longer exists —
all content, including videos, is now managed through the Admin CMS below and
lives in Supabase.

## Architecture, in one paragraph

Kauban has **no user accounts**. A visitor's role choice (Deaf / Hard of
Hearing / Hearing) and personal emergency contacts live only in that device's
`localStorage` (see `src/kauban/localRole.ts` and
`src/kauban/localEmergencyContacts.ts`) — nothing about a visitor is ever sent
to Supabase. Everything else — sign words + their video clips, quick phrases,
and bundled emergency contacts/messages — is staff-authored content read from
6 `kauban_*` Supabase tables via `src/kauban/kaubanPublicApi.ts` (read-only,
anon key). Staff edit that same content through the Admin CMS, which uses the
separate `src/kauban/admin/kaubanAdminApi.ts` (write-capable) so the public
bundle never pulls in write/upload code.

## Managing content (for staff)

Any staff account with the **"Kauban Content Management"** tag
(`kauban_content` in `src/app/staffToolTags.ts`) sees a **Kauban** item in the
sidebar, leading to four tabs:

| Tab | What it's for |
|---|---|
| **Upload** | Batch-upload sign-word video clips. Each video is compressed client-side (`ffmpeg.wasm`, see `src/kauban/admin/videoCompression.ts`) before it reaches Supabase Storage — no separate build step or server-side job needed. |
| **Video Library** | Browse everything already uploaded, grouped by category/type (clip vs. tutorial). Delete individual videos or whole words from here. |
| **Quick Phrases** | CRUD for the phrase categories and the phrases within them (the tiles on the public Quick Phrases screen). |
| **Emergency Content** | CRUD for the *bundled* emergency contacts and messages — i.e. the ones every visitor sees. A visitor's own personal contacts (added from the public Emergency screen) are device-local and staff never see or manage them. |

There is no separate "publish" step — edits in the CMS write straight to
Supabase and are live on `/kauban` immediately (subject to normal browser
caching; see PWA caching below for video assets specifically).

### Adding a new sign word + video

1. Admin CMS → **Upload** tab → pick a category, enter the word's label/phrase
   text, attach the clip (and optionally a longer tutorial clip).
2. The uploader compresses and uploads to the `kauban-media` Storage bucket,
   then inserts a row into `kauban_sign_words`.
3. It's immediately available to: the Sign Language Tutorial browse screen,
   the Sign Quiz, and Speech-to-Sign-Language phrase matching (`src/kauban/
   signWordMatching.ts` matches recognized speech against the `phrase` column,
   longest match first).

### Schema reference

See the "Proposed Supabase schema" table in [PROGRESS.md, Milestone
1](PROGRESS.md) for the 6-table layout, and
`supabase_migration_kauban_content_schema.sql` at the repo root for the
applied DDL.

## PWA baseline (Milestone 16)

Kauban is installable and has minimal offline support, scoped to `/kauban`
only — the staff app and public CEDO site (same Vite build, same deployment)
are unaffected:

- **Manifest**: `public/kauban-manifest.webmanifest`, linked only when
  `isKaubanSite` is true (`src/main.tsx`) — not in the shared `index.html`.
- **Icons**: `public/kauban-icons/` — `icon-192.png`, `icon-512.png`,
  `icon-512-maskable.png` (Android/manifest), `apple-touch-icon.png` (iOS
  "Add to Home Screen", 180×180, no rounding — iOS applies its own mask).
- **Service worker**: `public/kauban-sw.js`, registered with
  `scope: "/kauban"` — also only when `isKaubanSite`. Strategy:
  - Sign/tutorial video clips (matched by the Supabase Storage
    `kauban-media` bucket path) — **cache-on-first-play**: served from
    network once, then from cache on every later visit, so a word or phrase
    someone has already watched keeps working offline or on flaky data.
  - Full-page navigations to `/kauban*` — network-first, falling back to the
    cached shell when offline, so a fresh deploy is picked up immediately
    when online.
  - Hashed build assets (`/assets/*`, `/kauban-icons/*`) — cache-first
    (safe: filenames are content-hashed and immutable).
  - Everything else (notably all `kauban_*` table reads) — always
    network, never cached, since staff-edited content going stale would be
    actively harmful.
  - Bump `CACHE_VERSION` at the top of `kauban-sw.js` to invalidate old
    caches on a future deploy.

To test PWA behavior locally: `npm run build && npm run preview`, then visit
`/kauban` (dev mode's `vite dev` also registers the service worker, but
without a production build the "install" prompt browsers show may differ).

## Local development note

`src/lib/supabase.ts` throws at import time if `VITE_SUPABASE_URL` /
`VITE_SUPABASE_ANON_KEY` aren't set (see `env.example` at the repo root) —
this crashes **every** route (staff app, public CEDO site, and Kauban alike),
not just Kauban, since they share one Vite entry point. Copy `env.example` to
`.env.local` with real project credentials to run any part of this app
locally.
