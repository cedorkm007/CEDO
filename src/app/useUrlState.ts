import { useEffect, useState } from "react";

/**
 * Persists a small piece of UI navigation state (an active tab/section) to
 * a URL query parameter via history.replaceState, so a browser refresh
 * restores it — without adopting a full router. react-router is a listed
 * dependency of this project but isn't wired up anywhere in the codebase
 * (every page/tab here is plain useState); this stays consistent with
 * that existing style rather than introducing a second navigation
 * paradigm just for this feature.
 *
 * On first render, reads `paramName` from the current URL; if present AND
 * a member of `validValues`, that becomes the initial state instead of
 * `defaultValue` — this is what actually restores state after a refresh.
 * An invalid or unrecognized value in the URL (stale link, hand-edited,
 * tag revoked since the link was saved, etc.) safely falls back to
 * `defaultValue` instead of throwing or rendering something broken.
 *
 * Every time the returned state changes afterward, the URL is rewritten
 * in place (replaceState — no new history entry, no page navigation) to
 * match, so the NEXT refresh restores the new value too. The default
 * value is kept OUT of the URL (the param is removed, not written) so the
 * address bar doesn't fill up with noise when nothing's actually been
 * changed from the default.
 */
export function useUrlState<T extends string>(
  paramName: string,
  defaultValue: T,
  validValues: readonly T[],
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return defaultValue;
    const fromUrl = new URLSearchParams(window.location.search).get(paramName);
    return fromUrl && (validValues as readonly string[]).includes(fromUrl) ? (fromUrl as T) : defaultValue;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (value === defaultValue) url.searchParams.delete(paramName);
    else url.searchParams.set(paramName, value);
    const next = url.toString();
    if (next !== window.location.href) window.history.replaceState(window.history.state, "", next);
  }, [paramName, value, defaultValue]);

  return [value, setValue];
}
