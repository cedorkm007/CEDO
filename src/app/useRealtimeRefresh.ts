import { useEffect, useRef } from "react";
import { subscribeToTable } from "@/lib/supabase";

export interface RealtimeRefreshOptions {
  /** Postgres changes filter (e.g. "session_id=eq.<uuid>") -- scopes the subscription server-side to just the caller's own rows, see subscribeToTable's own comment. */
  filter?: string;
  /**
   * Collapses a burst of rapid-fire events into at most one refetch per
   * `throttleMs` (plus a trailing call once the burst ends, so the final
   * state is never missed) -- fires immediately on the first event, same
   * as before, so a single change still feels instant. Without this, a
   * live audience of hundreds/thousands submitting at once (e.g. a word
   * cloud slide right after it's shown) fires one refetch-and-rerender
   * per submission; at classroom scale that's merely wasteful, but at
   * real scale it can lock up the presenter's own tab for minutes.
   * Omit (or 0) to refetch on every single event, as before.
   */
  throttleMs?: number;
}

/**
 * Re-runs `onChange` whenever any row in `table` changes — a thin
 * wrapper around subscribeToTable (src/lib/supabase.ts, already used by
 * App.tsx for chat/notifications/leave requests/etc.) that's safe to
 * call with a fresh inline callback on every render, since the callback
 * itself is kept in a ref rather than being part of the effect's
 * dependency array — otherwise a new function identity each render
 * would tear down and recreate the realtime subscription constantly.
 *
 * Exists because several admin screens loaded their data once on mount
 * and never again, so a change made from a different session (a
 * scholar's own upload, a QR attendance scan, a staff tag added by
 * it.admin1) only showed up after a manual page reload — this is the
 * fix for that class of staleness. Pass `enabled: false` to skip
 * subscribing (e.g. while a modal showing this data isn't open).
 */
export function useRealtimeRefresh(table: string, onChange: () => void, enabled = true, options?: RealtimeRefreshOptions): void {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const filter = options?.filter;
  const throttleMs = options?.throttleMs ?? 0;

  useEffect(() => {
    if (!enabled) return;
    if (throttleMs <= 0) {
      return subscribeToTable(table, () => onChangeRef.current(), filter);
    }
    // Trailing-edge throttle: fire immediately, then at most once more per
    // window for however many events arrived during it -- never more than
    // one in-flight refetch per window, never more than `throttleMs` stale.
    let cooldown: ReturnType<typeof setTimeout> | null = null;
    let pending = false;
    function fire() {
      if (cooldown) { pending = true; return; }
      onChangeRef.current();
      cooldown = setTimeout(() => {
        cooldown = null;
        if (pending) { pending = false; fire(); }
      }, throttleMs);
    }
    const unsubscribe = subscribeToTable(table, fire, filter);
    return () => {
      if (cooldown) clearTimeout(cooldown);
      unsubscribe();
    };
  }, [table, enabled, filter, throttleMs]);
}
