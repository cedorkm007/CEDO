import jsQR from "jsqr";

/**
 * Reads a QR code out of a live <video> frame.
 *
 * Prefers the browser's native BarcodeDetector (Chrome/Edge on Android and
 * recent desktops): it's hardware-assisted, reads dense/blurry/tilted codes
 * far more reliably than a pure-JS decoder, and works straight off the video
 * element with no per-frame pixel copy. Everything else (notably iPhones'
 * Safari) falls back to jsQR on a reduced copy of the frame.
 */
export interface QrFrameDecoder {
  readonly engine: "native" | "jsqr";
  /** The decoded text, or null if no QR was found in this frame. Never throws. */
  decode(video: HTMLVideoElement): Promise<string | null>;
}

interface BarcodeDetectorLike { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>; }
interface BarcodeDetectorCtor {
  new (options: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

// jsQR's cost grows with pixel count, so a 1080p frame is capped to this width.
// Not lower: shrinking a 1280-wide frame to 960 dropped reads of a farther-away
// code from ~90% to ~60% in testing, so callers using jsQR should ask the
// camera for 1280x720 and let it through at full size.
const JSQR_MAX_WIDTH = 1280;

function createJsQrDecoder(): QrFrameDecoder {
  // One reusable canvas: resizing it every frame (as the old loop did)
  // reallocates the whole bitmap each time.
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return {
    engine: "jsqr",
    async decode(video) {
      if (!ctx || !video.videoWidth || !video.videoHeight) return null;
      const scale = Math.min(1, JSQR_MAX_WIDTH / video.videoWidth);
      const w = Math.round(video.videoWidth * scale);
      const h = Math.round(video.videoHeight * scale);
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);
      const frame = ctx.getImageData(0, 0, w, h);
      // Scholar QRs are always dark-on-white, so skip the inverted pass --
      // on a frame with no code in it, it doubles the work for nothing.
      const result = jsQR(frame.data, w, h, { inversionAttempts: "dontInvert" });
      return result?.data || null;
    },
  };
}

export async function createQrFrameDecoder(): Promise<QrFrameDecoder> {
  const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (Detector) {
    try {
      const formats = await Detector.getSupportedFormats?.();
      if (!formats || formats.includes("qr_code")) {
        const detector = new Detector({ formats: ["qr_code"] });
        return {
          engine: "native",
          async decode(video) {
            try {
              const codes = await detector.detect(video);
              return codes[0]?.rawValue || null;
            } catch {
              return null;
            }
          },
        };
      }
    } catch {
      // Constructor/format lookup failed on this browser -- use jsQR instead.
    }
  }
  return createJsQrDecoder();
}
