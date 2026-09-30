import { supabase } from "@/lib/supabase";

export interface PresentationFolder {
  id: string;
  ownerId: string;
  parentFolderId: string | null;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface PresentationItem {
  id: string;
  ownerId: string;
  folderId: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface FolderContents {
  folders: PresentationFolder[];
  presentations: PresentationItem[];
}

export interface BreadcrumbEntry {
  id: string;
  name: string;
}

function rowToFolder(r: Record<string, unknown>): PresentationFolder {
  return {
    id: r.id as string,
    ownerId: r.owner_id as string,
    parentFolderId: (r.parent_folder_id as string | null) ?? null,
    name: r.name as string,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

function rowToPresentation(r: Record<string, unknown>): PresentationItem {
  return {
    id: r.id as string,
    ownerId: r.owner_id as string,
    folderId: (r.folder_id as string | null) ?? null,
    title: r.title as string,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/** Every folder and presentation directly inside `folderId` (null = root) that the signed-in staff member owns. */
export async function fetchFolderContents(folderId: string | null): Promise<FolderContents> {
  const ownerId = await currentUserId();
  if (!ownerId) return { folders: [], presentations: [] };

  let folderQuery = supabase.from("presentation_folders").select("*").eq("owner_id", ownerId);
  folderQuery = folderId === null ? folderQuery.is("parent_folder_id", null) : folderQuery.eq("parent_folder_id", folderId);
  let presentationQuery = supabase.from("presentations").select("*").eq("owner_id", ownerId);
  presentationQuery = folderId === null ? presentationQuery.is("folder_id", null) : presentationQuery.eq("folder_id", folderId);

  const [{ data: folderRows, error: folderError }, { data: presentationRows, error: presentationError }] = await Promise.all([
    folderQuery.order("name"),
    presentationQuery.order("title"),
  ]);
  if (folderError || presentationError) return { folders: [], presentations: [] };
  return {
    folders: (folderRows ?? []).map(rowToFolder),
    presentations: (presentationRows ?? []).map(rowToPresentation),
  };
}

/** Every folder the signed-in staff member owns, flat (no particular order) — used to build the "Move to…" folder-tree picker client-side. */
export async function fetchAllOwnedFolders(): Promise<PresentationFolder[]> {
  const ownerId = await currentUserId();
  if (!ownerId) return [];
  const { data, error } = await supabase.from("presentation_folders").select("*").eq("owner_id", ownerId);
  if (error || !data) return [];
  return data.map(rowToFolder);
}

/** Walks parent_folder_id up to the root, returning entries ordered root-first (excluding the root itself, which the caller renders as a fixed "My Presentations" crumb). */
export async function fetchBreadcrumbPath(folderId: string | null): Promise<BreadcrumbEntry[]> {
  if (folderId === null) return [];
  const all = await fetchAllOwnedFolders();
  const byId = new Map(all.map(f => [f.id, f]));
  const path: BreadcrumbEntry[] = [];
  let current = byId.get(folderId) ?? null;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift({ id: current.id, name: current.name });
    current = current.parentFolderId ? byId.get(current.parentFolderId) ?? null : null;
  }
  return path;
}

export async function createFolder(parentFolderId: string | null, name: string): Promise<{ ok: true; folder: PresentationFolder } | { ok: false; error: string }> {
  const ownerId = await currentUserId();
  if (!ownerId) return { ok: false, error: "Not signed in." };
  const { data, error } = await supabase.from("presentation_folders")
    .insert({ owner_id: ownerId, parent_folder_id: parentFolderId, name })
    .select("*").single();
  if (error || !data) return { ok: false, error: error?.message ?? "Failed to create folder." };
  return { ok: true, folder: rowToFolder(data) };
}

export async function renameFolder(id: string, name: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("presentation_folders").update({ name, updated_at: new Date().toISOString() }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function moveFolder(id: string, newParentFolderId: string | null): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("presentation_folders").update({ parent_folder_id: newParentFolderId, updated_at: new Date().toISOString() }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Deletes a folder and, via the parent_folder_id/folder_id FKs' on-delete-cascade, everything inside it (subfolders and presentations, recursively). */
export async function deleteFolder(id: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("presentation_folders").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function createPresentation(folderId: string | null): Promise<{ ok: true; presentation: PresentationItem } | { ok: false; error: string }> {
  const ownerId = await currentUserId();
  if (!ownerId) return { ok: false, error: "Not signed in." };
  const { data, error } = await supabase.from("presentations")
    .insert({ owner_id: ownerId, folder_id: folderId, title: "Untitled presentation" })
    .select("*").single();
  if (error || !data) return { ok: false, error: error?.message ?? "Failed to create presentation." };
  return { ok: true, presentation: rowToPresentation(data) };
}

export async function renamePresentation(id: string, title: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("presentations").update({ title, updated_at: new Date().toISOString() }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function movePresentation(id: string, newFolderId: string | null): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("presentations").update({ folder_id: newFolderId, updated_at: new Date().toISOString() }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Phase 1 has no slides yet, so duplicating just copies the presentation's own row (title + " (copy)") into the same folder — will extend to copy slides once the editor (Phase 2) exists. */
export async function duplicatePresentation(id: string): Promise<{ ok: boolean; error?: string }> {
  const ownerId = await currentUserId();
  if (!ownerId) return { ok: false, error: "Not signed in." };
  const { data: original, error: fetchError } = await supabase.from("presentations").select("*").eq("id", id).single();
  if (fetchError || !original) return { ok: false, error: fetchError?.message ?? "Presentation not found." };
  const { error } = await supabase.from("presentations")
    .insert({ owner_id: ownerId, folder_id: original.folder_id, title: `${original.title} (copy)` });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function deletePresentation(id: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("presentations").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** True if `candidateAncestorId` is `folderId` itself or one of its ancestors — used to stop a folder being dropped/moved into its own subtree before ever sending the request to the server. */
export function isFolderOrDescendant(all: PresentationFolder[], folderId: string, candidateId: string): boolean {
  const byId = new Map(all.map(f => [f.id, f]));
  let current: PresentationFolder | undefined = byId.get(candidateId);
  while (current) {
    if (current.id === folderId) return true;
    current = current.parentFolderId ? byId.get(current.parentFolderId) : undefined;
  }
  return false;
}
