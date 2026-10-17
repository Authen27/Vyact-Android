// Vyact (Android sideload build) — recognise bank / card / wallet transaction text messages.
//
// Pure and deterministic: no network, no model, no store. Banks word the same event dozens of ways
// ("Rs 500 debited", "Acct XX12 Dr. 500.00", "You spent $12 at X", "Txn of INR 450 done", "Amt Sent
// Rs.350 To Y", "credited with", "Cr."), so this reads the MEANING of a message — is there a
// completed movement of money, which way, how much, in what currency, with whom — instead of
// matching one template. A message that does not clearly show a completed movement returns null,
// and null means "ignore it": a missed alert costs the user one manual entry, a wrong one costs
// trust. Nothing here saves anything: the result only pre-fills the normal Add-transaction form,
// and the person still taps Save (see SmsPromptBridge).
//
// The same rules are implemented in native/sms/android/.../SmsLeanParser.java (it decides whether to
// raise the heads-up notification while the app is closed). native/sms-fixtures.tsv is run against
// BOTH — vitest here, javac + java in CI — so the two cannot drift apart silently. Keep the
// regexes to what Android's ICU engine and desktop Java both accept (no named groups, no flags beyond
// case-insensitivity): the first on-device run crashed on Pattern.UNICODE_CHARACTER_CLASS.
//
// Reading order:  1 gates (a person? a code? a reminder? an offer? a failure?)
//                 2 amount (currency-marked, else a number next to a debit/credit word in a bank context)
//                 3 direction (debit / credit words; earliest wins)   4 the other party   5 hints

import { smartCategory } from '../../constants';
import type { Transaction } from '../../types';

export interface SmsDetection {
  direction: 'debit' | 'credit';
  /** Normalised digits, "." as the decimal mark, no separators ("1200.00"); parity-tested against Java. */
  amountText: string;
  amount: number;
  /** ISO 4217 from the symbol/code in the message, or '' when the message states none. */
  currency: string;
  /** The other party when the text names one ("STARBUCKS", "swiggy@icici"); otherwise null. */
  counterparty: string | null;
  /** Reads like a card-bill payment / own-account move: never offered as a plain expense/income. */
  maybeTransfer: boolean;
}

// ── 1. Gates: things that mention money but are not a completed transaction ───────────────────
const REJECT: RegExp[] = [
  // codes and secrets
  /\botp\b|one[- ]time (?:password|pin|code)|verification code|do not share|don'?t share|never share|\bcvv\b|passcode|login code|security code/i,
  // reminders, statements, summaries, things that have not happened yet
  /\b(?:due (?:on|by|date)|payment due|min(?:imum)? (?:amount )?due|total (?:amount )?due|statement (?:is )?(?:generated|ready)|bill (?:is )?(?:generated|due)|overdue|reminder|will be (?:debited|credited)|to be (?:debited|credited)|scheduled|upcoming|this (?:month|week)|so far|summary)\b/i,
  // did not happen
  /\b(?:declined|failed|unsuccessful|not successful|could not be processed|not processed|unable to (?:process|complete)|insufficient (?:funds|balance))\b/i,
  // marketing
  /\b(?:pre-?approved|apply now|limited time|offers? (?:valid|ends)|congratulations|click (?:here|on)|t&c apply|download the app|complete your kyc|update your kyc|lucky draw|you(?:'ve| have) won|use code|coupon|voucher|shop (?:now|today)|loan (?:up to|offer)|credit limit (?:increase|upgrade|enhanc))\b|\b(?:get|win|earn|save|avail|enjoy|claim)\b[^.]{0,40}\b(?:cashback|% ?off|discount|reward)\b/i,
  // requests for money, not movements of it
  /\b(?:requested|requests|requesting) (?:you|money|payment|rs|\$)|collect request|payment request|approve (?:to|the|this|it)|has requested|please (?:pay|approve)|pay now|pay (?:before|by)\b/i,
];

// The part of a message after these is a balance / limit, not the transaction amount.
const BALANCE = /\b(?:avl\.?|avail\.?|available)\s*bal(?:ance)?|\bbal(?:ance)?\s*(?:is|:|-)|\btotal bal(?:ance)?|\bledger bal(?:ance)?|\bcredit limit|\blimit available|\bavailable limit/i;

// ── 2. Amount ─────────────────────────────────────────────────────────────────────────────────
const CUR = '(?:rupees?|rs\\.?|inr|\\u20b9|us\\$|usd|\\$|eur|\\u20ac|gbp|\\u00a3|aed|sgd|s\\$|cad|c\\$|aud|a\\$|sar|qar|kwd|bhd|omr|myr|thb|idr|pkr|bdt|lkr|npr|zar|ngn|kes|brl|r\\$|mxn|jpy|cny|chf|sek|nok|dkk|nzd|nz\\$|hkd|hk\\$|krw)';
const CODE = '(?:inr|usd|eur|gbp|aed|sgd|cad|aud|sar|qar|kwd|bhd|omr|myr|thb|idr|pkr|bdt|lkr|npr|zar|ngn|kes|brl|mxn|jpy|cny|chf|sek|nok|dkk|nzd|hkd|krw|rupees?)';
const AMT = '\\d(?:[\\d,.]*\\d)?';
const AMOUNT_PRE = new RegExp(`(?<![A-Za-z])(${CUR})\\s*(${AMT})`, 'i');
const AMOUNT_POST = new RegExp(`(${AMT})\\s*(${CODE})\\b`, 'i');
// No currency in the message: accept a number only when it sits right after a debit/credit word...
const AMOUNT_WEAK = new RegExp(`\\b(?:debited|credited|debit|credit|dr|cr|spent|paid|received|withdrawn|deposited|sent|amt|amount|txn|purchase|payment|transaction)\\b(?:\\s+(?:of|by|for|with|is|was))?[\\s:.\\-]*(${AMT})`, 'i');
// ...and the message is plainly about an account, card or payment rail.
const BANK_CONTEXT = /\b(?:a\/c|acct|account|card|upi|vpa|imps|neft|rtgs|ach|nach|ecs|atm|pos|wallet|bank)\b|\bx{2,}\d{2,}\b|\*{2,}\d{2,}|\bending (?:in |with )?\d{2,}/i;

function currencyOf(token: string): string | null {
  switch (token.toLowerCase()) {
    case 'rs': case 'rs.': case 'inr': case '\u20b9': case 'rupee': case 'rupees': return 'INR';
    case 'us$': case 'usd': case '$': return 'USD';
    case 'eur': case '\u20ac': return 'EUR';
    case 'gbp': case '\u00a3': return 'GBP';
    case 'cad': case 'c$': return 'CAD';
    case 'aud': case 'a$': return 'AUD';
    case 'sgd': case 's$': return 'SGD';
    case 'nzd': case 'nz$': return 'NZD';
    case 'hkd': case 'hk$': return 'HKD';
    case 'brl': case 'r$': return 'BRL';
    case 'aed': case 'sar': case 'qar': case 'kwd': case 'bhd': case 'omr': case 'myr': case 'thb': case 'idr':
    case 'pkr': case 'bdt': case 'lkr': case 'npr': case 'zar': case 'ngn': case 'kes': case 'mxn': case 'jpy':
    case 'cny': case 'chf': case 'sek': case 'nok': case 'dkk': case 'krw':
      return token.toUpperCase();
    default: return null;
  }
}

/**
 * "1,200.00" "1.234,56" "89,00" "1,25,000" "500" -> "1200.00" "1234.56" "89.00" "125000" "500".
 * The LAST separator is the decimal mark when it is followed by one or two digits; every other
 * separator is a thousands mark. A single "." before exactly three digits ("1.234") is thousands.
 * Null when what is left is not a plain money amount.
 */
function normalizeAmount(raw: string): string | null {
  let s = raw;
  const dot = s.lastIndexOf('.');
  const comma = s.lastIndexOf(',');
  if (dot >= 0 && comma >= 0) {
    const dec = dot > comma ? '.' : ',';
    const thousands = dec === '.' ? ',' : '.';
    s = s.split(thousands).join('');
    if (dec === ',') s = s.replace(',', '.');
  } else if (comma >= 0) {
    const frac = s.length - comma - 1;
    s = frac >= 1 && frac <= 2 ? s.slice(0, comma).split(',').join('') + '.' + s.slice(comma + 1) : s.split(',').join('');
  } else if (dot >= 0) {
    const frac = s.length - dot - 1;
    const multiple = s.indexOf('.') !== dot;
    if (multiple || (frac === 3 && dot <= 3)) s = s.split('.').join('');
  }
  return /^\d+(?:\.\d{1,2})?$/.test(s) ? s : null;
}

// ── 3. Direction ──────────────────────────────────────────────────────────────────────────────
const DEBIT = /\b(?:debited|debit (?:alert|of|for|with|by|from|txn)|dr|spent|purchase[ds]?|paid|withdrawn|withdrawal|wdl|wdrl|sent|charged|deducted|used (?:at|for|on)|transfer(?:red)? (?:(?!\b(?:from|received|credited)\b).){0,30}?\bto|trf to|transaction (?:was )?(?:made|posted|charged)|was used|swiped|recharged?|bill ?pay(?:ment)?)\b|\bdebit\b(?!\s*cards?\b)|\bpayment of (?:(?!\b(?:received|credited|deposited)\b).){0,30}?\bto\b|\bpos\b/i;
const CREDIT = /\b(?:credited|credit (?:alert|of|with|by|to|for|txn)|cr|received|deposited|deposit(?: of)?|refund(?:ed)?|salary|reversed|reversal|transfer(?:red)? (?:(?!\b(?:to|sent|debited)\b).){0,30}?\bfrom|trf from|added to|paid you|sent you|interest (?:credited|paid|of))\b|\bcredit\b(?!\s*(?:cards?|limit|score|union|bureau)\b)/i;
// Only when neither of the above appears: "Payment of Rs 500 successful", "Thank you for using your card ...".
const DEBIT_FALLBACK = /\b(?:payment|purchase|txn|transaction|order|bill|transfer)\b.{0,40}?\b(?:successful|successfully|completed|done|made|processed|approved|posted)\b|\bthank(?:s| you) for (?:using|shopping|paying)\b|\b(?:txn|transaction)\b.{0,40}?(?:\bat\b|@)\s*\S/i;

const TRANSFER_HINT = /\b(?:credit card (?:payment|bill)|towards (?:your )?(?:credit )?card|self[- ]transfer|own (?:a\/c|account)|your (?:own|other) account|between your accounts|to (?:your )?(?:own )?(?:savings|checking|current) (?:a\/c|account))\b/i;

// ── 4. The other party ────────────────────────────────────────────────────────────────────────
// A spend names where the money went (at / to), a deposit where it came from — so "sent from HDFC
// Bank A/c to rahul@okhdfc" yields rahul, not the person's own bank.
const NAME = "([A-Za-z0-9][A-Za-z0-9&@._*' -]{1,38}?)(?=\\s+(?:(?:on|via|using|ref|avl|bal|upi|txn|dated|for|from|card|a/c|acct|in|into|with|has|have|is|was|and|by|at)\\b|\\d{1,2}[-/.]\\d{1,2})|[.,;(]|$)";
const COUNTERPARTY_DEBIT = new RegExp(`\\b(?:at|to|towards|vpa|info:?)\\s+${NAME}`, 'i');
const COUNTERPARTY_CREDIT = new RegExp(`\\b(?:from|vpa|info:?)\\s+${NAME}`, 'i');
const NOT_A_NAME = /^(?:(?:your|you|card|credit|debit|account|acct)\b|a\/c|xx)|^[\d\s.,:/-]+$/i;

export function parseSms(sender: string, body: string): SmsDetection | null {
  const text = body.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  // A message from an ordinary phone number is a person, not a bank.
  if (/^\+?\d{10,}$/.test((sender || '').replace(/[\s()-]/g, ''))) return null;
  if (REJECT.some(r => r.test(text))) return null;

  // amount
  const cut = text.search(BALANCE);
  const head = cut > 0 ? text.slice(0, cut) : text;
  const pre = AMOUNT_PRE.exec(head);
  const post = AMOUNT_POST.exec(head);
  let raw: string | null = null;
  let currency: string | null = null;
  if (pre && (!post || pre.index <= post.index)) { currency = currencyOf(pre[1]); raw = pre[2]; }
  else if (post) { currency = currencyOf(post[2]); raw = post[1]; }
  else if (BANK_CONTEXT.test(text)) {
    const weak = AMOUNT_WEAK.exec(head);
    if (weak) { currency = ''; raw = weak[1]; }
  }
  if (raw == null || currency == null) return null;
  const amountText = normalizeAmount(raw);
  if (amountText == null) return null;
  const amount = Number(amountText);
  if (!(amount > 0) || !Number.isFinite(amount)) return null;

  // direction
  let d = text.search(DEBIT);
  const c = text.search(CREDIT);
  if (d < 0 && c < 0) d = text.search(DEBIT_FALLBACK);
  if (d < 0 && c < 0) return null;
  const direction: 'debit' | 'credit' = c >= 0 && (d < 0 || c <= d) ? 'credit' : 'debit';

  // the other party
  let counterparty: string | null = null;
  const m = (direction === 'debit' ? COUNTERPARTY_DEBIT : COUNTERPARTY_CREDIT).exec(text);
  if (m) {
    const name = m[1].trim().replace(/[^A-Za-z0-9]+$/, '').replace(/^vpa\s+/i, '').trim();
    if (name.length >= 2 && !NOT_A_NAME.test(name)) counterparty = name;
  }

  return { direction, amountText, amount, currency, counterparty, maybeTransfer: TRANSFER_HINT.test(text) };
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
 *  - the amount is pre-filled when the message is in the household's currency, or states no currency
 *    at all (a bank texting its own customer in the account's currency — the person checks it in the
 *    form). When it names ANOTHER currency the amount stays blank and the note says what the message
 *    said, because the form labels a seeded amount with the base currency;
 *  - the raw message text is never put in the note (notes sync to the cloud).
 */
export function smsSeed(d: SmsDetection, opts: SeedOptions): Partial<Transaction> {
  const type: Transaction['type'] = d.maybeTransfer ? 'transfer' : d.direction === 'debit' ? 'expense' : 'income';
  const description = d.counterparty ?? tidySender(opts.sender) ?? '';
  const seed: Partial<Transaction> = { type, description, date: localDate(opts.receivedAt) };
  if (d.currency === '' || d.currency === opts.baseCurrency) seed.amount = d.amount;
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
