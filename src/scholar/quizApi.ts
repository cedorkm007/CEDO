import { supabase } from "@/lib/supabase";
import type { QuizSubject, QuizTopic, QuizQuestion, QuizSubmitResult } from "./types";

/** Subjects with today's attempt count computed client-side from the
 *  scholar's own scores (already readable under existing RLS — "scholar
 *  reads own quest scores"), so no extra RPC is needed just for this. */
export async function fetchQuizSubjects(scholarIdNumber: string): Promise<QuizSubject[]> {
  const [{ data: subjects, error: subjectsError }, { data: todayScores }] = await Promise.all([
    supabase.from("quest_subjects").select("id, name, max_attempts_per_day").order("name"),
    supabase.from("scholar_quest_scores")
      .select("subject_id")
      .eq("scholar_id_number", scholarIdNumber)
      .eq("date_taken", new Date().toISOString().slice(0, 10)),
  ]);
  if (subjectsError || !subjects) return [];

  const usedTodayBySubject = new Map<string, number>();
  for (const row of todayScores ?? []) {
    if (!row.subject_id) continue;
    usedTodayBySubject.set(row.subject_id, (usedTodayBySubject.get(row.subject_id) ?? 0) + 1);
  }

  return subjects.map(s => ({
    id: s.id, name: s.name, maxAttemptsPerDay: Number(s.max_attempts_per_day ?? 1),
    attemptsUsedToday: usedTodayBySubject.get(s.id) ?? 0,
  }));
}

export async function fetchQuizTopics(subjectId: string): Promise<QuizTopic[]> {
  const { data, error } = await supabase.from("quest_topics").select("id, subject_id, name").eq("subject_id", subjectId).order("name");
  if (error || !data) return [];
  return data.map(t => ({ id: t.id, subjectId: t.subject_id, name: t.name }));
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
  return {
    ok: true,
    result: {
      score: Number(data.score), maxScore: Number(data.maxScore),
      results: data.results ?? [], attemptsUsedToday: data.attemptsUsedToday, maxAttemptsPerDay: data.maxAttemptsPerDay,
    },
  };
}
