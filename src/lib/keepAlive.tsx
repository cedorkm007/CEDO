// ─────────────────────────────────────────────────────────────
// src/lib/keepAlive.tsx
// "Keep the tab alive": a tab the staff member already opened is HIDDEN when they switch to another tab (or open a scholar's detail page), not thrown away. Coming back shows the same list at once:
// the same filters, page and scroll, with no "Loading…" and no new read of the database. A tab that follows the live updates (useLiveReload) while hidden only remembers that something changed
// and reads again when it is shown (once), so nothing is read for a tab nobody is looking at. A tab never opened is never loaded.
// The decisions are plain functions (no React) so they can be tested.
// ─────────────────────────────────────────────────────────────
import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";

/** Is the tab this screen sits in the one being looked at? (true when the screen is not inside a KeepAlivePane.) */
export const TabActiveContext = createContext(true);
export const useTabActive = (): boolean => useContext(TabActiveContext);

/** How long a TOOL (a whole page of the staff app) may stay hidden before it is read again when the staff member comes back. Inside it, the tabs that follow the live updates are kept fresh anyway. */
export const TOOL_STALE_MS = 10 * 60_000;
/** How long a TAB without live updates may stay hidden before it is read again when the staff member comes back (switching away and back within this time shows it at once). */
export const TAB_STALE_MS = 2 * 60_000;

export interface PaneState { seen: boolean; shownKey: number; hiddenAt?: number | null; generation?: number }
/**
 * What a pane shows: nothing until it was first opened; then always its content (hidden when not active). `shownKey` is the refresh number the content sees: it only moves while the pane is active.
 * `generation` goes up when the pane is shown again after being hidden longer than `staleAfterMs` (the content is then built again, so it reads fresh data); without `staleAfterMs` it never does
 * (use that for screens that follow the live updates).
 */
export function nextPaneState(prev: PaneState, active: boolean, refreshKey: number, now: number = Date.now(), staleAfterMs?: number): Required<PaneState> & { render: boolean } {
  const seen = prev.seen || active;
  let hiddenAt = prev.hiddenAt ?? null, generation = prev.generation ?? 0;
  if (!active && prev.seen && hiddenAt === null) hiddenAt = now;
  if (active) { if (hiddenAt !== null && staleAfterMs !== undefined && now - hiddenAt > staleAfterMs) generation++; hiddenAt = null; }
  return { seen, shownKey: active ? refreshKey : prev.shownKey, hiddenAt, generation, render: seen };
}

/**
 * The live-reload rule of a screen: when the portal's code changes, read again at once if the tab is shown; if it is hidden, remember it and read ONCE when it is shown again.
 * `reload` is called through the returned functions only.
 */
export function createLiveReloadGate(reload: () => unknown) {
  let stale = false;
  return {
    /** The portal's code changed. */
    tick(active: boolean) { if (active) void reload(); else stale = true; },
    /** The tab was shown (or hidden) now. */
    activeChanged(active: boolean) { if (active && stale) { stale = false; void reload(); } },
    isStale: () => stale,
  };
}

/**
 * Wrap the content of one tab: `<KeepAlivePane active={tab === "x"} refreshKey={refreshKey}>{rk => <XTab refreshKey={rk} />}</KeepAlivePane>`.
 * The content gets the refresh number as it was when the tab was last shown; when the tab is shown again and something was refreshed meanwhile, the number moves and the tab reads again (once).
 */
export function KeepAlivePane({ active, refreshKey = 0, staleAfterMs, children }: { active: boolean; refreshKey?: number; staleAfterMs?: number; children: (refreshKey: number) => ReactNode }) {
  const parentActive = useTabActive();      // a pane inside a hidden tool is hidden too
  const state = useRef<PaneState>({ seen: active, shownKey: refreshKey });
  const next = nextPaneState(state.current, active, refreshKey, Date.now(), staleAfterMs);
  state.current = { seen: next.seen, shownKey: next.shownKey, hiddenAt: next.hiddenAt, generation: next.generation };
  if (!next.render) return null;
  return (
    <TabActiveContext.Provider value={parentActive && active}>
      <div key={next.generation} hidden={!active}>{children(next.shownKey)}</div>
    </TabActiveContext.Provider>
  );
}

/** Used by useLiveReload (src/lib/liveUpdates.tsx): the gate of one screen, re-created only once. */
export function useLiveReloadGate(reload: () => unknown, tick: number, active: boolean): void {
  const latest = useRef(reload);
  latest.current = reload;
  const gate = useRef<ReturnType<typeof createLiveReloadGate> | null>(null);
  if (!gate.current) gate.current = createLiveReloadGate(() => latest.current());
  const seen = useRef(tick);
  useEffect(() => {
    if (tick === seen.current) return;
    seen.current = tick;
    gate.current!.tick(active);
  }, [tick, active]);
  useEffect(() => { gate.current!.activeChanged(active); }, [active]);
}
