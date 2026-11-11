// tests/sdp-progress/edit_form_tests.mjs — Progress Monitoring can be attached to (or taken off) an EXISTING SDP activity from its edit form (5 checks, short on purpose)
// Run:  node tests/sdp-progress/edit_form_tests.mjs     (no database or browser needed)
import fs from "node:fs";
const src = rel => fs.readFileSync(rel, "utf8").split("\r\n").join("\n");
let passed = 0;
const check = (name, ok) => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { process.exitCode = 1; console.log(`  FAIL ${name}`); } };
const tab = src("src/sead/pages/SDPMonitoringTab.tsx");
const modal = tab.slice(tab.indexOf("const [progressSaved, setProgressSaved]"), tab.indexOf("async function handleDelete()"));
const form = tab.slice(tab.indexOf("{progressSaved !== undefined && progressSaved !== null && ("), tab.indexOf("<MonitorsSection activityType=\"sdp\" activityId={activity.id} />"));

check("1 the activity's edit form has the 'Include Progress Monitoring (attendance by picture)' tick box, like the create form, ticked when it is already attached", form.includes("Include Progress Monitoring (attendance by picture)") && form.includes("checked={progressWant}") && modal.includes("setProgressWant(!!e)"));
check("2 it reads the activity's current state when the form opens (attached? QR attached?), and hides itself only when the database update was not run", modal.includes("fetchProgressEnabled(activity.id)") && modal.includes("fetchHasQrAttendance(activity.id)") && form.includes("progressSaved !== null"));
check("3 pressing Save Changes attaches it when it was ticked and takes it off when it was unticked, and only when the tick was CHANGED (an unrelated edit never touches it)", modal.includes("progressWant !== progressSaved") && modal.includes("enableProgress(activity.id)") && modal.includes("disableProgress(activity.id)"));
check("4 with QR attendance already attached the tick box is disabled and says why (an activity uses one way of confirming attendance)", form.includes("disabled={hasQr && !progressSaved}") && form.includes("QR attendance is already attached to this activity, so progress monitoring cannot be attached too"));
check("5 the activity itself is saved first; if attaching fails (for example waiting pictures) the message says the activity WAS saved and what could not be done, and the form stays open", modal.indexOf("updateSDPActivity(activity.id") < modal.indexOf("enableProgress(activity.id)") && modal.includes("The activity was saved, but progress monitoring could not be"));
console.log(`\n${passed} passed`);
