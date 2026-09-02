import { useEffect, useMemo, useState } from "react";
import { Check, X, RotateCcw } from "lucide-react";
import { fetchSignWords, type SignWord } from "../kaubanPublicApi";
import { KaubanPageHeader } from "../components/KaubanPageHeader";
import { KaubanVideo } from "../components/KaubanVideo";

const QUESTION_COUNT = 10;
const KID_FONT = { fontFamily: "'Fredoka', sans-serif" };

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

interface Question {
  word: SignWord;
  choices: string[]; // labels, shuffled, includes the correct one
}

function buildQuiz(pool: SignWord[]): Question[] {
  const questionWords = shuffle(pool).slice(0, Math.min(QUESTION_COUNT, pool.length));
  return questionWords.map(word => {
    const distractors = shuffle(pool.filter(w => w.id !== word.id)).slice(0, 3).map(w => w.label);
    return { word, choices: shuffle([word.label, ...distractors]) };
  });
}

/**
 * Watch a sign's clip video, pick which word it means from 4 choices.
 * Question pool is every kauban_sign_word — same staff-managed content
 * the Sign Language browse screen and Speech-to-Sign-Language use, not a
 * separate quiz-only dataset.
 */
export function SignLanguageQuizPage() {
  const [pool, setPool] = useState<SignWord[]>([]);
  const [loading, setLoading] = useState(true);
  const [quiz, setQuiz] = useState<Question[] | null>(null);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [score, setScore] = useState(0);

  useEffect(() => {
    (async () => {
      setPool(await fetchSignWords());
      setLoading(false);
    })();
  }, []);

  const current = quiz?.[index] ?? null;
  const finished = quiz !== null && index >= quiz.length;

  function startQuiz() {
    setQuiz(buildQuiz(pool));
    setIndex(0);
    setScore(0);
    setSelected(null);
  }

  function handleAnswer(choice: string) {
    if (selected || !current) return;
    setSelected(choice);
    if (choice === current.word.label) setScore(s => s + 1);
  }

  function handleNext() {
    setSelected(null);
    setIndex(i => i + 1);
  }

  const canQuiz = useMemo(() => pool.length >= 4, [pool]);

  return (
    <div className="rounded-[20px] bg-[#F7FAFC] p-4 shadow-xl sm:p-10">
      <KaubanPageHeader title="Sign Language Quiz" subtitle="Watch the sign, pick the right word." />

        {loading && <p className="py-8 text-center text-sm text-[#718096]">Loading…</p>}

        {!loading && !canQuiz && (
          <p className="py-8 text-center text-sm text-[#718096]">Not enough sign words have been added yet for a quiz.</p>
        )}

        {!loading && canQuiz && !quiz && (
          <div className="rounded-3xl bg-white p-8 text-center shadow-sm">
            <p className="mb-4 text-sm text-[#718096]">{Math.min(QUESTION_COUNT, pool.length)} questions, multiple choice.</p>
            <button onClick={startQuiz} className="min-h-12 rounded-full bg-[#3182CE] px-8 py-3 text-sm font-bold text-white transition active:scale-95">
              Start Quiz
            </button>
          </div>
        )}

        {quiz && !finished && current && (
          <div className="rounded-3xl bg-white p-4 shadow-sm sm:p-5">
            <p className="mb-3 text-center text-xs font-semibold text-[#A0AEC0]">Question {index + 1} of {quiz.length} · Score {score}</p>
            <KaubanVideo
              path={current.word.clipVideoPath ?? current.word.tutorialVideoPath}
              className="mx-auto mb-4 max-h-[240px] w-full rounded-2xl bg-black"
              autoPlay
              cropTopPercent={27}
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {current.choices.map(choice => {
                const isCorrect = choice === current.word.label;
                const isSelected = choice === selected;
                const showResult = selected !== null;
                return (
                  <button
                    key={choice}
                    onClick={() => handleAnswer(choice)}
                    disabled={selected !== null}
                    className={`flex min-h-[52px] items-center justify-between gap-2 rounded-2xl border-2 px-4 py-3 text-left text-sm font-semibold transition-all duration-150 active:scale-[0.97]
                      ${!showResult ? "border-[#3182CE]/15 bg-white text-[#2D3748] sm:hover:border-[#3182CE]" : ""}
                      ${showResult && isCorrect ? "border-emerald-500 bg-emerald-50 text-emerald-700" : ""}
                      ${showResult && isSelected && !isCorrect ? "border-red-400 bg-red-50 text-red-600" : ""}
                      ${showResult && !isCorrect && !isSelected ? "border-transparent bg-white text-[#A0AEC0]" : ""}`}
                  >
                    {choice}
                    {showResult && isCorrect && <Check size={16} />}
                    {showResult && isSelected && !isCorrect && <X size={16} />}
                  </button>
                );
              })}
            </div>

            {selected && (
              <button onClick={handleNext} className="mt-5 min-h-12 w-full rounded-full bg-[#3182CE] py-2.5 text-sm font-bold text-white transition active:scale-[0.97]">
                {index + 1 < quiz.length ? "Next Question" : "See Results"}
              </button>
            )}
          </div>
        )}

        {finished && quiz && (
          <div className="rounded-3xl bg-white p-8 text-center shadow-sm">
            <p className="text-3xl font-bold text-[#2D3748]" style={KID_FONT}>{score} / {quiz.length}</p>
            <p className="mt-1 text-sm text-[#718096]">correct</p>
            <button onClick={startQuiz} className="mt-5 flex min-h-12 w-full items-center justify-center gap-1.5 rounded-full bg-[#3182CE] py-2.5 text-sm font-bold text-white transition active:scale-[0.97]">
              <RotateCcw size={15} /> Try Again
            </button>
          </div>
        )}
    </div>
  );
}
