import { useEffect, useState } from "react";
import { Plus, Trash2, Pencil, Check, X } from "lucide-react";
import {
  fetchQuickPhraseCategories, createQuickPhraseCategory, updateQuickPhraseCategory, deleteQuickPhraseCategory,
  fetchQuickPhrases, createQuickPhrase, updateQuickPhrase, deleteQuickPhrase,
  type QuickPhraseCategory, type QuickPhrase,
} from "./kaubanAdminApi";

const DEFAULT_COLOR = "#3B82F6";

/**
 * CRUD for the Quick Phrases screen's content — categories (name, emoji
 * icon, color) and the built-in phrases inside each. No per-user custom
 * phrases exist anymore (no accounts), so this shared list is the only
 * source for that screen.
 */
export function QuickPhrasesManager() {
  const [categories, setCategories] = useState<QuickPhraseCategory[]>([]);
  const [phrases, setPhrases] = useState<QuickPhrase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryIcon, setNewCategoryIcon] = useState("");
  const [newCategoryColor, setNewCategoryColor] = useState(DEFAULT_COLOR);

  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editIcon, setEditIcon] = useState("");
  const [editColor, setEditColor] = useState(DEFAULT_COLOR);

  const [newPhraseText, setNewPhraseText] = useState<Record<string, string>>({});
  const [editingPhraseId, setEditingPhraseId] = useState<string | null>(null);
  const [editPhraseText, setEditPhraseText] = useState("");

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    const [categoryList, phraseList] = await Promise.all([fetchQuickPhraseCategories(), fetchQuickPhrases()]);
    setCategories(categoryList);
    setPhrases(phraseList);
    setLoading(false);
  }

  async function handleAddCategory() {
    if (!newCategoryName.trim()) { setError("Enter a category name."); return; }
    setError("");
    const result = await createQuickPhraseCategory(newCategoryName, newCategoryIcon, newCategoryColor, categories.length);
    if (!result.ok) { setError(result.error); return; }
    setNewCategoryName(""); setNewCategoryIcon(""); setNewCategoryColor(DEFAULT_COLOR); setAddingCategory(false);
    await load();
  }

  function startEditCategory(category: QuickPhraseCategory) {
    setEditingCategoryId(category.id);
    setEditName(category.name); setEditIcon(category.icon ?? ""); setEditColor(category.color || DEFAULT_COLOR);
  }

  async function handleSaveCategory(id: string) {
    if (!editName.trim()) { setError("Category name can't be empty."); return; }
    setError("");
    const result = await updateQuickPhraseCategory(id, { name: editName, icon: editIcon, color: editColor });
    if (!result.ok) { setError(result.error); return; }
    setEditingCategoryId(null);
    await load();
  }

  async function handleDeleteCategory(category: QuickPhraseCategory) {
    const count = phrases.filter(p => p.categoryId === category.id).length;
    const warning = count > 0 ? ` and its ${count} phrase${count === 1 ? "" : "s"}` : "";
    if (!window.confirm(`Delete "${category.name}"${warning}? This can't be undone.`)) return;
    setError("");
    const result = await deleteQuickPhraseCategory(category.id);
    if (!result.ok) { setError(result.error); return; }
    await load();
  }

  async function handleAddPhrase(categoryId: string) {
    const text = newPhraseText[categoryId]?.trim();
    if (!text) return;
    setError("");
    const count = phrases.filter(p => p.categoryId === categoryId).length;
    const result = await createQuickPhrase(categoryId, text, count);
    if (!result.ok) { setError(result.error); return; }
    setNewPhraseText(prev => ({ ...prev, [categoryId]: "" }));
    await load();
  }

  async function handleSavePhrase(id: string) {
    if (!editPhraseText.trim()) { setError("Phrase can't be empty."); return; }
    setError("");
    const result = await updateQuickPhrase(id, editPhraseText);
    if (!result.ok) { setError(result.error); return; }
    setEditingPhraseId(null);
    await load();
  }

  async function handleDeletePhrase(phrase: QuickPhrase) {
    if (!window.confirm(`Delete "${phrase.text}"?`)) return;
    setError("");
    const result = await deleteQuickPhrase(phrase.id);
    if (!result.ok) { setError(result.error); return; }
    await load();
  }

  if (loading) return <p className="py-8 text-center text-sm text-slate-400">Loading quick phrases…</p>;

  return (
    <div className="space-y-5">
      {error && <p className="rounded-lg bg-red-50 p-3 text-[12px] text-red-700">{error}</p>}

      {categories.map(category => {
        const categoryPhrases = phrases.filter(p => p.categoryId === category.id);
        const isEditing = editingCategoryId === category.id;

        return (
          <div key={category.id} className="rounded-2xl border border-[#062444]/10 bg-white p-5">
            {isEditing ? (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <input value={editIcon} onChange={e => setEditIcon(e.target.value)} placeholder="👋" className="w-12 rounded-md border border-[#062444]/15 px-2 py-1.5 text-center text-sm" />
                <input value={editName} onChange={e => setEditName(e.target.value)} className="min-w-[140px] flex-1 rounded-md border border-[#062444]/15 px-2 py-1.5 text-sm" />
                <input type="color" value={editColor} onChange={e => setEditColor(e.target.value)} className="h-8 w-10 shrink-0 cursor-pointer rounded border border-[#062444]/15" />
                <button onClick={() => void handleSaveCategory(category.id)} className="shrink-0 rounded-md bg-[#062444] p-1.5 text-white" aria-label="Save category"><Check size={14} /></button>
                <button onClick={() => setEditingCategoryId(null)} className="shrink-0 text-slate-400 hover:text-slate-600" aria-label="Cancel"><X size={14} /></button>
              </div>
            ) : (
              <div className="mb-3 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-bold text-[#062444]">
                  <span aria-hidden>{category.icon}</span>{category.name}
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: category.color }} />
                </h3>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-400">{categoryPhrases.length} phrase{categoryPhrases.length === 1 ? "" : "s"}</span>
                  <button onClick={() => startEditCategory(category)} className="text-slate-400 hover:text-[#0088cc]" aria-label={`Edit ${category.name}`}><Pencil size={13} /></button>
                  <button onClick={() => void handleDeleteCategory(category)} className="text-slate-400 hover:text-red-600" aria-label={`Delete ${category.name}`}><Trash2 size={13} /></button>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              {categoryPhrases.map(phrase => (
                <div key={phrase.id} className="flex items-center gap-2 rounded-lg border border-[#e6ecf5] px-2.5 py-1.5">
                  {editingPhraseId === phrase.id ? (
                    <>
                      <input
                        value={editPhraseText} onChange={e => setEditPhraseText(e.target.value)} autoFocus
                        className="min-w-0 flex-1 rounded-md border border-[#062444]/15 px-2 py-1 text-[13px]"
                        onKeyDown={e => { if (e.key === "Enter") void handleSavePhrase(phrase.id); if (e.key === "Escape") setEditingPhraseId(null); }}
                      />
                      <button onClick={() => void handleSavePhrase(phrase.id)} className="shrink-0 text-[#0088cc]" aria-label="Save phrase"><Check size={14} /></button>
                      <button onClick={() => setEditingPhraseId(null)} className="shrink-0 text-slate-400" aria-label="Cancel"><X size={14} /></button>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-[#062444]">{phrase.text}</span>
                      <button onClick={() => { setEditingPhraseId(phrase.id); setEditPhraseText(phrase.text); }} className="shrink-0 text-slate-300 hover:text-[#0088cc]" aria-label="Edit phrase"><Pencil size={13} /></button>
                      <button onClick={() => void handleDeletePhrase(phrase)} className="shrink-0 text-slate-300 hover:text-red-600" aria-label="Delete phrase"><Trash2 size={13} /></button>
                    </>
                  )}
                </div>
              ))}

              <div className="flex items-center gap-2 pt-1">
                <input
                  value={newPhraseText[category.id] ?? ""}
                  onChange={e => setNewPhraseText(prev => ({ ...prev, [category.id]: e.target.value }))}
                  onKeyDown={e => { if (e.key === "Enter") void handleAddPhrase(category.id); }}
                  placeholder="Add a phrase…"
                  className="min-w-0 flex-1 rounded-md border border-dashed border-[#062444]/25 px-2.5 py-1.5 text-[13px] outline-none focus:border-[#0088cc]"
                />
                <button onClick={() => void handleAddPhrase(category.id)} className="shrink-0 rounded-md bg-[#062444]/5 p-1.5 text-[#062444] hover:bg-[#062444]/10" aria-label="Add phrase"><Plus size={14} /></button>
              </div>
            </div>
          </div>
        );
      })}

      <div className="rounded-2xl border border-dashed border-[#062444]/20 bg-[#f8fafd] p-5">
        {addingCategory ? (
          <div className="flex flex-wrap items-center gap-2">
            <input value={newCategoryIcon} onChange={e => setNewCategoryIcon(e.target.value)} placeholder="👋" className="w-12 rounded-md border border-[#062444]/15 px-2 py-1.5 text-center text-sm" />
            <input value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} placeholder="Category name" className="min-w-[140px] flex-1 rounded-md border border-[#062444]/15 px-2 py-1.5 text-sm" />
            <input type="color" value={newCategoryColor} onChange={e => setNewCategoryColor(e.target.value)} className="h-8 w-10 shrink-0 cursor-pointer rounded border border-[#062444]/15" />
            <button onClick={() => void handleAddCategory()} className="shrink-0 rounded-lg bg-[#062444] px-3 py-1.5 text-xs font-bold text-white">Add</button>
            <button onClick={() => setAddingCategory(false)} className="shrink-0 text-xs text-slate-400 hover:underline">Cancel</button>
          </div>
        ) : (
          <button onClick={() => setAddingCategory(true)} className="flex w-full items-center justify-center gap-1.5 text-sm font-semibold text-[#0088cc]">
            <Plus size={15} /> New Category
          </button>
        )}
      </div>
    </div>
  );
}
