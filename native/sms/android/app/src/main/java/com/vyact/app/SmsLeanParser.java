package com.vyact.app;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Decides, while the app may be closed, whether a text message describes a completed bank / card /
 * wallet transaction — enough to raise the heads-up notification ("Spent USD 12.50 at STARBUCKS?").
 *
 * No Android imports on purpose: CI runs native/tools/SmsParityCheck.java against this class with
 * plain javac, using the same native/sms-fixtures.tsv as src/lib/sms/parser.ts (the authoritative
 * TypeScript parser that pre-fills the form). The rules below are a line-for-line port of that file —
 * change one, change the other, and add a fixture row.
 *
 * Android's regex engine (ICU) is NOT desktop Java's: keep to plain groups, look-around and the
 * case-insensitive flag. Pattern.UNICODE_CHARACTER_CLASS throws in a static initializer on a phone —
 * it crashed the receiver on its first real run — so whitespace is spelled out as a class instead.
 */
final class SmsLeanParser {

  static final class Result {
    final String dir;          // "debit" | "credit"
    final String amountText;   // normalised digits, "." decimal mark: "1200.00"
    final String currency;     // ISO 4217, or "" when the message states none
    final String counterparty; // may be null

    Result(String dir, String amountText, String currency, String counterparty) {
      this.dir = dir;
      this.amountText = amountText;
      this.currency = currency;
      this.counterparty = counterparty;
    }
  }

  private static final int CI = Pattern.CASE_INSENSITIVE;

  // ── 1. Gates ────────────────────────────────────────────────────────────────────────────────
  private static final Pattern[] REJECT = {
    // codes and secrets
    Pattern.compile("\\botp\\b|one[- ]time (?:password|pin|code)|verification code|do not share|don'?t share|never share|\\bcvv\\b|passcode|login code|security code", CI),
    // reminders, statements, summaries, things that have not happened yet
    Pattern.compile("\\b(?:due (?:on|by|date)|payment due|min(?:imum)? (?:amount )?due|total (?:amount )?due|statement (?:is )?(?:generated|ready)|bill (?:is )?(?:generated|due)|overdue|reminder|will be (?:debited|credited)|to be (?:debited|credited)|scheduled|upcoming|this (?:month|week)|so far|summary)\\b", CI),
    // did not happen
    Pattern.compile("\\b(?:declined|failed|unsuccessful|not successful|could not be processed|not processed|unable to (?:process|complete)|insufficient (?:funds|balance))\\b", CI),
    // marketing
    Pattern.compile("\\b(?:pre-?approved|apply now|limited time|offers? (?:valid|ends)|congratulations|click (?:here|on)|t&c apply|download the app|complete your kyc|update your kyc|lucky draw|you(?:'ve| have) won|use code|coupon|voucher|shop (?:now|today)|loan (?:up to|offer)|credit limit (?:increase|upgrade|enhanc))\\b|\\b(?:get|win|earn|save|avail|enjoy|claim)\\b[^.]{0,40}\\b(?:cashback|% ?off|discount|reward)\\b", CI),
    // requests for money, not movements of it
    Pattern.compile("\\b(?:requested|requests|requesting) (?:you|money|payment|rs|\\$)|collect request|payment request|approve (?:to|the|this|it)|has requested|please (?:pay|approve)|pay now|pay (?:before|by)\\b", CI),
  };

  private static final Pattern BALANCE = Pattern.compile(
    "\\b(?:avl\\.?|avail\\.?|available)\\s*bal(?:ance)?|\\bbal(?:ance)?\\s*(?:is|:|-)|\\btotal bal(?:ance)?|\\bledger bal(?:ance)?|\\bcredit limit|\\blimit available|\\bavailable limit", CI);

  // ── 2. Amount ───────────────────────────────────────────────────────────────────────────────
  private static final String CUR = "(?:rupees?|rs\\.?|inr|\\u20b9|us\\$|usd|\\$|eur|\\u20ac|gbp|\\u00a3|aed|sgd|s\\$|cad|c\\$|aud|a\\$|sar|qar|kwd|bhd|omr|myr|thb|idr|pkr|bdt|lkr|npr|zar|ngn|kes|brl|r\\$|mxn|jpy|cny|chf|sek|nok|dkk|nzd|nz\\$|hkd|hk\\$|krw)";
  private static final String CODE = "(?:inr|usd|eur|gbp|aed|sgd|cad|aud|sar|qar|kwd|bhd|omr|myr|thb|idr|pkr|bdt|lkr|npr|zar|ngn|kes|brl|mxn|jpy|cny|chf|sek|nok|dkk|nzd|hkd|krw|rupees?)";
  private static final String AMT = "\\d(?:[\\d,.]*\\d)?";
  private static final Pattern AMOUNT_PRE = Pattern.compile("(?<![A-Za-z])(" + CUR + ")\\s*(" + AMT + ")", CI);
  private static final Pattern AMOUNT_POST = Pattern.compile("(" + AMT + ")\\s*(" + CODE + ")\\b", CI);
  // No currency in the message: a number right after a debit/credit word, in a bank context.
  private static final Pattern AMOUNT_WEAK = Pattern.compile(
    "\\b(?:debited|credited|debit|credit|dr|cr|spent|paid|received|withdrawn|deposited|sent|amt|amount|txn|purchase|payment|transaction)\\b(?:\\s+(?:of|by|for|with|is|was))?[\\s:.\\-]*(" + AMT + ")", CI);
  private static final Pattern BANK_CONTEXT = Pattern.compile(
    "\\b(?:a/c|acct|account|card|upi|vpa|imps|neft|rtgs|ach|nach|ecs|atm|pos|wallet|bank)\\b|\\bx{2,}\\d{2,}\\b|\\*{2,}\\d{2,}|\\bending (?:in |with )?\\d{2,}", CI);

  // ── 3. Direction ────────────────────────────────────────────────────────────────────────────
  private static final Pattern DEBIT = Pattern.compile(
    "\\b(?:debited|debit (?:alert|of|for|with|by|from|txn)|dr|spent|purchase[ds]?|paid|withdrawn|withdrawal|wdl|wdrl|sent|charged|deducted|used (?:at|for|on)|transfer(?:red)? (?:(?!\\b(?:from|received|credited)\\b).){0,30}?\\bto|trf to|transaction (?:was )?(?:made|posted|charged)|was used|swiped|recharged?|bill ?pay(?:ment)?)\\b|\\bdebit\\b(?!\\s*cards?\\b)|\\bpayment of (?:(?!\\b(?:received|credited|deposited)\\b).){0,30}?\\bto\\b|\\bpos\\b", CI);
  private static final Pattern CREDIT = Pattern.compile(
    "\\b(?:credited|credit (?:alert|of|with|by|to|for|txn)|cr|received|deposited|deposit(?: of)?|refund(?:ed)?|salary|reversed|reversal|transfer(?:red)? (?:(?!\\b(?:to|sent|debited)\\b).){0,30}?\\bfrom|trf from|added to|paid you|sent you|interest (?:credited|paid|of))\\b|\\bcredit\\b(?!\\s*(?:cards?|limit|score|union|bureau)\\b)", CI);
  // Only when neither of the above appears: "Payment of Rs 500 successful", "Thank you for using your card ...".
  private static final Pattern DEBIT_FALLBACK = Pattern.compile(
    "\\b(?:payment|purchase|txn|transaction|order|bill|transfer)\\b.{0,40}?\\b(?:successful|successfully|completed|done|made|processed|approved|posted)\\b|\\bthank(?:s| you) for (?:using|shopping|paying)\\b|\\b(?:txn|transaction)\\b.{0,40}?(?:\\bat\\b|@)\\s*\\S", CI);

  // ── 4. The other party: a spend names where it went (at / to), a deposit where it came from ──
  private static final String NAME =
    "([A-Za-z0-9][A-Za-z0-9&@._*' -]{1,38}?)(?=\\s+(?:(?:on|via|using|ref|avl|bal|upi|txn|dated|for|from|card|a/c|acct|in|into|with|has|have|is|was|and|by|at)\\b|\\d{1,2}[-/.]\\d{1,2})|[.,;(]|$)";
  private static final Pattern COUNTERPARTY_DEBIT = Pattern.compile("\\b(?:at|to|towards|vpa|info:?)\\s+" + NAME, CI);
  private static final Pattern COUNTERPARTY_CREDIT = Pattern.compile("\\b(?:from|vpa|info:?)\\s+" + NAME, CI);
  private static final Pattern NOT_A_NAME = Pattern.compile("^(?:(?:your|you|card|credit|debit|account|acct)\\b|a/c|xx)|^[\\d\\s.,:/-]+$", CI);

  private static final Pattern SPACES = Pattern.compile("[\\s\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+");
  private static final Pattern PHONE_NUMBER = Pattern.compile("\\+?\\d{10,}");

  private SmsLeanParser() {}

  /** Null means "ignore this message". */
  static Result parse(String sender, String body) {
    if (body == null) return null;
    String text = SPACES.matcher(body).replaceAll(" ").trim();
    if (text.isEmpty()) return null;
    // A message from an ordinary phone number is a person, not a bank.
    String from = sender == null ? "" : sender.replaceAll("[\\s()-]", "");
    if (PHONE_NUMBER.matcher(from).matches()) return null;
    for (Pattern p : REJECT) if (p.matcher(text).find()) return null;

    // amount
    Matcher bal = BALANCE.matcher(text);
    String head = bal.find() && bal.start() > 0 ? text.substring(0, bal.start()) : text;
    Matcher pre = AMOUNT_PRE.matcher(head);
    Matcher post = AMOUNT_POST.matcher(head);
    boolean hasPre = pre.find();
    boolean hasPost = post.find();
    String raw = null;
    String cur = null;
    if (hasPre && (!hasPost || pre.start() <= post.start())) {
      cur = currencyOf(pre.group(1));
      raw = pre.group(2);
    } else if (hasPost) {
      cur = currencyOf(post.group(2));
      raw = post.group(1);
    } else if (BANK_CONTEXT.matcher(text).find()) {
      Matcher weak = AMOUNT_WEAK.matcher(head);
      if (weak.find()) { cur = ""; raw = weak.group(1); }
    }
    if (raw == null || cur == null) return null;
    String amountText = normalizeAmount(raw);
    if (amountText == null) return null;
    double amount;
    try { amount = Double.parseDouble(amountText); } catch (NumberFormatException e) { return null; }
    if (!(amount > 0) || Double.isInfinite(amount)) return null;

    // direction
    Matcher d = DEBIT.matcher(text);
    Matcher c = CREDIT.matcher(text);
    int di = d.find() ? d.start() : -1;
    int ci = c.find() ? c.start() : -1;
    if (di < 0 && ci < 0) {
      Matcher f = DEBIT_FALLBACK.matcher(text);
      di = f.find() ? f.start() : -1;
    }
    if (di < 0 && ci < 0) return null;
    String dir = ci >= 0 && (di < 0 || ci <= di) ? "credit" : "debit";

    // the other party
    String counterparty = null;
    Matcher m = ("debit".equals(dir) ? COUNTERPARTY_DEBIT : COUNTERPARTY_CREDIT).matcher(text);
    if (m.find()) {
      String name = m.group(1).trim().replaceAll("[^A-Za-z0-9]+$", "").replaceFirst("(?i)^vpa\\s+", "").trim();
      if (name.length() >= 2 && !NOT_A_NAME.matcher(name).find()) counterparty = name;
    }
    return new Result(dir, amountText, cur, counterparty);
  }

  /**
   * "1,200.00" "1.234,56" "89,00" "1,25,000" "500" -> "1200.00" "1234.56" "89.00" "125000" "500".
   * The LAST separator is the decimal mark when one or two digits follow it; every other separator is
   * a thousands mark; a single "." before exactly three digits ("1.234") is thousands.
   */
  static String normalizeAmount(String raw) {
    String s = raw;
    int dot = s.lastIndexOf('.');
    int comma = s.lastIndexOf(',');
    if (dot >= 0 && comma >= 0) {
      boolean decimalIsDot = dot > comma;
      s = s.replace(decimalIsDot ? "," : ".", "");
      if (!decimalIsDot) s = s.replace(',', '.');
    } else if (comma >= 0) {
      int frac = s.length() - comma - 1;
      s = frac >= 1 && frac <= 2
        ? s.substring(0, comma).replace(",", "") + "." + s.substring(comma + 1)
        : s.replace(",", "");
    } else if (dot >= 0) {
      int frac = s.length() - dot - 1;
      boolean multiple = s.indexOf('.') != dot;
      if (multiple || (frac == 3 && dot <= 3)) s = s.replace(".", "");
    }
    return s.matches("\\d+(?:\\.\\d{1,2})?") ? s : null;
  }

  private static String currencyOf(String token) {
    switch (token.toLowerCase(Locale.ROOT)) {
      case "rs": case "rs.": case "inr": case "\u20b9": case "rupee": case "rupees": return "INR";
      case "us$": case "usd": case "$": return "USD";
      case "eur": case "\u20ac": return "EUR";
      case "gbp": case "\u00a3": return "GBP";
      case "cad": case "c$": return "CAD";
      case "aud": case "a$": return "AUD";
      case "sgd": case "s$": return "SGD";
      case "nzd": case "nz$": return "NZD";
      case "hkd": case "hk$": return "HKD";
      case "brl": case "r$": return "BRL";
      case "aed": case "sar": case "qar": case "kwd": case "bhd": case "omr": case "myr": case "thb": case "idr":
      case "pkr": case "bdt": case "lkr": case "npr": case "zar": case "ngn": case "kes": case "mxn": case "jpy":
      case "cny": case "chf": case "sek": case "nok": case "dkk": case "krw":
        return token.toUpperCase(Locale.ROOT);
      default: return null;
    }
  }
}
