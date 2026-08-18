import { supabase } from "@/lib/supabase";
import type { QuizSubject, QuizTopic, QuizQuestion, QuizSubmitResult, QuizResultItem } from "./types";

export async function fetchQuizSubjects(): Promise<QuizSubject[]> {
  const { data, error } = await supabase.from("quest_subjects").select("id, name, passing_rate_min, passing_rate_max, certificate_filename").order("name");
  if (error || !data) return [];
  return data.map(s => ({
    id: s.id, name: s.name,
    passingRateMin: Number(s.passing_rate_min ?? 75), passingRateMax: Number(s.passing_rate_max ?? 100),
    certificateFilename: s.certificate_filename ?? "",
  }));
}

/** The scholar's own aggregate percentage for a subject (best attempt per topic, averaged). */
export async function fetchOwnSubjectProgress(subjectId: string, scholarIdNumber: string): Promise<{ percentage: number; topicCount: number } | null> {
  const { data, error } = await supabase.from("scholar_subject_progress")
    .select("subject_percentage, topic_count").eq("subject_id", subjectId).eq("scholar_id_number", scholarIdNumber).maybeSingle();
  if (error || !data) return null;
  return { percentage: Number(data.subject_percentage ?? 0), topicCount: Number(data.topic_count ?? 0) };
}

/**
 * Storage RLS (not this function) is what actually decides whether this
 * succeeds — it only returns a signed URL if the scholar's own computed
 * percentage for the subject is within its passing_rate range. If they
 * haven't reached it yet, createSignedUrl simply fails.
 */
export async function fetchOwnCertificateUrl(subjectId: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  const { data, error } = await supabase.storage.from("subject-certificates").createSignedUrl(`${subjectId}/certificate.pdf`, 300);
  if (error || !data) return { ok: false, error: "You haven't reached the passing rate for this subject yet." };
  return { ok: true, url: data.signedUrl };
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
  const [{ data: subject }, { data: todayScores }] = await Promise.all([
    supabase.from("quest_subjects").select("max_attempts_per_day").eq("id", subjectId).maybeSingle(),
    supabase.from("scholar_quest_scores")
      .select("topic_id")
      .eq("scholar_id_number", scholarIdNumber)
      .eq("subject_id", subjectId)
      .eq("date_taken", new Date().toISOString().slice(0, 10)),
  ]);
  let { data: topics, error: topicsError } = await supabase.from("quest_topics")
    .select("id, subject_id, name, max_attempts_per_day, video_url, slide_url").eq("subject_id", subjectId).order("sort_order").order("name");
  // Existing Supabase projects may receive this app deployment before the
  // migration that adds sort_order. Keep their existing topics available.
  if (topicsError) {
    const fallback = await supabase.from("quest_topics")
      .select("id, subject_id, name, max_attempts_per_day, video_url, slide_url").eq("subject_id", subjectId).order("name");
    topics = fallback.data;
    topicsError = fallback.error;
  }
  if (topicsError || !topics) return [];

  const usedTodayByTopic = new Map<string, number>();
  for (const row of todayScores ?? []) {
    if (!row.topic_id) continue;
    usedTodayByTopic.set(row.topic_id, (usedTodayByTopic.get(row.topic_id) ?? 0) + 1);
  }

  const subjectDefault = Number(subject?.max_attempts_per_day ?? 1);

  return topics.map(t => ({
    id: t.id, subjectId: t.subject_id, name: t.name,
    videoUrl: t.video_url ?? "",
    slideUrl: t.slide_url ?? "",
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

export type LectureEmbed = {
  provider: "youtube" | "google-drive";
  src: string;
};

/**
 * Returns a safe, embeddable player URL for the lecture links staff can add
 * to a topic. Google Drive's normal share URLs open a Drive page, so they
 * must be changed to its `/preview` player URL before being used in an iframe.
 */
export function getLectureEmbed(url: string): LectureEmbed | null {
  const youtubeId = extractYouTubeId(url);
  if (youtubeId) {
    return { provider: "youtube", src: `https://www.youtube.com/embed/${youtubeId}` };
  }

  try {
    const parsed = new URL(url.trim());
    const isGoogleDrive = parsed.hostname === "drive.google.com" || parsed.hostname === "docs.google.com";
    if (!isGoogleDrive) return null;

    // Supports the common Drive share URLs, including /file/d/<id>/view,
    // open?id=<id>, and uc?id=<id>.
    const pathMatch = parsed.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    const fileId = pathMatch?.[1] ?? parsed.searchParams.get("id");
    if (!fileId || !/^[a-zA-Z0-9_-]+$/.test(fileId)) return null;

    return { provider: "google-drive", src: `https://drive.google.com/file/d/${fileId}/preview` };
  } catch {
    return null;
  }
}
