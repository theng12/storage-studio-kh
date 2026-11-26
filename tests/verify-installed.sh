#!/usr/bin/env bash
# Post-publish / post-build check on this Mac. Opens nothing and steals no focus: the app is
# run only through its hidden verification hooks and the release gate.
#
#   bash tests/verify-installed.sh [dist/Storage Studio KH-<version>.dmg]
set -euo pipefail
cd "$(dirname "$0")/.."

DMG="${1:-}"
APP="/Applications/Storage Studio KH.app"
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1" >&2; exit 1; }

if [ -n "$DMG" ]; then
  [ -f "$DMG" ] || fail "no DMG at $DMG"
  version="$(basename "$DMG" | sed -n 's/^Storage Studio KH-\(.*\)\.dmg$/\1/p')"
  [ -n "$version" ] || fail "the DMG name does not carry a version: $DMG"
  mount_point="$(mktemp -d /tmp/storage-studio-verify.XXXXXX)"
  hdiutil attach -nobrowse -mountpoint "$mount_point" "$DMG" >/dev/null
  trap 'hdiutil detach "$mount_point" >/dev/null 2>&1 || true' EXIT
  mounted="$mount_point/Storage Studio KH.app"
  [ -d "$mounted" ] || fail "the DMG does not hold Storage Studio KH.app"
  got="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$mounted/Contents/Info.plist")"
  [ "$got" = "$version" ] || fail "the DMG holds $got, not $version"
  codesign --verify --deep --strict "$mounted" || fail "the mounted app's signature is broken"
  [ -x "$mounted/Contents/Helpers/Storage Studio KH Helper.app/Contents/MacOS/Storage Studio KH Helper" ] || fail "the mounted app has no helper"
  if [ -d "$APP" ]; then
    trash="$HOME/Desktop/_trash/storage-studio-kh/installed-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$(dirname "$trash")"
    mv "$APP" "$trash"
    printf 'Previous install moved to %s\n' "$trash"
  fi
  ditto "$mounted" "$APP"
  hdiutil detach "$mount_point" >/dev/null
  trap - EXIT
  pass "installed $version from $(basename "$DMG")"
fi

BIN="$APP/Contents/MacOS/Storage Studio KH"
[ -x "$BIN" ] || fail "Storage Studio KH is not installed"
version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist")"
[ "$(/usr/libexec/PlistBuddy -c 'Print :LSUIElement' "$APP/Contents/Info.plist")" = "true" ] || fail "LSUIElement is not true"

# Login item: off before, on registers, off leaves nothing behind.
before="$("$BIN" --login-item-status)"
"$BIN" --login-item-on >/dev/null
on="$("$BIN" --login-item-status)"
"$BIN" --login-item-off >/dev/null
after="$("$BIN" --login-item-status)"
[ "$on" = "1" ] || fail "launch at login did not register (status $on)"
[ "$after" = "0" ] || fail "launch at login did not clear (status $after)"
pass "launch at login registers and clears (was $before)"

ls "$HOME/Library/LaunchAgents" 2>/dev/null | grep -qi storage && fail "a LaunchAgent file was left behind"
launchctl list 2>/dev/null | grep -qi storagestudio && fail "a launchd job was left behind"
pass "no launch agent or launchd job"

# Update check against the real feed (signature-checked, bounded).
updates="$("$BIN" --check-updates)"
printf 'update check: %s\n' "$updates"
echo "$updates" | grep -q 'state: "failed"' && fail "the update check failed: $updates"

# The release gate against the installed copy.
bash tests/gate.sh "$APP"
pass "installed $version verified"
