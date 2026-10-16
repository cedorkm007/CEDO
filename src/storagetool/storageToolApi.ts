// ─────────────────────────────────────────────────────────────
// src/storagetool/storageToolApi.ts
// The Storage Tool's calls to the database (see supabase_migration_storage_tool_p1.sql). Every rule is decided there; these calls just ask.
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";
import type { ListedFile, ListedFolder } from "./storageToolLogic";

export const STORAGE_TOOL_BUCKET = "storage-tool";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));
export type Loaded<T> = { ok: true; value: T } | { ok: false; error: string };
export type Done = { ok: true } | { ok: false; error: string };

export interface FolderContents { folders: ListedFolder[]; files: ListedFile[] }
export interface PathEntry { id: string; name: string }
export interface StorageUsage { mineBytes: number; mineFiles: number; totalBytes: number; quotaBytes: number; maxFileBytes: number; trashDays: number }

/** The folders and files directly inside a folder (null = the top of my storage). Only my own rows are ever returned (the database enforces it). */
export async function fetchFolderContents(folderId: string | null): Promise<Loaded<FolderContents>> {
  const foldersQuery = supabase.from("storage_tool_folders").select("id, name, created_at, updated_at").is("deleted_at", null);
  const filesQuery = supabase.from("storage_tool_files").select("id, name, size_bytes, mime_type, storage_path, uploader_label, created_at, modified_at").is("deleted_at", null);
  const [folders, files] = await Promise.all([
    folderId === null ? foldersQuery.is("parent_id", null) : foldersQuery.eq("parent_id", folderId),
    folderId === null ? filesQuery.is("folder_id", null) : filesQuery.eq("folder_id", folderId),
  ]);
  if (folders.error) return { ok: false, error: folders.error.message };
  if (files.error) return { ok: false, error: files.error.message };
  return {
    ok: true,
    value: {
      folders: ((folders.data ?? []) as Row[]).map(r => ({ id: str(r.id), name: str(r.name), createdAt: str(r.created_at), updatedAt: str(r.updated_at) })),
      files: ((files.data ?? []) as Row[]).map(r => ({
        id: str(r.id), name: str(r.name), sizeBytes: Number(r.size_bytes ?? 0), mimeType: str(r.mime_type), storagePath: str(r.storage_path),
        uploaderLabel: str(r.uploader_label), createdAt: str(r.created_at), modifiedAt: str(r.modified_at),
      })),
    },
  };
}

export async function fetchFolderPath(folderId: string | null): Promise<Loaded<PathEntry[]>> {
  if (folderId === null) return { ok: true, value: [] };
  const { data, error } = await supabase.rpc("storage_tool_path", { p_folder_id: folderId });
  if (error) return { ok: false, error: error.message };
  return { ok: true, value: ((data ?? []) as Row[]).map(r => ({ id: str(r.id), name: str(r.name) })) };
}

export async function createFolder(parentId: string | null, name: string): Promise<Loaded<{ id: string; name: string }>> {
  const { data, error } = await supabase.rpc("storage_tool_create_folder", { p_parent_id: parentId, p_name: name });
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't create the folder." };
  const d = data as Row;
  return { ok: true, value: { id: str(d.id), name: str(d.name) } };
}

/** Uploading a whole folder: use the folder with this name if it is already there (so two uploads of "Reports" do not make "Reports (1)"), else make it. */
export async function findOrCreateFolder(parentId: string | null, name: string): Promise<Loaded<string>> {
  const q = supabase.from("storage_tool_folders").select("id, name").is("deleted_at", null);
  const { data, error } = await (parentId === null ? q.is("parent_id", null) : q.eq("parent_id", parentId));
  if (error) return { ok: false, error: error.message };
  const found = ((data ?? []) as Row[]).find(r => str(r.name).toLowerCase() === name.trim().toLowerCase());
  if (found) return { ok: true, value: str(found.id) };
  const made = await createFolder(parentId, name);
  return made.ok ? { ok: true, value: made.value.id } : made;
}

export async function fetchUsage(): Promise<Loaded<StorageUsage>> {
  const { data, error } = await supabase.rpc("storage_tool_usage");
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't read the storage numbers." };
  const d = data as Row;
  return { ok: true, value: { mineBytes: Number(d.mine_bytes ?? 0), mineFiles: Number(d.mine_files ?? 0), totalBytes: Number(d.total_bytes ?? 0), quotaBytes: Number(d.quota_bytes ?? 0), maxFileBytes: Number(d.max_file_bytes ?? 0), trashDays: Number(d.trash_days ?? 30) } };
}

/** Tells the database that the file now sits in storage under "<my id>/<fileId>" and should become part of my storage. */
export async function registerFile(fileId: string, folderId: string | null, name: string, mime: string): Promise<Loaded<{ id: string; name: string; size: number }>> {
  const { data, error } = await supabase.rpc("storage_tool_register_file", { p_file_id: fileId, p_folder_id: folderId, p_name: name, p_mime: mime });
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't save the file." };
  const d = data as Row;
  return { ok: true, value: { id: str(d.id), name: str(d.name), size: Number(d.size ?? 0) } };
}

/** A temporary link (5 minutes) for showing or downloading a file; with `downloadAs` the browser saves it under that name. */
export async function fileLink(storagePath: string, downloadAs?: string): Promise<Loaded<string>> {
  const { data, error } = await supabase.storage.from(STORAGE_TOOL_BUCKET).createSignedUrl(storagePath, 300, downloadAs ? { download: downloadAs } : undefined);
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't open the file." };
  return { ok: true, value: data.signedUrl };
}

/** Removes a file that was sent to storage but never registered (a failed or cancelled upload). Best effort. */
export async function discardUnregistered(storagePath: string): Promise<void> {
  await supabase.storage.from(STORAGE_TOOL_BUCKET).remove([storagePath]);
}
