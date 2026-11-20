// tests/consultation-booking-referred-by/web_tests.mjs — the booked appointment's pop-up: the "Referred by:" line (2 checks)
// Run:  node tests/consultation-booking-referred-by/web_tests.mjs        No database or browser needed.
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { process.exitCode = 1; console.log(`  FAIL ${name} ${extra}`); } };
const modal = src("src/sead/appointments/SlotDetailModal.tsx"), api = src("src/sead/appointmentsApi.ts");

check("1 the pop-up shows 'Referred by: <name>' only when there is a referrer, near the top (before the case stage), and reads it again for each appointment; the rest of the pop-up (course, year, barangay, school, GWA, Attended, No-show) is unchanged",
  modal.includes("fetchSlotReferrer(slot.slotId)") && modal.includes("{referrer && <p>Referred by: <strong") && modal.indexOf("Referred by:") < modal.indexOf("<RenewalStageBadge") && modal.includes("}, [slot.slotId]);")
  && modal.includes("About the scholar") && modal.includes("fetchSlotScholarInfo(slot.slotId)") && modal.includes('void mark("attended")') && modal.includes('void mark("no_show")'));
check("2 the call asks the new function, and before the database update (or on any error) it simply answers 'nobody', so the pop-up works as before",
  api.includes('supabase.rpc("counseling_slot_referrer", { p_slot_id: slotId })') && /fetchSlotReferrer[\s\S]*?if \(error \|\| !data\) return \{ referredBy: null \};/.test(api));
console.log(`\n${passed} passed`);
