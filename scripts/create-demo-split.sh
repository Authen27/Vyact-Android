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
# Diagnostic run confirmed: this WebView's a11y dump does NOT expose
# aria-label/placeholder for EMPTY inputs (only nodes with real visible text
# show up), so empty fields can't be found by matching their own label/name.
# Workarounds, confirmed against a captured on-screen text dump:
#  - Amount has no adjacent label at all (just the "$" sign) but IS autofocused
#    on open (SplitFormModal's AmountField autoFocus={!editing}) -> type directly.
#  - Description DOES have a "Description" mono-label div right before its
#    input -> --after finds the very next distinct element.
#  - The empty participant-2 Name input has no adjacent label either, but sits
#    at a known offset from "You": You(text) -> 0.00(You's share, has a value
#    so it's visible) -> [Name input] -> [share input] -> "Remove participant".
#    --skip 1 passes over the "0.00" node to land on the Name input.
type_text "120"
sleep 1

dump
coords=$(node scripts/ui-find.mjs "$DUMP" --after "Description")
if [ -z "$coords" ]; then echo "FAIL: could not locate the Description input"; node scripts/ui-find.mjs "$DUMP" --list; exit 0; fi
echo "tapping Description field at ($coords)"; adb shell input tap $coords
type_text "Dinner with Sam"
sleep 1

dump
coords=$(node scripts/ui-find.mjs "$DUMP" --after "You" --skip 1)
if [ -z "$coords" ]; then echo "FAIL: could not locate participant Name input"; node scripts/ui-find.mjs "$DUMP" --list; exit 0; fi
echo "tapping participant Name field at ($coords)"; adb shell input tap $coords
type_text "Sam"
sleep 1

# Expense requires an account/payment-method chip; seed data includes a
# "Chase Checking" asset which the account picker derives a chip from.
tap_by_text "Chase" || tap_by_text "Cash" || echo "WARN: no account chip matched — save may fail validation"
sleep 1

adb shell input keyevent 4   # dismiss the on-screen keyboard before locating Save
sleep 1

echo "=== saving ==="
# NOT tap_by_text "Add split" — case-insensitive substring matching would
# collide with the modal's own title ("Add Split") and the original page
# trigger button ("+ Add Split"), both of which likely precede the actual
# footer Save button ("Add split", lowercase s) in document order, risking a
# tap on inert title text. "Cancel" sits immediately before it in the footer
# (Cancel/Save button pair) and is unambiguous.
dump
coords=$(node scripts/ui-find.mjs "$DUMP" --after "Cancel")
if [ -z "$coords" ]; then echo "FAIL: could not locate the Save/Add-split button"; node scripts/ui-find.mjs "$DUMP" --list; exit 0; fi
echo "tapping Save button at ($coords)"; adb shell input tap $coords
sleep 3   # modal close + list re-render

echo "=== capturing populated Splits screenshot ==="
adb shell am start -W -a android.intent.action.VIEW -d "vyact://open/splits" "$PKG"
sleep 3
adb exec-out screencap -p > store-shot-3-splits-populated.png
echo "demo split flow complete"
