/**
 * Turns a signature photo / scan on a plain light background into a clean PNG with a TRANSPARENT background, cropped to the signature.
 *
 * How (no ML, runs in the browser): the background colour is read from the border of the picture; every pixel gets an opacity from how far its colour is from the background
 * (close = see-through, far = solid, in between = soft), and the ink is drawn in the signature's own ink colour. Because the opacity comes from the colour of EACH pixel (not from a flood
 * fill from the edges), the white INSIDE the loops of a signature (the big loops of a flourish, the inside of an "o") becomes transparent too, and the edges are smooth with no white halo,
 * so the signature sits cleanly over a line, a printed name or a coloured form. Works for a signature on plain white / light paper; a photo on a patterned or dark background will not come out clean.
 * The pixel work is a pure function (no browser needed) so it can be tested.
 */

/** A pixel this close to the background colour (colour distance) is fully transparent; this far or more it is fully solid; in between it is soft. */
export const SOFT_LOW = 45;
export const SOFT_HIGH = 150;
/** Left around the detected signature so strokes right at the edge aren't clipped. */
export const CROP_PADDING_PX = 12;
/** A signature picture bigger than this (longest side) is made smaller first: plenty for a signature, and fast on a phone. */
export const MAX_SIDE_PX = 1600;

const dist = (r1: number, g1: number, b1: number, r2: number, g2: number, b2: number) => Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);

export interface SignaturePixels { data: Uint8ClampedArray; width: number; height: number; box: { x: number; y: number; w: number; h: number } }

/** The background colour: the middle value of every pixel on the picture's border (robust against a shadow in one corner and against a signature that touches an edge). */
export function backgroundColor(data: Uint8ClampedArray, width: number, height: number): [number, number, number] {
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  const take = (x: number, y: number) => { const i = (y * width + x) * 4; rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]); };
  for (let x = 0; x < width; x++) { take(x, 0); take(x, height - 1); }
  for (let y = 1; y < height - 1; y++) { take(0, y); take(width - 1, y); }
  const mid = (a: number[]) => { a.sort((p, q) => p - q); return a[Math.floor(a.length / 2)]; };
  return [mid(rs), mid(gs), mid(bs)];
}

/** Makes the background transparent and the ink solid, then finds the crop. Returns null when nothing is left (no signature found). Changes `data` in place. */
export function makeSignaturePixels(data: Uint8ClampedArray, width: number, height: number): SignaturePixels | null {
  const [bgR, bgG, bgB] = backgroundColor(data, width, height);
  const n = width * height;
  const d = new Float32Array(n);
  let sumR = 0, sumG = 0, sumB = 0, inkN = 0, darkest = 0, darkI = 0;
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const v = dist(data[i], data[i + 1], data[i + 2], bgR, bgG, bgB);
    d[p] = v;
    if (v > darkest) { darkest = v; darkI = i; }
  }
  if (darkest < SOFT_LOW) return null;
  // the ink colour: the average of the pixels that are clearly ink (at least 70% as far from the background as the farthest pixel)
  const inkMin = darkest * 0.7;
  for (let p = 0; p < n; p++) if (d[p] >= inkMin) { const i = p * 4; sumR += data[i]; sumG += data[i + 1]; sumB += data[i + 2]; inkN++; }
  const inkR = inkN ? Math.round(sumR / inkN) : data[darkI], inkG = inkN ? Math.round(sumG / inkN) : data[darkI + 1], inkB = inkN ? Math.round(sumB / inkN) : data[darkI + 2];
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let p = 0; p < n; p++) {
    const v = d[p];
    const alpha = v <= SOFT_LOW ? 0 : v >= SOFT_HIGH ? 255 : Math.round((255 * (v - SOFT_LOW)) / (SOFT_HIGH - SOFT_LOW));
    const i = p * 4;
    data[i] = inkR; data[i + 1] = inkG; data[i + 2] = inkB; data[i + 3] = alpha;
    if (alpha > 12) { const x = p % width, y = (p - x) / width; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (maxX < minX || maxY < minY) return null;
  const x0 = Math.max(0, minX - CROP_PADDING_PX), y0 = Math.max(0, minY - CROP_PADDING_PX);
  const x1 = Math.min(width, maxX + 1 + CROP_PADDING_PX), y1 = Math.min(height, maxY + 1 + CROP_PADDING_PX);
  return { data, width, height, box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
}

/** Browser only. A signature photo / scan -> a transparent PNG cropped to the signature. Throws a plain-words Error when it cannot. */
export async function removeWhiteBackground(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch { throw new Error("That file could not be opened as a picture. Use a JPG or PNG picture of the signature."); }
  const scale = Math.min(1, MAX_SIDE_PX / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser cannot process the picture (no canvas). Try another browser.");
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, width, height);      // a PNG that is already transparent is read as white paper
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const image = ctx.getImageData(0, 0, width, height);
  const out = makeSignaturePixels(image.data, width, height);
  if (!out) throw new Error("No signature was found in that picture. Use a picture with dark ink on plain white paper.");
  ctx.putImageData(image, 0, 0);
  const cropped = document.createElement("canvas");
  cropped.width = out.box.w; cropped.height = out.box.h;
  const cctx = cropped.getContext("2d");
  if (!cctx) throw new Error("This browser cannot process the picture (no canvas). Try another browser.");
  cctx.drawImage(canvas, out.box.x, out.box.y, out.box.w, out.box.h, 0, 0, out.box.w, out.box.h);
  const blob = await new Promise<Blob | null>(resolve => cropped.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The signature could not be saved as a picture. Try again.");
  return blob;
}
