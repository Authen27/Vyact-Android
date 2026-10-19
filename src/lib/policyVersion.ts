// The version of the Terms / Privacy / Cookies text (an ISO date). One constant, shared by the pages that
// show it and the sign-up path that records which text a person accepted.
//
// Bump whenever the substance of the policy changes — it is rendered as
// "Last updated" on Privacy / Terms / Cookies and recorded against an account
// at sign-up, so it is the auditable record of WHICH text a user accepted.
// 2026-09-07: v10.20 rewrote the Ask Vyact disclosure. The assistant became
// model-backed and the previous text ("minimum context needed") was too vague
// to describe a feature that now calls a provider on every question.
// 2026-10-06: W0 (audit 2026-10-04) — removed the two-factor claim (no 2FA, owner
// decision), disclosed the Userback feedback widget, and Contentsquare session replay
// is gone from the app.
// 2026-10-07: W1b — account deletion is immediate (the 30-day schedule was never executed),
// an owner must hand over a shared household first, and WhatsApp messages are kept 90 days.
// W8a (audit XC-PRV-09): moved here from pages/Privacy.tsx so lib/auth.ts records THIS version — sign-ups
// were stamped '2026-07-01' while the pages showed '2026-10-07'.
// 2026-10-13: ADM-03 (owner decision) — Security says what staff can see in the admin console: that an
// action happened (its time and kind), never the amounts, names or descriptions.
// 2026-10-19: T4b (audit XC-PRV-03/08/09/10/11; owner decisions 19 Oct 2026) — analytics asked first on the
// web; 18 or older; the processors named with their regions (AWS Bedrock in Sydney and OpenRouter in the USA
// for Pip); rights under India's DPDP Act, grievance redressal and the breach process; what "Download my
// data" holds. People who accepted an older version are asked again (components/auth/PolicyUpdateSheet).
export const POLICY_VERSION = '2026-10-19';

/** What changed in POLICY_VERSION, one sentence each: the re-consent sheet lists them. */
export const POLICY_CHANGES: readonly string[] = [
  'Usage analytics (Google Analytics) is off on the web until you allow it, and you can change it in Settings. In the Vyact app it is part of the app\'s permissions.',
  'Vyact is for people 18 or older.',
  'We name who processes your data and where: Pip\'s language model runs on Amazon Web Services in Sydney, Australia, with OpenRouter in the USA as a fallback that is asked not to keep your data.',
  'Your rights under India\'s Digital Personal Data Protection Act, how to raise a grievance, and what we do if your data is ever breached.',
  '"Download my data" holds your household\'s transactions, splits, debts, accounts, net worth, recurring bills and household details.',
];

/** POLICY_VERSION (an ISO date) as people read it: "Oct 19, 2026". */
export function formatPolicyDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
