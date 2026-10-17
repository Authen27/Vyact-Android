#!/usr/bin/env bash
# Taps the on-screen element whose text / content-desc / hint contains "$1" (first match), found via
# `uiautomator dump` + scripts/ui-find.mjs — so CI never depends on hard-coded pixel coordinates
# that move whenever the app's layout does. Optional "$2" is a fallback needle tried if "$1" is absent.
# Exit 0 = tapped, 1 = not found (the screen's labels are printed to help fix the needle).
set +e

try_needle() {
  local needle="$1" coords
  [ -z "$needle" ] && return 1
  coords=$(node scripts/ui-find.mjs ui-dump.xml "$needle" 2>/dev/null)
  [ -z "$coords" ] && return 1
  echo "tap-label: '$needle' at $coords"
  adb shell input tap $coords
  return 0
}

adb shell uiautomator dump /sdcard/ui-dump.xml >/dev/null 2>&1
adb pull /sdcard/ui-dump.xml ui-dump.xml >/dev/null 2>&1

try_needle "$1" && exit 0
try_needle "$2" && exit 0
echo "tap-label: no match for '$1'${2:+ / '$2'} — labels on screen:"
node scripts/ui-find.mjs ui-dump.xml --list | head -40
exit 1
