import { useEffect, useState } from "react";
import { Play, Hand } from "lucide-react";
import { fetchSignCategories, fetchSignWords, type SignCategory, type SignWord } from "../kaubanPublicApi";
import { KaubanPageHeader } from "../components/KaubanPageHeader";
import { KaubanVideo } from "../components/KaubanVideo";

/**
 * Browse Filipino Sign Language by category, watch the tutorial video for
 * each word. Falls back to the shorter clip video if a word only has
 * that variant uploaded so far — either is better than nothing while
 * milestone 5's video migration is still pending.
 */
export function SignLanguagePage({ onBack }: { onBack: () => void }) {
  const [categories, setCategories] = useState<SignCategory[]>([]);
  const [words, setWords] = useState<SignWord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [categoryList, wordList] = await Promise.all([fetchSignCategories(), fetchSignWords()]);
      setCategories(categoryList);
      setWords(wordList);
      setLoading(false);
    })();
  }, []);

  const selected = words.find(w => w.id === selectedId) ?? null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#059669] to-[#2563EB] p-4 sm:p-8">
      <div className="mx-auto max-w-3xl rounded-[20px] bg-[#F7FAFC] p-6 shadow-xl sm:p-10">
        <KaubanPageHeader title="Sign Language" subtitle="Browse Filipino Sign Language by category." onBack={onBack} />

        {selected && (
          <div className="mb-6 rounded-2xl bg-white p-4 shadow-lg">
            <KaubanVideo
              path={selected.tutorialVideoPath ?? selected.clipVideoPath}
              className="max-h-[320px] w-full rounded-xl bg-black"
              autoPlay
            />
            <p className="mt-3 text-center text-lg font-bold text-[#2D3748]">{selected.label}</p>
          </div>
        )}

        {loading && <p className="py-8 text-center text-sm text-[#718096]">Loading…</p>}
        {!loading && words.length === 0 && (
          <p className="py-8 text-center text-sm text-[#718096]">No sign words have been added yet.</p>
        )}

        <div className="space-y-6">
          {categories.map(category => {
            const categoryWords = words.filter(w => w.categoryId === category.id);
            if (categoryWords.length === 0) return null;
            return (
              <div key={category.id}>
                <h2 className="mb-2 text-sm font-bold text-[#2D3748]">{category.label}</h2>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                  {categoryWords.map(word => (
                    <button
                      key={word.id}
                      onClick={() => setSelectedId(word.id)}
                      className={`flex flex-col items-center gap-2 rounded-xl border-2 bg-white p-4 text-center shadow-sm transition hover:shadow-md focus:outline-none focus-visible:ring-4 focus-visible:ring-[#3182CE]/30 ${selectedId === word.id ? "border-[#3182CE]" : "border-transparent"}`}
                    >
                      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#EBF8FF] text-[#2B6CB0]">
                        {selectedId === word.id ? <Play size={18} /> : <Hand size={18} />}
                      </span>
                      <span className="text-sm font-semibold text-[#2D3748]">{word.label}</span>
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
