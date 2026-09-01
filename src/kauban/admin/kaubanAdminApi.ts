import { supabase } from "@/lib/supabase";

/**
 * Supabase access for the Kauban Content Management staff tool (tag:
 * kauban_content — see src/app/staffToolTags.ts). Reads/writes the six
 * kauban_* tables created by supabase_migration_kauban_content_schema.sql
 * and the kauban-media Storage bucket created by
 * supabase_migration_kauban_media_storage.sql. RLS on both restricts
 * writes to staff carrying that tag — this file doesn't re-implement
 * that check, it just relies on it.
 */

const MEDIA_BUCKET = "kauban-media";

export interface SignCategory {
  id: string;
  key: string;
  label: string;
  sortOrder: number;
}

export async function fetchSignCategories(): Promise<SignCategory[]> {
  const { data, error } = await supabase
    .from("kauban_sign_categories")
    .select("id, key, label, sort_order")
    .order("sort_order");
  if (error || !data) return [];
  return data.map(r => ({ id: r.id, key: r.key, label: r.label, sortOrder: r.sort_order }));
}

export async function createSignCategory(key: string, label: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("kauban_sign_categories")
    .insert({ key: key.trim().toLowerCase(), label: label.trim() })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't create the category." };
  return { ok: true, id: data.id };
}

export type SignVideoVariant = "clip" | "tutorial";

/** Filenames are the exact key the Speech-to-Sign-Language screen matches
 *  against, so they're normalized once here (lowercase, no spaces/accents,
 *  .mp4) rather than trusted from whatever the browser handed us. */
export function normalizeVideoFilename(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot === -1 ? name : name.slice(0, dot);
  // NFKD + stripping the Unicode "Mark" category turns e.g. "café" into
  // "cafe" before the allow-list below drops anything left that isn't
  // a-z/0-9, so accented input degrades to plain ascii instead of
  // vanishing entirely.
  const slug = base
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return `${slug || "clip"}.mp4`;
}

/** Lowercase, whitespace-collapsed — must match kauban_sign_words.phrase's
 *  own `check (phrase = lower(phrase))` constraint. */
export function normalizePhrase(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export interface UploadSignWordVideoParams {
  phrase: string;   // normalized already (normalizePhrase)
  label: string;
  categoryId: string;
  variant: SignVideoVariant;
  file: File;       // already compressed + filename-normalized
}

/**
 * Uploads one (already-compressed) video into the kauban-media bucket and
 * links it to a kauban_sign_words row, matched by `phrase` — creating the
 * row if this is the first video ever uploaded for that word, or just
 * updating the relevant path column if the word (or its other variant)
 * already exists. This is what lets a "clips" batch and a later
 * "tutorial" batch for the same words land on the same row instead of
 * duplicating it.
 */
export async function uploadSignWordVideo(params: UploadSignWordVideoParams): Promise<{ ok: true } | { ok: false; error: string }> {
  const folder = params.variant === "clip" ? "clips" : "tutorial";
  const path = `${folder}/${params.file.name}`;

  const { error: uploadError } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(path, params.file, { contentType: "video/mp4", upsert: true });
  if (uploadError) return { ok: false, error: `Upload failed: ${uploadError.message}` };

  const pathColumn = params.variant === "clip" ? "clip_video_path" : "tutorial_video_path";

  const { data: existing, error: findError } = await supabase
    .from("kauban_sign_words")
    .select("id")
    .eq("phrase", params.phrase)
    .maybeSingle();
  if (findError) return { ok: false, error: `Couldn't check for an existing word: ${findError.message}` };

  if (existing) {
    const { error } = await supabase
      .from("kauban_sign_words")
      .update({ [pathColumn]: path, label: params.label, category_id: params.categoryId })
      .eq("id", existing.id);
    if (error) return { ok: false, error: `Video uploaded, but saving the word failed: ${error.message}` };
  } else {
    const { error } = await supabase
      .from("kauban_sign_words")
      .insert({ phrase: params.phrase, label: params.label, category_id: params.categoryId, [pathColumn]: path });
    if (error) return { ok: false, error: `Video uploaded, but creating the word failed: ${error.message}` };
  }

  return { ok: true };
}

export interface SignWord {
  id: string;
  categoryId: string;
  phrase: string;
  label: string;
  clipVideoPath: string | null;
  tutorialVideoPath: string | null;
  sortOrder: number;
}

/** Used by the Video Library monitoring view to list every word + which
 *  video variants it actually has, grouped by category in the UI. */
export async function fetchSignWords(): Promise<SignWord[]> {
  const { data, error } = await supabase
    .from("kauban_sign_words")
    .select("id, category_id, phrase, label, clip_video_path, tutorial_video_path, sort_order")
    .order("sort_order");
  if (error || !data) return [];
  return data.map(r => ({
    id: r.id, categoryId: r.category_id, phrase: r.phrase, label: r.label,
    clipVideoPath: r.clip_video_path, tutorialVideoPath: r.tutorial_video_path, sortOrder: r.sort_order,
  }));
}

export function getVideoPublicUrl(path: string): string {
  return supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Removes one variant's video (Storage file + the path column) but keeps
 *  the word row — the label/phrase/category are still useful even with
 *  the video pulled, e.g. while a replacement is re-recorded. */
export async function deleteSignWordVideo(wordId: string, variant: SignVideoVariant, path: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error: removeError } = await supabase.storage.from(MEDIA_BUCKET).remove([path]);
  if (removeError) return { ok: false, error: `Couldn't remove the file: ${removeError.message}` };

  const pathColumn = variant === "clip" ? "clip_video_path" : "tutorial_video_path";
  const { error } = await supabase.from("kauban_sign_words").update({ [pathColumn]: null }).eq("id", wordId);
  if (error) return { ok: false, error: `File removed, but updating the word failed: ${error.message}` };
  return { ok: true };
}

/** Deletes the whole word — both video variants (if present) and the row
 *  itself. Used when a word shouldn't exist at all anymore, not just one
 *  of its videos. */
export async function deleteSignWord(word: Pick<SignWord, "id" | "clipVideoPath" | "tutorialVideoPath">): Promise<{ ok: true } | { ok: false; error: string }> {
  const paths = [word.clipVideoPath, word.tutorialVideoPath].filter((p): p is string => !!p);
  if (paths.length > 0) {
    const { error: removeError } = await supabase.storage.from(MEDIA_BUCKET).remove(paths);
    if (removeError) return { ok: false, error: `Couldn't remove the video file(s): ${removeError.message}` };
  }
  const { error } = await supabase.from("kauban_sign_words").delete().eq("id", word.id);
  if (error) return { ok: false, error: `Video file(s) removed, but deleting the word failed: ${error.message}` };
  return { ok: true };
}
