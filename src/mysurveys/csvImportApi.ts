import { supabase } from "@/lib/supabase";
import type { CsvImportDoc } from "./csv/surveyCsv";

/**
 * Creates the Draft survey from a validated CSV document in one transaction
 * (create_my_survey_from_doc, supabase_migration_my_surveys_csv_import.sql).
 * The server re-validates the document, so a bad one creates nothing.
 */
export async function createSurveyFromCsvDoc(doc: CsvImportDoc): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("create_my_survey_from_doc", { p_doc: doc });
  if (error || !data) return { ok: false, error: error?.message ?? "The survey could not be created." };
  return { ok: true, id: data as string };
}
