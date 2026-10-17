package com.vyact.app;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;

import androidx.core.content.ContextCompat;
import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;

/**
 * JS: registerPlugin('SmsBridge'). Only exists in the SMS sideload build (MainActivity registers it
 * by reflection if the class is present), and only does anything once the person has switched
 * detection on in Settings. See src/lib/sms/bridge.ts.
 */
@CapacitorPlugin(
  name = "SmsBridge",
  permissions = { @Permission(alias = "sms", strings = { Manifest.permission.RECEIVE_SMS }) }
)
public class SmsBridgePlugin extends Plugin {

  private boolean declared() {
    try {
      Context ctx = getContext();
      PackageInfo info = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), PackageManager.GET_PERMISSIONS);
      if (info.requestedPermissions == null) return false;
      for (String p : info.requestedPermissions) if (Manifest.permission.RECEIVE_SMS.equals(p)) return true;
    } catch (PackageManager.NameNotFoundException ignored) { /* falls through */ }
    return false;
  }

  private JSObject state() {
    Context ctx = getContext();
    JSObject o = new JSObject();
    o.put("declared", declared());
    o.put("granted", ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED);
    o.put("enabled", SmsStore.isEnabled(ctx));
    o.put("notificationsOn", NotificationManagerCompat.from(ctx).areNotificationsEnabled());
    o.put("pending", SmsStore.pending(ctx).length());
    return o;
  }

  @PluginMethod
  public void getState(PluginCall call) { call.resolve(state()); }

  /** Asks Android for RECEIVE_SMS. On a sideloaded app the system may refuse silently until "Allow restricted settings" is on. */
  @PluginMethod
  public void requestPermission(PluginCall call) {
    if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED) {
      call.resolve(state());
      return;
    }
    requestPermissionForAlias("sms", call, "permissionResult");
  }

  @PermissionCallback
  private void permissionResult(PluginCall call) { call.resolve(state()); }

  @PluginMethod
  public void setEnabled(PluginCall call) {
    boolean on = Boolean.TRUE.equals(call.getBoolean("enabled", false));
    SmsStore.setEnabled(getContext(), on);
    call.resolve(state());
  }

  /** The detected messages still waiting (the web layer reads one when its notification is opened). */
  @PluginMethod
  public void drain(PluginCall call) {
    resolveItems(call, SmsStore.pending(getContext()));
  }

  @PluginMethod
  public void markHandled(PluginCall call) {
    String id = call.getString("id");
    if (id != null) {
      SmsStore.remove(getContext(), id);
      NotificationManagerCompat.from(getContext()).cancel(id.hashCode());
    }
    call.resolve();
  }

  private static void resolveItems(PluginCall call, JSONArray items) {
    JSObject o = new JSObject();
    o.put("items", items);
    call.resolve(o);
  }
}
