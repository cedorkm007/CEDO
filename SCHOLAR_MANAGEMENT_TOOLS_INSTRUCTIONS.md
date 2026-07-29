# Scholar Management Tools — Setup Instructions (Integrated Version)

This replaces the earlier "separate `/sead` module" approach. Scholar
Management Tools is now a page **inside your existing staff app** — a new
nav item between **My Tasks** and **Notifications** — visible and usable
only by the account with username `sead.sma1`. Everyone else's view is
completely unchanged.

## What's included
```
src/app/App.tsx                    REPLACES your existing one — same file,
                                    with 5 small additions (see "What changed" below)
src/main.tsx                       REPLACES existing — back to 2 routes (/ and /CEDO)
src/sead/                          new folder — the tools themselves (reused
                                    as-is from the earlier package, minus the
                                    standalone login/module files, which are removed)
supabase_migration_sead_staff.sql  same schema as before — question bank
                                    tables + the is_sead_staff flag
supabase/functions/                same 2 Edge Functions as before, unchanged
```

---

## Step 1 — Copy files in

Unzip into your project root, overwriting when prompted. If you already
have your own changes in `src/app/App.tsx` since the last time I gave you
a copy of it, **don't blindly overwrite it** — see "What changed in
App.tsx" below and apply those 5 edits by hand instead so you don't lose
your own changes.

## Step 2 — Run the SQL migration

Same as before — Supabase → SQL Editor → run `supabase_migration_sead_staff.sql`
(after `supabase_migration_scholar_portal.sql`, if not already run). Safe
to re-run.

## Step 3 — Create the `sead.sma1` account and authorize it

You said you'll set this up yourself — here's exactly what that involves:

1. Go to your staff app's **Register** page (the same self-registration
   flow every staff member already uses) and create an account with
   username `sead.sma1` (this can belong to a real SEAD staff member —
   pick whatever real name/email/division ("SEAD") makes sense for your
   office; only the **username** has to be exactly `sead.sma1`).
2. In Supabase → SQL Editor, run:
   ```sql
   update public.users set is_sead_staff = true where username = 'sead.sma1';
   ```
   **This step matters even though the UI already hides the nav item for
   everyone else** — the flag is what actually blocks database writes at
   the RLS level. Without it, the account could see the "Scholar
   Management Tools" tab (since only it has that username) but every
   save would silently fail.

That's it — no separate login, no new URL. That person logs into your
normal staff app exactly as before, and now sees an extra nav item.

## Step 4 — Deploy the Edge Functions (if you haven't already)

Only needed once, and only if you skipped this in the earlier round:

```powershell
npm install -g supabase
supabase login
supabase link --project-ref your-project-ref
supabase functions deploy sead-create-scholar-account
supabase functions deploy sead-reset-scholar-password
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

These power "Add Scholar" and "Reset Password" in the Scholars tab — both
need Supabase admin-level access, which can't live in browser code, so it
runs here instead. If you already deployed these from the earlier
package, nothing to do — they work identically now, unchanged.

## Step 5 — Deploy the frontend

```powershell
git add .
git commit -m "Add Scholar Management Tools to staff app (sead.sma1 only)"
git push
```

---

## What changed in `App.tsx` (apply by hand if you have your own edits)

1. **Page type** — added `"scholarManagement"` to the union type.
2. **New constant** — `const SCHOLAR_MANAGEMENT_USERNAME = "sead.sma1";`
   right after the `Page` type.
3. **Icon import** — added `GraduationCap` to the existing `lucide-react`
   import list.
4. **Nav item** — in `TopNav`, the `primaryItems` array now conditionally
   inserts `{ key:"scholarManagement", label:"Scholar Management Tools", icon:<GraduationCap size={14}/> }`
   between "My Tasks" and "Notifications", only when
   `user.username.toLowerCase() === SCHOLAR_MANAGEMENT_USERNAME`.
5. **Page render** — one new block near the other `{page===... && ...}`
   lines:
   ```tsx
   {page==="scholarManagement" && currentUser.username.toLowerCase()===SCHOLAR_MANAGEMENT_USERNAME && (
     <ScholarManagementToolsPage/>
   )}
   ```
   plus the import at the top:
   ```tsx
   import { ScholarManagementToolsPage } from "@/sead/ScholarManagementToolsPage";
   ```

Everything else in your `App.tsx` is untouched.

## What's inside Scholar Management Tools
Same three tabs as before, just reached differently:
- **Scholars** — search, add a scholar (starts on password `123456`),
  one-click password reset (also to `123456`)
- **Question Bank** — Subjects → Topics → Questions, multiple choice,
  2–6 options, one correct answer, point value. Choice order isn't
  stored — the future scholar-facing quiz shuffles it per viewer.
- **Scores & Progress** — filter by subject, topic, scholar, date range

## Still not built (unchanged from before)
- The scholar-facing quiz-taking screen itself
- Forced password change after the `123456` default
