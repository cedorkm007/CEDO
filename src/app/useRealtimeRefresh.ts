import { useEffect, useRef } from "react";
import { subscribeToTable } from "@/lib/supabase";

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
export function useRealtimeRefresh(table: string, onChange: () => void, enabled = true): void {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!enabled) return;
    return subscribeToTable(table, () => onChangeRef.current());
  }, [table, enabled]);
}
