// ─────────────────────────────────────────────────────────────
// src/lib/schoolNames.ts
// Matching school names the way the database does (supabase_migration_standing_cleanup_logins.sql, _school_key): case,
// surrounding spaces and repeated spaces are ignored. Pure (no Supabase, no React) so it can be tested.
// ─────────────────────────────────────────────────────────────

/** "Pilgrim  Christian College " and "pilgrim christian college" are the same school. */
export function schoolKey(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}

export interface SchoolNameEntry { id: string; name: string; aliases?: string[] }

/** Which school does a typed name mean — the official name first, then any alias; null when it matches nothing. */
export function findSchoolByName(typed: string, schools: SchoolNameEntry[]): SchoolNameEntry | null {
  const key = schoolKey(typed);
  if (!key) return null;
  return schools.find(s => schoolKey(s.name) === key) ?? schools.find(s => (s.aliases ?? []).some(a => schoolKey(a) === key)) ?? null;
}

/** Schools that look like the same school written differently — candidates to merge. Groups of two or more with the same simplified name (punctuation and common words like "of" / "the" dropped). */
export function similarSchoolGroups(schools: SchoolNameEntry[]): SchoolNameEntry[][] {
  const simplify = (n: string) => schoolKey(n).replace(/[^a-z0-9 ]+/g, " ").split(" ").filter(w => w && !["of", "the", "and", "&"].includes(w)).join(" ");
  const groups = new Map<string, SchoolNameEntry[]>();
  for (const s of schools) {
    const key = simplify(s.name);
    const list = groups.get(key);
    if (list) list.push(s); else groups.set(key, [s]);
  }
  return Array.from(groups.values()).filter(g => g.length > 1);
}
