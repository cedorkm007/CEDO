import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Loader2, MapPin, RefreshCcw, X, AlertTriangle } from "lucide-react";
import {
  LOCATION_MAX_AGE_MS, PICTURE_QUALITIES, PICTURE_TARGET_BYTES, cameraProblemText, cameraUnavailableText, distanceMeters, drawWatermark, locationProblemText,
  pictureSize, reverseGeocode, watermarkLines,
} from "@/lib/progressPicture";
import { submitProgressPicture, type SDPActivity } from "../../sdpApi";

interface Fix { lat: number; lng: number; accuracy: number | null; at: number }

/** A JPEG of the canvas that is small enough to upload quickly: the quality goes down a step at a time until it is under the target. */
async function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  let last: Blob | null = null;
  for (const q of PICTURE_QUALITIES) {
    const blob: Blob | null = await new Promise(res => canvas.toBlob(res, "image/jpeg", q));
    if (!blob) continue;
    last = blob;
    if (blob.size <= PICTURE_TARGET_BYTES) return blob;
  }
  return last;
}

/**
 * "Capture a Picture" for an activity that confirms attendance with a picture. The camera opens (the scholar has to allow it) and so does the location. While the camera is open
 * the place, the date and the time are shown over the picture, and when the scholar presses the button they are printed on the picture itself, the picture is made small
 * (compressed) and sent at once. A new picture replaces the one that was waiting. The checks the database makes (dates, location, scholar) are in sdp_progress_submit().
 */
export function ProgressCameraModal({ activity, scholarIdNumber, onClose, onSent }: { activity: SDPActivity; scholarIdNumber: string; onClose: () => void; onSent: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const watchRef = useRef<number | null>(null);
  const geoFor = useRef<{ lat: number; lng: number } | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [fix, setFix] = useState<Fix | null>(null);
  const [locationError, setLocationError] = useState("");
  const [place, setPlace] = useState("");
  const [now, setNow] = useState(() => new Date());
  const [stage, setStage] = useState<"live" | "sending" | "sent" | "failed">("live");
  const [error, setError] = useState("");
  const [shot, setShot] = useState<string | null>(null);

  const unavailable = cameraUnavailableText({
    hasMediaDevices: typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia,
    hasGeolocation: typeof navigator !== "undefined" && !!navigator.geolocation,
    secure: typeof window === "undefined" ? true : window.isSecureContext !== false,
  });

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setCameraReady(false);
  }, []);

  const startCamera = useCallback(async (mode: "environment" | "user") => {
    stopCamera(); setCameraError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: mode }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) { v.srcObject = stream; await v.play().catch(() => undefined); }
      setCameraReady(true);
    } catch (e) { setCameraError(cameraProblemText(e)); }
  }, [stopCamera]);

  // the camera
  useEffect(() => { if (!unavailable) void startCamera(facing); return () => stopCamera(); }, [facing, unavailable]);        // eslint-disable-line react-hooks/exhaustive-deps

  // the location: kept up to date while the window is open
  useEffect(() => {
    if (unavailable) return;
    watchRef.current = navigator.geolocation.watchPosition(
      p => { setLocationError(""); setFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null, at: Date.now() }); },
      e => setLocationError(locationProblemText(e.code)),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );
    return () => { if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current); };
  }, [unavailable]);

  // the place name: found when the position is first known and again after the scholar has moved a good way
  useEffect(() => {
    if (!fix) return;
    if (geoFor.current && distanceMeters(geoFor.current, fix) < 150 && place) return;
    geoFor.current = { lat: fix.lat, lng: fix.lng };
    let cancelled = false;
    void reverseGeocode(fix.lat, fix.lng).then(p => { if (!cancelled && p) setPlace(p); });
    return () => { cancelled = true; };
  }, [fix?.lat, fix?.lng]);       // eslint-disable-line react-hooks/exhaustive-deps

  // the clock printed on the picture
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  // after "take the picture again" the video element is new: connect the camera that is still running
  useEffect(() => {
    const v = videoRef.current;
    if (stage === "live" && v && streamRef.current && v.srcObject !== streamRef.current) { v.srcObject = streamRef.current; void v.play().catch(() => undefined); }
  });

  const fixFresh = !!fix && now.getTime() - fix.at <= LOCATION_MAX_AGE_MS;
  const lines = fix ? watermarkLines({ place, lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, when: now, scholarId: scholarIdNumber, activityName: activity.name }) : [];
  const canCapture = stage === "live" && cameraReady && fixFresh;

  async function capture() {
    const v = videoRef.current;
    if (!v || !fix || !canCapture) return;
    const when = new Date();
    const { width, height } = pictureSize(v.videoWidth || 1280, v.videoHeight || 720);
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) { setError("This browser cannot prepare the picture."); return; }
    ctx.drawImage(v, 0, 0, width, height);
    drawWatermark(ctx, width, height, watermarkLines({ place, lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, when, scholarId: scholarIdNumber, activityName: activity.name }));
    const blob = await canvasToJpeg(canvas);
    if (!blob) { setError("The picture could not be prepared. Please try again."); return; }
    setShot(URL.createObjectURL(blob));
    setStage("sending"); setError("");
    const r = await submitProgressPicture({ activityId: activity.id, scholarIdNumber, blob, capturedAt: when, lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, place });
    if (r.ok) { stopCamera(); setStage("sent"); onSent(); }
    else { setError(r.error); setStage("failed"); }
  }

  function retake() { if (shot) URL.revokeObjectURL(shot); setShot(null); setError(""); setStage("live"); if (!streamRef.current) void startCamera(facing); }
  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot); }, [shot]);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-2 sm:p-4" role="dialog" aria-modal="true" aria-label="Capture a picture" onClick={e => { if (e.target === e.currentTarget && stage !== "sending") onClose(); }}>
      <div className="flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 bg-[#062444] px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wide text-[#F3BC00]">Capture a Picture</p>
            <h3 className="line-clamp-2 text-[15px] font-bold leading-tight text-white">{activity.name}</h3>
          </div>
          <button onClick={onClose} disabled={stage === "sending"} aria-label="Close" className="shrink-0 p-1 text-white/70 hover:text-white disabled:opacity-40"><X className="h-5 w-5" /></button>
        </div>

        <div className="overflow-y-auto p-4">
          {unavailable ? (
            <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[14px] text-red-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{unavailable}</p>
          ) : stage === "sent" ? (
            <div className="text-center">
              {shot && <img src={shot} alt="The picture you sent" className="mx-auto mb-3 max-h-72 w-full rounded-lg object-contain" />}
              <CheckCircle2 className="mx-auto mb-1 h-9 w-9 text-green-600" />
              <p role="status" className="text-[15px] font-bold text-[#062444]">Your picture was sent.</p>
              <p className="mt-1 text-[14px] text-slate-700">Please wait for the evaluator to approve it. You will see the result on this activity. You can take another picture while you wait: it replaces this one.</p>
              <button onClick={onClose} className="mt-4 rounded-lg bg-[#062444] px-5 py-2.5 text-[14px] font-bold text-white">Done</button>
            </div>
          ) : (
            <>
              <div className="relative overflow-hidden rounded-xl bg-black">
                {stage === "live" || !shot ? (
                  <video ref={videoRef} autoPlay playsInline muted className="block max-h-[55vh] min-h-[200px] w-full object-contain" />
                ) : (
                  <img src={shot} alt="Your picture" className="block max-h-[55vh] w-full object-contain" />
                )}
                {stage === "live" && lines.length > 0 && (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/60 px-3 py-2 text-white" aria-label="What will be printed on the picture">
                    {lines.map((t, i) => <p key={i} className={`${i === 0 ? "text-[13.5px] font-bold" : "text-[12.5px] font-semibold"} leading-snug`}>{t}</p>)}
                  </div>
                )}
                {stage === "sending" && <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Sending…</div>}
              </div>

              <ul className="mt-3 space-y-1.5 text-[13.5px]">
                <li className={`flex items-start gap-2 ${cameraReady ? "text-green-700" : cameraError ? "text-red-700" : "text-slate-700"}`}>
                  <Camera className="mt-0.5 h-4 w-4 shrink-0" /> {cameraReady ? "Camera is ready." : cameraError || "Opening the camera… allow it when your browser asks."}
                </li>
                <li className={`flex items-start gap-2 ${fixFresh ? "text-green-700" : locationError ? "text-red-700" : "text-slate-700"}`}>
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0" /> {fixFresh ? `Location found${fix?.accuracy != null ? ` (±${Math.round(fix.accuracy)} m)` : ""}.` : locationError || "Finding your location… allow it when your browser asks."}
                </li>
              </ul>

              {error && <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[14px] text-red-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                {stage === "failed" ? (
                  <button onClick={retake} className="rounded-lg bg-[#062444] px-5 py-3 text-[14px] font-bold text-white">Take the picture again</button>
                ) : (
                  <>
                    <button onClick={() => setFacing(f => (f === "environment" ? "user" : "environment"))} disabled={stage !== "live"} aria-label="Switch camera"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#062444]/25 px-3 py-2.5 text-[13.5px] font-semibold text-[#062444] disabled:opacity-50"><RefreshCcw className="h-4 w-4" /> Switch camera</button>
                    <button onClick={() => void capture()} disabled={!canCapture}
                      className="inline-flex items-center gap-2 rounded-lg bg-[#F3BC00] px-6 py-3 text-[15px] font-extrabold text-[#062444] disabled:opacity-50"><Camera className="h-5 w-5" /> Capture</button>
                  </>
                )}
              </div>
              <p className="mt-3 text-[12.5px] text-slate-600">The place, the date and the time are printed on the picture and it is sent at once. Only a picture taken now, here, is accepted.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
