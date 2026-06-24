import { Link } from 'react-router-dom';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-bg3 border border-line rounded-lg p-5 md:p-6">
      <h2 className="text-xl font-semibold text-ink mb-3">{title}</h2>
      <div className="space-y-3 text-[0.95rem] leading-7 text-ink-mid">{children}</div>
    </section>
  );
}

export default function Terms() {
  return (
    <div className="space-y-5">
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div>
          <h1 className="display-italic text-4xl text-ink mb-1.5">Terms of Service</h1>
          <p className="font-mono text-[0.6rem] tracking-[0.14em] uppercase text-ink-dim">
            Draft scaffold for Vyact · last updated 2026-06-01
          </p>
        </div>
        <Link to="/settings" className="text-[0.8rem] text-coral hover:underline font-medium">
          Back to settings
        </Link>
      </div>

      <Section title="Status">
        <p>This is a draft scaffold only. Final enforceable terms require founder and legal review before publication.</p>
      </Section>

      <Section title="Use of the service">
        <p>Vyact is provided as a household finance software product. Users are responsible for the accuracy of information they enter and for safeguarding their account credentials.</p>
      </Section>

      <Section title="No financial advice">
        <p>Unless expressly stated otherwise in final launch documents, Vyact is software for organization and planning and does not provide regulated financial, legal, tax, or investment advice.</p>
      </Section>

      <Section title="Acceptable use">
        <p>Users may not misuse the service, attempt unauthorized access, interfere with availability, or use the product in ways that violate law or third-party rights.</p>
      </Section>

      <Section title="Termination and changes">
        <p>Final terms should define account suspension, termination, limitation of liability, jurisdiction, and change-notice mechanics once the legal entity and operating region are locked.</p>
      </Section>
    </div>
  );
}