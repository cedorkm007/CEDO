// ─────────────────────────────────────────────────────────────
// src/storagetool/copyItems.ts
// Copies files and folders into another folder. The stored file is copied by the storage service itself (nothing is downloaded), then registered
// like an upload, so the usual rules apply: a taken name gets " (1)", and the 200 GB limit is checked by the database. A copied folder becomes a
// new folder (named "Reports (1)" if "Reports" is taken there) with copies of everything inside.
// ─────────────────────────────────────────────────────────────
import { createFolder } from "./storageToolApi";
import { copyStoredFile, fetchSubtree } from "./storageToolOrganizeApi";
import { planFolderCopy, type ItemKind } from "./storageToolLogic";

export interface CopySource { kind: ItemKind; id: string; name: string; storagePath?: string; mimeType?: string }
export interface CopyOutcome { copiedFiles: number; copiedFolders: number; failed: string[]; cancelled: boolean }

export async function copyItems(sources: CopySource[], targetFolderId: string | null, onProgress: (percent: number) => void, signal: AbortSignal): Promise<CopyOutcome> {
  const out: CopyOutcome = { copiedFiles: 0, copiedFolders: 0, failed: [], cancelled: false };
  // First work out everything that has to be copied, so the progress bar can be honest.
  const jobs: { name: string; storagePath: string; mimeType: string; target: () => string | null | undefined }[] = [];   // undefined: the folder it belongs to could not be made, so skip it
  const folderMake: { run: () => Promise<boolean> }[] = [];
  for (const s of sources) {
    if (s.kind === "file") { jobs.push({ name: s.name, storagePath: s.storagePath ?? "", mimeType: s.mimeType ?? "", target: () => targetFolderId }); continue; }
    const tree = await fetchSubtree(s.id);
    if (!tree.ok) { out.failed.push(`${s.name}: ${tree.error}`); continue; }
    const plan = planFolderCopy(s.id, tree.value);
    const made = new Map<string, string>();   // old folder id -> the new folder's id
    for (const f of plan.folders) {
      folderMake.push({
        run: async () => {
          if (f.parentId !== null && !made.has(f.parentId)) { out.failed.push(`${f.name}: its parent folder could not be copied`); return false; }
          const parent = f.parentId === null ? targetFolderId : made.get(f.parentId)!;
          const r = await createFolder(parent, f.name);
          if (!r.ok) { out.failed.push(`${f.name}: ${r.error}`); return false; }
          made.set(f.id, r.value.id); out.copiedFolders++; return true;
        },
      });
    }
    for (const file of plan.files) jobs.push({ name: file.name, storagePath: file.storagePath, mimeType: file.mimeType, target: () => (file.folderId ? made.get(file.folderId) : targetFolderId) });
  }
  const steps = folderMake.length + jobs.length;
  let done = 0;
  const tick = () => onProgress(steps === 0 ? 100 : Math.min(99, Math.round((++done / steps) * 100)));
  // Folders first (in order: parents before children), then the files.
  for (const make of folderMake) {
    if (signal.aborted) { out.cancelled = true; return out; }
    await make.run();
    tick();
  }
  for (const j of jobs) {
    if (signal.aborted) { out.cancelled = true; return out; }
    const target = j.target();
    if (target === undefined) { out.failed.push(`${j.name}: its folder could not be copied`); tick(); continue; }
    const r = await copyStoredFile({ storagePath: j.storagePath, name: j.name, mimeType: j.mimeType }, target);
    if (r.ok) out.copiedFiles++; else out.failed.push(`${j.name}: ${r.error}`);
    tick();
  }
  onProgress(100);
  return out;
}
