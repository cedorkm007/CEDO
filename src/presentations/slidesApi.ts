import { supabase } from "@/lib/supabase";

/** Only "title" has real settings UI in the editor so far (Phase 2) — the other three are selectable now so a slide's type sticks once Phase 3 adds their settings/results UI, matching the DB check constraint already allowing all four. */
export type SlideType = "title" | "word_cloud" | "multiple_choice" | "ranking";

export interface TitleSlideSettings {
  heading: string;
  subheading: string;
}

export type SlideSettings = TitleSlideSettings | Record<string, never>;

export interface PresentationSlide {
  id: string;
  presentationId: string;
  type: SlideType;
  orderIndex: number;
  settings: SlideSettings;
  createdAt: string;
  updatedAt: string;
}

export const SLIDE_TYPE_LABELS: Record<SlideType, string> = {
  title: "Title / Text",
  word_cloud: "Word Cloud",
  multiple_choice: "Multiple Choice",
  ranking: "Ranking",
};

/** Slide types with settings/results UI built so far — the editor disables picking the others until their phase lands. */
export const IMPLEMENTED_SLIDE_TYPES: SlideType[] = ["title"];

function defaultSettingsFor(type: SlideType): SlideSettings {
  if (type === "title") return { heading: "Untitled slide", subheading: "" };
  return {};
}

function rowToSlide(r: Record<string, unknown>): PresentationSlide {
  return {
    id: r.id as string,
    presentationId: r.presentation_id as string,
    type: r.type as SlideType,
    orderIndex: r.order_index as number,
    settings: (r.settings as SlideSettings) ?? {},
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export async function fetchSlides(presentationId: string): Promise<PresentationSlide[]> {
  const { data, error } = await supabase.from("presentation_slides")
    .select("*").eq("presentation_id", presentationId).order("order_index");
  if (error || !data) return [];
  return data.map(rowToSlide);
}

export async function createSlide(presentationId: string, type: SlideType, orderIndex: number): Promise<{ ok: true; slide: PresentationSlide } | { ok: false; error: string }> {
  const { data, error } = await supabase.from("presentation_slides")
    .insert({ presentation_id: presentationId, type, order_index: orderIndex, settings: defaultSettingsFor(type) })
    .select("*").single();
  if (error || !data) return { ok: false, error: error?.message ?? "Failed to add slide." };
  return { ok: true, slide: rowToSlide(data) };
}

/**
 * order_index here is a placeholder, not the final position -- the
 * caller (PresentationEditorPage) always follows this with reorderSlides()
 * over the full corrected list, since simply inserting at a given index
 * without shifting every later slide up would leave two slides tied on
 * the same order_index (order among ties isn't guaranteed).
 */
export async function duplicateSlide(slide: PresentationSlide): Promise<{ ok: true; slide: PresentationSlide } | { ok: false; error: string }> {
  const { data, error } = await supabase.from("presentation_slides")
    .insert({ presentation_id: slide.presentationId, type: slide.type, order_index: slide.orderIndex, settings: slide.settings })
    .select("*").single();
  if (error || !data) return { ok: false, error: error?.message ?? "Failed to duplicate slide." };
  return { ok: true, slide: rowToSlide(data) };
}

export async function deleteSlide(id: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("presentation_slides").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Switching a slide's type resets its settings to that type's own default shape — Phase 2 has no cross-type field mapping to preserve. */
export async function updateSlideType(id: string, type: SlideType): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("presentation_slides")
    .update({ type, settings: defaultSettingsFor(type), updated_at: new Date().toISOString() }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function updateSlideSettings(id: string, settings: SlideSettings): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("presentation_slides")
    .update({ settings, updated_at: new Date().toISOString() }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Persists a full reordering after a drag in the thumbnail sidebar — writes every slide's new order_index in one batch (small lists, no need for a dedicated RPC). */
export async function reorderSlides(orderedIds: string[]): Promise<{ ok: boolean; error?: string }> {
  const results = await Promise.all(orderedIds.map((id, index) =>
    supabase.from("presentation_slides").update({ order_index: index }).eq("id", id)
  ));
  const failed = results.find(r => r.error);
  return failed?.error ? { ok: false, error: failed.error.message } : { ok: true };
}
