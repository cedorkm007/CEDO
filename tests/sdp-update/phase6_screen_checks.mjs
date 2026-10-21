// tests/sdp-update/phase6_screen_checks.mjs — what the Phase 6 screens and functions must do (reads the source files, no browser needed).
// Run:  node tests/sdp-update/phase6_screen_checks.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const read = f => fs.readFileSync(f, "utf8");
const app = read("src/app/App.tsx"), scholarPortal = read("src/scholar/pages/ScholarPortalPage.tsx"), schoolSite = read("src/school/SchoolSiteApp.tsx");

console.log("\nThe website's password rules agree with the server's");
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "p6-screen-"));
const load = async (entry, name) => { const outfile = path.join(outDir, name + ".mjs"); await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error" }); return import(pathToFileURL(outfile).href); };
const server = await load("supabase/functions/_shared/passwordPolicy.ts", "server"), client = await load("src/lib/passwordPolicy.ts", "client");
const samples = ["", "short", "abcdefghij", "1234567890", "password123", "Password123", "Qwerty12345!", "Tidepool-Lantern-47", "a".repeat(80), "A1b2C3d4E5f6", "juan.delacruz1", "JUANDELACRUZ2026", "Same-As-Old-77", "TEST-0001-xyz", "   spaced out pass 1 ", "Ünïcödé-Pässwörd-9", "aaaaaaaaaaaa", "abcabcabcabc1", "Zq8!"];
const contexts = [{}, { avoid: ["juan.delacruz", "Juan"] }, { avoid: ["TEST-0001"] }, { differentFrom: ["Same-As-Old-77"] }, { avoid: ["delacruz"], differentFrom: ["Password123"] }];
let disagreements = 0;
for (const s of samples) for (const c of contexts) if ((server.validateNewPassword(s, c) ?? null) !== (client.validateNewPassword(s, c) ?? null)) { disagreements++; console.log(`     differs for ${JSON.stringify(s)} ${JSON.stringify(c)}: server=${server.validateNewPassword(s, c)} client=${client.validateNewPassword(s, c)}`); }
check(`the same ${samples.length * contexts.length} password/situation pairs get the same answer on the website and on the server`, disagreements === 0);
check("the same minimum length (10) on both", server.PASSWORD_MIN === 10 && client.PASSWORD_MIN === 10);
check("every temporary password the server makes passes the website's rules", Array.from({ length: 300 }, () => server.generateTemporaryPassword()).every(p => client.validateNewPassword(p) === null));

console.log("\n“Choose your own password” appears before anything else, on all three sites");
check("staff site: asked after sign-in, and the screen replaces the app until a password is chosen", /usePasswordChangeRequired\(currentUser\?\.id\)/.test(app) && /if\(passwordGate\.required\)\{\s*return <ForcePasswordChange/.test(app));
check("scholar portal: same", /usePasswordChangeRequired\(profile\?\.id\)/.test(scholarPortal) && /passwordGate\.required\) \{\s*return <ForcePasswordChange/.test(scholarPortal));
check("school site: same", /usePasswordChangeRequired\(view === "portal" \? "school" : null\)/.test(schoolSite) && /passwordGate\.required\) \{\s*return <ForcePasswordChange/.test(schoolSite));
const force = read("src/app/components/ForcePasswordChange.tsx");
check("the screen offers sign out, shows a live checklist, and never lets the new password skip the rules", /onSignOut/.test(force) && /passwordChecklist/.test(force) && /finishForcedPasswordChange/.test(force));
check("changing your password anywhere on the website now needs 10 characters (staff, school and scholar)", /validateNewPassword\(newPassword/.test(app) && /validateNewPassword/.test(read("src/school/schoolApi.ts")) && /validateNewPassword|PASSWORD_MIN/.test(read("src/scholar/scholarApi.ts")));
check("no screen tells anyone about a fixed password (123456 and “default password”) any more", ![app, scholarPortal, schoolSite, read("src/sead/pages/ScholarsTab.tsx"), read("src/sead/components/AddScholarModal.tsx"), read("src/itadmin/StaffAccountsPage.tsx"), read("src/itadmin/SchoolAccountsPage.tsx"), read("src/scholar/components/ScholarPasswordResetRequestModal.tsx")].some(t => /123456|[Dd]efault password/.test(t.replace(/placeholder="[^"]*"/g, ""))));

console.log("\nTemporary passwords are shown once to the administrator");
const notice = read("src/app/components/TemporaryPasswordNotice.tsx");
check("the notice says it is shown only once and offers copy; a list can be downloaded", /shown only once/.test(notice) && /clipboard/.test(notice) && /Download the list/.test(notice));
for (const [file, label] of [["src/itadmin/StaffAccountsPage.tsx", "staff accounts"], ["src/itadmin/SchoolAccountsPage.tsx", "school accounts"], ["src/sead/pages/ScholarsTab.tsx", "scholars (reset one / reset all)"], ["src/sead/components/AddScholarModal.tsx", "adding a scholar"]])
  check(`${label}: the temporary password goes to the one-time notice`, /<TemporaryPasswordNotice/.test(read(file)));
check("administrators no longer type a password for a new school account", !/<label[^>]*>Password<\/label>/.test(read("src/itadmin/SchoolAccountsPage.tsx")) && !/createSchoolAccount\([^)]*password/.test(read("src/itadmin/SchoolAccountsPage.tsx")));
check("“Reset all” keeps every new password in memory only (never stored) and offers one downloadable list", /credentials/.test(read("src/sead/seadApi.ts")) && /Temporary passwords for all scholars/.test(read("src/sead/pages/ScholarsTab.tsx")) && !/localStorage|sessionStorage/.test(notice));

console.log("\nSign-in answers the same way for a wrong name and a wrong password");
check("staff sign-in: a name that does not exist says “Incorrect username or password.” and a rate-limit says to wait", /Incorrect username or password\./.test(app) && /Too many attempts\. Please wait a few minutes/.test(app));
check("school sign-in: the “couldn't find a school account” wording is gone", !/couldn't find a school account/.test(read("src/school/schoolApi.ts")));
check("scholar sign-in: no message reveals whether the Scholar ID exists", !/(No scholar|not found|doesn't exist|does not exist)/i.test(read("src/scholar/scholarApi.ts").slice(read("src/scholar/scholarApi.ts").indexOf("signInScholar"), read("src/scholar/scholarApi.ts").indexOf("signInScholar") + 2500)));

console.log("\nTwo-step sign-in for the IT administrator");
check("sign-in asks for the 6-digit code when the account has an authenticator app, and cancelling signs out", /getAuthenticatorAssuranceLevel/.test(app) && /<TwoStepCodeEntry/.test(app) && /signOut\(\)/.test(read("src/app/components/TwoStepCodeEntry.tsx") + app));
check("the IT administrator can set it up (QR code + confirm with a code) and turn it off, on the Accounts page", /mfa\.enroll/.test(read("src/itadmin/TwoStepSetup.tsx")) && /mfa\.unenroll/.test(read("src/itadmin/TwoStepSetup.tsx")) && /<TwoStepSetup/.test(read("src/itadmin/AccountsPage.tsx")));
const verify = read("supabase/functions/_shared/verifyItAdmin.ts");
check("the account functions refuse a session that did not pass the code once an authenticator app is set up", /aal2/.test(verify) && /Two-step sign-in is required/.test(verify));

console.log("\nThe server functions");
for (const fn of ["it-create-staff-account", "it-create-school-account", "sead-create-scholar-account", "sead-bulk-create-scholars"])
  check(`${fn}: the new account gets a random temporary password and is marked`, /generateTemporaryPassword\(\)/.test(read(`supabase/functions/${fn}/index.ts`)) && /markMustChangePassword/.test(read(`supabase/functions/${fn}/index.ts`)));
for (const fn of ["it-reset-staff-password", "it-reset-school-password", "sead-reset-scholar-password", "sead-reset-all-scholar-passwords"])
  check(`${fn}: a reset gives a random temporary password and marks it`, /issueTemporaryPassword/.test(read(`supabase/functions/${fn}/index.ts`)));
const every = fs.readdirSync("supabase/functions").filter(d => fs.existsSync(`supabase/functions/${d}/index.ts`));
check("no function still sets the fixed password “123456” or a shared default", !every.some(d => /["'`]123456["'`]|DEFAULT_PASSWORD|defaultPassword\s*=\s*["'`]/.test(read(`supabase/functions/${d}/index.ts`))));
check("the scholar self-reset function takes the new password from the scholar and never returns a password", /newPassword/.test(read("supabase/functions/scholar-self-reset-password/index.ts")) && !/password:\s*["'`]/.test(read("supabase/functions/scholar-self-reset-password/index.ts")));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
