# Vyact Android — working rules

Binding conventions only. History and how-tos live in the docs named below; keep this file short.

## What this repo is
The Capacitor fork that wraps the upstream web app (private `Authen27/Vyact`, `react/`) as the Android app
`com.vyact.app`. The web app is **copied in from upstream**; everything Android-specific is an overlay on top.

- **Overlay:** `native/android/**` is copied over the regenerated `android/` (never edit `android/`). A shared
  upstream file that carries an Android edit is listed under `merged` in `scripts/overlay-manifest.json` and carries an
  `ANDROID-OVERLAY` marker; a fork-only file is listed under `additive`. `scripts/check-overlay-registered.mjs` fails
  the build otherwise. **Register every new file there.**
- **Upstream sync:** `scripts/sync-from-upstream.mjs` (3-way merge against `.upstream-base/`, workflow
  `sync-upstream.yml`, manual only). Do not hand-edit upstream files outside the `merged` list.
- **Versions:** `android-version.json` is the versionName; **versionCode is chosen by the owner** per release (workflow
  input) and must exceed the last Play upload (Play Console → Releases overview). Never guess it. Toolchain pins live only
  in `android-toolchain.json`.
- **Docs:** `ANDROID-BUILD-RULES.md` (R1–R5, permanent) · `ANDROID-PUSH-SETUP.md` (push) · `PLAY-STORE.md` (store).

## Hard rules
1. Branch from `origin/main` (`git fetch && git checkout -b <name> origin/main`), never from a local HEAD. Stage files by
   name, never `git add -A` (the repo root holds untracked owner files, e.g. a store-design zip). Don't push to, or open
   PRs against, the upstream production repo without the owner's approval.
2. **Release builds obey R1–R5.** The only proof a release change is good is a green `android-release.yml` run
   (verify step **and** R8 smoke test), not a green debug build.
3. **Actions minutes are shared with the production deploys** (2,000/month). Debug APK runs only on dispatch or for
   native-code PRs; a release run costs ~30 min. Plan for ≤ 3 Android runs per piece of work, no retry loops, and put
   `[skip ci]` on docs-only commits.
4. **Play never gets SMS** (or any restricted permission). SMS detection is sideload-only and goes to App Distribution
   group `owner` only.
5. Before saying "done": `node scripts/check-overlay-registered.mjs`, `node --test scripts/*.test.mjs`,
   `npx tsc --noEmit`, `npx vitest run`, YAML-parse any workflow you touched, then the CI evidence that proves the
   change (release log line, verify step, smoke test).

## Secrets and files
| Secret | Lives in | Notes |
|---|---|---|
| `GOOGLE_SERVICES_JSON_BASE64` | GitHub Actions secret, this repo | From the owner's private copy **outside the repo** (`Downloads\vyact-firebase\`). Its presence is what builds push in. |
| `FCM_SERVICE_ACCOUNT_JSON` | Supabase Edge Function secret (project `dmxqkvploojokffuhxnz`) | The server's FCM sender. **The owner pastes it**; delete the key file afterwards. |
| `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD` | GitHub Actions secrets | Upload key. Play re-signs with its own app-signing key. |

- Never commit, print, or paste into chat a Firebase config, key, token or fingerprint-bearing keystore.
  `.gitignore` blocks `google-services.json`, `*-adminsdk-*.json`, `service-account*.json`, and the guard fails if any
  such file (or a PEM private key) is tracked.
- Anyone working here (human or agent) **never types a secret into a web field**; the owner does, or a CLI reads it
  from a file. Staging a field and putting the value on the clipboard for the owner to paste is fine; clear it after.
- Firebase config and the push plugin ship **together or not at all** (`scripts/setup-native-push.mjs` fails a plugin
  without the config, on purpose). Every Firebase artefact must come from the **same project** or FCM answers
  `SENDER_ID_MISMATCH`.

## Firebase — capability map (verified 23 Oct 2026)
Project **`vyact-20x`** (#603508456615, Spark plan, owner uday.kr27@gmail.com). Android app
`1:603508456615:android:9fd5117a65860ec436af82`, package `com.vyact.app`. Google Play is linked. SHA-1/SHA-256 of the Play
app-signing key and the upload key are registered (re-register if either key changes).

| Service | We use it for | State | Rule |
|---|---|---|---|
| **Cloud Messaging (FCM v1)** | Lock-screen alerts. Server (`web-push` Edge Function, cron every 15 min) is the **only** source on a registered phone | Server live; legacy API off; build with the secret done; phone test pending | Channel `vyact_alerts`. Never log a token. Check with read-only SQL on `push_subscriptions` (`kind = 'fcm'`), never by writing. |
| **App Distribution** | Every test build (debug, release APK, sideload) to testers | On. Groups `owner` (owner only) and `testers` (family) | SMS builds → `owner` only. Release APKs are upload-key signed: they **cannot update over a Play-installed copy** (uninstall first). |
| **Crashlytics** | Native crash reports with R8 de-obfuscation | Not yet shipped (planned) | Collection **off by default**, switch in Settings; no personal or financial data in keys, logs or messages; mapping uploaded on release builds. |
| **App Check** | Play Integrity attestation | App registered, **monitor-only**; nothing enforced | Enforcement and token sending (client SDK + `ask-vyact` gateway) is a separate upstream change that needs the owner's approval. Enabling AI Logic auto-enforced App Check **for that API only**. |
| **AI Logic** | Enabled (Gemini Developer API, free), unused; AI monitoring off | On | Pip stays on Bedrock Nova Lite. No model keys in the app. No Blaze/billing. |
| **Test Lab** | Robo runs of release candidates on a device matrix | Usable now. **Google is shutting it down on 30 Sep 2027**; the successor (Developer Device Platform) needs billing | Keep all Test Lab use in one workflow file so migration is one edit. Don't enable billing without the owner. |
| Analytics / Performance / Remote Config / Auth / Firestore | — | Not used (project has the Analytics integration on; the app ships no Analytics SDK, web GA4 is consent-first) | Don't add them without the owner. |

Play production access needs 12 opted-in closed-test testers for 14 days; App Distribution testers don't count.

## Working in the Firebase, Supabase and Play consoles
- Prefer `firebase_*` MCP tools when they are connected (check `/mcp`; they weren't in the 23 Oct session). Otherwise the
  consoles via the Chrome extension, with computer-use only for file dialogs.
- Read freely; **ask before changing** anything: project settings, tester lists, API enforcement, terms acceptance
  (the owner decides; a checkbox is never ticked silently), billing/plan (never), key creation or download (state the
  file, source and size first), repository secrets.
- Take a fresh screenshot before each click in a hidden or resized tab: coordinates move when the viewport changes.
- Verify a change by reading it back (list the secret, reopen the settings, run the read-only SQL), not by trusting a toast.
