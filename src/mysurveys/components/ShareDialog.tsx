import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Search, UserPlus, X } from "lucide-react";
import {
  listAccess, removeShare, searchStaff, setShare, ROLE_HELP, ROLE_LABELS,
  type AccessEntry, type ShareRole, type StaffMatch,
} from "../shareApi";
import { fieldClass } from "../builder/cardParts";

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/**
 * "Share": search staff by name or email, give them Editor or Viewer access,
 * change a role, or remove someone. Owner only -- the server checks the owner
 * role on every one of these calls (see supabase_migration_my_surveys_sharing.sql),
 * this dialog only mirrors it.
 */
export function ShareDialog({ surveyId, surveyTitle, onClose }: { surveyId: string; surveyTitle: string; onClose: () => void }) {
  const [people, setPeople] = useState<AccessEntry[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StaffMatch[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [newRole, setNewRole] = useState<ShareRole>("viewer");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const searchSeq = useRef(0);

  const refresh = useCallback(async () => {
    const res = await listAccess(surveyId);
    if (res.ok) { setPeople(res.people); setLoadError(""); }
    else setLoadError(res.error);
  }, [surveyId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    function esc(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  // Search as the person types (after a short pause). Only the newest request may update the list.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults(null); setSearching(false); return; }
    setSearching(true);
    const seq = ++searchSeq.current;
    const t = window.setTimeout(async () => {
      const res = await searchStaff(surveyId, q);
      if (seq !== searchSeq.current) return;
      setSearching(false);
      if (res.ok) setResults(res.matches);
      else { setResults([]); setMessage({ kind: "error", text: res.error }); }
    }, 300);
    return () => window.clearTimeout(t);
  }, [query, surveyId]);

  async function add(match: StaffMatch) {
    setBusyId(match.id); setMessage(null);
    const res = await setShare(surveyId, match.id, newRole);
    setBusyId(null);
    if (!res.ok) { setMessage({ kind: "error", text: res.error ?? "Couldn't add that person." }); return; }
    setMessage({ kind: "ok", text: `${match.name} was added as ${ROLE_LABELS[newRole]}. The survey now appears under “Shared with me” for them.` });
    setQuery(""); setResults(null);
    await refresh();
  }

  async function changeRole(person: AccessEntry, role: ShareRole) {
    setBusyId(person.userId); setMessage(null);
    const res = await setShare(surveyId, person.userId, role);
    setBusyId(null);
    if (!res.ok) setMessage({ kind: "error", text: res.error ?? "Couldn't change the role." });
    else setMessage({ kind: "ok", text: `${person.name} is now ${ROLE_LABELS[role]}.` });
    await refresh();
  }

  async function remove(person: AccessEntry) {
    setBusyId(person.userId); setMessage(null);
    const res = await removeShare(surveyId, person.userId);
    setBusyId(null);
    if (!res.ok) setMessage({ kind: "error", text: res.error ?? "Couldn't remove that person." });
    else setMessage({ kind: "ok", text: `${person.name} no longer has access.` });
    await refresh();
  }

  return (
    <div className="fixed inset-0 z-[115] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="share-title">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex max-h-[92vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[#f0f3f8] px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h3 id="share-title" className="text-[15px] font-bold text-[#062444]">Share with colleagues</h3>
            <p className="truncate text-[12.5px] text-slate-500">{surveyTitle || "Untitled survey"}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-slate-500 hover:bg-[#f0f3f8]"><X size={16} /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4 sm:px-6">
          {/* Add people */}
          <div>
            <label htmlFor="share-search" className="mb-1.5 block text-[12px] font-semibold text-slate-600">Add people by name or email</label>
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  id="share-search" value={query} onChange={e => setQuery(e.target.value)} autoComplete="off"
                  placeholder="Start typing a name or email…" className={`${fieldClass} pl-8`}
                />
              </div>
              <div>
                <label htmlFor="share-role" className="sr-only">Role for the person you add</label>
                <select id="share-role" value={newRole} onChange={e => setNewRole(e.target.value as ShareRole)} className={fieldClass}>
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                </select>
              </div>
            </div>
            <p className="mt-1.5 text-[11.5px] text-slate-500">{ROLE_HELP[newRole]}</p>

            {query.trim().length >= 2 && (
              <ul className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-[#e6ecf5]" aria-label="Search results">
                {searching && results === null ? (
                  <li className="flex items-center gap-2 px-3 py-2.5 text-[12.5px] text-slate-500"><Loader2 size={13} className="animate-spin" /> Searching…</li>
                ) : results && results.length === 0 ? (
                  <li className="px-3 py-2.5 text-[12.5px] text-slate-500">No staff match “{query.trim()}”.</li>
                ) : (
                  (results ?? []).map(m => (
                    <li key={m.id} className="flex items-center gap-3 border-b border-[#f0f3f8] px-3 py-2 last:border-b-0">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#eef3fb] text-[11px] font-bold text-[#062444]" aria-hidden="true">{initials(m.name)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-[#062444]">{m.name}</span>
                        <span className="block truncate text-[11.5px] text-slate-500">{m.email}</span>
                      </span>
                      {m.accessRole ? (
                        <span className="shrink-0 text-[11.5px] font-semibold text-slate-500">Already {ROLE_LABELS[m.accessRole]}</span>
                      ) : (
                        <button
                          onClick={() => void add(m)} disabled={busyId !== null}
                          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#062444] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#0a3a6b] disabled:opacity-50"
                        >
                          {busyId === m.id ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />} Add
                        </button>
                      )}
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>

          {message && (
            <p role={message.kind === "error" ? "alert" : "status"} className={`rounded-lg px-3 py-2 text-[12.5px] font-medium ${message.kind === "error" ? "bg-red-50 text-red-700" : "bg-green-50 text-green-800"}`}>
              {message.text}
            </p>
          )}

          {/* People with access */}
          <div>
            <p className="mb-2 text-[12px] font-semibold text-slate-600">People with access</p>
            {loadError ? (
              <p className="text-[12.5px] text-red-600">{loadError}</p>
            ) : !people ? (
              <p className="flex items-center gap-2 text-[12.5px] text-slate-500"><Loader2 size={13} className="animate-spin" /> Loading…</p>
            ) : (
              <ul className="rounded-xl border border-[#e6ecf5]">
                {people.map(p => (
                  <li key={p.userId} className="flex items-center gap-3 border-b border-[#f0f3f8] px-3 py-2.5 last:border-b-0">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#eef3fb] text-[11px] font-bold text-[#062444]" aria-hidden="true">{initials(p.name)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-[#062444]">{p.name}</span>
                      <span className="block truncate text-[11.5px] text-slate-500">{p.email}</span>
                    </span>
                    {p.role === "owner" ? (
                      <span className="shrink-0 rounded-full bg-[#062444] px-2.5 py-0.5 text-[11px] font-bold text-white">Owner</span>
                    ) : (
                      <>
                        <label className="sr-only" htmlFor={`role-${p.userId}`}>Role for {p.name}</label>
                        <select
                          id={`role-${p.userId}`} value={p.role} disabled={busyId === p.userId}
                          onChange={e => void changeRole(p, e.target.value as ShareRole)}
                          className="shrink-0 rounded-lg border border-[#e6ecf5] bg-white px-2 py-1.5 text-[12.5px] text-[#062444] outline-none focus:border-[#0088cc]"
                        >
                          <option value="editor">Editor</option>
                          <option value="viewer">Viewer</option>
                        </select>
                        <button
                          onClick={() => void remove(p)} disabled={busyId === p.userId} aria-label={`Remove access for ${p.name}`} title="Remove access"
                          className="shrink-0 rounded-md p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                        >
                          {busyId === p.userId ? <Loader2 size={15} className="animate-spin" /> : <X size={15} />}
                        </button>
                      </>
                    )}
                  </li>
                ))}
                {people.length === 1 && <li className="px-3 py-2.5 text-[12.5px] text-slate-500">Only you can open this survey so far.</li>}
              </ul>
            )}
          </div>

          <div className="rounded-xl bg-[#f7f9fc] px-3.5 py-3 text-[12px] leading-relaxed text-slate-600">
            <p><span className="font-semibold text-[#062444]">Owner</span> — full control, including deleting the survey and sharing it.</p>
            <p className="mt-1"><span className="font-semibold text-[#062444]">Editor</span> — {ROLE_HELP.editor.charAt(0).toLowerCase() + ROLE_HELP.editor.slice(1)}</p>
            <p className="mt-1"><span className="font-semibold text-[#062444]">Viewer</span> — {ROLE_HELP.viewer.charAt(0).toLowerCase() + ROLE_HELP.viewer.slice(1)}</p>
            <p className="mt-2 text-slate-500">Sharing only decides which staff can open this survey here. If the survey is published, anyone with its public link or QR code can still answer it.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
