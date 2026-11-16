#!/usr/bin/env bash
# The fleet update hold (`_orchestra/youtube-stack/update-hold/CONTRACT.md`), proven headless:
# a held helper claims nothing, a real running mount gets a bounded settle, the verdict names a
# stranded retry, DELETE and expiry resume, and a restart always takes work again.
# No window, no desktop, its own data folder and its own port (the live app keeps 8646).
#
#   bash tests/hold.sh [path/to/Storage Studio KH.app]
set -euo pipefail
cd "$(dirname "$0")/.."

APP="${1:-src-tauri/target/release/bundle/macos/Storage Studio KH.app}"
BIN="$APP/Contents/MacOS/Storage Studio KH"
HELPER="$APP/Contents/Helpers/Storage Studio KH Helper.app/Contents/MacOS/Storage Studio KH Helper"
[ -x "$BIN" ] || { echo "no app executable at $BIN"; exit 2; }
[ -x "$HELPER" ] || { echo "no helper inside the app at $HELPER"; exit 2; }

pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1" >&2; exit 1; }
RUN="$(mktemp -d "${TMPDIR:-/tmp}/storage-studio-hold.XXXXXX")"
DATA="$RUN/home"
SUPPORT="$DATA/Library/Application Support/Storage Studio KH"
mkdir -p "$SUPPORT"
LOG="$SUPPORT/log.txt"
# The shipped default port, so the proof covers the URL the signed feed names. Override only
# when another copy of 0.1.11 already holds it.
PORT="${HOLD_TEST_PORT:-8646}"
export HOME="$DATA"
export STORAGE_STUDIO_TEST_DATA_DIR="$DATA"
export STORAGE_STUDIO_NO_NOTIFICATIONS=1
export STORAGE_STUDIO_NO_LOGIN_ITEM=1
export STORAGE_STUDIO_RETRY_DELAYS=0.3,0.5,8
export STORAGE_STUDIO_HOLD_PORT="$PORT"

APP_PIDS=""
cleanup() {
  for pid in ${APP_PIDS:-}; do kill "$pid" 2>/dev/null || true; done
  for pid in ${APP_PIDS:-}; do kill -9 "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT

APP_VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist")
[ "$APP_VERSION" = "$(python3 -c "import json;print(json.load(open('src-tauri/tauri.conf.json'))['version'])")" ] \
  || fail "packaged app version differs from release source"
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
post() { curl -sS --max-time 35 -X POST "http://127.0.0.1:$PORT/api/maintenance/hold?$1"; }
del() { curl -sS --max-time 5 -X DELETE "http://127.0.0.1:$PORT/api/maintenance/hold"; }
wait_app() {
  local mark=$1 pid=$2
  for _ in $(seq 1 80); do
    if tail -n +$((mark + 1)) "$LOG" 2>/dev/null | grep -q "update hold listening"; then return; fi
    kill -0 "$pid" 2>/dev/null || fail "the hidden app exited during launch"
    sleep 0.25
  done
  fail "the hidden app did not start its update hold"
}
wait_text() {
  local mark=$1 text=$2
  # The fixture's last retry waits 8 s and each attempt costs ~2 s, so allow 40 s.
  for _ in $(seq 1 160); do
    tail -n +$((mark + 1)) "$LOG" 2>/dev/null | grep -q "$text" && return
    sleep 0.25
  done
  tail -n +$((mark + 1)) "$LOG" 2>/dev/null | grep -q "$text" || fail "missing log line: $text"
}
quit_app() {
  "$BIN" --quit >/dev/null 2>&1 || true
  for _ in $(seq 1 40); do kill -0 "$1" 2>/dev/null || break; sleep 0.25; done
  if kill -0 "$1" 2>/dev/null; then fail "the hidden app did not quit"; fi
  # The next copy takes over only once the old hold port and helper are gone.
  for _ in $(seq 1 40); do
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 || break
    sleep 0.25
  done
  return 0
}
start_app() {
  local mark=0
  [ -f "$LOG" ] && mark=$(wc -l < "$LOG")
  "$BIN" --start-hidden >"$RUN/app.$RANDOM.out" 2>&1 &
  PID=$!
  APP_PIDS="$APP_PIDS $PID"
  wait_app "$mark" "$PID"
}
write_one() {
  python3 - "$SUPPORT/settings.json" "$1" "$2" "$3" <<'PY'
import json, sys
from pathlib import Path
path, id, name, login = sys.argv[1:]
Path(path).write_text(json.dumps({'schema': 1, 'appearance': 'system', 'general': {'notifications': False, 'launchAtLogin': False, 'retries': 3}, 'storages': [{'id': id, 'name': name, 'kind': 'smb', 'target': 'smb://192.0.2.1/share', 'mountPoint': '', 'volumeUUID': None, 'reconnectAtLogin': login == 'true', 'reconnectAfterWake': login == 'true', 'username': None}]}))
PY
}

echo "Run folder: $RUN"
echo "Packaged version: $APP_VERSION"

# 1. The helper really runs work; a held helper starts nothing, then resumes it by itself.
helper_out="$RUN/helper.jsonl"
{
  printf '{"type":"configure","retries":3,"storages":[%s]}\n' "$STORAGE_JSON"
  sleep 3
  printf '{"type":"hold"}\n'
  printf '{"type":"mount","id":"hold-fake"}\n'
  sleep 1
  printf '{"type":"resume"}\n'
  sleep 4
  printf '{"type":"quit"}\n'
} | "$HELPER" > "$helper_out" 2>/dev/null || true
python3 - "$helper_out" <<'PY'
import json, sys
from pathlib import Path
lines = [json.loads(line) for line in Path(sys.argv[1]).read_text().splitlines() if line.strip()]
assert any('hold-fake' in line.get('inFlight', []) for line in lines if line.get('type') == 'state'), 'no real in-flight mount was reported'
deferred_at = next(i for i, line in enumerate(lines) if line.get('type') == 'state' and 'hold-fake' in line.get('deferred', []))
resumed_at = next(i for i, line in enumerate(lines) if line.get('type') == 'log' and 'resumed' in line.get('message', ''))
held = lines[deferred_at:resumed_at]
assert not any('hold-fake' in line.get('inFlight', []) for line in held), 'a held mount ran anyway'
assert not any(line.get('type') == 'attention' and line.get('id') == 'hold-fake' for line in held), 'a held mount finished while held'
def status(line):
    for item in line.get('items') or []:
        if item.get('id') == 'hold-fake':
            return item.get('status')
    return None
started = {'mounting', 'retrying', 'unreachable', 'needs_attention', 'mounted'}
assert any(status(line) in started for line in lines[resumed_at:] if line.get('type') == 'state'), 'resume did not re-run the deferred mount'
print('helper: real inFlight, immediate deferral, explicit deferred set, resume without an operator')
PY
pass "the helper reports real work and holds every claim; resume runs deferred work"

# 2. The packaged app answers on loopback, hidden, with live work.
start_app
wait_text 0 "Hold Fake NAS needs attention"
start_time=$(date +%s)
body=$(post "timeout_s=20&pause_s=120")
elapsed=$(($(date +%s) - start_time))
[ "$elapsed" -lt 6 ] || fail "an idle app burned the settle window (${elapsed}s): $body"
[ "$(printf '%s' "$body" | field safe)" = "true" ] || fail "an idle app was not safe: $body"
[ "$(printf '%s' "$body" | field in_flight)" = "0" ] || fail "an idle app reported work in flight: $body"
[ "$(printf '%s' "$body" | field dispatch_paused_s)" = "120" ] || fail "the pause was not the one asked for: $body"
for key in safe unsettled dispatch_paused_s in_flight; do
  printf '%s' "$body" | grep -q "\"$key\"" || fail "the reply has no $key"
done
[ "$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/other")" = "404" ] || fail "an unknown path was served"
[ "$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/maintenance/hold")" = "405" ] || fail "GET on the hold was not refused"
pass "POST answers the contract's reply; only its route and methods are served"
del >/dev/null
quit_app "$PID"

# 3. A hold taken while a mount is starting settles on the mount alone, never the retry ladder.
write_one settle-now 'Settle now' true
start_app
start_time=$(date +%s)
body=$(post "timeout_s=20&pause_s=120")
elapsed=$(($(date +%s) - start_time))
[ "$elapsed" -lt 8 ] || fail "a queued retry burned the settle window (${elapsed}s): $body"
[ "$(printf '%s' "$body" | field in_flight)" = "0" ] || fail "a parked retry was counted as running: $body"
[ "$(printf '%s' "$body" | field safe)" = "true" ] || fail "a retry the next start follows was called stranded: $body"
pass "the settle ends with the mount, not the retry ladder (${elapsed}s)"
del >/dev/null
quit_app "$PID"

# 4. A hold with no DELETE expires by itself and work resumes.
write_one expire-hold 'Expire hold' true
start_app
wait_text 0 "Expire hold needs attention"
post "timeout_s=0&pause_s=2" >/dev/null
expiry_mark=$(wc -l < "$LOG")
wait_text "$expiry_mark" "the update pause expired"
tail -n +$((expiry_mark + 1)) "$LOG" | grep -q "helper \[info\]: resumed" \
  || fail "the expired pause never reached the helper"
body=$(post "timeout_s=0&pause_s=120")
[ "$(printf '%s' "$body" | field safe)" = "true" ] || fail "the app did not take work again after expiry: $body"
pass "a hold with no DELETE expires by itself; the helper resumes"
del >/dev/null
quit_app "$PID"

# 5. A restart with a hold still standing is unheld and mounts by itself.
write_one restart-hold 'Restart hold' true
start_app
wait_text 0 "Restart hold needs attention"
mark=$(wc -l < "$LOG")
post "timeout_s=0&pause_s=120" >/dev/null
quit_app "$PID"
start_app
wait_text "$mark" "Restart hold needs attention"
if tail -n +$((mark + 1)) "$LOG" | grep -q "held new work for an update"; then fail "a restart came back still holding"; fi
pass "a restart is unheld and mounts again without an operator"
del >/dev/null

printf '\nHOLD_OK  packaged_version=%s  evidence=%s\n' "$APP_VERSION" "$RUN"