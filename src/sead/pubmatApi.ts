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

/** True if any pixel's alpha channel is below 255 — i.e. the image actually uses transparency, as opposed to an opaque photo/poster that merely happens to be saved as PNG. */
function hasRealTransparency(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  const { data } = ctx.getImageData(0, 0, width, height);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

/**
 * Compresses a pubmat image client-side before upload — same
 * never-block-the-upload-on-failure, only-keep-it-if-actually-smaller
 * approach as compressSubmissionFile (src/scholar/submissionCompression.ts).
 * A PNG only stays PNG if it actually uses transparency (a real logo/overlay
 * cutout) — an opaque PNG (a poster or photo someone happened to save as
 * PNG) is re-encoded to JPEG like everything else, since PNG's lossless
 * encoding on a photo-like image can be many times larger for no visual
 * benefit once there's no transparency to preserve.
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

  const outputType = file.type === "image/png" && hasRealTransparency(ctx, width, height) ? "image/png" : "image/jpeg";
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

  // A new name each time, so a replaced picture is never shown from the browser's or the CDN's copy of the old one.
  const path = `${type}/${id}/pubmat-${Date.now()}.${extensionFor(toUpload)}`;
  if (previousPath && previousPath !== path) {
    await supabase.storage.from(PUBMAT_BUCKET).remove([previousPath]);
  }
  const { error: uploadError } = await supabase.storage.from(PUBMAT_BUCKET)
    .upload(path, toUpload, { contentType: toUpload.type, upsert: true });
  if (uploadError) return { ok: false, error: readableUploadError(uploadError.message) };
  const saved = await savePubmatPath(type, id, path);
  if (!saved.ok) return { ok: false, error: saved.error };
  return { ok: true, path };
}

export async function removePubmat(type: PubmatActivityType, id: string, path: string): Promise<{ ok: boolean; error?: string }> {
  const { error: removeError } = await supabase.storage.from(PUBMAT_BUCKET).remove([path]);
  if (removeError) return { ok: false, error: readableUploadError(removeError.message) };
  return savePubmatPath(type, id, null);
}

/** The storage service answers a refused upload with a technical sentence; say what it means. */
function readableUploadError(message: string): string {
  if (/row-level security|violates|not authorized|unauthorized|403/i.test(message)) {
    return "You are not allowed to upload a pubmat for this activity. Please ask the IT admin to run the latest database update (activity pubmats for SDP monitors).";
  }
  return message;
}

/**
 * Saves (or clears) the picture's path on the activity. The database function checks who is asking and says so when it cannot save; if the function is
 * not installed yet (the SQL file has not been run) it falls back to the old direct update, and even then reports an update that changed no row
 * instead of pretending it worked.
 */
async function savePubmatPath(type: PubmatActivityType, id: string, path: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.rpc("set_activity_pubmat", { p_type: type, p_id: id, p_path: path });
  if (!error) return { ok: true };
  const missing = error.code === "PGRST202" || /could not find the function|does not exist/i.test(error.message ?? "");
  if (!missing) return { ok: false, error: error.message };
  const { data, error: updateError } = await supabase.from(TABLE_BY_TYPE[type]).update({ pubmat_path: path }).eq("id", id).select("id");
  if (updateError) return { ok: false, error: updateError.message };
  if (!data || data.length === 0) return { ok: false, error: "The picture was uploaded, but it could not be attached to the activity. Please ask the IT admin to run the latest database update (activity pubmats for SDP monitors)." };
  return { ok: true };
}

/** Public URL for display — null-safe so callers can do `pubmatUrl(activity.pubmatPath)` directly. */
export function pubmatUrl(path: string | null): string | null {
  return path ? supabase.storage.from(PUBMAT_BUCKET).getPublicUrl(path).data.publicUrl : null;
}
