import { PDFDocument } from "pdf-lib";

export interface CompressResult {
  file: File;
  originalSize: number;
  compressedSize: number;
  wasCompressed: boolean;
}

/**
 * Compresses a scholar-selected file client-side, before it's uploaded —
 * mirrors Kauban's client-side video compression architecturally (compress
 * before the network request, never block/fail the upload if compression
 * itself fails), though the actual technique is unrelated (ffmpeg.wasm is
 * video-only). Only JPEG and PDF are compressed; everything else (Word,
 * Excel/CSV, PNG) passes through untouched.
 */
export async function compressSubmissionFile(file: File): Promise<CompressResult> {
  const isJpeg = file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name);
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);

  if (!isJpeg && !isPdf) {
    return { file, originalSize: file.size, compressedSize: file.size, wasCompressed: false };
  }

  try {
    const compressed = isJpeg ? await compressJpeg(file) : await compressPdf(file);
    // A "compressed" result that's somehow larger than the original (rare,
    // e.g. an already heavily-optimized small file) isn't worth uploading
    // instead of the original.
    if (compressed.size >= file.size) {
      return { file, originalSize: file.size, compressedSize: file.size, wasCompressed: false };
    }
    return { file: compressed, originalSize: file.size, compressedSize: compressed.size, wasCompressed: true };
  } catch {
    // Never let a compression failure block or degrade an upload — fall
    // back to the original file untouched.
    return { file, originalSize: file.size, compressedSize: file.size, wasCompressed: false };
  }
}

// Long-edge cap for a compressed JPEG. Document scans/contracts need small
// print to stay legible when staff zoom in during review, so this is much
// higher than Kauban's video-tuned 720p (that's sized for on-screen video
// playback, not document text) — only ever scales down, never up.
const MAX_JPEG_DIMENSION = 2000;
// 0.8 is where most of a JPEG's size reduction has already happened on the
// standard quality/size curve, while staying above the ~0.7 threshold where
// visible ringing/blockiness starts to hurt small printed text.
const JPEG_QUALITY = 0.8;

async function compressJpeg(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const longEdge = Math.max(bitmap.width, bitmap.height);
  const scale = Math.min(1, MAX_JPEG_DIMENSION / longEdge);
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  if (!blob) throw new Error("JPEG compression produced no output.");
  return new File([blob], file.name, { type: "image/jpeg" });
}

async function compressPdf(file: File): Promise<File> {
  const bytes = await file.arrayBuffer();
  // ignoreEncryption: some scholar-uploaded PDFs (scanned from other tools)
  // carry owner-password restrictions pdf-lib would otherwise refuse to load.
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const outBytes = await pdfDoc.save({ useObjectStreams: true });
  // pdf-lib's Uint8Array is typed against ArrayBufferLike (which admits
  // SharedArrayBuffer), while File/Blob require a plain ArrayBuffer —
  // constructing from it as ArrayLike<number> copies into a fresh
  // ArrayBuffer-backed array, satisfying BlobPart.
  return new File([new Uint8Array(outBytes)], file.name, { type: "application/pdf" });
}
