# Scholar Portal — Setup Guide

This adds the public CEDO site + Scholar Portal at `/scholars` on the SAME
Vercel deployment and Supabase project as the existing staff/admin app.
The staff app at `/` is untouched.

## 1. Copy these files into your repo
Unzip this package into the root of your existing project (paths match
exactly, so files land in the right place):

```
supabase_migration_scholar_portal.sql   (new, root)
vercel.json                             (new, root)
scripts/create-scholar-accounts.mjs     (new)
src/main.tsx                            (REPLACES the existing one)
src/scholar/                            (new folder — pages, components, api)
src/imports/scholar/                    (new folder — logos, hero photo)
```

## 2. Run the database migration
In Supabase → SQL Editor → New query, paste and run
`supabase_migration_scholar_portal.sql`. It creates:
- `scholars` (profile), `scholar_subjects_grades`, `scholar_quest_scores`,
  `scholar_sdp` (placeholder), `scholar_services` (placeholder)
- Row Level Security so staff see everything, scholars see only their own row
- A `resolve_scholar_login_email` RPC that the login screen uses to look up
  a scholar's email from their name+birthday or Scholar ID number

## 3. Create scholar accounts (staff-provisioned, no self-registration)
Scholars log in with **Scholar ID + password** or **name + birthday +
password** — never an email. Each account still needs an email internally
(Supabase Auth requires one), so these scripts auto-generate a synthetic
one like `20180000@scholars.cedo.local` that's never shown or used.

1. Make sure `.env.scripts` has `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
   (service role — never put this in `.env.local` / VITE_ vars).

**Bulk import from your CSV** (Scholar ID Number, First Name, Last Name,
Middle Name, Birthday, Address — headers are matched loosely, order doesn't
matter):
```
node scripts/import-scholars-from-csv.mjs path/to/scholars.csv
```
This writes `scholar-credentials-<timestamp>.csv` next to your input file
with each scholar's ID + generated password — the only copy. Distribute
securely (hand-deliver / encrypted drive), then delete the file.

**One-off / manual entries** — edit `SCHOLAR_ACCOUNTS` in
`scripts/create-scholar-accounts.mjs` and run it the same way.

**Resetting a scholar's password later** — since there's no real email to
send a reset link to, it's staff-run:
```
node scripts/reset-scholar-password.mjs 20180000
```

## 4. Deploy
Push to GitHub as usual — Vercel will redeploy automatically. Once live:
- Staff/admin app: `https://yourapp.vercel.app/`
- Scholar portal:  `https://yourapp.vercel.app/scholars`

`vercel.json` adds the rewrite Vercel needs so refreshing `/scholars` (or
any sub-page) doesn't 404 — this didn't exist before because the app only
ever had one route.

## What's built (Phase 1)
- CEDO home page matching your mockup (nav, hero, "About Us")
- Home / Articles / Programs / Statistics → "Under Development" pages
- Scholar Log In dropdown (Existing Scholar / New Applicant — College /
  New Applicant — Law and Medical)
- Scholar Login page — matches your design exactly: name+birthday OR
  Scholar ID + password, Remember Me, Reset Password link
- Reset Password flow
- Scholar Portal shell after login: reuses the same top nav, shows the
  scholar's real profile pulled from Supabase, plus Subjects & Grades and
  Quest Scores sections wired to live data. SDP and Services are marked as
  placeholders (tables exist, UI is "coming soon"), matching what you said
  is still under development.

## What's next (Phase 2)
Your `City_Scholarship_Office_Scholar_profile.zip` mockup (probation
banner, detailed info grid, etc.) is a great reference for the fuller
dashboard — happy to convert that into the React portal on top of this
foundation whenever you're ready.

## Notes / assumptions made
- Scholars are provisioned by staff (via the script above), not
  self-registered — matches "accounts of the scholars are made [by] the
  staff of the office."
- Birthday is stored on `scholars` even though it wasn't in your original
  field list, because the login screen needs it as an alternative to
  Scholar ID.
- Scholars can currently only *view* their own data (grades/scores/profile
  are read-only for them) — staff enters everything. Say the word if you
  want scholars to be able to edit specific fields themselves (e.g. contact
  number, address) and I'll add that.
