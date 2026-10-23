# Android lock-screen notifications — setup, step by step

How an alert reaches a locked Android phone, what you set up once, and how to check each link. It follows
upstream `docs/PUSH_TROUBLESHOOTING.md` (Authen27/Vyact) and the Android side merged in PR #1.

## Status — 23 Oct 2026
| # | Piece | State |
|---|-------|-------|
| 1 | Server side (upstream #231 → #240) | **Done**: merged, deployed, `web-push` v110, cron every 15 min |
| 2 | Firebase project `vyact-20x` + Android app `com.vyact.app` | **Done** (Spark plan; Play linked; 4 signing fingerprints registered) |
| 3 | `GOOGLE_SERVICES_JSON_BASE64` GitHub secret | **Done** (from `Downloads\vyact-firebase\`, outside the repo) |
| 4 | FCM API (V1) enabled · `FCM_SERVICE_ACCOUNT_JSON` Supabase secret | **Done** (V1 on, legacy off; secret set 23 Oct) |
| 5 | App synced to upstream ≥ 10.127 and built **with** the secret | **Done**: run 39898787316, versionCode 13 / 0.6, log said "built in: Firebase project vyact-20x" |
| 6 | Installed on a phone, test notification on the lock screen, `fcm` row in the database | **Pending**: needs the build on a phone (see step 7) |

## The picture

```
phone (Vyact app) ──register token──▶ Supabase  push_subscriptions (kind 'fcm')
                                         │  every 15 min: web-push function raises the alerts,
                                         ▼  then sends each unread action-required one
                 Firebase Cloud Messaging (HTTP v1)  ◀── FCM_SERVICE_ACCOUNT_JSON (Supabase secret)
                                         │
                                         ▼
          Google Play services on the phone ──▶ lock-screen notification (tap opens the alert's page)
```

- **Firebase** is the developer-side account: it issues each phone's token and signs for the sender.
- **Google Play services** is the delivery agent already on the phone; there is nothing to configure for it
  (the phone must have it — any Play Store device or the Google Play emulator image does).
- **Play Console** needs nothing for push itself, only the Data safety declaration (`PLAY-STORE.md`, 0b).

Five things must all be true, in any order, before a push can arrive:

| # | Piece | Where | Status check |
|---|-------|-------|--------------|
| 1 | Server side live (migration + `web-push` function) | upstream PRs #231 → #238 merged and deployed | step 1 |
| 2 | Firebase project with an Android app `com.vyact.app` | Firebase console | step 2 |
| 3 | `GOOGLE_SERVICES_JSON_BASE64` GitHub secret | Authen27/Vyact-Android | step 3 |
| 4 | `FCM_SERVICE_ACCOUNT_JSON` Supabase secret + FCM API (V1) enabled | Supabase / Google Cloud | steps 4–5 |
| 5 | App synced to upstream ≥ v10.127.0 and a build made **with** the secret | this repo | steps 6–7 |

## Steps

### 1. Server side (upstream, production)
Merge the upstream stack Authen27/Vyact #231 → #238 to `main` and let its Deploy run finish. It adds
`push_subscriptions.kind/fcm_token`, `register_native_push`, and the `web-push` function's FCM sender.
Check (Supabase SQL editor): `select column_name from information_schema.columns where table_name = 'push_subscriptions' and column_name = 'fcm_token';` returns one row.

### 2. Firebase project and the Android app
1. https://console.firebase.google.com → **Add project** (or pick the Google Cloud project you already use).
   Google Analytics can stay **off**; push does not need it. (`vyact-20x` has the integration switched on; the app
   has no Firebase Analytics SDK, so it receives nothing. The app's own web analytics, GA4, is separate. Leave it.)
2. Project overview → **Add app → Android**. Package name exactly **`com.vyact.app`**. Nickname: Vyact.
   Leave **SHA-1 empty**: FCM does not use it (it is for Google sign-in, which this app does through Supabase).
3. **Register app**, then **Download google-services.json**. Skip the "add the Firebase SDK" steps: the
   build does that. Click through to the console.
4. Later, the file is at Project settings (gear) → General → Your apps → `google-services.json`.

### 3. GitHub secret `GOOGLE_SERVICES_JSON_BASE64`
In Git Bash, from the folder holding the file (needs `gh auth login` once):
```bash
base64 -w0 google-services.json | gh secret set GOOGLE_SERVICES_JSON_BASE64 --repo Authen27/Vyact-Android
gh secret list --repo Authen27/Vyact-Android      # the name must be listed
```
Or in the web UI: repo → Settings → Secrets and variables → Actions → New repository secret → paste the output of
`base64 -w0 google-services.json | clip`. The file is client configuration, not a password, but keep it **out of the
repo**: put it in a private folder (`Downloads\vyact-firebase\`). `.gitignore` ignores it and
`scripts/check-overlay-registered.mjs` fails the build if it is ever tracked. (A copy at the repo root is useless anyway:
CI writes `android/app/google-services.json` itself from the secret.)

With the secret set, the build installs `@capacitor/push-notifications`, writes `google-services.json` into the
app (checking it is for `com.vyact.app`) and names the notification channel/icon/colour. Without it the app is
built without push — on purpose, because the plugin can crash the app without the file.

### 4. Make sure the FCM API (V1) is on
Firebase console → Project settings → **Cloud Messaging** tab → *Firebase Cloud Messaging API (V1)* must read
**Enabled**. If not: ⋮ → *Manage API in Google Cloud Console* → **Enable**. The *Legacy* API stays disabled; Vyact
does not use it.

### 5. Service account key → Supabase secret `FCM_SERVICE_ACCOUNT_JSON`
1. Firebase → Project settings → **Service accounts** → *Firebase Admin SDK* → **Generate new private key** →
   Generate. A JSON file downloads. **It must be from the same Firebase project as step 2** (a mismatch shows as
   `SENDER_ID_MISMATCH`).
2. Store it, easiest way — Supabase dashboard (project `dmxqkvploojokffuhxnz`) → **Edge Functions → Secrets** →
   **Add new secret** → name `FCM_SERVICE_ACCOUNT_JSON`, value = the whole contents of the JSON file → Save.
   Or with the CLI in Git Bash (after `supabase login`):
   ```bash
   supabase secrets set FCM_SERVICE_ACCOUNT_JSON="$(cat key.json)" --project-ref dmxqkvploojokffuhxnz
   ```
3. **Delete the file** (and empty the Recycle Bin). The key can send as your app; treat it like a password. If it
   ever leaks: Firebase → Service accounts → *Manage service account permissions* → delete the key, generate a new one.
   Delete it only after the phone test passes (step 7): if the pasted value was cut short you would need a new one.

   *Pasting without exposing the key:* this prints nothing and puts the key on the clipboard as one line, ready for
   Ctrl+V in the Value box (afterwards clear the clipboard with `echo -n | clip`). In Git Bash:
   ```bash
   node -e 'process.stdout.write(JSON.stringify(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))))' key.json | clip
   ```

Without this secret, phones are skipped (`fcm_not_configured`) and browsers are unaffected.

### 6. Sync the app to upstream ≥ v10.127.0
The merged Android code is inert until the web app inside it registers the phone. Run the upstream sync (it needs
read access to the private upstream, so it is done from a machine signed in to GitHub, as for 10.107.1). At that sync,
in the `notifySlice` overlay, pass each local alert through `deviceNotificationText(n, notificationPrefs)` (the
comment in the code marks the spot) so "Show details on the lock screen" applies.

### 7. Build, install, test
1. Run **Android Release AAB** (versionCode higher than the last upload). The *Lock-screen notifications (Firebase)*
   step must print `Lock-screen notifications built in: Firebase project <id>, channel vyact_alerts.`
   (a `::notice` saying "not built in" means the secret is missing).
2. Install. **Signing matters:** the release APK/AAB is signed with the *upload* key, Play re-signs with its own
   key, so a sideloaded release APK cannot update over a copy installed from Play (uninstall first; cloud data stays in
   Supabase). Routes: a Play closed-testing update (no uninstall, but Play review first), or App Distribution / the
   debug APK (Actions → **Android Debug APK** → Run workflow; it no longer runs by itself after a sync) after
   uninstalling. On first start Android asks **Allow Vyact to send you
   notifications?** → Allow (Android 13+; the app asks once).
3. Settings → Notifications → **Send a test notification**. Swipe the app away first: it must arrive on the lock
   screen with the app closed. Real alerts follow the server's 15-minute cycle.

### 8. Check each link from the server (read-only SQL, production)
Use queries 1–5 in upstream `docs/PUSH_TROUBLESHOOTING.md`. The Android-specific readings:

| You see | Meaning | Fix |
|---|---|---|
| No `kind = 'fcm'` row for your email (query 1) | The phone never registered: permission refused, or the build has no push plugin | Allow notifications; check step 7.1's log line; Settings → "Turn on phone notifications" |
| `fcm_not_configured` (query 5) | `FCM_SERVICE_ACCOUNT_JSON` missing or not a service account | Step 5 |
| `fcm_auth` status 0 (query 2) | Google refused the service account | Wrong/rotated key, FCM API V1 off (step 4), or the key's project ≠ the app's |
| 404 `UNREGISTERED` | The phone's token is gone (app reinstalled/data cleared) | Open the app: it registers again |
| `SENDER_ID_MISMATCH` | `google-services.json` and the service account come from different Firebase projects | Redo step 2 or 5 with one project |
| 200 accepted, nothing on the phone | Android is hiding it | Android Settings → Apps → Vyact → Notifications on (channel "Alerts" on); Battery → Unrestricted; Do Not Disturb off |
| Nothing for an alert in the bell | Only action-required alerts push: bills awaiting approval, budgets at 80%/100%, loan payments due, balances to check. Quiet hours 22:00–07:00; already-read alerts are not pushed | By design |

### Turning it off
Remove the GitHub secret (the next build ships without the plugin) · Settings → Notifications (per phone) · delete the
Supabase secret (phones are skipped, browsers unaffected).
