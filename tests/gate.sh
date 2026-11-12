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

RUN="$(mktemp -d "${TMPDIR:-/tmp}/storage-studio-gate.XXXXXX")"
DATA="$RUN/home"
mkdir -p "$DATA/Library/Application Support/Storage Studio KH"
LOG="$DATA/Library/Application Support/Storage Studio KH/log.txt"
export HOME="$DATA"
export STORAGE_STUDIO_TEST_DATA_DIR="$DATA"
export STORAGE_STUDIO_NO_NOTIFICATIONS=1
export STORAGE_STUDIO_NO_LOGIN_ITEM=1
export STORAGE_STUDIO_RETRY_DELAYS=0.2,0.3

pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1" >&2; exit 1; }

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
pgrep -P "$PID" >/dev/null || fail "the app did not start its helper"
pass "launch + helper child"

# 2. Bounded retries stop and flag needs attention (delays shortened for the gate).
for _ in $(seq 1 40); do grep -q "Gate Fake NAS needs attention" "$LOG" 2>/dev/null && break; sleep 0.5; done
grep -q "Gate Fake NAS needs attention" "$LOG" || { tail -20 "$LOG" 2>/dev/null; fail "needs-attention path did not happen"; }
[ "$(grep -c "Gate Fake NAS needs attention" "$LOG")" -eq 1 ] || fail "needs attention was reported more than once"
pass "bounded retry then needs attention (one report)"

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
pgrep -f "$APP/Contents/Helpers/Storage Studio KH Helper" >/dev/null && fail "the helper outlived the app"
pass "quit stops the app and its helper"

# 5. Nothing was installed behind the app's back.
launchctl list 2>/dev/null | grep -i "storagestudio" && fail "a launchd job was left behind"
[ -z "$(ls "$DATA/Library/LaunchAgents" 2>/dev/null || true)" ] || fail "a launch agent was written"
pass "no launchd job or launch agent left behind"

printf '\nGATE_OK  evidence: %s\n' "$RUN"
