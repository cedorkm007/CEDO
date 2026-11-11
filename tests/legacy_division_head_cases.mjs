// tests/legacy_division_head_cases.mjs — puts three cases on the OLD Division Head route in the demo data (for the tests of the Division Head decisions).
// Since the consultation-staff route (supabase_migration_renewal_consultation_endorse.sql) the demo has none of its own: new cases go to the consultation staff, not to the Division Head.
// The old route is still used by cases the Division Head already had, so its functions are still tested here.
export async function legacyDivisionHeadCases(db) {
  const rec = async n => (await db.query("select id from renewal_records where scholar_id_number = $1 order by created_at desc limit 1", [`TEST-${String(n).padStart(4, "0")}`])).rows[0].id;
  await db.query("update renewal_records set stage = 'needs_consultation_division_head' where id = $1", [await rec(41)]);      // 2+ failed, consultation done: goes to the Division Head by itself
  await db.query("update renewal_records set stage = 'endorsed_division_head' where id = $1", [await rec(42)]);                 // 1 failed, endorsed: goes to the Division Head by itself
  await db.query("update renewal_records set stage = 'needs_consultation_division_head' where id = $1", [await rec(44)]);      // 2+ failed, no consultation: waits for the evaluator to send it
}
