// tests/renewal/db/legacy_slots.mjs — the Phase 3 / 4 / 6 tests were written for the original booking model (pre-made 10-minute slots, scholars pick a slot).
// The consultation-types update (supabase_migration_consultation_types_a/b) replaced that model with types + morning / afternoon booking, which has its own tests
// (tests/school-update/consultation_types_db_tests.mjs). So that the older tests keep checking everything else they cover (INC deadlines, Daily Records, reminders,
// notifications...) on the original model, they start by putting the original booking functions back with the update's own undo files.
import fs from "node:fs";

export async function useLegacySlots(db) {
  const read = f => fs.readFileSync(new URL(`../../../${f}`, import.meta.url), "utf8");
  await db.exec(read("undo_consultation_types_b.sql"));   // the old functions are back
  await db.exec(read("undo_consultation_types_a.sql"));   // "one row per staff member per start time" is back
  await db.exec(read("undo_consultation_types_b.sql"));   // and now the empty 10-minute slots can be made again for the availability already set
}
