# Vyact — Google Play upload playbook

Everything needed to publish the Android app. The build/signing is automated in
CI; you supply the signing secrets and the Play Console account.

---

## 0. One-time prerequisites
- A **Google Play Developer account** ($25 one-time) → https://play.google.com/console
- A **privacy policy URL** (required for a finance app). Host one on the web app,
  e.g. `https://vyact-twentyx.vercel.app/privacy`. (Must mention what data is
  collected and how to request deletion — see Data Safety below.)

## 0b. Lock-screen notifications (Firebase Cloud Messaging), once

The app can't receive web push (it is a WebView), so lock-screen notifications come through Firebase.
The server side is upstream Vyact v10.127.0: the phone registers its token, and the server sends it the
same alerts as a browser.

1. In the Firebase console, add a project (or use your Google Cloud project), then add an **Android app**
   with package name **`com.vyact.app`**. Download its `google-services.json`.
2. In this repository → Settings → Secrets and variables → Actions, add **`GOOGLE_SERVICES_JSON_BASE64`**
   (`base64 -w0 google-services.json`). With it, the build installs the push plugin and writes the file into the
   app (`scripts/setup-native-push.mjs`). Without it, the app is built without push and says lock-screen
   notifications aren't available yet. The plugin is never shipped without the file, because the app could
   crash without it.
3. In Firebase → Project settings → Service accounts, generate a private key and store it on the Vyact
   Supabase project (then delete the file):
   `supabase secrets set FCM_SERVICE_ACCOUNT_JSON="$(cat key.json)" --project-ref dmxqkvploojokffuhxnz`.
   Steps 3 and 4 are also in upstream `docs/PUSH_TROUBLESHOOTING.md`.
4. Check that **Firebase Cloud Messaging API (V1)** is enabled for the project.
5. The app turns notifications on by itself (it asks Android's permission once), and it needs the web app
   from upstream v10.127.0 or later: sync upstream first.

---

## 1. Create the signed AAB (the upload bundle)

The app uses **Play App Signing**: you upload an AAB signed with your **upload
key**; Google re-signs with the managed app-signing key. Mint the upload key once.

**Step 1 — set 3 repo secrets** (Settings → Secrets and variables → Actions):
| Secret | Value |
|---|---|
| `KEY_ALIAS` | e.g. `vyact-upload` |
| `KEYSTORE_PASSWORD` | a strong password you choose |
| `KEY_PASSWORD` | a strong password (can equal the above) |

**Step 2 — mint the keystore:** Actions → **Init upload keystore** → Run.
Download the `vyact-upload-keystore` artifact. **Save `upload.keystore` somewhere
safe and private (a password manager / secure vault) — losing it means you can't
ship updates without a Play key reset.**

**Step 3 — add the keystore secret:** open `keystore.base64.txt` from the
artifact, copy its contents into a new secret **`KEYSTORE_BASE64`**.

**Step 4 — build the signed bundle:** Actions → **Android Release AAB** → Run
(leave `versionCode` blank to use the run number). The finished run publishes
`app-release.aab` (plus the R8 `mapping.txt`) as assets of a prerelease named
`ci-<run id>` under the repo's **Releases** — GitHub's account-wide artifact
quota can be full, so the bundle no longer depends on it. Download it from there,
or: `gh release download ci-<run id> --repo Authen27/Vyact-Android`. That's your
upload file. (The `vyact-release-aab` Actions artifact is still attached when the
quota allows.) Each run deletes all but the newest four `ci-*` releases — keep a
copy of anything you want to retain.

> Versioning: `versionName` comes from `android-version.json` (currently **0.5**
> — the Android app has its own version line, independent of the React web
> app's 9.x/10.x); `versionCode` is the CI run number and always increases.

---

## 2. Create the app in Play Console
- **App name:** `Vyact — Family Finance OS`
- **Default language:** English (US)
- **App or game:** App · **Free**
- **Package name (set on first upload, permanent):** `com.vyact.app`

---

## 3. Store listing copy (ready to paste) — v0.4

**App name (≤30):** `Vyact — Family Finance OS`

**Short description (≤80):**
`Split bills with anyone, track spending & net worth — household finance, together.`

**Full description (≤4000):**
```
Vyact is the family finance OS — one calm place to see where the household's
money goes, split what's shared, and plan what comes next.

NEW: SPLIT BILLS ACROSS HOUSEHOLDS
Split a dinner, a trip, or a bill with anyone — just enter their email. They're
notified, emailed, and can settle up right from the app, even if you don't share
a household. Only your share ever touches your budget; the rest is tracked as a
clean IOU until it's settled.

WHAT YOU CAN DO
• Splits — share any expense or payout by email, see who owes what at a glance,
  and settle with one tap. Real email notifications, not just in-app alerts.
• Cash flow at a glance — income vs spending, by month and category, with a
  Family Pulse Score that tells you how you're really doing.
• Budgets that fit real life — monthly, annual and custom plans with per-category
  limits and progress.
• Net worth — assets minus liabilities, with a liquidity mix and savings ratios,
  updated live as your accounts change.
• Debt payoff — track loans and credit, see interest vs principal, and a payoff plan.
• Transactions — fast add, multi-currency, transfers and investments kept neutral
  so your spend/income numbers stay honest.
• Reports & insights — trends over day/week/month/quarter/year, plus a plain-English
  library of money lessons.
• Ask Vyact — an on-device assistant that answers questions about your own numbers.
• Built for households — multiple members, shared budgets, role-based access.

PRIVATE BY DESIGN
Your data syncs securely to your account and works offline. Security is enforced
server-side; we never sell your data.

Vyact — household finance, planned together.
```

- **App category:** Finance
- **Tags:** budgeting, split bills, personal finance, money manager, net worth
- **Contact email:** <your support email>
- **Website:** https://vyact-twentyx.vercel.app
- **Privacy policy:** https://vyact-twentyx.vercel.app/privacy

---

## 3b. "What's New" release notes (paste into the v0.4 release)

**Short version (release notes field, ≤500 chars):**
```
Split bills with anyone by email — across households, with real email
notifications and one-tap settling. Net Worth and Debts got a cleanup (no more
"owed to me" clutter — just what you own vs what you owe). Dozens of small
fit-and-finish fixes throughout. As always, only your share of a split ever
touches your budget.
```

**Longer version (blog / social / changelog post):**
```
Vyact 0.4 — Splits, done right

The headline: you can now split any bill or shared payout with ANYONE by
email — no shared household required. Add a split, enter who owes what, and
they're notified by email and in-app. They settle their share with one tap,
right from their own Vyact account (or a simple sign-up link if they're new).
Only your share ever counts toward your budget — the rest is tracked as a
clean, visible IOU until it's settled.

Also in this release:
- Net Worth and Debts are simpler — we removed "money owed to me" clutter, so
  your balance sheet reads as assets vs. what you actually owe.
- Investment accounts stay in their lane — they no longer show up where they
  don't belong, like your everyday spending or transfer pickers.
- A cleaner circular time picker, a fixed "Add Schedule" sheet, and a batch of
  fit-and-finish fixes across the app.
```

---

## 3c. "What's New" release notes — v0.5 (paste into the v0.5 release)

0.5 brings the app up to Vyact web 10.107.1 (from 10.18.1). Everything below is visible in the
app; nothing here involves SMS or any new permission.

**Short version (release notes field, ≤500 chars):**
```
A fresh look and a simpler way around: Track, Plan and Analyze tabs with a
big + to add anything, and Pip one tap away on the Ask tab. New Insights with
quick highlight cards and a library of short money lessons, a redesigned
Splits page, and a calmer dark theme by default (light is one tap away in
Settings). Plus many fit-and-finish fixes across the app.
```

**Longer version (blog / social / changelog post):**
```
Vyact 0.5 — a new look, built around how you actually use it

- Easier navigation: Track, Plan and Analyze along the bottom, a large + in
  the middle to add an expense, income, transfer or investment, and Ask Pip
  right beside them.
- Pip, your money assistant, opens from the Ask tab without leaving the page
  you're on — and now answers in the Android app (it could show "can't reach
  the assistant" before).
- Insights: "Play highlights" turns your month into a few swipeable cards, and
  Learn is a library of short, plain-English money lessons.
- Splits has a clearer net position: what you're owed, what you owe, and who.
- A calmer dark theme (Nocturne) by default; switch to light in Settings →
  Appearance.
- Many fit-and-finish fixes, including better fit on small phones and with
  the system bars.
```

---

## 4. Graphic assets (curated for v0.4)

Ready-to-upload folder: **`Downloads/vyact-v0.4-launch/`** —
`app-release.aab`, `feature-graphic.png`, `icon-512.png`, `screenshots/1-4`.

| # | Screen | Why it's here |
|---|---|---|
| 1 | Dashboard | Pulse Score + cash-flow chart — the "at a glance" hook. |
| 2 | Transactions | Real categorized activity — shows the app has substance. |
| 3 | Splits | **The v0.4 headline feature.** Empty state shown; its own on-screen copy explains the feature clearly. See note below. |
| 4 | Net Worth | Clean assets-vs-liabilities waterfall — the "grown-up" payoff screen. |

**Note on the Splits screenshot:** the automated capture ran on a fresh demo
profile with no splits created yet, so it shows the empty state (which reads
well — it explains the feature in-frame) rather than a populated "Sam owes you
$40" view. For a stronger hero shot, open the app, create one real split (e.g.
"Dinner — $120 / 3 ways"), and re-screenshot the Splits page — 30 seconds, and
it'll show real names/amounts. Swap it in via Play Console any time; it does
not require a new app release.

To regenerate all of these fresh (e.g. after creating real data): Actions →
**Play store assets** → download `vyact-play-assets`. It now also captures
`/splits` (`store-shot-3-splits.png`).

| Asset | Spec | File |
|---|---|---|
| App icon | 512×512 PNG, 32-bit | `icon-512.png` |
| Feature graphic | 1024×500 PNG | `feature-graphic.png` |
| Phone screenshots | 2–8, portrait | `screenshots/1-4` above |

(Optional but recommended: 7" and 10" tablet screenshots; also consider adding
a 5th shot of Budgets or Reports once you have richer demo data — the
first-run demo profile has budgets with no category allocations yet, so that
screen currently reads as "0% used" rather than showing real progress.)

---

## 5. Required declarations
- **Privacy policy:** the URL above (mandatory).
- **Data safety form:** declare —
  - *Financial info* (transactions, balances) — collected, **encrypted in transit**.
  - *Personal info* (email/name for sign-in) — collected.
  - *Device or other IDs*: the Firebase Cloud Messaging token, collected only to send the person's own
    notifications. Not shared, not used for ads. Declare it once lock-screen notifications ship (section 0b).
  - *App activity* (Google Analytics: the pages and features used), which is on in the app as part of its
    permissions (upstream v10.125.0).
  - Data is **not sold**; users can **request deletion** (state the path in your policy).
- **Content rating:** complete the questionnaire (finance app, no objectionable
  content → expected **Everyone**).
- **Target audience:** 18+ (avoids the families/children program requirements).
- **Ads:** declare "No ads" (the app shows none).
- **Government / financial-features declaration:** it's a personal budgeting tool,
  not a regulated banking/payments product — answer accordingly.

---

## 6. Roll out
1. **Internal testing** track first → upload `app-release.aab` → add your own
   email as a tester → install via the opt-in link and sanity-check on a device
   (especially **Google sign-in** end-to-end — see the Supabase redirect note).
2. Complete the listing + all declarations above (Play won't let you publish until
   every section is green).
3. Promote to **Closed/Open testing**, then **Production** when ready.

> Reminder: for native Google sign-in to work in the released app, add
> `vyact://auth-callback` to Supabase → Auth → URL Configuration → Redirect URLs.
