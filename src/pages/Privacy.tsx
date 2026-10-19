import { Link } from 'react-router-dom';

// W8a (XC-PRV-09): the version lives in lib/policyVersion.ts; re-exported for the legal pages.
import { POLICY_VERSION } from '../lib/policyVersion';
export { POLICY_VERSION };

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
          there is an auditable record of consent. When this policy changes, Vyact asks you to accept the new version
          the next time you open it, and records that too.
        </p>
      </Section>

      <Section title="2. Personal data we collect" id="collect">
        <p><strong className="text-ink">Account &amp; identity data:</strong> name, email address, authentication identifiers, password hash (managed by our authentication provider — we never see or store your plaintext password), profile preferences, and optional phone number if you link WhatsApp.</p>
        <p><strong className="text-ink">Financial data you enter:</strong> transactions, budgets, debts, assets, accounts, goals, household members, recurring schedules, and any notes or categories you attach to them. This is data you control end-to-end — it exists because you typed it in or imported it.</p>
        <p><strong className="text-ink">Onboarding &amp; estimated reference data:</strong> the segment, concern, and starting financial snapshot you provide during onboarding is stored as a clearly labelled <em>estimated reference</em>, never written into your transaction ledger, and is automatically cleared once real activity supersedes it or you dismiss it.</p>
        <p><strong className="text-ink">Device &amp; usage data:</strong> IP address, browser/device type, session and sync metadata, and crash/error logs, used to operate and secure the Service. Product-usage events (which pages and features are used) go to Google Analytics only if you allow it: on the web we ask first, and you can change it any time in Settings → Usage analytics; in the Vyact Android app it is part of the app's permissions. They never contain the amounts, names or notes you record.</p>
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
        <p>We share personal data only with service providers who process it on our behalf under contractual confidentiality and data-protection terms, limited to what is necessary to run the Service. Who they are, what they do, and where:</p>
        <List items={[
          <><strong className="text-ink">Supabase</strong> — our database and sign-in: your account and household data, encrypted at rest and in transit. Region of the Vyact project: to be published here.</>,
          <><strong className="text-ink">Vercel</strong> (USA) — hosts the app and website and serves them from its global network. Its Speed Insights measures how fast pages load, without cookies.</>,
          <><strong className="text-ink">Amazon Web Services</strong> (Amazon Bedrock, Sydney, Australia) — the language model Pip uses to word its answers (Amazon Nova Lite). See &quot;How Pip uses a language model&quot; below.</>,
          <><strong className="text-ink">OpenRouter</strong> (USA) — a fallback route for Pip when Amazon Bedrock is unavailable. Every request asks OpenRouter to use only model providers that do not keep or train on what they receive.</>,
          <><strong className="text-ink">Google Analytics</strong> (Google, USA) — counts which pages and features are used, only if you allow it (on the web we ask first; in the Vyact Android app it is part of the app&apos;s permissions). Never your financial records.</>,
          <><strong className="text-ink">Userback</strong> — the in-app feedback widget on app pages. When you send feedback it can include a screenshot of the screen you are on and basic browser details; a screenshot can show the figures on that screen.</>,
          <><strong className="text-ink">Meta</strong> (WhatsApp Business Platform) — only if you link your WhatsApp number.</>,
          <><strong className="text-ink">Email delivery</strong> (MailerSend, Resend or our SMTP provider) — sends sign-in, invitation and split emails.</>,
          <><strong className="text-ink">Push services</strong> (Google, Apple, Microsoft or Mozilla, whichever your browser uses; in the Vyact Android app, Google&apos;s Firebase Cloud Messaging) — deliver your notifications to your device: their title and text, which say only what needs a look when &quot;Show details on the lock screen&quot; is off. In a browser they are sent once you turn them on; in the Android app they are on unless you turn them off in Settings.</>,
        ]} />
        <p>We may disclose information where required by law, to protect the rights, property, or safety of Vyact, our users, or the public, or in connection with a merger, acquisition, or sale of assets — in which case we will notify affected users before data is transferred under materially different terms.</p>

        <h3 className="font-display font-bold text-ink text-[15px] mt-6 mb-2">How Pip uses a language model</h3>
        <p>
          Pip, Vyact's assistant, answers your questions with the help of a large-language model: Amazon Nova Lite on
          Amazon Bedrock in Sydney, Australia, or, when that is unavailable, a model reached through OpenRouter in the
          USA that is asked not to keep or train on the request. These things leave Vyact each time you ask a
          question, and nothing else:
        </p>
        <List items={[
          <><strong className="text-ink">Your question, as you typed it</strong> — used only to work out what you are asking for.</>,
          <><strong className="text-ink">The answer Vyact has already calculated</strong> — the specific values that make up that one reply, such as an amount, a category name, a percentage, or the name you gave to a bill the answer mentions.</>,
          <><strong className="text-ink">The names of your accounts and assets</strong>, with their amounts, when the answer is about what you hold or where your money sits (for example &quot;HDFC Salary: ₹40,000&quot;). Never account numbers.</>,
        ]} />
        <p>
          Your transaction history is never sent. Neither is any account, budget, debt or household
          record that is not part of the answer you asked for. The model is not given your data to
          search through — it is given one question and one already-computed answer to put into words.
        </p>
        <p>
          <strong className="text-ink">The model never calculates money.</strong> Every amount in a
          reply comes from Vyact's own calculation on your data; the model's job is to put that
          answer into words. As a further check, replies are screened for amounts that do not match
          what was calculated, and a reply that fails is not shown to you.
        </p>
        <p>
          That screening is a safeguard, not a guarantee of correctness: it compares the numbers in a
          reply against the ones Vyact calculated, so it will not catch a correct figure that has
          been described the wrong way round. Pip is here to help you understand your money,
          not to replace your own judgement — and it is never financial advice.
        </p>
        <p>
          These requests are made by Vyact's own server, never by your browser, so no provider
          credential is ever present in the app you are running. If no model is configured or
          reachable, Pip tells you it is unavailable — it does not fall back to a guess.
        </p>
        <p>
          <strong className="text-ink">On WhatsApp.</strong> If you link a WhatsApp number and turn on
          &quot;Answer my questions here&quot;, Pip answers in that chat, so the answer, including its
          figures, is delivered through WhatsApp (Meta) and can appear in your phone&apos;s notifications.
          It is off until you turn it on, and you can turn it off at any time in Settings.
        </p>
      </Section>

      <Section title="6. Your rights and controls" id="rights">
        <p>Subject to applicable law (including GDPR, CCPA/CPRA, and similar regimes), you have the right to:</p>
        <List items={[
          <><strong className="text-ink">Access</strong> — download your household's data at any time from Settings → Sync &amp; Backup: its transactions, splits, debts, accounts, net worth (assets and the monthly history) and recurring bills, and the household itself (name, type, currency, members' names and roles). A CSV of transactions is there too. For anything else we hold about you, write to us (below).</>,
          <><strong className="text-ink">Correct</strong> — edit any transaction, profile field, or household record directly in the app.</>,
          <><strong className="text-ink">Erase</strong> — permanently delete all financial data in a household without closing your account, or permanently delete your account and all associated data. See Section 7 for exactly what each option does.</>,
          <><strong className="text-ink">Restrict / object</strong> — deactivate your account temporarily instead of deleting it.</>,
          <><strong className="text-ink">Portability</strong> — receive your data in a structured, machine-readable format (JSON/CSV).</>,
          <><strong className="text-ink">Withdraw consent</strong> — turn usage analytics off in Settings → Usage analytics, unlink WhatsApp in Settings, or write to us to withdraw consent for anything else, without affecting the lawfulness of earlier processing.</>,
        ]} />
        <h3 className="font-display font-bold text-ink text-[15px] mt-6 mb-2">In India: the Digital Personal Data Protection Act, 2023</h3>
        <p>
          For the purposes of the Act, Vyact is the Data Fiduciary for your personal data: <strong className="text-ink">Vyact</strong> (legal
          entity and registered address to be published here). You have the right to:
        </p>
        <List items={[
          'obtain a summary of the personal data we process about you and of the processing, and the identities of those we share it with;',
          'have your personal data corrected, completed, updated or erased;',
          'have a grievance about our handling of your data redressed by our Grievance Officer (below);',
          'nominate another person to exercise these rights for you if you die or become unable to — write to us with their name and contact details.',
        ]} />
        <p>
          <strong className="text-ink">Grievance Officer:</strong> name and contact to be published here. Until then, write to{' '}
          <a href="mailto:support@vyact.app?subject=Vyact%20grievance" className="text-coral hover:underline">support@vyact.app</a> with
          &quot;Grievance&quot; in the subject; we answer within the period the law sets. If you are not satisfied with the outcome,
          you can complain to the Data Protection Board of India.
        </p>
        <p>To exercise any right not self-serviceable in the app, email <a href="mailto:support@vyact.app?subject=Vyact%20Privacy%20rights%20request" className="text-coral hover:underline">support@vyact.app</a>. We respond to verifiable requests within 30 days (or the timeframe required by your local law, if shorter).</p>
      </Section>

      <Section title="7. Data erasure, deactivation, and deletion — what actually happens" id="erasure">
        <p>These controls are available directly in <strong className="text-ink">Settings → Danger Zone</strong>. Every action below requires entering a one-time verification code we send to your account email before it takes effect — proof the request really is coming from you, not just a signed-in browser.</p>
        <p><strong className="text-ink">Erase all household data (data wiped, account kept):</strong> permanently and irreversibly deletes every transaction, budget, debt, asset, account, goal, recurring schedule, saved view, and the onboarding reference for the selected household. Your login, profile, and household membership are kept so you can start fresh. This action cannot be undone — there is no backup retained by Vyact once you confirm it (we recommend exporting a backup first).</p>
        <p><strong className="text-ink">Deactivate account (temporary):</strong> immediately signs you out and places a hold on your account. Your data is <em>not deleted</em> — it is kept exactly as it was, inaccessible to anyone (including you) until you reactivate. See Section 8 for reactivation.</p>
        <p><strong className="text-ink">Delete account (permanent, immediate):</strong> deletes your account as soon as you confirm, in one step on our servers. We erase your profile, every household where you are the only member and all of its financial data, your membership in any shared households, your WhatsApp link and messages, your push-notification registrations, pending invitations addressed to you, and your login. In a household you share, the entries you added stay with that household (they are the household's records) and no longer name you. If you own a household other people use, you must first make one of them the owner — the household is never deleted out from under them. Deletion cannot be undone.</p>
      </Section>

      <Section title="8. Reactivation procedure" id="reactivation">
        <p>
          If you deactivated your account, simply sign back in with your existing credentials. Vyact
          detects the hold automatically on sign-in and clears it in the same step — you'll see a
          confirmation ("Welcome back — your account has been reactivated") and land back on your
          dashboard with all data intact, exactly as you left it. No support request is required.
        </p>
        <p>
          A deleted account cannot be reactivated — you would need to create a new account, and no
          prior data can be restored into it.
        </p>
      </Section>

      <Section title="9. Data retention" id="retention">
        <p>We retain personal data for as long as your account is active, plus a limited period afterward for legitimate business purposes (fraud prevention, legal compliance, dispute resolution) not to exceed what is necessary. Specifically:</p>
        <List items={[
          'Active account data: retained until you erase it, deactivate, or delete your account.',
          'Deactivated accounts: retained indefinitely on hold, restorable at any time by signing in.',
          'Deleted accounts: purged immediately when you confirm (see Section 7).',
          'WhatsApp messages (the text you send and receive, with your phone number): kept for 90 days for support and to retry anything that failed, then deleted automatically; deleted at once if you unlink WhatsApp or delete your account.',
          'Security and billing logs: retained up to 12 months for fraud/abuse prevention and legal compliance, then deleted or anonymized.',
        ]} />
      </Section>

      <Section title="10. Security" id="security">
        <p>We use industry-standard safeguards including encryption in transit (TLS) and at rest, row-level access controls scoped per household, and least-privilege service credentials. No method of transmission or storage is 100% secure; we continuously work to protect your data but cannot guarantee absolute security.</p>
        <p>In the admin console, Vyact staff can see that an action happened in a household (its time and kind), never the amounts, names or descriptions it changed.</p>
        <p><strong className="text-ink">If a breach happens.</strong> If personal data is accessed, lost or disclosed without authorisation, we will tell the people affected and the Data Protection Board of India, as the Digital Personal Data Protection Act requires, and, where the GDPR applies, the competent supervisory authority within 72 hours of becoming aware of it. We say what happened, what data was involved, what we are doing about it and what you can do.</p>
      </Section>

      <Section title="11. International transfers" id="transfers">
        <p>Vyact's providers process data outside India: Pip's language model in Australia (Amazon Web Services, Sydney) and, as a fallback, the USA (OpenRouter); usage analytics, if you allow it, in the USA (Google); and the hosting and database providers named in Section 5. Where required, we rely on appropriate safeguards (such as standard contractual clauses) to protect data transferred internationally.</p>
      </Section>

      <Section title="12. Children's privacy" id="children">
        <p>Vyact is for people 18 or older, and you confirm you are when you create an account. A child in your family does not have a Vyact account of their own, and we do not knowingly collect personal data from anyone under 18. If you believe a child has an account, write to us and we will delete it.</p>
      </Section>

      <Section title="13. Changes to this policy" id="changes">
        <p>We post changes here with a new version date. When the policy changes, Vyact shows you what changed the next time you open it and asks you to accept the new version before you continue; you can sign out instead, and ask us to delete your account.</p>
      </Section>

      <Section title="14. Contact" id="contact">
        <p>
          Questions about this policy or your data can be raised by emailing{' '}
          <a href="mailto:support@vyact.app?subject=Vyact%20Privacy%20question" className="text-coral hover:underline">support@vyact.app</a>,{' '}
          or via the{' '}
          <Link to="/help#contact" className="text-coral hover:underline">Help → Contact support</Link> form once signed in.
        </p>
      </Section>
    </div>
  );
}
