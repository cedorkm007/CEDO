import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import jsQR from "jsqr";
import { Camera, Keyboard, CheckCircle2, XCircle, Clock3, Loader2, X } from "lucide-react";
import { recordMonitorAttendance, type AttendanceKind, type ScanOutcome } from "../monitorAttendanceApi";
import { fetchAttendanceSessionType, type ActivityType } from "../activityMonitorsApi";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A scholar's QR encodes the public emergency-info page's URL
 * (ScholarIdQrCode.tsx's scholarIdUrl()), not a bare token — pull the
 * qr_token back out of that URL's `?token=` param (or accept a raw UUID
 * directly, in case some other source ever encodes just the token).
 */
function extractQrToken(raw: string): string | null {
  const trimmed = raw.trim();
  if (UUID_RE.test(trimmed)) return trimmed;
  try {
    const token = new URL(trimmed).searchParams.get("token");
    return token && UUID_RE.test(token) ? token : null;
  } catch {
    return null;
  }
}

type Mode = "scan" | "manual";
type Tone = "success" | "neutral" | "error";
interface ScanFeedback { tone: Tone; message: string; }

const OUTCOME_MESSAGE: Record<Exclude<ScanOutcome, "success">, string> = {
  already_scanned: "Already scanned for this activity.",
  unrecognized_token: "Scholar not recognized — check the QR code or ID and try again.",
  not_eligible: "This scholar isn't eligible for this activity's year level.",
  removed_scholar: "This scholar's account is no longer active.",
  attendance_not_enabled: "Attendance hasn't been enabled for this activity yet.",
};
const INVALID_QR_MESSAGE = "Couldn't read a scholar QR code — try again.";

/** Full-screen result card — success (green), already_scanned (neutral gray, distinct from a genuine error), everything else (red). */
function ResultOverlay({ feedback, onClose }: { feedback: ScanFeedback; onClose: () => void }) {
  const toneStyles = feedback.tone === "success"
    ? "border-green-300 bg-green-50 text-green-700"
    : feedback.tone === "neutral"
    ? "border-slate-300 bg-slate-50 text-slate-600"
    : "border-red-300 bg-red-50 text-red-600";
  const Icon = feedback.tone === "success" ? CheckCircle2 : feedback.tone === "neutral" ? Clock3 : XCircle;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[210] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, opacity: 0 }}
        className={`relative w-full max-w-sm rounded-2xl border-2 bg-white px-6 py-8 text-center shadow-2xl ${toneStyles}`}
        onClick={e => e.stopPropagation()}>
        <button onClick={onClose} aria-label="Close" className="absolute top-3 right-3 text-slate-400 hover:text-slate-600"><X size={20} /></button>
        <Icon size={44} className="mx-auto mb-3" />
        <p className="text-[16px] font-bold leading-snug">{feedback.message}</p>
      </motion.div>
    </motion.div>
  );
}

/**
 * Full-screen phone scanner tool for a monitor — the reverse of the
 * scholar-facing AttendanceScanner (src/scholar/components/dashboard/
 * AttendanceScanner.tsx), which this deliberately mirrors the camera/decode
 * mechanics of (same jsQR + getUserMedia + canvas-tick loop, same 2-frame
 * confirmation, same manual-entry fallback). Differences: decodes a
 * scholar's permanent qr_token instead of an activity-scoped code, covers
 * the whole screen (a dedicated tool, not one panel among several), keeps
 * a running success counter across scans, and has 6 outcomes instead of 3
 * (see record_monitor_attendance() / monitorAttendanceApi.ts).
 */
export function MonitorAttendanceScanner({
  activityType, activityId, activityName, onClose,
}: { activityType: ActivityType; activityId: string; activityName: string; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("scan");
  const [manualScholarId, setManualScholarId] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null);
  const [cameraError, setCameraError] = useState("");
  const [scannedCount, setScannedCount] = useState(0);
  const [kind, setKind] = useState<AttendanceKind>("time_in");
  const [sessionType, setSessionType] = useState<"time_in_time_out" | "voucher" | null | "loading">("loading");

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const lastAttempted = useRef<string>("");
  const pendingToken = useRef<string>("");
  const pendingTokenStreak = useRef(0);

  useEffect(() => {
    void fetchAttendanceSessionType(activityType, activityId).then(setSessionType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityType, activityId]);

  async function submit(identifier: Parameters<typeof recordMonitorAttendance>[3]) {
    setBusy(true);
    setFeedback(null);
    const effectiveKind: AttendanceKind = sessionType === "voucher" ? "voucher" : kind;
    const res = await recordMonitorAttendance(activityType, activityId, effectiveKind, identifier);
    setBusy(false);

    if (!res.ok) {
      setFeedback({ tone: "error", message: res.error });
      lastAttempted.current = "";
      return;
    }
    const { result } = res;
    if (result.outcome === "success") {
      setScannedCount(c => c + 1);
      const label = result.kind === "time_in" ? "Timed in" : result.kind === "time_out" ? "Timed out" : "Attendance recorded";
      setFeedback({ tone: "success", message: `${label} — ${result.scholarName ?? "scholar"}` });
    } else if (result.outcome === "already_scanned") {
      setFeedback({ tone: "neutral", message: `${result.scholarName ?? "This scholar"} — ${OUTCOME_MESSAGE.already_scanned}` });
    } else {
      const prefix = result.scholarName ? `${result.scholarName} — ` : "";
      setFeedback({ tone: "error", message: `${prefix}${OUTCOME_MESSAGE[result.outcome]}` });
      lastAttempted.current = "";
    }
  }

  async function submitQr(raw: string) {
    if (busy || !raw.trim() || raw === lastAttempted.current) return;
    lastAttempted.current = raw;
    const token = extractQrToken(raw);
    if (!token) {
      setFeedback({ tone: "error", message: INVALID_QR_MESSAGE });
      lastAttempted.current = "";
      return;
    }
    await submit({ qrToken: token });
  }

  async function submitManual() {
    const scholarIdNumber = manualScholarId.trim();
    if (busy || !scholarIdNumber || scholarIdNumber === lastAttempted.current) return;
    lastAttempted.current = scholarIdNumber;
    await submit({ scholarIdNumber });
  }

  useEffect(() => {
    if (mode !== "scan") { stopCamera(); return; }
    startCamera();
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  async function startCamera() {
    setCameraError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      tick();
    } catch {
      setCameraError("Couldn't access the camera. You can still enter a scholar ID manually below.");
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
          if (qr.data === pendingToken.current) pendingTokenStreak.current += 1;
          else { pendingToken.current = qr.data; pendingTokenStreak.current = 1; }
          if (pendingTokenStreak.current >= 2) submitQr(qr.data);
        } else {
          pendingToken.current = "";
          pendingTokenStreak.current = 0;
        }
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  return (
    <div className="fixed inset-0 z-[200] bg-[#062444] flex flex-col">
      <div className="flex items-center justify-between px-5 py-4 shrink-0">
        <div className="min-w-0">
          <p className="text-[#F3BC00] text-[11px] font-bold uppercase tracking-wide">Scanning Attendance</p>
          <h2 className="text-white text-[16px] font-bold truncate">{activityName}</h2>
        </div>
        <button onClick={onClose} className="text-white/70 hover:text-white shrink-0 ml-3"><X size={22} /></button>
      </div>

      <div className="flex items-center justify-center gap-2 px-5 pb-3 shrink-0">
        <div className="rounded-full bg-white/10 px-4 py-1.5 text-[13px] font-bold text-white">{scannedCount} scanned</div>
      </div>

      {sessionType === "time_in_time_out" && (
        <div className="flex gap-2 px-5 pb-3 shrink-0">
          <button onClick={() => setKind("time_in")} className={`flex-1 rounded-lg py-2 text-[12.5px] font-bold ${kind === "time_in" ? "bg-[#F3BC00] text-[#062444]" : "bg-white/10 text-white"}`}>Time In</button>
          <button onClick={() => setKind("time_out")} className={`flex-1 rounded-lg py-2 text-[12.5px] font-bold ${kind === "time_out" ? "bg-[#F3BC00] text-[#062444]" : "bg-white/10 text-white"}`}>Time Out</button>
        </div>
      )}

      {sessionType === null && (
        <p className="px-5 pb-3 text-center text-[12.5px] font-semibold text-red-300 shrink-0">Attendance hasn't been enabled for this activity yet — scans will be rejected.</p>
      )}

      <div className="flex-1 flex flex-col justify-center px-5 pb-5 min-h-0">
        <div className="flex gap-2 mb-3">
          <button onClick={() => setMode("scan")}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-[12.5px] font-bold ${mode === "scan" ? "bg-white text-[#062444]" : "bg-white/10 text-white"}`}>
            <Camera size={15} /> Scan QR
          </button>
          <button onClick={() => setMode("manual")}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-[12.5px] font-bold ${mode === "manual" ? "bg-white text-[#062444]" : "bg-white/10 text-white"}`}>
            <Keyboard size={15} /> Enter ID
          </button>
        </div>

        {mode === "scan" ? (
          <div className="relative rounded-2xl overflow-hidden bg-black aspect-square max-h-[55vh] mx-auto w-full max-w-sm">
            <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
            <canvas ref={canvasRef} className="hidden" />
            <div className="absolute inset-6 border-2 border-[#F3BC00] rounded-xl pointer-events-none" />
            {busy && <div className="absolute inset-0 bg-black/50 flex items-center justify-center"><Loader2 size={28} className="animate-spin text-white" /></div>}
            {cameraError && (
              <div className="absolute inset-0 bg-black/80 flex items-center justify-center p-6">
                <p className="text-white text-[13px] text-center">{cameraError}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-2xl p-6 max-w-sm mx-auto w-full">
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">Scholar ID</label>
            <div className="flex gap-2">
              <input value={manualScholarId} onChange={e => setManualScholarId(e.target.value)}
                placeholder="e.g. 0001" onKeyDown={e => e.key === "Enter" && submitManual()}
                className="flex-1 border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm font-mono outline-none focus:border-[#0088cc]" />
              <button onClick={submitManual} disabled={busy || !manualScholarId.trim()}
                className="bg-[#062444] text-white text-sm font-semibold rounded-lg px-4 disabled:opacity-50">
                {busy ? <Loader2 size={16} className="animate-spin" /> : "Submit"}
              </button>
            </div>
          </div>
        )}
      </div>

      <AnimatePresence>
        {feedback && <ResultOverlay feedback={feedback} onClose={() => setFeedback(null)} />}
      </AnimatePresence>
    </div>
  );
}
