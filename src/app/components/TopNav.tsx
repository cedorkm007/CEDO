import { useRef } from "react";
import { Home, CheckSquare, Bell, LogOut } from "lucide-react";
import { ImageWithFallback } from "@/app/components/figma/ImageWithFallback";
import { SidebarTrigger } from "@/app/components/ui/sidebar";
import { DIVISIONS, type Page, type UserProfile } from "@/app/App";

/**
 * Admin UI Restructuring: the fixed top nav — 3 items (Home, My Tasks,
 * Notifications) plus a Profile/Sign-out control, wired in alongside
 * AppSidebar inside a shared SidebarProvider in App.tsx (see that file's
 * render tree). Renders <SidebarTrigger /> (hamburger button, mobile-only
 * — hidden at md+ since desktop shows the sidebar permanently) from the
 * shadcn sidebar primitive at src/app/components/ui/sidebar.tsx.
 *
 * Milestone 8 accessibility pass: every button here hides its text label
 * below the `sm` breakpoint (icon-only on narrow screens) via `hidden
 * sm:inline` — CSS `display:none` removes that text from the
 * accessibility tree entirely, not just visually, so every one of those
 * buttons now carries an explicit `aria-label` as a fallback accessible
 * name. Without this, a screen reader on a narrow viewport would announce
 * these controls with no name at all.
 */
export function TopNav({ user, page, setPage, onSignOut, unreadCount }: {
  user: UserProfile; page: Page; setPage: (p: Page) => void; onSignOut: () => void; unreadCount: number;
}) {
  const division = DIVISIONS[user.division];
  const avatarRef = useRef<HTMLButtonElement>(null);

  const items: { key: Page; label: string; icon: React.ReactNode }[] = [
    { key: "home", label: "Home", icon: <Home size={14} /> },
    // Revision 1 (post-M7 browser review): "My Tasks" now also appears in
    // the top nav, between Home and Notifications, per the requested tab
    // order. Initially kept in the sidebar too (Region A, Sidebar.tsx) as
    // that round's own stated default, since the person only said "put it
    // on the top nav" without specifying whether to also remove it from
    // the sidebar. Later removed from the sidebar once the duplication was
    // confirmed unwanted — "My Tasks" now lives here only.
    { key: "tasks", label: "My Tasks", icon: <CheckSquare size={14} /> },
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
              aria-label={item.label}
              className={`relative flex items-center gap-1.5 px-3 sm:px-3.5 py-2 rounded-lg text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-primary ${
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
            aria-label={`Profile — ${user.nickname || user.firstName}`}
            className={`flex items-center gap-2 pl-1 pr-2 py-1 rounded-full border-l border-white/20 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-primary ${
              page === "profile" ? "bg-white/10" : "hover:bg-white/10"
            }`}
          >
            {user.profilePicture ? (
              <img src={user.profilePicture} className="w-7 h-7 rounded-full object-cover ring-2 ring-accent/60" alt="" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-accent flex items-center justify-center text-accent-foreground text-xs font-bold flex-shrink-0">
                {user.firstName.charAt(0)}{user.lastName.charAt(0)}
              </div>
            )}
            <span className="text-white/85 text-sm hidden sm:inline">{user.nickname || user.firstName}</span>
          </button>
          <button onClick={onSignOut} aria-label="Sign Out" className="flex items-center gap-1.5 text-white/60 hover:text-white text-sm px-2 py-1.5 rounded-lg hover:bg-white/10 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-primary">
            <LogOut size={14} /> <span className="hidden sm:inline">Sign Out</span>
          </button>
        </div>
      </div>
    </header>
  );
}