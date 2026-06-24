import { Link } from 'react-router-dom';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-bg3 border border-line rounded-lg p-5 md:p-6">
      <h2 className="text-xl font-semibold text-ink mb-3">{title}</h2>
      <div className="space-y-3 text-[0.95rem] leading-7 text-ink-mid">{children}</div>
    </section>
  );
}

export default function Cookies() {
  return (
    <div className="space-y-5">
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div>
          <h1 className="display-italic text-4xl text-ink mb-1.5">Cookie Policy</h1>
          <p className="font-mono text-[0.6rem] tracking-[0.14em] uppercase text-ink-dim">
            Draft scaffold for Vyact · last updated 2026-06-01
          </p>
        </div>
        <Link to="/settings" className="text-[0.8rem] text-coral hover:underline font-medium">
          Back to settings
        </Link>
      </div>

      <Section title="Status">
        <p>This scaffold documents likely categories of cookies and browser storage. Replace placeholders with the actual production inventory before launch.</p>
      </Section>

      <Section title="Essential storage">
        <p>Vyact uses browser storage for core product behavior such as signed-in sessions, local preferences, sync metadata, cached household data, and migration compatibility keys.</p>
      </Section>

      <Section title="Analytics and performance">
        <p>If analytics or performance tooling is enabled, the final policy must describe what is collected, the provider involved, retention rules, and any consent requirements by jurisdiction.</p>
      </Section>

      <Section title="Managing cookies">
        <p>Users can clear browser storage through browser settings, though doing so may sign them out or remove locally cached household data that has not synced yet.</p>
      </Section>
    </div>
  );
}