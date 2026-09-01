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
