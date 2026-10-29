// tests/entered-grades/rotate_web_tests.mjs — turning a picture in the entered-grades review (to the left or to the right; only how it is shown)
// Run:  node tests/entered-grades/rotate_web_tests.mjs
// No database or browser needed.
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rot-"));
const outfile = path.join(tmp, "turn.mjs");
await build({ entryPoints: [path.join(root, "src/lib/pictureTurn.ts")], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error" });
const T = await import(pathToFileURL(outfile).href);
const tab = fs.readFileSync(path.join(root, "src/sead/renewal/RenewalEnteredGradesTab.tsx"), "utf8");
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

console.log("The turns");
test("a turn to the right and a turn to the left go round: 0 -> 1 -> 2 -> 3 -> 0 and back", () => {
  assert.deepEqual([0, 1, 2, 3].map(q => T.nextQuarter(q, 1)), [1, 2, 3, 0]);
  assert.deepEqual([0, 1, 2, 3].map(q => T.nextQuarter(q, -1)), [3, 0, 1, 2]);
  let q = 0; for (let i = 0; i < 4; i++) q = T.nextQuarter(q, 1); assert.equal(q, 0, "four turns bring it back");
  assert.deepEqual([0, 1, 2, 3].map(T.degreesOf), [0, 90, 180, 270]);
});
test("upright (and upside down): the picture is as wide as the box and keeps its shape", () => {
  const a = T.turnedLayout(400, 200, 300, 0), b = T.turnedLayout(400, 200, 300, 2);
  for (const l of [a, b]) { assert.equal(l.imageWidth, 300); assert.equal(l.imageHeight, 150); assert.equal(l.boxHeight, 150); assert.equal(l.left, 0); assert.equal(l.top, 0); }
  assert.equal(a.degrees, 0); assert.equal(b.degrees, 180);
});
test("a quarter turn: what is SHOWN is as wide as the box and as tall as the picture's width scaled down, so nothing spills out or is covered", () => {
  for (const q of [1, 3]) {
    const l = T.turnedLayout(400, 200, 300, q);
    assert.equal(l.imageHeight, 300, "the picture's height becomes the shown width");
    assert.equal(l.imageWidth, 600);
    assert.equal(l.boxHeight, 600, "the box is as tall as the turned picture is");
    // turned about its centre, the 600 x 300 picture covers exactly the 300 x 600 box: its centre is the centre of the box
    assert.equal(l.left + l.imageWidth / 2, 300 / 2); assert.equal(l.top + l.imageHeight / 2, l.boxHeight / 2);
    assert.equal(l.degrees, q * 90);
  }
});
test("a tall picture turned sideways becomes short; a square one keeps its size", () => {
  const tall = T.turnedLayout(200, 400, 300, 1);
  assert.equal(tall.boxHeight, 150); assert.equal(tall.imageWidth, 150); assert.equal(tall.imageHeight, 300);
  const sq = T.turnedLayout(300, 300, 300, 1); assert.equal(sq.boxHeight, 300); assert.equal(sq.left, 0); assert.equal(sq.top, 0);
});
test("an empty or unknown size never breaks the layout", () => {
  for (const q of [0, 1, 2, 3]) { const l = T.turnedLayout(0, 0, 0, q); for (const k of ["boxHeight", "imageWidth", "imageHeight", "left", "top"]) assert.ok(Number.isFinite(l[k]), `${k} at ${q}`); }
});

console.log("The screen");
test("each picture has a button to turn it to the left and one to turn it to the right, named for the picture", () => {
  assert.ok(tab.includes("Turn ${name} to the left") && tab.includes("Turn ${name} to the right") && tab.includes("RotateCcw") && tab.includes("RotateCw"));
  assert.ok(tab.includes("nextQuarter(q, -1)") && tab.includes("nextQuarter(q, 1)"));
});
test("turning only changes how the picture is shown: the file is never changed, and the full-size link still opens the original", () => {
  assert.ok(/the stored file is never changed/.test(tab));
  assert.equal(/storage\.from|\.upload\(|\.update\(/.test(tab), false, "no write of any kind in the review screen");
  assert.ok(tab.includes("Open ${name} full size") && tab.includes('target="_blank"'));
});
test("a sideways picture is laid out in a box of its own height, so it neither spills over the form nor hides behind other pictures", () => {
  assert.ok(tab.includes("turnedLayout(natural.w, natural.h, boxW, quarter)") && tab.includes("height: layout.boxHeight") && tab.includes("new ResizeObserver"));
});
console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
fs.rmSync(tmp, { recursive: true, force: true });
