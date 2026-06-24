import { Link } from 'react-router-dom';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-bg3 border border-line rounded-lg p-5 md:p-6">
      <h2 className="text-xl font-semibold text-ink mb-3">{title}</h2>
      <div className="space-y-3 text-[0.95rem] leading-7 text-ink-mid">{children}</div>
    </section>
  );
}

export default function Privacy() {
  return (
    <div className="space-y-5">
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div>
          <h1 className="display-italic text-4xl text-ink mb-1.5">Privacy Policy</h1>
          <p className="font-mono text-[0.6rem] tracking-[0.14em] uppercase text-ink-dim">
            Draft scaffold for Vyact · last updated 2026-06-01
          </p>
        </div>
        <Link to="/settings" className="text-[0.8rem] text-coral hover:underline font-medium">
          Back to settings
        </Link>
      </div>

      <Section title="Status">
        <p>This page is a working draft scaffold for founder and legal review. Replace placeholders before public launch.</p>
      </Section>

      <Section title="What Vyact collects">
        <p>Vyact stores the household finance information you enter into the product, such as transactions, budgets, goals, debts, assets, members, and account preferences.</p>
        <p>If cloud sync is enabled, the app also stores authentication identifiers and sync metadata required to keep household data consistent across devices.</p>
      </Section>

      <Section title="How Vyact uses data">
        <p>We use your data to operate the household finance product, generate reports, power planning workflows, and maintain sync, security, and account recovery features.</p>
        <p>We do not treat this scaffold as final legal language for marketing, resale, or regulated financial advice claims.</p>
      </Section>

      <Section title="Data sharing and processors">
        <p>Cloud-hosted environments may rely on infrastructure and operational vendors such as hosting, database, analytics, and email providers. The final policy must list the production vendors actually in use at launch.</p>
      </Section>

      <Section title="Your controls">
        <p>You can export your data from the app, download backups, and request deletion or correction workflows once those operational processes are finalized.</p>
      </Section>
    </div>
  );
}