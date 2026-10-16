import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronRight, Copy, Download, FolderInput, FolderPlus, FolderUp, HardDrive, Home, Info, LayoutGrid, Link2, List as ListIcon, Loader2, Search, Share2, Trash2, Upload, UploadCloud, Users, X } from "lucide-react";
import { ModalShell } from "@/sead/components/SeadUiShell";
import { createFolder, fetchUsage, fileLink, findOrCreateFolder, type PathEntry, type StorageUsage } from "../storageToolApi";
import { fetchDetails, moveItems, renameItem, searchItems, trashItems, type SearchHit } from "../storageToolOrganizeApi";
import { LEVEL_TEXT, fetchBrowse, type AccessLevel, type SharedItem } from "../storageToolShareApi";
import {
  countWords, formatBytes, itemKey, parseItemKey, planUpload, sortFiles, sortFolders, typeLabel,
  type ItemKind, type ItemRef, type ListedFile, type ListedFolder, type PickedFile, type SortKey,
} from "../storageToolLogic";
import { collectDropped, collectFromInput } from "../dropCollect";
import { uploadFile } from "../uploader";
import { copyItems, type CopySource } from "../copyItems";
import { collectZipEntries, downloadAsZip, type ZipSource } from "../zipDownload";
import { FileTypeIcon } from "../components/FileTypeIcon";
import { PreviewModal } from "../components/PreviewModal";
import { UploadTray, type UploadJob } from "../components/UploadTray";
import { ItemViews, type Entry, type MenuAction } from "../components/ItemViews";
import { ConfirmDialog, RenameDialog } from "../components/Dialogs";
import { FolderPickerModal } from "../components/FolderPickerModal";
import { DetailsPanel } from "../components/DetailsPanel";
import { TrashView } from "../components/TrashView";
import { ShareDialog } from "../components/ShareDialog";
import { LinkManager } from "../components/LinkManager";
import { SharedWithMeView } from "../components/SharedWithMeView";

const DEFAULT_MAX_BYTES = 500 * 1024 * 1024;
const PARALLEL_UPLOADS = 3;
const VIEW_KEY = "storage-tool-view";
const DRAG_TYPE = "application/x-storage-tool-items";

const dateText = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
function savedView(): "grid" | "list" { try { return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid"; } catch { return "grid"; } }

/**
 * "Storage Tool" — a person's own private storage, like a drive: folders inside folders, upload by button or drag and drop (files and whole folders),
 * rename, move (also by dragging), copy, search, details, delete to a Trash with Restore, download of files, folders or several items as a ZIP,
 * grid or list view, preview in the page. Only people with the "Storage Tool" tag (and the IT admin) can open it, and the database lets each person
 * see only their own folders and files. Phase 3: share with other staff (view / add files / edit, chosen per person; shown under "Shared with me")
 * and upload links for people outside CEDO. See supabase_migration_storage_tool_p1.sql, _p2.sql and _p3.sql.
 */
export function StorageToolPage() {
  const [mode, setMode] = useState<"files" | "shared" | "links" | "trash">("files");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [level, setLevel] = useState<AccessLevel>(4);          // what I may do here: 4 = my own, 3 = edit, 2 = add files, 1 = look only
  const [ownerName, setOwnerName] = useState("");
  const [shareFor, setShareFor] = useState<{ kind: ItemKind; id: string; name: string } | null>(null);
  const [sharedKey, setSharedKey] = useState(0);
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsKey, setDetailsKey] = useState(0);
  const [rename, setRename] = useState<Entry | null>(null);
  const [picker, setPicker] = useState<{ mode: "move" | "copy"; entries: Entry[] } | null>(null);
  const [trashAsk, setTrashAsk] = useState<Entry[] | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const folderIdRef = useRef<string | null>(null);
  folderIdRef.current = folderId;
  const controllers = useRef(new Map<string, AbortController>());
  const pending = useRef<{ job: string; start: () => Promise<void> }[]>([]);
  const running = useRef(0);
  const refreshTimer = useRef<number | null>(null);
  const draggedKeys = useRef<string[]>([]);

  const maxBytes = usage?.maxFileBytes || DEFAULT_MAX_BYTES;
  const maxBytesRef = useRef(maxBytes);
  maxBytesRef.current = maxBytes;
  const inBrowse = mode === "files" || (mode === "shared" && folderId !== null);   // looking at the inside of a folder (mine or shared with me)
  const canAdd = inBrowse && level >= 2;                                           // upload and make folders
  const canEdit = inBrowse && level >= 3;                                          // rename, move, delete
  const isOwner = mode === "files";
  const sharedRoot = mode === "shared" && path.length > 0 ? path[0] : null;       // the folder that was shared with me (the top of what I can see)

  const load = useCallback(async (id: string | null) => {
    const r = await fetchBrowse(id);
    if (id !== folderIdRef.current) return;   // the person already moved on
    if (!r.ok) { setError(r.error); setLoading(false); return; }
    setError(""); setFolders(r.value.folders); setFiles(r.value.files); setPath(r.value.path); setLevel(r.value.level); setOwnerName(r.value.ownerName); setLoading(false);
    setSelected(prev => { const alive = new Set([...r.value.folders.map(f => itemKey("folder", f.id)), ...r.value.files.map(f => itemKey("file", f.id))]); const next = new Set([...prev].filter(k => alive.has(k))); return next.size === prev.size ? prev : next; });
  }, []);
  const refreshUsage = useCallback(async () => { const u = await fetchUsage(); if (u.ok) setUsage(u.value); }, []);
  const reloadAll = useCallback(() => { void load(folderIdRef.current); void refreshUsage(); setDetailsKey(k => k + 1); }, [load, refreshUsage]);

  useEffect(() => {
    setPreview(null); setSelected(new Set());
    if (mode !== "files" && !(mode === "shared" && folderId !== null)) return;   // those tabs show their own lists
    setLoading(true); void load(folderId);
  }, [folderId, mode, load]);
  const goTab = (m: "files" | "shared" | "links" | "trash") => { setMode(m); setFolderId(null); setQuery(""); setError(""); setNotice(""); setFolders([]); setFiles([]); setPath([]); setLevel(4); setDetailsOpen(false); };
  useEffect(() => { void refreshUsage(); }, [refreshUsage]);
  useEffect(() => () => { if (refreshTimer.current) window.clearTimeout(refreshTimer.current); }, []);
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view); } catch { /* private window: keep it for this visit only */ } }, [view]);
  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuFor]);
  // search: after a short pause, 2 letters or more
  useEffect(() => {
    if (query.trim().length < 2) { setHits(null); return; }
    let cancelled = false;
    const timer = window.setTimeout(async () => { const r = await searchItems(query); if (!cancelled) { if (r.ok) { setHits(r.value); setError(""); } else setError(r.error); } }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(reloadAll, 400);
  }, [reloadAll]);

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
    const rootLabel = [mode === "shared" ? `${ownerName || "Shared"} (shared)` : "My storage", ...path.map(p => p.name)].join(" / ");
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
  }, [path, mode, ownerName, patchJob, pump, scheduleRefresh]);

  const cancelJob = useCallback((id: string) => {
    const waiting = pending.current.findIndex(p => p.job === id);
    if (waiting >= 0) { pending.current.splice(waiting, 1); patchJob(id, { status: "cancelled" }); return; }
    controllers.current.get(id)?.abort();
  }, [patchJob]);
  const cancelAll = useCallback(() => { for (const p of [...pending.current]) cancelJob(p.job); for (const id of [...controllers.current.keys()]) cancelJob(id); }, [cancelJob]);

  // ── Dropping files from the computer on the page ──
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  const onDragEnter = (e: React.DragEvent) => { if (canAdd && hasFiles(e)) { dragDepth.current++; setDragging(true); } };
  const onDragLeave = () => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragging(false); };
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault(); dragDepth.current = 0; setDragging(false);
    if (!canAdd || !hasFiles(e)) return;
    await startUploads(await collectDropped(e.dataTransfer));
  };

  // ── What is chosen ──
  const entryOfKey = useCallback((key: string): Entry | null => {
    const ref = parseItemKey(key); if (!ref) return null;
    if (ref.kind === "folder") { const f = folders.find(x => x.id === ref.id); return f ? { kind: "folder", folder: f } : null; }
    const f = files.find(x => x.id === ref.id); return f ? { kind: "file", file: f } : null;
  }, [folders, files]);
  const selectedEntries = useMemo(() => [...selected].map(entryOfKey).filter((e): e is Entry => e !== null), [selected, entryOfKey]);
  const keyOf = (e: Entry) => (e.kind === "folder" ? itemKey("folder", e.folder.id) : itemKey("file", e.file.id));
  const nameOf = (e: Entry) => (e.kind === "folder" ? e.folder.name : e.file.name);
  const refOf = (e: Entry): ItemRef => (e.kind === "folder" ? { kind: "folder", id: e.folder.id } : { kind: "file", id: e.file.id });
  const summaryOf = (list: Entry[]) => (list.length === 1 ? `“${nameOf(list[0])}”` : countWords(list.length, "item", "items"));
  /** The items an action works on: all chosen items when the one clicked is among them, else just the one clicked. */
  const targetsOf = (entry: Entry): Entry[] => (selected.has(keyOf(entry)) && selectedEntries.length > 1 ? selectedEntries : [entry]);

  const toggle = (key: string) => setSelected(s => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const everyKey = useMemo(() => [...folders.map(f => itemKey("folder", f.id)), ...files.map(f => itemKey("file", f.id))], [folders, files]);
  const allSelected = everyKey.length > 0 && everyKey.every(k => selected.has(k));

  // ── Actions ──
  const runJob = useCallback((name: string, where: string, size: number, work: (set: (percent: number) => void, signal: AbortSignal) => Promise<{ ok: boolean; cancelled?: boolean; error?: string }>) => {
    const id = crypto.randomUUID();
    const controller = new AbortController();
    controllers.current.set(id, controller);
    setJobs(list => [...list.filter(j => j.status === "waiting" || j.status === "uploading"), { id, name, size, where, status: "uploading", progress: 0 }]);
    void work(percent => patchJob(id, { progress: percent }), controller.signal).then(r => {
      controllers.current.delete(id);
      if (r.ok) patchJob(id, { status: "done", progress: 100 }); else if (r.cancelled) patchJob(id, { status: "cancelled" }); else patchJob(id, { status: "error", error: r.error });
      reloadAll();
    });
  }, [patchJob, reloadAll]);

  async function downloadOne(file: ListedFile) {
    const r = await fileLink(file.storagePath, file.name);
    if (!r.ok) { setError(r.error); return; }
    const a = document.createElement("a");
    a.href = r.value; a.download = file.name; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
  }
  function download(list: Entry[]) {
    if (list.length === 1 && list[0].kind === "file") { void downloadOne(list[0].file); return; }
    const sources: ZipSource[] = list.map(e => (e.kind === "folder" ? { kind: "folder" as const, id: e.folder.id, name: e.folder.name } : { kind: "file" as const, id: e.file.id, name: e.file.name, storagePath: e.file.storagePath, sizeBytes: e.file.sizeBytes }));
    const zipName = list.length === 1 && list[0].kind === "folder" ? `${list[0].folder.name}.zip` : "Storage Tool download.zip";
    runJob(`ZIP: ${zipName}`, "Download", 0, async (set, signal) => {
      const collected = await collectZipEntries(sources);
      if (!collected.ok) return collected;
      return downloadAsZip(collected.entries, zipName, set, signal);
    });
  }
  function copyTo(list: Entry[], target: string | null, targetLabel: string) {
    const sources: CopySource[] = list.map(e => (e.kind === "folder" ? { kind: "folder" as const, id: e.folder.id, name: e.folder.name } : { kind: "file" as const, id: e.file.id, name: e.file.name, storagePath: e.file.storagePath, mimeType: e.file.mimeType }));
    runJob(`Copying ${summaryOf(list)}`, targetLabel, list.reduce((s, e) => s + (e.kind === "file" ? e.file.sizeBytes : 0), 0), async (set, signal) => {
      const r = await copyItems(sources, target, set, signal);
      if (r.cancelled) return { ok: false, cancelled: true };
      if (r.failed.length > 0) return { ok: false, error: `${r.failed.slice(0, 2).join(" · ")}${r.failed.length > 2 ? ` (and ${r.failed.length - 2} more)` : ""}` };
      return { ok: true };
    });
  }
  const openEntry = (e: Entry) => { if (e.kind === "folder") setFolderId(e.folder.id); else setPreview(e.file); };
  const actionsFor = (entry: Entry): MenuAction[] => {
    const list = targetsOf(entry), many = list.length > 1;
    return [
      ...(many ? [] : [{ label: "Open", run: () => openEntry(entry) }]),
      ...(many || !isOwner ? [] : [{ label: "Share…", run: () => setShareFor({ kind: entry.kind, id: entry.kind === "folder" ? entry.folder.id : entry.file.id, name: nameOf(entry) }) }]),
      { label: many ? `Download ${list.length} items (ZIP)` : entry.kind === "folder" ? "Download (ZIP)" : "Download", run: () => download(list) },
      ...(many || !canEdit ? [] : [{ label: "Rename", run: () => setRename(entry) }]),
      ...(canEdit ? [{ label: "Move to…", run: () => setPicker({ mode: "move", entries: list }) }] : []),
      { label: isOwner ? "Copy to…" : "Copy to my storage…", run: () => setPicker({ mode: "copy", entries: list }) },
      ...(many ? [] : [{ label: "Details", run: () => { setSelected(new Set([keyOf(entry)])); setDetailsOpen(true); } }]),
      ...(canEdit ? [{ label: many ? `Delete ${list.length} items` : "Delete", run: () => setTrashAsk(list), danger: true }] : []),
    ];
  };

  // ── Drag and drop of my own items onto a folder ──
  const onDragStartItem = (entry: Entry, e: React.DragEvent) => {
    const keys = targetsOf(entry).map(keyOf);
    draggedKeys.current = keys;
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(keys));
    e.dataTransfer.effectAllowed = "move";
  };
  const isInternal = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes(DRAG_TYPE);
  const canDropOn = (id: string | null) => !draggedKeys.current.some(k => { const r = parseItemKey(k); return r?.kind === "folder" && r.id === id; });
  const onDragOverFolder = (id: string, e: React.DragEvent) => { if (canEdit && isInternal(e) && canDropOn(id)) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDropTarget(id); } };
  async function dropOnFolder(id: string | null, e: React.DragEvent) {
    if (!canEdit || !isInternal(e)) return;
    e.preventDefault(); e.stopPropagation();
    setDropTarget(null);
    const refs = draggedKeys.current.map(parseItemKey).filter((r): r is ItemRef => r !== null);
    draggedKeys.current = [];
    if (refs.length === 0 || !canDropOn(id)) return;
    const r = await moveItems(refs, id);
    if (!r.ok) { setError(r.error); return; }
    setSelected(new Set()); setNotice(`Moved ${countWords(r.value, "item", "items")}.`); reloadAll();
  }

  const shownFolders = useMemo(() => sortFolders(folders, sortKey, sortDir), [folders, sortKey, sortDir]);
  const shownFiles = useMemo(() => sortFiles(files, sortKey, sortDir), [files, sortKey, sortDir]);
  const empty = !loading && folders.length === 0 && files.length === 0;
  const quotaPercent = usage && usage.quotaBytes > 0 ? Math.min(100, Math.round((usage.totalBytes / usage.quotaBytes) * 100)) : 0;
  const here = path.length ? path[path.length - 1].name : "My storage";
  const searching = hits !== null;
  const detailsTarget = selectedEntries.length === 1
    ? (selectedEntries[0].kind === "folder" ? { kind: "folder" as const, id: selectedEntries[0].folder.id } : { kind: "file" as const, id: selectedEntries[0].file.id })
    : folderId ? { kind: "folder" as const, id: folderId } : { kind: "root" as const, id: null };

  const sortHeader = (key: SortKey, label: string) => (
    <button onClick={() => { if (sortKey === key) setSortDir(d => (d === "asc" ? "desc" : "asc")); else { setSortKey(key); setSortDir("asc"); } }}
      aria-label={`Sort by ${label}${sortKey === key ? (sortDir === "asc" ? ", ascending" : ", descending") : ""}`} className="inline-flex items-center gap-1 font-bold text-[#062444] hover:underline">
      {label} {sortKey === key && (sortDir === "asc" ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" />)}
    </button>
  );
  const crumbDrop = (id: string | null) => ({ onDragOver: (e: React.DragEvent) => { if (canEdit && isInternal(e) && canDropOn(id)) { e.preventDefault(); setDropTarget(id ?? "root"); } }, onDragLeave: () => setDropTarget(null), onDrop: (e: React.DragEvent) => void dropOnFolder(id, e) });
  const tabCls = (active: boolean) => `inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-[14px] font-bold ${active ? "border-[#062444] text-[#062444]" : "border-transparent text-slate-700 hover:text-[#062444]"}`;

  return (
    <div onDragEnter={onDragEnter} onDragLeave={onDragLeave} onDragOver={e => { if (mode === "files" && hasFiles(e)) e.preventDefault(); }} onDrop={e => void onDrop(e)} className="relative min-h-[60vh]">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-foreground"><HardDrive size={22} aria-hidden="true" /> Storage Tool</h1>
          <p className="text-sm text-slate-700">Your own storage. Only you can see what is here, unless you share it.</p>
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

      <div className="mb-3 flex overflow-x-auto border-b border-[#e6ecf5] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Storage Tool">
        <button role="tab" aria-selected={mode === "files"} onClick={() => goTab("files")} className={tabCls(mode === "files")}><HardDrive size={16} aria-hidden="true" /> My storage</button>
        <button role="tab" aria-selected={mode === "shared"} onClick={() => goTab("shared")} className={tabCls(mode === "shared")}><Users size={16} aria-hidden="true" /> Shared with me</button>
        <button role="tab" aria-selected={mode === "links"} onClick={() => goTab("links")} className={tabCls(mode === "links")}><Link2 size={16} aria-hidden="true" /> Upload links</button>
        <button role="tab" aria-selected={mode === "trash"} onClick={() => goTab("trash")} className={tabCls(mode === "trash")}><Trash2 size={16} aria-hidden="true" /> Trash</button>
      </div>

      {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-[14px] text-red-800">{error}</p>}
      {notice && <p role="status" className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[14px] text-amber-950">{notice}</p>}

      {mode === "trash" ? <TrashView onChanged={reloadAll} />
        : mode === "links" ? <LinkManager folderId={null} />
        : mode === "shared" && folderId === null ? (
          <SharedWithMeView refreshKey={sharedKey} onOpenFolder={setFolderId}
            onOpenFile={i => setPreview({ id: i.id, name: i.name, sizeBytes: i.sizeBytes, mimeType: i.mimeType, storagePath: i.storagePath, uploaderLabel: "", createdAt: i.sharedAt, modifiedAt: i.sharedAt })} />
        ) : (
        <>
          {mode === "shared" && !loading && !error && (
            <p className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-[14px] text-sky-950">Shared by <strong>{ownerName}</strong>. {LEVEL_TEXT[level]}.{level >= 2 && level < 4 ? ` Files you add belong to ${ownerName}.` : ""}{level >= 3 ? ` Things you delete go to ${ownerName}'s Trash.` : ""}</p>
          )}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {canAdd && <button onClick={() => setNewFolderOpen(true)} className="inline-flex items-center gap-2 rounded-lg border border-[#062444]/40 bg-white px-4 py-2 text-[14px] font-bold text-[#062444] hover:bg-[#f7f9fc]"><FolderPlus size={16} aria-hidden="true" /> New folder</button>}
            {canAdd && <button onClick={() => fileInput.current?.click()} className="inline-flex items-center gap-2 rounded-lg bg-[#062444] px-4 py-2 text-[14px] font-bold text-white hover:bg-[#0a3a6e]"><Upload size={16} aria-hidden="true" /> Upload files</button>}
            {canAdd && <button onClick={() => folderInput.current?.click()} className="inline-flex items-center gap-2 rounded-lg border border-[#062444]/40 bg-white px-4 py-2 text-[14px] font-bold text-[#062444] hover:bg-[#f7f9fc]"><FolderUp size={16} aria-hidden="true" /> Upload folder</button>}
            {isOwner && folderId !== null && selectedEntries.length === 0 && <button onClick={() => setShareFor({ kind: "folder", id: folderId, name: here })} className="inline-flex items-center gap-2 rounded-lg border border-[#062444]/40 bg-white px-4 py-2 text-[14px] font-bold text-[#062444] hover:bg-[#f7f9fc]"><Share2 size={16} aria-hidden="true" /> Share this folder</button>}
            <input ref={fileInput} type="file" multiple className="sr-only" aria-label="Choose files to upload" tabIndex={-1} onChange={e => { void startUploads(collectFromInput(e.target.files)); e.target.value = ""; }} />
            <input ref={folderInput} type="file" multiple className="sr-only" aria-label="Choose a folder to upload" tabIndex={-1} {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} onChange={e => { void startUploads(collectFromInput(e.target.files)); e.target.value = ""; }} />
            {isOwner && (
            <div className="relative min-w-[11rem] flex-1 sm:max-w-xs">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" aria-hidden="true" />
              <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Escape") setQuery(""); }} aria-label="Search your storage by name" placeholder="Search by name" className="w-full rounded-lg border border-[#062444]/25 bg-white py-2 pl-9 pr-8 text-[14px] outline-none focus:border-[#062444]" />
              {query && <button onClick={() => setQuery("")} aria-label="Clear the search" className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-700 hover:bg-[#f7f9fc]"><X size={14} aria-hidden="true" /></button>}
            </div>
            )}
            <div className="ml-auto flex items-center gap-2">
              <button onClick={() => setDetailsOpen(v => !v)} aria-pressed={detailsOpen} className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[14px] font-bold ${detailsOpen ? "border-[#062444] bg-[#062444] text-white" : "border-[#062444]/40 bg-white text-[#062444] hover:bg-[#f7f9fc]"}`}><Info size={15} aria-hidden="true" /> Details</button>
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

          {selectedEntries.length > 0 && !searching && (
            <div role="toolbar" aria-label="Actions for the chosen items" className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-[#00709f]/40 bg-sky-50 px-3 py-2">
              <p className="mr-2 text-[14px] font-bold text-[#062444]">{selectedEntries.length} selected</p>
              <button onClick={() => download(selectedEntries)} className="inline-flex items-center gap-1.5 rounded-lg border border-[#062444]/40 bg-white px-3 py-1.5 text-[14px] font-bold text-[#062444] hover:bg-[#f7f9fc]"><Download size={15} aria-hidden="true" /> Download</button>
              {isOwner && selectedEntries.length === 1 && <button onClick={() => setShareFor({ kind: selectedEntries[0].kind, id: selectedEntries[0].kind === "folder" ? selectedEntries[0].folder.id : selectedEntries[0].file.id, name: nameOf(selectedEntries[0]) })} className="inline-flex items-center gap-1.5 rounded-lg border border-[#062444]/40 bg-white px-3 py-1.5 text-[14px] font-bold text-[#062444] hover:bg-[#f7f9fc]"><Share2 size={15} aria-hidden="true" /> Share</button>}
              {canEdit && <button onClick={() => setPicker({ mode: "move", entries: selectedEntries })} className="inline-flex items-center gap-1.5 rounded-lg border border-[#062444]/40 bg-white px-3 py-1.5 text-[14px] font-bold text-[#062444] hover:bg-[#f7f9fc]"><FolderInput size={15} aria-hidden="true" /> Move to…</button>}
              <button onClick={() => setPicker({ mode: "copy", entries: selectedEntries })} className="inline-flex items-center gap-1.5 rounded-lg border border-[#062444]/40 bg-white px-3 py-1.5 text-[14px] font-bold text-[#062444] hover:bg-[#f7f9fc]"><Copy size={15} aria-hidden="true" /> {isOwner ? "Copy to…" : "Copy to my storage…"}</button>
              {canEdit && <button onClick={() => setTrashAsk(selectedEntries)} className="inline-flex items-center gap-1.5 rounded-lg border border-red-800 bg-white px-3 py-1.5 text-[14px] font-bold text-red-800 hover:bg-red-50"><Trash2 size={15} aria-hidden="true" /> Delete</button>}
              <button onClick={() => setSelected(new Set())} className="ml-auto rounded-lg px-3 py-1.5 text-[14px] font-semibold text-[#062444] hover:bg-sky-100">Clear selection</button>
            </div>
          )}

          <nav aria-label="Where you are" className="mb-3 flex flex-wrap items-center gap-1 text-[14px]">
            {mode === "shared"
              ? <button onClick={() => setFolderId(null)} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold text-[#00709f] hover:underline"><Users size={14} aria-hidden="true" /> Shared with me</button>
              : <button onClick={() => { setQuery(""); setFolderId(null); }} {...crumbDrop(null)} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold hover:underline ${dropTarget === "root" ? "bg-sky-100 ring-2 ring-[#00709f]" : ""} ${path.length === 0 ? "text-[#062444]" : "text-[#00709f]"}`} aria-current={path.length === 0 ? "page" : undefined}><Home size={14} aria-hidden="true" /> My storage</button>}
            {path.map((p, i) => (
              <span key={p.id} className="inline-flex items-center gap-1">
                <ChevronRight size={14} className="text-slate-600" aria-hidden="true" />
                <button onClick={() => { setQuery(""); setFolderId(p.id); }} {...crumbDrop(p.id)} aria-current={i === path.length - 1 ? "page" : undefined} className={`rounded px-1.5 py-0.5 font-semibold hover:underline ${dropTarget === p.id ? "bg-sky-100 ring-2 ring-[#00709f]" : ""} ${i === path.length - 1 ? "text-[#062444]" : "text-[#00709f]"}`}>{p.name}</button>
              </span>
            ))}
          </nav>

          <div className="flex flex-col gap-4 lg:flex-row">
            <div className="min-w-0 flex-1">
              {searching ? (
                <SearchResults hits={hits!} query={query.trim()} onOpen={h => { if (h.kind === "folder") { setQuery(""); setFolderId(h.id); } else setPreview({ id: h.id, name: h.name, sizeBytes: h.sizeBytes, mimeType: h.mimeType, storagePath: h.storagePath, uploaderLabel: "", createdAt: h.modifiedAt, modifiedAt: h.modifiedAt }); }}
                  onShow={h => { setQuery(""); setFolderId(h.folderId); }} />
              ) : loading ? <p className="flex items-center gap-2 py-10 text-[14px] text-slate-700"><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Loading…</p>
                : empty ? (
                  <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[#062444]/30 bg-[#f7f9fc] px-6 py-14 text-center">
                    <UploadCloud size={40} className="text-[#062444]" aria-hidden="true" />
                    <p className="text-[16px] font-bold text-[#062444]">{path.length ? "This folder is empty" : "Your storage is empty"}</p>
                    <p className="text-[14px] text-slate-700">{canAdd ? `Drag files or a whole folder here, or press “Upload files”. Biggest file: ${formatBytes(maxBytes)}.` : "There is nothing in it yet, and you can only look."}</p>
                  </div>
                ) : (
                  <ItemViews view={view} folders={shownFolders} files={shownFiles} selected={selected} allSelected={allSelected} onToggle={toggle}
                    onToggleAll={() => setSelected(allSelected ? new Set() : new Set(everyKey))} onOpenFolder={setFolderId} onOpenFile={setPreview}
                    actionsFor={actionsFor} menuFor={menuFor} setMenuFor={setMenuFor} dropTarget={dropTarget} canDrag={canEdit}
                    onDragStartItem={onDragStartItem} onDragEndItem={() => { draggedKeys.current = []; setDropTarget(null); }}
                    onDragOverFolder={onDragOverFolder} onDragLeaveFolder={() => setDropTarget(null)} onDropOnFolder={(id, e) => void dropOnFolder(id, e)} sortHeader={sortHeader} />
                )}
            </div>
            {detailsOpen && !searching && <DetailsPanel target={detailsTarget} refreshKey={detailsKey} onClose={() => setDetailsOpen(false)} />}
          </div>
        </>
      )}

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-2xl border-4 border-dashed border-[#00709f] bg-white/85">
          <p className="flex items-center gap-2 text-[17px] font-bold text-[#062444]"><UploadCloud size={24} aria-hidden="true" /> Drop to upload into “{here}”</p>
        </div>
      )}

      {preview && <PreviewModal file={preview} onClose={() => setPreview(null)} />}
      {newFolderOpen && <NewFolderModal parentId={folderId} onClose={() => setNewFolderOpen(false)} onCreated={() => { setNewFolderOpen(false); reloadAll(); }} />}
      {rename && (
        <RenameDialog kind={rename.kind} name={nameOf(rename)} onCancel={() => setRename(null)}
          onRename={async value => { const r = await renameItem(rename.kind, rename.kind === "folder" ? rename.folder.id : rename.file.id, value); if (!r.ok) return r.error; setRename(null); reloadAll(); return null; }} />
      )}
      {picker && (
        <FolderPickerModal mode={picker.mode} summary={summaryOf(picker.entries)} movingFolderIds={picker.mode === "move" ? picker.entries.flatMap(e => (e.kind === "folder" ? [e.folder.id] : [])) : []}
          startFolderId={picker.mode === "move" || isOwner ? folderId : null} root={picker.mode === "move" && sharedRoot ? sharedRoot : undefined}
          onCancel={() => setPicker(null)}
          onPick={async target => {
            const list = picker.entries;
            if (picker.mode === "move") {
              const r = await moveItems(list.map(refOf), target);
              if (!r.ok) return r.error;
              setPicker(null); setSelected(new Set()); setNotice(r.value === 0 ? "They are already there." : `Moved ${countWords(r.value, "item", "items")}.`); reloadAll();
              return null;
            }
            setPicker(null); setSelected(new Set());
            copyTo(list, target, `Into ${target === null ? "My storage" : "the chosen folder"}`);
            return null;
          }} />
      )}
      {shareFor && <ShareDialog kind={shareFor.kind} id={shareFor.id} name={shareFor.name} onClose={() => setShareFor(null)} onChanged={() => { setSharedKey(k => k + 1); reloadAll(); }} />}
      {trashAsk && (
        <TrashConfirm entries={trashAsk} ownerName={isOwner ? undefined : ownerName} onCancel={() => setTrashAsk(null)}
          onConfirm={async () => { const r = await trashItems(trashAsk.map(refOf)); if (!r.ok) return r.error; setTrashAsk(null); setSelected(new Set()); setNotice(isOwner ? `Moved ${summaryOf(trashAsk)} to the Trash. You can restore ${trashAsk.length === 1 ? "it" : "them"} from the Trash tab for ${usage?.trashDays ?? 30} days.` : `Moved ${summaryOf(trashAsk)} to ${ownerName}'s Trash. Only ${ownerName} can restore ${trashAsk.length === 1 ? "it" : "them"}.`); reloadAll(); return null; }} />
      )}
      <UploadTray jobs={jobs} onCancel={cancelJob} onCancelAll={cancelAll} onClear={() => setJobs([])} />
    </div>
  );
}

/** The question before deleting: for a folder it says how many items are inside. */
function TrashConfirm({ entries, ownerName, onCancel, onConfirm }: { entries: Entry[]; /** set when the folder belongs to somebody else */ ownerName?: string; onCancel: () => void; onConfirm: () => Promise<string | null> }) {
  const [inside, setInside] = useState<{ files: number; folders: number } | null>(null);
  const folderEntries = entries.filter((e): e is Extract<Entry, { kind: "folder" }> => e.kind === "folder");
  useEffect(() => {
    let cancelled = false;
    if (folderEntries.length === 0) { setInside({ files: 0, folders: 0 }); return; }
    void Promise.all(folderEntries.map(e => fetchDetails("folder", e.folder.id))).then(rs => {
      if (cancelled) return;
      setInside(rs.reduce((s, r) => (r.ok ? { files: s.files + r.value.files, folders: s.folders + r.value.folders } : s), { files: 0, folders: 0 }));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const what = entries.length === 1 ? `“${entries[0].kind === "folder" ? entries[0].folder.name : entries[0].file.name}”` : countWords(entries.length, "item", "items");
  return (
    <ConfirmDialog title="Move to the Trash?" confirmLabel="Move to Trash" danger onCancel={onCancel} onConfirm={onConfirm}>
      <p>{what} will be moved to the Trash{ownerName ? ` of ${ownerName}, who shared this folder` : ""}. {ownerName ? "Only they can restore it." : <>You can restore {entries.length === 1 ? "it" : "them"} from the Trash tab until it is emptied or the days run out.</>}</p>
      {folderEntries.length > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-950">{inside === null ? "Counting what is inside…" : <>{folderEntries.length === 1 ? "This folder contains" : "These folders contain"} <strong>{countWords(inside.files, "file", "files")}</strong> and <strong>{countWords(inside.folders, "folder", "folders")}</strong>; everything goes to the Trash together.</>}</p>
      )}
    </ConfirmDialog>
  );
}

function SearchResults({ hits, query, onOpen, onShow }: { hits: SearchHit[]; query: string; onOpen: (h: SearchHit) => void; onShow: (h: SearchHit) => void }) {
  return (
    <div>
      <p className="mb-2 text-[14px] text-slate-800" aria-live="polite">{hits.length === 0 ? `Nothing found for “${query}”.` : `${countWords(hits.length, "result", "results")} for “${query}”${hits.length >= 100 ? " (the first 100)" : ""}.`}</p>
      {hits.length > 0 && (
        <ul className="divide-y divide-[#e6ecf5] rounded-xl border border-[#e6ecf5] bg-white">
          {hits.map(h => (
            <li key={`${h.kind}-${h.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[14px]">
              <button onClick={() => onOpen(h)} className="flex min-w-0 items-center gap-2.5 text-left font-semibold text-[#062444]" aria-label={`Open ${h.name}`}>
                {h.kind === "folder" ? <HardDrive size={20} className="shrink-0 text-amber-700" aria-hidden="true" /> : <FileTypeIcon mime={h.mimeType} name={h.name} className="shrink-0" />}<span className="break-all">{h.name}</span>
              </button>
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-700">
                <span>{h.kind === "folder" ? "Folder" : typeLabel(h.mimeType, h.name)}{h.kind === "file" ? ` · ${formatBytes(h.sizeBytes)}` : ""}</span><span>{dateText(h.modifiedAt)}</span><span className="max-w-[16rem] truncate" title={h.location}>in {h.location}</span>
                <button onClick={() => onShow(h)} className="font-semibold text-[#00709f] hover:underline">Show in folder</button>
              </span>
            </li>
          ))}
        </ul>
      )}
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
