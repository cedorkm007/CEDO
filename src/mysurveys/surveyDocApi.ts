import { supabase } from "@/lib/supabase";
import type { SurveyDoc, SurveyItem } from "./surveyTypes";

/** What gets saved. Everything else on SurveyDoc (revision, role, …) is server-owned. */
export interface SaveableDoc {
  title: string;
  description: string;
  consentEnabled: boolean;
  consentText: string;
  items: SurveyItem[];
}

export interface IdRemap {
  /** Old question id -> id of its new version (a question that already had answers was reworded). */
  questions: Record<string, string>;
  options: Record<string, string>;
}

export type SaveResult =
  | { ok: true; revision: number; updatedAt: string; editedByName: string; remap: IdRemap }
  | { ok: false; conflict: true; revision: number; updatedAt: string; editedByName: string }
  | { ok: false; conflict: false; error: string };

/** The whole survey in one round trip (get_my_survey_doc). Null if it doesn't exist or the caller has no access. */
export async function loadSurveyDoc(surveyId: string): Promise<SurveyDoc | null> {
  const { data, error } = await supabase.rpc("get_my_survey_doc", { p_survey_id: surveyId });
  if (error || !data) return null;
  const d = data as Record<string, unknown>;
  return {
    id: d.id as string,
    ownerId: d.ownerId as string,
    title: d.title as string,
    description: (d.description as string) ?? "",
    status: d.status as SurveyDoc["status"],
    consentEnabled: Boolean(d.consentEnabled),
    consentText: (d.consentText as string) ?? "",
    revision: d.revision as number,
    role: ((d.role as SurveyDoc["role"] | null) ?? "viewer"),
    updatedAt: d.updatedAt as string,
    lastEditedByName: (d.lastEditedByName as string | null) ?? "",
    responseCount: Number(d.responseCount ?? 0),
    items: (d.items as SurveyItem[]) ?? [],
  };
}

/**
 * Saves the whole survey atomically (save_my_survey). `expectedRevision` is the
 * revision this client last saw: if someone else has saved since, nothing is
 * written and a conflict comes back instead of silently overwriting them.
 */
export async function saveSurveyDoc(surveyId: string, expectedRevision: number, doc: SaveableDoc): Promise<SaveResult> {
  const payload = {
    title: doc.title,
    description: doc.description,
    consentEnabled: doc.consentEnabled,
    consentText: doc.consentText,
    items: doc.items,
  };
  const { data, error } = await supabase.rpc("save_my_survey", {
    p_survey_id: surveyId, p_expected_revision: expectedRevision, p_doc: payload, p_force: false,
  });
  if (error) return { ok: false, conflict: false, error: error.message };
  const r = data as Record<string, unknown>;
  if (r.conflict) {
    return { ok: false, conflict: true, revision: r.revision as number, updatedAt: r.updatedAt as string, editedByName: (r.editedByName as string | null) ?? "" };
  }
  const remap = (r.remap as IdRemap | undefined) ?? { questions: {}, options: {} };
  return { ok: true, revision: r.revision as number, updatedAt: r.updatedAt as string, editedByName: (r.editedByName as string | null) ?? "", remap };
}

/** Cheap "has anyone else saved?" check used for polling. */
export async function fetchSurveyRevision(surveyId: string): Promise<number | null> {
  const { data, error } = await supabase.from("my_surveys").select("revision").eq("id", surveyId).maybeSingle();
  if (error || !data) return null;
  return data.revision as number;
}
