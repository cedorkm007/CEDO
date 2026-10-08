import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSurveyPulse, loadSurveyDoc, saveSurveyDoc, type IdRemap, type SurveyPulse } from "../surveyDocApi";
import type { ActionResult } from "../publishApi";
import type { SurveyDoc, SurveyStatus } from "../surveyTypes";

export type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";

export interface ConflictInfo { editedByName: string; updatedAt: string; revision: number }

const SAVE_DELAY_MS = 900;
const ERROR_RETRY_MS = 6000;
const POLL_MS = 10000;

function applyRemap(doc: SurveyDoc, remap: IdRemap): SurveyDoc {
  if (Object.keys(remap.questions).length === 0) return doc;
  return {
    ...doc,
    items: doc.items.map(item => {
      if (item.kind !== "question") return item;
      const newId = remap.questions[item.id];
      if (!newId) return item;
      // The question was reworded after people had answered it, so the server
      // saved the new wording as a fresh version with new ids.
      return {
        ...item, id: newId, version: item.version + 1, hasResponses: false,
        options: item.options.map(o => ({ ...o, id: remap.options[o.id] ?? o.id })),
      };
    }),
  };
}

/**
 * Owns the survey being edited: loads it, applies edits, and auto-saves.
 *
 * - Edits are saved ~1s after the last change, as one atomic save of the whole
 *   survey (save_my_survey). Saves never overlap; edits made while a save is in
 *   flight trigger a follow-up save.
 * - Every save carries the revision this client last saw. If someone else saved
 *   in between, the server refuses and we surface a conflict (nothing is
 *   overwritten); the person chooses to load theirs or keep theirs-over-mine.
 * - While idle, polls so other people's edits (and changes to this person's own
 *   access) show up without a refresh. If the person is demoted or removed while
 *   editing, the refused save is detected and the survey is re-read instead of retried.
 * - Unsaved edits are flushed when leaving, and the browser warns on tab close.
 */
export function useSurveyDoc(surveyId: string) {
  const [doc, setDoc] = useState<SurveyDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);
  const [remoteNotice, setRemoteNotice] = useState<string | null>(null);
  const [accessLost, setAccessLost] = useState(false);
  const [effective, setEffective] = useState<{ status: SurveyStatus; autoClosedWhy: string | null } | null>(null);

  const docRef = useRef<SurveyDoc | null>(null);
  const stateRef = useRef<SaveState>("saved");
  const editSeq = useRef(0);
  const savedSeq = useRef(0);
  const baseRevision = useRef(0);
  const saving = useRef(false);
  const again = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  const setState = useCallback((s: SaveState) => { stateRef.current = s; setSaveState(s); }, []);
  const canEdit = doc?.role === "owner" || doc?.role === "editor";

  const adopt = useCallback((next: SurveyDoc) => {
    docRef.current = next;
    baseRevision.current = next.revision;
    editSeq.current = 0;
    savedSeq.current = 0;
    setDoc(next);
    setState("saved");
    setSaveError(null);
    setConflict(null);
  }, [setState]);

  /** The survey's true status: Open past its closing date / at its response limit is really Closed. */
  const applyPulse = useCallback((pulse: Extract<SurveyPulse, { kind: "ok" }>) => {
    const autoClosed = pulse.status === "open" && (pulse.limitReached || pulse.closesAtPassed);
    setEffective({
      status: autoClosed ? "closed" : pulse.status,
      autoClosedWhy: autoClosed ? (pulse.limitReached ? "its response limit was reached" : "its closing date passed") : null,
    });
  }, []);

  const reload = useCallback(async (): Promise<boolean> => {
    const fresh = await loadSurveyDoc(surveyId);
    if (!fresh) return false;
    adopt(fresh);
    return true;
  }, [surveyId, adopt]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const ok = await reload();
      if (cancelled) return;
      setLoadFailed(!ok);
      setLoading(false);
      if (ok) { const p = await fetchSurveyPulse(surveyId); if (!cancelled && p.kind === "ok") applyPulse(p); }
    })();
    return () => { cancelled = true; };
  }, [reload, surveyId, applyPulse]);

  /**
   * The server refused a save because this person's access changed (demoted to
   * viewer, or removed). Re-read what they can now see: if nothing, they have lost
   * access; otherwise load the survey as it is for them now (read-only for a viewer).
   */
  const handleAccessChange = useCallback(async (): Promise<void> => {
    if (timer.current) window.clearTimeout(timer.current);
    const fresh = await loadSurveyDoc(surveyId);
    if (!fresh) { setAccessLost(true); return; }
    const before = docRef.current?.role;
    adopt(fresh);
    setRemoteNotice(fresh.role === "viewer" && before !== "viewer"
      ? "You now have view-only access to this survey, so your latest changes could not be saved."
      : "Your access to this survey changed, so your latest changes could not be saved. The current version has been loaded.");
  }, [surveyId, adopt]);

  const runSave = useCallback(async (): Promise<void> => {
    if (saving.current) { again.current = true; return; }
    if (editSeq.current === savedSeq.current || !docRef.current) { if (stateRef.current !== "conflict") setState("saved"); return; }
    saving.current = true;
    setState("saving");
    const snapshotSeq = editSeq.current;
    const snapshot = docRef.current;
    const res = await saveSurveyDoc(surveyId, baseRevision.current, snapshot);
    saving.current = false;

    if (res.ok) {
      baseRevision.current = res.revision;
      savedSeq.current = snapshotSeq;
      // Apply to the LATEST doc, not the snapshot: the person may have kept typing meanwhile.
      const latest = applyRemap(docRef.current ?? snapshot, res.remap);
      const merged = { ...latest, revision: res.revision, updatedAt: res.updatedAt, lastEditedByName: res.editedByName || latest.lastEditedByName };
      docRef.current = merged;
      setDoc(merged);
      setSaveError(null);
      if (editSeq.current !== savedSeq.current || again.current) {
        again.current = false;
        void runSave();
      } else {
        setState("saved");
      }
    } else if (res.conflict) {
      setConflict({ editedByName: res.editedByName, updatedAt: res.updatedAt, revision: res.revision });
      setState("conflict");
    } else if (/permission/i.test(res.error)) {
      await handleAccessChange(); // retrying can never succeed: find out what changed instead
    } else {
      setSaveError(res.error);
      setState("error");
      timer.current = window.setTimeout(() => { void runSave(); }, ERROR_RETRY_MS);
    }
  }, [surveyId, setState, handleAccessChange]);

  /** Apply an edit to the document and schedule an auto-save. */
  const update = useCallback((fn: (d: SurveyDoc) => SurveyDoc) => {
    const current = docRef.current;
    if (!current || (current.role !== "owner" && current.role !== "editor")) return;
    const next = fn(current);
    if (next === current) return;
    docRef.current = next;
    setDoc(next);
    editSeq.current += 1;
    if (stateRef.current === "conflict") return; // held until the person decides
    setState("dirty");
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { void runSave(); }, SAVE_DELAY_MS);
  }, [runSave, setState]);

  /** Save right now; resolves true when nothing is left unsaved. */
  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) window.clearTimeout(timer.current);
    for (let i = 0; i < 60 && saving.current; i++) await new Promise(r => setTimeout(r, 100));
    if (editSeq.current !== savedSeq.current && stateRef.current !== "conflict") await runSave();
    return editSeq.current === savedSeq.current;
  }, [runSave]);

  /** Conflict choice 1: throw away my unsaved edits and load what the other person saved. */
  const loadTheirVersion = useCallback(async () => { await reload(); }, [reload]);

  /** Conflict choice 2: keep my edits and save them over theirs. */
  const keepMyVersion = useCallback(async () => {
    if (!conflict) return;
    baseRevision.current = conflict.revision;
    setConflict(null);
    setState("dirty");
    await runSave();
  }, [conflict, runSave, setState]);

  /**
   * Run a staff action that changes the survey on the server (save settings,
   * publish, close). Pending edits are saved first, the action carries the
   * revision this client last saw (so it can't overwrite someone else's work),
   * and on success the survey is reloaded so status/revision stay in step.
   */
  const serverAction = useCallback(async (fn: (revision: number) => Promise<ActionResult>): Promise<ActionResult> => {
    const clean = await flush();
    if (!clean) return { ok: false, conflict: false, error: "Your latest edits could not be saved yet. Resolve that first, then try again." };
    const res = await fn(baseRevision.current);
    if (res.ok) {
      await reload();
    } else if (res.conflict) {
      setConflict({ editedByName: res.editedByName, updatedAt: res.updatedAt, revision: res.revision });
      setState("conflict");
    }
    return res;
  }, [flush, reload, setState]);

  // Pick up other people's edits while there is nothing of mine waiting to be saved.
  useEffect(() => {
    const id = window.setInterval(async () => {
      if (stateRef.current !== "saved" || saving.current || !docRef.current) return;
      const pulse = await fetchSurveyPulse(surveyId);
      if (pulse.kind === "error") return;
      if (pulse.kind === "no_access") { setAccessLost(true); return; }
      applyPulse(pulse);
      const roleChanged = pulse.role !== docRef.current?.role;
      if (pulse.revision <= baseRevision.current && !roleChanged) return;
      if (stateRef.current !== "saved" || saving.current) return;
      if (await reload()) {
        if (roleChanged) {
          setRemoteNotice(pulse.role === "viewer" ? "You now have view-only access to this survey." : "Your access to this survey was changed.");
        } else {
          const who = docRef.current?.lastEditedByName;
          setRemoteNotice(who ? `Updated with changes saved by ${who}.` : "Updated with changes saved by someone else.");
        }
      }
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [surveyId, reload, applyPulse]);

  // Warn before closing the tab with unsaved edits; flush on leaving the page.
  useEffect(() => {
    function warn(e: BeforeUnloadEvent) {
      if (editSeq.current !== savedSeq.current) { e.preventDefault(); e.returnValue = ""; }
    }
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      if (timer.current) window.clearTimeout(timer.current);
      if (editSeq.current !== savedSeq.current && stateRef.current !== "conflict" && !saving.current) void runSave();
    };
  }, [runSave]);

  return {
    doc, loading, loadFailed, canEdit, saveState, saveError, conflict, remoteNotice, accessLost, effectiveStatus: effective?.status ?? null, autoClosedWhy: effective?.autoClosedWhy ?? null,
    update, flush, reload, serverAction, loadTheirVersion, keepMyVersion,
    dismissRemoteNotice: () => setRemoteNotice(null),
    retrySave: () => { void runSave(); },
  };
}
