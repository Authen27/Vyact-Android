package com.vyact.app;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Decides, while the app may be closed, whether a text message looks like a completed bank / card /
 * wallet transaction — enough to raise the heads-up notification ("Spent USD 12.50 at STARBUCKS?").
 *
 * No Android imports on purpose: scripts/ci runs native/tools/SmsParityCheck.java against this
 * class with plain javac, using the same native/sms-fixtures.tsv as src/lib/sms/parser.ts (the
 * authoritative TypeScript parser that pre-fills the form). The rules below are a line-for-line port
 * of that file — change one, change the other, and add a fixture row.
 */
final class SmsLeanParser {

  static final class Result {
    final String dir;          // "debit" | "credit"
    final String amountText;   // digits as written, separators removed: "1200.00"
    final String currency;     // ISO 4217
    final String counterparty; // may be null

    Result(String dir, String amountText, String currency, String counterparty) {
      this.dir = dir;
      this.amountText = amountText;
      this.currency = currency;
      this.counterparty = counterparty;
    }
  }

  private static final int CI = Pattern.CASE_INSENSITIVE;

  private static final Pattern[] REJECT = {
    Pattern.compile("\\botp\\b|one[- ]time (?:password|pin|code)|verification code|do not share|don'?t share|never share|\\bcvv\\b|passcode|login code|security code", CI),
    Pattern.compile("\\b(?:due (?:on|by|date)|payment due|min(?:imum)? (?:amount )?due|total (?:amount )?due|statement (?:is )?(?:generated|ready)|bill (?:is )?(?:generated|due)|overdue|reminder|will be debited|scheduled)\\b", CI),
    Pattern.compile("\\b(?:declined|failed|unsuccessful|could not be processed|not processed|insufficient (?:funds|balance))\\b", CI),
    Pattern.compile("\\b(?:pre-?approved|apply now|limited time|offers? (?:valid|ends)|congratulations|click (?:here|on)|t&c apply|download the app|complete your kyc|update your kyc|lucky draw|you(?:'ve| have) won)\\b", CI),
  };

  private static final Pattern BALANCE = Pattern.compile(
    "\\b(?:avl\\.?|avail\\.?|available)\\s*bal(?:ance)?|\\bbal(?:ance)?\\s*(?:is|:|-)|\\btotal bal(?:ance)?|\\bledger bal(?:ance)?|\\bcredit limit|\\blimit available|\\bavailable limit", CI);

  private static final String CUR = "(?:rs\\.?|inr|\\u20b9|us\\$|usd|\\$|eur|\\u20ac|gbp|\\u00a3|aed|sgd|cad|aud|c\\$|a\\$)";
  private static final String AMT = "\\d(?:[\\d,]*\\d)?(?:\\.\\d{1,2})?";
  private static final Pattern AMOUNT_PRE = Pattern.compile("(?<![A-Za-z])(" + CUR + ")\\s*(" + AMT + ")", CI);
  private static final Pattern AMOUNT_POST = Pattern.compile("(" + AMT + ")\\s*(inr|usd|eur|gbp|aed|sgd|cad|aud)\\b", CI);

  private static final Pattern DEBIT = Pattern.compile(
    "\\b(?:debited|spent|purchase[ds]?|paid|withdrawn|withdrawal|sent|charged|deducted|used (?:at|for|on)|transferred to|transaction (?:was )?(?:made|posted|charged)|was used)\\b|\\bpayment of [^.]{0,30}?\\bto\\b|\\bpos\\b", CI);
  private static final Pattern CREDIT = Pattern.compile(
    "\\b(?:credited|received|deposited|deposit of|refund(?:ed)?|salary|reversed|reversal|transferred from|added to|paid you|sent you)\\b", CI);

  private static final Pattern COUNTERPARTY = Pattern.compile(
    "\\b(?:at|to|from|towards|vpa|info:?)\\s+([A-Za-z0-9][A-Za-z0-9&@._*' -]{1,38}?)(?=\\s+(?:on|via|using|ref|avl|bal|upi|txn|dated|for|from|card|a/c|acct|\\d{1,2}[-/.]\\d{1,2})|[.,;(]|$)", CI);
  private static final Pattern NOT_A_NAME = Pattern.compile("^(?:your|the|a/c|acct|account|card|credit|debit|you|xx|\\d)", CI);

  private static final Pattern SPACES = Pattern.compile("\\s+", Pattern.UNICODE_CHARACTER_CLASS);
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

    Matcher bal = BALANCE.matcher(text);
    String head = bal.find() && bal.start() > 0 ? text.substring(0, bal.start()) : text;

    Matcher pre = AMOUNT_PRE.matcher(head);
    Matcher post = AMOUNT_POST.matcher(head);
    boolean hasPre = pre.find();
    boolean hasPost = post.find();
    String raw;
    String cur;
    if (hasPre && (!hasPost || pre.start() <= post.start())) {
      cur = currencyOf(pre.group(1));
      raw = pre.group(2);
    } else if (hasPost) {
      cur = currencyOf(post.group(2));
      raw = post.group(1);
    } else {
      return null;
    }
    if (raw == null || cur == null) return null;
    String amountText = raw.replace(",", "");
    double amount;
    try { amount = Double.parseDouble(amountText); } catch (NumberFormatException e) { return null; }
    if (!(amount > 0) || Double.isInfinite(amount)) return null;

    Matcher d = DEBIT.matcher(text);
    Matcher c = CREDIT.matcher(text);
    int di = d.find() ? d.start() : -1;
    int ci = c.find() ? c.start() : -1;
    if (di < 0 && ci < 0) return null;
    String dir = ci >= 0 && (di < 0 || ci <= di) ? "credit" : "debit";

    String counterparty = null;
    Matcher m = COUNTERPARTY.matcher(text);
    if (m.find()) {
      String name = m.group(1).trim().replaceAll("[^A-Za-z0-9]+$", "").replaceFirst("(?i)^vpa\\s+", "").trim();
      if (name.length() >= 2 && !NOT_A_NAME.matcher(name).find()) counterparty = name;
    }
    return new Result(dir, amountText, cur, counterparty);
  }

  private static String currencyOf(String token) {
    switch (token.toLowerCase(Locale.ROOT)) {
      case "rs": case "rs.": case "inr": case "\u20b9": return "INR";
      case "us$": case "usd": case "$": return "USD";
      case "eur": case "\u20ac": return "EUR";
      case "gbp": case "\u00a3": return "GBP";
      case "aed": return "AED";
      case "sgd": return "SGD";
      case "cad": case "c$": return "CAD";
      case "aud": case "a$": return "AUD";
      default: return null;
    }
  }
}
