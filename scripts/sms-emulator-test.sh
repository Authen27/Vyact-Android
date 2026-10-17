#!/usr/bin/env bash
# End-to-end check of bank-message detection on the booted emulator (SMS sideload build only).
# Runs from the ui-validation job's emulator step, which installed the LOCAL-ONLY build (boots straight
# to the dashboard, so a notification tap can reach the Add-transaction form). Skips itself unless
# SMS_ENABLED=true. Exit 1 if any assertion fails; screenshots are left for the job to publish.
#
#   1. detection switched on (preferences file — the Settings switch is the same flag)
#   2. a bank-style SMS  -> a "Spent USD 12.50 at STARBUCKS?" notification
#   3. the same SMS again, an OTP, a promo -> no new notification (dedupe + gate)
#   4. tap the notification -> the Add-transaction form opens pre-filled (STARBUCKS, 12.5)
#   5. a second SMS, tap Ignore -> the notification goes away
set +e
[ "$SMS_ENABLED" = "true" ] || { echo "sms-emulator-test: SMS_ENABLED is not true — skipping"; exit 0; }

PKG=com.vyact.app
fails=0
ok()   { echo "SMS-TEST PASS: $1"; }
fail() { echo "SMS-TEST FAIL: $1"; fails=$((fails+1)); }
notifs() { adb shell dumpsys notification --noredact; }
count() { notifs | grep -c "$1"; }          # occurrences of a string in the notification dump

# 1 — switch detection on. The app process is killed first (not force-stopped: a stopped app gets no
# broadcasts) so the receiver's fresh process reads the file instead of a cached preference.
adb shell input keyevent 3
adb shell am kill $PKG
adb push native/tools/vyact_sms_enabled.xml /data/local/tmp/vyact_sms.xml >/dev/null
adb shell run-as $PKG mkdir -p shared_prefs
adb shell run-as $PKG cp /data/local/tmp/vyact_sms.xml shared_prefs/vyact_sms.xml
adb shell pm grant $PKG android.permission.RECEIVE_SMS
adb shell pm grant $PKG android.permission.POST_NOTIFICATIONS
adb shell dumpsys package $PKG | grep -q "android.permission.RECEIVE_SMS: granted=true" && ok "RECEIVE_SMS granted" || fail "RECEIVE_SMS not granted"
adb logcat -c

# 2 — a bank-style message raises the notification
adb emu sms send 227898 'Chase: You spent $12.50 at STARBUCKS on 10/17 with card ending 1234.'
sleep 6
first=$(count "Spent USD 12.50 at STARBUCKS")
[ "$first" -ge 1 ] && ok "bank SMS raised a notification" || { fail "no notification for the bank SMS"; adb logcat -d | grep -iE "SmsReceiver|vyact" | tail -20; }

# 3 — repeat, OTP and promo are ignored
before=$(count "pkg=$PKG")
adb emu sms send 227898 'Chase: You spent $12.50 at STARBUCKS on 10/17 with card ending 1234.'
sleep 3
adb emu sms send 227898 '123456 is your OTP for transaction of $50.00 at AMAZON. Do not share.'
sleep 3
adb emu sms send 227898 'Pre-approved loan of $5,000! Apply now. T&C apply'
sleep 3
after=$(count "pkg=$PKG")
[ "$after" = "$before" ] && ok "repeat / OTP / promo raised nothing" || fail "extra notifications appeared ($before -> $after)"

# 4 — open it: the form must come up pre-filled
adb shell cmd statusbar expand-notifications
sleep 2
adb exec-out screencap -p > sms-shade.png
if bash scripts/tap-label.sh "Spent USD 12.50"; then
  sleep 10
  adb shell uiautomator dump /sdcard/sms-form.xml >/dev/null 2>&1
  adb pull /sdcard/sms-form.xml sms-form.xml >/dev/null 2>&1
  adb exec-out screencap -p > sms-form.png
  grep -q "STARBUCKS" sms-form.xml && ok "form opened with the merchant pre-filled" || fail "form missing STARBUCKS"
  grep -qE '12\.5' sms-form.xml && ok "form opened with the amount pre-filled" || fail "form missing the amount"
else
  fail "could not tap the notification"
fi

# 5 — Ignore dismisses and forgets
adb shell input keyevent 3
sleep 1
adb emu sms send 227898 'Chase: You spent $7.25 at BLUE BOTTLE on 10/17 with card ending 1234.'
sleep 6
[ "$(count 'Spent USD 7.25')" -ge 1 ] && ok "second SMS raised a notification" || fail "second SMS raised nothing"
adb shell cmd statusbar expand-notifications
sleep 2
if bash scripts/tap-label.sh "Ignore"; then
  sleep 3
  [ "$(count 'Spent USD 7.25')" = "0" ] && ok "Ignore removed the notification" || fail "notification still present after Ignore"
else
  fail "could not tap Ignore"
fi
adb shell cmd statusbar collapse

echo "SMS-TEST done: $fails failure(s)"
[ "$fails" = "0" ]
