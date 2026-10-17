#!/usr/bin/env bash
# Responsive audit: screenshots the app's main views at several CSS widths on the booted emulator,
# by changing the display size/density and deep-linking (vyact://open/<route>) to each route.
# Density is pinned to 320 (=2x), so CSS px = device px / 2. Run from the emulator-runner script
# (one line: `bash scripts/responsive-audit.sh`).
set +e

PKG=com.vyact.app

# Close any open drawer/overlay from prior steps.
adb shell input keyevent 4
sleep 1

adb shell wm density 320

# "cssWidth:deviceWxH" — covers tiny phone, common phones, tablet, desktop (lg:).
SIZES="320:640x1280 360:720x1440 412:824x1648 768:1536x2048 1024:2048x1536"

# Every width gets the core views; the rest of the app (Aurora 4.0 shell: Plan / Analyze sections,
# Pip, Households, Settings, Help) is checked at the two phone widths where it is tightest.
CORE_ROUTES="dashboard transactions budgets networth reports"
EXTRA_ROUTES="splits accounts debts recurring insights chat households settings help"
EXTRA_WIDTHS=" 320 412 "

for entry in $SIZES; do
  css="${entry%%:*}"
  dim="${entry##*:}"
  echo "=== ${css}px CSS (device ${dim}) ==="
  adb shell wm size "$dim"
  sleep 3
  routes="$CORE_ROUTES"
  case "$EXTRA_WIDTHS" in *" $css "*) routes="$CORE_ROUTES $EXTRA_ROUTES" ;; esac
  for route in $routes; do
    adb shell am start -W -a android.intent.action.VIEW -d "vyact://open/${route}" "$PKG"
    sleep 4
    adb exec-out screencap -p > "audit-${route}-${css}.png"
  done
done

# Scroll check (Transactions @ 412px): the header scrolls away and the bottom tab bar stays put
# over the rows — nothing may sit under the status bar or the tab bar.
adb shell wm size 824x1648
sleep 2
adb shell am start -W -a android.intent.action.VIEW -d "vyact://open/transactions" "$PKG"
sleep 4
adb shell input swipe 412 1300 412 400 250
sleep 2
adb exec-out screencap -p > audit-txn-scrolled.png

# Pip drawer close-bug check: open it from the tab bar's "Ask" slot, screenshot so the close X is
# visible BELOW the status bar, then hardware Back must close it.
adb shell wm size 1080x2280
adb shell wm density 480
sleep 2
adb shell am start -W -a android.intent.action.VIEW -d "vyact://open/dashboard" "$PKG"
sleep 3
bash scripts/tap-label.sh "Ask Pip" "Ask"
sleep 2
adb exec-out screencap -p > audit-askvyact-open.png
adb shell input keyevent 4
sleep 2
adb exec-out screencap -p > audit-askvyact-afterback.png

# Full-screen reel (Insights ▸ For you): its Close button must sit below the status bar.
adb shell am start -W -a android.intent.action.VIEW -d "vyact://open/insights" "$PKG"
sleep 4
bash scripts/tap-label.sh "Play highlights"
sleep 3
adb exec-out screencap -p > audit-reel-open.png
adb shell input keyevent 4
sleep 1

adb shell wm size reset
adb shell wm density reset
echo "responsive audit done"
