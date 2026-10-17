package com.vyact.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;

// Replaces Capacitor's generated MainActivity so we can register the local
// WidgetBridge plugin. Injected over the generated project at build time.
public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(WidgetBridgePlugin.class);
    registerOptionalPlugin("com.vyact.app.SmsBridgePlugin");
    super.onCreate(savedInstanceState);
  }

  // The bank-message plugin exists only in the SMS sideload build (scripts/patch-android-sms.mjs
  // copies its sources in). Looking it up by name keeps every other build — above all the Play
  // bundle — free of any reference to it, rather than relying on a flag to switch it off.
  private void registerOptionalPlugin(String className) {
    try {
      registerPlugin(Class.forName(className).asSubclass(Plugin.class));
    } catch (ClassNotFoundException absent) {
      // not in this build — expected
    }
  }
}
