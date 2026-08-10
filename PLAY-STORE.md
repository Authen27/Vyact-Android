# Vyact — Google Play upload playbook

Everything needed to publish the Android app. The build/signing is automated in
CI; you supply the signing secrets and the Play Console account.

---

## 0. One-time prerequisites
- A **Google Play Developer account** ($25 one-time) → https://play.google.com/console
- A **privacy policy URL** (required for a finance app). Host one on the web app,
  e.g. `https://vyact-twentyx.vercel.app/privacy`. (Must mention what data is
  collected and how to request deletion — see Data Safety below.)

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
(leave `versionCode` blank to use the run number). Download the
`vyact-release-aab` artifact → `app-release.aab`. That's your upload file.

> Versioning: `versionName` comes from `android-version.json` (currently **0.4**
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
