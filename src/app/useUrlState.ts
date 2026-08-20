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
 * valid per `validValues`, that becomes the initial state instead of
 * `defaultValue` — this is what actually restores state after a refresh.
 * An invalid or unrecognized value in the URL (stale link, hand-edited,
 * tag revoked since the link was saved, etc.) safely falls back to
 * `defaultValue` instead of throwing or rendering something broken.
 *
 * `validValues` accepts two forms:
 *   - A fixed array, for a small closed set of tab/panel keys known at
 *     compile time (e.g. ["forms", "services"]) — this is enough for most
 *     callers and is checked synchronously against the array.
 *   - A predicate function, for a value whose real valid set isn't known
 *     until some async data has loaded (e.g. a Quest subject id — the set
 *     of real subject ids only exists once they've been fetched). The
 *     predicate given here should only do a cheap SYNCHRONOUS shape check
 *     (e.g. "is this UUID-shaped"), not attempt to consult the async data
 *     itself — this hook's own initial-state resolution runs before any
 *     effect/fetch has had a chance to complete, so a predicate that reads
 *     from not-yet-loaded state would always see it empty and always
 *     reject on first render, silently breaking restoration. Callers that
 *     need the REAL check (e.g. "does this id match an actually-loaded
 *     subject") should do that themselves in an effect once their data is
 *     ready, correcting the URL (calling the setter to reset to
 *     `defaultValue`) if it turns out to be stale — see QuestsPanel.tsx
 *     for a worked example.
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
  validValues: readonly T[] | ((value: string) => boolean),
): [T, (next: T) => void] {
  const isValid = (v: string): v is T =>
    typeof validValues === "function" ? validValues(v) : (validValues as readonly string[]).includes(v);

  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return defaultValue;
    const fromUrl = new URLSearchParams(window.location.search).get(paramName);
    return fromUrl && isValid(fromUrl) ? fromUrl : defaultValue;
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
