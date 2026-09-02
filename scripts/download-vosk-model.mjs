// Downloads and prepares the Vosk English model into
// public/kauban-vosk-model/ so the offline speech recognizer
// (src/kauban/voskRecognition.ts) can self-host it instead of depending
// on an external CDN at runtime. Runs on every `npm install` (see
// package.json's "postinstall"), skipping the work if the file is
// already present — unlike copy-ffmpeg-core.mjs and copy-onnx-wasm.mjs,
// this asset isn't derived from anything already sitting in
// node_modules, so it has to come from the network once, not just be
// copied locally.
//
// Model choice: the "lgraph" variant (~130MB packaged), not the
// smaller "small" model (~40MB) used originally. The small model's
// language model is tuned for short commands/phrases — testing found
// it lost or garbled words on longer, natural sentences (10+ words).
// lgraph's much larger vocabulary/language model fixes that while
// staying small enough to self-host and load in a browser tab, unlike
// the ~1.8GB full model.
//
// vosk-browser only accepts a gzipped tar archive of the model folder
// (see its README's "Model format" section), but Alpha Cephei only
// distributes this particular model as a .zip — so unlike the old
// small model (which they publish as both .zip and .tar.gz), this one
// has to be unzipped and repackaged as .tar.gz here rather than just
// downloaded directly.
import { createWriteStream, existsSync, mkdirSync, statSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import JSZip from "jszip";
import * as tar from "tar";

const MODEL_URL = "https://alphacephei.com/vosk/models/vosk-model-en-us-0.22-lgraph.zip";
// The packaged tar.gz comes out to ~124MB — anything drastically
// smaller means a failed/partial previous attempt, not a real model.
const MIN_EXPECTED_BYTES = 100_000_000;

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const destDir = join(rootDir, "public", "kauban-vosk-model");
const destFile = join(destDir, "model.tar.gz");
const tmpZip = join(destDir, "_download.zip.tmp");
const tmpExtractDir = join(destDir, "_extract.tmp");

if (existsSync(destFile) && statSync(destFile).size > MIN_EXPECTED_BYTES) {
  console.log("Vosk model already present, skipping download.");
  process.exit(0);
}

mkdirSync(destDir, { recursive: true });

try {
  console.log(`Downloading Vosk model from ${MODEL_URL} ...`);
  const response = await fetch(MODEL_URL);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  await pipeline(response.body, createWriteStream(tmpZip));

  console.log("Unpacking model archive...");
  const zip = await JSZip.loadAsync(readFileSync(tmpZip));
  let topFolder = null;
  for (const entry of Object.values(zip.files)) {
    if (!topFolder) topFolder = entry.name.split("/")[0];
    const outPath = join(tmpExtractDir, entry.name);
    if (entry.dir) {
      mkdirSync(outPath, { recursive: true });
      continue;
    }
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, await entry.async("nodebuffer"));
  }
  if (!topFolder) throw new Error("Downloaded archive was empty");

  console.log("Repackaging as gzipped tar (the format vosk-browser requires)...");
  await tar.c({ gzip: true, file: destFile, cwd: tmpExtractDir }, [topFolder]);

  const size = statSync(destFile).size;
  if (size < MIN_EXPECTED_BYTES) {
    throw new Error(`Packaged file is only ${size} bytes — expected at least ${MIN_EXPECTED_BYTES}`);
  }
  console.log(`Vosk model ready (${size} bytes) at public/kauban-vosk-model/model.tar.gz`);
} catch (err) {
  // Best-effort cleanup so a later run doesn't mistake a partial result
  // for a complete one.
  if (existsSync(destFile)) rmSync(destFile, { force: true });
  console.warn(`Could not prepare the Vosk model (${err.message}). Offline speech recognition won't work until this succeeds — re-run "npm install" once you have a connection.`);
  process.exit(0);
} finally {
  if (existsSync(tmpZip)) rmSync(tmpZip, { force: true });
  if (existsSync(tmpExtractDir)) rmSync(tmpExtractDir, { recursive: true, force: true });
}
