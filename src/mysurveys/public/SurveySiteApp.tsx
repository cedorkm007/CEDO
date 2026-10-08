import { useCallback, useEffect, useState } from "react";
import { SurveyRunner } from "../respondent/SurveyRunner";
import type { RunnerAnswers } from "../surveyTypes";
import { getDeviceId, loadPublicSurvey, submitPublicResponse, type PublicSurvey } from "./publicApi";

/**
 * Root of the public, no-login respondent page (/s/<slug>, served from
 * survey.html -- see vercel.json). Looks the survey up by its secret slug, shows
 * a friendly page when it is closed / missing / already answered, and otherwise
 * runs the one-question-at-a-time screens (the same SurveyRunner the builder's
 * Preview uses). Answers are saved by the submit_my_survey_response function,
 * which re-checks everything on the server.
 */

type View =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "not_found" }
  | { kind: "closed" }
  | { kind: "already" }
  | { kind: "open"; survey: PublicSurvey };

function slugFromPath(): string {
  const m = window.location.pathname.match(/^\/s\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]).toLowerCase() : "";
}

function submittedKey(slug: string) { return `my-survey-submitted:${slug}`; }

function MessageCard({ icon, title, children, action }: { icon: string; title: string; children?: React.ReactNode; action?: { label: string; onClick: () => void } }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f4f7fb] px-4 py-8 text-[#062444]">
      <div className="w-full max-w-xl rounded-2xl border border-[#dbe4f0] bg-white p-6 text-center shadow-sm sm:p-10">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#eaf5fc] text-3xl" aria-hidden="true">{icon}</div>
        <h1 className="text-[24px] font-bold leading-snug">{title}</h1>
        {children && <div className="mt-3 text-[16px] leading-relaxed text-slate-700">{children}</div>}
        {action && (
          <button onClick={action.onClick} className="mt-6 min-h-[48px] rounded-xl bg-[#062444] px-6 text-[16px] font-semibold text-white hover:bg-[#0a3a6b] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0088cc]/40">
            {action.label}
          </button>
        )}
      </div>
    </main>
  );
}

export function SurveySiteApp() {
  const slug = slugFromPath();
  const [view, setView] = useState<View>({ kind: "loading" });

  const load = useCallback(async () => {
    setView({ kind: "loading" });
    if (!slug) { setView({ kind: "not_found" }); return; }
    const res = await loadPublicSurvey(slug);
    if (res.state === "open") {
      let already = false;
      try { already = res.survey.oneResponsePerDevice && localStorage.getItem(submittedKey(slug)) === "1"; } catch { /* storage unavailable: the server still enforces it */ }
      setView(already ? { kind: "already" } : { kind: "open", survey: res.survey });
    } else if (res.state === "closed") setView({ kind: "closed" });
    else if (res.state === "not_found") setView({ kind: "not_found" });
    else setView({ kind: "error" });
  }, [slug]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    document.title = view.kind === "open" && view.survey.title ? view.survey.title : "Survey";
  }, [view]);

  async function handleSubmit(answers: RunnerAnswers, consent: boolean): Promise<{ ok: boolean; error?: string }> {
    const res = await submitPublicResponse(slug, getDeviceId(), consent, answers);
    if (res.ok) {
      try { localStorage.setItem(submittedKey(slug), "1"); } catch { /* ignore */ }
      return { ok: true };
    }
    if (res.error === "closed") { setView({ kind: "closed" }); return { ok: false }; }
    if (res.error === "duplicate") { setView({ kind: "already" }); return { ok: false }; }
    if (res.error === "not_found") { setView({ kind: "not_found" }); return { ok: false }; }
    if (res.error === "network") return { ok: false, error: "We couldn't reach the server. Check your internet connection and try again — your answers are still here." };
    return { ok: false, error: res.message };
  }

  if (view.kind === "loading") {
    return <main className="flex min-h-screen items-center justify-center bg-[#f4f7fb] text-[16px] text-slate-600" role="status">Loading survey…</main>;
  }
  if (view.kind === "error") {
    return (
      <MessageCard icon="📡" title="We couldn't load the survey" action={{ label: "Try again", onClick: () => void load() }}>
        Please check your internet connection and try again.
      </MessageCard>
    );
  }
  if (view.kind === "not_found") {
    return <MessageCard icon="🔍" title="We couldn't find this survey">Please check the link or QR code and try again.</MessageCard>;
  }
  if (view.kind === "closed") {
    return <MessageCard icon="🔒" title="This survey is no longer accepting responses">Thank you for your interest.</MessageCard>;
  }
  if (view.kind === "already") {
    return <MessageCard icon="✅" title="You've already responded">Our records show this device has already submitted a response to this survey. Thank you!</MessageCard>;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <SurveyRunner
        className="flex-1"
        mode="live"
        survey={view.survey}
        storageKey={`my-survey-progress:${slug}`}
        thankYouMessage={view.survey.thankYouMessage}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
