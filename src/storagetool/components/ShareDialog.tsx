import { useCallback, useEffect, useState } from "react";
import { Link2, Loader2, Search, UserMinus, Users } from "lucide-react";
import { ModalShell } from "@/sead/components/SeadUiShell";
import { PERMISSION_HELP, PERMISSION_TEXT, fetchSharesOf, removeShare, searchStaff, setShare, type Permission, type ShareRow, type StaffMatch } from "../storageToolShareApi";
import type { ItemKind } from "../storageToolLogic";
import { LinkManager } from "./LinkManager";

const PERMISSIONS: Permission[] = ["view", "upload", "edit"];

/**
 * "Share": give other staff access to a file or a folder (permission chosen per person), and, for a folder, make upload links for people outside CEDO.
 * Only the owner sees this. Folders shared with someone include everything inside them, also what is added later.
 */
export function ShareDialog({ kind, id, name, onClose, onChanged }: { kind: ItemKind; id: string; name: string; onClose: () => void; onChanged: () => void }) {
  const [tab, setTab] = useState<"people" | "link">("people");
  const tabCls = (active: boolean) => `inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2 text-[14px] font-bold ${active ? "border-[#062444] text-[#062444]" : "border-transparent text-slate-700 hover:text-[#062444]"}`;
  return (
    <ModalShell title={`Share “${name}”`} onClose={onClose} wide>
      {kind === "folder" && (
        <div className="-mt-2 mb-1 flex overflow-x-auto border-b border-[#e6ecf5]" role="tablist" aria-label="Ways to share">
          <button role="tab" aria-selected={tab === "people"} onClick={() => setTab("people")} className={tabCls(tab === "people")}><Users size={16} aria-hidden="true" /> People at CEDO</button>
          <button role="tab" aria-selected={tab === "link"} onClick={() => setTab("link")} className={tabCls(tab === "link")}><Link2 size={16} aria-hidden="true" /> Upload link</button>
        </div>
      )}
      {tab === "people" ? <PeopleTab kind={kind} id={id} onChanged={onChanged} /> : <LinkManager folderId={id} folderName={name} />}
    </ModalShell>
  );
}

function PeopleTab({ kind, id, onChanged }: { kind: ItemKind; id: string; onChanged: () => void }) {
  const [shares, setShares] = useState<ShareRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<StaffMatch[] | null>(null);
  const [permission, setPermission] = useState<Permission>("view");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const options = kind === "file" ? PERMISSIONS.filter(p => p !== "upload") : PERMISSIONS;

  const load = useCallback(async () => {
    const r = await fetchSharesOf(kind, id);
    if (!r.ok) { setError(r.error); return; }
    setError(""); setShares(r.value);
  }, [kind, id]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (query.trim().length < 2) { setMatches(null); return; }
    let cancelled = false;
    const timer = window.setTimeout(async () => { const r = await searchStaff(query.trim()); if (!cancelled) { if (r.ok) setMatches(r.value); else setError(r.error); } }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query]);

  async function add(m: StaffMatch) {
    setBusy(m.id); setError(""); setMessage("");
    const r = await setShare(kind, id, m.id, permission);
    setBusy("");
    if (!r.ok) { setError(r.error); return; }
    setMessage(`Shared with ${m.name || m.username}. They were told in their notifications.`); setQuery(""); setMatches(null);
    await load(); onChanged();
  }
  async function change(s: ShareRow, p: Permission) {
    setBusy(s.userId); setError(""); setMessage("");
    const r = await setShare(kind, id, s.userId, p);
    setBusy("");
    if (!r.ok) { setError(r.error); return; }
    setMessage(`${s.name || s.username} now: ${PERMISSION_TEXT[p].toLowerCase()}.`); await load(); onChanged();
  }
  async function remove(s: ShareRow) {
    setBusy(s.userId); setError(""); setMessage("");
    const r = await removeShare(kind, id, s.userId);
    setBusy("");
    if (!r.ok) { setError(r.error); return; }
    setMessage(`${s.name || s.username} can no longer open it.`); await load(); onChanged();
  }
  const sharedIds = new Set((shares ?? []).map(s => s.userId));

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[14px] font-semibold text-[#062444]">Add a person</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[12rem] flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" aria-hidden="true" />
            <input value={query} onChange={e => setQuery(e.target.value)} aria-label="Search staff by name" placeholder="Type a name" className="w-full rounded-lg border border-[#062444]/25 bg-white py-2 pl-9 pr-3 text-[14px] outline-none focus:border-[#062444]" />
          </div>
          <label className="flex items-center gap-1.5 text-[14px] text-slate-800">They can
            <select value={permission} onChange={e => setPermission(e.target.value as Permission)} className="rounded-lg border border-[#062444]/25 bg-white px-2 py-2 text-[14px]">
              {options.map(p => <option key={p} value={p}>{PERMISSION_TEXT[p].replace(/^Can /, "")}</option>)}
            </select>
          </label>
        </div>
        <p className="mt-1.5 text-[13.5px] text-slate-700">{PERMISSION_HELP[permission]}{kind === "folder" ? " This also covers everything inside the folder, now and later." : ""}</p>
        {matches && (
          matches.length === 0 ? <p className="mt-2 text-[14px] text-slate-800">Nobody found. Only staff who have the Storage Tool can be added.</p> : (
            <ul className="mt-2 divide-y divide-[#e6ecf5] rounded-lg border border-[#e6ecf5]" aria-label="People found">
              {matches.map(m => (
                <li key={m.id} className="flex items-center justify-between gap-2 px-3 py-2 text-[14px]">
                  <span><strong className="text-[#062444]">{m.name || m.username}</strong> <span className="text-slate-700">({m.username})</span></span>
                  {sharedIds.has(m.id) ? <span className="text-slate-700">Already added</span>
                    : <button onClick={() => void add(m)} disabled={busy === m.id} className="inline-flex items-center gap-1.5 rounded-lg bg-[#062444] px-3 py-1.5 font-bold text-white disabled:opacity-60">{busy === m.id && <Loader2 size={13} className="animate-spin" aria-hidden="true" />} Add</button>}
                </li>
              ))}
            </ul>
          )
        )}
      </div>

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-[14px] text-red-800">{error}</p>}
      {message && <p role="status" className="rounded-lg bg-green-50 px-3 py-2 text-[14px] text-green-900">{message}</p>}

      <div>
        <p className="text-[14px] font-semibold text-[#062444]">People who can open it</p>
        {shares === null ? <p className="flex items-center gap-2 py-3 text-[14px] text-slate-700"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…</p>
          : shares.length === 0 ? <p className="py-2 text-[14px] text-slate-800">Nobody yet. Only you can open it.</p> : (
            <ul className="mt-1.5 divide-y divide-[#e6ecf5] rounded-lg border border-[#e6ecf5]">
              {shares.map(s => (
                <li key={s.userId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[14px]">
                  <span><strong className="text-[#062444]">{s.name || s.username}</strong> <span className="text-slate-700">({s.username})</span></span>
                  <span className="flex items-center gap-2">
                    <select value={s.permission} onChange={e => void change(s, e.target.value as Permission)} disabled={busy === s.userId} aria-label={`What ${s.name || s.username} can do`} className="rounded-lg border border-[#062444]/25 bg-white px-2 py-1.5 text-[14px]">
                      {options.map(p => <option key={p} value={p}>{PERMISSION_TEXT[p]}</option>)}
                    </select>
                    <button onClick={() => void remove(s)} disabled={busy === s.userId} className="inline-flex items-center gap-1.5 rounded-lg border border-red-800 bg-white px-3 py-1.5 font-bold text-red-800 hover:bg-red-50 disabled:opacity-60"><UserMinus size={14} aria-hidden="true" /> Remove</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
      </div>
    </div>
  );
}
