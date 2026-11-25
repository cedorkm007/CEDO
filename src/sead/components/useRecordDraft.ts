import { useCallback, useEffect, useRef, useState } from "react";
import { discardServerDraft, fetchServerDraft, saveServerDraft } from "../scholarCounselingApi";
import { differsFrom, localDraftName, newerDraft, parseStoredDraft, savedAtLabel, type DraftValues, type StoredDraft } from "@/lib/recordPopup";

const SERVER_DELAY_MS = 3000;
const readLocal = (name: string): StoredDraft | null => { try { return parseStoredDraft(window.sessionStorage.getItem(localDraftName(name))); } catch { return null; } };
const writeLocal = (name: string, d: StoredDraft) => { try { window.sessionStorage.setItem(localDraftName(name), JSON.stringify(d)); } catch { /* private window: only the server copy is kept */ } };
const removeLocal = (name: string) => { try { window.sessionStorage.removeItem(localDraftName(name)); } catch { /* nothing to remove */ } };

/**
 * Keeps what a staff member has typed but not saved, so it is still there after a refresh, after closing the window or on another computer.
 *  - Every change is written at once to this browser tab (it is cleared when the tab closes: findings are sensitive) and, three seconds after the last key, to the database.
 *  - When the form opens and a draft that differs from it exists (the newer of the two copies), it is offered back as `pending` (Restore / Discard); autosaving continues meanwhile.
 *  - `clear()` removes both copies (after a save, or when the person discards).
 * `draftName` null = no draft (for example, no scholar chosen yet). If the database update has not been run yet, only the tab copy is kept and the status says so.
 */
export function useRecordDraft({ draftName, values, baseline, base }: { draftName: string | null; values: DraftValues; baseline: DraftValues; base: number | null }) {
  const [pending, setPending] = useState<StoredDraft | null>(null);
  const [status, setStatus] = useState("");
  const [ready, setReady] = useState(false);
  const valuesRef = useRef(values), baselineRef = useRef(baseline), baseRef = useRef(base);
  valuesRef.current = values; baselineRef.current = baseline; baseRef.current = base;
  const timer = useRef<number | undefined>(undefined);
  const unsent = useRef<{ name: string; values: DraftValues; base: number | null } | null>(null);
  const savedOnce = useRef(false);

  const sendNow = useCallback(async () => {
    window.clearTimeout(timer.current);
    const job = unsent.current;
    if (!job) return;
    unsent.current = null;
    const r = await saveServerDraft(job.name, job.values, job.base);
    setStatus(r.ok ? `Draft saved · ${savedAtLabel(r.savedAt)}` : `Draft kept on this tab only · ${savedAtLabel(new Date().toISOString())}`);
  }, []);

  // the draft that was kept earlier for this form, if any
  useEffect(() => {
    setPending(null); setStatus(""); setReady(false); savedOnce.current = false; unsent.current = null;
    if (!draftName) return;
    let live = true;
    const local = readLocal(draftName);
    void fetchServerDraft(draftName).then(server => {
      if (!live) return;
      const best = newerDraft(local, server);
      if (best && differsFrom(best.values, baselineRef.current)) setPending(best);
      setReady(true);
    });
    return () => { live = false; window.clearTimeout(timer.current); void sendNow(); };
  }, [draftName, sendNow]);

  // every change: this tab at once, the database after a short pause
  const signature = JSON.stringify(values);
  useEffect(() => {
    if (!draftName || !ready) return;
    if (!differsFrom(valuesRef.current, baselineRef.current)) {
      if (savedOnce.current) { removeLocal(draftName); void discardServerDraft(draftName); setStatus(""); savedOnce.current = false; unsent.current = null; window.clearTimeout(timer.current); }
      return;
    }
    savedOnce.current = true;
    writeLocal(draftName, { values: valuesRef.current, savedAt: new Date().toISOString(), base: baseRef.current });
    unsent.current = { name: draftName, values: valuesRef.current, base: baseRef.current };
    setStatus("Saving the draft…");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { void sendNow(); }, SERVER_DELAY_MS);
  }, [signature, draftName, ready, sendNow]);

  // closing or refreshing the page: send what is waiting
  useEffect(() => {
    const onHide = () => { void sendNow(); };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [sendNow]);

  const clear = useCallback(async () => {
    window.clearTimeout(timer.current);
    unsent.current = null; savedOnce.current = false;
    setPending(null); setStatus("");
    if (draftName) { removeLocal(draftName); await discardServerDraft(draftName); }
  }, [draftName]);

  /** The draft found when the form opened, handed over so the form can fill itself with it. */
  const restore = useCallback((): StoredDraft | null => { const p = pending; setPending(null); return p; }, [pending]);

  return { pending, status, ready, clear, restore };
}
