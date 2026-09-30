import { useEffect, useRef, useState } from "react";
import {
  Plus, FolderPlus, LayoutGrid, List as ListIcon, Search, ArrowUpDown, Home, ChevronRight,
  Folder, MonitorPlay,
} from "lucide-react";
import {
  fetchFolderContents, fetchBreadcrumbPath, fetchAllOwnedFolders, createFolder, renameFolder, moveFolder, deleteFolder,
  createPresentation, renamePresentation, movePresentation, duplicatePresentation, deletePresentation,
  isFolderOrDescendant, type PresentationFolder, type PresentationItem, type BreadcrumbEntry,
} from "../presentationsApi";
import { ItemActionsMenu } from "../components/ItemActionsMenu";
import { MoveToFolderModal } from "../components/MoveToFolderModal";
import { DeleteConfirmModal } from "../components/DeleteConfirmModal";
import { PresentationEditorPage } from "./PresentationEditorPage";

type ViewMode = "grid" | "list";
type SortBy = "name" | "date";
type MoveTarget = { id: string; type: "folder" | "presentation"; label: string; currentFolderId: string | null };
type DeleteTarget = { id: string; type: "folder" | "presentation"; label: string };
type DragItem = { id: string; type: "folder" | "presentation" };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Phase 1 of "My Presentations" — the file manager (folders + presentations).
 * Visible to every signed-in staff member (see src/app/App.tsx's ungated
 * "myPresentations" page), each account only ever sees its own rows —
 * enforced server-side by presentation_folders'/presentations' owner-only
 * RLS (supabase_migration_presentations_core.sql), not just this UI.
 *
 * "Open" on a presentation is a placeholder detail view for now — the
 * real Slides-like editor lands in Phase 2. Everything else here (create,
 * rename, move, duplicate, delete, drag-and-drop, breadcrumbs, grid/list,
 * search/sort) is the real, final implementation of the file manager.
 */
export function MyPresentationsPage() {
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbEntry[]>([]);
  const [folders, setFolders] = useState<PresentationFolder[]>([]);
  const [presentations, setPresentations] = useState<PresentationItem[]>([]);
  const [allFolders, setAllFolders] = useState<PresentationFolder[]>([]);
  const [loading, setLoading] = useState(true);

  const [view, setView] = useState<ViewMode>("grid");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("name");

  const [renaming, setRenaming] = useState<{ id: string; type: "folder" | "presentation" } | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [openPresentation, setOpenPresentation] = useState<PresentationItem | null>(null);

  const [dragItem, setDragItem] = useState<DragItem | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);

  async function load(folderId: string | null) {
    setLoading(true);
    const [contents, crumb, owned] = await Promise.all([
      fetchFolderContents(folderId),
      fetchBreadcrumbPath(folderId),
      fetchAllOwnedFolders(),
    ]);
    setFolders(contents.folders);
    setPresentations(contents.presentations);
    setBreadcrumb(crumb);
    setAllFolders(owned);
    setLoading(false);
  }

  useEffect(() => { void load(currentFolderId); }, [currentFolderId]);

  useEffect(() => {
    if (renaming && renameInputRef.current) { renameInputRef.current.focus(); renameInputRef.current.select(); }
  }, [renaming]);

  async function handleNewFolder() {
    const res = await createFolder(currentFolderId, "Untitled folder");
    if (!res.ok) return;
    await load(currentFolderId);
    setRenaming({ id: res.folder.id, type: "folder" });
    setRenameDraft(res.folder.name);
  }

  async function handleNewPresentation() {
    const res = await createPresentation(currentFolderId);
    if (!res.ok) return;
    setOpenPresentation(res.presentation);
  }

  async function commitRename() {
    if (!renaming) return;
    const name = renameDraft.trim();
    if (name) {
      if (renaming.type === "folder") await renameFolder(renaming.id, name);
      else await renamePresentation(renaming.id, name);
    }
    setRenaming(null);
    await load(currentFolderId);
  }

  async function handleMove(destinationFolderId: string | null) {
    if (!moveTarget) return;
    if (moveTarget.type === "folder") await moveFolder(moveTarget.id, destinationFolderId);
    else await movePresentation(moveTarget.id, destinationFolderId);
    setMoveTarget(null);
    await load(currentFolderId);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    if (deleteTarget.type === "folder") await deleteFolder(deleteTarget.id);
    else await deletePresentation(deleteTarget.id);
    setDeleteTarget(null);
    await load(currentFolderId);
  }

  async function handleDuplicate(id: string) {
    await duplicatePresentation(id);
    await load(currentFolderId);
  }

  async function handleDropOnFolder(targetFolderId: string) {
    const item = dragItem;
    setDragItem(null);
    setDragOverFolderId(null);
    if (!item || item.id === targetFolderId) return;
    if (item.type === "folder") {
      if (isFolderOrDescendant(allFolders, item.id, targetFolderId)) return; // can't drop a folder into itself/its own subtree
      await moveFolder(item.id, targetFolderId);
    } else {
      await movePresentation(item.id, targetFolderId);
    }
    await load(currentFolderId);
  }

  if (openPresentation) {
    return (
      <PresentationEditorPage
        presentation={openPresentation}
        onBack={() => { setOpenPresentation(null); void load(currentFolderId); }}
      />
    );
  }

  const query = search.trim().toLowerCase();
  const filteredFolders = folders.filter(f => f.name.toLowerCase().includes(query));
  const filteredPresentations = presentations.filter(p => p.title.toLowerCase().includes(query));
  const sortedFolders = [...filteredFolders].sort((a, b) => sortBy === "name" ? a.name.localeCompare(b.name) : b.updatedAt.localeCompare(a.updatedAt));
  const sortedPresentations = [...filteredPresentations].sort((a, b) => sortBy === "name" ? a.title.localeCompare(b.title) : b.updatedAt.localeCompare(a.updatedAt));
  const isEmpty = folders.length === 0 && presentations.length === 0;
  const hasNoSearchResults = !isEmpty && sortedFolders.length === 0 && sortedPresentations.length === 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#062444]">My Presentations</h1>
          <p className="text-[13px] text-slate-500">Only you can see your own folders and presentations.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleNewFolder} className="flex items-center gap-1.5 border border-[#e6ecf5] text-[#062444] text-[12.5px] font-semibold rounded-lg px-3.5 py-2 hover:bg-[#f7f9fc]">
            <FolderPlus size={15} /> New Folder
          </button>
          <button onClick={handleNewPresentation} className="flex items-center gap-1.5 bg-[#062444] text-white text-[12.5px] font-semibold rounded-lg px-3.5 py-2 hover:bg-[#0a3a6b]">
            <Plus size={15} /> New Presentation
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1 mb-4 text-[12.5px] font-semibold text-slate-500 overflow-x-auto">
        <button onClick={() => setCurrentFolderId(null)} className={`flex items-center gap-1 shrink-0 ${currentFolderId === null ? "text-[#062444]" : "hover:text-[#062444]"}`}>
          <Home size={13} /> My Presentations
        </button>
        {breadcrumb.map(entry => (
          <span key={entry.id} className="flex items-center gap-1 shrink-0">
            <ChevronRight size={12} className="text-slate-300" />
            <button onClick={() => setCurrentFolderId(entry.id)} className={entry.id === currentFolderId ? "text-[#062444]" : "hover:text-[#062444]"}>{entry.name}</button>
          </span>
        ))}
      </div>

      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)} placeholder="Search this folder…"
            className="w-full border border-[#e6ecf5] rounded-lg pl-8 pr-3 py-2 text-[12.5px] outline-none focus:border-[#0088cc]"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSortBy(s => s === "name" ? "date" : "name")}
            className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-500 hover:text-[#062444] px-2 py-1.5"
          >
            <ArrowUpDown size={13} /> Sort: {sortBy === "name" ? "Name" : "Last modified"}
          </button>
          <div className="flex items-center rounded-lg border border-[#e6ecf5] overflow-hidden">
            <button onClick={() => setView("grid")} className={`p-2 ${view === "grid" ? "bg-[#062444] text-white" : "text-slate-400 hover:bg-[#f7f9fc]"}`}><LayoutGrid size={15} /></button>
            <button onClick={() => setView("list")} className={`p-2 ${view === "list" ? "bg-[#062444] text-white" : "text-slate-400 hover:bg-[#f7f9fc]"}`}><ListIcon size={15} /></button>
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-center text-slate-400 py-14">Loading…</p>
      ) : isEmpty ? (
        <div className="text-center py-14 text-slate-400 bg-[#f7f9fc] rounded-2xl">
          <MonitorPlay className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-[13.5px] font-medium">This folder is empty.</p>
          <p className="text-[12.5px]">Create a presentation or a folder to get started.</p>
        </div>
      ) : hasNoSearchResults ? (
        <div className="text-center py-14 text-slate-400 bg-[#f7f9fc] rounded-2xl">
          <Search className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-[13.5px] font-medium">No matches for "{search}".</p>
        </div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {sortedFolders.map(folder => (
            <div
              key={folder.id}
              draggable
              onDragStart={() => setDragItem({ id: folder.id, type: "folder" })}
              onDragOver={e => { e.preventDefault(); setDragOverFolderId(folder.id); }}
              onDragLeave={() => setDragOverFolderId(f => f === folder.id ? null : f)}
              onDrop={() => void handleDropOnFolder(folder.id)}
              onDoubleClick={() => setCurrentFolderId(folder.id)}
              className={`group relative bg-white rounded-2xl border p-4 cursor-pointer transition-colors ${
                dragOverFolderId === folder.id ? "border-[#0088cc] bg-[#f0f8ff]" : "border-[#e6ecf5] hover:border-[#0088cc]/40"
              }`}
            >
              <div className="flex items-start justify-between">
                <Folder size={28} className="text-[#F3BC00]" />
                <ItemActionsMenu
                  canDuplicate={false}
                  onOpen={() => setCurrentFolderId(folder.id)}
                  onRename={() => { setRenaming({ id: folder.id, type: "folder" }); setRenameDraft(folder.name); }}
                  onMove={() => setMoveTarget({ id: folder.id, type: "folder", label: folder.name, currentFolderId: folder.parentFolderId })}
                  onDuplicate={() => {}}
                  onDelete={() => setDeleteTarget({ id: folder.id, type: "folder", label: folder.name })}
                />
              </div>
              {renaming?.id === folder.id && renaming.type === "folder" ? (
                <input
                  ref={renameInputRef} value={renameDraft} onChange={e => setRenameDraft(e.target.value)}
                  onBlur={commitRename} onKeyDown={e => e.key === "Enter" && commitRename()}
                  onClick={e => e.stopPropagation()}
                  className="mt-2 w-full text-[13px] font-semibold text-[#062444] border-b border-[#0088cc] outline-none"
                />
              ) : (
                <p className="mt-2 text-[13px] font-semibold text-[#062444] truncate">{folder.name}</p>
              )}
            </div>
          ))}
          {sortedPresentations.map(presentation => (
            <div
              key={presentation.id}
              draggable
              onDragStart={() => setDragItem({ id: presentation.id, type: "presentation" })}
              onDoubleClick={() => setOpenPresentation(presentation)}
              className="group relative bg-white rounded-2xl border border-[#e6ecf5] hover:border-[#0088cc]/40 p-4 cursor-pointer transition-colors"
            >
              <div className="flex items-start justify-between">
                <MonitorPlay size={28} className="text-[#062444]" />
                <ItemActionsMenu
                  canDuplicate
                  onOpen={() => setOpenPresentation(presentation)}
                  onRename={() => { setRenaming({ id: presentation.id, type: "presentation" }); setRenameDraft(presentation.title); }}
                  onMove={() => setMoveTarget({ id: presentation.id, type: "presentation", label: presentation.title, currentFolderId: presentation.folderId })}
                  onDuplicate={() => void handleDuplicate(presentation.id)}
                  onDelete={() => setDeleteTarget({ id: presentation.id, type: "presentation", label: presentation.title })}
                />
              </div>
              {renaming?.id === presentation.id && renaming.type === "presentation" ? (
                <input
                  ref={renameInputRef} value={renameDraft} onChange={e => setRenameDraft(e.target.value)}
                  onBlur={commitRename} onKeyDown={e => e.key === "Enter" && commitRename()}
                  onClick={e => e.stopPropagation()}
                  className="mt-2 w-full text-[13px] font-semibold text-[#062444] border-b border-[#0088cc] outline-none"
                />
              ) : (
                <p className="mt-2 text-[13px] font-semibold text-[#062444] truncate">{presentation.title}</p>
              )}
              <p className="text-[11px] text-slate-400 mt-0.5">{formatDate(presentation.updatedAt)}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[#e6ecf5] overflow-hidden">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="bg-[#f8fafd] text-left text-slate-400 text-[11px] font-bold uppercase tracking-wide">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Last Modified</th>
                <th className="px-4 py-3 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {sortedFolders.map(folder => (
                <tr
                  key={folder.id}
                  onDoubleClick={() => setCurrentFolderId(folder.id)}
                  onDragOver={e => { e.preventDefault(); setDragOverFolderId(folder.id); }}
                  onDragLeave={() => setDragOverFolderId(f => f === folder.id ? null : f)}
                  onDrop={() => void handleDropOnFolder(folder.id)}
                  draggable
                  onDragStart={() => setDragItem({ id: folder.id, type: "folder" })}
                  className={`border-t border-[#f0f3f8] cursor-pointer ${dragOverFolderId === folder.id ? "bg-[#f0f8ff]" : "hover:bg-[#f7f9fc]"}`}
                >
                  <td className="px-4 py-2.5 font-semibold text-[#062444] flex items-center gap-2">
                    <Folder size={15} className="text-[#F3BC00]" />
                    {renaming?.id === folder.id && renaming.type === "folder" ? (
                      <input
                        ref={renameInputRef} value={renameDraft} onChange={e => setRenameDraft(e.target.value)}
                        onBlur={commitRename} onKeyDown={e => e.key === "Enter" && commitRename()}
                        onClick={e => e.stopPropagation()}
                        className="text-[12.5px] font-semibold text-[#062444] border-b border-[#0088cc] outline-none"
                      />
                    ) : folder.name}
                  </td>
                  <td className="px-4 py-2.5 text-slate-400">Folder</td>
                  <td className="px-4 py-2.5 text-slate-400">{formatDate(folder.updatedAt)}</td>
                  <td className="px-4 py-2.5">
                    <ItemActionsMenu
                      canDuplicate={false}
                      onOpen={() => setCurrentFolderId(folder.id)}
                      onRename={() => { setRenaming({ id: folder.id, type: "folder" }); setRenameDraft(folder.name); }}
                      onMove={() => setMoveTarget({ id: folder.id, type: "folder", label: folder.name, currentFolderId: folder.parentFolderId })}
                      onDuplicate={() => {}}
                      onDelete={() => setDeleteTarget({ id: folder.id, type: "folder", label: folder.name })}
                    />
                  </td>
                </tr>
              ))}
              {sortedPresentations.map(presentation => (
                <tr
                  key={presentation.id}
                  onDoubleClick={() => setOpenPresentation(presentation)}
                  draggable
                  onDragStart={() => setDragItem({ id: presentation.id, type: "presentation" })}
                  className="border-t border-[#f0f3f8] cursor-pointer hover:bg-[#f7f9fc]"
                >
                  <td className="px-4 py-2.5 font-semibold text-[#062444] flex items-center gap-2">
                    <MonitorPlay size={15} className="text-[#062444]" />
                    {renaming?.id === presentation.id && renaming.type === "presentation" ? (
                      <input
                        ref={renameInputRef} value={renameDraft} onChange={e => setRenameDraft(e.target.value)}
                        onBlur={commitRename} onKeyDown={e => e.key === "Enter" && commitRename()}
                        onClick={e => e.stopPropagation()}
                        className="text-[12.5px] font-semibold text-[#062444] border-b border-[#0088cc] outline-none"
                      />
                    ) : presentation.title}
                  </td>
                  <td className="px-4 py-2.5 text-slate-400">Presentation</td>
                  <td className="px-4 py-2.5 text-slate-400">{formatDate(presentation.updatedAt)}</td>
                  <td className="px-4 py-2.5">
                    <ItemActionsMenu
                      canDuplicate
                      onOpen={() => setOpenPresentation(presentation)}
                      onRename={() => { setRenaming({ id: presentation.id, type: "presentation" }); setRenameDraft(presentation.title); }}
                      onMove={() => setMoveTarget({ id: presentation.id, type: "presentation", label: presentation.title, currentFolderId: presentation.folderId })}
                      onDuplicate={() => void handleDuplicate(presentation.id)}
                      onDelete={() => setDeleteTarget({ id: presentation.id, type: "presentation", label: presentation.title })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {moveTarget && (
        <MoveToFolderModal
          allFolders={allFolders}
          currentFolderId={moveTarget.currentFolderId}
          excludeSubtreeOf={moveTarget.type === "folder" ? moveTarget.id : null}
          itemLabel={moveTarget.label}
          onClose={() => setMoveTarget(null)}
          onMove={handleMove}
        />
      )}

      {deleteTarget && (
        <DeleteConfirmModal
          itemLabel={deleteTarget.label}
          isFolder={deleteTarget.type === "folder"}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
