// tests/consultation-same-day/web_tests.mjs — the screens say that a consultation can be booked on the same day, and keep the 12-hour rule for changing or cancelling (2 checks, short on purpose)
// Run:  node tests/consultation-same-day/web_tests.mjs     (no database or browser needed)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { process.exitCode = 1; console.log(`  FAIL ${name} ${extra}`); } };

const lib = src("src/lib/renewal.ts"), section = src("src/scholar/components/dashboard/ConsultationSection.tsx"), picker = src("src/scholar/components/dashboard/ConsultationBlockPicker.tsx"), panel = src("src/scholar/components/dashboard/ConsultationPanel.tsx");
check("1 the lead time for booking is 60 minutes (the same day is allowed) and the change / cancel cutoff is still 12 hours; the screens no longer say a time must be 12 hours away",
  lib.includes("export const CONSULT_BOOK_LEAD_MINUTES = 60;") && lib.includes("export const CONSULT_CHANGE_CUTOFF_HOURS = 12;")
  && !section.includes("times must be at least {CONSULT_CHANGE_CUTOFF_HOURS} hours away") && !picker.includes("must be at least 12 hours away"));
check("2 the scholar is told they can book today (at least 1 hour ahead), and that changing or cancelling needs 12 hours before it starts",
  panel.includes("also today, at least 1 hour ahead") && panel.includes("up to {CONSULT_CHANGE_CUTOFF_HOURS} hours before it starts") && section.includes("so today counts too") && picker.includes("today counts too"));
console.log(`\n${passed} passed`);
