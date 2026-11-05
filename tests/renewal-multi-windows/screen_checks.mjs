// tests/renewal-multi-windows/screen_checks.mjs — what the evaluator's screens say and call: several windows per term, the separate CSR switch for testing, the "Revert application" button
// Run:  node tests/renewal-multi-windows/screen_checks.mjs      (no database or browser needed)
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const src = f => fs.readFileSync(f, "utf8").split("\r\n").join("\n");
const win = src("src/sead/renewal/RenewalWindowsTab.tsx"), page = src("src/sead/ScholarRenewalPage.tsx"), cert = src("src/sead/renewal/RenewalCertificateTab.tsx"), csr = src("src/lib/csrApi.ts"), detail = src("src/sead/renewal/RenewalDetailView.tsx"), api = src("src/sead/renewalApi.ts");

console.log("Several windows for one term");
check("the Windows tab explains that a term can have several windows and a school can be in only one", /A term can have <strong>several windows<\/strong>/.test(win) && /A school can be in only one window of a term/.test(win));
check("a window says when it is one of several for its term, and an 'all schools' window names the schools it skips", /One of \{sameTerm\} windows for this term/.test(win) && /<strong>except<\/strong> the \{ownSchoolIds\.length\}/.test(win));
check("in the form, a school that already has its own window for the term cannot be ticked, and says which dates", /disabled=\{takenBy\.has\(s\.schoolId!\)\}/.test(win) && /Already has its own window:/.test(win));
check("the form stops a second 'all schools' window before asking the database, and says what to do", /allSchoolsTaken/.test(win) && /This term already has an \\"All schools\\" window/.test(win));
check("the evaluator's term picker lists each TERM once (several windows of a term do not repeat it)", /findIndex\(x => x\.schoolYear === w\.schoolYear && x\.term === w\.term\) === i/.test(page));

console.log("\nThe certificate switch for testing");
check("the settings screen has its own 'ON/OFF for TESTING' switch, explained, shown only when the database update is installed", /Certificates are \{testing \? "ON" : "OFF"\} for TESTING/.test(cert) && /saved\.testingSupported &&/.test(cert) && /testers-only renewal window/.test(cert));
check("the testing switch is saved through its own call, only when it was changed, and the first switch is saved as before", /setCsrTesting\(testing\)/.test(cert) && /testing !== saved\.testingEnabled/.test(cert) && /saveCsrSettings\(\{/.test(cert));
check("the API has the separate call and reads the switch", /rpc\("csr_testing_switch"/.test(csr) && /testing_enabled/.test(csr) && /testingSupported/.test(csr));
check("a scholar and the evaluator are told when a certificate exists only because of the testing switch", /info\.testing &&/.test(src("src/scholar/components/dashboard/CsrDownload.tsx")) && /info\.testing &&/.test(src("src/sead/renewal/RenewalCsrSection.tsx")));

console.log("\nRevert application");
check("the evaluator sees a 'Revert application' button on a scholar's renewal (not for a removed scholar's)", /r\.stage !== "removed" && <button onClick=\{\(\) => setDialog\("revert"\)\}[^>]*>Revert application<\/button>/.test(detail) && /canAct && \(/.test(detail));
check("the dialog asks for a reason (at least 5 characters), says what is removed and that no backup is kept, and goes back to the list afterwards", /Revert this application to the start/.test(detail) && /minLength=\{5\}/.test(detail) && /No backup copy is kept, so this cannot be undone/.test(detail) && /setDialog\(null\); onChanged\(\); onBack\(\);/.test(detail));
check("it says what the database refuses (status changed, Division Head decided, approved SDP reconsideration)", /already changed the scholar's status, the Division Head decided the case, or an SDP reconsideration was approved/.test(detail));
check("the call goes through the database function, with a clear message when the update is missing", /rpc\("renewal_revert_application"/.test(api) && /Reverting is not set up yet/.test(api));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
