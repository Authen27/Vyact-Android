#!/usr/bin/env bash
# Responsive audit: screenshots the Transactions + Reports views at several CSS
# widths on the booted emulator, by changing the display size/density and
# deep-linking to each route. Density is pinned to 320 (=2x), so CSS px = device
# px / 2. Run from the emulator-runner script (one line: `bash scripts/responsive-audit.sh`).
set +e

PKG=com.vyact.consumer

# Close any open drawer/overlay from prior steps.
adb shell input keyevent 4
sleep 1

adb shell wm density 320

# "cssWidth:deviceWxH" — covers tiny phone, common phones, tablet, desktop (lg:).
SIZES="320:640x1280 360:720x1440 412:824x1648 768:1536x2048 1024:2048x1536"

for entry in $SIZES; do
  css="${entry%%:*}"
  dim="${entry##*:}"
  echo "=== ${css}px CSS (device ${dim}) ==="
  adb shell wm size "$dim"
  sleep 3

  adb shell am start -W -a android.intent.action.VIEW -d "vyact://open/transactions" "$PKG"
  sleep 4
  adb exec-out screencap -p > "audit-txn-${css}.png"

  adb shell am start -W -a android.intent.action.VIEW -d "vyact://open/reports" "$PKG"
  sleep 4
  adb exec-out screencap -p > "audit-reports-${css}.png"
done

adb shell wm size reset
adb shell wm density reset
echo "responsive audit done"
