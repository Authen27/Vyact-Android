package com.vyact.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Telephony;
import android.telephony.SmsMessage;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/**
 * Receives each NEW text message (RECEIVE_SMS only — never the inbox), keeps it only if it looks like
 * a completed bank / card / wallet transaction, and raises a heads-up notification that opens the
 * normal Add-transaction form pre-filled. Nothing is ever saved from here: the person opens the
 * notification and taps Save, so every money-model rule of the manual flow still applies.
 */
public class SmsReceiver extends BroadcastReceiver {
  static final String CHANNEL_ID = "vyact_sms_detected";
  static final String ACTION_IGNORE = "com.vyact.app.SMS_IGNORE";

  @Override
  public void onReceive(Context ctx, Intent intent) {
    if (intent == null || !Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;
    if (!SmsStore.isEnabled(ctx)) return; // the in-app switch is the only way this does anything

    SmsMessage[] parts = Telephony.Sms.Intents.getMessagesFromIntent(intent);
    if (parts == null || parts.length == 0 || parts[0] == null) return;
    StringBuilder body = new StringBuilder();
    for (SmsMessage p : parts) if (p != null && p.getMessageBody() != null) body.append(p.getMessageBody());
    String sender = parts[0].getOriginatingAddress();
    long ts = parts[0].getTimestampMillis();
    if (ts <= 0) ts = System.currentTimeMillis();

    SmsLeanParser.Result r = SmsLeanParser.parse(sender, body.toString());
    if (r == null) return; // not a transaction: dropped, never stored

    String id = SmsStore.add(ctx, sender, body.toString(), ts, r);
    if (id == null) return; // a repeat

    notifyDetected(ctx, id, r);
  }

  private static void notifyDetected(Context ctx, String id, SmsLeanParser.Result r) {
    NotificationManagerCompat nm = NotificationManagerCompat.from(ctx);
    if (!nm.areNotificationsEnabled()) return; // the message stays queued; the Settings card says notifications are off
    ensureChannel(ctx);

    boolean debit = "debit".equals(r.dir);
    String money = r.currency + " " + r.amountText;
    String who = r.counterparty;
    String title = (debit ? "Spent " : "Received ") + money + (who != null ? (debit ? " at " : " from ") + who : "") + "?";

    PendingIntent open = PendingIntent.getActivity(ctx, id.hashCode(), openIntent(ctx, id),
      PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    Intent ignoreIntent = new Intent(ctx, SmsActionReceiver.class).setAction(ACTION_IGNORE).putExtra("id", id);
    PendingIntent ignore = PendingIntent.getBroadcast(ctx, ~id.hashCode(), ignoreIntent,
      PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

    // The lock screen shows no amount or merchant.
    NotificationCompat.Builder hidden = new NotificationCompat.Builder(ctx, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_stat_vyact_sms).setContentTitle("Possible transaction detected");

    NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_stat_vyact_sms)
      .setContentTitle(title)
      .setContentText("Tap to review it in Vyact. Nothing is saved until you do.")
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setCategory(NotificationCompat.CATEGORY_RECOMMENDATION)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setPublicVersion(hidden.build())
      .setAutoCancel(true)
      .setContentIntent(open)
      .addAction(0, "Add", open)
      .addAction(0, "Ignore", ignore);
    try {
      nm.notify(id.hashCode(), b.build());
    } catch (SecurityException e) {
      // POST_NOTIFICATIONS revoked between the check and now: the message stays queued.
    }
  }

  static Intent openIntent(Context ctx, String id) {
    Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse("vyact://sms/" + id));
    i.setClassName(ctx.getPackageName(), ctx.getPackageName() + ".MainActivity");
    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    return i;
  }

  private static void ensureChannel(Context ctx) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
    if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
    NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Detected bank messages", NotificationManager.IMPORTANCE_HIGH);
    ch.setDescription("Asks whether to add a payment or deposit found in a text message");
    ch.setLockscreenVisibility(android.app.Notification.VISIBILITY_PRIVATE);
    nm.createNotificationChannel(ch);
  }
}
