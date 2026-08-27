import { useRef } from "react";
import { Home, Bell, LogOut } from "lucide-react";
import { ImageWithFallback } from "@/app/components/figma/ImageWithFallback";
import { SidebarTrigger } from "@/app/components/ui/sidebar";
import { DIVISIONS, type Page, type UserProfile } from "@/app/App";

/**
 * Admin UI Restructuring, Milestone 2: the new fixed top nav — exactly 3
 * items (Home, Notifications, a Profile/Sign-out control), replacing the
 * old TopNav's much longer primaryItems list + avatar dropdown + separate
 * Forms dropdown. See MILESTONE_1_navigation_mapping.md for the full
 * target mapping this follows.
 *
 * NOT YET WIRED IN. App.tsx still renders its own local `TopNav` function
 * (unchanged) — this file exists as a real, verified, ready-to-swap-in
 * replacement, but swapping it in is being deliberately held back for one
 * reason worth flagging clearly: the items this design removes from the
 * top nav (Profile, My Tasks, My Accomplishments, Monitoring, History,
 * Admin Management, Forms, and all 5 Specific Tools) don't have anywhere
 * to go yet — the sidebar that's supposed to hold them is Milestones 3-6,
 * not built yet. Swapping this in today, before the sidebar exists, would
 * make all of those pages unreachable via navigation for however long it
 * takes to build the sidebar — a real functional regression, not just a
 * cosmetic change. That tradeoff needs a decision from the person, not an
 * assumption either way — see the accompanying report/handoff for the
 * two options laid out.
 *
 * Kept as a genuinely standalone, drop-in-compatible component (same
 * prop shape as the current TopNav) specifically so that whichever way
 * that decision goes, this piece doesn't need to be rebuilt — either
 * wire it in as-is once the sidebar exists, or wire it in now alongside a
 * temporary interim access path for the relocated items, without
 * touching this file's own logic either way.
 *
 * Milestone 3 addition: now renders <SidebarTrigger /> (hamburger button,
 * mobile-only) from the shadcn sidebar primitive at
 * src/app/components/ui/sidebar.tsx — see src/app/components/Sidebar.tsx
 * for why context (not new isOpen/onClose props) is the coordination
 * mechanism. RUNTIME DEPENDENCY worth knowing before wiring this in:
 * SidebarTrigger calls useSidebar() internally, which throws if this
 * component is ever rendered outside a <SidebarProvider> ancestor. Not an
 * issue yet — this file isn't live-rendered anywhere this round either —
 * but whichever milestone wires both this and <AppSidebar /> into App.tsx
 * must wrap both inside one shared <SidebarProvider>.
 */
export function TopNav({ user, page, setPage, onSignOut, unreadCount }: {
  user: UserProfile; page: Page; setPage: (p: Page) => void; onSignOut: () => void; unreadCount: number;
}) {
  const division = DIVISIONS[user.division];
  const avatarRef = useRef<HTMLButtonElement>(null);

  const items: { key: Page; label: string; icon: React.ReactNode }[] = [
    { key: "home", label: "Home", icon: <Home size={14} /> },
    { key: "notifications", label: "Notifications", icon: <Bell size={14} /> },
  ];

  return (
    <header className="fixed top-0 left-0 right-0 z-40 bg-primary shadow-lg">
      <div className="max-w-7xl mx-auto px-4 flex items-center justify-between h-14">
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Hidden at md+ (same breakpoint the sidebar itself switches
              on) — desktop shows the sidebar permanently, so there's
              nothing to toggle there. */}
          <SidebarTrigger className="md:hidden text-white/70 hover:text-white hover:bg-white/10 [&_svg]:text-white/70 [&:hover_svg]:text-white" />
          <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-accent flex-shrink-0 bg-white">
            <ImageWithFallback src={division.logo} alt={division.shortName} className="w-full h-full object-cover" />
          </div>
          <span className="text-white font-bold text-sm tracking-wide truncate hidden sm:inline">{division.shortName} Task Tracker</span>
        </div>

        {/* Only 2 real nav buttons now (Home, Notifications) — small enough
            to always render inline at every breakpoint, so unlike the old
            TopNav there's no separate scrollable mobile row needed; labels
            just hide below sm, icons always stay visible. */}
        <nav className="flex items-center gap-0.5">
          {items.map(item => (
            <button
              key={item.key}
              onClick={() => setPage(item.key)}
              aria-current={page === item.key ? "page" : undefined}
              className={`relative flex items-center gap-1.5 px-3 sm:px-3.5 py-2 rounded-lg text-sm font-medium transition-all ${
                page === item.key ? "bg-accent text-accent-foreground font-semibold" : "text-white/70 hover:text-white hover:bg-white/10"
              }`}
            >
              {item.icon} <span className="hidden sm:inline">{item.label}</span>
              {item.key === "notifications" && unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Profile/Sign-out control: per the mapping doc this is
              deliberately NOT a dropdown anymore (there's nothing left to
              put in one — Accomplishments/Monitoring/History/Admin all
              relocate to the sidebar) — clicking the avatar goes straight
              to the Profile page, matching what "Profile/Sign-out control"
              names it as. */}
          <button
            ref={avatarRef}
            onClick={() => setPage("profile")}
            aria-current={page === "profile" ? "page" : undefined}
            className={`flex items-center gap-2 pl-1 pr-2 py-1 rounded-full border-l border-white/20 transition-all ${
              page === "profile" ? "bg-white/10" : "hover:bg-white/10"
            }`}
          >
            {user.profilePicture ? (
              <img src={user.profilePicture} className="w-7 h-7 rounded-full object-cover ring-2 ring-accent/60" alt="avatar" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-accent flex items-center justify-center text-accent-foreground text-xs font-bold flex-shrink-0">
                {user.firstName.charAt(0)}{user.lastName.charAt(0)}
              </div>
            )}
            <span className="text-white/85 text-sm hidden sm:inline">{user.nickname || user.firstName}</span>
          </button>
          <button onClick={onSignOut} className="flex items-center gap-1.5 text-white/60 hover:text-white text-sm px-2 py-1.5 rounded-lg hover:bg-white/10 transition-all">
            <LogOut size={14} /> <span className="hidden sm:inline">Sign Out</span>
          </button>
        </div>
      </div>
    </header>
  );
}
