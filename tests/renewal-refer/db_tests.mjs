// tests/renewal-refer/db_tests.mjs — "Refer for Consultation": the evaluator books the renewal consultation for a scholar with an INC, a DRP or a failed subject (5 checks, short on purpose)
// Run:  node tests/renewal-refer/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import { build } from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const outfile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ref-")), "a.mjs");
await build({ entryPoints: ["src/lib/renewalActions.ts"], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error", alias: { "@": path.resolve("src") } });
const A = await import(pathToFileURL(outfile).href);
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const NEW = "supabase_migration_renewal_refer_consultation.sql", UNDO = "undo_renewal_refer_consultation.sql";
await db.exec(read(NEW)); await db.exec(read(NEW));      // twice: safe
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await as(uid, async tx => (await tx.query(sql, params)).rows) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
const EVAL = seedId("staff:demo.evaluator"), COUNSELOR = seedId("staff:demo.counselor"), ADMIN = seedId("staff:demo.admin"), PLAIN = seedId("staff:demo.plain");
const manilaDate = offset => new Date(Date.now() + 8 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);
const at = (day, hm) => new Date(`${day}T${hm}:00+08:00`).toISOString();
const D = manilaDate(14);
await attempt(COUNSELOR, "select public.counseling_availability_save(null, $1, $2, false)", [at(D, "09:00"), at(D, "11:00")]);
await attempt(ADMIN, "select public.counseling_availability_save(null, $1, $2, false)", [at(D, "09:00"), at(D, "10:00")]);
const rec = async n => (await q("select * from renewal_records where scholar_id_number = $1 order by created_at desc limit 1", [`TEST-${String(n).padStart(4, "0")}`]))[0];
const two = await rec(44), clean = await rec(46);      // 44: two failed subjects, no consultation booked; 46: renewed, everything passed

const types = await attempt(EVAL, "select * from public.renewal_refer_types($1)", [two.id]);
const denied = await attempt(PLAIN, "select * from public.renewal_refer_types($1)", [two.id]);
check("1 only the renewal evaluator may use it; the types come with their minutes and the one that fits two failed subjects is suggested", types.ok && !denied.ok && /Only the Scholar Renewal Evaluator/.test(denied.msg) && types.rows.some(t => t.key === "two_plus_failed" && t.suggested === true && Number(t.minutes) > 0), denied.msg);
const blocks = await attempt(EVAL, "select * from public.renewal_refer_open_blocks($1, 'two_plus_failed')", [two.id]);
const staff = await attempt(EVAL, "select * from public.renewal_refer_block_staff('two_plus_failed', $1, 'AM')", [D]);
check("2 the open days and mornings / afternoons are listed, and the staff available in the chosen morning (the one with most minutes first)", blocks.ok && blocks.rows.some(b => (b.day instanceof Date ? b.day.toISOString() : String(b.day)).slice(0, 10) === D && b.half === "AM") && staff.ok && staff.rows.length === 2 && staff.rows[0].staff_id === COUNSELOR, JSON.stringify([blocks.msg, staff.msg]));
const book = await attempt(EVAL, "select public.renewal_refer_book($1, 'two_plus_failed', $2, 'AM', $3)", [two.id, D, COUNSELOR]);
const slot = (await q("select * from counseling_slots where record_id = $1 and state = 'booked'", [two.id]))[0];
check("3 booking: the consultation is booked for the scholar with the chosen staff member, the scholar is told they do not have to book, and the renewal history says who referred", book.ok && !!slot && slot.staff_id === COUNSELOR && slot.scholar_id_number === two.scholar_id_number
  && Number((await q("select count(*) n from scholar_notifications where scholar_id_number = $1 and title = 'You were referred for a consultation' and body like '%do not need to book%'", [two.scholar_id_number]))[0].n) === 1
  && Number((await q("select count(*) n from renewal_history where record_id = $1 and note like 'Referred for consultation by%'", [two.id]))[0].n) === 1, book.msg);
const again = await attempt(EVAL, "select public.renewal_refer_book($1, 'two_plus_failed', $2, 'AM', null)", [two.id, D]);
const noCase = await attempt(EVAL, "select public.renewal_refer_book($1, 'one_failed', $2, 'AM', null)", [clean.id, D]);
check("4 it is refused when a consultation is already booked, and for a case with no INC, DRP or failed subject (a renewed scholar)", !again.ok && /already has a consultation booked/.test(again.msg) && !noCase.ok && /INC, a DRP or a failed subject/.test(noCase.msg), `${again.msg} | ${noCase.msg}`);
const row = { failed: 2, drp: 0, inc: 0 }, facts = over => ({ recordId: "r1", stage: "needs_consultation_division_head", isLate: false, appliedAt: null, docsToReview: 0, consultationRequired: true, consultationDoneAt: null, nextConsultation: null, gradesStatus: "school", dhReferralId: null, dhStatus: null, referralStatus: null, ...over });
const panel = fs.readFileSync("src/sead/renewal/RenewalListTab.tsx", "utf8").split("\r\n").join("\n");
check("5 the action 'Refer for Consultation' is offered on an application with failures / DRP / INC while no consultation is booked or done, and not otherwise; the list opens the booking screen for it",
  A.canReferForConsultation(row, facts({})) && A.canReferForConsultation({ failed: 0, drp: 1, inc: 0 }, facts({})) && A.canReferForConsultation({ failed: 0, drp: 0, inc: 1 }, facts({}))
  && !A.canReferForConsultation({ failed: 0, drp: 0, inc: 0 }, facts({})) && !A.canReferForConsultation(row, facts({ nextConsultation: "2026-12-01T01:00:00Z" })) && !A.canReferForConsultation(row, facts({ stage: "renewed" })) && !A.canReferForConsultation(row, facts({ recordId: null }))
  && A.REFER_BOOKING_ACTION.label === "Refer for Consultation" && panel.includes('tab === "applications" && canReferForConsultation(r, f)') && panel.includes("<RenewalReferConsultationModal"));
void UNDO;

console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
