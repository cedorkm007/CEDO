// ─────────────────────────────────────────────────────────────
// src/lib/renewalTagging.ts
// Scholar tagging for automatic renewal (Scholar Renewal > Scholar tagging). Plain helpers (no React, no Supabase) so tests can run them alone.
// ─────────────────────────────────────────────────────────────

/**
 * Scholar IDs typed or pasted into the tagging box (one per line, or separated by commas, semicolons, tabs or spaces; a spreadsheet column pasted in works too).
 * Dashes copied from Word or Excel (– — −) become the ordinary "-", quotes around an ID are dropped, empty pieces are ignored, and the same ID is kept once (upper or lower case counts as the same).
 */
export function parseScholarIds(text: string): string[] {
  const seen = new Set<string>(), out: string[] = [];
  for (const raw of String(text ?? "").split(/[\s,;]+/)) {
    const id = raw.replace(/[‐-―−]/g, "-").replace(/^["'`]+|["'`]+$/g, "").trim();
    if (!id) continue;
    const key = id.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key); out.push(id);
  }
  return out;
}

export interface TagResult { tagged: number; already: number; notFound: string[]; skipped: string[] }

/** One plain sentence about what tagging did. */
export function tagResultText(r: TagResult): string {
  const parts = [`${r.tagged} scholar${r.tagged === 1 ? "" : "s"} tagged`];
  if (r.already > 0) parts.push(`${r.already} already tagged`);
  if (r.notFound.length > 0) parts.push(`${r.notFound.length} ID${r.notFound.length === 1 ? "" : "s"} not found`);
  if (r.skipped.length > 0) parts.push(`${r.skipped.length} skipped (Removed or On leave)`);
  return parts.join(" · ") + ".";
}
