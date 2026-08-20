import { useEffect, useState } from "react";

/**
 * Persists a small piece of UI navigation state (an active tab/section) to
 * a URL query parameter, so a browser refresh restores it AND Back/Forward
 * move through it — without adopting a full router. react-router is a
 * listed dependency of this project but isn't wired up anywhere in the
 * codebase (every page/tab here is plain useState); this stays consistent
 * with that existing style rather than introducing a second navigation
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
 * Back/Forward: every time the returned state changes as a direct result
 * of calling the returned setter (a real user-driven navigation — clicked
 * a tab, selected a subject, etc.), the URL is updated via pushState, so a
 * NEW history entry is created and Back returns to the value it had
 * before. A `popstate` listener (fired by the browser on Back/Forward)
 * reads the URL's value for THIS param and syncs local state to match,
 * WITHOUT pushing yet another entry — the browser already moved history
 * for us at that point, we're only catching React state up to it. The
 * default value is kept OUT of the URL (the param is removed, not
 * written) so the address bar doesn't fill up with noise when nothing's
 * actually been changed from the default, and so Back past the first
 * real change lands on a clean URL rather than one with an explicit
 * "?tab=default" still in it.
 *
 * Known limitation: this hook manages ONE param independently. A single
 * user action that changes state in TWO different useUrlState-backed
 * values at once (e.g. leaving the Quests panel resets the selected
 * subject AND changes the active dashboard panel) produces two separate
 * pushState calls — two history entries for what felt like one click, so
 * Back would need to be pressed twice to fully undo it. Solving that
 * properly needs a shared/coalesced history writer across all
 * useUrlState instances on a page, which is a bigger change than this fix
 * — flagging it rather than silently leaving it undocumented.
 */
export function useUrlState<T extends string>(
  paramName: string,
  defaultValue: T,
  validValues: readonly T[] | ((value: string) => boolean),
): [T, (next: T) => void] {
  const isValid = (v: string): v is T =>
    typeof validValues === "function" ? validValues(v) : (validValues as readonly string[]).includes(v);

  const readFromUrl = (): T => {
    if (typeof window === "undefined") return defaultValue;
    const fromUrl = new URLSearchParams(window.location.search).get(paramName);
    return fromUrl && isValid(fromUrl) ? fromUrl : defaultValue;
  };

  const [value, setValue] = useState<T>(readFromUrl);

  // Back/Forward: the browser has already updated window.location by the
  // time this fires — just catch React state up to it. Deliberately does
  // NOT call history.pushState/replaceState itself; the effect below
  // no-ops for this case on its own (see its comment), since by the time
  // it runs the URL already matches the now-synced value.
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onPopState() {
      setValue(readFromUrl());
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramName, defaultValue]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (value === defaultValue) url.searchParams.delete(paramName);
    else url.searchParams.set(paramName, value);
    const next = url.toString();
    // Nothing to do if the address bar already matches — true on first
    // mount (state was just read from this same URL above), and true
    // right after a popstate sync (the browser already updated
    // window.location before onPopState ever ran). Only a genuine
    // user-driven change reaches the pushState call below.
    if (next === window.location.href) return;
    window.history.pushState(window.history.state, "", next);
  }, [paramName, value, defaultValue]);

  return [value, setValue];
}
