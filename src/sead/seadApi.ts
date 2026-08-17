import { supabase } from "@/lib/supabase";
import type { QuestSubject, QuestTopic, QuestQuestion, QuestChoiceDraft, ScholarListItem, ScholarAccountLogEntry, ScoreRow } from "./types";

/**
 * Calls a Supabase Edge Function and returns its parsed JSON body.
 *
 * supabase-js's `functions.invoke` only gives a generic message on the
 * `error` it returns for a non-2xx response — literally "Edge Function
 * returned a non-2xx status code" — no matter what the function itself
 * actually sent back. The real reason lives in the raw HTTP response body
 * (`error.context`), which has to be read separately. Every sead-* function
 * call goes through here so that real server-side error messages (missing
 * fields, "already exists", etc.) actually reach the user instead of that
 * one generic string.
 */
async function invokeEdgeFunction<T = Record<string, unknown>>(
  name: string, body: object
): Promise<{ ok: boolean; error?: string; data?: T }> {
  const { data, error } = await supabase.functions.invoke(name, { body: body as Record<string, unknown> });
  if (error) {
    let message = error.message;
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === "function") {
      try {
        const parsed = await context.clone().json();
        if (parsed?.error) message = parsed.error;
      } catch {
        // Response body wasn't JSON (or was already consumed) — fall back to the generic message.
      }
    }
    return { ok: false, error: message };
  }
  const payload = data as (T & { error?: string }) | null;
  if (payload?.error) return { ok: false, error: payload.error };
  return { ok: true, data: data as T };
}

// ── Question bank: Subjects ──────────────────────────────────
export async function fetchSubjects(): Promise<QuestSubject[]> {
  const { data, error } = await supabase.from("quest_subjects").select("*").order("name");
  if (error || !data) return [];
  return data.map(r => ({
    id: r.id, name: r.name, maxAttemptsPerDay: Number(r.max_attempts_per_day ?? 1),
    passingRateMin: Number(r.passing_rate_min ?? 75), passingRateMax: Number(r.passing_rate_max ?? 100),
    certificateFilename: r.certificate_filename ?? "",
  }));
}

export async function createSubject(
  name: string, maxAttemptsPerDay: number, passingRateMin = 75, passingRateMax = 100
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("quest_subjects")
    .insert({ name, max_attempts_per_day: maxAttemptsPerDay, passing_rate_min: passingRateMin, passing_rate_max: passingRateMax });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function renameSubject(id: string, name: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("quest_subjects").update({ name, updated_at: new Date().toISOString() }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function updateSubjectMaxAttempts(id: string, maxAttemptsPerDay: number): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("quest_subjects")
    .update({ max_attempts_per_day: maxAttemptsPerDay, updated_at: new Date().toISOString() }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function updateSubjectPassingRate(id: string, passingRateMin: number, passingRateMax: number): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("quest_subjects")
    .update({ passing_rate_min: passingRateMin, passing_rate_max: passingRateMax, updated_at: new Date().toISOString() }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

const CERTIFICATE_BUCKET = "subject-certificates";

/** Uploads (or replaces) a subject's certificate PDF. Path is deterministic — {subjectId}/certificate.pdf — so re-uploading overwrites the previous file. */
export async function uploadSubjectCertificate(subjectId: string, file: File): Promise<{ ok: boolean; error?: string }> {
  if (file.type !== "application/pdf") return { ok: false, error: "Only PDF files are supported." };
  const path = `${subjectId}/certificate.pdf`;
  const { error: uploadError } = await supabase.storage.from(CERTIFICATE_BUCKET).upload(path, file, { contentType: "application/pdf", upsert: true });
  if (uploadError) return { ok: false, error: uploadError.message };

  const { error: updateError } = await supabase.from("quest_subjects")
    .update({ certificate_filename: file.name, updated_at: new Date().toISOString() }).eq("id", subjectId);
  if (updateError) return { ok: false, error: updateError.message };
  return { ok: true };
}

export async function removeSubjectCertificate(subjectId: string): Promise<{ ok: boolean; error?: string }> {
  const { error: removeError } = await supabase.storage.from(CERTIFICATE_BUCKET).remove([`${subjectId}/certificate.pdf`]);
  if (removeError) return { ok: false, error: removeError.message };
  const { error: updateError } = await supabase.from("quest_subjects")
    .update({ certificate_filename: "", updated_at: new Date().toISOString() }).eq("id", subjectId);
  if (updateError) return { ok: false, error: updateError.message };
  return { ok: true };
}

/** Staff-side preview link — staff have their own "manage certificates" storage policy, so this always works regardless of passing rate. */
export async function fetchCertificatePreviewUrl(subjectId: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(CERTIFICATE_BUCKET).createSignedUrl(`${subjectId}/certificate.pdf`, 300);
  if (error || !data) return null;
  return data.signedUrl;
}

export interface RankingFilters {
  topN?: number; // undefined = all
  yearLevel?: string;
  school?: string;
  barangayIn?: string[]; // used for cluster filtering
  barangay?: string;
}

export interface RankingRow {
  rank: number;
  scholarIdNumber: string;
  scholarName: string;
  school: string;
  yearLevel: string;
  barangay: string;
  subjectPercentage: number;
  topicCount: number;
}

/** Top scorers for one subject, optionally filtered by year level / school / cluster (via barangayIn) / barangay. */
export async function fetchSubjectRankings(subjectId: string, filters: RankingFilters = {}): Promise<RankingRow[]> {
  const { data: progress, error } = await supabase.from("scholar_subject_progress")
    .select("scholar_id_number, subject_percentage, topic_count").eq("subject_id", subjectId).gt("topic_count", 0);
  if (error || !progress || progress.length === 0) return [];

  let scholarQuery = supabase.from("scholars")
    .select("scholar_id_number, first_name, last_name, school, year_level, barangay")
    .in("scholar_id_number", progress.map(p => p.scholar_id_number));
  if (filters.yearLevel) scholarQuery = scholarQuery.eq("year_level", filters.yearLevel);
  if (filters.school) scholarQuery = scholarQuery.eq("school", filters.school);
  if (filters.barangay) scholarQuery = scholarQuery.eq("barangay", filters.barangay);
  if (filters.barangayIn) scholarQuery = scholarQuery.in("barangay", filters.barangayIn);

  const { data: scholars } = await scholarQuery;
  if (!scholars || scholars.length === 0) return [];

  const progressByScholarId = new Map(progress.map(p => [p.scholar_id_number, p]));
  const rows = scholars
    .map(s => {
      const p = progressByScholarId.get(s.scholar_id_number);
      return {
        scholarIdNumber: s.scholar_id_number, scholarName: `${s.first_name} ${s.last_name}`,
        school: s.school ?? "", yearLevel: s.year_level ?? "", barangay: s.barangay ?? "",
        subjectPercentage: Number(p?.subject_percentage ?? 0), topicCount: Number(p?.topic_count ?? 0),
      };
    })
    .sort((a, b) => b.subjectPercentage - a.subjectPercentage)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  return filters.topN ? rows.slice(0, filters.topN) : rows;
}

/** Distinct year levels already on scholars' profiles, for the Rankings filter dropdown. */
export async function fetchDistinctYearLevels(): Promise<string[]> {
  const { data, error } = await supabase.from("scholars").select("year_level").not("year_level", "is", null);
  if (error || !data) return [];
  const set = new Set(data.map(r => (r.year_level as string ?? "").trim()).filter(Boolean));
  return [...set].sort((a, b) => a.localeCompare(b));
}

export interface SubjectProgressRow {
  scholarIdNumber: string;
  scholarName: string;
  topicCount: number;
  subjectPercentage: number;
  passed: boolean;
}

/** Every scholar's aggregate percentage for one subject — backs the Scores & Progress tab's passing-rate section. */
export async function fetchSubjectProgress(subjectId: string): Promise<SubjectProgressRow[]> {
  const [{ data: subject }, { data: progress }] = await Promise.all([
    supabase.from("quest_subjects").select("passing_rate_min, passing_rate_max").eq("id", subjectId).maybeSingle(),
    supabase.from("scholar_subject_progress").select("scholar_id_number, topic_count, subject_percentage").eq("subject_id", subjectId).gt("topic_count", 0),
  ]);
  if (!progress || progress.length === 0) return [];

  const min = Number(subject?.passing_rate_min ?? 75);
  const max = Number(subject?.passing_rate_max ?? 100);

  const scholarIds = progress.map(p => p.scholar_id_number);
  const { data: scholars } = await supabase.from("scholars").select("scholar_id_number, first_name, last_name").in("scholar_id_number", scholarIds);
  const nameByScholarId = new Map((scholars ?? []).map(s => [s.scholar_id_number, `${s.first_name} ${s.last_name}`]));

  return progress
    .map(p => {
      const pct = Number(p.subject_percentage ?? 0);
      return {
        scholarIdNumber: p.scholar_id_number,
        scholarName: nameByScholarId.get(p.scholar_id_number) ?? p.scholar_id_number,
        topicCount: Number(p.topic_count ?? 0),
        subjectPercentage: pct,
        passed: pct >= min && pct <= max,
      };
    })
    .sort((a, b) => b.subjectPercentage - a.subjectPercentage);
}

export async function deleteSubject(id: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("quest_subjects").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

// ── Question bank: Topics ────────────────────────────────────
export async function fetchTopics(subjectId: string): Promise<QuestTopic[]> {
  let { data, error } = await supabase.from("quest_topics").select("*").eq("subject_id", subjectId).order("sort_order").order("name");
  // Allows existing installations to keep displaying topics while the
  // sort-order migration is being rolled out to Supabase.
  if (error) {
    const fallback = await supabase.from("quest_topics").select("*").eq("subject_id", subjectId).order("name");
    data = fallback.data;
    error = fallback.error;
  }
  if (error || !data) return [];
  return data.map(r => ({
    id: r.id, subjectId: r.subject_id, name: r.name, sortOrder: Number(r.sort_order ?? 0),
    maxAttemptsPerDay: r.max_attempts_per_day === null || r.max_attempts_per_day === undefined ? null : Number(r.max_attempts_per_day),
    youtubeUrl: r.youtube_url ?? "",
  }));
}

export async function createTopic(
  subjectId: string, name: string, maxAttemptsPerDay: number | null, youtubeUrl: string
): Promise<{ ok: boolean; error?: string }> {
  const { data: lastTopic } = await supabase.from("quest_topics")
    .select("sort_order").eq("subject_id", subjectId).order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const { error } = await supabase.from("quest_topics")
    .insert({ subject_id: subjectId, name, max_attempts_per_day: maxAttemptsPerDay, youtube_url: youtubeUrl || null, sort_order: Number(lastTopic?.sort_order ?? -1) + 1 });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function reorderTopics(orderedTopicIds: string[]): Promise<{ ok: boolean; error?: string }> {
  const results = await Promise.all(orderedTopicIds.map((id, sortOrder) => supabase.from("quest_topics")
    .update({ sort_order: sortOrder, updated_at: new Date().toISOString() }).eq("id", id)));
  const failure = results.find(result => result.error);
  return failure?.error ? { ok: false, error: failure.error.message } : { ok: true };
}

export async function updateTopic(
  id: string, fields: { name: string; maxAttemptsPerDay: number | null; youtubeUrl: string }
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("quest_topics")
    .update({
      name: fields.name,
      max_attempts_per_day: fields.maxAttemptsPerDay,
      youtube_url: fields.youtubeUrl || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
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
    explanation: q.explanation ?? "",
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
  explanation: string;
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
      .update({ question_text: input.questionText, points: input.points, explanation: input.explanation, updated_at: new Date().toISOString() })
      .eq("id", questionId);
    if (error) return { ok: false, error: error.message };
    await supabase.from("quest_choices").delete().eq("question_id", questionId);
  } else {
    const { data, error } = await supabase.from("quest_questions")
      .insert({ topic_id: input.topicId, question_text: input.questionText, points: input.points, explanation: input.explanation })
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

export interface BulkQuestionInput {
  questionText: string;
  points: number;
  explanation: string;
  choices: QuestChoiceDraft[];
}

export interface BulkQuestionRowResult {
  index: number; // 0-based index into the array passed in, matches the CSV row order
  ok: boolean;
  error?: string;
}

/**
 * Creates many questions (with their choices) under one topic, one at a
 * time. Sequential rather than a single batch insert so that one bad row
 * doesn't sink the whole file — every other valid row still gets created,
 * and the caller finds out exactly which row(s) failed and why.
 */
export async function bulkCreateQuestions(
  topicId: string,
  questions: BulkQuestionInput[]
): Promise<{ created: number; results: BulkQuestionRowResult[] }> {
  const results: BulkQuestionRowResult[] = [];
  let created = 0;

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const { data, error } = await supabase.from("quest_questions")
      .insert({ topic_id: topicId, question_text: q.questionText, points: q.points, explanation: q.explanation })
      .select("id").single();
    if (error || !data) {
      results.push({ index: i, ok: false, error: error?.message ?? "Failed to create question." });
      continue;
    }

    const { error: choicesError } = await supabase.from("quest_choices").insert(
      q.choices.map((c, ci) => ({ question_id: data.id, choice_text: c.choiceText, is_correct: c.isCorrect, sort_order: ci }))
    );
    if (choicesError) {
      // Roll back the orphaned question so a retry doesn't leave a
      // choice-less duplicate sitting in the bank.
      await supabase.from("quest_questions").delete().eq("id", data.id);
      results.push({ index: i, ok: false, error: choicesError.message });
      continue;
    }

    created++;
    results.push({ index: i, ok: true });
  }

  return { created, results };
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

const SCHOLARS_PAGE_SIZE = 50;

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
  const result = await invokeEdgeFunction<{ defaultPassword?: string }>("sead-create-scholar-account", input);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, defaultPassword: result.data?.defaultPassword };
}

export interface BulkScholarRowResult {
  index: number; // 0-based index into the array passed in, matches the CSV row order
  scholarIdNumber: string;
  ok: boolean;
  password?: string;
  error?: string;
}

/**
 * Creates many scholar accounts at once. Runs server-side (Edge Function,
 * service-role) since it needs Supabase Auth admin access the same way the
 * single-scholar flow does — just looped over every row in the CSV. Unlike
 * the single-add flow's shared default password, each scholar here gets a
 * unique random password (returned per-row) since handing the same
 * password to a whole freshly-created batch is a bigger exposure than one
 * manually-created account.
 */
// Each row does 2-4 sequential network calls inside the Edge Function
// (existence check, create auth login, insert profile, audit log write),
// so a single request with many rows risks hitting the platform's gateway
// timeout before it finishes (a 504). Splitting into smaller chunks and
// calling the function multiple times avoids that — every chunk shares the
// same batchId so the whole upload still undoes as one unit.
const BULK_CHUNK_SIZE = 15;

export async function bulkCreateScholars(
  rows: NewScholarInput[],
  onProgress?: (done: number, total: number) => void
): Promise<{ ok: boolean; error?: string; results?: BulkScholarRowResult[]; batchId?: string }> {
  if (rows.length === 0) return { ok: false, error: "No scholar rows provided." };

  const batchId = crypto.randomUUID();
  const allResults: BulkScholarRowResult[] = [];

  for (let start = 0; start < rows.length; start += BULK_CHUNK_SIZE) {
    const chunk = rows.slice(start, start + BULK_CHUNK_SIZE);
    const result = await invokeEdgeFunction<{ batchId?: string; results?: BulkScholarRowResult[] }>(
      "sead-bulk-create-scholars", { scholars: chunk, batchId }
    );
    if (!result.ok) {
      // Report what succeeded before the failing chunk, plus the error, rather
      // than losing the whole upload's progress.
      return { ok: false, error: result.error, results: allResults, batchId };
    }
    const chunkResults = (result.data?.results ?? []).map(r => ({ ...r, index: r.index + start }));
    allResults.push(...chunkResults);
    onProgress?.(Math.min(start + BULK_CHUNK_SIZE, rows.length), rows.length);
  }

  return { ok: true, results: allResults, batchId };
}

export async function deleteScholarAccount(id: string): Promise<{ ok: boolean; error?: string; name?: string }> {
  const result = await invokeEdgeFunction<{ name?: string }>("sead-delete-scholar-account", { id });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, name: result.data?.name };
}

export interface UndoBulkResult {
  scholarIdNumber: string;
  ok: boolean;
  error?: string;
}

export async function undoBulkScholarUpload(batchId: string): Promise<{ ok: boolean; error?: string; removedCount?: number; results?: UndoBulkResult[] }> {
  const result = await invokeEdgeFunction<{ removedCount?: number; results?: UndoBulkResult[] }>(
    "sead-undo-bulk-scholars", { batchId }
  );
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, removedCount: result.data?.removedCount, results: result.data?.results };
}

export interface BulkScholarUpdateInput {
  scholarIdNumber: string; // key — must already exist
  firstName?: string; lastName?: string; middleName?: string; birthday?: string;
  school?: string; course?: string; yearLevel?: string; civilStatus?: string; contactNo?: string;
  houseUnitNo?: string; street?: string; barangay?: string; cityMunicipality?: string;
  provinceRegion?: string; country?: string; zipCode?: string;
}

export interface BulkScholarUpdateRowResult {
  index: number; // 0-based index into the array passed in, matches the CSV row order
  scholarIdNumber: string;
  ok: boolean;
  fieldsChanged: number;
  error?: string;
}

const BULK_UPDATE_FIELD_MAP: Record<keyof Omit<BulkScholarUpdateInput, "scholarIdNumber">, string> = {
  firstName: "first_name", lastName: "last_name", middleName: "middle_name", birthday: "birthday",
  school: "school", course: "course", yearLevel: "year_level", civilStatus: "civil_status", contactNo: "contact_no",
  houseUnitNo: "house_unit_no", street: "street", barangay: "barangay", cityMunicipality: "city_municipality",
  provinceRegion: "province_region", country: "country", zipCode: "zip_code",
};

/**
 * Updates many existing scholars at once, matched by Scholar ID Number.
 * Only fields present on each input row are touched — a field the CSV
 * left blank simply isn't included in that row's object, so it's never
 * sent in the update and the scholar's existing value is left alone.
 */
export async function bulkUpdateScholars(rows: BulkScholarUpdateInput[]): Promise<{ updated: number; results: BulkScholarUpdateRowResult[] }> {
  const results: BulkScholarUpdateRowResult[] = [];
  let updated = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const patch: Record<string, string> = {};
    for (const [key, column] of Object.entries(BULK_UPDATE_FIELD_MAP) as [keyof Omit<BulkScholarUpdateInput, "scholarIdNumber">, string][]) {
      const value = r[key];
      if (value !== undefined) patch[column] = value;
    }

    if (Object.keys(patch).length === 0) {
      results.push({ index: i, scholarIdNumber: r.scholarIdNumber, ok: true, fieldsChanged: 0 });
      continue;
    }

    patch.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from("scholars").update(patch).eq("scholar_id_number", r.scholarIdNumber).select("id");
    if (error) {
      results.push({ index: i, scholarIdNumber: r.scholarIdNumber, ok: false, fieldsChanged: 0, error: error.message });
      continue;
    }
    if (!data || data.length === 0) {
      results.push({ index: i, scholarIdNumber: r.scholarIdNumber, ok: false, fieldsChanged: 0, error: `Scholar ID ${r.scholarIdNumber} not found.` });
      continue;
    }

    updated++;
    results.push({ index: i, scholarIdNumber: r.scholarIdNumber, ok: true, fieldsChanged: Object.keys(patch).length - 1 });
  }

  return { updated, results };
}

export async function resetScholarPassword(scholarIdNumber: string): Promise<{ ok: boolean; error?: string; name?: string }> {
  const result = await invokeEdgeFunction<{ name?: string }>("sead-reset-scholar-password", { scholarIdNumber });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, name: result.data?.name };
}

// ── Scholar account history (audit log) ──────────────────────
export interface ScholarLogFilters {
  search?: string;      // matches scholar id number or name
  action?: "added" | "removed";
  dateFrom?: string;
  dateTo?: string;
}

export async function fetchScholarAccountLog(filters: ScholarLogFilters = {}): Promise<ScholarAccountLogEntry[]> {
  let query = supabase.from("sead_scholar_account_log")
    .select("id, created_at, action, scholar_id_number, scholar_name, performed_by_name, batch_id, source")
    .order("created_at", { ascending: false })
    .limit(500);

  if (filters.action) query = query.eq("action", filters.action);
  if (filters.dateFrom) query = query.gte("created_at", filters.dateFrom);
  if (filters.dateTo) query = query.lte("created_at", filters.dateTo);
  if (filters.search?.trim()) {
    const s = filters.search.trim();
    query = query.or(`scholar_id_number.ilike.%${s}%,scholar_name.ilike.%${s}%`);
  }

  const { data, error } = await query;
  if (error || !data) return [];
  return data.map(r => ({
    id: r.id,
    createdAt: r.created_at,
    action: r.action,
    scholarIdNumber: r.scholar_id_number,
    scholarName: r.scholar_name,
    performedByName: r.performed_by_name,
    batchId: r.batch_id,
    source: r.source,
  }));
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
