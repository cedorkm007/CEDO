import { useState } from "react";
import { User, CheckSquare, Award, FileText, ChevronDown, Users, ClipboardCheck, Lock, GraduationCap, Lightbulb, Users2, Video, BarChart3 } from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarHeader, SidebarSeparator,
  SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarMenuSub, SidebarMenuSubItem, SidebarMenuSubButton,
} from "./ui/sidebar";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "./ui/collapsible";
import { DIVISIONS, FORM_TYPES, IT_ADMIN_USERNAME, type Page, type UserProfile } from "@/app/App";

/**
 * Admin UI Restructuring, Milestone 3: the left sidebar's structural
 * shell — three visually-separated regions that Milestones 4-6 will
 * populate with the actual relocated nav items (Common Tabs, Division
 * Head, Specific Tools).
 *
 * IMPORTANT DESIGN NOTE, worth reading before wiring this in: this does
 * NOT hand-roll open/close state, mobile drawer behavior, or the
 * hamburger-coordination scheme the Milestone 3 handoff asked about —
 * src/app/components/ui/sidebar.tsx already contains a complete,
 * previously-installed-but-unused shadcn sidebar primitive (SidebarProvider,
 * Sidebar, SidebarTrigger, useSidebar, etc.) that already solves exactly
 * that problem: SidebarProvider's context tracks open/openMobile/isMobile
 * and exposes toggleSidebar(); the base Sidebar component already renders
 * as a permanent md:flex column on desktop and as a slide-in Sheet-based
 * drawer (with its own close affordance) below md — matching this app's
 * own existing mobile breakpoint convention (768px / Tailwind `md`,
 * confirmed against BottomNav.tsx/ScholarPortalPage.tsx's own `md:` usage,
 * NOT `lg` as this milestone's draft notes suggested). All sidebar-*
 * theme colors are already defined in src/styles/theme.css (light + dark),
 * so no new CSS was needed either.
 *
 * Practical effect: AppSidebar takes NO isOpen/onClose props at all —
 * that state lives entirely in SidebarProvider's context instead, which
 * resolves the handoff's open "Context vs. props" question in favor of
 * context, because a real, tested implementation of exactly that pattern
 * was already sitting in the repo unused. This is a smaller, safer
 * component than what the original milestone draft anticipated building
 * from scratch.
 *
 * WIRING DEPENDENCY for whichever future milestone connects this live
 * (Milestones 2+3 wiring point): both <AppSidebar /> and the new
 * <TopNav /> (which now renders <SidebarTrigger /> — see that file) MUST
 * be rendered somewhere inside a single shared <SidebarProvider> in
 * App.tsx, or TopNav's hamburger button will throw at runtime
 * ("useSidebar must be used within a SidebarProvider").
 *
 * Milestone 4 addition: AppSidebar now takes `user`, `page`, `setPage`
 * (this is the key architectural change from M3's pure-shell version)
 * and Region A ("Common Tabs") is populated: Profile, My Tasks, My
 * Accomplishments, and a Forms group. These four are deliberately
 * ungated — confirmed against the old inline TopNav in App.tsx that
 * `primaryItems`/`menuItems` never gate "tasks", "profile",
 * "accomplishments", or the Forms dropdown behind any tag/role check
 * (only Monitoring/History/Admin Management are role-gated, and those
 * belong to Region B, "Division Head" — Milestone 5, not this one).
 *
 * Milestone 5 addition: Region B ("Division Head") is populated —
 * Monitoring, History, and Admin Management, matching the old inline
 * TopNav's `menuItems` gating exactly (re-verified directly against
 * App.tsx, not assumed from the Milestone 4 handoff's own description):
 * Monitoring and History are gated on `user.isAdmin`
 * (division_admin OR super_admin); Admin Management is gated on
 * `user.role === "super_admin"` specifically, one level stricter. Per
 * Milestone 4's own explicit decision (option (c): hold off wiring
 * until BOTH Milestone 5 AND 6 are done), this region is built and
 * verified but still NOT wired in — Region C ("Specific Tools") is now
 * also built (Milestone 6, see below), satisfying both conditions; an
 * explicit go-ahead from the person is still needed before writing any
 * wiring code, per this project's own standing practice.
 *
 * IMPORTANT CORRECTION vs. the plan this milestone was handed: that
 * note's Section 5 described the Forms submenu as a single
 * "CTO/Pass Slip" entry. The actual old TopNav (verified directly, not
 * assumed) has TWO separate Forms dropdown entries — "CTO Application"
 * and "Pass Slip" (App.tsx's own FORM_TYPES constant, now exported so
 * this file can reuse the same list instead of a second hand-copied
 * one) — both of which currently navigate to the same "forms" page (the
 * Forms page itself doesn't yet distinguish which was clicked; that's
 * pre-existing behavior, not something this milestone changed). Built to
 * match the real two-item structure, not the note's shorthand, per this
 * project's own standing practice of verifying against actual code
 * before building.
 *
 * The Forms group's expand/collapse uses the existing (already installed,
 * already unused-until-now) Collapsible/CollapsibleTrigger/
 * CollapsibleContent wrapper at src/app/components/ui/collapsible.tsx —
 * same reasoning as reusing the sidebar primitive itself in Milestone 3:
 * a working, tested implementation of exactly this was already sitting in
 * the repo unused, so no hand-rolled open-state toggle was written.
 *
 * Milestone 6 addition: Region C ("Specific Tools") is populated — the
 * 5 items previously living in the old inline TopNav's `primaryItems`
 * beyond Home/My Tasks/Notifications (those three relocated elsewhere —
 * My Tasks into Region A, Home/Notifications into the new TopNav.tsx).
 * Re-derived directly from BOTH primaryItems AND App.tsx's own
 * `isPageAuthorizedFor` switch (the single source of truth the codebase
 * already uses to re-validate a page restored from a URL) rather than
 * trusting either the Milestone 5 handoff's shorthand ("4 tag-gated
 * tools + IT admin's Staff Accounts page") or assuming a round number —
 * both sources agree exactly: 4 tag-gated tools (Scholar Management
 * Tools/scholar_management, SDP Monitoring/sdp_monitoring, Scholars'
 * Formation Tools/scholars_formation, Forms Management/forms_management)
 * plus one differently-gated 5th (Staff Accounts, gated on
 * `user.username.toLowerCase() === IT_ADMIN_USERNAME`, a hardcoded
 * account check, not a tag) — 5 total, matching TopNav.tsx's own
 * Milestone 2 comment ("all 5 Specific Tools") exactly. IT_ADMIN_USERNAME
 * needed a new export from App.tsx (unlike DIVISIONS/FORM_TYPES, which
 * were already exported when Milestones 4/5 checked) — that's the one
 * other change this milestone made outside this file.
 *
 * Same "gate the whole region, separator included" pattern as Region B,
 * for the same reason (no empty boxed gap for a user with none of these
 * 5), computed once as `hasAnySpecificTool` rather than inlined at the
 * render site — Region B's own gate is a single existing field
 * (`user.isAdmin`), but this region's is a 5-way OR across raw tag
 * checks plus a username comparison, long and repetitive enough that a
 * named variable reads more clearly than inlining it, and avoids
 * evaluating the same checks twice (once for the outer gate, again for
 * defensive clarity) if this render function ever gets reused elsewhere.
 * Each of the 5 items is then independently gated inside that outer
 * check too, exactly like Admin Management inside Region B's own
 * `user.isAdmin` gate — a user can have any subset of these 5 tags, not
 * all-or-nothing.
 *
 * Post-Milestone-7 browser-review revisions (Revisions 1, 2, 6): "My
 * Tasks" is now ALSO in the top nav (TopNav.tsx) — kept here too, per
 * the review note's own stated default of keeping both rather than
 * moving it. Every SidebarMenuItem/SidebarMenuSubItem now has
 * `min-w-0`, and every label is now wrapped in `<span className=
 * "truncate">` — this was the actual root cause of the horizontal
 * scrollbar: SidebarMenuButton's own CSS already had a
 * `[&>span:last-child]:truncate` rule, but it was completely inert
 * because no label here was ever wrapped in a span, so a long label
 * like "Scholars' Formation Tools" could force the whole sidebar wider
 * than its container instead of truncating. Fixed at the source (the
 * labels), not by hiding overflow with CSS. Every SidebarMenuButton/
 * SidebarMenuSubButton also now carries an explicit
 * `data-[active=true]:bg-sky-100 data-[active=true]:text-sky-900`
 * className, overriding the primitive's much subtler default
 * `data-[active=true]:bg-sidebar-accent` for a clearly visible
 * light-blue active state (confirmed this override actually works,
 * not just assumed: src/app/components/ui/utils.ts's `cn()` uses
 * `tailwind-merge`, which correctly resolves the conflict in favor of
 * whichever same-property utility class is passed later — the
 * primitive's own `cn(sidebarMenuButtonVariants(...), className)`
 * already passes the consumer's className last).
 */
export function AppSidebar({ user, page, setPage }: { user: UserProfile; page: Page; setPage: (page: Page) => void }) {
  const [formsOpen, setFormsOpen] = useState(page === "forms");

  // See the top doc comment's "Milestone 6 addition" paragraph for why
  // this is a named variable rather than inlined at the render site.
  const hasAnySpecificTool =
    user.tags.includes("scholar_management")
    || user.tags.includes("sdp_monitoring")
    || user.tags.includes("scholars_formation")
    || user.tags.includes("forms_management")
    || user.tags.includes("kauban_content")
    || user.tags.includes("scholarship_program_info")
    || user.username.toLowerCase() === IT_ADMIN_USERNAME;

  return (
    // top-14 + an explicit height (rather than the primitive's own default
    // inset-y-0, which spans the full viewport from y=0) pushes the
    // sidebar's own content below TopNav's fixed h-14 header instead of
    // being visually covered by it. A prior round's notes described this
    // as already resolved via z-index alone (sidebar z-50 "above" TopNav
    // z-40) — checked directly against both files (TopNav.tsx is z-40,
    // the sidebar primitive's own default is z-10, no z-50 override
    // exists anywhere) and that wasn't actually true; z-index ordering
    // alone doesn't fix this regardless, since the header would still
    // physically overlap/hide the sidebar's own top region rather than
    // the two occupying separate vertical bands. Fixed here via
    // positioning instead — once top/height keep them from overlapping at
    // all, which one has the higher z-index stops mattering for normal
    // rendering, so no z-index override was added on top of this.
    <Sidebar className="top-14 h-[calc(100svh-3.5rem)]">
      <SidebarHeader />
      {/* overflow-x-hidden! forces the fix, rather than relying on
          cn()/tailwind-merge to dedupe against SidebarContent's own base
          `overflow-auto` (which sets both axes) — that dedupe behavior
          isn't guaranteed for this specific class combination, so the
          Tailwind v4 important modifier (trailing !) is used to remove
          any ambiguity. This is the actual root-cause fix for the
          scrollbar still appearing after the earlier min-w-0/truncate
          round: those fixes stopped labels from being the thing that
          overflowed, but SidebarContent's own overflow-auto still shows
          an x-scrollbar for ANY residual sub-pixel horizontal overflow
          (icon sizing, borders, etc.), not just from long unwrapped text.
          overflow-y-auto is preserved (not touched), so vertical
          scrolling still works when there are more items than fit. */}
      <SidebarContent className="overflow-x-hidden!">
        {/* Region A — "Common Tabs" (Milestone 4). No visible label per
            the spec (visual separation only) — a plain styled box for now. */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem className="min-w-0">
                <SidebarMenuButton isActive={page === "profile"} onClick={() => setPage("profile")} className="data-[active=true]:bg-sky-100 data-[active=true]:text-sky-900">
                  <User /> <span className="truncate">Profile</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem className="min-w-0">
                <SidebarMenuButton isActive={page === "tasks"} onClick={() => setPage("tasks")} className="data-[active=true]:bg-sky-100 data-[active=true]:text-sky-900">
                  <CheckSquare /> <span className="truncate">My Tasks</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem className="min-w-0">
                <SidebarMenuButton isActive={page === "accomplishments"} onClick={() => setPage("accomplishments")} className="data-[active=true]:bg-sky-100 data-[active=true]:text-sky-900">
                  <Award /> <span className="truncate">My Accomplishments</span>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <Collapsible open={formsOpen} onOpenChange={setFormsOpen} className="group/forms">
                <SidebarMenuItem className="min-w-0">
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton isActive={page === "forms"} className="data-[active=true]:bg-sky-100 data-[active=true]:text-sky-900">
                      <FileText /> <span className="truncate">Forms</span>
                      <ChevronDown className="ml-auto shrink-0 transition-transform group-data-[state=open]/forms:rotate-180" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {FORM_TYPES.map(form => (
                        <SidebarMenuSubItem key={form.key} className="min-w-0">
                          <SidebarMenuSubButton
                            href="#"
                            isActive={page === "forms"}
                            onClick={e => { e.preventDefault(); setPage("forms"); }}
                            className="data-[active=true]:bg-sky-100 data-[active=true]:text-sky-900"
                          >
                            {form.icon} <span className="truncate">{form.label}</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Region B — "Division Head" (Milestone 5) — only rendered at
            all (including its own separators) for admins; a non-admin
            staff member sees Common Tabs flow straight into whatever
            Region C ends up being, with no empty gap/double-separator
            left behind where this region would have been. No visible
            group label (removed per the person's own explicit request —
            an earlier round of this milestone had added one with the
            reasoning "role-gated, worth naming at a glance," but that
            wasn't asked for and the person found it unnecessary; the
            SidebarSeparator above still marks the boundary visually). */}
        {user.isAdmin && (
          <>
            <SidebarSeparator />
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem className="min-w-0">
                    <SidebarMenuButton isActive={page === "monitoring"} onClick={() => setPage("monitoring")} className="data-[active=true]:bg-sky-100 data-[active=true]:text-sky-900">
                      <Users /> <span className="truncate">{user.role === "super_admin" ? "Department Monitoring" : `${DIVISIONS[user.division].shortName} Monitoring`}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem className="min-w-0">
                    <SidebarMenuButton isActive={page === "history"} onClick={() => setPage("history")} className="data-[active=true]:bg-sky-100 data-[active=true]:text-sky-900">
                      <ClipboardCheck /> <span className="truncate">History</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  {user.role === "super_admin" && (
                    <SidebarMenuItem className="min-w-0">
                      <SidebarMenuButton isActive={page === "admin"} onClick={() => setPage("admin")} className="data-[active=true]:bg-sky-100 data-[active=true]:text-sky-900">
                        <Lock /> <span className="truncate">Admin Management</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}

        {/* Region C — "Specific Tools" (Milestone 6) — same "gate the
            whole block, separator included" pattern as Region B, for
            the same no-empty-gap reason. No visible group label, same
            reasoning/removal as Region B's above. */}
        {hasAnySpecificTool && (
          <>
            <SidebarSeparator />
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {user.tags.includes("scholar_management") && (
                    <SidebarMenuItem className="min-w-0">
                      <SidebarMenuButton isActive={page === "scholarManagement"} onClick={() => setPage("scholarManagement")} className="data-[active=true]:bg-sky-100 data-[active=true]:text-sky-900">
                        <GraduationCap /> <span className="truncate">Scholar Management Tools</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                  {user.tags.includes("sdp_monitoring") && (
                    <SidebarMenuItem className="min-w-0">
                      <SidebarMenuButton isActive={page === "sdpMonitoring"} onClick={() => setPage("sdpMonitoring")} className="data-[active=true]:bg-sky-100 data-[active=true]:text-sky-900">
                        <Lightbulb /> <span className="truncate">SDP Monitoring</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                  {user.tags.includes("scholars_formation") && (
                    <SidebarMenuItem className="min-w-0">
                      <SidebarMenuButton isActive={page === "formationTools"} onClick={() => setPage("formationTools")} className="data-[active=true]:bg-sky-100 data-[active=true]:text-sky-900">
                        <Users2 /> <span className="truncate">Scholars' Formation Tools</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                  {user.tags.includes("forms_management") && (
                    <SidebarMenuItem className="min-w-0">
                      <SidebarMenuButton isActive={page === "formsManagement"} onClick={() => setPage("formsManagement")} className="data-[active=true]:bg-sky-100 data-[active=true]:text-sky-900">
                        <FileText /> <span className="truncate">Forms Management</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                  {user.tags.includes("kauban_content") && (
                    <SidebarMenuItem className="min-w-0">
                      <SidebarMenuButton isActive={page === "kaubanContent"} onClick={() => setPage("kaubanContent")} className="data-[active=true]:bg-sky-100 data-[active=true]:text-sky-900">
                        <Video /> <span className="truncate">Kauban Content Management</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                  {user.tags.includes("scholarship_program_info") && (
                    <SidebarMenuItem className="min-w-0">
                      <SidebarMenuButton isActive={page === "scholarshipProgramInfo"} onClick={() => setPage("scholarshipProgramInfo")} className="data-[active=true]:bg-sky-100 data-[active=true]:text-sky-900">
                        <BarChart3 /> <span className="truncate">Scholarship Program Information</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                  {user.username.toLowerCase() === IT_ADMIN_USERNAME && (
                    <SidebarMenuItem className="min-w-0">
                      <SidebarMenuButton isActive={page === "staffAccounts"} onClick={() => setPage("staffAccounts")} className="data-[active=true]:bg-sky-100 data-[active=true]:text-sky-900">
                        <Lock /> <span className="truncate">Staff Accounts</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>
    </Sidebar>
  );
}