// ─────────────────────────────────────────────────────────────
// src/scholar/renewalSummary.ts
// Pure helpers that turn the scholar's renewal overview into plain sentences for the places that show it in short: the Renewal tracker,
// the chips on the Services tiles, and the banner on the portal home. No React / Supabase, so tests can run it alone.
// ─────────────────────────────────────────────────────────────
import { formatDay, formatSlotShort, scholarNextSteps, termLabelOf, type RenewalStage } from "@/lib/renewal";
import type { MyRenewalWindow } from "./renewalApi";

/** The "what to do next" sentences for one renewal (first = the one to do now). */
export function buildNextSteps(w: MyRenewalWindow): string[] {
  const r = w.record;
  if (!r) return [];
  const openInc = w.incItems.filter(i => i.state === "open");
  return scholarNextSteps(r.stage, r.evaluation, {
    incDeadlines: openInc.map(i => ({ subject: i.subject, deadline: i.deadline })), evaluatorComment: r.evaluatorComment,
    consultNeeded: w.consultNeeded || w.booking !== null, consultState: w.booking ? "ok" : w.consultState,
    booking: w.booking ? { startsAt: w.booking.startsAt, staffName: w.booking.staffName } : null, isSummer: w.window.term === "Summer", noShow: r.noShowFlag,
  });
}

/**
 * Does the scholar themself have something to do RIGHT NOW (upload a document, book a consultation, complete credits or an INC, fix a returned
 * application), as opposed to waiting for the office (an approval, an appointment that is already booked, the evaluator)?
 */
export function scholarActsNow(w: MyRenewalWindow): boolean {
  const r = w.record;
  if (!r) return false;
  if (r.stage === "returned" || r.stage === "sdp_on_hold" || r.stage === "inc_waiting_compliance") return true;
  if ((r.evaluation.required_documents ?? []).some(d => !d.satisfied)) return true;
  return w.consultState === "ok" && w.consultNeeded && w.booking === null;
}
const FINISHED: readonly RenewalStage[] = ["renewed", "removed", "reconsidered", "late_declined", "not_required"];

export interface RenewalAttention {
  windowId: string; termLabel: string;
  /** The sentence to show. */
  headline: string;
  /** true when the scholar has something to do; false when they are just waiting. */
  actionNeeded: boolean;
}

/** The most important thing about the scholar's renewals right now, or null when there is nothing to say. */
export function renewalAttention(windows: MyRenewalWindow[]): RenewalAttention | null {
  let waiting: RenewalAttention | null = null;
  for (const w of windows) {
    const term = termLabelOf(w.window.schoolYear, w.window.term);
    if (!w.record) {
      if (w.state === "open" || w.state === "late") {
        return { windowId: w.window.id, termLabel: term, actionNeeded: true,
          headline: w.state === "open" ? `Renewal for ${term} is open. Apply by ${formatDay(w.window.closesOn)}.` : `Renewal for ${term} has closed, but you can still apply late.` };
      }
      continue;
    }
    if (FINISHED.includes(w.record.stage)) continue;
    const steps = buildNextSteps(w);
    if (steps.length === 0) continue;
    const mine = scholarActsNow(w);
    // a booked consultation is worth a reminder too
    const att: RenewalAttention = { windowId: w.window.id, termLabel: term, headline: steps[0], actionNeeded: mine };
    if (mine) return att;
    waiting ??= att;
  }
  return waiting;
}

/** A short chip for the Renewal tile on the Services screen. */
export function renewalTileChip(windows: MyRenewalWindow[]): { text: string; tone: "action" | "waiting" | "done" } | null {
  const a = renewalAttention(windows);
  if (a) return { text: a.actionNeeded ? "Action needed" : "In progress", tone: a.actionNeeded ? "action" : "waiting" };
  const renewed = windows.find(w => w.record?.stage === "renewed");
  return renewed ? { text: `Renewed for ${termLabelOf(renewed.window.schoolYear, renewed.window.term)}`, tone: "done" } : null;
}

/** A short chip for the Consultation tile. */
export function consultationTileChip(windows: MyRenewalWindow[]): { text: string; tone: "action" | "waiting" | "done" } | null {
  const booked = windows.map(w => w.booking).filter((b): b is NonNullable<MyRenewalWindow["booking"]> => b !== null).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  if (booked) return { text: `Booked: ${formatSlotShort(booked.startsAt)}`, tone: "done" };
  if (windows.some(w => w.consultState === "ok" && w.consultNeeded)) return { text: "Book your consultation", tone: "action" };
  if (windows.some(w => w.consultState !== "not_needed" && w.record)) return { text: "Waiting for approval", tone: "waiting" };
  return null;
}
