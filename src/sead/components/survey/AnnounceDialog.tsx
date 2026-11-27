import { useEffect, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { announceSurvey, fetchAnnouncementStatus, type AnnouncementStatus } from "../../surveyEditorApi";
import { formatWait } from "@/lib/surveyResults";

const when = (iso: string) => new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });
const scholars = (n: number) => `${n.toLocaleString("en-PH")} scholar${n === 1 ? "" : "s"}`;

/** "Announce this survey?": how many scholars will be told, then send. The database allows it once every 10 minutes per survey. */
export function AnnounceDialog({ surveyId, title, onClose, onSent }: { surveyId: string; title: string; onClose: () => void; onSent: () => void }) {
  const [status, setStatus] = useState<AnnouncementStatus | null>(null);
  const [sent, setSent] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetchAnnouncementStatus(surveyId).then(r => {
      if (cancelled) return;
      if (r.ok === false) setError(r.error); else setStatus(r.status);
    });
    return () => { cancelled = true; };
  }, [surveyId]);

  async function send() {
    setBusy(true);
    setError("");
    const r = await announceSurvey(surveyId);
    setBusy(false);
    if (r.ok === false) setError(r.error); else setSent(r.notified);
    onSent();                       // the button's 10-minute wait is read again, also after "someone else just announced it"
  }

  if (sent !== null) {
    return <ConfirmDialog title="Announcement sent" onClose={onClose} actions={[]}
      lines={[`${scholars(sent)} ${sent === 1 ? "was" : "were"} notified to answer "${title}".`, "You can announce this survey again in 10 minutes."]} />;
  }
  const lines = !status ? (error ? [] : ["Checking who would be notified…"]) : [
    status.toNotify === 0 ? "Every scholar has already responded to this survey, so there is nobody to notify."
      : `${scholars(status.toNotify)} who ${status.toNotify === 1 ? "has" : "have"} not responded to "${title}" will be notified, and can answer it from their portal home page even without attending the activity.`,
    ...(status.lastAt ? [`Last announced ${when(status.lastAt)}${status.lastBy ? ` by ${status.lastBy}` : ""} to ${scholars(status.lastCount ?? 0)}.`] : []),
    ...(status.secondsLeft > 0 ? [`You can announce it again in ${formatWait(status.secondsLeft)}.`] : []),
  ];
  const canSend = !!status && status.toNotify > 0 && status.secondsLeft <= 0;
  return <ConfirmDialog title="Announce this survey?" busy={busy} error={error} onClose={onClose} lines={lines}
    actions={canSend ? [{ label: "Send announcement", run: () => void send() }] : []} />;
}
