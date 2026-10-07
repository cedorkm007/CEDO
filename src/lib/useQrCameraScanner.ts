import { useEffect, useRef, useState } from "react";
import { createQrFrameDecoder, type QrFrameDecoder } from "./qrFrameDecoder";

// How often to try reading a frame, and how a code gets confirmed: the same
// text seen CONFIRM_HITS times within CONFIRM_WINDOW_MS. Not "in consecutive
// frames" -- a code that's only readable on some frames (distance, glare)
// would keep resetting a consecutive-frames counter and never confirm.
const DECODE_INTERVAL_MS = 80;
const CONFIRM_HITS = 2;
const CONFIRM_WINDOW_MS = 1500;
const HINT_AFTER_MS = 7000;

/**
 * Opens the phone camera, reads QR codes from it, and reports each one that
 * has been confirmed. Shared by the staff monitor scanner and the scholar
 * attendance scanner so the two can't drift apart.
 *
 * - `onCode` is called through a ref that always holds the latest function.
 *   The camera loop starts once and keeps running across many renders, so
 *   calling the handler it saw at start-up would use stale state forever
 *   (this is what made every camera scan in the monitor scanner silently do
 *   nothing: the first-render handler still believed the attendance type was
 *   "loading").
 * - `onCode` fires on every confirmed read while the code stays in view, so
 *   it must dedupe on its own (both callers already do).
 * - Asks the camera for a real resolution -- with no size requested many
 *   phones hand a web page 640x480, where a QR held at a normal distance has
 *   too few pixels per square to read: 1080p when the browser's native
 *   detector will do the reading, 720p for the pure-JS decoder (its cost
 *   climbs quickly with pixel count). Requests continuous focus too.
 * - `showHint` turns true after a quiet spell with no QR detected.
 */
export function useQrCameraScanner({ active, onCode, onUnavailable }: {
  active: boolean;
  onCode: (raw: string) => void | Promise<void>;
  onUnavailable: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const pendingHit = useRef<{ data: string; hits: number; lastAt: number } | null>(null);
  const lastAnyHitAt = useRef(0);
  const [showHint, setShowHint] = useState(false);

  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;

  useEffect(() => {
    if (!active) { setShowHint(false); return; }
    let cancelled = false;
    lastAnyHitAt.current = Date.now();
    pendingHit.current = null;

    function stop() {
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }

    async function openStream(engine: QrFrameDecoder["engine"]): Promise<MediaStream> {
      const [width, height] = engine === "native" ? [1920, 1080] : [1280, 720];
      try {
        return await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: width }, height: { ideal: height } },
        });
      } catch (error) {
        const name = (error as { name?: string })?.name;
        if (name === "NotAllowedError" || name === "SecurityError" || name === "NotFoundError") throw error;
        return navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      }
    }

    function registerHit(data: string) {
      const now = Date.now();
      lastAnyHitAt.current = now;
      const pending = pendingHit.current;
      if (pending && pending.data === data && now - pending.lastAt <= CONFIRM_WINDOW_MS) {
        pending.hits += 1;
        pending.lastAt = now;
      } else {
        pendingHit.current = { data, hits: 1, lastAt: now };
      }
      if ((pendingHit.current?.hits ?? 0) >= CONFIRM_HITS) void onCodeRef.current(data);
    }

    function runLoop(decoder: QrFrameDecoder) {
      let decoding = false;
      let lastRunAt = 0;
      const step = (now: number) => {
        if (cancelled) return;
        rafRef.current = requestAnimationFrame(step);
        const video = videoRef.current;
        if (decoding || !video || video.readyState < video.HAVE_ENOUGH_DATA || now - lastRunAt < DECODE_INTERVAL_MS) return;
        decoding = true;
        lastRunAt = now;
        void decoder.decode(video)
          .then(data => { if (data && !cancelled) registerHit(data); })
          .finally(() => { decoding = false; });
      };
      rafRef.current = requestAnimationFrame(step);
    }

    (async () => {
      try {
        const decoder = await createQrFrameDecoder();
        if (cancelled) return;
        const stream = await openStream(decoder.engine);
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        // Keep refocusing as the phone moves; silently ignored where unsupported.
        void stream.getVideoTracks()[0]?.applyConstraints({ advanced: [{ focusMode: "continuous" } as unknown as MediaTrackConstraintSet] }).catch(() => {});
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
        if (cancelled) return;
        runLoop(decoder);
      } catch {
        if (!cancelled) onUnavailableRef.current();
      }
    })();

    // "Nothing detected for a while" nudge -- the usual reasons (too far
    // away, screen too dim, hand moving) are all fixable once you know.
    const hintTimer = window.setInterval(() => setShowHint(Date.now() - lastAnyHitAt.current > HINT_AFTER_MS), 1000);

    return () => {
      cancelled = true;
      window.clearInterval(hintTimer);
      stop();
      setShowHint(false);
    };
  }, [active]);

  return { videoRef, showHint };
}
