import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { X } from "lucide-react";

/** The public, no-login page a scan of this QR resolves to (see ScholarSiteApp.tsx's "scholar-id" view / get_public_scholar_emergency_info()). */
function scholarIdUrl(token: string): string {
  return `${window.location.origin}/CEDO/id?token=${token}`;
}

/**
 * Renders the QR onto a canvas (rather than the api.qrserver.com image
 * service used elsewhere in this app, e.g. SDPMonitoringTab.tsx's
 * attendance codes) specifically so a badge can be drawn on top afterward.
 * The badge is drawn entirely in code (navy disc + gold ring, matching the
 * "City Scholar" avatar styling already used in ProfileBanner.tsx), with
 * "CITY SCHOLAR" as its own two-line wordmark when it's big enough to read.
 *
 * Tuned for being SCANNED, not just displayed -- an activity monitor reads
 * this off a phone screen through a phone camera:
 *  - errorCorrectionLevel "M" (not "H") and a smaller badge: "H" bumped the
 *    code to 49x49 squares versus 37x37 for "M"; fewer, bigger squares are
 *    far easier for a camera to resolve at a normal holding distance. The
 *    badge covers ~6-9% of the code, well inside what "M" (15%) can repair.
 *  - the bitmap is drawn at the screen's real pixel density, so the edges
 *    stay sharp on phones (a CSS-sized canvas gets blurred when upscaled
 *    2-3x, which softens every square's edge).
 */
const BADGE_RADIUS_RATIO = 0.11;   // badge radius as a fraction of the code's width
const WORDMARK_MIN_RADIUS_PX = 18; // below this the wordmark is unreadable clutter -- draw a plain badge

async function drawQrWithLogo(canvas: HTMLCanvasElement, token: string, size: number) {
  const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 3);
  await QRCode.toCanvas(canvas, scholarIdUrl(token), {
    errorCorrectionLevel: "M", width: Math.round(size * dpr), margin: 1,
    color: { dark: "#062444", light: "#ffffff" },
  });
  // QRCode.toCanvas sizes the element to the bitmap's pixel size; pin the
  // on-screen size back to the CSS size we were asked for (content-box so a
  // caller's padding adds to it, as it did when the canvas had no CSS size).
  canvas.style.boxSizing = "content-box";
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // QRCode.toCanvas can snap the actual rendered size to whatever evenly
  // fits its module grid, which isn't always exactly the requested
  // `width` option -- read the canvas's own post-render dimensions rather
  // than trusting `size`, or the badge ends up off-center. Every badge
  // measurement below is a fraction of that width, so it scales with density.
  const w = Math.min(canvas.width, canvas.height);
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const logoRadius = w * BADGE_RADIUS_RATIO;
  const ringRadius = logoRadius + w * 0.025;

  ctx.save();
  // White backing, so the gold ring/navy disc read cleanly against the QR's own modules.
  ctx.beginPath();
  ctx.arc(cx, cy, ringRadius + w * 0.015, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  // Gold ring.
  ctx.beginPath();
  ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
  ctx.strokeStyle = "#F3BC00";
  ctx.lineWidth = w * 0.015;
  ctx.stroke();
  // Navy disc.
  ctx.beginPath();
  ctx.arc(cx, cy, logoRadius, 0, Math.PI * 2);
  ctx.fillStyle = "#062444";
  ctx.fill();

  // "CITY SCHOLAR" wordmark, stacked to fit the circle's own chord width at each line.
  if (logoRadius / dpr >= WORDMARK_MIN_RADIUS_PX) {
    ctx.fillStyle = "#F3BC00";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${Math.round(logoRadius * 0.42)}px Arial, sans-serif`;
    ctx.fillText("CITY", cx, cy - logoRadius * 0.32);
    ctx.font = `700 ${Math.round(logoRadius * 0.34)}px Arial, sans-serif`;
    ctx.fillText("SCHOLAR", cx, cy + logoRadius * 0.32);
  }
  ctx.restore();
}

export function ScholarIdQrCanvas({ token, size = 160, className }: { token: string; size?: number; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current && token) void drawQrWithLogo(canvasRef.current, token, size);
  }, [token, size]);

  return <canvas ref={canvasRef} width={size} height={size} className={className} />;
}

/** As large as fits on this screen (room left for the card padding and the close hint), within sensible bounds. */
function fullscreenQrSize(): number {
  const room = Math.min(window.innerWidth - 88, window.innerHeight - 220);
  return Math.max(240, Math.min(440, Math.floor(room)));
}

/**
 * Full-screen expand -- tapped open from a small QR thumbnail (e.g. the
 * scholar's ID-card banner), closes via the X button or a tap anywhere on
 * the backdrop. Stops propagation on every close trigger, not just the
 * inner card -- some callers (the mobile profile popup) render this
 * nested inside their own "click backdrop to close" wrapper, and without
 * this a tap here would also close that ancestor popup.
 *
 * The code is sized to the screen rather than a fixed 280px: this is the
 * version shown to be scanned, and every extra pixel is more for the
 * scanner's camera to work with.
 */
export function FullscreenScholarQr({ token, onClose }: { token: string; onClose: () => void }) {
  const [size, setSize] = useState(fullscreenQrSize);
  useEffect(() => {
    const onResize = () => setSize(fullscreenQrSize());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  function closeAndStop(e: React.MouseEvent) {
    e.stopPropagation();
    onClose();
  }
  return (
    <div className="fixed inset-0 z-[300] bg-[#062444] flex flex-col items-center justify-center p-6" onClick={closeAndStop}>
      <button onClick={closeAndStop} aria-label="Close" className="absolute top-5 right-5 text-white/70 hover:text-white">
        <X size={28} />
      </button>
      <div className="bg-white rounded-2xl p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <ScholarIdQrCanvas token={token} size={size} />
      </div>
      <p className="mt-6 text-white/60 text-[13px]">Tap anywhere to close</p>
    </div>
  );
}
