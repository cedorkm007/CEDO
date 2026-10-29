// ─────────────────────────────────────────────────────────────
// src/lib/pictureTurn.ts
// Turning a picture on screen in quarter turns (the staff who review the grades a scholar entered turn a sideways screenshot to read it). Only the way it is SHOWN changes:
// the stored file is never touched. Plain maths (no React) so tests can run it alone.
// A picture turned a quarter turn is as wide as it was tall, so the box that holds it has to be re-measured; this works out the size and place of the picture inside that box.
// ─────────────────────────────────────────────────────────────
export type Quarter = 0 | 1 | 2 | 3;

/** One quarter turn to the right (+1) or to the left (-1), going round: 0 -> 1 -> 2 -> 3 -> 0. */
export const nextQuarter = (q: Quarter, direction: 1 | -1): Quarter => ((((q + direction) % 4) + 4) % 4) as Quarter;
export const degreesOf = (q: Quarter): number => q * 90;

export interface TurnedLayout { boxHeight: number; imageWidth: number; imageHeight: number; left: number; top: number; degrees: number }

/**
 * Where a picture of natural size natW x natH goes in a box boxW wide, after q quarter turns, so that what is SHOWN is always boxW wide (a sideways picture shown
 * lying down is as wide as the box and as tall as its original width scaled down). The picture is placed (at its own size, before turning) so that turning it about
 * its centre makes it fill the box exactly.
 */
export function turnedLayout(natW: number, natH: number, boxW: number, q: Quarter): TurnedLayout {
  const w = Math.max(1, natW), h = Math.max(1, natH), box = Math.max(0, boxW);
  if (q % 2 === 0) {
    const imageHeight = (box * h) / w;
    return { boxHeight: imageHeight, imageWidth: box, imageHeight, left: 0, top: 0, degrees: degreesOf(q) };
  }
  // a quarter turn: the picture's height becomes the width of what is shown
  const imageHeight = box, imageWidth = (box * w) / h, boxHeight = imageWidth;
  return { boxHeight, imageWidth, imageHeight, left: (box - imageWidth) / 2, top: (boxHeight - imageHeight) / 2, degrees: degreesOf(q) };
}
