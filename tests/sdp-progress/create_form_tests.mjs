// tests/sdp-progress/create_form_tests.mjs — attaching Progress Monitoring when an SDP activity is CREATED (New Approved Activity form).   Run:  node tests/sdp-progress/create_form_tests.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };
const src = f => fs.readFileSync(f, "utf8").split("\r\n").join("\n");
const tab = src("src/sead/pages/SDPMonitoringTab.tsx");
const start = tab.indexOf("function NewActivityModal");
const form = tab.slice(start, tab.indexOf(String.fromCharCode(10) + "function ", start + 30));
const scholar = src("src/scholar/components/dashboard/SDPPanel.tsx");

console.log("The New Approved Activity form");
test("it has an option 'Include Progress Monitoring (attendance by picture)' next to the QR attendance option", () => {
  assert.ok(form.includes("Include Progress Monitoring (attendance by picture)") && form.includes("Include attendance monitoring (QR / code)"));
});
test("an activity uses ONE way of confirming attendance: ticking one unticks the other", () => {
  assert.ok(/setProgressEnabled\(e\.target\.checked\); if \(e\.target\.checked\) setAttendanceEnabled\(false\)/.test(form));
  assert.ok(/setAttendanceEnabled\(e\.target\.checked\); if \(e\.target\.checked\) setProgressEnabled\(false\)/.test(form));
});
test("after the activity is created, progress monitoring is attached to it", () => {
  assert.ok(/if \(progressEnabled\) \{\s+const pr = await enableProgress\(result\.id\)/.test(form));
  assert.ok(tab.includes('import { fetchProgressEnabled, enableProgress } from "../progressMonitorApi"'));
});
test("if attaching fails the activity is kept (no duplicate on a second press) and the message says where to attach it later", () => {
  assert.ok(/progress monitoring could not be attached/.test(form) && /setCreatedWithoutPubmat\(true\); onCreated\(\);/.test(form) && /Progress Monitoring tab/.test(form));
});
test("the category is already required before creating, which attaching needs", () => {
  assert.ok(/if \(!category\) \{ setError\("Choose which SDP category/.test(form));
});
test("an existing activity can still have it attached in its Progress Monitoring tab", () => {
  assert.ok(tab.includes('{tab === "progress" && <ProgressAttachSection activity={activity} />}'));
});

console.log("\nThe scholar's side");
test("a scholar sees 'Capture a Picture' when the activity has progress monitoring attached", () => {
  assert.ok(scholar.includes("progress?.enabled &&") && scholar.includes("Capture a Picture") && scholar.includes("progressIds.has("));
});
test("on a small phone the activity window scrolls between the title and Close, so Capture a Picture can always be reached", () => {
  assert.ok(scholar.includes("max-h-[calc(100dvh-2rem)]") && scholar.includes('data-testid="activity-detail-scroll"'));
  const scrollStart = scholar.indexOf("activity-detail-scroll"), capture = scholar.indexOf("<ProgressSection ended={pictureTimeOver(activity)}"), closeBtn = scholar.indexOf(">Close</button>", capture);
  assert.ok(scrollStart > 0 && capture > scrollStart && closeBtn > capture, "the picture part sits inside the scrolling area, above the Close button");
});
console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
