import { useState } from 'react';
import { useTranslation } from '../hooks';

interface Media { src: string; alt: string; }
interface Section { q: string; a: string | JSX.Element; media?: Media; }

const SECTIONS: Section[] = [
  {
    q: 'Getting started & keyboard shortcuts',
    a: (
      <div className="space-y-3">
        <p>
          Sign up with your email and you're in — your first household is created automatically, and
          onboarding (template → household size → primary concern → currency) is optional, not a wall.
          Add your first transaction from the Dashboard or Transactions page, or press <b>N</b>.
        </p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[0.84rem]">
          {[['N','Add transaction'],['G','Add goal'],['D','Add debt'],['A','Add asset'],['/','Focus search'],['Esc','Close modal']].map(([k, v]) => (
            <div key={k} className="flex items-center gap-2">
              <kbd className="font-mono text-[0.72rem] bg-bg3 border border-line rounded px-2 py-0.5 text-ink">{k}</kbd>
              <span className="text-ink-mid">{v}</span>
            </div>
          ))}
        </div>
      </div>
    ),
    media: { src: '/help/getting-started.webp', alt: 'Vyact dashboard overview' },
  },
  {
    q: 'Adding transactions — types, payment methods & privacy',
    a: 'Press N or click Add Transaction. Pick a type: Expense and Income count toward your cash-flow totals and Pulse Score; Investment records an outflow linked to an Asset; Transfer moves money between accounts (neutral, excluded from totals). Tag a payment method, a household member, make it recurring, or mark it 🔒 Private to hide it from all aggregations.',
    media: { src: '/help/add-transaction.gif', alt: 'Adding a transaction step by step' },
  },
  {
    q: 'Splitting a bill — and shared income',
    a: 'In the Add Transaction modal, tick "🤝 Split this bill" on an expense (or "🤝 Share this income with others" on an income). Choose who paid (or received the money) and add each participant with their share — the shares must add up to the total. Only your share counts toward your own expenses or income; the rest is tracked as IOUs on the Splits page where you Mark paid / Settle each balance and see total owed-to-you vs you-owe. On a "you owe" row, click Track as debt to convert the IOU into a real Debt that shows up on the Debts page and reduces your Net Worth — useful when the obligation is going to outlive a quick reimbursement (e.g. a friend covered your half of a deposit).',
    media: { src: '/help/split-bill.gif', alt: 'Splitting a bill across participants' },
  },
  {
    q: 'Saved Views — reusable filters on Transactions, Reports & Insights',
    a: (
      <div className="space-y-3">
        <p>
          Saved Views remember the filters you applied to Transactions, Reports, or Insights so you
          can recall them in one click instead of re-picking month / category / track every time.
          Use the <strong>Save view</strong> button on each page to capture the current filter set,
          then pick it from the <strong>Views</strong> dropdown later.
        </p>
        <p className="text-[0.82rem]">
          <strong>Common use cases:</strong> "Q1 dining out", "Salary by member", "Rent &
          utilities", "This year's investments only", "Insights I've favourited".
        </p>
        <p className="text-[0.82rem]">
          <strong>Sharing.</strong> Tick <em>Share with household</em> on save to make a view
          visible to other members of the same household; leave it unchecked to keep it private to
          your account. Either way, search terms, member ids, and transaction ids are
          <strong> always stripped before saving</strong> — saved views can never leak free-text
          notes or who-spent-what details to other people.
        </p>
        <p className="text-[0.82rem] text-ink-dim">
          Saved Views require a cloud account (they're row-level-security scoped per household).
          Local-only mode hides the bar entirely.
        </p>
      </div>
    ),
    media: { src: '/help/saved-views.webp', alt: 'Saved Views bar on the Reports page' },
  },
  {
    q: 'The Family Pulse Score',
    a: 'A single 0–100 health score from 5 components: Budget Compliance (25%), Savings Rate (25%), Goal Progress (15%), Expense Trend (15%), Debt Health (20%). Bands: Excellent ≥ 80 · Good ≥ 65 · Fair ≥ 45 · Needs Work below. It updates live as you add data.',
              media: { src: '/help/getting-started.webp', alt: 'Vyact dashboard overview' },
  },
  {
    q: 'Budgets & Goals',
    a: 'Budgets: set a spending limit per category; progress bars go green (on-track) → amber (≥ 80%) → red (over), and you can pick monthly, quarterly, half-yearly, annual or custom windows. Goals: six types (Emergency Fund, Savings, Debt Payoff, Investment, Purchase, Custom) with a target, optional deadline, and a "+ Progress" button to log contributions.',
    media: { src: '/help/budgets-goals.webp', alt: 'Budgets page with category progress bars' },
  },
  {
    q: 'Debt payoff & Net Worth',
    a: 'Debts: add each balance, APR and minimum payment, then choose Avalanche (highest APR first — saves the most interest) or Snowball (smallest balance first — faster wins). Vyact ranks them, shows months-to-payoff, and splits each recorded payment into interest vs principal. Net Worth: assets − liabilities, grouped by liquidity, with Liquidity, Debt-to-Asset, Emergency Coverage and Savings ratios.',
    media: { src: '/help/debt-networth.webp', alt: 'Debts page with payoff strategy' },
  },
  {
    q: 'Planner, Insights & Recurring',
    a: 'Planner is a deterministic rules engine (no AI, no hallucination) that reviews your data and surfaces prioritised recommendations across Income, Expenses, Investments, Debt and Tax (Critical · Watch · Info). Insights is your reading list of articles published by the Vyact team — search and favourite them. Recurring manages repeating transactions (weekly/monthly/yearly/custom) with auto-confirm or reminder lead-days.',
    media: { src: '/help/planner.webp', alt: 'Planner recommendations' },
  },
  {
    q: 'Households, currency, backup, themes & privacy',
    a: 'Create multiple households (Personal, Family, Business) and switch between them — each has isolated data, and you can invite others by email with a role (Admin/Member/Viewer/Child) enforced by database row-level security. Every record stores its own currency and converts to your base currency via the editable rates table. Back up to JSON or CSV from Settings → Sync. Three themes (Paper Warm, Dark, System), six languages, and — in cloud mode — RLS-isolated data over a PKCE auth flow.',
    media: { src: '/help/settings.webp', alt: 'Households and settings' },
  },
];

export default function Help() {
  const { t } = useTranslation();
  const [open, setOpen]   = useState<number | null>(null);
  const [query, setQuery] = useState('');

  const filtered = query.trim()
    ? SECTIONS.filter(s => s.q.toLowerCase().includes(query.toLowerCase()) || (typeof s.a === 'string' && s.a.toLowerCase().includes(query.toLowerCase())))
    : SECTIONS;

  return (
    <div>
      <div className="flex justify-between items-start mb-5 gap-4 flex-wrap">
        <div>
          <h1 className="display-italic text-4xl text-ink mb-1.5">{t('help')}</h1>
          <p className="font-mono text-[0.6rem] tracking-[0.14em] uppercase text-ink-dim">
            {SECTIONS.length} topics · with screenshots &amp; guides
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="mb-5">
        <input
          className="input w-full"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(null); }}
          placeholder="Search help topics…"
        />
      </div>

      {/* Accordion */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="text-center py-10 text-ink-mid">
            No topics match "{query}"
          </div>
        )}
        {filtered.map((s, i) => {
          const isOpen = open === i;
          return (
            <div key={i} className="bg-bg border border-line rounded-xl overflow-hidden">
              <button
                className="w-full text-left px-5 py-4 flex items-center justify-between gap-4 hover:bg-bg3 transition-colors"
                onClick={() => setOpen(isOpen ? null : i)}
              >
                <span className="font-semibold text-ink text-[0.9rem] leading-snug">{s.q}</span>
                <span className="text-ink-dim text-lg flex-shrink-0 transition-transform" style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                  ▾
                </span>
              </button>
              {isOpen && (
                <div className="border-t border-line px-5 py-4 text-[0.84rem] text-ink-mid leading-relaxed">
                  <div>{s.a}</div>
                  {s.media && (
                    <figure className="mt-4">
                      <img
                        src={s.media.src}
                        alt={s.media.alt}
                        loading="lazy"
                        className="w-full rounded-lg border border-line shadow-sm bg-bg2"
                        onError={e => { (e.currentTarget.closest('figure') as HTMLElement)?.style.setProperty('display', 'none'); }}
                      />
                      <figcaption className="mt-1.5 font-mono text-[0.58rem] tracking-wider uppercase text-ink-dim">
                        {s.media.alt}
                      </figcaption>
                    </figure>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer tip */}
      <div className="mt-8 text-center">
        <p className="text-[0.8rem] text-ink-dim">
          Something missing? Use the <span className="font-semibold text-ink">Planner</span> for personalised recommendations,
          or <span className="font-semibold text-ink">Ask Vyact</span> for AI-powered answers about your data.
        </p>
        {/* Version sub-note — sourced from package.json at build time */}
        <p className="num mt-3 font-mono text-[0.6rem] tracking-[0.12em] uppercase text-ink-dim">
                    Vyact Consumer · v{__APP_VERSION__}
        </p>
      </div>
    </div>
  );
}
