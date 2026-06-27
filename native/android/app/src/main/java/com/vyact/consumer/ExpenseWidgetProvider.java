package com.vyact.consumer;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.widget.RemoteViews;

// Small widget: today's income + spend, with a "+" that deep-links to the
// Add-Transaction modal. Reads values written by the JS bridge (widgets.ts)
// into the "CapacitorStorage" SharedPreferences.
public class ExpenseWidgetProvider extends AppWidgetProvider {

  @Override
  public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
    for (int id : ids) render(ctx, mgr, id);
  }

  static void render(Context ctx, AppWidgetManager mgr, int id) {
    SharedPreferences p = ctx.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
    String income = p.getString("widget.todayIncome", "—");
    String spend = p.getString("widget.todaySpend", "—");

    RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_expense);
    v.setTextViewText(R.id.w_income, income);
    v.setTextViewText(R.id.w_spend, spend);
    v.setOnClickPendingIntent(R.id.w_root, openUri(ctx, "vyact://open/dashboard", 101));
    v.setOnClickPendingIntent(R.id.w_add, openUri(ctx, "vyact://action/add-transaction", 102));
    mgr.updateAppWidget(id, v);
  }

  // Opens MainActivity with a vyact:// data URI that the web layer handles.
  static PendingIntent openUri(Context ctx, String uri, int requestCode) {
    Intent it = new Intent(Intent.ACTION_VIEW, Uri.parse(uri));
    it.setClass(ctx, MainActivity.class);
    it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
    return PendingIntent.getActivity(ctx, requestCode, it, flags);
  }
}
