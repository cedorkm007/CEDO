import { useCallback, useEffect, useState } from "react";
import { Loader2, UserCog } from "lucide-react";
import { ModalShell } from "@/sead/components/SeadUiShell";
import { fetchAdminOverview, handOver, saveLimits, type AdminOverview, type AdminPerson } from "../storageToolAdminApi";
import { countWords, formatBytes, settingsProblem } from "../storageToolLogic";

const dateText = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—");

/**
 * The IT admin's tab: how much of the whole storage is used and by whom, the three limits (biggest file, days in the Trash, whole storage), and
 * "Hand over…" — all of one person's files, shares and upload links go to another person, so a former colleague's account can be deleted.
 */
export function AdminView({ onChanged }: { onChanged: () => void }) {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [limits, setLimits] = useState({ maxFileMb: "500", trashDays: "30", quotaGb: "200" });
  const [saving, setSaving] = useState(false);
  const [handing, setHanding] = useState<AdminPerson | null>(null);

  const load = useCallback(async () => {
    const r = await fetchAdminOverview();
    if (!r.ok) { setError(r.error); return; }
    setError(""); setData(r.value);
    setLimits({ maxFileMb: String(r.value.maxFileMb), trashDays: String(r.value.trashDays), quotaGb: String(r.value.quotaGb) });
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const v = { maxFileMb: Number(limits.maxFileMb), trashDays: Number(limits.trashDays), quotaGb: Number(limits.quotaGb) };
    const problem = settingsProblem(v);
    if (problem) { setError(problem); setMessage(""); return; }
    setSaving(true); setError(""); setMessage("");
    const r = await saveLimits(v.maxFileMb, v.trashDays, v.quotaGb);
    setSaving(false);
    if (!r.ok) { setError(r.error); return; }
    setMessage("The limits were saved."); await load(); onChanged();
  }

  const percent = data && data.quotaBytes > 0 ? Math.min(100, Math.round((data.totalBytes / data.quotaBytes) * 100)) : 0;
  const field = "mt-1 w-full rounded-lg border border-[#062444]/25 px-3 py-2 text-[14px] font-normal outline-none focus:border-[#062444]";
  return (
    <div className="space-y-5">
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-[14px] text-red-800">{error}</p>}
      {message && <p role="status" className="rounded-lg bg-green-50 px-3 py-2 text-[14px] text-green-900">{message}</p>}
      {data === null && !error ? <p className="flex items-center gap-2 py-8 text-[14px] text-slate-700"><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Loading…</p> : data && (
        <>
          <section aria-label="Space used" className="rounded-xl border border-[#e6ecf5] bg-white p-4">
            <h2 className="text-[15px] font-bold text-[#062444]">The whole storage</h2>
            <p className="mt-1 text-[14px] text-slate-800"><strong>{formatBytes(data.totalBytes)}</strong> used of {formatBytes(data.quotaBytes)} ({percent}%). The Trash counts until it is emptied.</p>
            <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Space used by everybody">
              <div className={`h-full rounded-full ${percent >= 90 ? "bg-red-700" : "bg-[#00709f]"}`} style={{ width: `${Math.max(percent, data.totalBytes > 0 ? 2 : 0)}%` }} />
            </div>
          </section>

          <section aria-label="Limits" className="rounded-xl border border-[#e6ecf5] bg-white p-4">
            <h2 className="text-[15px] font-bold text-[#062444]">Limits</h2>
            <form onSubmit={e => void save(e)} className="mt-2 grid gap-3 sm:grid-cols-3">
              <label className="block text-[14px] font-semibold text-[#062444]">Biggest file (MB)<input value={limits.maxFileMb} onChange={e => setLimits(l => ({ ...l, maxFileMb: e.target.value }))} inputMode="numeric" className={field} /></label>
              <label className="block text-[14px] font-semibold text-[#062444]">Days in the Trash<input value={limits.trashDays} onChange={e => setLimits(l => ({ ...l, trashDays: e.target.value }))} inputMode="numeric" className={field} /></label>
              <label className="block text-[14px] font-semibold text-[#062444]">Whole storage (GB)<input value={limits.quotaGb} onChange={e => setLimits(l => ({ ...l, quotaGb: e.target.value }))} inputMode="numeric" className={field} /></label>
              <div className="sm:col-span-3">
                <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-[#062444] px-4 py-2 text-[14px] font-bold text-white hover:bg-[#0a3a6e] disabled:opacity-60">{saving && <Loader2 size={14} className="animate-spin" aria-hidden="true" />} Save the limits</button>
                <p className="mt-2 text-[13.5px] text-slate-700">The biggest file can never be more than 500 MB, which is what the storage itself accepts. Changes apply to new uploads and to the next clean-up of the Trash.</p>
              </div>
            </form>
          </section>

          <section aria-label="People">
            <h2 className="mb-1.5 text-[15px] font-bold text-[#062444]">People</h2>
            <div className="relative overflow-x-auto rounded-xl border border-[#e6ecf5] bg-white">
              <table className="w-full text-left text-[14px]">
                <thead className="bg-[#f7f9fc] text-[#062444]"><tr><th className="px-4 py-2.5 font-bold">Person</th><th className="px-3 py-2.5 font-bold">Access</th><th className="px-3 py-2.5 font-bold">Files</th><th className="px-3 py-2.5 font-bold">Folders</th><th className="px-3 py-2.5 font-bold">Space used</th><th className="px-3 py-2.5 font-bold">In Trash</th><th className="px-3 py-2.5 font-bold">Shares</th><th className="px-3 py-2.5 font-bold">Links</th><th className="px-3 py-2.5 font-bold">Last activity</th><th className="px-3 py-2.5"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody className="divide-y divide-[#e6ecf5]">
                  {data.people.map(p => (
                    <tr key={p.id} className="hover:bg-[#f7f9fc]">
                      <td className="px-4 py-2"><span className="font-bold text-[#062444]">{p.name || p.username}</span> <span className="text-slate-700">({p.username})</span></td>
                      <td className="px-3 py-2">{p.hasAccess ? <span className="text-green-900">Yes</span> : <span className="font-semibold text-red-800">No longer</span>}</td>
                      <td className="px-3 py-2 text-slate-800">{p.files}</td><td className="px-3 py-2 text-slate-800">{p.folders}</td><td className="px-3 py-2 text-slate-800">{formatBytes(p.bytes)}</td><td className="px-3 py-2 text-slate-800">{formatBytes(p.trashBytes)}</td>
                      <td className="px-3 py-2 text-slate-800">{p.shares}</td><td className="px-3 py-2 text-slate-800">{p.links}</td><td className="px-3 py-2 text-slate-800">{dateText(p.lastActivity)}</td>
                      <td className="px-3 py-2">{p.hasAnything && <button onClick={() => setHanding(p)} aria-label={`Hand over the files of ${p.name || p.username}`} className="inline-flex items-center gap-1.5 rounded-lg border border-[#062444]/40 bg-white px-3 py-1.5 font-bold text-[#062444] hover:bg-[#f7f9fc]"><UserCog size={15} aria-hidden="true" /> Hand over…</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[13.5px] text-slate-700">A person who still has files, folders, shares or upload links cannot be deleted from Staff Accounts. Hand everything over to a colleague first.</p>
          </section>
        </>
      )}
      {handing && data && <HandOverDialog from={handing} candidates={data.people.filter(p => p.hasAccess && p.id !== handing.id)} onClose={() => setHanding(null)}
        onDone={text => { setHanding(null); setMessage(text); void load(); onChanged(); }} />}
    </div>
  );
}

function HandOverDialog({ from, candidates, onClose, onDone }: { from: AdminPerson; candidates: AdminPerson[]; onClose: () => void; onDone: (text: string) => void }) {
  const [to, setTo] = useState(candidates[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const receiver = candidates.find(c => c.id === to);
  async function go() {
    setBusy(true); setError("");
    const r = await handOver(from.id, to);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    onDone(`Handed over to ${receiver?.name || receiver?.username}: ${countWords(r.value.files, "file", "files")}, ${countWords(r.value.folders, "folder", "folders")}, ${countWords(r.value.shares, "share", "shares")} and ${countWords(r.value.links, "upload link", "upload links")}. They are in the folder “${r.value.folderName}” at the top of that person's storage.`);
  }
  return (
    <ModalShell title={`Hand over the files of ${from.name || from.username}`} onClose={busy ? () => undefined : onClose} wide>
      <div className="space-y-3 text-[14px] text-slate-800">
        <p>All of their files ({countWords(from.files, "file", "files")}, {formatBytes(from.bytes)}), folders, shares and upload links, also what is in their Trash, will belong to the person you choose. Nothing is copied or deleted.</p>
        <label className="block font-semibold text-[#062444]">Hand over to
          <select value={to} onChange={e => setTo(e.target.value)} className="mt-1 w-full rounded-lg border border-[#062444]/25 bg-white px-3 py-2 text-[14px] font-normal">
            {candidates.map(c => <option key={c.id} value={c.id}>{c.name || c.username} ({c.username})</option>)}
          </select>
        </label>
        <ul className="list-disc space-y-1 pl-5">
          <li>What was at the top of their storage goes into one new folder, “From {from.name || from.username} (handed over …)”, so no name can clash.</li>
          <li>Their upload links keep working; the notices about new uploads go to the new owner.</li>
          <li>What was shared <em>with</em> {from.name || from.username} by others ends.</li>
          <li>Afterwards the account can be deleted in Staff Accounts.</li>
        </ul>
        {candidates.length === 0 && <p role="alert" className="text-red-700">There is nobody else with access to the Storage Tool to hand over to.</p>}
        {error && <p role="alert" className="text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} disabled={busy} className="rounded-lg border border-[#062444]/25 px-4 py-2 font-semibold text-[#062444]">Cancel</button>
          <button onClick={() => void go()} disabled={busy || !to} className="inline-flex items-center gap-2 rounded-lg bg-[#062444] px-4 py-2 font-bold text-white disabled:opacity-60">{busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />} Hand over</button>
        </div>
      </div>
    </ModalShell>
  );
}
