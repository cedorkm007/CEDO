import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Folder, HardDrive, Loader2 } from "lucide-react";
import { ModalShell } from "@/sead/components/SeadUiShell";
import { fetchFolderTree, fetchSubtree } from "../storageToolOrganizeApi";
import { blockedMoveTargets, buildFolderTree, type TreeFolder, type TreeNode } from "../storageToolLogic";

/**
 * "Move to…" and "Copy to…": pick a folder of my storage (or the top). Folders that cannot be a target (the folders being moved and everything inside
 * them) are greyed out and cannot be chosen; the database refuses them too.
 */
export function FolderPickerModal({ mode, summary, movingFolderIds, startFolderId, root, onCancel, onPick }: {
  mode: "move" | "copy"; summary: string; movingFolderIds: string[]; startFolderId: string | null;
  /** Set when working inside a folder somebody shared with me: only that folder and what is inside it can be chosen (the top is the shared folder itself). */
  root?: { id: string; name: string };
  onCancel: () => void; onPick: (folderId: string | null) => Promise<string | null>;
}) {
  const [rows, setRows] = useState<TreeFolder[] | null>(null);
  const [error, setError] = useState("");
  const [chosen, setChosen] = useState<string | null>(root && startFolderId === root.id ? null : startFolderId);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const source = root
      ? fetchSubtree(root.id).then(s => (s.ok ? { ok: true as const, value: s.value.folders.filter(f => f.id !== root.id).map(f => ({ ...f, parentId: f.parentId === root.id ? null : f.parentId })) } : s))
      : fetchFolderTree();
    void source.then(r => {
      if (cancelled) return;
      if (!r.ok) { setError(r.error); return; }
      setRows(r.value);
      // open the path down to the folder the person is in
      const byId = new Map(r.value.map(x => [x.id, x]));
      const opened = new Set<string>();
      for (let cur = startFolderId ? byId.get(startFolderId) : undefined; cur?.parentId; cur = byId.get(cur.parentId)) opened.add(cur.parentId);
      setOpen(opened);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startFolderId, root?.id]);

  const tree = useMemo(() => buildFolderTree(rows ?? []), [rows]);
  const blocked = useMemo(() => blockedMoveTargets(rows ?? [], movingFolderIds), [rows, movingFolderIds]);
  const verb = mode === "move" ? "Move" : "Copy";

  async function go() {
    setBusy(true); setError("");
    const e = await onPick(root ? (chosen ?? root.id) : chosen);
    setBusy(false);
    if (e) setError(e);
  }
  const renderNode = (n: TreeNode, depth: number): React.ReactNode => {
    const isOpen = open.has(n.id), disabled = blocked.has(n.id);
    return (
      <li key={n.id}>
        <div className={`flex items-center gap-1 rounded-lg pr-2 ${chosen === n.id ? "bg-sky-100" : "hover:bg-[#f7f9fc]"}`} style={{ paddingLeft: depth * 18 + 4 }}>
          {n.children.length > 0
            ? <button onClick={() => setOpen(s => { const next = new Set(s); if (next.has(n.id)) next.delete(n.id); else next.add(n.id); return next; })} aria-label={`${isOpen ? "Hide" : "Show"} the folders inside ${n.name}`} aria-expanded={isOpen} className="rounded p-1 text-slate-700 hover:bg-slate-200">{isOpen ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}</button>
            : <span className="inline-block w-[23px]" />}
          <button disabled={disabled} onClick={() => setChosen(n.id)} aria-pressed={chosen === n.id} className={`flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left text-[14px] ${disabled ? "cursor-not-allowed text-slate-600" : "text-[#062444]"}`}>
            <Folder size={17} className={`shrink-0 ${disabled ? "text-slate-600" : "fill-amber-200 text-amber-700"}`} aria-hidden="true" /><span className="truncate">{n.name}</span>{disabled && <span className="shrink-0 text-[13px]">(being moved)</span>}
          </button>
        </div>
        {isOpen && n.children.length > 0 && <ul>{n.children.map(c => renderNode(c, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <ModalShell title={`${verb} ${summary}`} onClose={busy ? () => undefined : onCancel} wide>
      <p className="text-[14px] text-slate-800">Choose the folder to {mode} to:</p>
      {rows === null && !error && <p className="flex items-center gap-2 text-[14px] text-slate-700"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading the folders…</p>}
      {rows !== null && (
        <ul className="max-h-72 overflow-y-auto rounded-lg border border-[#e6ecf5] p-1.5" aria-label={root ? "Folders in the shared folder" : "Your folders"}>
          <li>
            <button onClick={() => setChosen(null)} aria-pressed={chosen === null} className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[14px] font-bold text-[#062444] ${chosen === null ? "bg-sky-100" : "hover:bg-[#f7f9fc]"}`}><HardDrive size={17} aria-hidden="true" /> {root ? `${root.name} (the shared folder)` : "My storage (the top)"}</button>
          </li>
          {tree.map(n => renderNode(n, 0))}
        </ul>
      )}
      {error && <p role="alert" className="text-[14px] text-red-700">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} disabled={busy} className="rounded-lg border border-[#062444]/25 px-4 py-2 text-[14px] font-semibold text-[#062444]">Cancel</button>
        <button onClick={() => void go()} disabled={busy || rows === null} className="inline-flex items-center gap-2 rounded-lg bg-[#062444] px-4 py-2 text-[14px] font-bold text-white disabled:opacity-60">{busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />} {verb} here</button>
      </div>
    </ModalShell>
  );
}
