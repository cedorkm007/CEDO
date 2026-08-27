================================================================================
ADMIN NAVIGATION — MAINTENANCE & FUTURE-UPDATE GUIDE
================================================================================
Written as part of Milestone 8 (Testing, Optimization & Handoff) of the
Admin UI Restructuring project. Audience: any developer (human or AI)
maintaining src/app/App.tsx, TopNav.tsx, or Sidebar.tsx after this project
hands off. Every fact below was verified directly against the actual code
at the time of writing, not assumed from an earlier round's notes — file
references and line numbers may drift over time; re-verify before trusting
them if this doc is more than a few rounds old.

================================================================================
1. THE THREE-PART SOURCE OF TRUTH — read this before changing any nav item
================================================================================
Every page in this admin app is gated/rendered by THREE independent things
that must all agree, or a page becomes reachable-but-unlisted (a stray nav
link with no matching render) or listed-but-unreachable (a render branch
nothing links to):

  1. The Page type (src/app/App.tsx, ~line 54) — the exhaustive list of
     valid page keys. Adding a new page starts here.

  2. isPageAuthorizedFor(page, user) (src/app/App.tsx, ~line 87) — the
     single function that decides whether a given user may be ON a given
     page at all (used to redirect back to "home" if a stale/unauthorized
     page value is restored, e.g. from a URL or saved state). THIS is the
     authoritative permission source of truth — nav visibility should
     always match what this function says, never diverge from it.

  3. The render switch inside App() (src/app/App.tsx, ~line 3400+, the
     `{page==="..." && <SomePage .../>}` block) — what actually renders
     for each page value. Each gated branch repeats its own condition
     inline (e.g. `{page==="admin" && currentUser.role==="super_admin" &&
     (...)}`) rather than trusting isPageAuthorizedFor alone as a render
     guard — this is intentional defense-in-depth, not redundancy to
     clean up.

Then TWO nav surfaces present these pages to the user, and must each match
#2 exactly:

  4. src/app/components/TopNav.tsx — the fixed top bar. Currently 3 items:
     Home, My Tasks, Notifications (badge), plus Profile/Sign-out. Deliberately
     ungated (any signed-in user sees all of these) — matches
     isPageAuthorizedFor's own `default: return true` for these pages.

  5. src/app/components/Sidebar.tsx (exports AppSidebar) — the persistent
     side nav, in three labeled regions:
       Region A "Common Tabs" — Profile, My Accomplishments, Forms
         (CTO/Pass Slip submenu). Ungated, matches isPageAuthorizedFor's
         `default: return true`.
       Region B "Division Head" — Monitoring, History (gated on
         user.isAdmin), Admin Management (gated on user.role ===
         "super_admin" specifically — one level stricter than the other
         two in this same region).
       Region C "Specific Tools" — Scholar Management Tools, SDP
         Monitoring, Scholars' Formation Tools, Forms Management (each
         gated on a distinct tag via user.tags.includes(...)), Staff
         Accounts (gated on user.username.toLowerCase() ===
         IT_ADMIN_USERNAME, a single hardcoded IT admin account, not a
         role or tag).

WHEN ADDING A NEW GATED PAGE: update all five of the above together, in
the same change. A gate that only exists in isPageAuthorizedFor but not in
the sidebar's own condition (or vice versa) is exactly the kind of
discrepancy this project's Milestone 8 permission-consistency check was
built to catch — see Section 4 below for how to re-run that check.

================================================================================
2. HOW THE SIDEBAR'S REGIONS WORK
================================================================================
AppSidebar (Sidebar.tsx) takes three props: `user`, `page`, `setPage`. It
renders three SidebarGroups (A/B/C as above) inside the shared shadcn
sidebar primitive (src/app/components/ui/sidebar.tsx — third-party-style
code, generally left unmodified; see Section 5 for the two accessibility
exceptions made this round).

Region B and Region C are each wrapped in their OWN gate at the region
level (`{user.isAdmin && (...)}` for B; a 5-way OR across all 5 possible
individual-item gates for C) — this means a user who qualifies for NONE of
a region's items sees no separator/empty box for that region at all,
rather than an empty gap. If you add a 6th item to Region C gated on some
NEW condition, you must add that condition to the region-level OR check
too, or a user who ONLY qualifies for the new item will see nothing.

Neither Region B nor Region C currently has a visible SidebarGroupLabel
(both were present at one point in this project's history and were
explicitly removed in the post-Milestone-7 revision round, per the
person's own request) — Region A also has none, by original design. If
you're tempted to re-add one, that's a deliberate reversal of a real
decision already made once, not an oversight.

================================================================================
3. HOW TO ADD A NEW DIVISION / DIVISION LOGO
================================================================================
Divisions are defined in the DIVISIONS config object in App.tsx (search for
`const DIVISIONS`). Each entry needs: code, shortName, fullName, logo
(an imported PNG), and accent (a hex color).

Division logos are ONLY ever rendered at a single fixed size across this
entire app: a 32×32px (`w-8 h-8`) circular badge in TopNav.tsx (confirmed
by grep across the whole src/ tree during Milestone 8 — no other usage
exists anywhere). When adding a new division logo image, there is no need
to supply a large/high-resolution source file — resize to roughly 256×256px
before adding it to src/imports/ (this gives comfortable headroom for
retina displays at this badge size without bloating the bundle). The
existing four division logos were all resized down to exactly this during
Milestone 8 after one of them (LITM_Logo_Circular.png) was found in the
build output at 4688×4688px / 947KB despite only ever being displayed at
32×32px — a ~96% size reduction with zero visible quality loss at its
actual display size. If a legitimate NEW use case for a division logo at a
larger size is ever added (e.g., a print/letterhead context), that new use
case should get its own appropriately-sized asset rather than assuming the
existing 256×256px badge asset is high-resolution enough for it.

================================================================================
4. HOW TO RE-VERIFY PERMISSION CONSISTENCY (no browser needed)
================================================================================
This exact check was run during Milestone 8 and found zero discrepancies
at that time — worth re-running any time a page/gate is added or changed,
since it's fast and needs no live app:

  # Extract isPageAuthorizedFor's own gating logic:
  grep -n "isPageAuthorizedFor" -A 15 src/app/App.tsx

  # Extract every render-switch condition:
  grep -n 'page===' src/app/App.tsx | grep -v "isActive\|aria-current"

  # Extract every permission check actually used in the two nav surfaces:
  grep -n "user\.\(isAdmin\|role\|tags\|username\)" src/app/components/Sidebar.tsx
  grep -n "user\.\(isAdmin\|role\|tags\|username\)" src/app/components/TopNav.tsx

Compare the three outputs by eye for every gated page — they should tell
the exact same story for each one.

================================================================================
5. ACCESSIBILITY NOTES FOR FUTURE CHANGES
================================================================================
- TopNav.tsx's three custom buttons (Home/Tasks nav items, the profile
  button, sign-out) each carry an explicit `aria-label` and explicit
  `focus-visible` ring styling, added during Milestone 8 — the dark header
  background meant the browser's default focus outline was a real
  contrast risk, and truncated/hidden text labels below the `sm` breakpoint
  needed an aria-label fallback for the accessible name to survive at
  small viewports. If you add a FOURTH custom button to TopNav, match this
  same pattern (aria-label + focus-visible ring), don't assume the
  SidebarTrigger's own built-in accessible name (it already has one, from
  the shadcn primitive) extends to anything else in the header.
- The shared Sidebar primitive (ui/sidebar.tsx) had `role="navigation"`
  and `aria-label="Main navigation"` added to its two plain-<div>-based
  render branches during Milestone 8 (the desktop persistent sidebar, and
  the unused-by-this-app `collapsible="none"` variant) — confirmed via
  grep that this primitive has exactly 3 importers, all part of this same
  admin-nav work, so this was a safe, contained change. The MOBILE
  drawer branch was deliberately left alone — it's built on
  @radix-ui/react-dialog (via the Sheet component), which already
  provides its own `role="dialog"` + focus-trapping + Escape-to-close
  automatically; adding `role="navigation"` there would double up two
  landmark roles on one element, which is worse, not better, for screen
  readers.
- The active-nav-item color combination (`bg-sky-100` / `text-sky-900`,
  used consistently across every SidebarMenuButton) has a measured WCAG
  contrast ratio of 8.24:1 — passes AAA (7:1), not just AA (4.5:1).
  Computed directly from Tailwind's real default palette hex values
  (confirmed no custom override exists in src/styles/theme.css) using the
  standard WCAG relative-luminance formula — this is a legitimate,
  reproducible calculation, not a visual guess. If either color is ever
  changed, recompute rather than assume it still passes.

================================================================================
6. KNOWN, HONEST LIMITATIONS OF THIS PROJECT'S OWN VERIFICATION
================================================================================
Every round of this entire project, including Milestone 8, was done in a
sandbox with NO real browser, NO device lab, and NO live deployment
access, and — for most rounds — no working `npm install`/`npm run build`
either (no outbound network access). This means:

- Nothing in this project has ever been visually confirmed to actually
  render correctly in a real browser. Every check has been static: TypeScript
  compilation (via a hand-assembled tsc invocation, since a real build
  wasn't available most rounds), brace/paren balance, grep-based
  cross-referencing, and — where the underlying math is genuinely
  browser-independent, like WCAG contrast ratios — direct computation.
- Cross-browser testing (Chrome/Firefox/Safari/Edge), real responsive
  testing on real device sizes, real screen-reader testing (NVDA/JAWS/
  VoiceOver), and real keyboard-only navigation testing have NOT been
  performed by any round of this project. What HAS been done, wherever
  the underlying library/pattern allows real confidence without a
  browser: confirming Radix Dialog (a mature, dedicated accessibility
  library) actually underlies the mobile drawer rather than a custom
  implementation; confirming ARIA attributes and semantic HTML elements
  are present in the source; computing exact contrast ratios.
- A real `npm run build` should be run, by a human with real tooling
  access, before this admin nav restructuring is considered fully done —
  this has been flagged in every round's own handoff and remains true
  here.

================================================================================
7. WHERE TO ADD A NEW PAGE — QUICK CHECKLIST
================================================================================
  [ ] Add the new key to the Page type union (App.tsx ~line 54)
  [ ] Add a case to isPageAuthorizedFor if it needs gating (App.tsx ~line 87)
      — pages needing no special permission don't need a case; they fall
      through to the `default: return true` branch
  [ ] Add the render branch to the page switch inside App() (~line 3400+),
      repeating the same gate condition inline (defense-in-depth, see
      Section 1)
  [ ] Add a nav entry to EITHER TopNav.tsx (if it should always be visible
      to any signed-in user) OR the correct Sidebar.tsx region (A if
      ungated, B if isAdmin/role-based, C if tag/username-based) — using
      the exact same gate condition as isPageAuthorizedFor's own case
  [ ] Re-run the Section 4 grep-based consistency check
  [ ] Run a real `npm run build` if you have the tooling access this
      project's own sandbox rounds mostly didn't
================================================================================
