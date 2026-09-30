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

function rectsOverlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  const pad = 8; // breathing room so adjacent words don't visually touch -- bold text's real ascent/descent runs taller than the height estimate below, so this needs to be generous, not just cosmetic
  return !(
    a.x + a.width + pad < b.x ||
    b.x + b.width + pad < a.x ||
    a.y + a.height + pad < b.y ||
    b.y + b.height + pad < a.y
  );
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
  const centerX = CANVAS_WIDTH / 2;
  const centerY = CANVAS_HEIGHT / 2;
  const maxRadius = Math.hypot(CANVAS_WIDTH, CANVAS_HEIGHT);

  for (const word of sorted) {
    const fontSize = minFontPx + ((word.count - minCount) / countRange) * (maxFontPx - minFontPx);
    let width: number;
    if (ctx) {
      ctx.font = `700 ${fontSize}px Arial, sans-serif`;
      width = ctx.measureText(word.text).width;
    } else {
      width = word.text.length * fontSize * 0.6; // no canvas (non-browser render) -- rough estimate is fine as a fallback
    }
    const height = fontSize * 1.15;

    let bestX = 0;
    let bestY = 0;
    let found = false;

    const radiusStep = 4;
    const angleStep = 0.3;
    for (let radius = 0; radius <= maxRadius && !found; radius += radiusStep) {
      const stepsAtRadius = radius === 0 ? 1 : Math.ceil((2 * Math.PI) / angleStep);
      for (let step = 0; step < stepsAtRadius; step++) {
        const angle = step * angleStep;
        // squash vertically (0.6x) so the cloud fills a wide rectangle rather than growing into a tall circle
        const candidateX = centerX + radius * Math.cos(angle) - width / 2;
        const candidateY = centerY + radius * Math.sin(angle) * 0.6 - height / 2;
        const box = { x: candidateX, y: candidateY, width, height };
        if (box.x < 0 || box.y < 0 || box.x + width > CANVAS_WIDTH || box.y + height > CANVAS_HEIGHT) continue;
        if (!placed.some(p => rectsOverlap(p, box))) {
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

    placed.push({ ...word, x: bestX, y: bestY, width, height, fontSize });
  }

  return placed;
}
