import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Camera, Keyboard, CheckCircle2, XCircle, Loader2, X } from "lucide-react";
import { redeemAttendanceCode } from "../../scholarApi";
import { useQrCameraScanner } from "@/lib/useQrCameraScanner";
import { syncAndFetchUnreadFormUnlockNotifications, markFormUnlockNotificationsRead, type FormUnlockNotification } from "../../formsApi";
import { NewlyUnlockedModal } from "./NewlyUnlockedModal";
import { SurveyResponseModal } from "./SurveyResponseModal";

type Mode = "scan" | "manual";
type ScanResult = { ok: boolean; message: string; tone: "success" | "error" | "warning" };
type Result = ScanResult | null;

const RESULT_DISPLAY_SECONDS = 15;

// After a code is rejected, the camera won't auto-resubmit that SAME code for
// this long -- it's usually still sitting in view, and without a pause it was
// resent over and over, hammering the server and restarting the error card's
// countdown each time. A different code is read immediately; the manual
// Submit button is never held.
const FAILED_RETRY_COOLDOWN_MS = 5000;

/**
 * Centered, hard-to-miss overlay for a scan result — replaces the old
 * below-the-camera banner, which was easy to miss and scrolled out of view
 * before a scholar could screenshot it as proof of attendance. Stays up for
 * RESULT_DISPLAY_SECONDS with a visible countdown, or closes immediately on
 * the close button / backdrop click.
 */
function ScanResultOverlay({ result, onClose }: { result: ScanResult; onClose: () => void }) {
  const [secondsLeft, setSecondsLeft] = useState(RESULT_DISPLAY_SECONDS);

  useEffect(() => {
    setSecondsLeft(RESULT_DISPLAY_SECONDS);
    const interval = setInterval(() => {
      setSecondsLeft(s => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  useEffect(() => {
    if (secondsLeft === 0) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft]);

  const toneStyles = result.tone === "success"
    ? "border-green-300 bg-green-50 text-green-700"
    : result.tone === "warning"
    ? "border-yellow-300 bg-yellow-50 text-yellow-800"
    : "border-red-300 bg-red-50 text-red-600";
  const Icon = result.ok ? CheckCircle2 : XCircle;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[150] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, opacity: 0 }}
        className={`relative w-full max-w-sm rounded-2xl border-2 bg-white px-6 py-8 text-center shadow-2xl ${toneStyles}`}
        onClick={e => e.stopPropagation()}>
        <button onClick={onClose} aria-label="Close" className="absolute top-3 right-3 text-slate-400 hover:text-slate-600">
          <X size={20} />
        </button>
        <Icon size={44} className="mx-auto mb-3" />
        <p className="text-[16px] font-bold leading-snug">{result.message}</p>
        <p className="mt-5 text-[11px] font-semibold text-slate-400">Closing in {secondsLeft}s</p>
      </motion.div>
    </motion.div>
  );
}

export function AttendanceScanner({ onNavigateToForms }: { onNavigateToForms: () => void }) {
  const [mode, setMode] = useState<Mode>("scan");
  const [manualCode, setManualCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const [cameraError, setCameraError] = useState("");
  const [newlyUnlocked, setNewlyUnlocked] = useState<FormUnlockNotification[]>([]);
  const [pendingSurvey, setPendingSurvey] = useState<{ surveyId: string; kind?: string } | null>(null);

  const lastAttemptedCode = useRef<string>("");
  const lastFailure = useRef<{ code: string; at: number } | null>(null);

  /** "skipped" = nothing was sent (blank, busy, or the same code is still being handled). */
  async function submitCode(code: string): Promise<"accepted" | "rejected" | "skipped"> {
    if (busy || !code.trim()) return "skipped";
    // Avoid re-submitting the same code repeatedly while it's still in view of the camera.
    if (code === lastAttemptedCode.current) return "skipped";
    lastAttemptedCode.current = code;

    setBusy(true);
    setResult(null);
    const res = await redeemAttendanceCode(code);
    setBusy(false);
    if (res.ok) {
      if (res.surveyPending && res.surveyId) {
        // Hold off on the success banner and any form-unlock check until
        // the survey is actually finished — the attendance/voucher itself
        // isn't finalized yet (see redeem_attendance_code's pending_survey
        // status), so nothing has actually unlocked either.
        setPendingSurvey({ surveyId: res.surveyId, kind: res.kind });
        return "accepted";
      }
      const label = res.kind === "time_in" ? "Timed in" : res.kind === "time_out" ? "Timed out" : "Hour credited";
      if (res.categoryCompleted) {
        setResult({
          ok: true, tone: "warning",
          message: `${label} for "${res.activityName ?? "the activity"}" — you've already completed this SDP requirement, so this scan is for attendance monitoring only.`,
        });
      } else {
        setResult({ ok: true, tone: "success", message: `${label} for "${res.activityName ?? "the activity"}".` });
      }
      setNewlyUnlocked(await syncAndFetchUnreadFormUnlockNotifications());
      return "accepted";
    }
    const message = res.error || "Invalid QR code.";
    setResult({ ok: false, tone: /you already completed/i.test(message) ? "warning" : "error", message });
    // Allow retrying the same code after a failure (e.g. typo), just not spamming a success.
    lastAttemptedCode.current = "";
    return "rejected";
  }

  /** Entry point for codes read by the camera: same as submitCode, but backs off a code that was just rejected. */
  async function submitScannedCode(code: string) {
    const failure = lastFailure.current;
    if (failure && failure.code === code && Date.now() - failure.at < FAILED_RETRY_COOLDOWN_MS) return;
    if ((await submitCode(code)) === "rejected") lastFailure.current = { code, at: Date.now() };
  }

  async function handleSurveyFinalized(finalized: { finalizedCount: number; activityName: string }) {
    const label = pendingSurvey?.kind === "voucher" ? "Hour credited" : "Timed out";
    setPendingSurvey(null);
    setResult({ ok: true, tone: "success", message: `${label} for "${finalized.activityName}".` });
    setNewlyUnlocked(await syncAndFetchUnreadFormUnlockNotifications());
  }

  function dismissNewlyUnlocked() {
    const ids = newlyUnlocked.map(n => n.notificationId);
    setNewlyUnlocked([]);
    if (ids.length > 0) void markFormUnlockNotificationsRead(ids);
  }

  useEffect(() => { if (mode === "scan") setCameraError(""); }, [mode]);

  // The hook always calls the latest submitScannedCode, so busy and the rest
  // of this component's state are current -- the camera loop starts once and
  // would otherwise keep using the first render's copies.
  const { videoRef, showHint } = useQrCameraScanner({
    active: mode === "scan",
    onCode: submitScannedCode,
    onUnavailable: () => {
      setCameraError("Couldn't access the camera. You can still enter the code manually below.");
      setMode("manual");
    },
  });

  return (
    <>
    <div className="max-w-md mx-auto">
      <div className="flex gap-2 mb-4">
        <button onClick={() => setMode("scan")}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border text-[12.5px] font-bold ${mode === "scan" ? "border-[#062444] bg-[#062444] text-white" : "border-[#e6ecf5] text-slate-500"}`}>
          <Camera size={15} /> Scan QR
        </button>
        <button onClick={() => setMode("manual")}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border text-[12.5px] font-bold ${mode === "manual" ? "border-[#062444] bg-[#062444] text-white" : "border-[#e6ecf5] text-slate-500"}`}>
          <Keyboard size={15} /> Enter Code
        </button>
      </div>

      {mode === "scan" ? (
        <div className="relative rounded-2xl overflow-hidden bg-black aspect-square">
          <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
          <div className="absolute inset-6 border-2 border-[#F3BC00] rounded-xl pointer-events-none" />
          {showHint && !busy && !cameraError && (
            <div className="pointer-events-none absolute inset-x-3 bottom-3 rounded-lg bg-black/70 px-3 py-2 text-center text-[12px] leading-snug text-white">
              No QR code detected yet. Hold the phone steady about 15–25 cm from the code, and make sure it's well lit.
            </div>
          )}
          {cameraError && (
            <div className="absolute inset-0 bg-black/80 flex items-center justify-center p-6">
              <p className="text-white text-[13px] text-center">{cameraError}</p>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white border border-[#e6ecf5] rounded-2xl p-6">
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">Attendance Code</label>
          <div className="flex gap-2">
            <input value={manualCode} onChange={e => setManualCode(e.target.value.toUpperCase())}
              placeholder="e.g. ABC1234"
              className="flex-1 border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm font-mono tracking-wider outline-none focus:border-[#0088cc]" />
            <button onClick={() => submitCode(manualCode)} disabled={busy || !manualCode.trim()}
              className="bg-[#062444] text-white text-sm font-semibold rounded-lg px-4 disabled:opacity-50">
              {busy ? <Loader2 size={16} className="animate-spin" /> : "Submit"}
            </button>
          </div>
        </div>
      )}
    </div>
    <AnimatePresence>
      {result && <ScanResultOverlay result={result} onClose={() => setResult(null)} />}
    </AnimatePresence>
    <NewlyUnlockedModal notifications={newlyUnlocked} onGoToForms={onNavigateToForms} onClose={dismissNewlyUnlocked} />
    {pendingSurvey && (
      <SurveyResponseModal
        surveyId={pendingSurvey.surveyId}
        onClose={() => setPendingSurvey(null)}
        onFinalized={handleSurveyFinalized}
      />
    )}
    </>
  );
}
