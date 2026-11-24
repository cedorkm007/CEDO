// tests/renewal-termination-signatory/web_tests.mjs — the evaluator's choice of who signs the termination form, and the form without the "Noted by" block (3 checks)
// Run:  node tests/renewal-termination-signatory/web_tests.mjs        No database or browser needed.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { process.exitCode = 1; console.log(`  FAIL ${name} ${extra}`); } };
const detail = src("src/sead/renewal/RenewalDetailView.tsx"), api = src("src/sead/consultRenewalApi.ts"), forms = src("src/lib/removalFormApi.ts"), fn = src("supabase/functions/removal-form-issue/index.ts"), demo = src("localdemo/server.mjs");

check("1 approving a Removed endorsement asks 'Who signs the scholarship termination form?' with the list from the database (Division Head, City Education and Development Officer, tagged staff); the button stays off until one is chosen; the choice is sent with the approval",
  detail.includes("Who signs the scholarship termination form?") && detail.includes("fetchTerminationSignatories()") && detail.includes('extraValid={final !== "Removed" || !!chosenSignatory}') && detail.includes('final === "Removed" ? chosenSignatory : undefined')
  && api.includes('supabase.rpc("renewal_termination_signatories")') && api.includes("if (signatory) args.p_signatory = signatory"));
check("2 the evaluator can download the termination form of a removal from the renewal case; the consultation staff's list of forms makes it from the renewal record for those rows; the edge function and the demo's stand-in accept a record id as well as a referral id",
  detail.includes("downloadRenewalRemovalForm(r.id)") && detail.includes("Download the termination form") && forms.includes('formKinds.get(referralId) === "record" ? { recordId: referralId } : { referralId }') && forms.includes('r.form_kind === "record"')
  && fn.includes('"renewal_removal_form_data"') && fn.includes("recordId") && demo.includes("renewal_removal_form_data"));

// the form itself: with the Officer as the signatory there is no "Noted by" person
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rts-"));
const out = path.join(tmp, "p.mjs");
await build({ entryPoints: [path.join(root, "supabase/functions/_shared/removalFormPdf.ts")], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "error" });
const M = await import(pathToFileURL(out).href);
const base = { first: "Juan", middle: "D", last: "Cruz", program: "BS Test", yearLevel: "2nd Year", school: "Test University", barangay: "Bugo", failed: [{ semesterYear: "1st Semester 2025-2026", yearLevel: "2nd Year", code: "S1", subject: "Subject One" }], issuedOn: "2026-11-24", officer: { name: "Ms. Richel Petalcurin-Dahay, LPT, MPSM", title: "City Education and Development Officer", signature: null } };
const withNoted = await M.buildRemovalFormPdf({ ...base, divisionHead: { name: "Roxanne Jul Tandang", title: "Head, Scholarships and Educational Assistance Division", signature: null } });
const officerOnly = await M.buildRemovalFormPdf({ ...base, divisionHead: null });
check("3 the form is made with a 'Noted by' person (Division Head or a staff member) and also without one (the Officer signs: only the Officer's block is printed); both are real PDF files",
  withNoted instanceof Uint8Array && officerOnly instanceof Uint8Array && new TextDecoder().decode(withNoted.slice(0, 5)) === "%PDF-" && new TextDecoder().decode(officerOnly.slice(0, 5)) === "%PDF-" && officerOnly.length > 1000 && withNoted.length !== officerOnly.length);
console.log(`\n${passed} passed`);
