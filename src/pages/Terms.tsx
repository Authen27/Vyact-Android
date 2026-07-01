import { Link } from 'react-router-dom';
import { POLICY_VERSION } from './Privacy';

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

export default function Terms() {
  return (
    <div className="space-y-5">
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div>
          <h1 className="display-italic text-4xl text-ink mb-1.5">Terms of Service</h1>
          <p className="font-mono text-[0.6rem] tracking-[0.14em] uppercase text-ink-dim">
            Version {POLICY_VERSION} · Effective on account sign-up
          </p>
        </div>
        <Link to="/settings" className="text-[0.8rem] text-coral hover:underline font-medium">
          Back to settings
        </Link>
      </div>

      <Section title="1. Acceptance of terms" id="acceptance">
        <p>
          These Terms of Service ("Terms") form a binding agreement between you and Vyact governing
          your use of the Vyact household finance application (the "Service"). By creating an account
          you affirmatively accept these Terms, the{' '}
          <Link to="/privacy" className="text-coral hover:underline">Privacy Policy</Link>, and the{' '}
          <Link to="/cookies" className="text-coral hover:underline">Cookie Policy</Link>. Acceptance
          is timestamped and versioned against your account record at sign-up. If you do not agree,
          do not create an account or use the Service.
        </p>
      </Section>

      <Section title="2. The service" id="service">
        <p>Vyact is household finance organization and planning software: transaction tracking, budgeting, debt payoff planning, net-worth tracking, and related reporting/insights, optionally synced across devices and household members via cloud infrastructure.</p>
        <p>You are responsible for the accuracy of the information you enter. Vyact reflects the data you provide; it does not independently verify balances, rates, or transactions against your bank.</p>
      </Section>

      <Section title="3. Eligibility and accounts" id="eligibility">
        <p>You must be at least 16 years old (or the age of digital consent in your jurisdiction, if higher) to create an account. You are responsible for maintaining the confidentiality of your credentials and for all activity under your account. Notify us immediately of any unauthorized use.</p>
        <p>Household accounts may include multiple members with different roles (owner, admin, member, viewer, child-profile). The household owner is responsible for managing member access and permissions.</p>
      </Section>

      <Section title="4. Intellectual property rights" id="ip">
        <p><strong className="text-ink">Our IP.</strong> The Service — including its software, source code, design, user interface, trademarks, logos, and all underlying technology — is owned by Vyact and its licensors and is protected by copyright, trademark, trade secret, and other intellectual property laws. These Terms grant you a limited, non-exclusive, non-transferable, revocable license to access and use the Service for your personal or household financial management, subject to these Terms. No other rights are granted.</p>
        <p><strong className="text-ink">Restrictions.</strong> You may not copy, modify, reverse-engineer, decompile, create derivative works from, resell, sublicense, or otherwise exploit any part of the Service or its underlying code, except to the extent such restriction is prohibited by applicable law.</p>
        <p><strong className="text-ink">Your content.</strong> You retain all ownership rights to the financial data, notes, and other content you input into the Service ("Your Content"). You grant Vyact a limited, worldwide, royalty-free license to host, store, process, transmit, and display Your Content solely to operate, secure, and support the Service for you and your household — never to train third-party models, never for advertising, and never sold or licensed to any third party.</p>
        <p><strong className="text-ink">Feedback.</strong> If you submit ideas, suggestions, or feedback about the Service, you grant Vyact a perpetual, irrevocable, royalty-free license to use it without obligation or compensation to you.</p>
      </Section>

      <Section title="5. Acceptable use" id="acceptable-use">
        <List items={[
          'No unauthorized access, scraping, or attempts to bypass security or rate limits.',
          'No use of the Service to violate any law, infringe third-party rights, or facilitate fraud (including entering financial data belonging to someone else without authorization).',
          'No interference with the availability, integrity, or performance of the Service (e.g. denial-of-service activity, malware).',
          'No reverse engineering of the application except where mandated by applicable law.',
        ]} />
      </Section>

      <Section title="6. No financial, legal, or tax advice" id="no-advice">
        <p>Vyact is software for organization and planning. Nothing in the Service constitutes regulated financial, investment, legal, or tax advice, and Vyact is not a fiduciary, broker, or financial advisor. Decisions you make based on information in the app (including budgets, debt-payoff projections, or AI-generated insights) are your sole responsibility. Consult a licensed professional for advice specific to your situation.</p>
      </Section>

      <Section title="7. Subscriptions and billing" id="billing">
        <p>Where paid tiers are offered, billing terms, pricing, and renewal/cancellation mechanics are presented at the point of purchase and in Settings. Payment processing is handled by a third-party processor under its own terms; Vyact does not store full payment card numbers.</p>
      </Section>

      <Section title="8. Data controls referenced in these Terms" id="data-controls">
        <p>Your rights to export, erase, deactivate, and permanently delete your data are governed in detail by the <Link to="/privacy#erasure" className="text-coral hover:underline">Privacy Policy, Section 7</Link>, and are available directly in Settings → Danger Zone. These Terms incorporate that section by reference.</p>
      </Section>

      <Section title="9. Termination" id="termination">
        <p><strong className="text-ink">By you.</strong> You may deactivate or permanently delete your account at any time from Settings, as described in the Privacy Policy.</p>
        <p><strong className="text-ink">By us.</strong> We may suspend or terminate your access if you materially breach these Terms, misuse the Service, or where required by law, with notice where reasonably practicable. On termination for cause, your right to use the Service ends immediately; data handling follows the same erasure/retention rules described in the Privacy Policy unless we are legally required to retain specific records longer.</p>
      </Section>

      <Section title="10. Disclaimers and limitation of liability" id="liability">
        <p>The Service is provided "as is" and "as available" without warranties of any kind, express or implied, to the maximum extent permitted by law. To the fullest extent permitted by law, Vyact will not be liable for indirect, incidental, special, consequential, or punitive damages, or for any loss of data, profits, or financial decisions made in reliance on the Service. Nothing in these Terms limits liability that cannot be limited under applicable law (e.g. liability for gross negligence, willful misconduct, or fraud).</p>
      </Section>

      <Section title="11. Governing law and disputes" id="law">
        <p>These Terms are governed by the laws of the jurisdiction in which the operating legal entity is incorporated, without regard to conflict-of-laws principles, except where mandatory local consumer-protection law grants you additional rights that cannot be waived. Disputes will first be attempted to be resolved informally through our support channel before formal proceedings.</p>
      </Section>

      <Section title="12. Changes to these terms" id="changes">
        <p>We may update these Terms from time to time. Material changes will be notified in-app and, where legally required, require renewed acceptance before continued use. The "Version" date above reflects the last update.</p>
      </Section>

      <Section title="13. Contact" id="contact">
        <p>
          Questions about these Terms can be raised by emailing{' '}
          <a href="mailto:uday.kr27@gmail.com?subject=Vyact%20Terms%20question" className="text-coral hover:underline">uday.kr27@gmail.com</a>{' '}
          (temporary support inbox — more channels are coming), or via the{' '}
          <Link to="/help#contact" className="text-coral hover:underline">Help → Contact support</Link> form once signed in.
        </p>
      </Section>
    </div>
  );
}
