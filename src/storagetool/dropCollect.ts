// ─────────────────────────────────────────────────────────────
// src/storagetool/dropCollect.ts
// Reads what was dropped on the page (files and whole folders) or chosen in the "Upload folder" box into a flat list of files with the folder path
// each one belongs in. Browser only. Whole-folder drops use the browser's folder reader (Chrome, Edge and Firefox; Safari support is partial).
// ─────────────────────────────────────────────────────────────
import type { PickedFile } from "./storageToolLogic";

interface FsEntry { isFile: boolean; isDirectory: boolean; name: string; fullPath: string; file?: (ok: (f: File) => void, fail: (e: unknown) => void) => void; createReader?: () => { readEntries: (ok: (e: FsEntry[]) => void, fail: (e: unknown) => void) => void } }

async function readAll(entry: FsEntry, out: PickedFile[]): Promise<void> {
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((ok, fail) => entry.file!(ok, fail));
    out.push({ file, relativePath: entry.fullPath.replace(/^\/+/, "") });
  } else if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    for (;;) {   // a folder is read in batches until an empty batch comes back
      const batch = await new Promise<FsEntry[]>((ok, fail) => reader.readEntries(ok, fail));
      if (batch.length === 0) break;
      for (const child of batch) await readAll(child, out);
    }
  }
}

/** Files and folders from a drop. */
export async function collectDropped(dt: DataTransfer): Promise<PickedFile[]> {
  const out: PickedFile[] = [];
  const entries: FsEntry[] = [];
  for (const item of Array.from(dt.items ?? [])) {
    const entry = item.kind === "file" ? (item as DataTransferItem & { webkitGetAsEntry?: () => FsEntry | null }).webkitGetAsEntry?.() : null;
    if (entry) entries.push(entry);
  }
  if (entries.length > 0) { for (const e of entries) await readAll(e, out); return out; }
  return Array.from(dt.files ?? []).map(file => ({ file, relativePath: file.name }));
}

/** Files from a normal "choose files" box or the "choose a folder" box (which carries each file's path). */
export function collectFromInput(files: FileList | null): PickedFile[] {
  return Array.from(files ?? []).map(file => ({ file, relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name }));
}
