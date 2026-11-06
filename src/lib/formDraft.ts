import { useEffect, useRef, useState } from "react";

/**
 * Drafts kept on THIS device, so that what a person has typed (and the pictures they picked) is not lost when they go to another step, leave the page, reload it, or the phone
 * closes the browser to free memory. Stored in the browser's IndexedDB (it can hold files); nothing is sent anywhere until the person submits.
 * Every call is safe: when the browser refuses storage (private window, storage full) the form simply works without a draft.
 */
const DB_NAME = "cedo-drafts";
const STORE = "drafts";
export const DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;      // a draft older than 30 days is thrown away

interface Stored<T> { savedAt: number; value: T }

function open(): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    try {
      if (typeof indexedDB === "undefined") { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
}

async function run<R>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest | null, done: (req: IDBRequest | null) => R, fallback: R): Promise<R> {
  const db = await open();
  if (!db) return fallback;
  return new Promise<R>(resolve => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = work(tx.objectStore(STORE));
      tx.oncomplete = () => { db.close(); resolve(done(req)); };
      tx.onerror = () => { db.close(); resolve(fallback); };
      tx.onabort = () => { db.close(); resolve(fallback); };
    } catch { try { db.close(); } catch { /* nothing to close */ } resolve(fallback); }
  });
}

/** Keeps the draft under this key (replacing the earlier one). Returns whether it was stored. */
export function saveDraft<T>(key: string, value: T, now = Date.now()): Promise<boolean> {
  return run<boolean>("readwrite", s => s.put({ savedAt: now, value } satisfies Stored<T>, key), () => true, false);
}

/** The draft under this key, or null when there is none (or it is older than 30 days, which also removes it). */
export async function loadDraft<T>(key: string, now = Date.now()): Promise<{ value: T; savedAt: number } | null> {
  const found = await run<Stored<T> | null>("readonly", s => s.get(key), req => (req?.result as Stored<T> | undefined) ?? null, null);
  if (!found || typeof found.savedAt !== "number") return null;
  if (now - found.savedAt > DRAFT_MAX_AGE_MS) { void deleteDraft(key); return null; }
  return { value: found.value, savedAt: found.savedAt };
}

export function deleteDraft(key: string): Promise<boolean> {
  return run<boolean>("readwrite", s => s.delete(key), () => true, false);
}

/**
 * Saves `snapshot` as the draft under `key` a moment after the last change (and at once when the page is hidden or closed), and says when it was last saved.
 * Pass `snapshot = null` to save nothing (for example while the draft is still loading, or when nothing has been typed yet).
 */
export function useDraftAutosave<T>(key: string, snapshot: T | null, delayMs = 600): { savedAt: number | null; discard: () => Promise<void>; saveNow: () => Promise<void> } {
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const latest = useRef<{ key: string; snapshot: T | null }>({ key, snapshot });
  latest.current = { key, snapshot };
  const dirty = useRef(false);
  const stopped = useRef(false);

  async function flush() {
    const { key: k, snapshot: s } = latest.current;
    if (stopped.current || !dirty.current || s === null) return;
    dirty.current = false;
    const ok = await saveDraft(k, s);
    if (ok) setSavedAt(Date.now());
  }

  useEffect(() => {
    if (snapshot === null) return;
    stopped.current = false;      // a new change after a discard starts a new draft
    dirty.current = true;
    const t = window.setTimeout(() => { void flush(); }, delayMs);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, snapshot, delayMs]);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") void flush(); };
    const onPageHide = () => { void flush(); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => { document.removeEventListener("visibilitychange", onHide); window.removeEventListener("pagehide", onPageHide); void flush(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Throws the draft away (after the form was sent, or when the person chooses to start over). Nothing is saved again until the next change to the form. */
  async function discard() { stopped.current = true; dirty.current = false; setSavedAt(null); await deleteDraft(latest.current.key); }
  return { savedAt, discard, saveNow: flush };
}

/** "Draft saved at 3:15 PM" */
export function savedAtText(savedAt: number | null): string {
  if (savedAt === null) return "";
  return `Draft saved on this device at ${new Date(savedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}
