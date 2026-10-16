import { useCallback, useEffect, useState } from "react";
import { Activity, FileUp, Folder, FolderPlus, Link2, Loader2, Pencil, Share2, Trash2, Undo2, UserCog, X } from "lucide-react";
import { fetchActivity } from "../storageToolAdminApi";
import { dayHeading, describeActivity, type ActivityItem } from "../storageToolLogic";

const timeText = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function iconFor(action: string) {
  const cls = "shrink-0 text-[#062444]";
  if (action === "file_uploaded") return <FileUp size={18} className={cls} aria-hidden="true" />;
  if (action === "folder_created") return <FolderPlus size={18} className={cls} aria-hidden="true" />;
  if (action === "renamed" || action === "moved") return <Pencil size={18} className={cls} aria-hidden="true" />;
  if (action === "trashed" || action === "deleted_forever" || action === "purged") return <Trash2 size={18} className="shrink-0 text-red-800" aria-hidden="true" />;
  if (action === "restored") return <Undo2 size={18} className={cls} aria-hidden="true" />;
  if (action.startsWith("share")) return <Share2 size={18} className={cls} aria-hidden="true" />;
  if (action.startsWith("link")) return <Link2 size={18} className={cls} aria-hidden="true" />;
  if (action === "handed_over") return <UserCog size={18} className={cls} aria-hidden="true" />;
  return <Folder size={18} className={cls} aria-hidden="true" />;
}

/**
 * The activity list: everything that happened in MY storage, by me, by colleagues I shared with, and by visitors of my upload links, newest first, grouped
 * by day. Only the owner sees it. `folder` limits it to one folder (and everything inside it).
 */
export function ActivityView({ folder, onShowAll }: { folder: { id: string; name: string } | null; onShowAll: () => void }) {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const folderId = folder?.id ?? null;

  const load = useCallback(async () => {
    const r = await fetchActivity(folderId);
    if (!r.ok) { setError(r.error); return; }
    setError(""); setItems(r.value.items); setHasMore(r.value.hasMore);
  }, [folderId]);
  useEffect(() => { setItems(null); void load(); }, [load]);

  async function more() {
    if (!items || items.length === 0) return;
    setLoadingMore(true);
    const r = await fetchActivity(folderId, items[items.length - 1].at);
    setLoadingMore(false);
    if (!r.ok) { setError(r.error); return; }
    setItems([...items, ...r.value.items]); setHasMore(r.value.hasMore);
  }

  const groups: { day: string; lines: ActivityItem[] }[] = [];
  for (const it of items ?? []) {
    const day = dayHeading(it.at), last = groups[groups.length - 1];
    if (last && last.day === day) last.lines.push(it); else groups.push({ day, lines: [it] });
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[14px] text-slate-800">Everything that happened in your storage: what you did, what colleagues you shared with did, and what visitors of your upload links sent. Only you can see this.</p>
        {folder && (
          <p className="inline-flex items-center gap-2 rounded-lg bg-sky-50 px-3 py-1.5 text-[14px] font-bold text-sky-950">Only “{folder.name}”
            <button onClick={onShowAll} aria-label="Show everything again" className="rounded p-0.5 hover:bg-sky-100"><X size={15} aria-hidden="true" /></button></p>
        )}
      </div>
      {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-[14px] text-red-800">{error}</p>}
      {items === null && !error ? <p className="flex items-center gap-2 py-8 text-[14px] text-slate-700"><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Loading…</p>
        : items && items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[#062444]/30 bg-[#f7f9fc] px-6 py-12 text-center">
            <Activity size={36} className="text-[#062444]" aria-hidden="true" /><p className="text-[16px] font-bold text-[#062444]">Nothing has happened yet</p>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map(g => (
              <section key={g.day} aria-label={g.day}>
                <h2 className="mb-1.5 text-[14px] font-bold text-[#062444]">{g.day}</h2>
                <ul className="divide-y divide-[#e6ecf5] rounded-xl border border-[#e6ecf5] bg-white">
                  {g.lines.map(l => (
                    <li key={l.id} className="flex items-start gap-3 px-4 py-2.5 text-[14px]">
                      <span className="mt-0.5">{iconFor(l.action)}</span>
                      <span className="min-w-0 flex-1"><span className="break-words text-slate-900">{describeActivity(l)}</span>
                        {l.location && ["file_uploaded", "folder_created", "moved", "restored", "trashed"].includes(l.action) && <span className="block text-slate-700">in {l.location}</span>}</span>
                      <span className="shrink-0 text-slate-700">{timeText(l.at)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {hasMore && <div className="text-center"><button onClick={() => void more()} disabled={loadingMore} className="inline-flex items-center gap-2 rounded-lg border border-[#062444]/40 bg-white px-4 py-2 text-[14px] font-bold text-[#062444] hover:bg-[#f7f9fc] disabled:opacity-60">{loadingMore && <Loader2 size={14} className="animate-spin" aria-hidden="true" />} Show older</button></div>}
          </div>
        )}
    </div>
  );
}
