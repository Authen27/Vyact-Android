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

const COOKIE_TABLE: { category: string; purpose: string; examples: string; retention: string; optional: boolean }[] = [
  { category: 'Strictly necessary', purpose: 'Sign-in session, CSRF protection, load balancing', examples: 'Supabase auth session token, sync write-queue markers', retention: 'Session / up to token expiry', optional: false },
  { category: 'Preferences', purpose: 'Remember theme, language, currency, and layout choices', examples: 'theme, locale, number-system preference', retention: 'Until changed or storage cleared', optional: true },
  { category: 'Functional / cache', purpose: 'Offline-friendly local cache of household data for fast reloads', examples: 'LocalStorageAdapter cache, onboarding state cache', retention: 'Until sign-out or manual clear', optional: false },
  { category: 'Analytics', purpose: 'Understand feature usage in aggregate to improve the product', examples: 'GA4 custom events (if enabled for your environment)', retention: 'Per analytics provider policy, typically 14 months', optional: true },
];

export default function Cookies() {
  return (
    <div className="space-y-5">
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div>
          <h1 className="display-italic text-4xl text-ink mb-1.5">Cookie Policy</h1>
          <p className="font-mono text-[0.6rem] tracking-[0.14em] uppercase text-ink-dim">
            Version {POLICY_VERSION} · Effective on account sign-up
          </p>
        </div>
        <Link to="/settings" className="text-[0.8rem] text-coral hover:underline font-medium">
          Back to settings
        </Link>
      </div>

      <Section title="1. What this policy covers" id="scope">
        <p>
          This Cookie Policy explains how Vyact uses cookies, local storage, and similar browser
          storage technologies (collectively, "cookies") when you use the Service. It supplements the{' '}
          <Link to="/privacy" className="text-coral hover:underline">Privacy Policy</Link>. By
          accepting our policies at sign-up, you consent to the use of strictly-necessary and
          functional storage described below; optional categories are only enabled where indicated
          and can be controlled as described in Section 4.
        </p>
      </Section>

      <Section title="2. Categories of storage we use" id="categories">
        <div className="overflow-x-auto">
          <table className="w-full text-[0.85rem] border-collapse">
            <thead>
              <tr className="text-left border-b border-line">
                <th className="py-2 pr-3 font-semibold text-ink">Category</th>
                <th className="py-2 pr-3 font-semibold text-ink">Purpose</th>
                <th className="py-2 pr-3 font-semibold text-ink">Examples</th>
                <th className="py-2 pr-3 font-semibold text-ink">Retention</th>
                <th className="py-2 font-semibold text-ink">Optional?</th>
              </tr>
            </thead>
            <tbody>
              {COOKIE_TABLE.map(row => (
                <tr key={row.category} className="border-b border-line/60 align-top">
                  <td className="py-2 pr-3 font-medium text-ink whitespace-nowrap">{row.category}</td>
                  <td className="py-2 pr-3">{row.purpose}</td>
                  <td className="py-2 pr-3">{row.examples}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{row.retention}</td>
                  <td className="py-2">{row.optional ? 'Yes' : 'No — required to operate'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="3. Why strictly-necessary storage can't be opted out" id="necessary">
        <p>Session tokens and the local write-queue cache are what keep you signed in and your household data consistent while offline or mid-sync. Blocking this storage would break core functionality (you'd be signed out constantly, or edits could be lost before they sync). These are treated as essential to delivering the Service you asked for, consistent with applicable e-privacy exemptions for strictly-necessary storage.</p>
      </Section>

      <Section title="4. Managing your preferences" id="managing">
        <p>You can control optional categories in two ways:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>In-app: analytics/preference cookies (where enabled for your environment) can be disabled from your device/browser settings without losing access to the Service.</li>
          <li>Browser settings: you can clear cookies/local storage at any time. Doing so will sign you out and remove any locally cached (not-yet-synced) data — sync any pending offline edits before clearing storage.</li>
        </ul>
      </Section>

      <Section title="5. Third-party storage" id="third-party">
        <p>Where analytics or connected-channel features (e.g. WhatsApp linking) are enabled, the relevant third-party provider may set its own cookies or equivalent identifiers under its own privacy/cookie policy. We only enable these integrations you explicitly opt into (e.g. linking WhatsApp from Settings).</p>
      </Section>

      <Section title="6. Changes to this policy" id="changes">
        <p>We will update this page and the version date above if our storage practices materially change, consistent with the change-notice process in the Privacy Policy.</p>
      </Section>

      <Section title="7. Contact" id="contact">
        <p>
          Questions about this policy can be raised by emailing{' '}
          <a href="mailto:uday.kr27@gmail.com?subject=Vyact%20Cookie%20Policy%20question" className="text-coral hover:underline">uday.kr27@gmail.com</a>{' '}
          (temporary support inbox — more channels are coming), or via the{' '}
          <Link to="/help#contact" className="text-coral hover:underline">Help → Contact support</Link> form once signed in.
        </p>
      </Section>
    </div>
  );
}
