import { useEffect, useState } from "react";
import { Volume2 } from "lucide-react";
import { fetchQuickPhraseCategories, fetchQuickPhrases, type QuickPhraseCategory, type QuickPhrase } from "../kaubanPublicApi";
import { speakText } from "../speechSynthesis";
import { KaubanPageHeader } from "../components/KaubanPageHeader";

/**
 * Tap a phrase to show it large (for someone nearby to read) and have it
 * spoken aloud at the same time — the built-in phrase list is
 * staff-managed (src/kauban/admin/QuickPhrasesManager.tsx), there's no
 * per-visitor custom list since there are no accounts.
 */
export function QuickPhrasesPage({ onBack }: { onBack: () => void }) {
  const [categories, setCategories] = useState<QuickPhraseCategory[]>([]);
  const [phrases, setPhrases] = useState<QuickPhrase[]>([]);
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [categoryList, phraseList] = await Promise.all([fetchQuickPhraseCategories(), fetchQuickPhrases()]);
      setCategories(categoryList);
      setPhrases(phraseList);
      setLoading(false);
    })();
  }, []);

  function handleTapPhrase(text: string) {
    setCurrent(text);
    speakText(text);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#059669] to-[#2563EB] p-4 sm:p-8">
      <div className="mx-auto max-w-3xl rounded-[20px] bg-[#F7FAFC] p-6 shadow-xl sm:p-10">
        <KaubanPageHeader title="Quick Phrases" subtitle="Tap a phrase to show and speak it." onBack={onBack} />

        {current && (
          <div className="mb-6 flex items-center justify-between gap-3 rounded-2xl bg-[#3182CE] px-6 py-6 text-white shadow-lg">
            <p className="text-2xl font-bold sm:text-3xl">{current}</p>
            <button
              onClick={() => speakText(current)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 hover:bg-white/25"
              aria-label="Speak again"
            >
              <Volume2 size={20} />
            </button>
          </div>
        )}

        {loading && <p className="py-8 text-center text-sm text-[#718096]">Loading phrases…</p>}

        {!loading && categories.length === 0 && (
          <p className="py-8 text-center text-sm text-[#718096]">No quick phrases have been added yet.</p>
        )}

        <div className="space-y-6">
          {categories.map(category => {
            const categoryPhrases = phrases.filter(p => p.categoryId === category.id);
            if (categoryPhrases.length === 0) return null;
            return (
              <div key={category.id}>
                <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-[#2D3748]">
                  <span aria-hidden>{category.icon}</span>{category.name}
                </h2>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {categoryPhrases.map(phrase => (
                    <button
                      key={phrase.id}
                      onClick={() => handleTapPhrase(phrase.text)}
                      className="rounded-xl border-2 bg-white px-4 py-3 text-left text-sm font-semibold text-[#2D3748] shadow-sm transition hover:shadow-md focus:outline-none focus-visible:ring-4 focus-visible:ring-[#3182CE]/30"
                      style={{ borderColor: current === phrase.text ? category.color : "transparent" }}
                    >
                      {phrase.text}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
