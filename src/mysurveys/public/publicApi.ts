import type { QuestionItem, RunnerAnswers, SurveyItem } from "../surveyTypes";

/**
 * The public respondent page talks to Supabase with plain fetch() instead of
 * the supabase-js client: that library is the single biggest thing the page
 * would otherwise download, and this page only ever makes two calls. Both are
 * the security-definer functions in supabase_migration_my_surveys_publishing.sql
 * (the anon role has no table access at all).
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export interface PublicSurvey {
  title: string;
  description: string;
  consentEnabled: boolean;
  consentText: string;
  thankYouMessage: string;
  oneResponsePerDevice: boolean;
  items: SurveyItem[];
}

export type LoadResult =
  | { state: "open"; survey: PublicSurvey }
  | { state: "closed"; title: string }
  | { state: "not_found" }
  | { state: "error" };

export type SubmitError = "closed" | "duplicate" | "not_found" | "invalid" | "network";
export type SubmitResult = { ok: true } | { ok: false; error: SubmitError; message?: string };

async function rpc(fn: string, args: Record<string, unknown>): Promise<{ ok: true; data: unknown } | { ok: false }> {
  try {
    const headers: Record<string, string> = { apikey: SUPABASE_KEY, "Content-Type": "application/json" };
    if (SUPABASE_KEY.startsWith("eyJ")) headers.Authorization = `Bearer ${SUPABASE_KEY}`;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(args) });
    if (!res.ok) return { ok: false };
    return { ok: true, data: await res.json() };
  } catch {
    return { ok: false };
  }
}

export async function loadPublicSurvey(slug: string): Promise<LoadResult> {
  const res = await rpc("get_public_survey", { p_slug: slug });
  if (!res.ok || !res.data || typeof res.data !== "object") return { state: "error" };
  const d = res.data as Record<string, unknown>;
  if (d.state === "not_found") return { state: "not_found" };
  if (d.state === "closed") return { state: "closed", title: (d.title as string) ?? "" };
  if (d.state !== "open") return { state: "error" };

  // The public payload leaves out staff-only fields; fill them so the same respondent screens can render it.
  const items = ((d.items as Record<string, unknown>[]) ?? []).map((raw): SurveyItem => {
    if (raw.kind === "section") {
      return { kind: "section", id: raw.id as string, title: (raw.title as string) ?? "", description: (raw.description as string) ?? "" };
    }
    const q: QuestionItem = {
      kind: "question",
      id: raw.id as string,
      questionKey: raw.questionKey as string,
      version: 1,
      type: raw.type as QuestionItem["type"],
      text: (raw.text as string) ?? "",
      helpText: (raw.helpText as string) ?? "",
      required: Boolean(raw.required),
      scaleMin: (raw.scaleMin as number | null) ?? null,
      scaleMax: (raw.scaleMax as number | null) ?? null,
      scaleMinLabel: (raw.scaleMinLabel as string) ?? "",
      scaleMaxLabel: (raw.scaleMaxLabel as string) ?? "",
      hasResponses: false,
      options: ((raw.options as { id: string; label: string }[]) ?? []).map(o => ({ id: o.id, label: o.label })),
    };
    return q;
  });

  return {
    state: "open",
    survey: {
      title: (d.title as string) ?? "",
      description: (d.description as string) ?? "",
      consentEnabled: Boolean(d.consentEnabled),
      consentText: (d.consentText as string) ?? "",
      thankYouMessage: (d.thankYouMessage as string) ?? "",
      oneResponsePerDevice: Boolean(d.oneResponsePerDevice),
      items,
    },
  };
}

export async function submitPublicResponse(slug: string, deviceId: string, consent: boolean, answers: RunnerAnswers): Promise<SubmitResult> {
  const payload = Object.entries(answers).map(([questionId, a]) => ({
    questionId,
    ...(a.text !== undefined ? { text: a.text } : {}),
    ...(a.number !== undefined ? { number: a.number } : {}),
    ...(a.optionIds !== undefined ? { optionIds: a.optionIds } : {}),
  }));
  const res = await rpc("submit_my_survey_response", { p_slug: slug, p_device_id: deviceId, p_consent: consent, p_answers: payload });
  if (!res.ok || !res.data || typeof res.data !== "object") return { ok: false, error: "network" };
  const d = res.data as Record<string, unknown>;
  if (d.ok === true) return { ok: true };
  return { ok: false, error: ((d.error as string | undefined) ?? "invalid") as SubmitError, message: d.message as string | undefined };
}

/** A random id kept in this browser, used only for the optional "one response per device" setting. */
export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem("my-survey-device-id");
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem("my-survey-device-id", id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}
