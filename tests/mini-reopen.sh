#!/bin/bash
set -uo pipefail
DMG="${1:-/tmp/Storage Studio KH-0.1.8.dmg}"
APP="/Applications/Storage Studio KH.app"
BIN="$APP/Contents/MacOS/Storage Studio KH"
pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "PASS  $1 ($2)"; pass=$((pass+1)); else echo "FAIL  $1 (got '$2', want '$3')"; fail=$((fail+1)); fi; }

hdiutil attach -nobrowse -mountpoint /tmp/ssdmg "$DMG" >/dev/null 2>&1 || { echo "FAIL mount"; exit 1; }
if [ -d "$APP" ]; then mv "$APP" "/tmp/ss-old-app-$(date +%s)"; fi
ditto "/tmp/ssdmg/Storage Studio KH.app" "$APP"
hdiutil detach /tmp/ssdmg >/dev/null 2>&1

# 1) hidden start, then LaunchServices activation (open -a) must reopen the window.
"$BIN" --start-hidden >/tmp/ss1.log 2>&1 &
sleep 3
check "hidden start has no onscreen window" "$(/tmp/wincheck)" "none"
open -a "$APP"
sleep 2
check "open -a reopens the window" "$(/tmp/wincheck | head -1 | cut -d' ' -f1)" "onscreen"
"$BIN" --quit >/dev/null 2>&1; sleep 2

# 2) hidden start, then a second instance (open -n -a) must reopen it.
"$BIN" --start-hidden >/tmp/ss2.log 2>&1 &
sleep 3
check "hidden start has no onscreen window (again)" "$(/tmp/wincheck)" "none"
open -n -a "$APP"
sleep 2
check "open -n -a reopens the window" "$(/tmp/wincheck | head -1 | cut -d' ' -f1)" "onscreen"
"$BIN" --quit >/dev/null 2>&1; sleep 2

# 3) show -> hide -> show hook.
out=$("$BIN" --show-once 2>/dev/null | grep SHOW_ONCE | tail -1)
check "show/hide/show hook" "$out" "SHOW_ONCE:shown=true after_hide_show=true"

echo "RESULT pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
