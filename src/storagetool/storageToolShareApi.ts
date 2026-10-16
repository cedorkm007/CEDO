// ─────────────────────────────────────────────────────────────
// src/storagetool/storageToolShareApi.ts
// Phase 3 calls: browsing a folder that is mine or shared with me, sharing with other staff, and the upload-only links for the public
// (supabase_migration_storage_tool_p3.sql). Every rule is decided by the database; the lock key is turned into a hash in the browser, so the key
// itself is never sent to or stored by the database.
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";
import { hashLockKey } from "../../supabase/functions/_shared/storageToolPublic";
import type { Loaded, PathEntry } from "./storageToolApi";
import type { ItemKind, ListedFile, ListedFolder } from "./storageToolLogic";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));
const strOrNull = (v: unknown) => (v == null ? null : String(v));

/** 4 = owner, 3 = edit, 2 = upload, 1 = view. */
export type AccessLevel = 1 | 2 | 3 | 4;
export const LEVEL_TEXT: Record<AccessLevel, string> = { 4: "You own this", 3: "You can view, add and change things", 2: "You can view and add files", 1: "You can only view" };
export type Permission = "view" | "upload" | "edit";
export const PERMISSION_TEXT: Record<Permission, string> = { view: "Can view", upload: "Can add files", edit: "Can edit" };
export const PERMISSION_HELP: Record<Permission, string> = {
  view: "See, preview, download, and copy into their own storage.",
  upload: "Also add files and folders. They cannot rename, move or delete.",
  edit: "Also rename, move and delete things inside it. Deleted items go to your Trash.",
};

export interface BrowseResult { level: AccessLevel; ownerId: string; ownerName: string; path: PathEntry[]; folders: ListedFolder[]; files: ListedFile[] }

/** The contents of a folder that is mine (null = the top of my storage) or shared with me. */
export async function fetchBrowse(folderId: string | null): Promise<Loaded<BrowseResult>> {
  const { data, error } = await supabase.rpc("storage_tool_browse", { p_folder_id: folderId });
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't open the folder." };
  const d = data as { level?: number; owner_id?: string; owner_name?: string; path?: Row[]; folders?: Row[]; files?: Row[] };
  return {
    ok: true,
    value: {
      level: Math.min(4, Math.max(1, Number(d.level ?? 4))) as AccessLevel, ownerId: str(d.owner_id), ownerName: str(d.owner_name),
      path: (d.path ?? []).map(r => ({ id: str(r.id), name: str(r.name) })),
      folders: (d.folders ?? []).map(r => ({ id: str(r.id), name: str(r.name), createdAt: str(r.created_at), updatedAt: str(r.updated_at) })),
      files: (d.files ?? []).map(r => ({ id: str(r.id), name: str(r.name), sizeBytes: Number(r.size_bytes ?? 0), mimeType: str(r.mime_type), storagePath: str(r.storage_path), uploaderLabel: str(r.uploader_label), createdAt: str(r.created_at), modifiedAt: str(r.modified_at) })),
    },
  };
}

export interface SharedItem { kind: ItemKind; id: string; name: string; permission: Permission; ownerName: string; sizeBytes: number; mimeType: string; storagePath: string; sharedAt: string }
export async function fetchSharedWithMe(): Promise<Loaded<SharedItem[]>> {
  const { data, error } = await supabase.rpc("storage_tool_shared_with_me");
  if (error) return { ok: false, error: error.message };
  return { ok: true, value: ((data ?? []) as Row[]).map(r => ({ kind: r.kind as ItemKind, id: str(r.id), name: str(r.name), permission: r.permission as Permission, ownerName: str(r.owner_name), sizeBytes: Number(r.size_bytes ?? 0), mimeType: str(r.mime_type), storagePath: str(r.storage_path), sharedAt: str(r.shared_at) })) };
}

// ── Sharing with staff ──
export interface StaffMatch { id: string; name: string; username: string }
export async function searchStaff(query: string): Promise<Loaded<StaffMatch[]>> {
  const { data, error } = await supabase.rpc("storage_tool_staff_search", { p_query: query });
  if (error) return { ok: false, error: error.message };
  return { ok: true, value: ((data ?? []) as Row[]).map(r => ({ id: str(r.id), name: str(r.name), username: str(r.username) })) };
}
export interface ShareRow { userId: string; name: string; username: string; permission: Permission; since: string }
export async function fetchSharesOf(kind: ItemKind, id: string): Promise<Loaded<ShareRow[]>> {
  const { data, error } = await supabase.rpc("storage_tool_shares_of", { p_kind: kind, p_id: id });
  if (error) return { ok: false, error: error.message };
  return { ok: true, value: ((data ?? []) as Row[]).map(r => ({ userId: str(r.user_id), name: str(r.name), username: str(r.username), permission: r.permission as Permission, since: str(r.since) })) };
}
export async function setShare(kind: ItemKind, id: string, userId: string, permission: Permission): Promise<Loaded<true>> {
  const { error } = await supabase.rpc("storage_tool_share_set", { p_kind: kind, p_id: id, p_user: userId, p_permission: permission });
  return error ? { ok: false, error: error.message } : { ok: true, value: true };
}
export async function removeShare(kind: ItemKind, id: string, userId: string): Promise<Loaded<true>> {
  const { error } = await supabase.rpc("storage_tool_share_remove", { p_kind: kind, p_id: id, p_user: userId });
  return error ? { ok: false, error: error.message } : { ok: true, value: true };
}

// ── Upload links ──
export type LinkStatus = "active" | "paused" | "revoked" | "expired";
export interface LinkInfo {
  id: string; folderId: string; folderName: string; location: string; token: string; title: string; instructions: string; status: LinkStatus; hasLock: boolean; expiresAt: string | null;
  maxFilesPerPerson: number | null; maxFileMb: number; allowedTypes: string[]; requireEmail: boolean; requirePhone: boolean; allowSubfolders: boolean; createdAt: string; uploads: number; visitors: number;
}
const toLink = (r: Row): LinkInfo => ({
  id: str(r.id), folderId: str(r.folder_id), folderName: str(r.folder_name), location: str(r.location), token: str(r.token), title: str(r.title), instructions: str(r.instructions), status: r.status as LinkStatus,
  hasLock: !!r.has_lock, expiresAt: strOrNull(r.expires_at), maxFilesPerPerson: r.max_files_per_person == null ? null : Number(r.max_files_per_person), maxFileMb: Number(r.max_file_mb ?? 50),
  allowedTypes: ((r.allowed_types ?? []) as unknown[]).map(str), requireEmail: !!r.require_email, requirePhone: !!r.require_phone, allowSubfolders: !!r.allow_subfolders,
  createdAt: str(r.created_at), uploads: Number(r.uploads ?? 0), visitors: Number(r.visitors ?? 0),
});

/** The address people open (the site's own address + the link's code). */
export const linkAddress = (token: string): string => `${window.location.origin}/upload/${token}`;

export interface LinkSettings {
  title: string; instructions: string; expiresAt: string | null; maxFilesPerPerson: number | null; maxFileMb: number; allowedTypes: string[];
  requireEmail: boolean; requirePhone: boolean; allowSubfolders: boolean;
  /** undefined = keep the lock key as it is; "" = remove it; any other text = the new lock key. */
  lockKey?: string;
}
async function toSettingsJson(s: LinkSettings): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {
    title: s.title, instructions: s.instructions, expires_at: s.expiresAt ?? "", max_files_per_person: s.maxFilesPerPerson === null ? "" : s.maxFilesPerPerson, max_file_mb: s.maxFileMb,
    allowed_types: s.allowedTypes, require_email: s.requireEmail, require_phone: s.requirePhone, allow_subfolders: s.allowSubfolders,
  };
  if (s.lockKey !== undefined) out.lock_hash = s.lockKey === "" ? "" : await hashLockKey(s.lockKey);
  return out;
}
export async function createLink(folderId: string, settings: LinkSettings): Promise<Loaded<LinkInfo>> {
  const { data, error } = await supabase.rpc("storage_tool_link_create", { p_folder_id: folderId, p_settings: await toSettingsJson(settings) });
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't make the link." };
  return { ok: true, value: toLink(data as Row) };
}
export async function updateLink(id: string, settings: LinkSettings): Promise<Loaded<LinkInfo>> {
  const { data, error } = await supabase.rpc("storage_tool_link_update", { p_id: id, p_settings: await toSettingsJson(settings) });
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't save the link." };
  return { ok: true, value: toLink(data as Row) };
}
export async function setLinkStatus(id: string, status: "active" | "paused" | "revoked"): Promise<Loaded<LinkInfo>> {
  const { data, error } = await supabase.rpc("storage_tool_link_set_status", { p_id: id, p_status: status });
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't change the link." };
  return { ok: true, value: toLink(data as Row) };
}
export async function fetchLinks(folderId: string | null = null): Promise<Loaded<LinkInfo[]>> {
  const { data, error } = await supabase.rpc("storage_tool_links_list", { p_folder_id: folderId });
  if (error) return { ok: false, error: error.message };
  return { ok: true, value: ((data ?? []) as Row[]).map(toLink) };
}
export interface LinkVisitor { name: string; email: string; phone: string; firstAt: string; lastAt: string | null; files: number }
export async function fetchLinkVisitors(id: string): Promise<Loaded<LinkVisitor[]>> {
  const { data, error } = await supabase.rpc("storage_tool_link_visitors", { p_id: id });
  if (error) return { ok: false, error: error.message };
  return { ok: true, value: ((data ?? []) as Row[]).map(r => ({ name: str(r.name), email: str(r.email), phone: str(r.phone), firstAt: str(r.first_at), lastAt: strOrNull(r.last_at), files: Number(r.files ?? 0) })) };
}
