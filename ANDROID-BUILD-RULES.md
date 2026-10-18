# Android build rules (permanent)

Standing rules for every Android **release** build (the Play bundle, `android-release.yml`). They come from
Play Console's "R8 configuration" panel for `com.vyact.app`. Each rule is applied by a script **and** proven
from the build's own output, so a bundle that breaks one cannot be produced quietly.

| # | Rule | Applied by | Proven by |
|---|------|-----------|-----------|
| **R1** | **R8 full mode, optimising.** Release uses `proguard-android-optimize.txt`. (Capacitor's template ships `proguard-android.txt`, whose `-dontoptimize` turns optimisation *off* — full mode would be in name only.) Never set `android.enableR8.fullMode=false`. | `scripts/patch-build-gradle.mjs` | `verify-android-r8.mjs`: `mapping.txt` exists, no `-dontoptimize` in R8's merged `configuration.txt` |
| **R2** | **Resource shrinking** — `shrinkResources true`. | `patch-build-gradle.mjs` | `verify-android-r8.mjs` |
| **R3** | **Optimised resource shrinking** — `android.r8.optimizedResourceShrinking=true` in `gradle.properties`. | `patch-build-gradle.mjs` | `verify-android-r8.mjs` |
| **R4** | **Repackage classes** — `-repackageclasses ''` (with `-allowaccessmodification`). Classes the manifest or Capacitor's bridge look up by name are `-keep`ed and so keep their package. | `native/android/app/proguard-rules.pro` | `verify-android-r8.mjs`: `-repackageclasses` is in R8's merged configuration |
| **R5** | **Current toolchain** — Android Gradle Plugin 9.0+ with the Gradle it needs (Play: "Upgrade to AGP 9.0 to get the best performance"). Versions live in `android-toolchain.json`; change them there only. | `patch-build-gradle.mjs` (root `build.gradle`, Gradle wrapper) | `verify-android-r8.mjs`: the AGP/Gradle in the generated project are the ones in the file |

Debug builds (`android-apk.yml`) are **not** minified on purpose — they stay fast for the emulator pipelines.

## How they are enforced

1. `scripts/check-overlay-registered.mjs` (first step of both workflows, a few seconds): fails if the rule
   text disappears from `patch-build-gradle.mjs`, `proguard-rules.pro` or `android-release.yml`, or if
   `android-toolchain.json` is below AGP 9 without a written `"blocked"` reason.
2. `android-release.yml`: *Apply the permanent release rules* → build → *Verify the permanent release rules
   took effect* (hard fail) → the **R8 smoke test**, which boots the minified build on an emulator and checks
   the Capacitor plugin bridge still works. R4 and R5 change what R8 and Gradle do, so a green smoke test is
   part of the rule, not an extra.

## Changing a rule

- A rule can't be dropped silently. To defer one (for example AGP 9 while a Capacitor plugin doesn't build
  with it), add `"blocked": "<why, and what unblocks it>"` to `android-toolchain.json`, and state it in the
  release notes you give the owner. Remove the field when the blocker is gone.
- Keeping a keep-rule in `proguard-rules.pro` for anything R8 must not rename or strip is **not** a rule
  change. Adding `-dontoptimize`, `-dontshrink`, `-dontobfuscate` or turning `shrinkResources` off is.
- After any change here, the only acceptable proof is a green `android-release.yml` run (verify step **and**
  R8 smoke test) — not a green debug build.
