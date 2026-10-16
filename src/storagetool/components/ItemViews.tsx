import type { ReactNode } from "react";
import { Folder, MoreVertical } from "lucide-react";
import { formatBytes, itemKey, typeLabel, type ListedFile, type ListedFolder } from "../storageToolLogic";
import { FileTypeIcon } from "./FileTypeIcon";

export type Entry = { kind: "folder"; folder: ListedFolder } | { kind: "file"; file: ListedFile };
export interface MenuAction { label: string; run: () => void; danger?: boolean }

export interface ItemViewProps {
  view: "grid" | "list";
  folders: ListedFolder[];
  files: ListedFile[];
  selected: Set<string>;
  allSelected: boolean;
  onToggle: (key: string) => void;
  onToggleAll: () => void;
  onOpenFolder: (id: string) => void;
  onOpenFile: (file: ListedFile) => void;
  actionsFor: (entry: Entry) => MenuAction[];
  menuFor: string | null;
  setMenuFor: (key: string | null) => void;
  dropTarget: string | null;
  onDragStartItem: (entry: Entry, e: React.DragEvent) => void;
  onDragEndItem: () => void;
  onDragOverFolder: (id: string, e: React.DragEvent) => void;
  onDragLeaveFolder: (id: string) => void;
  onDropOnFolder: (id: string, e: React.DragEvent) => void;
  sortHeader: (key: "name" | "date" | "size" | "type", label: string) => ReactNode;
  /** false when the person may only look (items cannot be dragged to other folders). Default true. */
  canDrag?: boolean;
}

const dateText = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

/** The items of a folder as cards (grid) or rows (list), with a tick box on each, a ⋮ menu (also opened by right-click), and drag and drop. */
export function ItemViews(p: ItemViewProps) {
  const menu = (entry: Entry) => {
    const key = entry.kind === "folder" ? itemKey("folder", entry.folder.id) : itemKey("file", entry.file.id);
    const name = entry.kind === "folder" ? entry.folder.name : entry.file.name;
    const actions = p.actionsFor(entry);
    return (
      <div className="relative" onClick={e => e.stopPropagation()}>
        <button onClick={() => p.setMenuFor(p.menuFor === key ? null : key)} aria-label={`More actions for ${name}`} aria-haspopup="menu" aria-expanded={p.menuFor === key} className="rounded p-1.5 text-slate-700 hover:bg-[#f7f9fc]"><MoreVertical size={17} aria-hidden="true" /></button>
        {p.menuFor === key && (
          <ul role="menu" aria-label={`Actions for ${name}`} className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-[#e6ecf5] bg-white py-1 shadow-lg">
            {actions.map(a => <li key={a.label} role="none"><button role="menuitem" onClick={() => { p.setMenuFor(null); a.run(); }} className={`block w-full px-3 py-1.5 text-left text-[14px] hover:bg-[#f7f9fc] ${a.danger ? "text-red-800" : "text-[#062444]"}`}>{a.label}</button></li>)}
          </ul>
        )}
      </div>
    );
  };
  const tick = (key: string, name: string) => (
    <input type="checkbox" checked={p.selected.has(key)} onChange={() => p.onToggle(key)} onClick={e => e.stopPropagation()} aria-label={`Select ${name}`} className="h-4 w-4 shrink-0 cursor-pointer accent-[#062444]" />
  );
  const folderDrag = (f: ListedFolder) => ({
    onDragOver: (e: React.DragEvent) => p.onDragOverFolder(f.id, e), onDragLeave: () => p.onDragLeaveFolder(f.id), onDrop: (e: React.DragEvent) => p.onDropOnFolder(f.id, e),
  });
  const dragSource = (entry: Entry) => (p.canDrag === false ? {} : { draggable: true, onDragStart: (e: React.DragEvent) => p.onDragStartItem(entry, e), onDragEnd: p.onDragEndItem });
  const contextMenu = (key: string) => ({ onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); p.setMenuFor(key); } });
  const ring = (id: string) => (p.dropTarget === id ? "ring-2 ring-[#00709f] bg-sky-50" : "");

  if (p.view === "grid") {
    return (
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {p.folders.map(f => {
          const key = itemKey("folder", f.id), entry: Entry = { kind: "folder", folder: f };
          return (
            <li key={f.id} {...dragSource(entry)} {...folderDrag(f)} {...contextMenu(key)} className={`flex items-center gap-2 rounded-xl border bg-white px-3 py-3 hover:border-[#062444]/40 ${p.selected.has(key) ? "border-[#00709f] bg-sky-50" : "border-[#e6ecf5]"} ${ring(f.id)}`}>
              {tick(key, f.name)}
              <button onClick={() => p.onOpenFolder(f.id)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left" aria-label={`Open the folder ${f.name}`}>
                <Folder size={22} className="shrink-0 fill-amber-200 text-amber-700" aria-hidden="true" /><span className="truncate text-[14px] font-bold text-[#062444]" title={f.name}>{f.name}</span>
              </button>
              {menu(entry)}
            </li>
          );
        })}
        {p.files.map(f => {
          const key = itemKey("file", f.id), entry: Entry = { kind: "file", file: f };
          return (
            <li key={f.id} {...dragSource(entry)} {...contextMenu(key)} className={`flex flex-col rounded-xl border bg-white hover:border-[#062444]/40 ${p.selected.has(key) ? "border-[#00709f] bg-sky-50" : "border-[#e6ecf5]"}`}>
              <div className="flex items-start justify-between px-3 pt-3">{tick(key, f.name)}</div>
              <button onClick={() => p.onOpenFile(f)} className="flex flex-1 flex-col items-center gap-2 px-3 pb-2 pt-1 text-center" aria-label={`Open ${f.name}`}>
                <FileTypeIcon mime={f.mimeType} name={f.name} size={34} />
                <span className="line-clamp-2 break-all text-[14px] font-semibold text-[#062444]" title={f.name}>{f.name}</span>
              </button>
              <div className="flex items-center justify-between border-t border-[#e6ecf5] pl-3 pr-1 text-[13px] text-slate-700"><span>{formatBytes(f.sizeBytes)}</span>{menu(entry)}</div>
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <div className="relative overflow-x-auto rounded-xl border border-[#e6ecf5] bg-white">
      <table className="w-full text-left text-[14px]">
        <thead className="bg-[#f7f9fc]">
          <tr>
            <th className="w-10 px-3 py-2.5"><input type="checkbox" checked={p.allSelected} onChange={p.onToggleAll} aria-label="Select everything in this folder" className="h-4 w-4 cursor-pointer accent-[#062444]" /></th>
            <th className="px-2 py-2.5">{p.sortHeader("name", "Name")}</th><th className="px-3 py-2.5">{p.sortHeader("type", "Type")}</th><th className="px-3 py-2.5">{p.sortHeader("size", "Size")}</th><th className="px-3 py-2.5">{p.sortHeader("date", "Modified")}</th>
            <th className="w-12 px-2 py-2.5"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#e6ecf5]">
          {p.folders.map(f => {
            const key = itemKey("folder", f.id), entry: Entry = { kind: "folder", folder: f };
            return (
              <tr key={f.id} {...dragSource(entry)} {...folderDrag(f)} {...contextMenu(key)} className={`hover:bg-[#f7f9fc] ${p.selected.has(key) ? "bg-sky-50" : ""} ${ring(f.id)}`}>
                <td className="px-3 py-2">{tick(key, f.name)}</td>
                <td className="px-2 py-2"><button onClick={() => p.onOpenFolder(f.id)} className="flex items-center gap-2.5 text-left font-bold text-[#062444]" aria-label={`Open the folder ${f.name}`}><Folder size={20} className="shrink-0 fill-amber-200 text-amber-700" aria-hidden="true" /><span className="break-all">{f.name}</span></button></td>
                <td className="px-3 py-2 text-slate-700">Folder</td><td className="px-3 py-2 text-slate-700">—</td><td className="px-3 py-2 text-slate-700">{dateText(f.updatedAt)}</td>
                <td className="px-2 py-2">{menu(entry)}</td>
              </tr>
            );
          })}
          {p.files.map(f => {
            const key = itemKey("file", f.id), entry: Entry = { kind: "file", file: f };
            return (
              <tr key={f.id} {...dragSource(entry)} {...contextMenu(key)} className={`hover:bg-[#f7f9fc] ${p.selected.has(key) ? "bg-sky-50" : ""}`}>
                <td className="px-3 py-2">{tick(key, f.name)}</td>
                <td className="px-2 py-2"><button onClick={() => p.onOpenFile(f)} className="flex items-center gap-2.5 text-left font-semibold text-[#062444]" aria-label={`Open ${f.name}`}><FileTypeIcon mime={f.mimeType} name={f.name} className="shrink-0" /><span className="break-all">{f.name}</span></button></td>
                <td className="px-3 py-2 text-slate-700">{typeLabel(f.mimeType, f.name)}</td><td className="px-3 py-2 text-slate-700">{formatBytes(f.sizeBytes)}</td><td className="px-3 py-2 text-slate-700">{dateText(f.modifiedAt)}</td>
                <td className="px-2 py-2">{menu(entry)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
