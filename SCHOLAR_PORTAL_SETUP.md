# Scholar Portal — Setup Guide (Phase 1 + Phase 2)

Adds the public CEDO site + full Scholar Portal dashboard at `/CEDO`
on the SAME Vercel deployment and Supabase project as the existing
staff/admin app. The staff app at `/` is untouched.

## 1. Copy these files into your repo
Paths match your repo exactly:
```
supabase_migration_scholar_portal.sql   (new, root — RE-RUN if you already ran an older version)
vercel.json                             (new, root)
scripts/                                (new: create-scholar-accounts.mjs, import-scholars-from-csv.mjs, reset-scholar-password.mjs)
src/main.tsx                            (REPLACES the existing one)
src/scholar/                            (new folder)
src/imports/scholar/                    (new folder)
```

If you already applied an earlier version of `supabase_migration_scholar_portal.sql`,
re-run the new copy — it adds one new function
(`update_own_scholar_contact`) and is safe to re-run in full.

## 2. Run the database migration
Supabase → SQL Editor → paste `supabase_migration_scholar_portal.sql` → Run.

## 3. Create scholar accounts
See the CSV import instructions from before —
`node scripts/import-scholars-from-csv.mjs path/to/scholars.csv`.

## 4. Deploy
Push to GitHub, Vercel redeploys. Staff app at `/`, scholar portal at `/CEDO`.

---

## What's built now (Phase 1 + Phase 2)

**Public site:** CEDO home page, Articles/Programs/Statistics placeholders,
Scholar Log In dropdown, Scholar Login screen, staff-mediated password
reset.

**Scholar Portal (after login)** — a full dashboard modeled on your
`City_Scholarship_Office_Scholar_profile.zip` reference:
- **Profile banner** — avatar, name, Scholar ID, Change Password button
- **Widget-launcher home** — 6 sections: Profile, Subjects & Grades,
  Services, SDP, Calendar, Quests — with a compact pill nav once you're
  inside a section
- **Profile panel** — status badge (Active/Probation/Inactive/Graduated),
  a probation banner if applicable, an info grid of the scholar's real
  data, and an **editable Civil Status / Contact Number form** that
  scholars can update themselves (new — see below)
- **Subjects & Grades panel** — real data from `scholar_subjects_grades`,
  grouped into collapsible School Year / Semester sections
- **Quests panel** — real score history from `scholar_quest_scores`, plus
  a subject grid marked "Under Development" for quests not built yet
  (actual quiz-taking is a separate future feature — no spec for it yet)
- **Services panel** — the 6 service buttons from your reference
  (Renewal, Consultation, Guarantee Letter, Certification, ATM
  Application, ATM Concerns) — each currently shows an "under
  development" note, ready to wire up once `scholar_services` is designed
- **SDP and Calendar panels** — "Under Development" placeholders. Calendar
  specifically: your reference site has a fully interactive one, but it
  needs a real events data source (there's no `scholar_calendar_events`
  table yet) — say the word if you want that built as Phase 3
- **Change Password modal** — scholar re-verifies their current password,
  then sets a new one, fully functional

### New: self-service profile editing
The reference mockup's "Editable Information" section (Civil Status +
Contact Number) is wired up for real. This required one addition to the
database: a narrowly-scoped `update_own_scholar_contact` function that
lets a scholar update ONLY those two fields on their own row — everything
else (name, Scholar ID, school, status, etc.) stays staff-only, same as
before.

## Notes / what's intentionally left out
- **Email field removed from the profile display** — since scholar emails
  are synthetic/internal-only (see earlier CSV import discussion), it's
  no longer shown anywhere in the portal UI.
- **QR code / My CSR download** — present in your reference mockup but
  tied to systems (CSR generation, QR-based ID) not in your original spec.
  Skipped for now; straightforward to add later if wanted.
- **Quest-taking mechanic** (timed quiz, question bank, scoring) — the
  reference site has this fully built for one subject; there's no spec or
  data model for it yet here. The panel is ready to plug into once that's
  defined.
