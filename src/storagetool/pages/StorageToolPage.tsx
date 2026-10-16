import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronRight, Folder, FolderPlus, FolderUp, HardDrive, Home, LayoutGrid, List as ListIcon, Loader2, MoreVertical, Upload, UploadCloud } from "lucide-react";
import { ModalShell } from "@/sead/components/SeadUiShell";
import {
  createFolder, fetchFolderContents, fetchFolderPath, fetchUsage, fileLink, findOrCreateFolder,
  type PathEntry, type StorageUsage,
} from "../storageToolApi";
import {
  formatBytes, planUpload, sortFiles, sortFolders, typeLabel,
  type ListedFile, type ListedFolder, type PickedFile, type SortKey,
} from "../storageToolLogic";
import { collectDropped, collectFromInput } from "../dropCollect";
import { uploadFile } from "../uploader";
import { FileTypeIcon } from "../components/FileTypeIcon";
import { PreviewModal } from "../components/PreviewModal";
import { UploadTray, type UploadJob } from "../components/UploadTray";

const DEFAULT_MAX_BYTES = 500 * 1024 * 1024;
const PARALLEL_UPLOADS = 3;
const VIEW_KEY = "storage-tool-view";

const dateText = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
function savedView(): "grid" | "list" { try { return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid"; } catch { return "grid"; } }

/**
 * "Storage Tool" — a person's own private storage, like a drive: folders inside folders, upload by button or drag and drop (files and whole folders),
 * a progress bar per file with Cancel, grid or list view, preview in the page, download. Only people with the "Storage Tool" tag (and the IT admin)
 * can open it, and the database lets each person see only their own folders and files. See supabase_migration_storage_tool_p1.sql.
 */
export function StorageToolPage() {
  const [folderId, setFolderId] = useState<string | null>(null);
  const [path, setPath] = useState<PathEntry[]>([]);
  const [folders, setFolders] = useState<ListedFolder[]>([]);
  const [files, setFiles] = useState<ListedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [view, setView] = useState<"grid" | "list">(savedView);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [preview, setPreview] = useState<ListedFile | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [jobs, setJobs] = useState<UploadJob[]>([]);

  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const folderIdRef = useRef<string | null>(null);
  folderIdRef.current = folderId;
  const controllers = useRef(new Map<string, AbortController>());
  const pending = useRef<{ job: string; start: () => Promise<void> }[]>([]);
  const running = useRef(0);
  const refreshTimer = useRef<number | null>(null);

  const maxBytes = usage?.maxFileBytes || DEFAULT_MAX_BYTES;
  const maxBytesRef = useRef(maxBytes);
  maxBytesRef.current = maxBytes;

  const load = useCallback(async (id: string | null) => {
    const [contents, where] = await Promise.all([fetchFolderContents(id), fetchFolderPath(id)]);
    if (!contents.ok) { setError(contents.error); setLoading(false); return; }
    if (!where.ok) { setError(where.error); setLoading(false); return; }
    if (id !== folderIdRef.current) return;   // the person already moved on
    setError(""); setFolders(contents.value.folders); setFiles(contents.value.files); setPath(where.value); setLoading(false);
  }, []);
  const refreshUsage = useCallback(async () => { const u = await fetchUsage(); if (u.ok) setUsage(u.value); }, []);

  useEffect(() => { setLoading(true); setPreview(null); void load(folderId); }, [folderId, load]);
  useEffect(() => { void refreshUsage(); }, [refreshUsage]);
  useEffect(() => () => { if (refreshTimer.current) window.clearTimeout(refreshTimer.current); }, []);
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view); } catch { /* private window: keep it for this visit only */ } }, [view]);
  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuFor]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => { void load(folderIdRef.current); void refreshUsage(); }, 400);
  }, [load, refreshUsage]);

  // ── Uploading ──
  const patchJob = useCallback((id: string, patch: Partial<UploadJob>) => setJobs(list => list.map(j => (j.id === id ? { ...j, ...patch } : j))), []);
  const pump = useCallback(() => {
    while (running.current < PARALLEL_UPLOADS && pending.current.length > 0) {
      const next = pending.current.shift()!;
      running.current++;
      void next.start().finally(() => { running.current--; pump(); });
    }
  }, []);

  const startUploads = useCallback(async (picked: PickedFile[]) => {
    if (picked.length === 0) return;
    const rootId = folderIdRef.current;
    const rootLabel = ["My storage", ...path.map(p => p.name)].join(" / ");
    const plan = planUpload(picked, maxBytesRef.current);
    setNotice(plan.skipped.length ? plan.skipped.slice(0, 3).join(" ") + (plan.skipped.length > 3 ? ` (and ${plan.skipped.length - 3} more were skipped.)` : "") : "");
    if (plan.files.length === 0) return;
    const made = plan.files.map(f => ({ id: crypto.randomUUID(), planned: f }));
    setJobs(list => [...list.filter(j => j.status === "waiting" || j.status === "uploading"), ...made.map(m => ({
      id: m.id, name: [...m.planned.dirs, m.planned.name].join(" / "), size: m.planned.file.size, where: [rootLabel, ...m.planned.dirs].join(" / "), status: "waiting" as const, progress: 0,
    }))]);
    // The folders of a whole-folder upload are made first (each once); a folder that already exists is used as it is.
    const dirIds = new Map<string, string | null>([["", rootId]]);   // a folder that could not be made is simply missing from this map
    let folderFailure = "";
    for (const dirs of plan.dirs) {
      const key = dirs.join("\u0000"), parentKey = dirs.slice(0, -1).join("\u0000");
      if (!dirIds.has(parentKey) || folderFailure) continue;
      const r = await findOrCreateFolder(dirIds.get(parentKey) ?? null, dirs[dirs.length - 1]);
      if (r.ok) dirIds.set(key, r.value); else folderFailure = r.error;
    }
    for (const m of made) {
      const key = m.planned.dirs.join("\u0000");
      if (!dirIds.has(key)) { patchJob(m.id, { status: "error", error: folderFailure || "The folder could not be made." }); continue; }
      const target = dirIds.get(key) ?? null;
      pending.current.push({
        job: m.id,
        start: async () => {
          const controller = new AbortController();
          controllers.current.set(m.id, controller);
          if (controller.signal.aborted) return;
          patchJob(m.id, { status: "uploading", progress: 0 });
          const r = await uploadFile(m.planned.file, target, m.planned.name, percent => patchJob(m.id, { progress: percent }), controller.signal);
          controllers.current.delete(m.id);
          if (r.ok) patchJob(m.id, { status: "done", progress: 100 });
          else if (r.cancelled) patchJob(m.id, { status: "cancelled" });
          else patchJob(m.id, { status: "error", error: r.error });
          scheduleRefresh();
        },
      });
    }
    scheduleRefresh();
    pump();
  }, [path, patchJob, pump, scheduleRefresh]);

  const cancelJob = useCallback((id: string) => {
    const waiting = pending.current.findIndex(p => p.job === id);
    if (waiting >= 0) { pending.current.splice(waiting, 1); patchJob(id, { status: "cancelled" }); return; }
    controllers.current.get(id)?.abort();
  }, [patchJob]);
  const cancelAll = useCallback(() => { for (const p of [...pending.current]) cancelJob(p.job); for (const id of [...controllers.current.keys()]) cancelJob(id); }, [cancelJob]);

  // ── Dropping on the page ──
  const onDragEnter = (e: React.DragEvent) => { if (Array.from(e.dataTransfer.types).includes("Files")) { dragDepth.current++; setDragging(true); } };
  const onDragLeave = () => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragging(false); };
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault(); dragDepth.current = 0; setDragging(false);
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    await startUploads(await collectDropped(e.dataTransfer));
  };

  async function download(file: ListedFile) {
    const r = await fileLink(file.storagePath, file.name);
    if (!r.ok) { setError(r.error); return; }
    const a = document.createElement("a");
    a.href = r.value; a.download = file.name; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
  }

  const shownFolders = useMemo(() => sortFolders(folders, sortKey, sortDir), [folders, sortKey, sortDir]);
  const shownFiles = useMemo(() => sortFiles(files, sortKey, sortDir), [files, sortKey, sortDir]);
  const empty = !loading && folders.length === 0 && files.length === 0;
  const quotaPercent = usage && usage.quotaBytes > 0 ? Math.min(100, Math.round((usage.totalBytes / usage.quotaBytes) * 100)) : 0;
  const here = path.length ? path[path.length - 1].name : "My storage";

  const sortHeader = (key: SortKey, label: string) => (
    <button onClick={() => { if (sortKey === key) setSortDir(d => (d === "asc" ? "desc" : "asc")); else { setSortKey(key); setSortDir("asc"); } }}
      aria-label={`Sort by ${label}${sortKey === key ? (sortDir === "asc" ? ", ascending" : ", descending") : ""}`} className="inline-flex items-center gap-1 font-bold text-[#062444] hover:underline">
      {label} {sortKey === key && (sortDir === "asc" ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" />)}
    </button>
  );
  const menu = (id: string, items: { label: string; run: () => void }[]) => (
    <div className="relative" onClick={e => e.stopPropagation()}>
      <button onClick={() => setMenuFor(menuFor === id ? null : id)} aria-label="More actions" aria-haspopup="menu" aria-expanded={menuFor === id} className="rounded p-1.5 text-slate-700 hover:bg-[#f7f9fc]"><MoreVertical size={17} aria-hidden="true" /></button>
      {menuFor === id && (
        <ul role="menu" className="absolute right-0 z-20 mt-1 w-40 rounded-lg border border-[#e6ecf5] bg-white py-1 shadow-lg">
          {items.map(i => <li key={i.label} role="none"><button role="menuitem" onClick={() => { setMenuFor(null); i.run(); }} className="block w-full px-3 py-1.5 text-left text-[14px] text-[#062444] hover:bg-[#f7f9fc]">{i.label}</button></li>)}
        </ul>
      )}
    </div>
  );

  return (
    <div onDragEnter={onDragEnter} onDragLeave={onDragLeave} onDragOver={e => { if (Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault(); }} onDrop={e => void onDrop(e)} className="relative min-h-[60vh]">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-foreground"><HardDrive size={22} aria-hidden="true" /> Storage Tool</h1>
          <p className="text-sm text-slate-700">Your own private storage. Only you can see what is here.</p>
        </div>
        {usage && (
          <div className="min-w-[14rem] rounded-xl border border-[#e6ecf5] bg-[#f7f9fc] px-4 py-2.5 text-[14px]">
            <p className="text-[#062444]"><strong>You use {formatBytes(usage.mineBytes)}</strong> in {usage.mineFiles} file{usage.mineFiles === 1 ? "" : "s"}</p>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={quotaPercent} aria-label="Space used by everybody">
              <div className={`h-full rounded-full ${quotaPercent >= 90 ? "bg-red-700" : "bg-[#00709f]"}`} style={{ width: `${Math.max(quotaPercent, usage.totalBytes > 0 ? 2 : 0)}%` }} />
            </div>
            <p className="mt-1 text-slate-700">All staff together: {formatBytes(usage.totalBytes)} of {formatBytes(usage.quotaBytes)}</p>
          </div>
        )}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button onClick={() => setNewFolderOpen(true)} className="inline-flex items-center gap-2 rounded-lg border border-[#062444]/40 bg-white px-4 py-2 text-[14px] font-bold text-[#062444] hover:bg-[#f7f9fc]"><FolderPlus size={16} aria-hidden="true" /> New folder</button>
        <button onClick={() => fileInput.current?.click()} className="inline-flex items-center gap-2 rounded-lg bg-[#062444] px-4 py-2 text-[14px] font-bold text-white hover:bg-[#0a3a6e]"><Upload size={16} aria-hidden="true" /> Upload files</button>
        <button onClick={() => folderInput.current?.click()} className="inline-flex items-center gap-2 rounded-lg border border-[#062444]/40 bg-white px-4 py-2 text-[14px] font-bold text-[#062444] hover:bg-[#f7f9fc]"><FolderUp size={16} aria-hidden="true" /> Upload folder</button>
        <input ref={fileInput} type="file" multiple className="sr-only" aria-label="Choose files to upload" tabIndex={-1} onChange={e => { void startUploads(collectFromInput(e.target.files)); e.target.value = ""; }} />
        <input ref={folderInput} type="file" multiple className="sr-only" aria-label="Choose a folder to upload" tabIndex={-1} {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} onChange={e => { void startUploads(collectFromInput(e.target.files)); e.target.value = ""; }} />
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[14px] text-slate-800">Sort by
            <select value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)} className="rounded-lg border border-[#062444]/25 bg-white px-2 py-1.5 text-[14px]">
              <option value="name">Name</option><option value="date">Date</option><option value="size">Size</option><option value="type">Type</option>
            </select>
          </label>
          <button onClick={() => setSortDir(d => (d === "asc" ? "desc" : "asc"))} aria-label={sortDir === "asc" ? "Ascending: press for descending" : "Descending: press for ascending"} className="rounded-lg border border-[#062444]/25 bg-white p-2 text-[#062444] hover:bg-[#f7f9fc]">{sortDir === "asc" ? <ArrowUp size={15} aria-hidden="true" /> : <ArrowDown size={15} aria-hidden="true" />}</button>
          <div className="inline-flex overflow-hidden rounded-lg border border-[#062444]/25" role="group" aria-label="View">
            <button onClick={() => setView("grid")} aria-pressed={view === "grid"} aria-label="Grid view" className={`p-2 ${view === "grid" ? "bg-[#062444] text-white" : "bg-white text-[#062444] hover:bg-[#f7f9fc]"}`}><LayoutGrid size={16} aria-hidden="true" /></button>
            <button onClick={() => setView("list")} aria-pressed={view === "list"} aria-label="List view" className={`p-2 ${view === "list" ? "bg-[#062444] text-white" : "bg-white text-[#062444] hover:bg-[#f7f9fc]"}`}><ListIcon size={16} aria-hidden="true" /></button>
          </div>
        </div>
      </div>

      <nav aria-label="Where you are" className="mb-3 flex flex-wrap items-center gap-1 text-[14px]">
        <button onClick={() => setFolderId(null)} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold hover:underline ${path.length === 0 ? "text-[#062444]" : "text-[#00709f]"}`} aria-current={path.length === 0 ? "page" : undefined}><Home size={14} aria-hidden="true" /> My storage</button>
        {path.map((p, i) => (
          <span key={p.id} className="inline-flex items-center gap-1">
            <ChevronRight size={14} className="text-slate-600" aria-hidden="true" />
            <button onClick={() => setFolderId(p.id)} aria-current={i === path.length - 1 ? "page" : undefined} className={`rounded px-1.5 py-0.5 font-semibold hover:underline ${i === path.length - 1 ? "text-[#062444]" : "text-[#00709f]"}`}>{p.name}</button>
          </span>
        ))}
      </nav>

      {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-[14px] text-red-800">{error}</p>}
      {notice && <p role="status" className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[14px] text-amber-950">{notice}</p>}

      {loading ? <p className="flex items-center gap-2 py-10 text-[14px] text-slate-700"><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Loading…</p>
        : empty ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[#062444]/30 bg-[#f7f9fc] px-6 py-14 text-center">
            <UploadCloud size={40} className="text-[#062444]" aria-hidden="true" />
            <p className="text-[16px] font-bold text-[#062444]">{path.length ? "This folder is empty" : "Your storage is empty"}</p>
            <p className="text-[14px] text-slate-700">Drag files or a whole folder here, or press “Upload files”. Biggest file: {formatBytes(maxBytes)}.</p>
          </div>
        ) : view === "grid" ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {shownFolders.map(f => (
              <li key={f.id} className="flex items-center justify-between gap-1 rounded-xl border border-[#e6ecf5] bg-white px-3 py-3 hover:border-[#062444]/40">
                <button onClick={() => setFolderId(f.id)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left" aria-label={`Open the folder ${f.name}`}>
                  <Folder size={22} className="shrink-0 fill-amber-200 text-amber-700" aria-hidden="true" /><span className="truncate text-[14px] font-bold text-[#062444]" title={f.name}>{f.name}</span>
                </button>
                {menu(`f${f.id}`, [{ label: "Open", run: () => setFolderId(f.id) }])}
              </li>
            ))}
            {shownFiles.map(f => (
              <li key={f.id} className="flex flex-col rounded-xl border border-[#e6ecf5] bg-white hover:border-[#062444]/40">
                <button onClick={() => setPreview(f)} className="flex flex-1 flex-col items-center gap-2 px-3 pb-2 pt-5 text-center" aria-label={`Open ${f.name}`}>
                  <FileTypeIcon mime={f.mimeType} name={f.name} size={34} />
                  <span className="line-clamp-2 break-all text-[14px] font-semibold text-[#062444]" title={f.name}>{f.name}</span>
                </button>
                <div className="flex items-center justify-between border-t border-[#e6ecf5] pl-3 pr-1 text-[13px] text-slate-700">
                  <span>{formatBytes(f.sizeBytes)}</span>
                  {menu(`x${f.id}`, [{ label: "Open", run: () => setPreview(f) }, { label: "Download", run: () => void download(f) }])}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#e6ecf5] bg-white">
            <table className="w-full text-left text-[14px]">
              <thead className="bg-[#f7f9fc]"><tr><th className="px-4 py-2.5">{sortHeader("name", "Name")}</th><th className="px-3 py-2.5">{sortHeader("type", "Type")}</th><th className="px-3 py-2.5">{sortHeader("size", "Size")}</th><th className="px-3 py-2.5">{sortHeader("date", "Modified")}</th><th className="w-12 px-2 py-2.5"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody className="divide-y divide-[#e6ecf5]">
                {shownFolders.map(f => (
                  <tr key={f.id} className="hover:bg-[#f7f9fc]">
                    <td className="px-4 py-2"><button onClick={() => setFolderId(f.id)} className="flex items-center gap-2.5 text-left font-bold text-[#062444]" aria-label={`Open the folder ${f.name}`}><Folder size={20} className="shrink-0 fill-amber-200 text-amber-700" aria-hidden="true" /><span className="break-all">{f.name}</span></button></td>
                    <td className="px-3 py-2 text-slate-700">Folder</td><td className="px-3 py-2 text-slate-700">—</td><td className="px-3 py-2 text-slate-700">{dateText(f.updatedAt)}</td>
                    <td className="px-2 py-2">{menu(`f${f.id}`, [{ label: "Open", run: () => setFolderId(f.id) }])}</td>
                  </tr>
                ))}
                {shownFiles.map(f => (
                  <tr key={f.id} className="hover:bg-[#f7f9fc]">
                    <td className="px-4 py-2"><button onClick={() => setPreview(f)} className="flex items-center gap-2.5 text-left font-semibold text-[#062444]" aria-label={`Open ${f.name}`}><FileTypeIcon mime={f.mimeType} name={f.name} className="shrink-0" /><span className="break-all">{f.name}</span></button></td>
                    <td className="px-3 py-2 text-slate-700">{typeLabel(f.mimeType, f.name)}</td><td className="px-3 py-2 text-slate-700">{formatBytes(f.sizeBytes)}</td><td className="px-3 py-2 text-slate-700">{dateText(f.modifiedAt)}</td>
                    <td className="px-2 py-2">{menu(`x${f.id}`, [{ label: "Open", run: () => setPreview(f) }, { label: "Download", run: () => void download(f) }])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-2xl border-4 border-dashed border-[#00709f] bg-white/85">
          <p className="flex items-center gap-2 text-[17px] font-bold text-[#062444]"><UploadCloud size={24} aria-hidden="true" /> Drop to upload into “{here}”</p>
        </div>
      )}

      {preview && <PreviewModal file={preview} onClose={() => setPreview(null)} />}
      {newFolderOpen && <NewFolderModal parentId={folderId} onClose={() => setNewFolderOpen(false)} onCreated={() => { setNewFolderOpen(false); void load(folderIdRef.current); }} />}
      <UploadTray jobs={jobs} onCancel={cancelJob} onCancelAll={cancelAll} onClear={() => setJobs([])} />
    </div>
  );
}

function NewFolderModal({ parentId, onClose, onCreated }: { parentId: string | null; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("New folder");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Please type a name."); return; }
    setBusy(true); setError("");
    const r = await createFolder(parentId, name);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    onCreated();
  }
  return (
    <ModalShell title="New folder" onClose={onClose}>
      <form onSubmit={e => void save(e)} className="space-y-3">
        <label className="block text-[14px] font-semibold text-[#062444]">Folder name
          <input ref={input} value={name} onChange={e => setName(e.target.value)} maxLength={255} className="mt-1 w-full rounded-lg border border-[#062444]/25 px-3 py-2 text-[14px] font-normal outline-none focus:border-[#062444]" />
        </label>
        <p className="text-[13.5px] text-slate-700">If a folder with this name is already here, a number is added: “New folder (1)”.</p>
        {error && <p role="alert" className="text-[14px] text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-[#062444]/25 px-4 py-2 text-[14px] font-semibold text-[#062444]">Cancel</button>
          <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-[#062444] px-4 py-2 text-[14px] font-bold text-white disabled:opacity-60">{busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />} Create</button>
        </div>
      </form>
    </ModalShell>
  );
}
