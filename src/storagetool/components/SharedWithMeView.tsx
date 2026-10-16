import { useCallback, useEffect, useState } from "react";
import { Folder, Loader2, Users } from "lucide-react";
import { PERMISSION_TEXT, fetchSharedWithMe, removeShare, type SharedItem } from "../storageToolShareApi";
import { formatBytes } from "../storageToolLogic";
import { supabase } from "@/lib/supabase";
import { ConfirmDialog } from "./Dialogs";
import { FileTypeIcon } from "./FileTypeIcon";

const dateText = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

/** What other staff shared with me: the folders and files (newest first). A folder opens like one of my own; "Remove" takes it off my list (the owner keeps it). */
export function SharedWithMeView({ onOpenFolder, onOpenFile, refreshKey }: { onOpenFolder: (id: string) => void; onOpenFile: (item: SharedItem) => void; refreshKey: number }) {
  const [items, setItems] = useState<SharedItem[] | null>(null);
  const [error, setError] = useState("");
  const [leaving, setLeaving] = useState<SharedItem | null>(null);

  const load = useCallback(async () => {
    const r = await fetchSharedWithMe();
    if (!r.ok) { setError(r.error); return; }
    setError(""); setItems(r.value);
  }, []);
  useEffect(() => { void load(); }, [load, refreshKey]);

  return (
    <div>
      <p className="mb-3 text-[14px] text-slate-800">Folders and files that colleagues shared with you. What you may do depends on what each person allowed.</p>
      {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-[14px] text-red-800">{error}</p>}
      {items === null && !error ? <p className="flex items-center gap-2 py-8 text-[14px] text-slate-700"><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Loading…</p>
        : items && items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[#062444]/30 bg-[#f7f9fc] px-6 py-12 text-center">
            <Users size={36} className="text-[#062444]" aria-hidden="true" /><p className="text-[16px] font-bold text-[#062444]">Nothing has been shared with you yet</p>
            <p className="text-[14px] text-slate-700">When a colleague shares something, it appears here and you get a notification.</p>
          </div>
        ) : items && (
          <div className="relative overflow-x-auto rounded-xl border border-[#e6ecf5] bg-white">
            <table className="w-full text-left text-[14px]">
              <thead className="bg-[#f7f9fc] text-[#062444]"><tr><th className="px-4 py-2.5 font-bold">Name</th><th className="px-3 py-2.5 font-bold">Shared by</th><th className="px-3 py-2.5 font-bold">You can</th><th className="px-3 py-2.5 font-bold">Size</th><th className="px-3 py-2.5 font-bold">Shared on</th><th className="w-24 px-3 py-2.5"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody className="divide-y divide-[#e6ecf5]">
                {items.map(i => (
                  <tr key={`${i.kind}-${i.id}`} className="hover:bg-[#f7f9fc]">
                    <td className="px-4 py-2">
                      <button onClick={() => (i.kind === "folder" ? onOpenFolder(i.id) : onOpenFile(i))} aria-label={i.kind === "folder" ? `Open the folder ${i.name}` : `Open ${i.name}`} className="flex items-center gap-2.5 text-left font-bold text-[#062444]">
                        {i.kind === "folder" ? <Folder size={20} className="shrink-0 fill-amber-200 text-amber-700" aria-hidden="true" /> : <FileTypeIcon mime={i.mimeType} name={i.name} className="shrink-0" />}<span className="break-all">{i.name}</span>
                      </button>
                    </td>
                    <td className="px-3 py-2 text-slate-700">{i.ownerName}</td><td className="px-3 py-2 text-slate-700">{PERMISSION_TEXT[i.permission].replace(/^Can /, "")}</td>
                    <td className="px-3 py-2 text-slate-700">{i.kind === "folder" ? "—" : formatBytes(i.sizeBytes)}</td><td className="px-3 py-2 text-slate-700">{dateText(i.sharedAt)}</td>
                    <td className="px-3 py-2"><button onClick={() => setLeaving(i)} aria-label={`Remove ${i.name} from my list`} className="font-semibold text-[#00709f] hover:underline">Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {leaving && (
        <ConfirmDialog title="Remove from your list?" confirmLabel="Remove" onCancel={() => setLeaving(null)}
          onConfirm={async () => {
            const me = (await supabase.auth.getSession()).data.session?.user.id;
            if (!me) return "You are signed out. Please sign in again.";
            const r = await removeShare(leaving.kind, leaving.id, me);
            if (!r.ok) return r.error;
            setLeaving(null); await load(); return null;
          }}>
          <p>“{leaving.name}” will disappear from your “Shared with me” list. {leaving.ownerName} still has it, and can share it with you again.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
