import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import jsQR from "jsqr";
import { Camera, Keyboard, CheckCircle2, XCircle, Loader2, X } from "lucide-react";
import { redeemAttendanceCode } from "../../scholarApi";
import { syncAndFetchUnreadFormUnlockNotifications, markFormUnlockNotificationsRead, type FormUnlockNotification } from "../../formsApi";
import { NewlyUnlockedModal } from "./NewlyUnlockedModal";
import { SurveyResponseModal } from "./SurveyResponseModal";

type Mode = "scan" | "manual";
type ScanResult = { ok: boolean; message: string; tone: "success" | "error" | "warning" };
type Result = ScanResult | null;

const RESULT_DISPLAY_SECONDS = 15;

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

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const lastAttemptedCode = useRef<string>("");
  const pendingCode = useRef<string>("");
  const pendingCodeStreak = useRef(0);

  async function submitCode(code: string) {
    if (busy || !code.trim()) return;
    // Avoid re-submitting the same code repeatedly while it's still in view of the camera.
    if (code === lastAttemptedCode.current) return;
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
        return;
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
    } else {
      const message = res.error || "Invalid QR code.";
      setResult({ ok: false, tone: /you already completed/i.test(message) ? "warning" : "error", message });
      // Allow retrying the same code after a failure (e.g. typo), just not spamming a success.
      lastAttemptedCode.current = "";
    }
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

  useEffect(() => {
    if (mode !== "scan") {
      stopCamera();
      return;
    }
    startCamera();
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  async function startCamera() {
    setCameraError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      tick();
    } catch {
      setCameraError("Couldn't access the camera. You can still enter the code manually below.");
      setMode("manual");
    }
  }

  function stopCamera() {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }

  function tick() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const qr = jsQR(imageData.data, imageData.width, imageData.height);
        if (qr?.data) {
          // Require the same decode on 2 consecutive frames before acting on
          // it — a single blurry/partial frame can make jsQR misread a code,
          // which the backend then correctly rejects as invalid. Waiting one
          // extra ~16ms frame for confirmation filters that out.
          if (qr.data === pendingCode.current) {
            pendingCodeStreak.current += 1;
          } else {
            pendingCode.current = qr.data;
            pendingCodeStreak.current = 1;
          }
          if (pendingCodeStreak.current >= 2) submitCode(qr.data);
        } else {
          pendingCode.current = "";
          pendingCodeStreak.current = 0;
        }
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }

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
          <canvas ref={canvasRef} className="hidden" />
          <div className="absolute inset-6 border-2 border-[#F3BC00] rounded-xl pointer-events-none" />
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
