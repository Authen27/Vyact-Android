package com.vyact.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import androidx.core.app.NotificationManagerCompat;

/** The notification's "Ignore" button: forget the detected message and dismiss the notification. Not exported. */
public class SmsActionReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context ctx, Intent intent) {
    if (intent == null || !SmsReceiver.ACTION_IGNORE.equals(intent.getAction())) return;
    String id = intent.getStringExtra("id");
    if (id == null) return;
    SmsStore.remove(ctx, id);
    NotificationManagerCompat.from(ctx).cancel(id.hashCode());
  }
}
