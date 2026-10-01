// Shared by both word-cloud features in this app: the quests one
// (src/sead/components/WordCloudLiveView.tsx, quest_word_cloud_entries)
// and the presentations one (src/presentations/components/SlideResults.tsx,
// presentation_responses). Lives here rather than under either feature's
// own directory since neither owns it.

export interface WordCount {
  text: string;
  count: number;
}

export interface PlacedWord extends WordCount {
  /** Position and box are in the same virtual coordinate space as CANVAS_WIDTH/CANVAS_HEIGHT -- the caller converts to percentages against that space so the layout scales to any container size. */
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
}

export const CANVAS_WIDTH = 640;
export const CANVAS_HEIGHT = 340;

// The canvas measurement below and the actual rendered <span> must use this
// exact font family/weight -- any mismatch (e.g. rendering in the app's
// default sans-serif at a different weight than what was measured here)
// makes the real text wider or narrower than the box the packer computed,
// which is invisible at small sizes but becomes many pixels of visible
// overlap at the large font sizes used in fullscreen/projector mode.
export const WORD_CLOUD_FONT_WEIGHT = 700;
export const WORD_CLOUD_FONT_FAMILY = "Arial, sans-serif";

// Conjunctions carry no meaning on their own and only clutter the cloud
// with tiny, high-frequency filler bubbles -- excluded from counting.
// Covers both English and Filipino, since scholar responses mix both.
const CONJUNCTIONS = new Set([
  "and", "or", "but", "nor", "so", "yet", "for", "although", "because",
  "since", "unless", "while", "whereas", "though", "if", "than",
  "at", "o", "pero", "dahil", "kasi", "kung", "para", "kaya", "ngunit", "subalit",
]);

/**
 * Lowercases and splits a submitted entry into its individual words -- a
 * "one word" prompt still often gets a short phrase typed into it, and a
 * phrase's own words should count toward similarity with everyone else's
 * single-word answers ("excellent service" contributes to the same
 * "excellent" bubble as a separate "Excellent" submission), not sit off
 * to the side as an unmatched multi-word blob. Strips leading/trailing
 * punctuation per token so "excellent!" and "excellent" still merge, and
 * drops conjunctions so they don't count toward the cloud.
 */
export function tokenizeWordCloudEntry(entry: string): string[] {
  return entry
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map(token => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean)
    .filter(token => !CONJUNCTIONS.has(token));
}

const PAD = 8; // breathing room so adjacent words don't visually touch -- bold text's real ascent/descent runs taller than the height estimate below, so this needs to be generous, not just cosmetic

function rectsOverlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  return !(
    a.x + a.width + PAD < b.x ||
    b.x + b.width + PAD < a.x ||
    a.y + a.height + PAD < b.y ||
    b.y + b.height + PAD < a.y
  );
}

// Collision checks against every already-placed word (an O(n) scan per
// candidate point) get slow once the cloud is dense -- a ~100-word cloud
// tries tens of thousands of candidate points for the words that end up
// near the edge of what fits, each needing to check against ~90 already-
// placed words. A coarse spatial hash bucket keyed by grid cell makes each
// check O(words sharing this candidate's cells) instead of O(all placed
// words), which is what actually makes a dense cloud like this fast.
const GRID_CELL = 24;

class SpatialGrid {
  private cells = new Map<string, number[]>();
  private boxes: { x: number; y: number; width: number; height: number }[] = [];

  private keysFor(box: { x: number; y: number; width: number; height: number }): string[] {
    const x0 = Math.floor((box.x - PAD) / GRID_CELL);
    const x1 = Math.floor((box.x + box.width + PAD) / GRID_CELL);
    const y0 = Math.floor((box.y - PAD) / GRID_CELL);
    const y1 = Math.floor((box.y + box.height + PAD) / GRID_CELL);
    const keys: string[] = [];
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) keys.push(`${cx},${cy}`);
    }
    return keys;
  }

  overlapsAny(box: { x: number; y: number; width: number; height: number }): boolean {
    const seen = new Set<number>();
    for (const key of this.keysFor(box)) {
      const bucket = this.cells.get(key);
      if (!bucket) continue;
      for (const idx of bucket) {
        if (seen.has(idx)) continue;
        seen.add(idx);
        if (rectsOverlap(this.boxes[idx], box)) return true;
      }
    }
    return false;
  }

  add(box: { x: number; y: number; width: number; height: number }): void {
    const idx = this.boxes.length;
    this.boxes.push(box);
    for (const key of this.keysFor(box)) {
      const bucket = this.cells.get(key);
      if (bucket) bucket.push(idx);
      else this.cells.set(key, [idx]);
    }
  }
}

/**
 * Packs words into an actual cloud shape -- biggest (most frequent) first,
 * placed at the center, everything else spiraling outward until it finds a
 * gap, same basic idea as d3-cloud's Archimedean-spiral placement but
 * hand-rolled (no new dependency) since this only ever needs to lay out a
 * few dozen words at classroom-presentation scale. No rotation -- keeping
 * every word horizontal makes the collision boxes exact (a rotated box
 * would need real corner math, not worth it here) and easier to read on a
 * projector.
 */
export function layoutWordCloud(words: WordCount[], minFontPx: number, maxFontPx: number): PlacedWord[] {
  if (words.length === 0) return [];
  const sorted = [...words].sort((a, b) => b.count - a.count);
  const maxCount = sorted[0].count || 1;
  const minCount = sorted[sorted.length - 1].count || 1;
  const countRange = Math.max(1, maxCount - minCount);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  const placed: PlacedWord[] = [];
  const grid = new SpatialGrid();
  const centerX = CANVAS_WIDTH / 2;
  const centerY = CANVAS_HEIGHT / 2;
  const VERTICAL_SQUASH = 0.6; // flattens the spiral so the cloud fills a wide rectangle rather than growing into a tall circle
  // The spiral's reach at a given radius is an ellipse (full width, squashed
  // height), not a circle -- the radius needed to cover the canvas's
  // farthest corner is hypot(halfWidth, halfHeight / squash), not
  // hypot(fullWidth, fullHeight). The old value was ~1.7x too large, which
  // meant searching a huge ring of candidates that can never be in-bounds.
  const maxRadius = Math.hypot(CANVAS_WIDTH / 2, (CANVAS_HEIGHT / 2) / VERTICAL_SQUASH);

  for (const word of sorted) {
    const fontSize = minFontPx + ((word.count - minCount) / countRange) * (maxFontPx - minFontPx);
    let width: number;
    if (ctx) {
      ctx.font = `${WORD_CLOUD_FONT_WEIGHT} ${fontSize}px ${WORD_CLOUD_FONT_FAMILY}`;
      width = ctx.measureText(word.text).width;
    } else {
      width = word.text.length * fontSize * 0.6; // no canvas (non-browser render) -- rough estimate is fine as a fallback
    }
    const height = fontSize * 1.15;

    let bestX = 0;
    let bestY = 0;
    let found = false;

    // Constant angle step (the old approach) samples the SAME number of
    // points per ring regardless of radius -- at a large radius the ring's
    // circumference is huge, so those few points end up spaced 100+ virtual
    // px apart, skipping right over gaps plenty big enough for a smaller
    // word. Stepping by a constant ARC LENGTH instead keeps sample spacing
    // roughly constant in actual canvas pixels at every radius, so it
    // actually finds the gaps a word cloud this dense needs.
    const radiusStep = 3;
    const stepArcLength = 4;
    for (let radius = 0; radius <= maxRadius && !found; radius += radiusStep) {
      const circumference = 2 * Math.PI * radius;
      const stepsAtRadius = radius === 0 ? 1 : Math.max(8, Math.ceil(circumference / stepArcLength));
      const angleStep = (2 * Math.PI) / stepsAtRadius;
      for (let step = 0; step < stepsAtRadius; step++) {
        const angle = step * angleStep;
        const candidateX = centerX + radius * Math.cos(angle) - width / 2;
        const candidateY = centerY + radius * Math.sin(angle) * VERTICAL_SQUASH - height / 2;
        const box = { x: candidateX, y: candidateY, width, height };
        if (box.x < 0 || box.y < 0 || box.x + width > CANVAS_WIDTH || box.y + height > CANVAS_HEIGHT) continue;
        if (!grid.overlapsAny(box)) {
          bestX = candidateX;
          bestY = candidateY;
          found = true;
          break;
        }
      }
    }
    // A word that can't find a clean, non-overlapping spot within the
    // canvas is dropped rather than force-placed -- a smaller cloud of
    // legible words beats a full one with an illegible overlapping
    // cluster in the middle. Words are processed most-frequent first, so
    // what survives is always the highest-count ones that actually fit.
    if (!found) continue;

    const placedWord = { ...word, x: bestX, y: bestY, width, height, fontSize };
    placed.push(placedWord);
    grid.add(placedWord);
  }

  return placed;
}
