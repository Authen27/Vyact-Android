import { Link } from 'react-router-dom';

export const POLICY_VERSION = '2026-07-01';

function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="bg-bg3 border border-line rounded-lg p-5 md:p-6 scroll-mt-20">
      <h2 className="text-xl font-semibold text-ink mb-3">{title}</h2>
      <div className="space-y-3 text-[0.95rem] leading-7 text-ink-mid">{children}</div>
    </section>
  );
}

function List({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="list-disc pl-5 space-y-1.5">
      {items.map((it, i) => <li key={i}>{it}</li>)}
    </ul>
  );
}

export default function Privacy() {
  return (
    <div className="space-y-5">
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div>
          <h1 className="display-italic text-4xl text-ink mb-1.5">Privacy Policy</h1>
          <p className="font-mono text-[0.6rem] tracking-[0.14em] uppercase text-ink-dim">
            Version {POLICY_VERSION} · Effective on account sign-up
          </p>
        </div>
        <Link to="/settings" className="text-[0.8rem] text-coral hover:underline font-medium">
          Back to settings
        </Link>
      </div>

      <Section title="1. Who this policy covers" id="scope">
        <p>
          This Privacy Policy explains how Vyact ("Vyact", "we", "us") collects, uses, discloses,
          and protects personal information when you use the Vyact household finance application
          (the "Service"), including the consumer app, the admin console, and any connected channel
          (e.g. WhatsApp) we make available for interacting with your account.
        </p>
        <p>
          By creating a Vyact account you confirm you have read and accept this Privacy Policy, the{' '}
          <Link to="/terms" className="text-coral hover:underline">Terms of Service</Link>, and the{' '}
          <Link to="/cookies" className="text-coral hover:underline">Cookie Policy</Link>. Your acceptance,
          along with the policy version and timestamp, is recorded against your account at sign-up so
          there is an auditable record of consent.
        </p>
      </Section>

      <Section title="2. Personal data we collect" id="collect">
        <p><strong className="text-ink">Account &amp; identity data:</strong> name, email address, authentication identifiers, password hash (managed by our authentication provider — we never see or store your plaintext password), profile preferences, and optional phone number if you link WhatsApp.</p>
        <p><strong className="text-ink">Financial data you enter:</strong> transactions, budgets, debts, assets, accounts, goals, household members, recurring schedules, and any notes or categories you attach to them. This is data you control end-to-end — it exists because you typed it in or imported it.</p>
        <p><strong className="text-ink">Onboarding &amp; estimated reference data:</strong> the segment, concern, and starting financial snapshot you provide during onboarding is stored as a clearly labelled <em>estimated reference</em>, never written into your transaction ledger, and is automatically cleared once real activity supersedes it or you dismiss it.</p>
        <p><strong className="text-ink">Device &amp; usage data:</strong> IP address, browser/device type, session and sync metadata, crash/error logs, and product-usage events (e.g. feature usage counts) used to operate, secure, and improve the Service.</p>
        <p><strong className="text-ink">Support &amp; communications data:</strong> messages you send us for support, feedback you submit in-app, and records of consent/notice acknowledgements.</p>
        <p>We do not knowingly collect government ID numbers, full payment card numbers, or biometric data. Payment processing (where offered) is handled by a PCI-compliant third-party processor; we store only subscription status and billing metadata, never full card numbers.</p>
      </Section>

      <Section title="3. How we use your data" id="use">
        <List items={[
          'Operate core features — recording transactions, computing budgets, net worth, debt payoff plans, and dashboards.',
          'Keep your data in sync securely across your devices and household members.',
          'Secure your account — fraud prevention, abuse detection, authentication, and audit logging.',
          'Provide support and respond to the requests described in Section 6.',
          'Improve the product using aggregated or de-identified usage patterns — never used to make automated decisions with legal or similarly significant effects on you.',
        ]} />
        <p>We do not sell your personal information. We do not use your financial data to build advertising profiles, and we do not share your data with data brokers.</p>
      </Section>

      <Section title="4. Legal basis for processing" id="legal-basis">
        <p>
          Where applicable data-protection law requires a legal basis (e.g. GDPR), we rely on: (a)
          performance of the contract between you and Vyact (delivering the Service you signed up
          for); (b) your consent, recorded at sign-up and re-confirmable at any time in Settings; (c)
          our legitimate interests in securing and improving the Service; and (d) compliance with
          legal obligations, where applicable.
        </p>
      </Section>

      <Section title="5. Data sharing and processors" id="sharing">
        <p>We share personal data only with service providers who process it on our behalf under contractual confidentiality and data-protection terms, limited to what is necessary to run the Service:</p>
        <List items={[
          'Cloud database and authentication infrastructure (Supabase) — stores your account and household data, encrypted at rest and in transit.',
          'Hosting/CDN and application infrastructure (Vercel) — serves the application.',
          'Messaging channel providers (e.g. WhatsApp Business Platform / Meta) — only if you explicitly link your account to that channel.',
          'AI-assistant infrastructure (e.g. large-language-model providers) — only for the specific request you make in Ask Vyact / Chat, and only the minimum context needed to answer it.',
        ]} />
        <p>We may disclose information where required by law, to protect the rights, property, or safety of Vyact, our users, or the public, or in connection with a merger, acquisition, or sale of assets — in which case we will notify affected users before data is transferred under materially different terms.</p>
      </Section>

      <Section title="6. Your rights and controls" id="rights">
        <p>Subject to applicable law (including GDPR, CCPA/CPRA, and similar regimes), you have the right to:</p>
        <List items={[
          <><strong className="text-ink">Access</strong> — export your data at any time from Settings → Sync &amp; Backup (JSON backup or CSV export).</>,
          <><strong className="text-ink">Correct</strong> — edit any transaction, profile field, or household record directly in the app.</>,
          <><strong className="text-ink">Erase</strong> — permanently delete all financial data in a household without closing your account, or permanently delete your account and all associated data. See Section 7 for exactly what each option does.</>,
          <><strong className="text-ink">Restrict / object</strong> — deactivate your account temporarily instead of deleting it.</>,
          <><strong className="text-ink">Portability</strong> — receive your data in a structured, machine-readable format (JSON/CSV).</>,
          <><strong className="text-ink">Withdraw consent</strong> — contact us to withdraw consent for optional processing (e.g. WhatsApp linking) without affecting the lawfulness of prior processing.</>,
        ]} />
        <p>To exercise any right not self-serviceable in the app, email <a href="mailto:uday.kr27@gmail.com?subject=Vyact%20Privacy%20rights%20request" className="text-coral hover:underline">uday.kr27@gmail.com</a> (temporary support inbox). We respond to verifiable requests within 30 days (or the timeframe required by your local law, if shorter).</p>
      </Section>

      <Section title="7. Data erasure, deactivation, and deletion — what actually happens" id="erasure">
        <p>These controls are available directly in <strong className="text-ink">Settings → Danger Zone</strong>. Every action below requires entering a one-time verification code we send to your account email before it takes effect — proof the request really is coming from you, not just a signed-in browser.</p>
        <p><strong className="text-ink">Erase all household data (data wiped, account kept):</strong> permanently and irreversibly deletes every transaction, budget, debt, asset, account, goal, recurring schedule, saved view, and the onboarding reference for the selected household. Your login, profile, and household membership are kept so you can start fresh. This action cannot be undone — there is no backup retained by Vyact once you confirm it (we recommend exporting a backup first).</p>
        <p><strong className="text-ink">Deactivate account (temporary):</strong> immediately signs you out and places a hold on your account. Your data is <em>not deleted</em> — it is kept exactly as it was, inaccessible to anyone (including you) until you reactivate. See Section 8 for reactivation.</p>
        <p><strong className="text-ink">Delete account (permanent):</strong> schedules full account and data deletion. Your account is put on hold immediately (same as deactivation) and a 30-day undo window begins. If you take no action, at the end of the 30 days we permanently erase: your profile, every household you solely own and all of its financial data, your membership in any shared households, and your login credentials from our authentication provider. This is irreversible once the window closes — there is no way for us to recover it afterward, by design.</p>
      </Section>

      <Section title="8. Reactivation procedure" id="reactivation">
        <p>
          If you deactivated your account, or requested permanent deletion and are still inside the
          30-day undo window, simply sign back in with your existing credentials. Vyact detects the
          hold automatically on sign-in and clears it in the same step — you'll see a confirmation
          ("Welcome back — your account has been reactivated") and land back on your dashboard with
          all data intact, exactly as you left it. No support request is required.
        </p>
        <p>
          Once a permanent-deletion request has actually completed (past the 30-day window and
          purged), reactivation is not possible — you would need to create a new account, and no
          prior data can be restored into it.
        </p>
      </Section>

      <Section title="9. Data retention" id="retention">
        <p>We retain personal data for as long as your account is active, plus a limited period afterward for legitimate business purposes (fraud prevention, legal compliance, dispute resolution) not to exceed what is necessary. Specifically:</p>
        <List items={[
          'Active account data: retained until you erase it, deactivate, or delete your account.',
          'Deactivated accounts: retained indefinitely on hold, restorable at any time by signing in.',
          'Deletion requests: retained for the 30-day undo window, then permanently purged.',
          'Security and billing logs: retained up to 12 months for fraud/abuse prevention and legal compliance, then deleted or anonymized.',
        ]} />
      </Section>

      <Section title="10. Security" id="security">
        <p>We use industry-standard safeguards including encryption in transit (TLS) and at rest, row-level access controls scoped per household, least-privilege service credentials, and optional two-factor authentication (Settings → Security). No method of transmission or storage is 100% secure; we continuously work to protect your data but cannot guarantee absolute security.</p>
      </Section>

      <Section title="11. International transfers" id="transfers">
        <p>Vyact's infrastructure providers may process data in countries other than your own. Where required, we rely on appropriate safeguards (such as standard contractual clauses) to protect data transferred internationally.</p>
      </Section>

      <Section title="12. Children's privacy" id="children">
        <p>Vyact is not directed to children under 16, and we do not knowingly collect personal data from them. A household "child" member profile added by a parent/guardian is managed entirely by the account owner and is not a separate account holder.</p>
      </Section>

      <Section title="13. Changes to this policy" id="changes">
        <p>We will post material changes here with an updated effective date and, where required by law, seek renewed consent. Continued use of the Service after a change takes effect constitutes acceptance of the revised policy.</p>
      </Section>

      <Section title="14. Contact" id="contact">
        <p>
          Questions about this policy or your data can be raised by emailing{' '}
          <a href="mailto:uday.kr27@gmail.com?subject=Vyact%20Privacy%20question" className="text-coral hover:underline">uday.kr27@gmail.com</a>{' '}
          (temporary support inbox — more channels are coming), or via the{' '}
          <Link to="/help#contact" className="text-coral hover:underline">Help → Contact support</Link> form once signed in.
        </p>
      </Section>
    </div>
  );
}
