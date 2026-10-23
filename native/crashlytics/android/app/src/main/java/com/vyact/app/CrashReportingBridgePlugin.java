package com.vyact.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.crashlytics.FirebaseCrashlytics;

// The one switch for crash reports. The manifest turns Crashlytics collection OFF
// (scripts/setup-crashlytics.mjs), so nothing is sent until the person turns it on in Settings, and
// this call is what turns it on or off. Crashlytics keeps the choice across launches; the JS side
// (src/lib/crashReporting.ts) also re-applies it at start, so the two cannot drift apart.
// JS: registerPlugin('CrashReporting').setEnabled({ enabled })
//
// This source lives outside native/android/ on purpose: setup-crashlytics.mjs copies it in only when
// the build has Firebase's config, because it imports the Crashlytics SDK, and MainActivity looks it up
// by name, so a build without the SDK never references it.
@CapacitorPlugin(name = "CrashReporting")
public class CrashReportingBridgePlugin extends Plugin {

  @PluginMethod
  public void setEnabled(PluginCall call) {
    boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
    FirebaseCrashlytics.getInstance().setCrashlyticsCollectionEnabled(enabled);
    call.resolve();
  }
}
