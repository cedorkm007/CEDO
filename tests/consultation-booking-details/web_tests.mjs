// tests/consultation-booking-details/web_tests.mjs — the booking pop-up of Consultation Tool > Appointments: how course / year level / barangay / school / GWA are worded and shown (4 checks)
// Run:  node tests/consultation-booking-details/web_tests.mjs        No database or browser needed.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { process.exitCode = 1; console.log(`  FAIL ${name} ${extra}`); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bk-"));
const f = path.join(tmp, "b.mjs");
await build({ entryPoints: [path.join(root, "src/lib/bookingInfo.ts")], bundle: true, format: "esm", platform: "node", outfile: f, logLevel: "error", alias: { "@": path.join(root, "src") } });
const B = await import(pathToFileURL(f).href);

const lower = { min: 1, max: 5, direction: "lower_is_better" };
check("1 a line with nothing saved says 'Not saved'; the GWA shows two decimals with the semester and the school's scale (so 2.50 can be read: lower is better on a 1 to 5 school, higher on a 60 to 100 school)",
  B.infoText("  BS Nursing ") === "BS Nursing" && B.infoText("") === "Not saved" && B.infoText(null) === "Not saved" && B.infoText("   ") === "Not saved"
  && B.gwaLine(2.5, lower, "2025-2026", "2nd Semester").value === "2.50" && B.gwaLine(2.5, lower, "2025-2026", "2nd Semester").note === "of 2nd Semester 2025-2026 · scale 1.00 to 5.00 (1.00 is the best)"
  && /100\.00 is the best/.test(B.gwaLine(88.123, { min: 60, max: 100, direction: "higher_is_better" }, "2025-2026", "1st Semester").note) && B.gwaLine(88.123, { min: 60, max: 100, direction: "higher_is_better" }, null, null).value === "88.12");
check("2 with no GWA the pop-up says why: no grades yet, or the school has no grading setup",
  B.gwaLine(null, lower, "2025-2026", "2nd Semester").value === "Not available" && /No grades are recorded for 2nd Semester 2025-2026/.test(B.gwaLine(null, lower, "2025-2026", "2nd Semester").note)
  && /no grading setup/.test(B.gwaLine(null, null, "2025-2026", "2nd Semester").note) && /No grades are recorded for this scholar/.test(B.gwaLine(null, null, null, null).note));
const modal = src("src/sead/appointments/SlotDetailModal.tsx"), api = src("src/sead/appointmentsApi.ts");
check("3 the pop-up of a booked scholar lists Course, Year level, Barangay, School and GWA under the name; it is read when the pop-up opens, shows placeholders while loading, and the actions (Attended / No-show) work without it",
  ["Course", "Year level", "Barangay", "School"].every(l => modal.includes(`["${l}",`)) && modal.includes('<dt className="text-slate-600">GWA</dt>') && /fetchSlotScholarInfo\(slot\.slotId\)/.test(modal) && /animate-pulse/.test(modal)
  && /infoState !== "missing"/.test(modal) && /The appointment still works/.test(modal) && modal.indexOf("About the scholar") < modal.indexOf('onClick={() => void mark("attended")}'));
check("4 the call asks the database for the appointment (counseling_slot_scholar_info) and tells 'database update not run' apart from a real error",
  /rpc\("counseling_slot_scholar_info", \{ p_slot_id: slotId \}\)/.test(api) && /missing: !!error && \(error\.code === "PGRST202"/.test(api) && /gwa: numOrNull\(d\.gwa\)/.test(api) && /scale_direction/.test(api));
console.log(`\n${passed} passed`);
