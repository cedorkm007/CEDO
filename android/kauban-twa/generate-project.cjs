// One-off script: builds a TwaManifest from Kauban's deployed web manifest
// and generates the Android/Gradle project from it, without going through
// `bubblewrap init`'s interactive prompts (its "display mode"/"orientation"
// choices are real inquirer `list` prompts, which don't behave reliably
// over non-TTY piped stdin in this environment).
const path = require("path");
const { TwaManifest, TwaGenerator, ConsoleLog } = require("@bubblewrap/core");

const MANIFEST_URL = "https://cedo-ten.vercel.app/kauban-manifest.webmanifest";
const TARGET_DIR = __dirname;

async function main() {
  const twaManifest = await TwaManifest.fromWebManifest(MANIFEST_URL);

  twaManifest.packageId = "com.cedo.kauban";
  // Matches the alias used when pre-generating android.keystore via keytool
  // (default from bubblewrap itself would be "android" — overridden here
  // so the existing keystore file is reused as-is instead of triggering
  // Bubblewrap's interactive keystore-creation flow).
  twaManifest.signingKey.alias = "kauban";
  twaManifest.signingKey.path = path.join(TARGET_DIR, "android.keystore");

  await twaManifest.saveToFile(path.join(TARGET_DIR, "twa-manifest.json"));

  const twaGenerator = new TwaGenerator();
  const log = new ConsoleLog("Generating TWA");
  await twaGenerator.createTwaProject(TARGET_DIR, twaManifest, log, () => {});

  console.log("Project generated at", TARGET_DIR);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
