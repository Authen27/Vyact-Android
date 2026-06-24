# FinFlow v6 — React + TypeScript + Recharts

> Modern frontend stack rebuild of [FinFlow](../). The v5 vanilla shell stays
> untouched in the parent directory; this is the React migration.

## Tech stack

| Layer | Technology |
|---|---|
| Build | **Vite 5** with React plugin |
| Language | **TypeScript 5.6** strict mode |
| UI | **React 18** with hooks + suspense-friendly architecture |
| Styling | **Tailwind CSS 3** with custom paper-warm theme tokens |
| State | **Zustand** — minimal, reactive, no provider tree |
| Routing | **React Router v6** — deep-linkable URLs |
| Charts | **Recharts** — declarative, themed, animated |
| Icons | **Lucide React** — 1,400+ tree-shakeable icons |
| Persistence | `DataAdapter` interface (LocalStorageAdapter active; SupabaseAdapter ready) |

## Why these choices

- **Vite over CRA / Next.js** — fastest dev server, ESM-native, zero ceremony for an SPA.
- **Tailwind over CSS-in-JS** — small runtime, design tokens via CSS variables means dark mode swaps without re-rendering. Paper-warm palette wired via HSL CSS vars in `src/index.css`.
- **Zustand over Redux / Context** — full TypeScript inference, no provider tree, ~1KB.
- **Recharts over Chart.js / D3 / ECharts** — pure React, declarative composition, renders SVG (zero canvas surprises), themes via CSS vars seamlessly. Customised tooltip + axis styling matches the FinFlow design system.
- **React Router v6** — lets us deep-link to `/dashboard`, `/reports?period=quarter`, and (post-Supabase) handle invitation acceptance routes.

## Setup

```bash
cd react
npm install
npm run dev          # → http://localhost:5173
```

Build for production:

```bash
npm run build
npm run preview
```

## Project structure

```
react/
├── package.json            — deps + scripts
├── vite.config.ts          — minimal Vite + React config
├── tsconfig.json           — strict TS with @/* path alias
├── tailwind.config.ts      — paper-warm theme bindings
├── postcss.config.js
├── index.html              — Vite HTML entry; Google Fonts links
└── src/
    ├── main.tsx                  — entry: BrowserRouter + StrictMode
    ├── App.tsx                   — Routes + Layout + ToastHost
    ├── index.css                 — Tailwind base + theme HSL vars + Recharts overrides
    ├── types.ts                  — All domain types (Transaction, Debt, etc.)
    ├── constants.ts              — Categories, currencies, payment methods, locales
    ├── store.ts                  — Zustand store (data + UI state + actions)
    ├── hooks.ts                  — useTranslation, useShortcuts, useTheme
    ├── lib/
    │   ├── format.ts             — fmt, fmtShort, formatDate, convert
    │   ├── i18n.ts               — t(key, lang)
    │   ├── calculations.ts       — Pulse Score, splits, loans, ratios, insights
    │   ├── dataAdapter.ts        — LocalStorageAdapter (TS) + interface
    │   └── seed.ts               — First-run demo data
    ├── components/
    │   ├── ui/                   — Button, Card, Panel, Modal, Input, Badge, ToastHost, EmptyState
    │   ├── layout/               — Sidebar, MobileBar, ProfileSwitcher, Layout
    │   ├── charts/               — PulseGauge (custom SVG), Charts.tsx (Recharts)
    │   └── transactions/         — TxnRow, PaymentMethodChip
    └── pages/
        ├── Dashboard.tsx         — ✅ FULL: Pulse + 4 cards + insights + 3 panel rows + donut
        ├── Reports.tsx           — ✅ FULL: period selector + Recharts Area + Bar + Donut + tables
        ├── Transactions.tsx      — ✅ FULL: list + 5 filter dropdowns + search
        └── Stubs.tsx              — Placeholder for the 7 remaining pages (see migration TODO)
```

## What's done

- ✅ **Tooling** — Vite + React 18 + TS + Tailwind + Recharts + Zustand + Router + Lucide
- ✅ **Theme system** — Paper Warm (default), Dark, System (follows OS); HSL vars; Recharts inherits theme
- ✅ **Data adapter (TS)** — full LocalStorage impl with multi-profile namespacing, backward-compatible with v5 storage keys
- ✅ **Zustand store** — every CRUD op for transactions/budgets/goals/members/debts/assets/profile/rates
- ✅ **Calculations layer** — Pulse Score (5 components), monthly aggregation, splits, EMI, ratios, insights — all pure TS, unit-testable
- ✅ **Layout shell** — responsive sidebar with profile switcher, mobile hamburger bar, theme toggle
- ✅ **Recharts integration** — Income/Expense Area chart, Net Bar chart, Category Donut, Category Bars; theme-aware
- ✅ **PulseGauge** — custom SVG conic-gradient ring (kept hand-crafted for brand fidelity)
- ✅ **Pages** — Dashboard, Reports, Transactions fully functional with real data

## What's pending

The legacy vanilla shell has been archived from the working tree. React is now the only active consumer surface. Remaining work should be tracked against current roadmap items in `VERSIONS.md` and `react/CHANGELOG.md`, not against old v5 fallback pages.

## Roadmap (post-v6)

- **v6.1**: complete the 7 stub pages (1–2 weeks)
- **v6.2**: modal-based CRUD wired up (transaction add/edit, debt payment, etc.)
- **v6.3**: framer-motion transitions on page changes and chart entry
- **v7.0**: Supabase integration — auth, multi-device cloud sync, multi-user households with invitations, RLS-enforced multi-tenancy. See `../ARCHITECTURE.md` and `../db/schema.sql`.

The data adapter abstraction means v7 swap is a one-line change in `store.ts`:

```ts
adapter: new LocalStorageAdapter(),                    // v6
adapter: new HybridAdapter(supabase),                  // v7
```

## Legacy shell

The v5 vanilla shell is no longer present in the working tree. If you need to inspect it for historical context, use git history before the v7.0.1 cleanup.
