// Vyact (Android sideload build) — recognise bank / card / wallet transaction text messages.
//
// Pure and deterministic: no network, no model, no store. A message that does not clearly look
// like a completed money movement returns null, and null means "ignore it" — a missed alert costs
// the user one manual entry, a wrong one costs trust. Nothing here saves anything: the result only
// pre-fills the normal Add-transaction form, and the person still taps Save (see SmsPromptBridge).
//
// The same rules are implemented in native/sms/android/.../SmsLeanParser.java (it decides whether
// to raise the heads-up notification while the app is closed). native/sms-fixtures.tsv is run
// against BOTH — vitest here, javac + java in CI — so the two cannot drift apart silently.

import { smartCategory } from '../../constants';
import type { Transaction } from '../../types';

export interface SmsDetection {
  direction: 'debit' | 'credit';
  /** Digits as written, thousands separators removed ("1200.00"); parity-tested against Java. */
  amountText: string;
  amount: number;
  /** ISO 4217, from the symbol or code in the message. */
  currency: string;
  /** The other party when the text names one ("STARBUCKS", "swiggy@icici"); otherwise null. */
  counterparty: string | null;
  /** Reads like a card-bill payment / own-account move: never offered as a plain expense/income. */
  maybeTransfer: boolean;
}

// ── Reject: things that mention money but are not a completed transaction ──────────────────
const REJECT: RegExp[] = [
  // codes and secrets
  /\botp\b|one[- ]time (?:password|pin|code)|verification code|do not share|don'?t share|never share|\bcvv\b|passcode|login code|security code/i,
  // reminders, statements, future debits
  /\b(?:due (?:on|by|date)|payment due|min(?:imum)? (?:amount )?due|total (?:amount )?due|statement (?:is )?(?:generated|ready)|bill (?:is )?(?:generated|due)|overdue|reminder|will be debited|scheduled)\b/i,
  // did not happen
  /\b(?:declined|failed|unsuccessful|could not be processed|not processed|insufficient (?:funds|balance))\b/i,
  // marketing
  /\b(?:pre-?approved|apply now|limited time|offers? (?:valid|ends)|congratulations|click (?:here|on)|t&c apply|download the app|complete your kyc|update your kyc|lucky draw|you(?:'ve| have) won)\b/i,
];

// The part of a message after these is a balance / limit, not the transaction amount.
const BALANCE = /\b(?:avl\.?|avail\.?|available)\s*bal(?:ance)?|\bbal(?:ance)?\s*(?:is|:|-)|\btotal bal(?:ance)?|\bledger bal(?:ance)?|\bcredit limit|\blimit available|\bavailable limit/i;

const CUR = '(?:rs\\.?|inr|\\u20b9|us\\$|usd|\\$|eur|\\u20ac|gbp|\\u00a3|aed|sgd|cad|aud|c\\$|a\\$)';
const AMT = '\\d(?:[\\d,]*\\d)?(?:\\.\\d{1,2})?';
const AMOUNT_PRE = new RegExp(`(?<![A-Za-z])(${CUR})\\s*(${AMT})`, 'i');
const AMOUNT_POST = new RegExp(`(${AMT})\\s*(inr|usd|eur|gbp|aed|sgd|cad|aud)\\b`, 'i');

const CURRENCY_OF: Record<string, string> = {
  'rs': 'INR', 'rs.': 'INR', 'inr': 'INR', '₹': 'INR',
  'us$': 'USD', 'usd': 'USD', '$': 'USD',
  'eur': 'EUR', '€': 'EUR',
  'gbp': 'GBP', '£': 'GBP',
  'aed': 'AED', 'sgd': 'SGD',
  'cad': 'CAD', 'c$': 'CAD',
  'aud': 'AUD', 'a$': 'AUD',
};

const DEBIT = /\b(?:debited|spent|purchase[ds]?|paid|withdrawn|withdrawal|sent|charged|deducted|used (?:at|for|on)|transferred to|transaction (?:was )?(?:made|posted|charged)|was used)\b|\bpayment of [^.]{0,30}?\bto\b|\bpos\b/i;
const CREDIT = /\b(?:credited|received|deposited|deposit of|refund(?:ed)?|salary|reversed|reversal|transferred from|added to|paid you|sent you)\b/i;

const TRANSFER_HINT = /\b(?:credit card (?:payment|bill)|towards (?:your )?(?:credit )?card|self[- ]transfer|own (?:a\/c|account)|your (?:own|other) account|between your accounts)\b/i;

const COUNTERPARTY = /\b(?:at|to|from|towards|vpa|info:?)\s+([A-Za-z0-9][A-Za-z0-9&@._*' -]{1,38}?)(?=\s+(?:on|via|using|ref|avl|bal|upi|txn|dated|for|from|card|a\/c|acct|\d{1,2}[-/.]\d{1,2})|[.,;(]|$)/i;
const NOT_A_NAME = /^(?:your|the|a\/c|acct|account|card|credit|debit|you|xx|\d)/i;

export function parseSms(sender: string, body: string): SmsDetection | null {
  const text = body.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  // A message from an ordinary phone number is a person, not a bank.
  if (/^\+?\d{10,}$/.test((sender || '').replace(/[\s()-]/g, ''))) return null;
  if (REJECT.some(r => r.test(text))) return null;

  const cut = text.search(BALANCE);
  const head = cut > 0 ? text.slice(0, cut) : text;

  const pre = AMOUNT_PRE.exec(head);
  const post = AMOUNT_POST.exec(head);
  let raw: string | null = null;
  let cur: string | null = null;
  if (pre && (!post || pre.index <= post.index)) { cur = CURRENCY_OF[pre[1].toLowerCase()]; raw = pre[2]; }
  else if (post) { cur = CURRENCY_OF[post[2].toLowerCase()]; raw = post[1]; }
  if (!raw || !cur) return null;
  const amountText = raw.replace(/,/g, '');
  const amount = Number(amountText);
  if (!(amount > 0) || !Number.isFinite(amount)) return null;

  const d = text.search(DEBIT);
  const c = text.search(CREDIT);
  if (d < 0 && c < 0) return null;
  const direction: 'debit' | 'credit' = c >= 0 && (d < 0 || c <= d) ? 'credit' : 'debit';

  let counterparty: string | null = null;
  const m = COUNTERPARTY.exec(text);
  if (m) {
    const name = m[1].trim().replace(/[^A-Za-z0-9]+$/, '').replace(/^vpa\s+/i, '').trim();
    if (name.length >= 2 && !NOT_A_NAME.test(name)) counterparty = name;
  }

  return { direction, amountText, amount, currency: cur, counterparty, maybeTransfer: TRANSFER_HINT.test(text) };
}

export interface SeedOptions {
  /** The household's base currency: the form never takes a currency from a seed. */
  baseCurrency: string;
  /** When the message arrived (epoch ms). */
  receivedAt: number;
  /** The sender id, used as the description when the text names no other party. */
  sender?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/**
 * The pre-fill for the Add-transaction form. Rules that keep the money model honest:
 *  - a card-bill payment / own-account move is seeded as a TRANSFER (no category, the person picks
 *    both accounts), never as spending or income;
 *  - the amount is pre-filled only when the message is in the household's currency — the form
 *    labels a seeded amount with the base currency, so an INR amount in a USD household would be
 *    recorded as dollars. Otherwise the amount stays blank and the note says what the message said;
 *  - the raw message text is never put in the note (notes sync to the cloud).
 */
export function smsSeed(d: SmsDetection, opts: SeedOptions): Partial<Transaction> {
  const type: Transaction['type'] = d.maybeTransfer ? 'transfer' : d.direction === 'debit' ? 'expense' : 'income';
  const description = d.counterparty ?? tidySender(opts.sender) ?? '';
  const seed: Partial<Transaction> = { type, description, date: localDate(opts.receivedAt) };
  if (d.currency === opts.baseCurrency) seed.amount = d.amount;
  else seed.note = `The bank message said ${d.currency} ${d.amountText}. Enter the amount in ${opts.baseCurrency}.`;
  if (type === 'expense') {
    const cat = smartCategory(description, 'expense');
    if (cat !== 'other_exp') seed.category = cat; // else leave it for the form's own suggestion / picker
  }
  return seed;
}

function tidySender(sender?: string): string | null {
  const s = (sender ?? '').replace(/^[A-Z]{2}-/, '').trim();
  return s && !/^\d+$/.test(s) ? s : null;
}
