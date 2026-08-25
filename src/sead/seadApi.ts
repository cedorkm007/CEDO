import { supabase } from "@/lib/supabase";
import { isValidHttpsUrl } from "@/lib/urlValidation";
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
  // scholar_subject_progress can hold more rows for a popular subject than
  // Supabase/PostgREST's default 1,000-row response cap, so this pages
  // through with .range() instead of a single .select() — same pattern as
  // fetchScores() below. order() makes each page's slice deterministic.
  const progress: { scholar_id_number: string; subject_percentage: number; topic_count: number }[] = [];
  {
    const pageSize = 500;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase.from("scholar_subject_progress")
        .select("scholar_id_number, subject_percentage, topic_count")
        .eq("subject_id", subjectId).gt("topic_count", 0)
        .order("scholar_id_number")
        .range(from, from + pageSize - 1);
      if (error) return [];
      if (!data || data.length === 0) break;
      progress.push(...data);
      if (data.length < pageSize) break;
    }
  }
  if (progress.length === 0) return [];

  // Same response-cap reasoning applies to the matching scholars — an
  // .in() filter is still subject to the same cap, so this pages through
  // too rather than trusting one call to return every match.
  const scholarIds = progress.map(p => p.scholar_id_number);
  const scholars: { scholar_id_number: string; first_name: string; last_name: string; school: string | null; year_level: string | null; barangay: string | null }[] = [];
  {
    const pageSize = 500;
    for (let from = 0; ; from += pageSize) {
      let scholarQuery = supabase.from("scholars")
        .select("scholar_id_number, first_name, last_name, school, year_level, barangay")
        .in("scholar_id_number", scholarIds)
        .order("scholar_id_number");
      if (filters.yearLevel) scholarQuery = scholarQuery.eq("year_level", filters.yearLevel);
      if (filters.school) scholarQuery = scholarQuery.eq("school", filters.school);
      if (filters.barangay) scholarQuery = scholarQuery.eq("barangay", filters.barangay);
      if (filters.barangayIn) scholarQuery = scholarQuery.in("barangay", filters.barangayIn);
      const { data, error } = await scholarQuery.range(from, from + pageSize - 1);
      if (error) return [];
      if (!data || data.length === 0) break;
      scholars.push(...data);
      if (data.length < pageSize) break;
    }
  }
  if (scholars.length === 0) return [];

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

export interface SubjectProgressPageResult {
  rows: SubjectProgressRow[];
  totalCount: number;
  passedCount: number;
  notPassedCount: number;
  passingRateMin: number;
  passingRateMax: number;
}

export type PassedFilter = "all" | "passed" | "not_passed";

/**
 * Server-side paginated + aggregated + passed/not-passed-filterable
 * replacement for fetchSubjectProgress() at the Passing Rate Progress
 * panel — computes the pass/fail split as a real Postgres aggregate over
 * the full enrolled set (subject_progress_page RPC,
 * supabase_migration_subject_progress_page_rpc.sql) and returns only one
 * page of already-joined rows, instead of loading every enrolled
 * scholar's progress row plus a separate scholar-name .in() lookup built
 * from potentially hundreds/thousands of ids. fetchSubjectProgress()
 * itself is left in place — nothing else references it, and replacing it
 * outright wasn't necessary to fix this.
 */
export async function fetchSubjectProgressPage(
  subjectId: string, passedFilter: PassedFilter, page: number, pageSize = 10,
): Promise<SubjectProgressPageResult> {
  const { data, error } = await supabase.rpc("subject_progress_page", {
    p_subject_id: subjectId,
    p_passed_filter: passedFilter,
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
  });
  if (error || !data) return { rows: [], totalCount: 0, passedCount: 0, notPassedCount: 0, passingRateMin: 75, passingRateMax: 100 };

  const rows = (data as Record<string, unknown>[]).map(r => ({
    scholarIdNumber: String(r.scholar_id_number),
    scholarName: String(r.scholar_name ?? r.scholar_id_number),
    topicCount: Number(r.topic_count ?? 0),
    subjectPercentage: Number(r.subject_percentage ?? 0),
    passed: Boolean(r.passed),
  }));
  const first = (data as Record<string, unknown>[])[0];
  return {
    rows,
    totalCount: Number(first?.total_count ?? 0),
    passedCount: Number(first?.passed_count ?? 0),
    notPassedCount: Number(first?.not_passed_count ?? 0),
    passingRateMin: Number(first?.passing_rate_min ?? 75),
    passingRateMax: Number(first?.passing_rate_max ?? 100),
  };
}

/** Every scholar's aggregate percentage for one subject — backs the Scores & Progress tab's passing-rate section. */
export async function fetchSubjectProgress(subjectId: string): Promise<SubjectProgressRow[]> {
  // Same 1,000-row response-cap reasoning as fetchSubjectRankings() above —
  // pages through scholar_subject_progress with .range() rather than one
  // .select() call. Wrapped in its own function so it can still run
  // concurrently with the passing-rate lookup below via Promise.all, same
  // as before this change.
  async function fetchAllProgress() {
    const rows: { scholar_id_number: string; topic_count: number; subject_percentage: number }[] = [];
    const pageSize = 500;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase.from("scholar_subject_progress")
        .select("scholar_id_number, topic_count, subject_percentage")
        .eq("subject_id", subjectId).gt("topic_count", 0)
        .order("scholar_id_number")
        .range(from, from + pageSize - 1);
      if (error || !data) break;
      rows.push(...data);
      if (data.length < pageSize) break;
    }
    return rows;
  }

  const [{ data: subject }, progress] = await Promise.all([
    supabase.from("quest_subjects").select("passing_rate_min, passing_rate_max").eq("id", subjectId).maybeSingle(),
    fetchAllProgress(),
  ]);
  if (progress.length === 0) return [];

  const min = Number(subject?.passing_rate_min ?? 75);
  const max = Number(subject?.passing_rate_max ?? 100);

  // Same response-cap reasoning applies here too — page through the
  // matching scholars instead of a single .in() call.
  const scholarIds = progress.map(p => p.scholar_id_number);
  const scholars: { scholar_id_number: string; first_name: string; last_name: string }[] = [];
  {
    const pageSize = 500;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase.from("scholars")
        .select("scholar_id_number, first_name, last_name")
        .in("scholar_id_number", scholarIds)
        .order("scholar_id_number")
        .range(from, from + pageSize - 1);
      if (error || !data) break;
      scholars.push(...data);
      if (data.length < pageSize) break;
    }
  }
  const nameByScholarId = new Map(scholars.map(s => [s.scholar_id_number, `${s.first_name} ${s.last_name}`]));

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
    videoUrl: r.video_url ?? "",
    slideUrl: r.slide_url ?? "",
    pdfUrl: r.pdf_url ?? "",
  }));
}

export async function createTopic(
  subjectId: string, name: string, maxAttemptsPerDay: number | null, videoUrl: string, slideUrl: string, pdfUrl: string
): Promise<{ ok: boolean; error?: string }> {
  if (!isValidHttpsUrl(videoUrl)) return { ok: false, error: "Video URL must be a valid https:// link." };
  if (!isValidHttpsUrl(slideUrl)) return { ok: false, error: "Slide deck URL must be a valid https:// link." };
  if (!isValidHttpsUrl(pdfUrl)) return { ok: false, error: "PDF material URL must be a valid https:// link." };
  const { data: lastTopic } = await supabase.from("quest_topics")
    .select("sort_order").eq("subject_id", subjectId).order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const { error } = await supabase.from("quest_topics")
    .insert({
      subject_id: subjectId, name, max_attempts_per_day: maxAttemptsPerDay,
      video_url: videoUrl.trim() || null, slide_url: slideUrl.trim() || null, pdf_url: pdfUrl.trim() || null,
      sort_order: Number(lastTopic?.sort_order ?? -1) + 1,
    });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function reorderTopics(orderedTopicIds: string[]): Promise<{ ok: boolean; error?: string }> {
  const results = await Promise.all(orderedTopicIds.map((id, sortOrder) => supabase.from("quest_topics")
    .update({ sort_order: sortOrder, updated_at: new Date().toISOString() }).eq("id", id)));
  const failure = results.find(result => result.error);
  return failure?.error ? { ok: false, error: failure.error.message } : { ok: true };
}

export async function updateTopic(
  id: string, fields: { name: string; maxAttemptsPerDay: number | null; videoUrl: string; slideUrl: string; pdfUrl: string }
): Promise<{ ok: boolean; error?: string }> {
  if (!isValidHttpsUrl(fields.videoUrl)) return { ok: false, error: "Video URL must be a valid https:// link." };
  if (!isValidHttpsUrl(fields.slideUrl)) return { ok: false, error: "Slide deck URL must be a valid https:// link." };
  if (!isValidHttpsUrl(fields.pdfUrl)) return { ok: false, error: "PDF material URL must be a valid https:// link." };
  const { error } = await supabase.from("quest_topics")
    .update({
      name: fields.name,
      max_attempts_per_day: fields.maxAttemptsPerDay,
      video_url: fields.videoUrl.trim() || null,
      slide_url: fields.slideUrl.trim() || null,
      pdf_url: fields.pdfUrl.trim() || null,
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

/**
 * Server-side search + pagination via search_scholars()
 * (supabase_migration_scholar_search_rpc.sql) — fixes the old
 * .or(`first_name.ilike...,last_name.ilike...`) query, which checked
 * each column separately and so could never match a full name search
 * (e.g. "Juan Dela Cruz") since no single column contains the
 * concatenated string. See the migration's own header comment.
 */
/** One row for the Scholars Information subtab — includes every column its
 * column picker can toggle. No search/filter param yet (Milestone 2 scope
 * is the shell + column picker only; combinable filters are Milestone 3). */
export interface ScholarInformationRow {
  scholarIdNumber: string;
  firstName: string;
  lastName: string;
  middleName: string;
  yearLevel: string;
  school: string;
  barangay: string;
  course: string;
  birthday: string; // ISO date, or "" — the UI computes age from this rather than storing age separately
  civilStatus: string;
  contactNo: string;
}

/** Combinable filters for the Scholars Information subtab (Milestone 3) —
 * every field ANDs together, all optional/omittable. */
export interface ScholarInformationFilters {
  name?: string; // partial match against first/last/middle name
  barangay?: string; // exact match — sourced from ALL_BARANGAYS (src/lib/cdoBarangays.ts), the same canonical list used elsewhere in this app
  course?: string; // partial match — course is free text everywhere else in this codebase (no fixed enum exists), so this stays consistent with that
  school?: string; // partial match
  yearLevel?: string; // exact match — sourced from FORMATION_YEAR_LEVELS (src/scholar/formationActivitiesApi.ts), the same canonical list scholars.year_level values already come from elsewhere in this app
  ageMin?: number;
  ageMax?: number;
}

function isoDateYearsAgo(years: number): string {
  const now = new Date();
  // Built from now's UTC components specifically (not local-time
  // components) so this doesn't drift by a day depending on the server's
  // timezone vs. the stored date column's — birthday is a plain DATE
  // column with no time/timezone component, so the cutoff needs to be
  // computed the same context-free way.
  const target = new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate()));
  return target.toISOString().slice(0, 10);
}

const SCHOLAR_INFORMATION_SELECT =
  "scholar_id_number, first_name, last_name, middle_name, year_level, school, barangay, course, birthday, civil_status, contact_no";

/**
 * Applies every ScholarInformationFilters field to a query builder — the
 * one place this filter logic lives, shared by fetchScholarsInformationPage
 * (Milestone 3, paginated) and fetchAllScholarsInformationForExport
 * (Milestone 4a, unpaginated) below, so the two can never drift on what
 * "combinable filters" actually means.
 *
 * `query`/return type is `any` rather than a generic Q constrained to
 * `{ eq, ilike, or, gt, lte }` (which is what this function originally
 * used, to avoid importing Supabase's PostgrestFilterBuilder type by
 * name). That structural constraint broke the real `npm run build`:
 * TypeScript has to check whether the actual query builder's type —
 * which is deeply recursive/generic internally in @supabase/supabase-js
 * — structurally satisfies Q, and that check is what blew up into
 * "TS2589: Type instantiation is excessively deep and possibly
 * infinite." Using `any` here sidesteps that check entirely; it doesn't
 * lose type safety at either call site below, because assigning an
 * `any` return value back into a `let query = supabase.from(...)...`
 * variable doesn't widen that variable's own already-inferred type —
 * every method called on `query` after this function returns (.order,
 * .range, etc.) is still checked against the real, specific query
 * builder type from `supabase.from(...)`, not against `any`.
 */
function applyScholarInformationFilters(query: any, filters: ScholarInformationFilters): any {
  const name = filters.name?.trim();
  if (name) {
    // One OR-group (matches ANY of the three name columns) that still ANDs
    // with everything else below — same .or() pattern already used by
    // fetchScholars()'s own fallback path elsewhere in this file, for
    // consistency, and the same reasoning: a single stored column never
    // contains the full concatenated name, so a search has to check all
    // three columns for a match.
    const pattern = `%${name.replace(/[,.()]/g, " ")}%`;
    query = query.or(`first_name.ilike.${pattern},last_name.ilike.${pattern},middle_name.ilike.${pattern}`);
  }
  if (filters.barangay) query = query.eq("barangay", filters.barangay);
  if (filters.course?.trim()) query = query.ilike("course", `%${filters.course.trim()}%`);
  if (filters.school?.trim()) query = query.ilike("school", `%${filters.school.trim()}%`);
  if (filters.yearLevel) query = query.eq("year_level", filters.yearLevel);
  // Age is a value COMPUTED from birthday (see computeAge() in
  // ScholarsTab.tsx), not a stored column, so a WHERE clause can't filter
  // on it directly — translate the requested age range into a birthday
  // date range instead, using the exact same "has this year's birthday
  // happened yet" logic computeAge() uses for display, just inverted into
  // a cutoff date: being at least ageMin years old today means born on or
  // before (today − ageMin years); being at most ageMax years old today
  // means born after (today − (ageMax+1) years), i.e. not yet having
  // turned ageMax+1.
  if (filters.ageMin !== undefined) query = query.lte("birthday", isoDateYearsAgo(filters.ageMin));
  if (filters.ageMax !== undefined) query = query.gt("birthday", isoDateYearsAgo(filters.ageMax + 1));
  return query;
}

function mapScholarInformationRow(r: Record<string, unknown>): ScholarInformationRow {
  return {
    scholarIdNumber: String(r.scholar_id_number), firstName: String(r.first_name), lastName: String(r.last_name),
    middleName: String(r.middle_name ?? ""), yearLevel: String(r.year_level ?? ""), school: String(r.school ?? ""),
    barangay: String(r.barangay ?? ""), course: String(r.course ?? ""), birthday: String(r.birthday ?? ""),
    civilStatus: String(r.civil_status ?? ""), contactNo: String(r.contact_no ?? ""),
  };
}

export async function fetchScholarsInformationPage(
  page: number, filters: ScholarInformationFilters = {}
): Promise<{ items: ScholarInformationRow[]; total: number }> {
  const from = (page - 1) * SCHOLARS_PAGE_SIZE;
  let query = supabase.from("scholars").select(SCHOLAR_INFORMATION_SELECT, { count: "exact" });

  // Every filter below is ANDed together (chaining .eq/.ilike/.gte/.lte on
  // one PostgREST query builder is AND by default) — "combinable filters"
  // per the task, not a set of mutually-exclusive views.
  query = applyScholarInformationFilters(query, filters);

  const { data, error, count } = await query
    .order("last_name").order("first_name")
    .range(from, from + SCHOLARS_PAGE_SIZE - 1);
  if (error || !data) return { items: [], total: 0 };
  return { items: data.map(mapScholarInformationRow), total: count ?? data.length };
}

// Batch size for fetchAllScholarsInformationForExport below — deliberately
// NOT the same as SCHOLARS_PAGE_SIZE (50). This isn't a UI page size, it's
// how many rows one request pulls while looping to assemble a full export;
// larger batches mean fewer round trips for a big filtered set.
const EXPORT_FETCH_BATCH_SIZE = 1000;

/**
 * Milestone 4a (CSV/PDF export) — every row matching `filters`, not just
 * one page. Confirmed with the person that export should cover the FULL
 * filtered result set (could be far more than one page), not just the 50
 * rows currently on screen.
 *
 * Loops in EXPORT_FETCH_BATCH_SIZE-row batches via the same
 * applyScholarInformationFilters + .range() pattern
 * fetchScholarsInformationPage uses, rather than a single unbounded query
 * — PostgREST enforces its own default max-rows-per-request cap
 * server-side regardless of what's asked for, so one .range()-less query
 * would silently truncate once the filtered result set exceeds that cap.
 * Looping keeps this correct at any roster size.
 */
export async function fetchAllScholarsInformationForExport(
  filters: ScholarInformationFilters = {}
): Promise<ScholarInformationRow[]> {
  const all: ScholarInformationRow[] = [];
  let from = 0;
  for (;;) {
    let query = supabase.from("scholars").select(SCHOLAR_INFORMATION_SELECT);
    query = applyScholarInformationFilters(query, filters);
    const { data, error } = await query
      .order("last_name").order("first_name")
      .range(from, from + EXPORT_FETCH_BATCH_SIZE - 1);
    if (error || !data || data.length === 0) break;
    all.push(...data.map(mapScholarInformationRow));
    if (data.length < EXPORT_FETCH_BATCH_SIZE) break; // last (partial) batch — nothing more to fetch
    from += EXPORT_FETCH_BATCH_SIZE;
  }
  return all;
}

export async function fetchScholars(search: string, page: number = 1): Promise<ScholarPage> {
  const { data, error } = await supabase.rpc("search_scholars", {
    p_search: search.trim() || "",
    p_limit: SCHOLARS_PAGE_SIZE,
    p_offset: (page - 1) * SCHOLARS_PAGE_SIZE,
  });
  // Keep the Scholars tab usable until the matching RPC migration has been
  // applied. The primary path remains the RPC because it supports reliable
  // full-name matching; this fallback prevents a missing/stale function from
  // turning the entire roster into an unexplained empty list.
  if (error || !data) {
    const term = search.trim().replace(/[,.()]/g, " ");
    let query = supabase.from("scholars")
      .select("id, scholar_id_number, first_name, last_name, middle_name, school, status", { count: "exact" })
      .order("last_name").order("first_name");
    if (term) {
      const pattern = "%" + term + "%";
      query = query.or("scholar_id_number.ilike." + pattern + ",first_name.ilike." + pattern + ",last_name.ilike." + pattern);
    }
    const from = (page - 1) * SCHOLARS_PAGE_SIZE;
    const { data: fallbackRows, error: fallbackError, count } = await query.range(from, from + SCHOLARS_PAGE_SIZE - 1);
    if (fallbackError || !fallbackRows) return { items: [], total: 0 };
    return {
      items: fallbackRows.map(r => ({
        id: String(r.id), scholarIdNumber: String(r.scholar_id_number), firstName: String(r.first_name),
        lastName: String(r.last_name), middleName: String(r.middle_name ?? ""), school: String(r.school ?? ""),
        status: r.status as ScholarListItem["status"],
      })),
      total: count ?? fallbackRows.length,
    };
  }
  const rows = data as unknown as Record<string, unknown>[];
  return {
    items: rows.map(r => ({
      id: String(r.id), scholarIdNumber: String(r.scholar_id_number), firstName: String(r.first_name),
      lastName: String(r.last_name), middleName: String(r.middle_name ?? ""), school: String(r.school ?? ""),
      status: r.status as ScholarListItem["status"],
    })),
    total: rows[0] ? Number(rows[0].total_count ?? 0) : 0,
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
/** Best-effort — falls back to a generic label rather than ever blocking
 * the actual account action if this lookup fails or isn't permitted. */
async function currentStaffDisplayName(): Promise<string> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return "Staff";
    const { data } = await supabase.from("users").select("first_name, last_name").eq("id", auth.user.id).maybeSingle();
    if (!data) return "Staff";
    return `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim() || "Staff";
  } catch {
    return "Staff";
  }
}

export async function bulkUpdateScholars(rows: BulkScholarUpdateInput[]): Promise<{ updated: number; results: BulkScholarUpdateRowResult[] }> {
  const results: BulkScholarUpdateRowResult[] = [];
  let updated = 0;
  // One shared batch id for every log entry this call produces — lets
  // Account History group a bulk update together the same way bulk
  // create/reset already do, even though each row is its own UPDATE.
  const batchId = rows.length > 1 ? crypto.randomUUID() : null;
  let staffName: string | null = null;
  let staffId: string | null = null;

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
    const { data, error } = await supabase.from("scholars").update(patch).eq("scholar_id_number", r.scholarIdNumber).select("id, first_name, last_name");
    if (error) {
      results.push({ index: i, scholarIdNumber: r.scholarIdNumber, ok: false, fieldsChanged: 0, error: error.message });
      continue;
    }
    if (!data || data.length === 0) {
      results.push({ index: i, scholarIdNumber: r.scholarIdNumber, ok: false, fieldsChanged: 0, error: `Scholar ID ${r.scholarIdNumber} not found.` });
      continue;
    }

    updated++;
    const fieldsChanged = Object.keys(patch).length - 1;
    results.push({ index: i, scholarIdNumber: r.scholarIdNumber, ok: true, fieldsChanged });

    // Resolved once, reused for every row — avoids a redundant auth/name
    // lookup per scholar in what can be a large batch.
    if (staffName === null) {
      const { data: auth } = await supabase.auth.getUser();
      staffId = auth.user?.id ?? null;
      staffName = await currentStaffDisplayName();
    }
    if (staffId) {
      const changedFieldLabels = Object.keys(patch).filter(k => k !== "updated_at").join(", ");
      const { error: logError } = await supabase.from("sead_scholar_account_log").insert({
        action: "updated",
        scholar_id: data[0].id,
        scholar_id_number: r.scholarIdNumber,
        scholar_name: `${data[0].first_name} ${data[0].last_name}`,
        performed_by: staffId,
        performed_by_name: staffName,
        batch_id: batchId,
        source: rows.length > 1 ? "bulk" : "single",
        description: `Updated ${fieldsChanged} field${fieldsChanged === 1 ? "" : "s"} (${changedFieldLabels}).`,
      });
      // Never blocks/fails the actual update on a logging error — the
      // scholar record change already succeeded and shouldn't be masked
      // by an audit-trail write failing.
      if (logError) console.error("Failed to write scholar account log entry:", logError.message);
    }
  }

  return { updated, results };
}

export async function resetScholarPassword(scholarIdNumber: string): Promise<{ ok: boolean; error?: string; name?: string }> {
  const result = await invokeEdgeFunction<{ name?: string }>("sead-reset-scholar-password", { scholarIdNumber });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, name: result.data?.name };
}

export interface ResetAllPasswordsResult {
  ok: boolean;
  error?: string;
  total?: number;
  succeeded?: number;
  failed?: number;
  failures?: { scholarIdNumber: string; error: string }[];
}

interface ResetAllPasswordsBatchResponse {
  total?: number;
  processed?: number;
  succeeded?: number;
  failed?: number;
  failures?: { scholarIdNumber: string; error: string }[];
  nextOffset?: number;
  done?: boolean;
}

/**
 * Resets EVERY scholar's password (not just the current page/search
 * results) back to the shared default. Processes the roster in small
 * batches — one Edge Function call per batch — instead of one call for
 * everyone, because a single call trying to loop through a large roster
 * can run long enough to hit Supabase's Edge Function execution-time
 * limit and get killed mid-run (a 504 IDLE_TIMEOUT with no usable error
 * body). Each batch call stays fast regardless of roster size, so this
 * can't time out no matter how many scholars there are.
 *
 * onProgress, if given, is called after each batch with (done, total) so
 * the UI can show live progress across the whole run.
 */
export async function resetAllScholarPasswords(
  onProgress?: (done: number, total: number) => void
): Promise<ResetAllPasswordsResult> {
  let offset = 0;
  let total = 0;
  let succeeded = 0;
  let failed = 0;
  const failures: { scholarIdNumber: string; error: string }[] = [];
  // Generated once and sent on every batch call, so every 'reset' log
  // entry this whole run produces shares one batch_id — Account History
  // can group the entire reset-all action together even though it's
  // actually many separate Edge Function invocations under the hood.
  const batchId = crypto.randomUUID();

  // Safety cap so a server-side bug (e.g. nextOffset never advancing)
  // can't spin the browser in an infinite loop — comfortably above any
  // realistic roster size at BATCH_SIZE=200 per call.
  const MAX_BATCHES = 500;

  for (let batchCount = 0; batchCount < MAX_BATCHES; batchCount++) {
    const result = await invokeEdgeFunction<ResetAllPasswordsBatchResponse>(
      "sead-reset-all-scholar-passwords", { offset, batchId }
    );
    if (!result.ok) return { ok: false, error: result.error, total, succeeded, failed, failures };

    const data = result.data ?? {};
    total = data.total ?? total;
    succeeded += data.succeeded ?? 0;
    failed += data.failed ?? 0;
    if (data.failures?.length) failures.push(...data.failures);

    const doneCount = Math.min(offset + (data.processed ?? 0), total || offset + (data.processed ?? 0));
    onProgress?.(doneCount, total);

    if (data.done || !data.processed) break;
    offset = data.nextOffset ?? offset + data.processed;
  }

  return { ok: true, total, succeeded, failed, failures };
}

// ── Scholar account history (audit log) ──────────────────────
export interface ScholarLogFilters {
  search?: string;      // matches scholar id number or name
  action?: "added" | "removed" | "reset" | "updated";
  dateFrom?: string;
  dateTo?: string;
}

const ACCOUNT_LOG_PAGE_SIZE = 50;

export async function fetchScholarAccountLog(filters: ScholarLogFilters = {}, page: number = 1): Promise<{ items: ScholarAccountLogEntry[]; total: number }> {
  let query = supabase.from("sead_scholar_account_log")
    .select("id, created_at, action, scholar_id_number, scholar_name, performed_by_name, batch_id, source, description", { count: "exact" })
    .order("created_at", { ascending: false });

  if (filters.action) query = query.eq("action", filters.action);
  if (filters.dateFrom) query = query.gte("created_at", filters.dateFrom);
  if (filters.dateTo) query = query.lte("created_at", filters.dateTo);
  if (filters.search?.trim()) {
    const s = filters.search.trim();
    query = query.or(`scholar_id_number.ilike.%${s}%,scholar_name.ilike.%${s}%`);
  }

  const from = (page - 1) * ACCOUNT_LOG_PAGE_SIZE;
  const { data, error, count } = await query.range(from, from + ACCOUNT_LOG_PAGE_SIZE - 1);
  if (error || !data) return { items: [], total: 0 };
  return {
    items: data.map(r => ({
      id: r.id,
      createdAt: r.created_at,
      action: r.action,
      scholarIdNumber: r.scholar_id_number,
      scholarName: r.scholar_name,
      performedByName: r.performed_by_name,
      batchId: r.batch_id,
      source: r.source,
      description: r.description ?? "",
    })),
    total: count ?? data.length,
  };
}

export { ACCOUNT_LOG_PAGE_SIZE };

// ── Scores & progress monitoring ─────────────────────────────
export interface ScoreFilters {
  subjectId?: string;
  topicId?: string;
  scholarSearch?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface ScoreSearchResult {
  rows: ScoreRow[];
  totalCount: number;
  distinctScholarCount: number;
  avgPercentage: number;
}

/**
 * Server-side paginated + aggregated score search, backed by
 * search_quest_scores() (supabase_migration_quest_scores_search_rpc.sql).
 * Replaces fetchScores(), which loaded every matching row just to compute
 * the Results/Scholars/Average cards and paginate in the browser — the
 * RPC computes those three values as real Postgres aggregates over the
 * FULL filtered set and returns only one page of display-ready
 * (already-joined) rows. Table meaning is unchanged: rows are still
 * individual attempt records, not unique scholars.
 */
export async function searchQuestScores(filters: ScoreFilters, page: number, pageSize: number): Promise<ScoreSearchResult> {
  const { data, error } = await supabase.rpc("search_quest_scores", {
    p_subject_id: filters.subjectId || null,
    p_topic_id: filters.topicId || null,
    p_scholar_search: filters.scholarSearch?.trim() || null,
    p_date_from: filters.dateFrom || null,
    p_date_to: filters.dateTo || null,
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
  });
  if (error || !data) return { rows: [], totalCount: 0, distinctScholarCount: 0, avgPercentage: 0 };

  const rowsData = data as unknown as Record<string, unknown>[];
  const rows: ScoreRow[] = rowsData.map(r => ({
    id: String(r.id),
    scholarIdNumber: String(r.scholar_id_number),
    scholarName: String(r.scholar_name ?? r.scholar_id_number),
    subjectName: r.subject_name ? String(r.subject_name) : null,
    topicName: r.topic_name ? String(r.topic_name) : null,
    questName: String(r.quest_name ?? ""),
    score: r.score == null ? null : Number(r.score),
    maxScore: r.max_score == null ? null : Number(r.max_score),
    dateTaken: String(r.date_taken ?? ""),
  }));

  const first = rowsData[0];
  return {
    rows,
    totalCount: first ? Number(first.total_count ?? 0) : 0,
    distinctScholarCount: first ? Number(first.distinct_scholar_count ?? 0) : 0,
    avgPercentage: first?.avg_percentage != null ? Math.round(Number(first.avg_percentage)) : 0,
  };
}
