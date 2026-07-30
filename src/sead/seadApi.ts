import { supabase } from "@/lib/supabase";
import type { QuestSubject, QuestTopic, QuestQuestion, QuestChoiceDraft, ScholarListItem, ScoreRow } from "./types";

// ── Question bank: Subjects ──────────────────────────────────
export async function fetchSubjects(): Promise<QuestSubject[]> {
  const { data, error } = await supabase.from("quest_subjects").select("*").order("name");
  if (error || !data) return [];
  return data.map(r => ({ id: r.id, name: r.name }));
}

export async function createSubject(name: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("quest_subjects").insert({ name });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function renameSubject(id: string, name: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("quest_subjects").update({ name, updated_at: new Date().toISOString() }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function deleteSubject(id: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("quest_subjects").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

// ── Question bank: Topics ────────────────────────────────────
export async function fetchTopics(subjectId: string): Promise<QuestTopic[]> {
  const { data, error } = await supabase.from("quest_topics").select("*").eq("subject_id", subjectId).order("name");
  if (error || !data) return [];
  return data.map(r => ({ id: r.id, subjectId: r.subject_id, name: r.name }));
}

export async function createTopic(subjectId: string, name: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("quest_topics").insert({ subject_id: subjectId, name });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function renameTopic(id: string, name: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("quest_topics").update({ name, updated_at: new Date().toISOString() }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function deleteTopic(id: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("quest_topics").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

// ── Question bank: Questions + Choices ───────────────────────
export async function fetchQuestions(topicId: string): Promise<QuestQuestion[]> {
  const { data: questions, error } = await supabase
    .from("quest_questions").select("*").eq("topic_id", topicId).order("created_at");
  if (error || !questions) return [];

  const ids = questions.map(q => q.id);
  const { data: choices } = ids.length
    ? await supabase.from("quest_choices").select("*").in("question_id", ids).order("sort_order")
    : { data: [] as Record<string, unknown>[] };

  return questions.map(q => ({
    id: q.id,
    topicId: q.topic_id,
    questionText: q.question_text,
    points: Number(q.points),
    isActive: q.is_active,
    choices: (choices ?? [])
      .filter((c: Record<string, unknown>) => c.question_id === q.id)
      .map((c: Record<string, unknown>) => ({ id: String(c.id), choiceText: String(c.choice_text), isCorrect: !!c.is_correct })),
  }));
}

/** Creates (or fully replaces the choices of) a question in one call. */
export async function saveQuestion(input: {
  id?: string; // present = editing an existing question
  topicId: string;
  questionText: string;
  points: number;
  choices: QuestChoiceDraft[];
}): Promise<{ ok: boolean; error?: string }> {
  if (!input.choices.some(c => c.isCorrect)) {
    return { ok: false, error: "Mark at least one choice as correct." };
  }
  if (input.choices.length < 2) {
    return { ok: false, error: "Add at least two choices." };
  }

  let questionId = input.id;
  if (questionId) {
    const { error } = await supabase.from("quest_questions")
      .update({ question_text: input.questionText, points: input.points, updated_at: new Date().toISOString() })
      .eq("id", questionId);
    if (error) return { ok: false, error: error.message };
    await supabase.from("quest_choices").delete().eq("question_id", questionId);
  } else {
    const { data, error } = await supabase.from("quest_questions")
      .insert({ topic_id: input.topicId, question_text: input.questionText, points: input.points })
      .select("id").single();
    if (error || !data) return { ok: false, error: error?.message ?? "Failed to create question." };
    questionId = data.id;
  }

  const { error: choicesError } = await supabase.from("quest_choices").insert(
    input.choices.map((c, i) => ({ question_id: questionId, choice_text: c.choiceText, is_correct: c.isCorrect, sort_order: i }))
  );
  if (choicesError) return { ok: false, error: choicesError.message };
  return { ok: true };
}

export async function deleteQuestion(id: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("quest_questions").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function toggleQuestionActive(id: string, isActive: boolean): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("quest_questions").update({ is_active: isActive }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

// ── Scholars ──────────────────────────────────────────────────
export interface ScholarPage {
  items: ScholarListItem[];
  total: number;
}

const SCHOLARS_PAGE_SIZE = 100;

export async function fetchScholars(search: string, page: number = 1): Promise<ScholarPage> {
  let query = supabase.from("scholars")
    .select("id, scholar_id_number, first_name, last_name, middle_name, school, status", { count: "exact" })
    .order("last_name");
  if (search.trim()) {
    const s = search.trim();
    query = query.or(`scholar_id_number.ilike.%${s}%,first_name.ilike.%${s}%,last_name.ilike.%${s}%`);
  }
  const from = (page - 1) * SCHOLARS_PAGE_SIZE;
  const to = from + SCHOLARS_PAGE_SIZE - 1;
  const { data, error, count } = await query.range(from, to);
  if (error || !data) return { items: [], total: 0 };
  return {
    items: data.map(r => ({
      id: r.id, scholarIdNumber: r.scholar_id_number, firstName: r.first_name, lastName: r.last_name,
      middleName: r.middle_name ?? "", school: r.school ?? "", status: r.status,
    })),
    total: count ?? data.length,
  };
}

export { SCHOLARS_PAGE_SIZE };

export interface NewScholarInput {
  scholarIdNumber: string; firstName: string; lastName: string; middleName: string;
  birthday: string; address: string; school: string; course: string; civilStatus: string; contactNo: string;
}

export async function createScholarAccount(input: NewScholarInput): Promise<{ ok: boolean; error?: string; defaultPassword?: string }> {
  const { data, error } = await supabase.functions.invoke("sead-create-scholar-account", { body: input });
  if (error) return { ok: false, error: error.message };
  if (data?.error) return { ok: false, error: data.error };
  return { ok: true, defaultPassword: data?.defaultPassword };
}

export async function resetScholarPassword(scholarIdNumber: string): Promise<{ ok: boolean; error?: string; name?: string }> {
  const { data, error } = await supabase.functions.invoke("sead-reset-scholar-password", { body: { scholarIdNumber } });
  if (error) return { ok: false, error: error.message };
  if (data?.error) return { ok: false, error: data.error };
  return { ok: true, name: data?.name };
}

// ── Scores & progress monitoring ─────────────────────────────
export interface ScoreFilters {
  subjectId?: string;
  topicId?: string;
  scholarSearch?: string;
  dateFrom?: string;
  dateTo?: string;
}

export async function fetchScores(filters: ScoreFilters): Promise<ScoreRow[]> {
  let query = supabase
    .from("scholar_quest_scores")
    .select("id, scholar_id_number, quest_name, score, max_score, date_taken, subject_id, topic_id")
    .order("date_taken", { ascending: false })
    .limit(500);

  if (filters.subjectId) query = query.eq("subject_id", filters.subjectId);
  if (filters.topicId) query = query.eq("topic_id", filters.topicId);
  if (filters.dateFrom) query = query.gte("date_taken", filters.dateFrom);
  if (filters.dateTo) query = query.lte("date_taken", filters.dateTo);

  const { data: rows, error } = await query;
  if (error || !rows) return [];

  const scholarIds = Array.from(new Set(rows.map(r => r.scholar_id_number)));
  const { data: scholars } = scholarIds.length
    ? await supabase.from("scholars").select("scholar_id_number, first_name, last_name").in("scholar_id_number", scholarIds)
    : { data: [] as Record<string, unknown>[] };
  const nameByScholarId = new Map((scholars ?? []).map((s: Record<string, unknown>) => [s.scholar_id_number, `${s.first_name} ${s.last_name}`]));

  const subjectIds = Array.from(new Set(rows.map(r => r.subject_id).filter(Boolean)));
  const topicIds = Array.from(new Set(rows.map(r => r.topic_id).filter(Boolean)));
  const { data: subjects } = subjectIds.length ? await supabase.from("quest_subjects").select("id, name").in("id", subjectIds) : { data: [] as Record<string, unknown>[] };
  const { data: topics } = topicIds.length ? await supabase.from("quest_topics").select("id, name").in("id", topicIds) : { data: [] as Record<string, unknown>[] };
  const subjectNameById = new Map((subjects ?? []).map((s: Record<string, unknown>) => [s.id, s.name]));
  const topicNameById = new Map((topics ?? []).map((t: Record<string, unknown>) => [t.id, t.name]));

  let result: ScoreRow[] = rows.map(r => ({
    id: r.id,
    scholarIdNumber: r.scholar_id_number,
    scholarName: nameByScholarId.get(r.scholar_id_number) ?? r.scholar_id_number,
    subjectName: r.subject_id ? (subjectNameById.get(r.subject_id) as string) ?? null : null,
    topicName: r.topic_id ? (topicNameById.get(r.topic_id) as string) ?? null : null,
    questName: r.quest_name,
    score: r.score == null ? null : Number(r.score),
    maxScore: r.max_score == null ? null : Number(r.max_score),
    dateTaken: r.date_taken,
  }));

  if (filters.scholarSearch?.trim()) {
    const s = filters.scholarSearch.trim().toLowerCase();
    result = result.filter(r => r.scholarName.toLowerCase().includes(s) || r.scholarIdNumber.toLowerCase().includes(s));
  }

  return result;
}
