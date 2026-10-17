package com.vyact.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The only place bank-message data is kept: this app's private SharedPreferences ("vyact_sms"),
 * on this phone. A detected message waits here (7 days, at most 50) until the person opens or
 * ignores its notification; it is never sent anywhere, and the web layer reads it only through
 * SmsBridgePlugin when they tap. Messages that do not look like a transaction are never stored.
 */
final class SmsStore {
  static final String PREFS = "vyact_sms";
  private static final String KEY_ENABLED = "enabled";
  private static final String KEY_QUEUE = "queue";
  private static final String KEY_SEEN = "seen";

  private static final long WEEK_MS = 7L * 24 * 3600 * 1000;
  private static final long DAY_MS = 24L * 3600 * 1000;
  private static final long DOUBLE_ALERT_MS = 10L * 60 * 1000; // a bank SMS and its UPI app both announce one payment
  private static final int MAX_QUEUE = 50;
  private static final int MAX_SEEN = 100;

  private SmsStore() {}

  private static SharedPreferences prefs(Context ctx) {
    return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
  }

  static boolean isEnabled(Context ctx) { return prefs(ctx).getBoolean(KEY_ENABLED, false); }

  static void setEnabled(Context ctx, boolean on) { prefs(ctx).edit().putBoolean(KEY_ENABLED, on).apply(); }

  /** Remembers the message and returns its id, or null if it is a repeat (same text, or the same amount just now). */
  static synchronized String add(Context ctx, String sender, String body, long ts, SmsLeanParser.Result r) {
    long now = System.currentTimeMillis();
    String hash = Integer.toHexString((sender + "|" + body).hashCode());
    String kind = r.dir + "|" + r.amountText + "|" + r.currency;

    JSONArray seen = readArray(ctx, KEY_SEEN);
    JSONArray keptSeen = new JSONArray();
    boolean repeat = false;
    for (int i = 0; i < seen.length(); i++) {
      JSONObject s = seen.optJSONObject(i);
      if (s == null || now - s.optLong("t") > DAY_MS) continue;
      if (hash.equals(s.optString("h")) || (kind.equals(s.optString("k")) && now - s.optLong("t") < DOUBLE_ALERT_MS)) repeat = true;
      keptSeen.put(s);
    }
    if (repeat) { writeArray(ctx, KEY_SEEN, keptSeen); return null; }

    String id = Long.toString(now, 36) + Integer.toHexString(hash.hashCode() & 0xfff);
    try {
      keptSeen.put(new JSONObject().put("h", hash).put("k", kind).put("t", now));
      writeArray(ctx, KEY_SEEN, tail(keptSeen, MAX_SEEN));

      JSONArray queue = purge(readArray(ctx, KEY_QUEUE), now);
      queue.put(new JSONObject()
        .put("id", id).put("sender", sender == null ? "" : sender).put("body", body).put("ts", ts)
        .put("dir", r.dir).put("amount", r.amountText).put("cur", r.currency)
        .put("cp", r.counterparty == null ? "" : r.counterparty));
      writeArray(ctx, KEY_QUEUE, tail(queue, MAX_QUEUE));
    } catch (JSONException e) {
      return null;
    }
    return id;
  }

  static synchronized JSONArray pending(Context ctx) {
    JSONArray q = purge(readArray(ctx, KEY_QUEUE), System.currentTimeMillis());
    writeArray(ctx, KEY_QUEUE, q);
    return q;
  }

  static synchronized void remove(Context ctx, String id) {
    JSONArray q = readArray(ctx, KEY_QUEUE);
    JSONArray kept = new JSONArray();
    for (int i = 0; i < q.length(); i++) {
      JSONObject o = q.optJSONObject(i);
      if (o != null && !id.equals(o.optString("id"))) kept.put(o);
    }
    writeArray(ctx, KEY_QUEUE, kept);
  }

  private static JSONArray purge(JSONArray q, long now) {
    JSONArray kept = new JSONArray();
    for (int i = 0; i < q.length(); i++) {
      JSONObject o = q.optJSONObject(i);
      if (o != null && now - o.optLong("ts") < WEEK_MS) kept.put(o);
    }
    return kept;
  }

  private static JSONArray tail(JSONArray a, int max) {
    if (a.length() <= max) return a;
    JSONArray out = new JSONArray();
    for (int i = a.length() - max; i < a.length(); i++) out.put(a.opt(i));
    return out;
  }

  private static JSONArray readArray(Context ctx, String key) {
    try { return new JSONArray(prefs(ctx).getString(key, "[]")); } catch (JSONException e) { return new JSONArray(); }
  }

  private static void writeArray(Context ctx, String key, JSONArray a) {
    prefs(ctx).edit().putString(key, a.toString()).apply();
  }
}
