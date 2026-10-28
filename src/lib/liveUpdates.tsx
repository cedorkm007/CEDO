// ─────────────────────────────────────────────────────────────
// src/lib/liveUpdates.tsx
// Live updates for the scholar, staff and school portals, so a change made by someone else shows up without refreshing the page.
// While a portal is open and visible, it asks the database every ~10-15 seconds for ONE short code ("has anything changed?": scholar_live_stamp / staff_live_stamp / school_live_stamp,
// supabase_migration_live_updates.sql). When the code is different, every screen that registered with useLiveReload() reads its data again, quietly (no "Loading…" flash).
// It pauses while the page is hidden, asks again at once when the page is shown again or the internet comes back, slows down after errors, and stops by itself when the
// database update has not been run or the person may not follow changes. Before the SQL is run, nothing changes: pages work as before.
// ─────────────────────────────────────────────────────────────
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";

export type LiveKind = "scholar" | "staff" | "school";
const RPC: Record<LiveKind, string> = { scholar: "scholar_live_stamp", staff: "staff_live_stamp", school: "school_live_stamp" };
/** How often each portal asks (milliseconds, before a little random spread so thousands of open pages do not ask at the same instant). */
export const LIVE_INTERVAL_MS: Record<LiveKind, number> = { scholar: 15_000, staff: 10_000, school: 15_000 };
const MAX_BACKOFF_MS = 120_000;

export type StampResult = { ok: true; stamp: string } | { ok: false; fatal: boolean };

/** The wait before the next question: the normal interval spread by up to ±20%, doubled after each failure in a row (at most 2 minutes). */
export function nextLiveDelay(baseMs: number, failures: number, random: () => number = Math.random): number {
  const spread = baseMs * (0.8 + random() * 0.4);
  return Math.min(MAX_BACKOFF_MS, Math.round(spread * Math.pow(2, Math.min(failures, 6))));
}

/** Is this error one that will not go away by trying again (the database update was not run, or the person may not follow changes)? */
export function isFatalLiveError(e: { code?: string | null; message?: string | null; status?: number | null } | null | undefined): boolean {
  if (!e) return false;
  const text = `${e.code ?? ""} ${e.message ?? ""}`;
  return e.code === "PGRST202" || e.code === "42883" || e.status === 404 || /could not find the function|does not exist|not authorized|not signed in|permission denied/i.test(text);
}

export interface LivePollerOptions {
  fetchStamp: () => Promise<StampResult>;
  onChange: () => void;
  baseMs: number;
  isHidden?: () => boolean;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
  random?: () => number;
}

/** The scheduling logic, free of React so it can be tested: ask, compare with the last code, call onChange when it differs, wait, repeat. */
export function createLivePoller(o: LivePollerOptions) {
  const setTimer = o.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let stopped = false, running = false, timer: unknown = null, last: string | null = null, failures = 0;

  const schedule = () => { if (!stopped) timer = setTimer(() => { void poll(); }, nextLiveDelay(o.baseMs, failures, o.random)); };
  async function poll(): Promise<void> {
    if (stopped || running) return;
    if (o.isHidden?.()) { schedule(); return; }          // nobody is looking: wait; showing the page asks at once
    running = true;
    let r: StampResult;
    try { r = await o.fetchStamp(); } catch { r = { ok: false, fatal: false }; }
    running = false;
    if (stopped) return;
    if (!r.ok) { if (r.fatal) { stopped = true; return; } failures++; schedule(); return; }
    failures = 0;
    if (last !== null && r.stamp !== last) o.onChange();
    last = r.stamp;
    schedule();
  }
  return {
    start: () => { stopped = false; void poll(); },
    stop: () => { stopped = true; if (timer != null) clearTimer(timer); },
    /** Ask now (the page was shown again, or the internet came back). */
    pollNow: () => { if (stopped) return; if (timer != null) clearTimer(timer); void poll(); },
  };
}

/** A number that goes up each time the portal's code changes. */
export function useLiveStamp(kind: LiveKind, enabled = true): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const poller = createLivePoller({
      baseMs: LIVE_INTERVAL_MS[kind],
      isHidden: () => typeof document !== "undefined" && document.hidden,
      onChange: () => setTick(t => t + 1),
      fetchStamp: async () => {
        const { data, error } = await supabase.rpc(RPC[kind]);
        if (error) return { ok: false, fatal: isFatalLiveError(error) };
        return { ok: true, stamp: String(data ?? "") };
      },
    });
    const wake = () => { if (typeof document === "undefined" || !document.hidden) poller.pollNow(); };
    poller.start();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    return () => { poller.stop(); document.removeEventListener("visibilitychange", wake); window.removeEventListener("focus", wake); window.removeEventListener("online", wake); };
  }, [kind, enabled]);
  return tick;
}

const LiveContext = createContext(0);

/** Wrap a whole portal (or one page of it) once; everything inside can register with useLiveReload(). */
export function LiveProvider({ kind, enabled = true, children }: { kind: LiveKind; enabled?: boolean; children: ReactNode }) {
  const tick = useLiveStamp(kind, enabled);
  return <LiveContext.Provider value={tick}>{children}</LiveContext.Provider>;
}

export const useLiveTick = (): number => useContext(LiveContext);

/**
 * Calls `reload` each time the portal's code changes (not when the screen first appears: the screen loads its own data then). `reload` should read the data again WITHOUT clearing
 * what is on screen, so the page updates in place.
 */
export function useLiveReload(reload: () => unknown): void {
  const tick = useLiveTick();
  const latest = useRef(reload);
  latest.current = reload;
  const seen = useRef(tick);
  useEffect(() => {
    if (tick === seen.current) return;
    seen.current = tick;
    void latest.current();
  }, [tick]);
}
