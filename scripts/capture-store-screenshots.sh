#!/usr/bin/env bash
# Captures clean, high-res phone screenshots for the Play listing from the
# local-only build on a booted emulator. Runs from the emulator-runner script.
set +e
PKG=com.vyact.consumer

adb shell wm size 1080x2280
adb shell wm density 440          # ~393px CSS — a typical large phone
adb shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1
sleep 30

i=1
for route in dashboard transactions budgets networth reports; do
  adb shell am start -W -a android.intent.action.VIEW -d "vyact://open/${route}" "$PKG"
  sleep 5
  adb exec-out screencap -p > "store-shot-${i}-${route}.png"
  i=$((i+1))
done

adb shell wm size reset
adb shell wm density reset
echo "store screenshots captured"
