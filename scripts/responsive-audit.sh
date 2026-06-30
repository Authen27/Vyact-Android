#!/usr/bin/env bash
# Responsive audit: screenshots the Transactions + Reports views at several CSS
# widths on the booted emulator, by changing the display size/density and
# deep-linking to each route. Density is pinned to 320 (=2x), so CSS px = device
# px / 2. Run from the emulator-runner script (one line: `bash scripts/responsive-audit.sh`).
set +e

PKG=com.vyact.app

# Close any open drawer/overlay from prior steps.
adb shell input keyevent 4
sleep 1

adb shell wm density 320

# "cssWidth:deviceWxH" — covers tiny phone, common phones, tablet, desktop (lg:).
SIZES="320:640x1280 360:720x1440 412:824x1648 768:1536x2048 1024:2048x1536"

ROUTES="dashboard transactions budgets networth reports"

for entry in $SIZES; do
  css="${entry%%:*}"
  dim="${entry##*:}"
  echo "=== ${css}px CSS (device ${dim}) ==="
  adb shell wm size "$dim"
  sleep 3
  for route in $ROUTES; do
    adb shell am start -W -a android.intent.action.VIEW -d "vyact://open/${route}" "$PKG"
    sleep 4
    adb exec-out screencap -p > "audit-${route}-${css}.png"
  done
done

# FAB scroll-hide check (Transactions @ 412px): after scrolling down, the
# Ask Vyact + Add FABs should fade so they no longer cover the amount column.
adb shell wm size 824x1648
sleep 2
adb shell am start -W -a android.intent.action.VIEW -d "vyact://open/transactions" "$PKG"
sleep 4
adb shell input swipe 412 1300 412 400 250
sleep 2
adb exec-out screencap -p > audit-txn-fab-scrolled.png

# Ask Vyact close-bug check: open the drawer (tap the bottom-right FAB), screenshot
# so the close X is visible BELOW the status bar, then Back should close it.
adb shell wm size 1080x2280
adb shell wm density 480
sleep 2
adb shell am start -W -a android.intent.action.VIEW -d "vyact://open/dashboard" "$PKG"
sleep 3
adb shell input tap 966 1686
sleep 2
adb exec-out screencap -p > audit-askvyact-open.png
adb shell input keyevent 4
sleep 2
adb exec-out screencap -p > audit-askvyact-afterback.png

adb shell wm size reset
adb shell wm density reset
echo "responsive audit done"
