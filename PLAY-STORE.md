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

> Versioning: `versionName` comes from `package.json` (currently **9.7.1**);
> `versionCode` must strictly increase each upload (CI uses the run number).

---

## 2. Create the app in Play Console
- **App name:** `Vyact — Family Finance OS`
- **Default language:** English (US)
- **App or game:** App · **Free**
- **Package name (set on first upload, permanent):** `com.vyact.app`

---

## 3. Store listing copy (ready to paste)

**App name (≤30):** `Vyact — Family Finance OS`

**Short description (≤80):**
`Household finance, planned together: track spending, budgets, debt & net worth.`

**Full description (≤4000):**
```
Vyact is the family finance OS — one calm place to see where the household's
money goes and plan what comes next.

WHAT YOU CAN DO
• Cash flow at a glance — income vs spending, by month and category.
• Budgets that fit real life — monthly, annual and custom plans with per-category
  limits and progress.
• Debt payoff — track loans and credit, see interest vs principal, and a payoff plan.
• Net worth — assets minus liabilities, with liquidity and savings ratios.
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
- **Tags:** budgeting, personal finance, money manager
- **Contact email:** <your support email>
- **Website:** https://vyact-twentyx.vercel.app
- **Privacy policy:** https://vyact-twentyx.vercel.app/privacy

---

## 4. Graphic assets (from the `vyact-play-assets` artifact)
Run Actions → **Play store assets**, download `vyact-play-assets`.

| Asset | Spec | File |
|---|---|---|
| App icon | 512×512 PNG, 32-bit | `play-assets/icon-512.png` |
| Feature graphic | 1024×500 PNG | `play-assets/feature-graphic.png` |
| Phone screenshots | 2–8, portrait | `store-shot-1..5-*.png` (Dashboard, Transactions, Budgets, Net Worth, Reports) |

(Optional but recommended: 7" and 10" tablet screenshots.)

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
