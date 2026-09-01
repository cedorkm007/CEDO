import { useEffect, useState } from "react";
import { Play, Trash2, Video, FileVideo, X, Pencil, Check } from "lucide-react";
import {
  fetchSignCategories, fetchSignWords, getVideoPublicUrl, deleteSignWordVideo, deleteSignWord, updateSignWord,
  type SignCategory, type SignWord, type SignVideoVariant,
} from "./kaubanAdminApi";

const VARIANT_LABEL: Record<SignVideoVariant, string> = { clip: "Clip", tutorial: "Tutorial" };

/**
 * Monitoring view over everything uploaded so far (via BatchVideoUpload
 * or otherwise), grouped by category so it's easy to spot which words are
 * still missing a clip or a tutorial video. Also where an admin edits a
 * word's label/matching-phrase/category, removes a video that's wrong or
 * outdated, or deletes a whole word that shouldn't exist anymore.
 */
export function VideoLibrary() {
  const [categories, setCategories] = useState<SignCategory[]>([]);
  const [words, setWords] = useState<SignWord[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");

  const [editingWordId, setEditingWordId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editPhrase, setEditPhrase] = useState("");
  const [editCategoryId, setEditCategoryId] = useState("");

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    const [categoryList, wordList] = await Promise.all([fetchSignCategories(), fetchSignWords()]);
    setCategories(categoryList);
    setWords(wordList);
    setLoading(false);
  }

  async function handleDeleteVideo(word: SignWord, variant: SignVideoVariant, path: string) {
    if (!window.confirm(`Delete the ${VARIANT_LABEL[variant].toLowerCase()} video for "${word.label}"? This can't be undone.`)) return;
    const key = `${word.id}:${variant}`;
    setBusyKey(key);
    setError("");
    const result = await deleteSignWordVideo(word.id, variant, path);
    setBusyKey(null);
    if (!result.ok) { setError(result.error); return; }
    if (previewKey === key) setPreviewKey(null);
    setWords(prev => prev.map(w => (w.id === word.id ? { ...w, [variant === "clip" ? "clipVideoPath" : "tutorialVideoPath"]: null } : w)));
  }

  function startEditWord(word: SignWord) {
    setEditingWordId(word.id);
    setEditLabel(word.label);
    setEditPhrase(word.phrase);
    setEditCategoryId(word.categoryId);
  }

  async function handleSaveWord(id: string) {
    if (!editLabel.trim() || !editPhrase.trim()) { setError("Label and phrase can't be empty."); return; }
    setBusyKey(id);
    setError("");
    const result = await updateSignWord(id, { label: editLabel, phrase: editPhrase, categoryId: editCategoryId });
    setBusyKey(null);
    if (!result.ok) { setError(result.error); return; }
    setEditingWordId(null);
    await load();
  }

  async function handleDeleteWord(word: SignWord) {
    if (!window.confirm(`Delete "${word.label}" entirely, including its video(s)? This can't be undone.`)) return;
    setBusyKey(word.id);
    setError("");
    const result = await deleteSignWord(word);
    setBusyKey(null);
    if (!result.ok) { setError(result.error); return; }
    setWords(prev => prev.filter(w => w.id !== word.id));
  }

  if (loading) return <p className="py-8 text-center text-sm text-slate-400">Loading video library…</p>;

  if (words.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-400">No sign words yet — upload some videos first.</p>;
  }

  return (
    <div className="space-y-5">
      {error && <p className="rounded-lg bg-red-50 p-3 text-[12px] text-red-700">{error}</p>}

      {categories.map(category => {
        const categoryWords = words.filter(w => w.categoryId === category.id);
        if (categoryWords.length === 0) return null;
        const clipCount = categoryWords.filter(w => w.clipVideoPath).length;
        const tutorialCount = categoryWords.filter(w => w.tutorialVideoPath).length;

        return (
          <div key={category.id} className="rounded-2xl border border-[#062444]/10 bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#062444]">{category.label}</h3>
              <span className="text-[11px] text-slate-400">
                {categoryWords.length} word{categoryWords.length === 1 ? "" : "s"} · {clipCount}/{categoryWords.length} clips · {tutorialCount}/{categoryWords.length} tutorials
              </span>
            </div>

            <div className="space-y-2">
              {categoryWords.map(word => (
                <div key={word.id} className="rounded-lg border border-[#e6ecf5] p-2.5">
                  {editingWordId === word.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <input value={editLabel} onChange={e => setEditLabel(e.target.value)} placeholder="Label" className="min-w-[120px] flex-1 rounded-md border border-[#062444]/15 px-2 py-1.5 text-[13px]" />
                      <input value={editPhrase} onChange={e => setEditPhrase(e.target.value)} placeholder="Matching phrase" className="min-w-[140px] flex-1 rounded-md border border-[#062444]/15 px-2 py-1.5 text-[13px]" />
                      <select value={editCategoryId} onChange={e => setEditCategoryId(e.target.value)} className="rounded-md border border-[#062444]/15 px-2 py-1.5 text-[13px]">
                        {categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                      </select>
                      <button onClick={() => void handleSaveWord(word.id)} disabled={busyKey === word.id} className="shrink-0 rounded-md bg-[#062444] p-1.5 text-white disabled:opacity-50" aria-label="Save word"><Check size={14} /></button>
                      <button onClick={() => setEditingWordId(null)} className="shrink-0 text-slate-400 hover:text-slate-600" aria-label="Cancel"><X size={14} /></button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="min-w-[140px] flex-1">
                        <p className="text-[13px] font-semibold text-[#062444]">{word.label}</p>
                        <p className="text-[11px] text-slate-400">"{word.phrase}"</p>
                      </div>

                      <VideoSlot
                        word={word} variant="clip" path={word.clipVideoPath}
                        previewKey={previewKey} setPreviewKey={setPreviewKey}
                        busy={busyKey === `${word.id}:clip`}
                        onDelete={() => void handleDeleteVideo(word, "clip", word.clipVideoPath!)}
                      />
                      <VideoSlot
                        word={word} variant="tutorial" path={word.tutorialVideoPath}
                        previewKey={previewKey} setPreviewKey={setPreviewKey}
                        busy={busyKey === `${word.id}:tutorial`}
                        onDelete={() => void handleDeleteVideo(word, "tutorial", word.tutorialVideoPath!)}
                      />

                      <button
                        onClick={() => startEditWord(word)}
                        className="shrink-0 rounded-md p-1.5 text-slate-300 hover:bg-[#0088cc]/10 hover:text-[#0088cc]"
                        title="Edit this word"
                        aria-label={`Edit ${word.label}`}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => void handleDeleteWord(word)}
                        disabled={busyKey === word.id}
                        className="shrink-0 rounded-md p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                        title="Delete this word entirely"
                        aria-label={`Delete ${word.label} entirely`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}

                  {(previewKey === `${word.id}:clip` || previewKey === `${word.id}:tutorial`) && (
                    <div className="mt-2.5 flex items-start justify-between gap-2 rounded-lg bg-[#f8fafd] p-2">
                      <video
                        key={previewKey}
                        src={getVideoPublicUrl(previewKey === `${word.id}:clip` ? word.clipVideoPath! : word.tutorialVideoPath!)}
                        controls autoPlay muted className="max-h-[220px] rounded-md"
                      />
                      <button onClick={() => setPreviewKey(null)} className="shrink-0 text-slate-400 hover:text-slate-600" aria-label="Close preview"><X size={16} /></button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function VideoSlot({ word, variant, path, previewKey, setPreviewKey, busy, onDelete }: {
  word: SignWord; variant: SignVideoVariant; path: string | null;
  previewKey: string | null; setPreviewKey: (key: string | null) => void;
  busy: boolean; onDelete: () => void;
}) {
  const key = `${word.id}:${variant}`;

  if (!path) {
    return (
      <div className="flex w-[150px] shrink-0 items-center gap-1.5 rounded-md border border-dashed border-slate-200 px-2 py-1.5 text-[11px] text-slate-300">
        <Video size={12} />{VARIANT_LABEL[variant]}: not uploaded
      </div>
    );
  }

  return (
    <div className="flex w-[150px] shrink-0 items-center gap-1 rounded-md border border-[#e6ecf5] bg-[#f8fafd] px-2 py-1.5">
      <FileVideo size={12} className="shrink-0 text-[#0088cc]" />
      <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-[#062444]">{VARIANT_LABEL[variant]}</span>
      <button onClick={() => setPreviewKey(previewKey === key ? null : key)} className="shrink-0 text-[#0088cc] hover:opacity-70" aria-label={`Preview ${VARIANT_LABEL[variant]} video`}>
        <Play size={13} />
      </button>
      <button onClick={onDelete} disabled={busy} className="shrink-0 text-slate-400 hover:text-red-600 disabled:opacity-50" aria-label={`Delete ${VARIANT_LABEL[variant]} video`}>
        <Trash2 size={13} />
      </button>
    </div>
  );
}
