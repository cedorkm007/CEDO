// ─────────────────────────────────────────────────────────────
// src/storagetool/zipDownload.ts
// Downloads several files, or a whole folder, as ONE ZIP made in the browser (the ZIP library is loaded only when it is needed). The files are
// fetched through temporary links, so nothing about this is public. A ZIP is limited to 500 MB (see ZIP_LIMIT_BYTES in storageToolLogic.ts).
// ─────────────────────────────────────────────────────────────
import { fetchSubtree } from "./storageToolOrganizeApi";
import { fileLinks } from "./storageToolOrganizeApi";
import { zipEntriesForFolder, zipProblem, zipSegment, type ItemKind, type ZipEntry } from "./storageToolLogic";

export interface ZipSource { kind: ItemKind; id: string; name: string; storagePath?: string; sizeBytes?: number }
export type ZipResult = { ok: true; fileCount: number } | { ok: false; error: string; cancelled?: boolean };

/** Every file of the chosen items with its path inside the ZIP (a chosen folder keeps its own name and structure). */
export async function collectZipEntries(sources: ZipSource[]): Promise<{ ok: true; entries: ZipEntry[] } | { ok: false; error: string }> {
  const entries: ZipEntry[] = [];
  const taken = new Map<string, number>();
  const unique = (path: string) => {   // two chosen items with the same name (from different folders) must not overwrite each other inside the ZIP
    const n = (taken.get(path.toLowerCase()) ?? 0) + 1;
    taken.set(path.toLowerCase(), n);
    if (n === 1) return path;
    const dot = path.lastIndexOf("."), slash = path.lastIndexOf("/");
    return dot > slash + 1 ? `${path.slice(0, dot)} (${n - 1})${path.slice(dot)}` : `${path} (${n - 1})`;
  };
  for (const s of sources) {
    if (s.kind === "file") { entries.push({ path: unique(zipSegment(s.name)), storagePath: s.storagePath ?? "", sizeBytes: s.sizeBytes ?? 0 }); continue; }
    const tree = await fetchSubtree(s.id);
    if (!tree.ok) return { ok: false, error: tree.error };
    for (const e of zipEntriesForFolder(s.id, tree.value, [])) entries.push({ ...e, path: unique(e.path) });
  }
  return { ok: true, entries };
}

export async function downloadAsZip(entries: ZipEntry[], zipName: string, onProgress: (percent: number) => void, signal: AbortSignal): Promise<ZipResult> {
  const problem = zipProblem(entries);
  if (problem) return { ok: false, error: problem };
  const links = await fileLinks([...new Set(entries.map(e => e.storagePath))]);
  if (!links.ok) return { ok: false, error: links.error };
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const total = entries.reduce((s, e) => s + Math.max(e.sizeBytes, 1), 0);
  let done = 0;
  for (const e of entries) {
    if (signal.aborted) return { ok: false, error: "Cancelled.", cancelled: true };
    const url = links.value.get(e.storagePath);
    if (!url) return { ok: false, error: `“${e.path}” could not be opened.` };
    let blob: Blob;
    try {
      const res = await fetch(url, { signal });
      if (!res.ok) return { ok: false, error: `“${e.path}” could not be downloaded (${res.status}).` };
      blob = await res.blob();
    } catch {
      return signal.aborted ? { ok: false, error: "Cancelled.", cancelled: true } : { ok: false, error: `“${e.path}” could not be downloaded. Please try again.` };
    }
    zip.file(e.path, blob, { binary: true });
    done += Math.max(e.sizeBytes, 1);
    onProgress(Math.min(95, Math.round((done / total) * 95)));
  }
  if (signal.aborted) return { ok: false, error: "Cancelled.", cancelled: true };
  const out = await zip.generateAsync({ type: "blob", compression: "STORE", streamFiles: true }, meta => onProgress(95 + Math.round(meta.percent / 20)));
  const a = document.createElement("a");
  const href = URL.createObjectURL(out);
  a.href = href; a.download = zipName; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 30_000);
  onProgress(100);
  return { ok: true, fileCount: entries.length };
}
