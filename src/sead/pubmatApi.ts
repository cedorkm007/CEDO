import { supabase } from "@/lib/supabase";

const PUBMAT_BUCKET = "activity-pubmats";

export type PubmatActivityType = "formation" | "submission" | "sdp" | "quest";

const TABLE_BY_TYPE: Record<PubmatActivityType, string> = {
  formation: "formation_activities",
  submission: "submission_activities",
  sdp: "sdp_activities",
  quest: "quest_subjects",
};

function extensionFor(file: File): string {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]+$/.test(fromName)) return fromName;
  return file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
}

// Pubmats are viewed on-screen (thumbnails/previews), not printed, so this
// is sized more like Kauban's on-screen video dimension than
// submissionCompression.ts's print-legible 2000px document cap.
const MAX_PUBMAT_DIMENSION = 1600;
const PUBMAT_JPEG_QUALITY = 0.82;

/**
 * Compresses a pubmat image client-side before upload — same
 * never-block-the-upload-on-failure, only-keep-it-if-actually-smaller
 * approach as compressSubmissionFile (src/scholar/submissionCompression.ts).
 * PNG stays PNG (pubmats can carry a transparent logo/overlay); every other
 * input type (JPEG, WebP, etc.) is re-encoded to JPEG for the biggest size
 * reduction, since only PNG's transparency is worth preserving here.
 */
async function compressPubmatImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const longEdge = Math.max(bitmap.width, bitmap.height);
  const scale = Math.min(1, MAX_PUBMAT_DIMENSION / longEdge);
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const outputType = file.type === "image/png" ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob | null>(resolve =>
    canvas.toBlob(resolve, outputType, outputType === "image/jpeg" ? PUBMAT_JPEG_QUALITY : undefined)
  );
  if (!blob) throw new Error("Pubmat compression produced no output.");
  const name = outputType === "image/jpeg" && !/\.jpe?g$/i.test(file.name)
    ? file.name.replace(/\.[a-z0-9]+$/i, "") + ".jpg"
    : file.name;
  return new File([blob], name, { type: outputType });
}

/** Uploads (or replaces) one activity/subject's pubmat image. Compresses it first (downscale + re-encode — see compressPubmatImage), falling back to the original file untouched if compression fails or doesn't actually shrink it. Deletes the previous object first when its path would differ (e.g. a format change), so a re-upload never leaves an orphaned file behind. */
export async function uploadPubmat(
  type: PubmatActivityType, id: string, file: File, previousPath: string | null,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  if (!file.type.startsWith("image/")) return { ok: false, error: "Only image files are supported." };

  let toUpload = file;
  try {
    const compressed = await compressPubmatImage(file);
    if (compressed.size < file.size) toUpload = compressed;
  } catch {
    // Never let a compression failure block the upload — fall back to the original file.
  }

  const path = `${type}/${id}/pubmat.${extensionFor(toUpload)}`;
  if (previousPath && previousPath !== path) {
    await supabase.storage.from(PUBMAT_BUCKET).remove([previousPath]);
  }
  const { error: uploadError } = await supabase.storage.from(PUBMAT_BUCKET)
    .upload(path, toUpload, { contentType: toUpload.type, upsert: true });
  if (uploadError) return { ok: false, error: uploadError.message };
  const { error: updateError } = await supabase.from(TABLE_BY_TYPE[type]).update({ pubmat_path: path }).eq("id", id);
  if (updateError) return { ok: false, error: updateError.message };
  return { ok: true, path };
}

export async function removePubmat(type: PubmatActivityType, id: string, path: string): Promise<{ ok: boolean; error?: string }> {
  const { error: removeError } = await supabase.storage.from(PUBMAT_BUCKET).remove([path]);
  if (removeError) return { ok: false, error: removeError.message };
  const { error: updateError } = await supabase.from(TABLE_BY_TYPE[type]).update({ pubmat_path: null }).eq("id", id);
  return updateError ? { ok: false, error: updateError.message } : { ok: true };
}

/** Public URL for display — null-safe so callers can do `pubmatUrl(activity.pubmatPath)` directly. */
export function pubmatUrl(path: string | null): string | null {
  return path ? supabase.storage.from(PUBMAT_BUCKET).getPublicUrl(path).data.publicUrl : null;
}
