# Vyact — R8 keep rules for the release build.
#
# Android's default proguard-android-optimize.txt already keeps any class
# extending Activity/Service/BroadcastReceiver/ContentProvider that's declared
# in AndroidManifest.xml — which covers MainActivity, BudgetWidgetConfigActivity
# (Activity), and BudgetWidgetProvider/ExpenseWidgetProvider (AppWidgetProvider
# IS-A BroadcastReceiver). The rules below are for the part that ISN'T covered
# by that default: Capacitor's REFLECTION-based JS<->native bridge, which looks
# up @PluginMethod-annotated methods by NAME at runtime. R8 can rename or strip
# those without a keep rule, which would silently break the JS call with no
# compile-time error — the widget-sync bridge (WidgetBridgePlugin.refresh(),
# called from src/lib/widgets.ts) is exactly this shape.

# Keep every Capacitor plugin class + its bridge-dispatched methods intact,
# including custom ones (WidgetBridgePlugin) that aren't in Capacitor's own
# consumer-proguard-rules.
-keep @com.getcapacitor.annotation.CapacitorPlugin class * {
    @com.getcapacitor.PluginMethod public *;
}
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.PluginMethod public *;
}

# Belt-and-suspenders on the widget classes specifically — they're also
# referenced by exact fully-qualified name from AndroidManifest.xml
# (registered by scripts/inject-android-native.mjs), which is a second,
# independent reason they must keep their class name.
-keep class com.vyact.app.WidgetBridgePlugin { *; }
-keep class com.vyact.app.BudgetWidgetProvider { *; }
-keep class com.vyact.app.ExpenseWidgetProvider { *; }
-keep class com.vyact.app.BudgetWidgetConfigActivity { *; }
-keep class com.vyact.app.MainActivity { *; }
