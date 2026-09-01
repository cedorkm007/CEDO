import type { FFmpeg } from "@ffmpeg/ffmpeg";

/**
 * Client-side video compression for the Kauban admin video uploader.
 * Runs entirely in the browser via ffmpeg.wasm — Kauban has no backend
 * server by design (see docs/kauban/PROGRESS.md), and a Vercel
 * serverless function is a poor fit for video encoding anyway (per-call
 * time limits, cold starts). The ffmpeg-core files are self-hosted under
 * /kauban-admin/ffmpeg-core/ (see public/kauban-admin/README.md) instead
 * of pulled from a CDN, so this doesn't depend on a third party being up.
 *
 * ffmpeg.wasm only runs one job at a time per instance, so callers should
 * compress a batch sequentially, not in parallel.
 */

const CORE_BASE_URL = "/kauban-admin/ffmpeg-core";

let ffmpegPromise: Promise<FFmpeg> | null = null;

async function loadFFmpeg(): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
        import("@ffmpeg/ffmpeg"),
        import("@ffmpeg/util"),
      ]);
      const ffmpeg = new FFmpeg();
      await ffmpeg.load({
        coreURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.wasm`, "application/wasm"),
      });
      return ffmpeg;
    })().catch(err => {
      ffmpegPromise = null; // let a later call retry instead of caching the failure forever
      throw err;
    });
  }
  return ffmpegPromise;
}

export interface CompressVideoOptions {
  /** Long-edge cap in pixels; source is only ever scaled down, never up. Default 720. */
  maxDimension?: number;
  /** libx264 CRF — lower is higher quality/larger file. Default 28. */
  crf?: number;
  onProgress?: (ratio: number) => void; // 0..1
}

export interface CompressVideoResult {
  blob: Blob;
  originalSize: number;
  compressedSize: number;
}

export async function compressVideo(input: File, options: CompressVideoOptions = {}): Promise<CompressVideoResult> {
  const { maxDimension = 720, crf = 28, onProgress } = options;
  const ffmpeg = await loadFFmpeg();
  const { fetchFile } = await import("@ffmpeg/util");

  const inputExt = input.name.includes(".") ? input.name.slice(input.name.lastIndexOf(".")) : ".mp4";
  const inputName = `input${inputExt}`;
  const outputName = "output.mp4";

  const onProgressEvent = ({ progress }: { progress: number }) => onProgress?.(Math.min(1, Math.max(0, progress)));
  if (onProgress) ffmpeg.on("progress", onProgressEvent);

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(input));

    // -an: these clips always play muted in the app anyway (autoplay-policy
    // workaround in the original Laravel app), so audio is dead weight.
    // scale ... force_original_aspect_ratio=decrease: caps the longer edge
    // at maxDimension without upscaling anything already smaller. The
    // second scale rounds both dimensions down to even numbers, which
    // libx264 requires.
    await ffmpeg.exec([
      "-i", inputName,
      "-an",
      "-vf", `scale=w='min(${maxDimension},iw)':h='min(${maxDimension},ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", String(crf),
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      outputName,
    ]);

    const data = await ffmpeg.readFile(outputName);
    const bytes = data as Uint8Array;
    const blob = new Blob([new Uint8Array(bytes)], { type: "video/mp4" });

    return { blob, originalSize: input.size, compressedSize: blob.size };
  } finally {
    if (onProgress) ffmpeg.off("progress", onProgressEvent);
    await Promise.all([
      ffmpeg.deleteFile(inputName).catch(() => {}),
      ffmpeg.deleteFile(outputName).catch(() => {}),
    ]);
  }
}
