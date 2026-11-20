// tests/legacy_division_head_cases.mjs — puts cases on the OLD Division Head route in the demo data (for the tests of the Division Head decisions).
// Since the consultation-staff route (supabase_migration_renewal_consultation_endorse.sql) the demo has none of its own: new cases go to the consultation staff, not to the Division Head.
// The old route is still used by cases the Division Head already had, so its functions are still tested here.
import { seedId } from "../localdemo/seed.mjs";

/**
 * Three cases on the old route: scholars 41 and 44 wait for the Division Head (44 has no consultation yet), 42 is endorsed to the Division Head.
 * `all: true` (the older renewal suites) also gives scholar 43 the same endorsed state, and lets the Division Head reconsider scholar 45, whose final decision is then made,
 * so that case waits for the evaluator's confirmation (the state the demo had before the consultation-staff route).
 */
export async function legacyDivisionHeadCases(db, { all = false } = {}) {
  const rec = async n => (await db.query("select id from renewal_records where scholar_id_number = $1 order by created_at desc limit 1", [`TEST-${String(n).padStart(4, "0")}`])).rows[0].id;
  const asUser = (uid, sql, params = []) => db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)", [uid, JSON.stringify({ sub: uid, role: "authenticated" })]);
    return (await tx.query(sql, params)).rows;
  });
  await db.query("update renewal_records set stage = 'needs_consultation_division_head' where id = $1", [await rec(41)]);      // 2+ failed, consultation done: goes to the Division Head by itself
  await db.query("update renewal_records set stage = 'endorsed_division_head' where id = $1", [await rec(42)]);                 // 1 failed, endorsed: goes to the Division Head by itself
  await db.query("update renewal_records set stage = 'needs_consultation_division_head' where id = $1", [await rec(44)]);      // 2+ failed, no consultation: waits for the evaluator to send it
  if (all) {
    await db.query("update renewal_records set stage = 'endorsed_division_head' where id = $1", [await rec(43)]);              // 1 failed, endorsed: waiting for the Division Head
    const r45 = await rec(45);
    await db.query("update renewal_records set stage = 'needs_consultation_division_head' where id = $1", [r45]);      // 2+ failed with the consultation done: the Division Head can reconsider it
    await asUser(seedId("staff:demo.divhead"), "select public.renewal_division_head_decide($1, 'reconsidered', 'sig.png', '')", [r45]);      // the Division Head reconsiders ...
    const f = (await db.query("select id, referred_to from scholar_counseling_referrals where renewal_record_id = $1 and status = 'division_head_approved'", [r45])).rows[0];
    if (f) await asUser(f.referred_to, "select public.consult_finalize_decision($1)", [f.id]);                                      // ... and the consulting staff make the final decision: it waits for the evaluator
  }
}
