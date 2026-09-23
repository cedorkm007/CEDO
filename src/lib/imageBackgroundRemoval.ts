/**
 * Best-effort transparent-background conversion and auto-crop for a
 * signature photo/scan on a plain light background — this codebase has no
 * ML segmentation or remove.bg-style integration, so this uses a standard
 * client-side trick: flood-fill from the image's edges inward, marking
 * every pixel within COLOR_TOLERANCE of the sampled background color as
 * transparent, then cropping to the bounding box of whatever pixels
 * survived (the signature itself), so a phone photo with wide paper
 * margins around a small signature doesn't get embedded tiny. Works well
 * for a signature on plain white/light paper (the realistic case here); it
 * is not a true subject-segmentation model, so a signature photographed on
 * a patterned or dark background won't come out clean.
 */
const COLOR_TOLERANCE = 40;
/** Left around the detected signature so strokes right at the edge aren't clipped. */
const CROP_PADDING_PX = 12;

function colorDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

export async function removeWhiteBackground(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable.");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;

  // Sample the background color from the 4 corners (averaged) — more
  // robust than a single pixel against scan noise/compression artifacts.
  const corners = [0, (width - 1) * 4, (height - 1) * width * 4, ((height - 1) * width + width - 1) * 4];
  let bgR = 0, bgG = 0, bgB = 0;
  for (const idx of corners) { bgR += data[idx]; bgG += data[idx + 1]; bgB += data[idx + 2]; }
  bgR /= corners.length; bgG /= corners.length; bgB /= corners.length;

  // Flood-fill from every edge pixel inward (BFS), so background that
  // wraps around an irregularly-shaped signature is still fully caught,
  // not just a uniform border.
  const visited = new Uint8Array(width * height);
  const queue: number[] = [];
  function maybeEnqueue(x: number, y: number) {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const pixelIndex = y * width + x;
    if (visited[pixelIndex]) return;
    const idx = pixelIndex * 4;
    if (colorDistance(data[idx], data[idx + 1], data[idx + 2], bgR, bgG, bgB) > COLOR_TOLERANCE) return;
    visited[pixelIndex] = 1;
    queue.push(pixelIndex);
  }
  for (let x = 0; x < width; x++) { maybeEnqueue(x, 0); maybeEnqueue(x, height - 1); }
  for (let y = 0; y < height; y++) { maybeEnqueue(0, y); maybeEnqueue(width - 1, y); }

  while (queue.length > 0) {
    const pixelIndex = queue.pop()!;
    const idx = pixelIndex * 4;
    data[idx + 3] = 0; // fully transparent
    const x = pixelIndex % width, y = Math.floor(pixelIndex / width);
    maybeEnqueue(x + 1, y); maybeEnqueue(x - 1, y); maybeEnqueue(x, y + 1); maybeEnqueue(x, y - 1);
  }

  ctx.putImageData(imageData, 0, 0);

  // Locate the signature: the bounding box of every pixel that survived
  // background removal (alpha > 0), then crop to it plus a small margin.
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) throw new Error("No signature detected in that image.");

  const cropX = Math.max(0, minX - CROP_PADDING_PX);
  const cropY = Math.max(0, minY - CROP_PADDING_PX);
  const cropWidth = Math.min(width, maxX + CROP_PADDING_PX) - cropX;
  const cropHeight = Math.min(height, maxY + CROP_PADDING_PX) - cropY;

  const croppedCanvas = document.createElement("canvas");
  croppedCanvas.width = cropWidth;
  croppedCanvas.height = cropHeight;
  const croppedCtx = croppedCanvas.getContext("2d");
  if (!croppedCtx) throw new Error("Canvas 2D context unavailable.");
  croppedCtx.drawImage(canvas, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

  const blob = await new Promise<Blob | null>(resolve => croppedCanvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Signature processing produced no output.");
  return blob;
}
