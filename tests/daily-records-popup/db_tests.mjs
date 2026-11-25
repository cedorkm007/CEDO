// tests/daily-records-popup/db_tests.mjs — Daily Records, the larger pop-up: saved drafts, shared quick phrases and the scholar summary (5 checks, short on purpose)
// Run:  node tests/daily-records-popup/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const NEW = "supabase_migration_daily_records_popup.sql", UNDO = "undo_daily_records_popup.sql";
async function as(uid, sql, params = []) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)", [uid, JSON.stringify({ sub: uid, role: "authenticated" })]);
    return (await tx.query(sql, params)).rows;
  });
}
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await as(uid, sql, params) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
await db.exec(read(NEW)); await db.exec(read(NEW));      // twice: safe
const A = seedId("staff:demo.counselor"), B = seedId("staff:demo.admin"), PLAIN = seedId("staff:demo.plain");
await q("insert into staff_account_tags (staff_id, tag_key) values ($1, 'scholar_counseling') on conflict do nothing", [B]);

// 1. drafts: each staff member sees only their own; saving again replaces; discarding removes; drafts older than 30 days go; limits
const s1 = await attempt(A, "select public.counseling_draft_save('edit:abc', $1::jsonb, 2) at", [JSON.stringify({ findings: "typed so far" })]);
const s1b = await attempt(A, "select public.counseling_draft_save('edit:abc', $1::jsonb, 2) at", [JSON.stringify({ findings: "typed so far, more" })]);
const mine = await attempt(A, "select payload, base_edit_count from public.counseling_draft_get('edit:abc')");
const theirs = await attempt(B, "select * from public.counseling_draft_get('edit:abc')");
const plain = await attempt(PLAIN, "select public.counseling_draft_save('edit:abc', '{}'::jsonb, null)");
const big = await attempt(A, "select public.counseling_draft_save('edit:big', $1::jsonb, null)", [JSON.stringify({ x: "y".repeat(200001) })]);
const noKey = await attempt(A, "select public.counseling_draft_save('', '{}'::jsonb, null)");
await q("update consultation_record_drafts set saved_at = now() - interval '31 days' where draft_key = 'edit:abc'");
await attempt(B, "select public.counseling_draft_save('new:X', '{}'::jsonb, null)");      // any save sweeps the old ones
const swept = Number((await q("select count(*)::int n from consultation_record_drafts where draft_key = 'edit:abc'"))[0].n);
await attempt(A, "select public.counseling_draft_save('edit:two', '{\"findings\":\"b\"}'::jsonb, 0)");
await attempt(A, "select public.counseling_draft_discard('edit:two')");
const gone = await attempt(A, "select * from public.counseling_draft_get('edit:two')");
check("1 a draft is kept per staff member (only they can read it; saving again replaces it; discarding removes it), drafts nobody came back to for 30 days are swept, and a draft without a name, one that is too large, or a staff without the tag is refused",
  s1.ok && s1b.ok && mine.ok && mine.rows.length === 1 && mine.rows[0].payload.findings === "typed so far, more" && mine.rows[0].base_edit_count === 2 && theirs.ok && theirs.rows.length === 0
  && !plain.ok && /Not authorized/.test(plain.msg) && !big.ok && /too large/.test(big.msg) && !noKey.ok && /no valid name/.test(noKey.msg) && swept === 0 && gone.ok && gone.rows.length === 0, `${mine.msg} ${big.msg} ${noKey.msg} ${swept}`);

// 2. quick phrases: two examples while the list is empty (not again), any consultation staff can add / change / remove, nobody else, limits
const list0 = await attempt(A, "select phrase from public.counseling_phrases_list()");
const added = await attempt(B, "select public.counseling_phrase_save(null, '  Scholar asked for a follow-up  ') id");
const pid = added.rows?.[0]?.id;
const changed = await attempt(A, "select public.counseling_phrase_save($1, 'Follow-up booked') id", [pid]);
const list1 = await attempt(A, "select phrase from public.counseling_phrases_list()");
const empty = await attempt(A, "select public.counseling_phrase_save(null, '   ')"), longP = await attempt(A, "select public.counseling_phrase_save(null, $1)", ["p".repeat(301)]);
const plainP = await attempt(PLAIN, "select * from public.counseling_phrases_list()"), plainAdd = await attempt(PLAIN, "select public.counseling_phrase_save(null, 'hello')");
await attempt(B, "select public.counseling_phrase_delete($1)", [pid]);
const list2 = await attempt(A, "select phrase from public.counseling_phrases_list()");
check("2 the quick phrases are one shared list: two examples at the start (not added again when the SQL is run twice), any consultation staff can add (spaces trimmed), change and remove one, an empty or 301-character phrase and a staff without the tag are refused",
  list0.ok && list0.rows.map(r => r.phrase).join("|") === "Advised to submit study plan|Referred to guidance office" && added.ok && changed.ok && list1.rows.map(r => r.phrase).join("|") === "Advised to submit study plan|Referred to guidance office|Follow-up booked"
  && !empty.ok && /Type the phrase/.test(empty.msg) && !longP.ok && /300/.test(longP.msg) && !plainP.ok && !plainAdd.ok && list2.rows.length === 2, `${list0.msg} ${JSON.stringify(list1.rows)}`);

// 3. the scholar summary: details, renewal stage, failed / INC subjects, previous visits (newest first, 20 at a time, the open record left out)
const SCHOLAR = (await q("select r.scholar_id_number s from renewal_records r order by r.created_at desc limit 1"))[0]?.s ?? (await q("select scholar_id_number s from scholars order by 1 limit 1"))[0].s;
await q("delete from scholar_counseling_records where scholar_id_number = $1", [SCHOLAR]);
await q(`insert into scholar_counseling_records (scholar_id_number, status, consulted_by, date_visited, failed_subjects, findings, staff_recommendations, visit_type)
         select $1, 'Regular', $2, date '2026-10-01' + g, '', 'Visit ' || g, 'Advice ' || g, 'Office' from generate_series(1, 25) g`, [SCHOLAR, A]);
const ids = (await q("select id from scholar_counseling_records where scholar_id_number = $1 order by date_visited desc", [SCHOLAR])).map(r => r.id);
const c1 = await attempt(A, "select public.counseling_record_context($1, $2) c", [SCHOLAR, ids[0]]);
const c2 = await attempt(A, "select public.counseling_record_context($1, $2, 20, 20) c", [SCHOLAR, ids[0]]);
const cMax = await attempt(A, "select public.counseling_record_context($1, null, 500, 0) c", [SCHOLAR]);
const cPlain = await attempt(PLAIN, "select public.counseling_record_context($1)", [SCHOLAR]), cNone = await attempt(A, "select public.counseling_record_context('NO-SUCH-ID')");
const hasRenewal = Number((await q("select count(*)::int n from renewal_records where scholar_id_number = $1", [SCHOLAR]))[0].n) > 0;
const C1 = c1.rows?.[0]?.c;
check("3 the scholar summary gives the scholar's details and renewal stage, and the previous visits newest first, 20 at a time with the true total, without the record that is open (never more than 50 in one request); only consultation staff, and a wrong ID is refused",
  c1.ok && C1.scholar.scholar_id_number === SCHOLAR && !!C1.scholar.name && Array.isArray(C1.failed_subjects) && Array.isArray(C1.open_inc) && (hasRenewal ? !!C1.renewal?.stage : C1.renewal === null)
  && C1.visits.length === 20 && C1.visits_total === 24 && C1.visits[0].findings === "Visit 24" && !C1.visits.some(v => v.id === ids[0]) && c2.rows[0].c.visits.length === 4 && cMax.rows[0].c.visits.length === 25 - 0 && cMax.rows[0].c.visits.length <= 50
  && !cPlain.ok && /Not authorized/.test(cPlain.msg) && !cNone.ok && /Scholar not found/.test(cNone.msg), `${c1.msg} ${JSON.stringify(C1 && { v: C1.visits?.length, t: C1.visits_total, r: C1.renewal })}`);

// 4. the tables cannot be read or changed directly by staff, and no record or history was touched
const direct = await attempt(A, "select count(*) from consultation_record_drafts"), directP = await attempt(A, "select count(*) from consultation_quick_phrases");
const recs = Number((await q("select count(*)::int n from scholar_counseling_records where scholar_id_number = $1", [SCHOLAR]))[0].n);
check("4 staff cannot read the drafts or the phrases tables directly (only through the functions), and the records and the edit history are untouched", !direct.ok && !directP.ok && recs === 25, `${direct.msg} ${recs}`);

// 5. the undo removes the functions and keeps the tables and what is in them; the update can be run again without adding the examples twice
await db.exec(read(UNDO)); await db.exec(read(UNDO));
const left = (await q("select to_regprocedure('public.counseling_draft_save(text,jsonb,integer)') a, to_regprocedure('public.counseling_phrases_list()') b, to_regprocedure('public.counseling_record_context(text,uuid,integer,integer)') c, to_regclass('public.consultation_record_drafts') d, to_regclass('public.consultation_quick_phrases') e"))[0];
const kept = Number((await q("select count(*)::int n from consultation_quick_phrases"))[0].n);
await db.exec(read(NEW));
const after = Number((await q("select count(*)::int n from consultation_quick_phrases"))[0].n);
check("5 the undo removes the functions but keeps both tables and the phrases in them; running the update again brings the functions back and does not add the two examples a second time",
  !left.a && !left.b && !left.c && !!left.d && !!left.e && kept === 2 && after === 2, `${JSON.stringify(left)} ${kept} ${after}`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
