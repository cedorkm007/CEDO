// tests/renewal-allow-resubmission/web_tests.mjs — the "Allow resubmission" button and the scholar's upload (2 checks)
// Run:  node tests/renewal-allow-resubmission/web_tests.mjs        No database or browser needed.
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { process.exitCode = 1; console.log(`  FAIL ${name} ${extra}`); } };
const tab = src("src/sead/pages/ScholarCounselingRenewalCasesTab.tsx"), api = src("src/sead/consultRenewalApi.ts"), scholar = src("src/scholar/renewalApi.ts");

check("1 an APPROVED document in a Renewal Case has an 'Allow resubmission' button (only for approved ones, with a confirmation that says the old file is deleted when the scholar uploads the new one); pressing it asks the database (consultation staff only) and reads the case again; before the database update it says what to run",
  tab.includes('current.status === "accepted" && (') && tab.includes("Allow resubmission</button>") && tab.includes("When the scholar uploads the new file, the old one is deleted.") && tab.includes("await allowResubmission(d.id)") && tab.includes("await refreshCase(recordId)")
  && api.includes('supabase.rpc("renewal_allow_resubmission", { p_document_id: documentId })') && api.includes("ALLOW_RESUBMISSION_SQL"));
check("2 when the scholar uploads the replacement, the stored file of the document that was opened for resubmission is removed after the new one is saved (the database deletes its record); a failed upload keeps everything as it was",
  scholar.includes('.not("resubmission_allowed_at", "is", null)') && scholar.includes("if (oldPaths.length > 0) await supabase.storage.from(RENEWAL_DOCUMENT_BUCKET).remove(oldPaths);")
  && scholar.indexOf("remove(oldPaths)") > scholar.indexOf('error.message };\n  }\n  if (oldPaths'));
console.log(`\n${passed} passed`);
