package com.vyact.consumer;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

// Large widget: budget-used % for a chosen household (picked in the config
// activity, stored per widget id in "vyact_widgets"). Falls back to the
// currently-active household. Reads values written by widgets.ts.
public class BudgetWidgetProvider extends AppWidgetProvider {

  @Override
  public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
    for (int id : ids) render(ctx, mgr, id);
  }

  @Override
  public void onDeleted(Context ctx, int[] ids) {
    SharedPreferences.Editor e = ctx.getSharedPreferences("vyact_widgets", Context.MODE_PRIVATE).edit();
    for (int id : ids) e.remove("hid_" + id);
    e.apply();
  }

  static void render(Context ctx, AppWidgetManager mgr, int id) {
    SharedPreferences cap = ctx.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
    SharedPreferences cfg = ctx.getSharedPreferences("vyact_widgets", Context.MODE_PRIVATE);

    String hid = cfg.getString("hid_" + id, cap.getString("widget.currentHid", ""));
    String pctStr = cap.getString("widget.budget." + hid + ".pct", cap.getString("widget.budgetPct", "0"));
    String label = cap.getString("widget.budget." + hid + ".label", cap.getString("widget.householdName", "Household"));

    int pct = 0;
    try { pct = Integer.parseInt(pctStr.trim()); } catch (NumberFormatException ignored) {}
    int clamped = Math.max(0, Math.min(100, pct));

    RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_budget);
    v.setTextViewText(R.id.b_household, label);
    v.setTextViewText(R.id.b_caption, "Budget used");
    v.setTextViewText(R.id.b_pct, pct + "%");
    v.setProgressBar(R.id.b_progress, 100, clamped, false);
    v.setOnClickPendingIntent(R.id.b_root, ExpenseWidgetProvider.openUri(ctx, "vyact://open/budgets", 201));
    mgr.updateAppWidget(id, v);
  }
}
