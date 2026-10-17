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
export const POLICY_VERSION = '2026-10-13';
