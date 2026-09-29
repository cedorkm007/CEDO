import { useEffect, useRef } from "react";
import QRCode from "qrcode";
import { X } from "lucide-react";
import CEDOSeal from "@/imports/CEDO_Seal.png";

/** The public, no-login page a scan of this QR resolves to (see ScholarSiteApp.tsx's "scholar-id" view / get_public_scholar_emergency_info()). */
function scholarIdUrl(token: string): string {
  return `${window.location.origin}/CEDO/id?token=${token}`;
}

/**
 * Renders the QR onto a canvas (rather than the api.qrserver.com image
 * service used elsewhere in this app, e.g. SDPMonitoringTab.tsx's
 * attendance codes) specifically so a logo can be drawn on top afterward
 * — errorCorrectionLevel "H" (30% redundancy, the QR spec's highest tier)
 * keeps the code reliably scannable with a logo covering its center.
 * Reuses CEDO_Seal.png (the same "official CEDO image" already used
 * app-wide as activityCardKit.tsx's DefaultPubmat) inside a white-backed,
 * gold-ringed circle — the same avatar treatment ProfileBanner.tsx
 * already uses for "City Scholar" branding.
 */
async function drawQrWithLogo(canvas: HTMLCanvasElement, token: string, size: number) {
  await QRCode.toCanvas(canvas, scholarIdUrl(token), {
    errorCorrectionLevel: "H", width: size, margin: 1,
    color: { dark: "#062444", light: "#ffffff" },
  });
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const cx = size / 2;
  const cy = size / 2;
  const logoSize = size * 0.26;
  const ringRadius = logoSize / 2 + 5;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, ringRadius + 3, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
  ctx.strokeStyle = "#F3BC00";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();

  const logo = new Image();
  await new Promise<void>((resolve) => {
    logo.onload = () => resolve();
    logo.onerror = () => resolve(); // no logo is better than a broken QR render
    logo.src = CEDOSeal;
  });
  if (logo.complete && logo.naturalWidth > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, logoSize / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(logo, cx - logoSize / 2, cy - logoSize / 2, logoSize, logoSize);
    ctx.restore();
  }
}

export function ScholarIdQrCanvas({ token, size = 160, className }: { token: string; size?: number; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current && token) void drawQrWithLogo(canvasRef.current, token, size);
  }, [token, size]);

  return <canvas ref={canvasRef} width={size} height={size} className={className} />;
}

/** Full-screen expand — tapped open from a small QR thumbnail (e.g. the scholar's ID-card banner), closes via the X button or a tap anywhere on the backdrop. */
export function FullscreenScholarQr({ token, onClose }: { token: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[300] bg-[#062444] flex flex-col items-center justify-center p-6" onClick={onClose}>
      <button onClick={onClose} aria-label="Close" className="absolute top-5 right-5 text-white/70 hover:text-white">
        <X size={28} />
      </button>
      <div className="bg-white rounded-2xl p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <ScholarIdQrCanvas token={token} size={280} />
      </div>
      <p className="mt-6 text-white/60 text-[13px]">Tap anywhere to close</p>
    </div>
  );
}
