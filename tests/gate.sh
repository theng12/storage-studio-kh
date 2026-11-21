#!/usr/bin/env bash
# Release gate for Storage Studio KH. Every run uses its own data folder under $TMPDIR and
# launches the app hidden and detached: no window, no focus stealing, no login item.
#
#   bash tests/gate.sh [path/to/Storage Studio KH.app]
#
# Checks: launch, helper child, bounded retry -> needs attention, second launch handled
# plainly, graceful quit stops the helper, and nothing is left behind.
set -euo pipefail
cd "$(dirname "$0")/.."

APP="${1:-src-tauri/target/release/bundle/macos/Storage Studio KH.app}"
BIN="$APP/Contents/MacOS/Storage Studio KH"
HELPER="$APP/Contents/Helpers/Storage Studio KH Helper.app/Contents/MacOS/Storage Studio KH Helper"
[ -x "$BIN" ] || { echo "no app executable at $BIN"; exit 2; }
[ -x "$HELPER" ] || { echo "no helper inside the app at $HELPER"; exit 2; }
[ "$(/usr/libexec/PlistBuddy -c 'Print :LSUIElement' "$APP/Contents/Info.plist" 2>/dev/null)" = "true" ] \
  || { echo "LSUIElement must be true: this is a menu-bar app"; exit 2; }
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleDisplayName' "$APP/Contents/Helpers/Storage Studio KH Helper.app/Contents/Info.plist" 2>/dev/null)" = "Storage Studio KH Helper" ] \
  || { echo "the helper must be named Storage Studio KH Helper"; exit 2; }

RUN="$(mktemp -d "${TMPDIR:-/tmp}/storage-studio-gate.XXXXXX")"
DATA="$RUN/home"
mkdir -p "$DATA/Library/Application Support/Storage Studio KH"
LOG="$DATA/Library/Application Support/Storage Studio KH/log.txt"
export HOME="$DATA"
export STORAGE_STUDIO_TEST_DATA_DIR="$DATA"
export STORAGE_STUDIO_NO_NOTIFICATIONS=1
export STORAGE_STUDIO_NO_LOGIN_ITEM=1
export STORAGE_STUDIO_RETRY_DELAYS=0.2,0.3
# The slow schedule that keeps trying a storage the NAS took away, shortened for the gate.
export STORAGE_STUDIO_SLOW_RETRY_S=0.2
export STORAGE_STUDIO_SLOW_RETRIES=2
# Its own loopback port for the update hold, so a running copy of the app never collides.
export STORAGE_STUDIO_HOLD_PORT=8913

pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1" >&2; exit 1; }

# The URL macOS holds for this app's login item (it writes no plist). A record naming a build
# tree would launch that copy at the owner's next login — issue 20261119-73.
# `sfltool dumpbtm` blocks forever in a non-interactive session (issue 20261120-120: it produced
# nothing for 28 min at 0% CPU and held the shared lane). It is bounded here, and a bound that is
# hit means "cannot classify" — a NOTE, never this step's failure.
# Three answers, kept apart: the record's URL, "no record for this bundle id" (0), and "the tool
# could not be asked" (2). Absent and unanswerable are different facts.
btm_urls() {
  local out
  out=$(/usr/bin/timeout 5 sfltool dumpbtm 2>/dev/null) || return 2
  printf '%s\n' "$out" | awk '/Identifier: 2\.app\.storagestudiokh/{f=1;next} f && /URL:/{print; f=0}'
  return 0
}
BTM_BEFORE=""; btm_before_rc=0; BTM_BEFORE="$(btm_urls)" || btm_before_rc=$?

cleanup() {
  [ -n "${PID:-}" ] && kill "$PID" 2>/dev/null || true
  sleep 1
  if [ -n "${PID:-}" ] && kill -0 "$PID" 2>/dev/null; then kill -9 "$PID" 2>/dev/null || true; fi
}
trap cleanup EXIT

cat > "$DATA/Library/Application Support/Storage Studio KH/settings.json" <<'JSON'
{
  "schema": 1,
  "appearance": "system",
  "general": { "notifications": false, "launchAtLogin": false, "retries": 2 },
  "storages": [
    {
      "id": "gate-fake",
      "name": "Gate Fake NAS",
      "kind": "smb",
      "target": "smb://192.0.2.1/share",
      "mountPoint": "",
      "volumeUUID": null,
      "reconnectAtLogin": true,
      "reconnectAfterWake": true,
      "username": null
    }
  ]
}
JSON

echo "Run folder: $RUN"
echo "Launching hidden: $BIN"
"$BIN" >"$RUN/app.out" 2>&1 &
PID=$!

# 1. The app and its one helper come up.
for _ in $(seq 1 40); do [ -f "$LOG" ] && break; sleep 0.25; done
sleep 2
kill -0 "$PID" 2>/dev/null || { cat "$RUN/app.out"; fail "the app exited during launch"; }
child="$(pgrep -P "$PID" | head -n1)"
[ -n "$child" ] || fail "the app did not start its helper"
ps -o command= -p "$child" | grep -F "Storage Studio KH Helper" >/dev/null || fail "the app's child is not the helper"
pass "launch + helper child"

# 2. Bounded retries stop and flag needs attention (delays shortened for the gate).
for _ in $(seq 1 40); do grep -q "Gate Fake NAS needs attention" "$LOG" 2>/dev/null && break; sleep 0.5; done
grep -q "Gate Fake NAS needs attention" "$LOG" || { tail -20 "$LOG" 2>/dev/null; fail "needs-attention path did not happen"; }
[ "$(grep -c "Gate Fake NAS needs attention" "$LOG")" -eq 1 ] || fail "needs attention was reported more than once"
pass "bounded retry then needs attention (one report)"

# 2b. A storage the owner asked to restore is tried again by itself on a slow schedule, and that
# schedule is bounded: it stops instead of spinning for ever (0.1.23 — the NAS was off all night).
for _ in $(seq 1 40); do
  [ "$(grep -c "Gate Fake NAS: trying again" "$LOG" 2>/dev/null)" -ge 2 ] && break
  sleep 0.5
done
grep -q "Gate Fake NAS: trying again" "$LOG" \
  || { tail -20 "$LOG" 2>/dev/null; fail "a failed storage was never tried again by itself"; }
tries="$(grep -c "Gate Fake NAS: trying again" "$LOG")"
[ "$tries" -eq 2 ] || fail "the slow schedule ran $tries times, not the bounded 2"
sleep 6
[ "$(grep -c "Gate Fake NAS: trying again" "$LOG")" -eq 2 ] || fail "the slow schedule kept going past its bound"
grep -q "Gate Fake NAS needs attention" "$LOG" || fail "needs attention was lost after the slow schedule"
pass "slow retry reconnects by itself, then stops at its bound"

# 3. A second copy is handled plainly: it exits, the running one keeps going.
"$BIN" >"$RUN/second.out" 2>&1 &
SECOND=$!
for _ in $(seq 1 20); do kill -0 "$SECOND" 2>/dev/null || break; sleep 0.25; done
if kill -0 "$SECOND" 2>/dev/null; then kill "$SECOND" 2>/dev/null || true; fail "the second copy stayed running"; fi
kill -0 "$PID" 2>/dev/null || fail "the running copy exited when a second one launched"
grep -q "another copy was launched" "$LOG" || fail "the second launch was not reported"
pass "second launch handled; running copy kept"

# 4. Graceful quit stops the helper and frees everything.
"$BIN" --quit >/dev/null 2>&1 || true
for _ in $(seq 1 40); do kill -0 "$PID" 2>/dev/null || break; sleep 0.25; done
kill -0 "$PID" 2>/dev/null && fail "the app did not quit"
sleep 1
if pgrep -f "$APP/Contents/Helpers/Storage Studio KH Helper" >/dev/null; then
  pgrep -fl "$APP/Contents/Helpers/Storage Studio KH Helper" >&2 || true
  fail "the helper outlived the app"
fi
pass "quit stops the app and its helper"

# 5. Even a force-quit (crash-like) must not leave the helper running.
"$BIN" >>"$RUN/app-crash.out" 2>&1 &
CRASH_PID=$!
for _ in $(seq 1 40); do [ -n "$(pgrep -P "$CRASH_PID" 2>/dev/null)" ] && break; sleep 0.25; done
[ -n "$(pgrep -P "$CRASH_PID" 2>/dev/null)" ] || fail "the helper did not start for the crash test"
kill -9 "$CRASH_PID" 2>/dev/null || true
for _ in $(seq 1 20); do
  pgrep -f "$APP/Contents/Helpers/Storage Studio KH Helper" >/dev/null || break
  sleep 0.25
done
if pgrep -f "$APP/Contents/Helpers/Storage Studio KH Helper" >/dev/null; then
  pgrep -fl "$APP/Contents/Helpers/Storage Studio KH Helper" >&2 || true
  fail "the helper survived a force-quit"
fi
pass "helper ends with a force-quit"

# 5b. Channel archive and restore, against the helper inside the shipped bundle: a temp channel
# copied and checked byte for byte, stopped at a file boundary by an update hold, killed,
# resumed from the journal on the destination, discovered and restored without merging.
bash tests/archive.sh "$HELPER" || fail "the channel archive checks failed"
pass "channel archive and restore, checked byte for byte"

# 5c. Share listing against the device, when this Mac can reach it: names with spaces kept,
# and a password in hand does not turn a fast answer into a timeout.
bash tests/share-list.sh "$HELPER" || fail "the share-list checks failed"
pass "share listing: names with spaces, credentials, and a silent device"

# 6. Nothing was installed behind the app's back. The installed app may be running under the
# owner's own hand (seen 2026-11-21: RunningBoard's `application.app.storagestudiokh.desktop.*`
# for /Applications); that is his copy, not something this run left behind, so it is a NOTE.
JOB_LEFT=0
while read -r LABEL; do
  PROGRAM=$(launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | awk -F' = ' '/^[[:space:]]*program = /{print $2; exit}')
  case "$PROGRAM" in
    /Applications/*|"$HOME"/Applications/*) printf 'NOTE  the installed app is running (%s) — not left behind by this run\n' "$PROGRAM" ;;
    *) JOB_LEFT=1 ;;
  esac
done < <(launchctl list 2>/dev/null | awk '/storagestudio/{print $3}')
[ "$JOB_LEFT" -eq 0 ] || fail "a launchd job was left behind"
[ -z "$(ls "$DATA/Library/LaunchAgents" 2>/dev/null || true)" ] || fail "a launch agent was written"
pass "no launchd job or launch agent left behind"

# 7. macOS re-points an existing login item at whichever copy of the app ran, even when the
# app itself skips registration (issue 20261119-73, measured 2026-11-19: with
# STORAGE_STUDIO_NO_LOGIN_ITEM=1 set, a launch from a clean record writes nothing, but a
# launch from a build tree rewrites the owner's record to that build tree). No test can
# prevent it, so say it plainly: a gate run on the owner's Mac must put the record back.
BTM_AFTER=""; btm_after_rc=0; BTM_AFTER="$(btm_urls)" || btm_after_rc=$?
if [ "$btm_before_rc" = 2 ] || [ "$btm_after_rc" = 2 ]; then
  printf 'NOTE  sfltool did not answer within 5 s (or is not on this Mac) — login item NOT classified this run\n'
elif [ -z "$BTM_BEFORE" ] && [ -z "$BTM_AFTER" ]; then
  # Said plainly: with no record there is nothing to re-point, so this step proves nothing here.
  # Its only real signal comes from a Mac where the item exists.
  printf 'NOTE  no login item record for app.storagestudiokh.desktop on this Mac — nothing to verify; this check proves nothing on a machine without one\n'
elif [ "$BTM_AFTER" != "$BTM_BEFORE" ]; then
  printf 'NOTE  login item now names %s — restore it to the installed app\n' \
    "$(printf '%s\n' "$BTM_AFTER" | sed -n 's/^ *URL: //p')"
else
  pass "login item unchanged by this run"
fi

printf '\nGATE_OK  evidence: %s\n' "$RUN"
