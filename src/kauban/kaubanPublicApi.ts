import { supabase } from "@/lib/supabase";
import { getCachedMetadata, setCachedMetadata } from "./offlineMetadataCache";

/**
 * Read-only Supabase access for Kauban's public /kauban pages — anon key,
 * no accounts (see docs/kauban/PROGRESS.md milestone 1). Deliberately
 * separate from src/kauban/admin/kaubanAdminApi.ts: that module has
 * write operations and pulls in the video-compression code path, neither
 * of which any public visitor's bundle should need.
 *
 * Every fetch here falls back to the last successful result (cached via
 * offlineMetadataCache.ts) when the live request fails — see that file's
 * comment for why: without it, going offline just silently produced an
 * empty list instead of a visible error, which broke sign-word matching
 * in a way that looked like nothing was wrong.
 */

const MEDIA_BUCKET = "kauban-media";

export function getVideoPublicUrl(path: string): string {
  return supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
}

export interface SignCategory {
  id: string;
  key: string;
  label: string;
}

export async function fetchSignCategories(): Promise<SignCategory[]> {
  const { data, error } = await supabase
    .from("kauban_sign_categories")
    .select("id, key, label")
    .order("sort_order");
  if (error || !data) return getCachedMetadata<SignCategory[]>("signCategories") ?? [];
  setCachedMetadata("signCategories", data);
  return data;
}

export interface SignWord {
  id: string;
  categoryId: string;
  phrase: string;
  label: string;
  clipVideoPath: string | null;
  tutorialVideoPath: string | null;
}

export async function fetchSignWords(): Promise<SignWord[]> {
  const { data, error } = await supabase
    .from("kauban_sign_words")
    .select("id, category_id, phrase, label, clip_video_path, tutorial_video_path")
    .order("sort_order");
  if (error || !data) return getCachedMetadata<SignWord[]>("signWords") ?? [];
  const words = data.map(r => ({
    id: r.id, categoryId: r.category_id, phrase: r.phrase, label: r.label,
    clipVideoPath: r.clip_video_path, tutorialVideoPath: r.tutorial_video_path,
  }));
  setCachedMetadata("signWords", words);
  return words;
}

export interface QuickPhraseCategory {
  id: string;
  name: string;
  icon: string | null;
  color: string;
}

export async function fetchQuickPhraseCategories(): Promise<QuickPhraseCategory[]> {
  const { data, error } = await supabase
    .from("kauban_quick_phrase_categories")
    .select("id, name, icon, color")
    .order("sort_order");
  if (error || !data) return getCachedMetadata<QuickPhraseCategory[]>("quickPhraseCategories") ?? [];
  setCachedMetadata("quickPhraseCategories", data);
  return data;
}

export interface QuickPhrase {
  id: string;
  categoryId: string;
  text: string;
}

export async function fetchQuickPhrases(): Promise<QuickPhrase[]> {
  const { data, error } = await supabase
    .from("kauban_quick_phrases")
    .select("id, category_id, text")
    .order("sort_order");
  if (error || !data) return getCachedMetadata<QuickPhrase[]>("quickPhrases") ?? [];
  const phrases = data.map(r => ({ id: r.id, categoryId: r.category_id, text: r.text }));
  setCachedMetadata("quickPhrases", phrases);
  return phrases;
}

export interface EmergencyContact {
  id: string;
  name: string;
  number: string;
  color: string;
}

/** Bundled, staff-managed hotline numbers (src/kauban/admin/EmergencyContentManager.tsx)
 *  — not a visitor's own personal contacts, see localEmergencyContacts.ts for those. */
export async function fetchEmergencyContacts(): Promise<EmergencyContact[]> {
  const { data, error } = await supabase
    .from("kauban_emergency_contacts")
    .select("id, name, number, color")
    .order("sort_order");
  if (error || !data) return getCachedMetadata<EmergencyContact[]>("emergencyContacts") ?? [];
  setCachedMetadata("emergencyContacts", data);
  return data;
}

export interface EmergencyMessage {
  id: string;
  message: string;
}

export async function fetchEmergencyMessages(): Promise<EmergencyMessage[]> {
  const { data, error } = await supabase
    .from("kauban_emergency_messages")
    .select("id, message")
    .order("sort_order");
  if (error || !data) return getCachedMetadata<EmergencyMessage[]>("emergencyMessages") ?? [];
  setCachedMetadata("emergencyMessages", data);
  return data;
}
