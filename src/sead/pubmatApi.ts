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

/** Uploads (or replaces) one activity/subject's pubmat image. Deletes the previous object first when its path would differ (e.g. a format change), so a re-upload never leaves an orphaned file behind. */
export async function uploadPubmat(
  type: PubmatActivityType, id: string, file: File, previousPath: string | null,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  if (!file.type.startsWith("image/")) return { ok: false, error: "Only image files are supported." };
  const path = `${type}/${id}/pubmat.${extensionFor(file)}`;
  if (previousPath && previousPath !== path) {
    await supabase.storage.from(PUBMAT_BUCKET).remove([previousPath]);
  }
  const { error: uploadError } = await supabase.storage.from(PUBMAT_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: true });
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
