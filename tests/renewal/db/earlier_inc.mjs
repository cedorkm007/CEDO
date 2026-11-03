// tests/renewal/db/earlier_inc.mjs — the older renewal tests were written before the INC documents update (supabase_migration_inc_docs_a/b): a scholar with an INC sent only the
// INC letter, and the Daily Record took the days given. So that they keep checking everything else they cover, they start by putting the earlier functions back with the update's
// own undo files. The update has its own tests (tests/inc-documents).
import fs from "node:fs";

export async function useEarlierInc(db) {
  const read = f => fs.readFileSync(new URL(`../../../${f}`, import.meta.url), "utf8");
  await db.exec(read("undo_inc_docs_b.sql"));
  await db.exec(read("undo_inc_docs_a.sql"));
}
