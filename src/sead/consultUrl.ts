// ─────────────────────────────────────────────────────────────
// src/sead/consultUrl.ts
// The part of the Consultation Tool's address (see src/lib/consultUrl.ts) that touches the browser's address bar.
//  - A change of TAB and the opening of a RECORD each add ONE step to the browser history (so Back and Forward move between tabs and open / closed records). One click that changes several things
//    (a dashboard number opens a tab with its filters) is still ONE step, because every change here is written in one go.
//  - A change of a list's page, filters, search or sort only REPLACES the current step (no flood of history steps).
//  - Nothing is written while another page of the staff app is on screen (the tool stays alive in the background): the page tells this module when it is shown or hidden.
// ─────────────────────────────────────────────────────────────
import { applyPatch, type CtTab, type Patch } from "@/lib/consultUrl";

/** The Consultation Tool is the page on screen. Set by the page itself (ScholarCounselingToolPage). */
let toolShown = false;
export const setToolShown = (shown: boolean) => { toolShown = shown; };
export const isToolShown = () => toolShown;

/** One step in the browser history (a new entry): a tab change, an opened record. `state` is kept on that entry (the open record's id, to know that closing it can simply go Back). Nothing is added when the address would not change. */
export function ctPush(patch: Patch, opts: { clear?: boolean; state?: Record<string, unknown> } = {}): boolean {
  if (typeof window === "undefined" || !toolShown) return false;
  const next = applyPatch(window.location.search, patch, opts.clear);
  if (next === window.location.search) return false;
  window.history.pushState({ ...(window.history.state ?? {}), ...(opts.state ?? {}) }, "", `${window.location.pathname}${next}${window.location.hash}`);
  return true;
}

/** Changes the current step of the history without adding one (a page, a filter, a search, a sort, the edit mode). */
export function ctReplace(patch: Patch, opts: { clear?: boolean } = {}): boolean {
  if (typeof window === "undefined" || !toolShown) return false;
  const next = applyPatch(window.location.search, patch, opts.clear);
  if (next === window.location.search) return false;
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${next}${window.location.hash}`);
  return true;
}

/** A tab opened from somewhere else in the staff app (a notification): written to the address at once (the page change that follows keeps it) and announced to the tool if it is already alive. */
export const CT_TAB_EVENT = "cedo:consultation-tab";
export function requestConsultTab(tab: CtTab): void {
  if (typeof window === "undefined") return;
  const next = applyPatch(window.location.search, { ctTab: tab }, true);
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${next}${window.location.hash}`);
  window.dispatchEvent(new CustomEvent<CtTab>(CT_TAB_EVENT, { detail: tab }));
}
