// ─────────────────────────────────────────────────────────────
// src/storagetool/storageToolLogic.ts
// The pure rules of the Storage Tool (no database, no browser): sizes in words, which files can be previewed in the page, what a file is called in
// the type column, the upload size check, sorting, and the planning of a whole-folder upload. Tested in Node by tests/storage-tool/run.mjs.
// The database decides everything that matters (who may use the tool, names, the real size); these only help the screen explain it.
// ─────────────────────────────────────────────────────────────

/** Up to this size a file is sent in one go; bigger files are sent in 6 MB pieces that can resume after a bad connection (what Supabase asks for). */
export const SMALL_UPLOAD_BYTES = 6 * 1024 * 1024;
export const UPLOAD_CHUNK_BYTES = 6 * 1024 * 1024;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  const text = i === 0 ? String(Math.round(n)) : n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1).replace(/\.0$/, "") : n.toFixed(2).replace(/0$/, "").replace(/\.0$/, "");
  return `${text} ${units[i]}`;
}

export type PreviewKind = "image" | "pdf" | "video" | "audio";

const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", avif: "image/avif", bmp: "image/bmp",
  pdf: "application/pdf", mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", ogv: "video/ogg", mov: "video/quicktime",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv", txt: "text/plain", zip: "application/zip",
};
export const extensionOf = (name: string): string => { const i = name.lastIndexOf("."); return i > 0 && i < name.length - 1 ? name.slice(i + 1).toLowerCase() : ""; };

/** The type used for deciding (the stored type, or the one the extension implies when the stored one is missing or generic). */
export function effectiveMime(mime: string, name: string): string {
  const m = (mime || "").toLowerCase().split(";")[0].trim();
  if (m && m !== "application/octet-stream") return m;
  return EXT_MIME[extensionOf(name)] ?? "application/octet-stream";
}

/**
 * Which files open inside the page. Only kinds that cannot run anything: images (NOT SVG), PDF, video and audio. Web pages, SVG and everything
 * else are never shown inline: they get an icon and a Download button.
 */
export function previewKind(mime: string, name: string): PreviewKind | null {
  const m = effectiveMime(mime, name);
  if (m === "image/svg+xml") return null;
  if (m.startsWith("image/") && ["jpeg", "png", "gif", "webp", "avif", "bmp"].includes(m.slice(6))) return "image";
  if (m === "application/pdf") return "pdf";
  if (["video/mp4", "video/webm", "video/ogg", "video/quicktime"].includes(m)) return "video";
  if (["audio/mpeg", "audio/wav", "audio/ogg", "audio/mp4", "audio/aac", "audio/flac", "audio/x-wav", "audio/webm"].includes(m)) return "audio";
  return null;
}

/** The short name shown in the "Type" column and used to pick an icon. */
export function typeLabel(mime: string, name: string): string {
  const m = effectiveMime(mime, name);
  if (m.startsWith("image/")) return "Image";
  if (m === "application/pdf") return "PDF";
  if (m.startsWith("video/")) return "Video";
  if (m.startsWith("audio/")) return "Audio";
  if (m.includes("wordprocessingml") || m === "application/msword") return "Word";
  if (m.includes("spreadsheetml") || m === "application/vnd.ms-excel" || m === "text/csv") return "Excel";
  if (m.includes("presentationml") || m === "application/vnd.ms-powerpoint") return "PowerPoint";
  if (m === "application/zip" || m === "application/x-zip-compressed") return "ZIP";
  if (m.startsWith("text/")) return "Text";
  const ext = extensionOf(name);
  return ext ? ext.toUpperCase() : "File";
}

/** What is wrong with a file before it is sent, or null. (The database checks the real size again afterwards.) */
export function validateUpload(file: { name: string; size: number }, maxBytes: number): string | null {
  if (file.size <= 0) return `“${file.name}” is empty, so it was not uploaded.`;
  if (file.size > maxBytes) return `“${file.name}” is ${formatBytes(file.size)}, which is more than the allowed ${formatBytes(maxBytes)}.`;
  return null;
}

export type SortKey = "name" | "date" | "size" | "type";
export interface ListedFolder { id: string; name: string; createdAt: string; updatedAt: string }
export interface ListedFile { id: string; name: string; sizeBytes: number; mimeType: string; storagePath: string; uploaderLabel: string; createdAt: string; modifiedAt: string }

const byText = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** Folders always come first; inside each group the chosen order. */
export function sortFolders(rows: ListedFolder[], key: SortKey, dir: "asc" | "desc"): ListedFolder[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => sign * (key === "date" ? a.updatedAt.localeCompare(b.updatedAt) : byText(a.name, b.name)) || byText(a.name, b.name));
}
export function sortFiles(rows: ListedFile[], key: SortKey, dir: "asc" | "desc"): ListedFile[] {
  const sign = dir === "asc" ? 1 : -1;
  const cmp = (a: ListedFile, b: ListedFile) => key === "date" ? a.modifiedAt.localeCompare(b.modifiedAt)
    : key === "size" ? a.sizeBytes - b.sizeBytes
    : key === "type" ? byText(typeLabel(a.mimeType, a.name), typeLabel(b.mimeType, b.name))
    : byText(a.name, b.name);
  return [...rows].sort((a, b) => sign * cmp(a, b) || byText(a.name, b.name));
}

// ── Whole-folder upload ─────────────────────────────────────
export interface PickedFile { file: File; relativePath: string }
export interface PlannedFile { file: File; dirs: string[]; name: string }
export interface UploadPlan { dirs: string[][]; files: PlannedFile[]; skipped: string[] }

/** Splits "Reports/2026/a.pdf" into its folders and the file name; slashes of both kinds, empty parts and "." / ".." are dropped. */
export function splitRelativePath(relativePath: string): { dirs: string[]; name: string } {
  const parts = relativePath.split(/[\\/]+/).map(p => p.trim()).filter(p => p !== "" && p !== "." && p !== "..");
  const name = parts.pop() ?? "";
  return { dirs: parts, name };
}

/**
 * Turns what the person picked or dropped into a plan: the folders to make (outer ones first, each once) and the files with the folder path they
 * belong in. Files that cannot be uploaded (empty, too big) are listed in `skipped` with the reason. Nothing is uploaded here.
 */
export function planUpload(picked: PickedFile[], maxBytes: number): UploadPlan {
  const files: PlannedFile[] = [], skipped: string[] = [];
  const seen = new Set<string>(), dirs: string[][] = [];
  for (const p of picked) {
    const { dirs: d, name } = splitRelativePath(p.relativePath || p.file.name);
    if (!name) continue;
    const problem = validateUpload({ name, size: p.file.size }, maxBytes);
    if (problem) { skipped.push(problem); continue; }
    files.push({ file: p.file, dirs: d, name });
    for (let i = 1; i <= d.length; i++) { const key = d.slice(0, i).join("\u0000"); if (!seen.has(key)) { seen.add(key); dirs.push(d.slice(0, i)); } }
  }
  dirs.sort((a, b) => a.length - b.length);
  return { dirs, files, skipped };
}

/** The percentage of a whole queue (finished files count as 100, the others by their own progress). */
export function queueProgress(jobs: { progress: number; status: string }[]): number {
  const live = jobs.filter(j => j.status !== "cancelled");
  if (live.length === 0) return 0;
  return Math.round(live.reduce((sum, j) => sum + (j.status === "done" ? 100 : j.status === "error" ? 0 : j.progress), 0) / live.length);
}

/** "3 of 10 uploaded" style line for the tray's header. */
export function queueSummary(jobs: { status: string }[]): string {
  const total = jobs.filter(j => j.status !== "cancelled").length;
  const done = jobs.filter(j => j.status === "done").length;
  const failed = jobs.filter(j => j.status === "error").length;
  if (total === 0) return "Nothing to upload";
  return `${done} of ${total} uploaded${failed ? ` · ${failed} failed` : ""}`;
}

// ─────────────────────────────────────────────────────────────
// Phase 2: selecting, moving, copying, ZIP downloads, Trash
// ─────────────────────────────────────────────────────────────
export type ItemKind = "file" | "folder";
export interface ItemRef { kind: ItemKind; id: string }
export const itemKey = (kind: ItemKind, id: string): string => `${kind === "folder" ? "d" : "f"}:${id}`;
export function parseItemKey(key: string): ItemRef | null {
  const m = /^([df]):([0-9a-f-]{36})$/i.exec(key);
  return m ? { kind: m[1].toLowerCase() === "d" ? "folder" : "file", id: m[2] } : null;
}

/** A ZIP of more than this is refused (the ZIP is built in the browser's memory). */
export const ZIP_LIMIT_BYTES = 500 * 1024 * 1024;

export interface TreeFolder { id: string; parentId: string | null; name: string }
export interface TreeNode extends TreeFolder { children: TreeNode[] }

/** The flat list of folders as a tree (siblings by name, numbers in order). */
export function buildFolderTree(rows: TreeFolder[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>(rows.map(r => [r.id, { ...r, children: [] }]));
  const roots: TreeNode[] = [];
  for (const n of nodes.values()) { const parent = n.parentId ? nodes.get(n.parentId) : undefined; (parent ? parent.children : roots).push(n); }
  const sort = (list: TreeNode[]) => { list.sort((a, b) => byText(a.name, b.name)); list.forEach(n => sort(n.children)); };
  sort(roots);
  return roots;
}

/** The folder itself and every folder inside it. */
export function folderAndDescendants(rows: TreeFolder[], rootId: string): Set<string> {
  const out = new Set<string>([rootId]);
  let grew = true;
  while (grew) { grew = false; for (const r of rows) if (r.parentId && out.has(r.parentId) && !out.has(r.id)) { out.add(r.id); grew = true; } }
  return out;
}

/** Folders that cannot be the target of a move: the folders being moved and everything inside them (the database refuses these too). */
export function blockedMoveTargets(rows: TreeFolder[], movingFolderIds: string[]): Set<string> {
  const blocked = new Set<string>();
  for (const id of movingFolderIds) for (const x of folderAndDescendants(rows, id)) blocked.add(x);
  return blocked;
}

/** One part of a path inside a ZIP: characters Windows does not allow become "_", and it never ends with a dot or space. */
export function zipSegment(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/[. ]+$/, "").trim();
  return cleaned || "_";
}

export interface FlatFile { id: string; folderId: string | null; name: string; sizeBytes: number; mimeType: string; storagePath: string }
export interface SubtreeData { folders: TreeFolder[]; files: FlatFile[] }
export interface ZipEntry { path: string; storagePath: string; sizeBytes: number }

/** The files of a folder as ZIP entries, with the folder's own name as the first part of every path ("Reports/2026/a.pdf"). */
export function zipEntriesForFolder(rootId: string, data: SubtreeData, prefix: string[] = []): ZipEntry[] {
  const byId = new Map(data.folders.map(f => [f.id, f]));
  const pathOf = (folderId: string | null): string[] => {
    const parts: string[] = [];
    let cursor = folderId ? byId.get(folderId) : undefined;
    while (cursor) { parts.unshift(zipSegment(cursor.name)); if (cursor.id === rootId) break; cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined; }
    return [...prefix, ...parts];
  };
  return data.files.map(f => ({ path: [...pathOf(f.folderId), zipSegment(f.name)].join("/"), storagePath: f.storagePath, sizeBytes: f.sizeBytes }));
}

/** The name of the ZIP: the folder's name for a single folder, else a general name. */
export function zipFileName(picked: { kind: ItemKind; name: string }[]): string {
  if (picked.length === 1 && picked[0].kind === "folder") return `${zipSegment(picked[0].name)}.zip`;
  return "Storage Tool download.zip";
}

export function zipProblem(entries: { sizeBytes: number }[]): string | null {
  if (entries.length === 0) return "There is no file to download in what you chose.";
  const total = entries.reduce((s, e) => s + e.sizeBytes, 0);
  return total > ZIP_LIMIT_BYTES ? `Everything you chose is ${formatBytes(total)}, which is more than the ${formatBytes(ZIP_LIMIT_BYTES)} one ZIP can hold. Please download it in smaller parts.` : null;
}

/** What copying a folder needs: the folders to make (parents first, with the path of names inside the copy) and each file with its folder. */
export function planFolderCopy(rootId: string, data: SubtreeData): { folders: { id: string; parentId: string | null; name: string }[]; files: FlatFile[] } {
  const inside = folderAndDescendants(data.folders, rootId);
  const depth = (id: string): number => { let d = 0, cur = data.folders.find(f => f.id === id); while (cur && cur.id !== rootId) { d++; cur = data.folders.find(f => f.id === cur!.parentId); } return d; };
  const folders = data.folders.filter(f => inside.has(f.id)).sort((a, b) => depth(a.id) - depth(b.id) || byText(a.name, b.name));
  return { folders: folders.map(f => ({ id: f.id, parentId: f.id === rootId ? null : f.parentId, name: f.name })), files: data.files.filter(f => f.folderId && inside.has(f.folderId)) };
}

/** How long an item stays in Trash: "Deleted forever today", "… tomorrow", "… in 12 days". */
export function trashCountdown(daysLeft: number): string {
  if (daysLeft <= 0) return "Deleted forever today";
  if (daysLeft === 1) return "Deleted forever tomorrow";
  return `Deleted forever in ${daysLeft} days`;
}

export function countWords(n: number, one: string, many: string): string { return `${n} ${n === 1 ? one : many}`; }
