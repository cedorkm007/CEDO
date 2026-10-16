import { useCallback, useEffect, useState } from "react";
import { Folder, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { deleteForever, fetchTrash, restoreItems, type TrashItem } from "../storageToolOrganizeApi";
import { countWords, formatBytes, itemKey, trashCountdown } from "../storageToolLogic";
import { ConfirmDialog } from "./Dialogs";
import { FileTypeIcon } from "./FileTypeIcon";

/**
 * The Trash: one line per deleted item (a deleted folder is one line), with where it was, when it was deleted and how long is left. Restore puts it
 * back where it was; Delete forever (and "Empty Trash") removes the stored files for real, after a question.
 */
export function TrashView({ onChanged }: { onChanged: () => void }) {
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [trashDays, setTrashDays] = useState(30);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<TrashItem[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetchTrash();
    if (!r.ok) { setError(r.error); return; }
    setError(""); setItems(r.value.items); setTrashDays(r.value.trashDays);
    setSelected(prev => new Set([...prev].filter(k => r.value.items.some(i => itemKey(i.kind, i.id) === k))));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const chosen = (items ?? []).filter(i => selected.has(itemKey(i.kind, i.id)));
  const toggle = (key: string) => setSelected(s => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const refs = (list: TrashItem[]) => list.map(i => ({ kind: i.kind, id: i.id }));

  async function restore(list: TrashItem[]) {
    setBusy(true); setMessage(""); setError("");
    const r = await restoreItems(refs(list));
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setMessage(`Restored ${countWords(r.value.restored, "item", "items")}${r.value.toTop ? `. ${countWords(r.value.toTop, "item was", "items were")} put at the top of your storage because the folder it was in is gone or in the Trash` : ""}.`);
    await load(); onChanged();
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[14px] text-slate-800">Deleted items stay here for {trashDays} days, then they are removed for good. Only you can see your Trash.</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => void restore(chosen)} disabled={busy || chosen.length === 0} className="inline-flex items-center gap-2 rounded-lg border border-[#062444]/40 bg-white px-3.5 py-2 text-[14px] font-bold text-[#062444] hover:bg-[#f7f9fc] disabled:opacity-50"><RotateCcw size={15} aria-hidden="true" /> Restore{chosen.length ? ` (${chosen.length})` : ""}</button>
          <button onClick={() => setConfirm(chosen)} disabled={busy || chosen.length === 0} className="inline-flex items-center gap-2 rounded-lg border border-red-800 bg-white px-3.5 py-2 text-[14px] font-bold text-red-800 hover:bg-red-50 disabled:opacity-50"><Trash2 size={15} aria-hidden="true" /> Delete forever{chosen.length ? ` (${chosen.length})` : ""}</button>
          <button onClick={() => setConfirm(items ?? [])} disabled={busy || !items || items.length === 0} className="inline-flex items-center gap-2 rounded-lg bg-red-800 px-3.5 py-2 text-[14px] font-bold text-white hover:bg-red-900 disabled:opacity-50">Empty Trash</button>
        </div>
      </div>
      {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-[14px] text-red-800">{error}</p>}
      {message && <p role="status" className="mb-3 rounded-lg bg-green-50 px-3 py-2 text-[14px] text-green-900">{message}</p>}
      {items === null ? <p className="flex items-center gap-2 py-8 text-[14px] text-slate-700"><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Loading…</p>
        : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[#062444]/30 bg-[#f7f9fc] px-6 py-12 text-center">
            <Trash2 size={36} className="text-[#062444]" aria-hidden="true" /><p className="text-[16px] font-bold text-[#062444]">The Trash is empty</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#e6ecf5] bg-white">
            <table className="w-full text-left text-[14px]">
              <thead className="bg-[#f7f9fc] text-[#062444]">
                <tr>
                  <th className="w-10 px-3 py-2.5"><input type="checkbox" checked={items.length > 0 && chosen.length === items.length} onChange={() => setSelected(chosen.length === items.length ? new Set() : new Set(items.map(i => itemKey(i.kind, i.id))))} aria-label="Select everything in the Trash" className="h-4 w-4 cursor-pointer accent-[#062444]" /></th>
                  <th className="px-2 py-2.5 font-bold">Name</th><th className="px-3 py-2.5 font-bold">Was in</th><th className="px-3 py-2.5 font-bold">Size</th><th className="px-3 py-2.5 font-bold">Deleted</th><th className="px-3 py-2.5 font-bold">Time left</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e6ecf5]">
                {items.map(i => {
                  const key = itemKey(i.kind, i.id);
                  return (
                    <tr key={key} className={selected.has(key) ? "bg-sky-50" : "hover:bg-[#f7f9fc]"}>
                      <td className="px-3 py-2"><input type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)} aria-label={`Select ${i.name}`} className="h-4 w-4 cursor-pointer accent-[#062444]" /></td>
                      <td className="px-2 py-2"><span className="flex items-center gap-2.5 font-semibold text-[#062444]">{i.kind === "folder" ? <Folder size={20} className="shrink-0 fill-amber-200 text-amber-700" aria-hidden="true" /> : <FileTypeIcon mime={i.mimeType} name={i.name} className="shrink-0" />}<span className="break-all">{i.name}</span>{i.kind === "folder" && <span className="shrink-0 text-[13px] font-normal text-slate-700">({countWords(i.itemCount, "file", "files")})</span>}</span></td>
                      <td className="px-3 py-2 text-slate-700">{i.location}</td><td className="px-3 py-2 text-slate-700">{formatBytes(i.sizeBytes)}</td>
                      <td className="px-3 py-2 text-slate-700">{new Date(i.deletedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</td>
                      <td className={`px-3 py-2 ${i.daysLeft <= 3 ? "font-bold text-red-800" : "text-slate-700"}`}>{trashCountdown(i.daysLeft)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      {confirm && (
        <ConfirmDialog title="Delete forever?" confirmLabel="Delete forever" danger onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            const r = await deleteForever(refs(confirm));
            if (!r.ok) return r.error;
            setConfirm(null);
            setMessage(`Deleted for good: ${countWords(r.value.deletedFiles, "file", "files")}.${r.value.leftInTrash ? ` ${countWords(r.value.leftInTrash, "file is", "files are")} still in the Trash because the storage could not remove ${r.value.leftInTrash === 1 ? "it" : "them"}; please try again.` : ""}`);
            await load(); onChanged();
            return null;
          }}>
          <p>{confirm.length === items?.length ? "Everything in the Trash" : countWords(confirm.length, "item", "items")} will be deleted <strong>for good</strong>, with all the files inside {confirm.some(i => i.kind === "folder") ? "the folders" : "it"}. This cannot be undone.</p>
          <p className="text-[13.5px] text-slate-700">Nobody, not even the IT admin, can bring them back afterwards.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
