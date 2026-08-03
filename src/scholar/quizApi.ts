import { supabase } from "@/lib/supabase";
import type { QuizSubject, QuizTopic, QuizQuestion, QuizSubmitResult, QuizResultItem } from "./types";

export async function fetchQuizSubjects(): Promise<QuizSubject[]> {
  const { data, error } = await supabase.from("quest_subjects").select("id, name").order("name");
  if (error || !data) return [];
  return data.map(s => ({ id: s.id, name: s.name }));
}

/**
 * Attempts are tracked and capped PER TOPIC (not aggregated across a whole
 * subject) — that's what lets each topic have its own daily attempt limit.
 * attemptsUsedToday/maxAttemptsPerDay are computed here client-side from
 * the scholar's own scores (already readable under existing RLS — "scholar
 * reads own quest scores"), same approach the old subject-level version
 * used, just grouped by topic_id instead of subject_id.
 */
export async function fetchQuizTopics(subjectId: string, scholarIdNumber: string): Promise<QuizTopic[]> {
  const [{ data: subject }, { data: topics, error: topicsError }, { data: todayScores }] = await Promise.all([
    supabase.from("quest_subjects").select("max_attempts_per_day").eq("id", subjectId).maybeSingle(),
    supabase.from("quest_topics").select("id, subject_id, name, max_attempts_per_day, youtube_url").eq("subject_id", subjectId).order("name"),
    supabase.from("scholar_quest_scores")
      .select("topic_id")
      .eq("scholar_id_number", scholarIdNumber)
      .eq("subject_id", subjectId)
      .eq("date_taken", new Date().toISOString().slice(0, 10)),
  ]);
  if (topicsError || !topics) return [];

  const usedTodayByTopic = new Map<string, number>();
  for (const row of todayScores ?? []) {
    if (!row.topic_id) continue;
    usedTodayByTopic.set(row.topic_id, (usedTodayByTopic.get(row.topic_id) ?? 0) + 1);
  }

  const subjectDefault = Number(subject?.max_attempts_per_day ?? 1);

  return topics.map(t => ({
    id: t.id, subjectId: t.subject_id, name: t.name,
    youtubeUrl: t.youtube_url ?? "",
    maxAttemptsPerDay: t.max_attempts_per_day === null || t.max_attempts_per_day === undefined ? subjectDefault : Number(t.max_attempts_per_day),
    attemptsUsedToday: usedTodayByTopic.get(t.id) ?? 0,
  }));
}

export async function startQuizAttempt(topicId: string): Promise<
  { ok: true; questions: QuizQuestion[]; attemptsUsedToday: number; maxAttemptsPerDay: number } | { ok: false; error: string }
> {
  const { data, error } = await supabase.rpc("start_quiz_attempt", { p_topic_id: topicId });
  if (error) return { ok: false, error: error.message };
  if (!data?.ok) return { ok: false, error: data?.error ?? "Couldn't start the quiz." };
  return {
    ok: true,
    questions: (data.questions ?? []).map((q: Record<string, unknown>) => ({
      id: q.id, questionText: q.questionText, points: Number(q.points),
      choices: (q.choices as Record<string, unknown>[] ?? []).map(c => ({ id: String(c.id), choiceText: String(c.choiceText) })),
    })),
    attemptsUsedToday: data.attemptsUsedToday, maxAttemptsPerDay: data.maxAttemptsPerDay,
  };
}

export async function submitQuizAttempt(
  topicId: string, answers: { questionId: string; choiceId: string | null }[]
): Promise<{ ok: true; result: QuizSubmitResult } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("submit_quiz_attempt", {
    p_topic_id: topicId,
    p_answers: answers.map(a => ({ questionId: a.questionId, choiceId: a.choiceId })),
  });
  if (error) return { ok: false, error: error.message };
  if (!data?.ok) return { ok: false, error: data?.error ?? "Couldn't submit the quiz." };

  const results: QuizResultItem[] = (data.results ?? []).map((r: Record<string, unknown>) => ({
    questionId: String(r.questionId),
    questionText: String(r.questionText),
    explanation: String(r.explanation ?? ""),
    isCorrect: !!r.isCorrect,
    selectedChoiceId: r.selectedChoiceId ? String(r.selectedChoiceId) : null,
    choices: (r.choices as Record<string, unknown>[] ?? []).map(c => ({
      id: String(c.id), choiceText: String(c.choiceText), isCorrect: !!c.isCorrect,
    })),
  }));

  return {
    ok: true,
    result: {
      score: Number(data.score), maxScore: Number(data.maxScore),
      results, attemptsUsedToday: data.attemptsUsedToday, maxAttemptsPerDay: data.maxAttemptsPerDay,
    },
  };
}

/**
 * Pulls a YouTube video ID out of any of the common URL shapes a staff
 * member might paste in (watch?v=, youtu.be/, embed/, shorts/), so the
 * scholar-facing player can build a same-page embed instead of a link that
 * would send them to youtube.com.
 */
export function extractYouTubeId(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([\w-]{11})/,
    /(?:youtu\.be\/)([\w-]{11})/,
    /(?:youtube\.com\/embed\/)([\w-]{11})/,
    /(?:youtube\.com\/shorts\/)([\w-]{11})/,
  ];
  for (const p of patterns) {
    const m = trimmed.match(p);
    if (m) return m[1];
  }
  // Bare 11-character video ID pasted with nothing else around it.
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed;
  return null;
}
