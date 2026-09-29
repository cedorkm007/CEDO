import { useEffect, useRef } from "react";
import QRCode from "qrcode";
import { X } from "lucide-react";

/** The public, no-login page a scan of this QR resolves to (see ScholarSiteApp.tsx's "scholar-id" view / get_public_scholar_emergency_info()). */
function scholarIdUrl(token: string): string {
  return `${window.location.origin}/CEDO/id?token=${token}`;
}

/**
 * Renders the QR onto a canvas (rather than the api.qrserver.com image
 * service used elsewhere in this app, e.g. SDPMonitoringTab.tsx's
 * attendance codes) specifically so a logo can be drawn on top afterward
 * -- errorCorrectionLevel "H" (30% redundancy, the QR spec's highest
 * tier) keeps it reliably scannable with a logo covering its center. The
 * badge itself is drawn entirely in code (navy disc + gold ring, matching
 * the "City Scholar" avatar styling already used in ProfileBanner.tsx)
 * with "CITY SCHOLAR" as its own two-line wordmark, rather than reusing
 * CEDO_Seal.png's own baked-in "CEDO" text.
 */
async function drawQrWithLogo(canvas: HTMLCanvasElement, token: string, size: number) {
  await QRCode.toCanvas(canvas, scholarIdUrl(token), {
    errorCorrectionLevel: "H", width: size, margin: 1,
    color: { dark: "#062444", light: "#ffffff" },
  });
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // QRCode.toCanvas can snap the actual rendered size to whatever evenly
  // fits its module grid, which isn't always exactly the requested
  // `width` option -- read the canvas's own post-render dimensions rather
  // than trusting `size`, or the logo ends up off-center.
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const logoRadius = Math.min(canvas.width, canvas.height) * 0.16;
  const ringRadius = logoRadius + 5;

  ctx.save();
  // White backing, so the gold ring/navy disc read cleanly against the QR's own modules.
  ctx.beginPath();
  ctx.arc(cx, cy, ringRadius + 3, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  // Gold ring.
  ctx.beginPath();
  ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
  ctx.strokeStyle = "#F3BC00";
  ctx.lineWidth = 3;
  ctx.stroke();
  // Navy disc.
  ctx.beginPath();
  ctx.arc(cx, cy, logoRadius, 0, Math.PI * 2);
  ctx.fillStyle = "#062444";
  ctx.fill();

  // "CITY SCHOLAR" wordmark, stacked to fit the circle's own chord width at each line.
  ctx.fillStyle = "#F3BC00";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${Math.round(logoRadius * 0.42)}px Arial, sans-serif`;
  ctx.fillText("CITY", cx, cy - logoRadius * 0.32);
  ctx.font = `700 ${Math.round(logoRadius * 0.34)}px Arial, sans-serif`;
  ctx.fillText("SCHOLAR", cx, cy + logoRadius * 0.32);
  ctx.restore();
}

export function ScholarIdQrCanvas({ token, size = 160, className }: { token: string; size?: number; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current && token) void drawQrWithLogo(canvasRef.current, token, size);
  }, [token, size]);

  return <canvas ref={canvasRef} width={size} height={size} className={className} />;
}

/**
 * Full-screen expand -- tapped open from a small QR thumbnail (e.g. the
 * scholar's ID-card banner), closes via the X button or a tap anywhere on
 * the backdrop. Stops propagation on every close trigger, not just the
 * inner card -- some callers (the mobile profile popup) render this
 * nested inside their own "click backdrop to close" wrapper, and without
 * this a tap here would also close that ancestor popup.
 */
export function FullscreenScholarQr({ token, onClose }: { token: string; onClose: () => void }) {
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
        <ScholarIdQrCanvas token={token} size={280} />
      </div>
      <p className="mt-6 text-white/60 text-[13px]">Tap anywhere to close</p>
    </div>
  );
}
