package com.vyact.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

// Replaces Capacitor's generated MainActivity so we can register the local
// WidgetBridge plugin. Injected over the generated project at build time.
public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(WidgetBridgePlugin.class);
    super.onCreate(savedInstanceState);
  }
}
