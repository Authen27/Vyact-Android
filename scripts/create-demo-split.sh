#!/usr/bin/env bash
# Creates ONE demo split via live UI automation (runtime interaction only —
# does NOT touch seed.ts, which isn't part of the Android overlay and would
# be wiped by the next upstream sync). Uses `uiautomator dump` to find real
# on-screen element bounds rather than guessed pixel coordinates, so it's
# robust to layout specifics. Produces store-shot-3-splits-populated.png.
#
# Must run from the emulator-runner script as a single line
# (`bash scripts/create-demo-split.sh`) — each `script:` line runs in its own
# shell, so multi-step logic has to live in one file.
set +e
PKG=com.vyact.app
DUMP=/tmp/ui-dump.xml

dump() {
  adb shell uiautomator dump /sdcard/window_dump.xml >/dev/null 2>&1
  adb pull /sdcard/window_dump.xml "$DUMP" >/dev/null 2>&1
}

# tap_by_text <needle> [index] — dumps, finds the node, taps its center.
# On failure, dumps every visible text/content-desc to logs (diagnostic —
# tells us what's actually on screen instead of just "not found").
tap_by_text() {
  local needle="$1" idx="${2:-0}"
  dump
  local coords
  coords=$(node scripts/ui-find.mjs "$DUMP" "$needle" --index "$idx")
  if [ -z "$coords" ]; then
    echo "FAIL: could not find UI element matching '$needle'. On-screen text right now:"
    node scripts/ui-find.mjs "$DUMP" --list
    return 1
  fi
  echo "tapping '$needle' at ($coords)"
  adb shell input tap $coords
  return 0
}

type_text() {
  # adb `input text` treats a literal space as a keycode; %s is the documented escape.
  local escaped="${1// /%s}"
  adb shell input text "$escaped"
}

echo "=== navigating to Splits (empty state) ==="
adb shell am start -W -a android.intent.action.VIEW -d "vyact://open/splits" "$PKG"
sleep 4

echo "=== diagnostic: can uiautomator see WebView content at all? ==="
dump
node scripts/ui-find.mjs "$DUMP" "Splits" >/dev/null 2>&1
if [ $? -ne 0 ]; then
  echo "ABORT: uiautomator cannot see the WebView's accessibility tree (expected page text 'Splits' not found). Skipping demo-split creation — the empty-state screenshot will be used instead."
  exit 0
fi
echo "OK: WebView accessibility tree is visible."

tap_by_text "Add Split" || exit 0
sleep 5   # HalfSheet slide-up animation (framer-motion) needs more than 2s to settle

echo "=== filling the form ==="
tap_by_text "Amount" && type_text "120" || exit 0
sleep 1

tap_by_text "Description" && type_text "Dinner with Sam" || exit 0
sleep 1

# Participant row 2's name input has no aria-label; its placeholder "Name" is
# exposed as the accessible name (HTML-AAM: placeholder is the fallback
# accessible-name source when no label/aria-label exists).
tap_by_text "Name" && type_text "Sam" || exit 0
sleep 1

# Expense requires an account/payment-method chip; seed data includes a
# "Chase Checking" asset which the account picker derives a chip from.
tap_by_text "Chase" || tap_by_text "Cash" || echo "WARN: no account chip matched — save may fail validation"
sleep 1

adb shell input keyevent 4   # dismiss the on-screen keyboard before locating Save
sleep 1

echo "=== saving ==="
tap_by_text "Add split" || exit 0
sleep 3   # modal close + list re-render

echo "=== capturing populated Splits screenshot ==="
adb shell am start -W -a android.intent.action.VIEW -d "vyact://open/splits" "$PKG"
sleep 3
adb exec-out screencap -p > store-shot-3-splits-populated.png
echo "demo split flow complete"
