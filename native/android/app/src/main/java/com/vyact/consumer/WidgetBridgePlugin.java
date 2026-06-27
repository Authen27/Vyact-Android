package com.vyact.consumer;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Lets the JS layer force an immediate redraw of the home-screen widgets after
// it writes fresh data to Preferences. JS: registerPlugin('WidgetBridge').refresh()
@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {

  @PluginMethod
  public void refresh(PluginCall call) {
    Context ctx = getContext();
    AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
    broadcastUpdate(ctx, mgr, ExpenseWidgetProvider.class);
    broadcastUpdate(ctx, mgr, BudgetWidgetProvider.class);
    call.resolve();
  }

  private void broadcastUpdate(Context ctx, AppWidgetManager mgr, Class<?> provider) {
    int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, provider));
    if (ids == null || ids.length == 0) return;
    Intent intent = new Intent(ctx, provider);
    intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
    intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
    ctx.sendBroadcast(intent);
  }
}
