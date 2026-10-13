import { useCallback, useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { formatDateTime } from "@/lib/renewal";
import { fetchScholarNotifications, markScholarNotificationsRead, type ScholarNotification } from "../../renewalApi";

/** Anything that creates a notification (applying, resubmitting …) can ask the bell to refresh right away. */
export const NOTIFICATIONS_CHANGED = "scholar-notifications-changed";

/**
 * The scholar's bell: every notification the system sends (in the portal — web push comes later and always falls back to this list).
 * Opening the list marks what was unread as read. Refreshes itself every minute while the portal is open.
 */
export function NotificationBell({ tone = "dark" }: { tone?: "dark" | "light" }) {
  const [rows, setRows] = useState<ScholarNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const r = await fetchScholarNotifications(30);
    if (r.ok) { setRows(r.rows); setError(""); } else setError(r.error);
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 60_000);
    const refresh = () => void load();
    window.addEventListener(NOTIFICATIONS_CHANGED, refresh);
    return () => { window.clearInterval(t); window.removeEventListener(NOTIFICATIONS_CHANGED, refresh); };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const unread = rows.filter(r => !r.readAt).length;

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      await load();
      if (rows.some(r => !r.readAt)) { await markScholarNotificationsRead(); }
    } else {
      await load();
    }
  }

  const btn = tone === "dark"
    ? "bg-white/10 hover:bg-white/20 text-white"
    : "bg-[#f7f9fc] hover:bg-[#eef3fb] text-[#062444] border border-[#e6ecf5]";
  return (
    <div ref={wrapRef} className="relative">
      <button onClick={() => void toggle()} aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} aria-expanded={open}
        className={`relative flex h-10 w-10 items-center justify-center rounded-[10px] transition-colors ${btn}`}>
        <Bell size={18} aria-hidden="true" />
        {unread > 0 && <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[13px] font-bold leading-none text-white">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label="Notifications" className="absolute right-0 z-50 mt-2 w-[min(92vw,22rem)] rounded-xl border border-[#e6ecf5] bg-white shadow-[0_12px_32px_rgba(6,36,68,0.2)]">
          <div className="border-b border-[#e6ecf5] px-4 py-2.5 text-[14px] font-bold text-[#062444]">Notifications</div>
          <div className="max-h-[60vh] overflow-y-auto">
            {error && <p role="alert" className="px-4 py-3 text-[14px] text-red-700">{error}</p>}
            {!error && rows.length === 0 && <p className="px-4 py-5 text-[14px] text-slate-700">Nothing yet. When something happens with your renewal, you will see it here.</p>}
            <ul>
              {rows.map(n => (
                <li key={n.id} className={`border-b border-[#eef3fb] px-4 py-3 last:border-b-0 ${n.readAt ? "" : "bg-sky-50"}`}>
                  <p className="text-[14px] font-bold text-[#062444]">{n.title}{!n.readAt && <span className="ml-2 rounded bg-sky-700 px-1.5 py-0.5 text-[13px] font-bold text-white">New</span>}</p>
                  {n.body && <p className="mt-0.5 text-[14px] text-slate-700">{n.body}</p>}
                  <p className="mt-1 text-[13px] text-slate-600">{formatDateTime(n.createdAt)}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
