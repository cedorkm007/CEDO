// tests/consultation-open/web_tests.mjs — the scholar's Consultation tile: book any time, and choose the staff
// Run:  node tests/consultation-open/web_tests.mjs
// No database or browser needed.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8");
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };
const api = src("src/scholar/renewalApi.ts"), picker = src("src/scholar/components/dashboard/ConsultationBlockPicker.tsx"), panel = src("src/scholar/components/dashboard/ConsultationPanel.tsx");
const section = src("src/scholar/components/dashboard/SelfConsultationSection.tsx"), referralSection = src("src/scholar/components/dashboard/ReferralConsultationSection.tsx");

console.log("The calls");
test("the website asks the database who is available, and sends the staff choice only when the scholar made one (so it works before the database update)", () => {
  assert.ok(api.includes('rpc("consult_block_staff"') && api.includes("legacy: functionMissing(error)"));
  assert.ok(api.includes("const staffArg = (staffId?: string | null) => (staffId ? { p_staff: staffId } : {});"));
  for (const fn of ["renewal_book_consultation", "renewal_reschedule_consultation", "referral_book_consultation", "referral_reschedule_consultation", "consult_self_book", "consult_self_reschedule"])
    assert.ok(new RegExp(`rpc\\("${fn}", \\{[^}]*\\.\\.\\.staffArg\\(staffId\\)`).test(api), fn);
});
test("the any-time booking has its own calls: types, open days, book, change, cancel and the scholar's own booking", () => {
  for (const fn of ["consult_my_self", "consult_self_types", "consult_self_open_blocks", "consult_self_book", "consult_self_reschedule", "consult_self_cancel"]) assert.ok(api.includes(`rpc("${fn}"`), fn);
  assert.ok(/fetchMySelfConsultation[\s\S]*missing: functionMissing\(error\)/.test(api), "a missing database update is told, not shown as an error");
});

console.log("The screens");
test("after the day and morning / afternoon, the scholar can choose who to see: anyone available (the default) or one of the available staff", () => {
  assert.ok(picker.includes("4. Who would you like to see?") && picker.includes("Anyone available") && picker.includes("We choose for you"));
  assert.ok(picker.includes("fetchBlockStaff(realType, shownDay, half)") && picker.includes("setStaffId(null)"));
  assert.ok(picker.includes("{s.freeMinutes} minutes still free") && picker.includes("{s.staffName}"));
});
test("the choice goes with every kind of booking and change, and a referral asks with its reason", () => {
  for (const call of ["rescheduleSelfConsultation(typeKey, shownDay, half, staffId)", "bookSelfConsultation(typeKey, shownDay, half, staffId)", "rescheduleReferralConsultation(referral.id, shownDay, half, staffId)",
    "bookReferralConsultation(referral.id, shownDay, half, staffId)", "rescheduleConsultationBlock(recordId, typeKey, shownDay, half, staffId)", "bookConsultationBlock(recordId, typeKey, shownDay, half, staffId)"]) assert.ok(picker.includes(call), call);
  assert.ok(picker.includes("const realType = referral ? referral.reason : typeKey;"));
  assert.ok(referralSection.includes("reason: referral.reason"));
});
test("before the database update the staff choice simply is not shown", () => assert.ok(picker.includes("setStaff(r.ok ? r.staff : null)") && picker.includes("half && staff && staff.length > 0")));
test("the picker has an any-time mode: the scholar chooses the type, nothing is suggested", () => {
  assert.ok(picker.includes("self?: boolean") && picker.includes("fetchSelfConsultTypes()") && picker.includes("fetchSelfBlocks(typeKey)"));
});
test("the Consultation tile always offers 'Book a consultation any time' (when the database update is in), also with no renewal and no referral", () => {
  assert.ok(panel.includes("{selfEnabled && <SelfConsultationSection booking={mine} onChanged={load} />}"));
  assert.ok(panel.includes("fetchMySelfConsultation()") && panel.includes("setSelfEnabled(sf.ok)"));
  assert.ok(panel.includes("{!selfEnabled && needing.length === 0 && upcoming.length === 0 && referrals.length === 0 && ("), "the old 'nothing to book' message stays only before the database update");
});
test("the any-time section shows the booking with the staff name, lets the scholar change (time or staff) or cancel up to 12 hours before, and says so after that", () => {
  assert.ok(section.includes("Book a consultation any time") && section.includes("Change the time or the staff") && section.includes("Cancel my consultation"));
  assert.ok(section.includes("{booking.staffName}") && section.includes("CONSULT_CHANGE_CUTOFF_HOURS") && section.includes("cancelSelfConsultation()"));
});

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
