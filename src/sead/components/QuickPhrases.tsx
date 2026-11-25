import { useCallback, useEffect, useState } from "react";
import { deleteQuickPhrase, fetchQuickPhrases, saveQuickPhrase, type QuickPhrase } from "../scholarCounselingApi";
import { ModalShell } from "./SeadUiShell";

/** The shared quick phrases (null until they are read; also null when the database update has not been run yet, in which case the Insert menu is not offered). */
export function useQuickPhrases(enabled = true) {
  const [phrases, setPhrases] = useState<QuickPhrase[] | null>(null);
  const reload = useCallback(async () => { setPhrases(await fetchQuickPhrases()); }, []);
  useEffect(() => { if (enabled) void reload(); }, [enabled, reload]);
  return { phrases, reload };
}

/** The list of quick phrases. Any consultation staff can add, change or remove a phrase: the list is shared by everybody. */
export function QuickPhrasesManager({ phrases, onChanged, onClose }: { phrases: QuickPhrase[]; onChanged: () => void; onClose: () => void }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function run(key: string, job: () => Promise<{ ok: true } | { ok: false; error: string }>, after?: () => void) {
    setBusy(key); setError("");
    const r = await job();
    setBusy("");
    if (!r.ok) { setError(r.error); return; }
    after?.(); onChanged();
  }

  return (
    <ModalShell title="Quick phrases" onClose={onClose} wide>
      <p className="text-[13px] text-slate-700">Short, ready-made lines that staff insert into the findings or the staff recommendations. The list is shared: every consultation staff member sees the same phrases and can change them.</p>
      {error && <p role="alert" className="text-[13.5px] text-red-700">{error}</p>}
      <ul className="space-y-2">
        {phrases.map(p => {
          const text = drafts[p.id] ?? p.phrase;
          return (
            <li key={p.id} className="flex flex-wrap items-center gap-2">
              <input value={text} maxLength={300} aria-label="Phrase" onChange={e => setDrafts(d => ({ ...d, [p.id]: e.target.value }))}
                className="min-w-0 flex-1 rounded-lg border border-[#062444]/25 bg-white px-3 py-2 text-[14px] text-slate-900 outline-none focus:border-[#0088cc]" />
              <button type="button" disabled={busy !== "" || text.trim() === p.phrase} onClick={() => void run(p.id, () => saveQuickPhrase(p.id, text), () => setDrafts(d => { const n = { ...d }; delete n[p.id]; return n; }))}
                className="rounded-lg bg-[#062444] px-3 py-2 text-[13px] font-semibold text-white hover:bg-[#0a3a6e] disabled:opacity-50">Save</button>
              <button type="button" disabled={busy !== ""} onClick={() => { if (window.confirm(`Remove this phrase for everybody?\n\n"${p.phrase}"`)) void run(p.id, () => deleteQuickPhrase(p.id)); }}
                className="rounded-lg border border-red-300 bg-white px-3 py-2 text-[13px] font-semibold text-red-800 hover:bg-red-50 disabled:opacity-50">Remove</button>
            </li>
          );
        })}
        {phrases.length === 0 && <li className="text-[13.5px] text-slate-700">There are no phrases yet.</li>}
      </ul>
      <div className="flex flex-wrap items-center gap-2 border-t border-[#f0f3f8] pt-3">
        <input value={adding} maxLength={300} placeholder="A new phrase, e.g. Follow-up visit booked" aria-label="New phrase" onChange={e => setAdding(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-[#062444]/25 bg-white px-3 py-2 text-[14px] text-slate-900 outline-none focus:border-[#0088cc]" />
        <button type="button" disabled={busy !== "" || adding.trim() === ""} onClick={() => void run("new", () => saveQuickPhrase(null, adding), () => setAdding(""))}
          className="rounded-lg bg-[#062444] px-3 py-2 text-[13px] font-semibold text-white hover:bg-[#0a3a6e] disabled:opacity-50">Add</button>
      </div>
      <div className="flex justify-end pt-1">
        <button type="button" onClick={onClose} className="rounded-lg border border-[#062444]/25 bg-white px-4 py-2 text-[13.5px] font-semibold text-[#062444] hover:bg-[#f7f9fc]">Done</button>
      </div>
    </ModalShell>
  );
}
