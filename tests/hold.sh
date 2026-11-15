#!/usr/bin/env bash
# The update hold (`_orchestra/youtube-stack/update-hold/CONTRACT.md`), proven headless:
# loopback POST/DELETE, real in-flight work, a held app that claims nothing, a pause that
# expires by itself, and a restart that takes work again with no operator step.
# No window, no desktop, its own data folder and its own port (the live app keeps the contract's 8646).
#
#   bash tests/hold.sh [path/to/Storage Studio KH.app]
set -euo pipefail
cd "$(dirname "$0")/.."

APP="${1:-src-tauri/target/release/bundle/macos/Storage Studio KH.app}"
BIN="$APP/Contents/MacOS/Storage Studio KH"
HELPER="$APP/Contents/Helpers/Storage Studio KH Helper.app/Contents/MacOS/Storage Studio KH Helper"
[ -x "$BIN" ] || { echo "no app executable at $BIN"; exit 2; }
[ -x "$HELPER" ] || { echo "no helper inside the app at $HELPER"; exit 2; }

RUN="$(mktemp -d "${TMPDIR:-/tmp}/storage-studio-hold.XXXXXX")"
DATA="$RUN/home"
SUPPORT="$DATA/Library/Application Support/Storage Studio KH"
mkdir -p "$SUPPORT"
LOG="$SUPPORT/log.txt"
PORT=8911
export HOME="$DATA"
export STORAGE_STUDIO_TEST_DATA_DIR="$DATA"
export STORAGE_STUDIO_NO_NOTIFICATIONS=1
export STORAGE_STUDIO_NO_LOGIN_ITEM=1
export STORAGE_STUDIO_RETRY_DELAYS=1.5,2
export STORAGE_STUDIO_HOLD_PORT="$PORT"

pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1" >&2; exit 1; }
cleanup() {
  [ -n "${PID:-}" ] && kill "$PID" 2>/dev/null || true
  sleep 1
  [ -n "${PID:-}" ] && kill -9 "$PID" 2>/dev/null || true
}
trap cleanup EXIT

STORAGE_JSON='{"id":"hold-fake","name":"Hold Fake NAS","kind":"smb","target":"smb://192.0.2.1/share","mountPoint":"","volumeUUID":null,"reconnectAtLogin":true,"reconnectAfterWake":true,"username":null}'
cat > "$SUPPORT/settings.json" <<JSON
{
  "schema": 1,
  "appearance": "system",
  "general": { "notifications": false, "launchAtLogin": false, "retries": 3 },
  "storages": [ $STORAGE_JSON ]
}
JSON

field() { /usr/bin/python3 -I -c 'import json,sys; d=json.load(sys.stdin); print(json.dumps(d.get(sys.argv[1])))' "$1"; }
post() { curl -sS -X POST "http://127.0.0.1:$PORT/api/maintenance/hold?$1"; }
del() { curl -sS -X DELETE "http://127.0.0.1:$PORT/api/maintenance/hold"; }

echo "Run folder: $RUN"

# 1. The helper itself: a mount really runs, and a held helper starts nothing new.
helper_out="$RUN/helper.jsonl"
{
  printf '{"type":"configure","retries":1,"storages":[%s]}\n' "$STORAGE_JSON"
  sleep 2
  printf '{"type":"hold"}\n'
  printf '{"type":"mount","id":"hold-fake"}\n'
  sleep 1
  printf '{"type":"resume"}\n'
  sleep 8
  printf '{"type":"quit"}\n'
} | "$HELPER" > "$helper_out" 2>/dev/null || true
grep -q '"inFlight":\["hold-fake"\]' "$helper_out" \
  || fail "the helper never reported a real in-flight mount (inFlight stayed empty)"
pass "in_flight is the helper's real running work"
grep -q '"queued":\["hold-fake"\]' "$helper_out" \
  || fail "a mount sent while held was not deferred (queued never named it)"
pass "a held helper starts nothing: the mount is deferred, not run"
grep -q '"type":"attention"' "$helper_out" \
  || fail "resume did not re-run the deferred mount"
pass "resume re-runs the deferred mount by itself"

# 2. The app answers the contract on loopback, hidden.
"$BIN" --start-hidden >"$RUN/app.out" 2>&1 &
PID=$!
for _ in $(seq 1 60); do
  curl -sS -o /dev/null -X DELETE "http://127.0.0.1:$PORT/api/maintenance/hold" 2>/dev/null && break
  sleep 0.25
done

# in_flight is observed, never guessed: the login mount is really running for a moment.
saw_running=0
for _ in $(seq 1 40); do
  body=$(post "timeout_s=0&pause_s=1" || true)
  if [ -n "${body:-}" ]; then
    running=$(printf '%s' "$body" | field in_flight)
    if [ "$running" != "null" ] && [ "$running" -ge 1 ]; then saw_running=1; break; fi
  fi
  sleep 0.15
done
[ "$saw_running" -eq 1 ] || fail "in_flight never reported the running login mount"
pass "the hold's in_flight matched a real mount attempt"

# 3. The contract's reply, and the pause it takes.
for _ in $(seq 1 40); do grep -q "Hold Fake NAS needs attention" "$LOG" 2>/dev/null && break; sleep 0.5; done
hold_mark=$(wc -l < "$LOG")
body=$(post "timeout_s=0&pause_s=120")
for key in safe unsettled dispatch_paused_s in_flight; do
  printf '%s' "$body" | grep -q "\"$key\"" || fail "the reply has no $key: $body"
done
[ "$(printf '%s' "$body" | field dispatch_paused_s)" = "120" ] || fail "the pause was not the one asked for: $body"
[ "$(printf '%s' "$body" | field in_flight)" = "0" ] || fail "an idle app reported work in flight: $body"
[ "$(printf '%s' "$body" | field safe)" = "true" ] || fail "an idle app was not safe to restart: $body"
tail -n +$((hold_mark + 1)) "$LOG" | grep -q "held new work for an update" || fail "the hold was not logged"
for _ in $(seq 1 20); do tail -n +$((hold_mark + 1)) "$LOG" | grep -q "helper \[info\]: holding new work" && break; sleep 0.25; done
tail -n +$((hold_mark + 1)) "$LOG" | grep -q "helper \[info\]: holding new work" \
  || fail "the helper was not told to hold"
pass "POST hold pauses new work and answers the contract's reply"

# 4. Nothing but the contract's two requests is served.
[ "$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/other")" = "404" ] || fail "an unknown path was served"
[ "$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/maintenance/hold")" = "405" ] || fail "GET on the hold was not refused"
pass "only the contract's route and methods are served"

# 5. DELETE resumes at once.
resume_mark=$(wc -l < "$LOG")
body=$(del)
[ "$(printf '%s' "$body" | field dispatch_paused_s)" = "0" ] || fail "DELETE did not clear the pause: $body"
tail -n +$((resume_mark + 1)) "$LOG" | grep -q "resumed; new work is accepted again" || fail "the resume was not logged"
for _ in $(seq 1 20); do tail -n +$((resume_mark + 1)) "$LOG" | grep -q "helper \[info\]: resumed" && break; sleep 0.25; done
tail -n +$((resume_mark + 1)) "$LOG" | grep -q "helper \[info\]: resumed" || fail "the helper was not told to resume"
pass "DELETE resumes at once"

# 6. A hold with no DELETE expires by itself.
expiry_mark=$(wc -l < "$LOG")
post "timeout_s=0&pause_s=2" >/dev/null
for _ in $(seq 1 20); do tail -n +$((expiry_mark + 1)) "$LOG" | grep -q "the update pause expired" && break; sleep 0.5; done
tail -n +$((expiry_mark + 1)) "$LOG" | grep -q "the update pause expired" \
  || fail "a hold with no DELETE never expired (a persisted latch)"
pass "the pause expires by itself, with no DELETE"

# 7. A restart takes work again with no operator step.
post "timeout_s=0&pause_s=120" >/dev/null
grep -q "held new work for an update" "$LOG" || fail "the restart test could not hold the app"
mark=$(wc -l < "$LOG")
"$BIN" --quit >/dev/null 2>&1 || true
for _ in $(seq 1 40); do kill -0 "$PID" 2>/dev/null || break; sleep 0.25; done
"$BIN" --start-hidden >>"$RUN/app.out" 2>&1 &
PID=$!
for _ in $(seq 1 60); do grep -q "Hold Fake NAS needs attention" <(tail -n +$((mark + 1)) "$LOG" 2>/dev/null) && break; sleep 0.5; done
tail -n +$((mark + 1)) "$LOG" | grep -q "Hold Fake NAS needs attention" \
  || fail "after a restart the app did not mount again by itself"
tail -n +$((mark + 1)) "$LOG" | grep -q "held new work" && fail "the restart came back still holding (a persisted latch)"
pass "a restart resumes by itself: work runs again, no DELETE"

printf '\nHOLD_OK  evidence: %s\n' "$RUN"
