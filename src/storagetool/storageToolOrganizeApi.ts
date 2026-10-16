// ─────────────────────────────────────────────────────────────
// src/storagetool/storageToolOrganizeApi.ts
// Phase 2 calls: rename, move, copy, search, details, Trash (supabase_migration_storage_tool_p2.sql). Every rule is decided by the database.
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";
import { STORAGE_TOOL_BUCKET, discardUnregistered, registerFile, type Loaded } from "./storageToolApi";
import type { FlatFile, ItemKind, ItemRef, SubtreeData, TreeFolder } from "./storageToolLogic";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));
const refs = (items: ItemRef[]) => items.map(i => ({ kind: i.kind, id: i.id }));

export async function renameItem(kind: ItemKind, id: string, name: string): Promise<Loaded<string>> {
  const { data, error } = await supabase.rpc("storage_tool_rename", { p_kind: kind, p_id: id, p_name: name });
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't rename it." };
  return { ok: true, value: str((data as Row).name) };
}

export async function moveItems(items: ItemRef[], targetFolderId: string | null): Promise<Loaded<number>> {
  const { data, error } = await supabase.rpc("storage_tool_move", { p_items: refs(items), p_target: targetFolderId });
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't move them." };
  return { ok: true, value: Number((data as Row).moved ?? 0) };
}

export async function fetchFolderTree(): Promise<Loaded<TreeFolder[]>> {
  const { data, error } = await supabase.rpc("storage_tool_folder_tree");
  if (error) return { ok: false, error: error.message };
  return { ok: true, value: ((data ?? []) as Row[]).map(r => ({ id: str(r.id), parentId: r.parent_id == null ? null : str(r.parent_id), name: str(r.name) })) };
}

const toFlatFile = (r: Row): FlatFile => ({ id: str(r.id), folderId: r.folder_id == null ? null : str(r.folder_id), name: str(r.name), sizeBytes: Number(r.size_bytes ?? 0), mimeType: str(r.mime_type), storagePath: str(r.storage_path) });

/** A folder and everything inside it (for copying a folder and for ZIP downloads). */
export async function fetchSubtree(folderId: string): Promise<Loaded<SubtreeData>> {
  const { data, error } = await supabase.rpc("storage_tool_subtree", { p_folder_id: folderId });
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't read the folder." };
  const d = data as { folders?: Row[]; files?: Row[] };
  return { ok: true, value: { folders: (d.folders ?? []).map(r => ({ id: str(r.id), parentId: r.parent_id == null ? null : str(r.parent_id), name: str(r.name) })), files: (d.files ?? []).map(toFlatFile) } };
}

export interface SearchHit { kind: ItemKind; id: string; name: string; folderId: string | null; location: string; sizeBytes: number; mimeType: string; storagePath: string; modifiedAt: string }
export async function searchItems(query: string): Promise<Loaded<SearchHit[]>> {
  const { data, error } = await supabase.rpc("storage_tool_search", { p_query: query });
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    value: ((data ?? []) as Row[]).map(r => ({
      kind: r.kind as ItemKind, id: str(r.id), name: str(r.name), folderId: r.folder_id == null ? null : str(r.folder_id), location: str(r.location),
      sizeBytes: Number(r.size_bytes ?? 0), mimeType: str(r.mime_type), storagePath: str(r.storage_path), modifiedAt: str(r.modified_at),
    })),
  };
}

export interface ItemDetails { kind: "file" | "folder" | "root"; name: string; location: string; sizeBytes: number; mimeType: string; uploadedBy: string; createdAt: string; modifiedAt: string; folders: number; files: number }
export async function fetchDetails(kind: "file" | "folder" | "root", id: string | null): Promise<Loaded<ItemDetails>> {
  const { data, error } = await supabase.rpc("storage_tool_details", { p_kind: kind, p_id: id });
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't read the details." };
  const d = data as Row;
  return {
    ok: true,
    value: { kind, name: str(d.name), location: str(d.location), sizeBytes: Number(d.size_bytes ?? 0), mimeType: str(d.mime_type), uploadedBy: str(d.uploaded_by), createdAt: str(d.created_at), modifiedAt: str(d.modified_at), folders: Number(d.folders ?? 0), files: Number(d.files ?? 0) },
  };
}

// ── Trash ──
export async function trashItems(items: ItemRef[]): Promise<Loaded<{ trashed: number; files: number }>> {
  const { data, error } = await supabase.rpc("storage_tool_trash", { p_items: refs(items) });
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't move them to the Trash." };
  const d = data as Row;
  return { ok: true, value: { trashed: Number(d.trashed ?? 0), files: Number(d.files ?? 0) } };
}

export interface TrashItem { kind: ItemKind; id: string; name: string; deletedAt: string; location: string; sizeBytes: number; itemCount: number; mimeType: string; daysLeft: number }
export async function fetchTrash(): Promise<Loaded<{ trashDays: number; items: TrashItem[] }>> {
  const { data, error } = await supabase.rpc("storage_tool_trash_list");
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't read the Trash." };
  const d = data as { trash_days?: number; items?: Row[] };
  return {
    ok: true,
    value: {
      trashDays: Number(d.trash_days ?? 30),
      items: (d.items ?? []).map(r => ({ kind: r.kind as ItemKind, id: str(r.id), name: str(r.name), deletedAt: str(r.deleted_at), location: str(r.location), sizeBytes: Number(r.size_bytes ?? 0), itemCount: Number(r.item_count ?? 0), mimeType: str(r.mime_type), daysLeft: Number(r.days_left ?? 0) })),
    },
  };
}

export async function restoreItems(items: ItemRef[]): Promise<Loaded<{ restored: number; toTop: number }>> {
  const { data, error } = await supabase.rpc("storage_tool_restore", { p_items: refs(items) });
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't restore them." };
  const d = data as Row;
  return { ok: true, value: { restored: Number(d.restored ?? 0), toTop: Number(d.to_top ?? 0) } };
}

/**
 * "Delete forever": the database lists the stored files behind the chosen Trash items, the files are removed from storage (the storage rule allows
 * this only for files that are in the person's own Trash), and then the database removes the rows whose file is really gone.
 */
export async function deleteForever(items: ItemRef[]): Promise<Loaded<{ deletedFiles: number; leftInTrash: number }>> {
  const prepared = await supabase.rpc("storage_tool_forever_prepare", { p_items: refs(items) });
  if (prepared.error) return { ok: false, error: prepared.error.message };
  const paths = ((prepared.data ?? []) as unknown[]).map(str);
  for (let i = 0; i < paths.length; i += 100) {
    const removed = await supabase.storage.from(STORAGE_TOOL_BUCKET).remove(paths.slice(i, i + 100));
    if (removed.error) return { ok: false, error: removed.error.message };
  }
  const { data, error } = await supabase.rpc("storage_tool_forever_finish", { p_items: refs(items) });
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't finish deleting." };
  const d = data as Row;
  return { ok: true, value: { deletedFiles: Number(d.deleted_files ?? 0), leftInTrash: Number(d.left_in_trash ?? 0) } };
}

// ── Copying a stored file (the storage service copies it itself; nothing is downloaded) ──
export async function copyStoredFile(file: { storagePath: string; name: string; mimeType: string }, targetFolderId: string | null): Promise<Loaded<string>> {
  const { data: sessionData } = await supabase.auth.getSession();
  const me = sessionData.session?.user.id;
  if (!me) return { ok: false, error: "You are signed out. Please sign in again." };
  const newId = crypto.randomUUID();
  const newPath = `${me}/${newId}`;
  const copied = await supabase.storage.from(STORAGE_TOOL_BUCKET).copy(file.storagePath, newPath);
  if (copied.error) return { ok: false, error: copied.error.message };
  const registered = await registerFile(newId, targetFolderId, file.name, file.mimeType);
  if (!registered.ok) { await discardUnregistered(newPath); return registered; }
  return { ok: true, value: registered.value.name };
}

/** Temporary links for several files at once (for a ZIP). */
export async function fileLinks(storagePaths: string[]): Promise<Loaded<Map<string, string>>> {
  const out = new Map<string, string>();
  for (let i = 0; i < storagePaths.length; i += 100) {
    const { data, error } = await supabase.storage.from(STORAGE_TOOL_BUCKET).createSignedUrls(storagePaths.slice(i, i + 100), 900);
    if (error || !data) return { ok: false, error: error?.message ?? "Couldn't open the files." };
    for (const row of data) if (row.path && row.signedUrl) out.set(row.path, row.signedUrl);
  }
  return { ok: true, value: out };
}
