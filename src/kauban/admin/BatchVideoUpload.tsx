import { useEffect, useState } from "react";
import { UploadCloud, Trash2, Plus, Loader2, CheckCircle2, AlertCircle, Film } from "lucide-react";
import {
  fetchSignCategories, createSignCategory, uploadSignWordVideo,
  normalizeVideoFilename, normalizePhrase,
  type SignCategory, type SignVideoVariant,
} from "./kaubanAdminApi";
import { compressVideo, preloadFFmpeg } from "./videoCompression";

type RowStatus = "pending" | "compressing" | "uploading" | "done" | "error";

interface BatchRow {
  id: string;
  file: File;
  label: string;
  phrase: string;
  phraseTouched: boolean;
  status: RowStatus;
  progress: number; // 0..1, compression progress
  compressedSize?: number;
  error?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "good_morning-clip.MP4" -> "Good morning clip" — a starting guess only;
 *  the admin edits both Label and Phrase before running the batch. */
function guessLabel(filename: string): string {
  const dot = filename.lastIndexOf(".");
  const base = dot === -1 ? filename : filename.slice(0, dot);
  const words = base.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Batch video uploader for the Kauban Sign Words library: pick many .mp4
 * files at once, each gets compressed in-browser (see videoCompression.ts)
 * before it's uploaded to the kauban-media Storage bucket and linked to a
 * kauban_sign_words row. One run covers one category + one video variant
 * (clip or tutorial) — run it again for the other variant of the same
 * words and they land on the same rows (matched by phrase), not
 * duplicates.
 */
export function BatchVideoUpload() {
  const [categories, setCategories] = useState<SignCategory[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryLabel, setNewCategoryLabel] = useState("");
  const [categoryError, setCategoryError] = useState("");
  const [variant, setVariant] = useState<SignVideoVariant>("clip");
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [running, setRunning] = useState(false);
  const [engineReady, setEngineReady] = useState(false);

  useEffect(() => {
    void loadCategories();
    // Fetching the ~32MB compression engine takes a few seconds on first
    // use — start it now, while the admin is still picking files/entering
    // labels, instead of stalling the first file in the batch with no
    // visible reason.
    void preloadFFmpeg().then(() => setEngineReady(true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadCategories() {
    const list = await fetchSignCategories();
    setCategories(list);
    if (!categoryId && list.length > 0) setCategoryId(list[0].id);
  }

  async function handleAddCategory() {
    if (!newCategoryLabel.trim()) { setCategoryError("Enter a category name."); return; }
    setCategoryError("");
    const key = newCategoryLabel.trim().toLowerCase().replace(/\s+/g, "_");
    const result = await createSignCategory(key, newCategoryLabel.trim());
    if (!result.ok) { setCategoryError(result.error); return; }
    await loadCategories();
    setCategoryId(result.id);
    setNewCategoryLabel("");
    setAddingCategory(false);
  }

  function handleChooseFiles(fileList: FileList | null) {
    if (!fileList) return;
    const newRows: BatchRow[] = Array.from(fileList)
      .filter(file => file.type === "video/mp4" || file.name.toLowerCase().endsWith(".mp4"))
      .map(file => {
        const label = guessLabel(file.name);
        return {
          id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
          file, label, phrase: normalizePhrase(label), phraseTouched: false,
          status: "pending", progress: 0,
        };
      });
    setRows(prev => [...prev, ...newRows]);
  }

  function updateRow(id: string, patch: Partial<BatchRow>) {
    setRows(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)));
  }

  function removeRow(id: string) {
    setRows(prev => prev.filter(r => r.id !== id));
  }

  async function handleRunBatch() {
    if (!categoryId) { return; }
    setRunning(true);
    for (const row of rows) {
      if (row.status === "done") continue; // don't redo work already finished in a prior run
      try {
        updateRow(row.id, { status: "compressing", progress: 0, error: undefined });
        const compressed = await compressVideo(row.file, {
          onProgress: ratio => updateRow(row.id, { progress: ratio }),
        });
        updateRow(row.id, { status: "uploading", compressedSize: compressed.compressedSize });

        const normalizedName = normalizeVideoFilename(row.file.name);
        const uploadFile = new File([compressed.blob], normalizedName, { type: "video/mp4" });
        const result = await uploadSignWordVideo({
          phrase: normalizePhrase(row.phrase),
          label: row.label.trim(),
          categoryId,
          variant,
          file: uploadFile,
        });

        if (!result.ok) { updateRow(row.id, { status: "error", error: result.error }); continue; }
        updateRow(row.id, { status: "done" });
      } catch (err) {
        // ffmpeg.wasm rejects with a plain string (see its worker.js:
        // `data: e.toString()`), not an Error instance — checking
        // `instanceof Error` here would silently swallow every real
        // ffmpeg failure behind a useless generic message.
        const message = err instanceof Error ? err.message : typeof err === "string" ? err : "Compression failed.";
        updateRow(row.id, { status: "error", error: message });
      }
    }
    setRunning(false);
  }

  const doneCount = rows.filter(r => r.status === "done").length;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-[#062444]/10 bg-white p-5">
        <h3 className="mb-3 text-sm font-bold text-[#062444]">1. Category &amp; variant</h3>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px]">
            <label className="mb-1 block text-[11px] font-semibold text-slate-500">Sign category</label>
            {addingCategory ? (
              <div className="flex items-center gap-2">
                <input
                  value={newCategoryLabel}
                  onChange={e => setNewCategoryLabel(e.target.value)}
                  placeholder="e.g. Family"
                  className="w-full rounded-lg border border-[#062444]/15 px-3 py-2 text-sm outline-none focus:border-[#0088cc]"
                />
                <button onClick={() => void handleAddCategory()} className="shrink-0 rounded-lg bg-[#062444] px-3 py-2 text-xs font-bold text-white">Add</button>
                <button onClick={() => { setAddingCategory(false); setCategoryError(""); }} className="shrink-0 text-xs text-slate-400 hover:underline">Cancel</button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <select
                  value={categoryId}
                  onChange={e => setCategoryId(e.target.value)}
                  className="w-full rounded-lg border border-[#062444]/15 px-3 py-2 text-sm outline-none focus:border-[#0088cc]"
                >
                  {categories.length === 0 && <option value="">No categories yet</option>}
                  {categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
                <button onClick={() => setAddingCategory(true)} className="flex shrink-0 items-center gap-1 rounded-lg border border-[#062444]/15 px-2.5 py-2 text-xs font-semibold text-[#062444] hover:bg-[#f0f7fc]">
                  <Plus size={13} /> New
                </button>
              </div>
            )}
            {categoryError && <p className="mt-1 text-[11px] text-red-600">{categoryError}</p>}
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-500">Video type</label>
            <div className="flex gap-2">
              <button
                onClick={() => setVariant("clip")}
                className={`rounded-lg border px-3 py-2 text-xs font-bold ${variant === "clip" ? "border-[#062444] bg-[#062444] text-white" : "border-[#e6ecf5] text-slate-500"}`}
              >
                Quick clip (muted, played live)
              </button>
              <button
                onClick={() => setVariant("tutorial")}
                className={`rounded-lg border px-3 py-2 text-xs font-bold ${variant === "tutorial" ? "border-[#062444] bg-[#062444] text-white" : "border-[#e6ecf5] text-slate-500"}`}
              >
                Tutorial (longer)
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-[#062444]/10 bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-[#062444]">2. Choose videos</h3>
          {!engineReady && (
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[#0088cc]">
              <Loader2 size={12} className="animate-spin" />Preparing compression engine…
            </span>
          )}
        </div>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-[#062444]/25 bg-[#f8fafd] px-4 py-6 text-sm font-semibold text-[#0088cc] hover:bg-[#f0f7fc]">
          <UploadCloud size={18} />
          Select one or more .mp4 files
          <input type="file" accept="video/mp4,.mp4" multiple className="hidden" onChange={e => handleChooseFiles(e.target.files)} />
        </label>

        {rows.length > 0 && (
          <div className="mt-4 space-y-2">
            {rows.map(row => (
              <div key={row.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-[#e6ecf5] p-2.5">
                <Film size={14} className="shrink-0 text-slate-400" />
                <span className="min-w-0 max-w-[160px] shrink-0 truncate text-[11px] text-slate-400" title={row.file.name}>{row.file.name}</span>

                <input
                  value={row.label}
                  onChange={e => {
                    const label = e.target.value;
                    updateRow(row.id, { label, phrase: row.phraseTouched ? row.phrase : normalizePhrase(label) });
                  }}
                  placeholder="Label (e.g. Good Morning)"
                  disabled={running}
                  className="min-w-[140px] flex-1 rounded-md border border-[#062444]/15 px-2 py-1.5 text-xs outline-none focus:border-[#0088cc] disabled:bg-slate-50"
                />
                <input
                  value={row.phrase}
                  onChange={e => updateRow(row.id, { phrase: e.target.value, phraseTouched: true })}
                  placeholder="Matching phrase (e.g. good morning)"
                  disabled={running}
                  className="min-w-[160px] flex-1 rounded-md border border-[#062444]/15 px-2 py-1.5 text-xs outline-none focus:border-[#0088cc] disabled:bg-slate-50"
                />

                <div className="flex w-[150px] shrink-0 items-center justify-end gap-1.5 text-[11px]">
                  {row.status === "pending" && <span className="text-slate-400">{formatBytes(row.file.size)}</span>}
                  {row.status === "compressing" && <span className="flex items-center gap-1 text-[#0088cc]"><Loader2 size={12} className="animate-spin" />Compressing {Math.round(row.progress * 100)}%</span>}
                  {row.status === "uploading" && <span className="flex items-center gap-1 text-[#0088cc]"><Loader2 size={12} className="animate-spin" />Uploading…</span>}
                  {row.status === "done" && (
                    <span className="flex items-center gap-1 text-emerald-600">
                      <CheckCircle2 size={12} />
                      {row.compressedSize ? `${formatBytes(row.file.size)} → ${formatBytes(row.compressedSize)}` : "Done"}
                    </span>
                  )}
                  {row.status === "error" && <span className="flex items-center gap-1 text-red-600" title={row.error}><AlertCircle size={12} />Failed</span>}
                </div>

                {!running && (
                  <button onClick={() => removeRow(row.id)} className="shrink-0 text-slate-300 hover:text-red-600" aria-label="Remove"><Trash2 size={14} /></button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {rows.some(r => r.status === "error") && (
        <div className="rounded-lg bg-red-50 p-3 text-[12px] text-red-700">
          {rows.filter(r => r.status === "error").map(r => (
            <div key={r.id}><strong>{r.file.name}</strong>: {r.error}</div>
          ))}
        </div>
      )}

      <button
        onClick={() => void handleRunBatch()}
        disabled={running || rows.length === 0 || !categoryId}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#062444] py-3 text-sm font-semibold text-white disabled:opacity-50"
      >
        {running ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />}
        {running ? `Processing… (${doneCount}/${rows.length} done)` : `Compress & Upload ${rows.length || ""} Video${rows.length === 1 ? "" : "s"}`}
      </button>
      <p className="text-center text-[11px] text-slate-400">
        Compression runs in your browser and can take a while for many files — keep this tab open until it finishes.
      </p>
    </div>
  );
}
