// tests/notifications-clear/web_tests.mjs — "Clear all" on the staff My Notifications page (only how it is wired)
// Run:  node tests/notifications-clear/web_tests.mjs        No database or browser needed.
import assert from "node:assert/strict";
import fs from "node:fs";
const app = fs.readFileSync("src/app/App.tsx", "utf8").split("\r\n").join("\n");
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };
const s0 = app.indexOf("function StaffNotificationsPage"), page = app.slice(s0, app.indexOf("\nfunction ", s0 + 20));

test("the page has a Clear all button, shown only when there is something to clear", () => {
  assert.ok(page.includes("{myNotifs.length > 0 && (") && page.includes("<Trash2 size={14}/> Clear all"));
});
test("it asks first, says how many, says it cannot be undone, and Cancel does nothing", () => {
  assert.ok(page.includes("confirmingClear") && page.includes("Clear all {myNotifs.length} notification") && page.includes("This cannot be undone") && page.includes("onClick={() => setConfirmingClear(false)}"));
});
test("on the staff page it clears exactly the notifications the page lists for this person (not other people's)", () => {
  assert.ok(page.includes("onClearAll(myNotifs.map(n => n.id))") && /\.filter\(n => \(n\.type === "submission"[^]*?n\.userId === userId\)/.test(page));
});
const admin = app.slice(app.indexOf("function AdminNotificationsPage"), s0);
test("the ADMIN Notifications page has Clear all too, shown only when something can be cleared", () => {
  assert.ok(admin.includes("{clearable.length > 0 && (") && admin.includes("<Trash2 size={14}/> Clear all") && admin.includes("onClearAll: (ids: string[]) => Promise<void>;"));
});
test("it keeps what still waits for the admin's decision (a pending submission or leave request): only the other notifications are cleared, and the dialog says how many stay", () => {
  assert.ok(admin.includes('const waiting = (n: AppNotification) => (n.type==="submission" || n.type==="leave_request") && getStatusForNotif(n)==="pending";')
    && admin.includes("const clearable = notifications.filter(n => !waiting(n));") && admin.includes("onClearAll(clearable.map(n => n.id))") && /still wait/.test(admin) && admin.includes("This cannot be undone"));
});
test("the handler removes them from the screen, then deletes only those ids in groups of 100; one failure does not stop the rest", () => {
  const h = app.slice(app.indexOf("async function handleClearNotifications"), app.indexOf("// ── Render ──"));
  assert.ok(h.includes("setNotifications(p => p.filter(n => !gone.has(n.id)))") && h.includes(".delete().in(\"id\", ids.slice(i, i + 100))") && h.includes("console.error(\"Clear notifications failed:\""));
  assert.equal(/\.delete\(\)\s*;|\.delete\(\)\.neq|\.delete\(\)\.gt/.test(h), false, "never a delete without an id filter");
});
test("both pages are given the handler", () => {
  assert.equal((app.match(/onClearAll=\{handleClearNotifications\}/g) ?? []).length, 2);
});
console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
