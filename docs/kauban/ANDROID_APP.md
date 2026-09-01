# Kauban Android App (TWA)

`android/kauban-twa/` is a Trusted Web Activity (TWA) wrapper around the
deployed Kauban PWA (`https://cedo-ten.vercel.app/kauban`), generated with
[Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap). It's a thin
native shell — an Android `WebView`-like activity pointed at the live site —
not a reimplementation. Any change to Kauban itself happens in `src/kauban/`
as usual and ships instantly on the web; this wrapper only needs rebuilding
when the *app identity* changes (icon, name, colors, version).

- **Package ID**: `com.cedo.kauban` — permanent once published to the Play
  Store, chosen deliberately up front.
- **Signing key**: `android/kauban-twa/android.keystore` (gitignored, alias
  `kauban`). **This file is not backed up anywhere except wherever you copy
  it.** Losing it means you can never publish an update to the same Play
  Store listing again — you'd have to publish as a brand-new app. Copy it
  somewhere durable (password manager, secure cloud storage) before doing
  anything else with this project.

## Rebuilding

The project already exists with all config in place
(`twa-manifest.json`). To produce a fresh signed APK + AAB after changing the
manifest, icons, or version:

```bash
cd android/kauban-twa
export JAVA_HOME="C:\bwjdk17"
export ANDROID_HOME="C:\bwsdk"
export JDK_JAVA_OPTIONS="-Djdk.net.unixdomain.tmpdir=C:/afutmp"
./gradlew.bat assembleRelease bundleRelease --stacktrace
```

Then sign both outputs (Gradle's own release tasks produce **unsigned**
artifacts — signing is a separate step, matching what `bubblewrap build`
would do internally):

```bash
# APK: zipalign (already aligned by modern AGP, this just verifies) + apksigner
"C:/bwsdk/build-tools/36.1.0/zipalign.exe" -v -c -p 4 app/build/outputs/apk/release/app-release-unsigned.apk
"C:\bwjdk17\bin\java.exe" -Xmx1024M -Xss1m -jar "C:/bwsdk/build-tools/36.1.0/lib/apksigner.jar" sign \
  --ks android.keystore --ks-key-alias kauban \
  --ks-pass pass:<PASSWORD> --key-pass pass:<PASSWORD> \
  --out app-release-signed.apk app/build/outputs/apk/release/app-release-unsigned.apk

# AAB (for Play Store upload): jarsigner
"C:\bwjdk17\bin\jarsigner.exe" -verbose -sigalg SHA256withRSA -digestalg SHA-256 \
  -keystore android.keystore app/build/outputs/bundle/release/app-release.aab kauban \
  -storepass <PASSWORD> -keypass <PASSWORD> -signedjar app-release-bundle.aab
```

- **`app-release-signed.apk`** — installable directly (sideloading, direct
  distribution to testers).
- **`app-release-bundle.aab`** — upload this one to Google Play Console; the
  Play Store requires App Bundles, not raw APKs, for new listings.

## Environment setup (already done once on this machine)

Bubblewrap needs a JDK + Android SDK. Its own interactive first-run wizard
doesn't work reliably in a non-interactive/scripted shell (its Android-SDK
license prompt and `bubblewrap init`'s display-mode/orientation prompts are
real `inquirer` list-selects, which don't behave over piped non-TTY stdin) —
so both were installed manually instead:

- **JDK 17**: downloaded by Bubblewrap itself into
  `~/.bubblewrap/jdk/jdk-17.0.11+9`, exposed at the short junction path
  `C:\bwjdk17` (see "Windows path-with-spaces issues" below for why).
- **Android SDK**: command-line tools downloaded directly from
  `https://dl.google.com/android/repository/commandlinetools-win-6609375_latest.zip`
  (the exact URL Bubblewrap's own installer uses — see
  `AndroidSdkToolsInstaller.js` in `@bubblewrap/cli`), extracted to
  `~/.bubblewrap/android_sdk/`, exposed at `C:\bwsdk`. Licenses accepted via
  the standard `yes | sdkmanager.bat --licenses` idiom (this works fine for
  `sdkmanager` itself — it's specifically Bubblewrap's own wrapper prompts
  that don't handle piped stdin). Packages installed: `platform-tools`,
  `platforms;android-36`, `build-tools;36.1.0` (compileSdk 36 per Bubblewrap's
  own template project). `build-tools;35.0.0` also gets auto-installed by
  Gradle/AGP the first time a build runs, via a license already accepted.
- `~/.bubblewrap/config.json` points at both: `{"jdkPath":"C:\\bwjdk17",
  "androidSdkPath":"C:\\bwsdk"}`.

### Windows path-with-spaces issues

This machine's user profile is `C:\Users\Julius Jay\...` — the space in
"Julius Jay" broke Android's `sdkmanager.bat` outright (`'C:\Users\Julius'
is not recognized as an internal or external command`, since the batch
script doesn't quote `%JAVA_HOME%` internally before invoking it). Fixed by
creating short, space-free junctions once:

```powershell
New-Item -ItemType Junction -Path "C:\bwjdk17" -Target "C:\Users\Julius Jay\.bubblewrap\jdk\jdk-17.0.11+9"
New-Item -ItemType Junction -Path "C:\bwsdk" -Target "C:\Users\Julius Jay\.bubblewrap\android_sdk"
```

Always use `C:\bwjdk17` / `C:\bwsdk` (not the real `Julius Jay` paths) for
`JAVA_HOME` / `ANDROID_HOME` when running any Android tooling here.

### The Gradle "Unable to establish loopback connection" issue

Even with both junctions in place, `gradlew.bat` failed with
`java.io.IOException: Unable to establish loopback connection` from deep
inside `sun.nio.ch.WEPollSelectorImpl` / `UnixDomainSockets.connect`. This
is **not** a network/firewall/sandbox restriction — plain TCP loopback
sockets work fine; it's specifically this JDK's `Selector.open()`, which
internally creates an AF_UNIX domain socket file for its self-pipe
mechanism. The socket file gets created under `java.io.tmpdir`, which
defaults to `C:\Users\Julius Jay\AppData\Local\Temp\...` — the same
space-in-path problem, this time breaking a Windows AF_UNIX socket bind
rather than a batch script.

Fix: point Java's AF_UNIX socket directory at a space-free path via the
`jdk.net.unixdomain.tmpdir` system property. Getting this property to reach
every JVM Gradle spawns (the wrapper bootstrap, *and* the separate
single-use-daemon JVM it forks for the actual build — these are different
processes with different option-passing paths) took a few attempts:
- `JAVA_OPTS=` / `GRADLE_OPTS=` (read by `gradlew.bat` itself per its own
  source) only reached the wrapper bootstrap JVM, not the daemon it forks.
- `org.gradle.jvmargs=` in `gradle.properties` (the standard place for this)
  didn't reach the forked single-use daemon either in this setup.
- `_JAVA_OPTS` (the legacy universal JVM env var) was silently ignored
  entirely by this JDK build for this property — verified directly with a
  throwaway `Selector.open()` test program; no `"Picked up _JAVA_OPTS"`
  message ever appeared.
- **`JDK_JAVA_OPTIONS`** (JDK 9+'s standard-supported options-file env var)
  is the one that actually worked reliably end-to-end — every JVM in the
  chain reads it directly at startup, confirmed by the
  `"NOTE: Picked up JDK_JAVA_OPTIONS: ..."` message appearing before every
  successful build.

`C:\afutmp` is the plain empty directory this points at
(`mkdir C:\afutmp` if it's ever missing). Always export
`JDK_JAVA_OPTIONS="-Djdk.net.unixdomain.tmpdir=C:/afutmp"` (forward slashes —
backslashes get mangled crossing the Git Bash → Windows env var boundary)
before running `gradlew.bat` on this machine.

### Bypassing `bubblewrap init`/`build` directly

Given the interactive-prompt and Windows-path issues above, the project was
generated and built by calling `@bubblewrap/core`'s own APIs directly
instead of the `bubblewrap` CLI's `init`/`build` commands:
- `TwaManifest.fromWebManifest(url)` + `TwaGenerator.createTwaProject(...)`
  — see `android/kauban-twa/generate-project.cjs` (kept in the project for
  reference; safe to re-run if the project ever needs regenerating from
  scratch, though it will need `packageId`/`signingKey.alias` re-applied the
  same way).
- `manifest-checksum.txt` was computed manually (sha1 of `twa-manifest.json`)
  to skip `bubblewrap build`'s "did the manifest change?" confirm prompt.
- `gradlew.bat assembleRelease bundleRelease` was run directly rather than
  via `bubblewrap build`, because Bubblewrap's own `GradleWrapper` class
  invokes `gradlew.bat` as a bare filename via Node's `execFile` with
  `shell: true`, which reliably failed with `'gradlew.bat' is not
  recognized as an internal or external command` in this environment even
  though running it directly (`./gradlew.bat`) always worked fine.
- Signing was replicated manually from `@bubblewrap/cli`'s own `build.js`
  (`apksigner.jar` invoked directly via `java -jar` for the APK — Bubblewrap
  does this too, deliberately avoiding `apksigner.bat` due to a known
  Windows `find_java.bat` bug — and `jarsigner` for the AAB).

None of this affects the *output* — the generated project and signed
artifacts are exactly what `bubblewrap init`/`build` would have produced;
only the invocation path around known rough edges in this specific
Windows + Git Bash environment differs.
