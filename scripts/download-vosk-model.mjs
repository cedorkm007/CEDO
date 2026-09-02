// Downloads the Vosk small English model into public/kauban-vosk-model/
// so the offline speech recognizer (src/kauban/voskRecognition.ts) can
// self-host it instead of depending on an external CDN at runtime. Runs
// on every `npm install` (see package.json's "postinstall"), skipping the
// download if the file is already present — unlike copy-ffmpeg-core.mjs
// and copy-onnx-wasm.mjs, this asset isn't derived from anything already
// sitting in node_modules, so it has to come from the network once, not
// just be copied locally.
import { createWriteStream, existsSync, mkdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";

const MODEL_URL = "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.tar.gz";
// The real file is ~41MB — treat anything drastically smaller as a failed
// or partial previous download rather than trusting it blindly.
const MIN_EXPECTED_BYTES = 30_000_000;

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const destDir = join(rootDir, "public", "kauban-vosk-model");
const destFile = join(destDir, "model.tar.gz");

if (existsSync(destFile) && statSync(destFile).size > MIN_EXPECTED_BYTES) {
  console.log("Vosk model already present, skipping download.");
  process.exit(0);
}

mkdirSync(destDir, { recursive: true });
console.log(`Downloading Vosk model from ${MODEL_URL} ...`);

try {
  const response = await fetch(MODEL_URL);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  await pipeline(response.body, createWriteStream(destFile));
  const size = statSync(destFile).size;
  if (size < MIN_EXPECTED_BYTES) {
    throw new Error(`Downloaded file is only ${size} bytes — expected at least ${MIN_EXPECTED_BYTES}`);
  }
  console.log(`Vosk model downloaded (${size} bytes) to public/kauban-vosk-model/model.tar.gz`);
} catch (err) {
  // Best-effort cleanup of a partial file so a later run doesn't mistake
  // it for a complete one.
  if (existsSync(destFile)) unlinkSync(destFile);
  console.warn(`Could not download the Vosk model (${err.message}). Offline speech recognition won't work until this succeeds — re-run "npm install" once you have a connection.`);
  process.exit(0);
}
