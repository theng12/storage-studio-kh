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
PORT=8911
export HOME="$DATA"
export STORAGE_STUDIO_TEST_DATA_DIR="$DATA"
export STORAGE_STUDIO_NO_NOTIFICATIONS=1
export STORAGE_STUDIO_NO_LOGIN_ITEM=1
export STORAGE_STUDIO_RETRY_DELAYS=0.3,0.5,8
export STORAGE_STUDIO_HOLD_PORT="$PORT"

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
  for _ in $(seq 1 60); do
    if grep -q "update hold listening" "$LOG" 2>/dev/null; then return; fi
    kill -0 "$1" 2>/dev/null || fail "the hidden app exited during launch"
    sleep 0.25
  done
  fail "the hidden app did not start its update hold"
}
wait_text() {
  local mark=$1 text=$2
  for _ in $(seq 1 40); do
    tail -n +$((mark + 1)) "$LOG" 2>/dev/null | grep -q "$text" && return
    sleep 0.25
  done
  tail -n +$((mark + 1)) "$LOG" 2>/dev/null | grep -q "$text" || fail "missing log line: $text"
}
quit_app() {
  "$BIN" --quit >/dev/null 2>&1 || true
  for _ in $(seq 1 40); do kill -0 "$1" 2>/dev/null || break; sleep 0.25; done
  kill -0 "$1" 2>/dev/null && fail "the hidden app did not quit"
}
start_app() {
  "$BIN" --start-hidden >"$RUN/app.$RANDOM.out" 2>&1 &
  PID=$!
  APP_PIDS="$APP_PIDS $PID"
  wait_app "$PID"
}
write_one() {
  python3 - "$SUPPORT/settings.json" "$1" "$2" "$3" "$4" <<'PY'
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
states = [line for line in lines if line.get('type') == 'state']
assert any('hold-fake' in line.get('inFlight', []) for line in states), 'no real in-flight mount was reported'
first = next((i for i, line in enumerate(states) if 'hold-fake' in line.get('deferred', []))), None
assert first is not None, 'the held mount was not deferred'
assert all('hold-fake' not in line.get('inFlight', []) for line in states[first:]), 'a held mount ran anyway'
assert not any(line.get('type') == 'attention' and line.get('id') == 'hold-fake' for line in lines[:states.index(states[first])]), 'a held mount finished before resume'
assert any(line.get('type') == 'attention' and line.get('id') == 'hold-fake' for line in lines[states.index(states[first]) + 1:]), 'resume did not re-run the deferred mount'
print('helper: real inFlight, immediate deferral, explicit deferred set, resume without an operator')
PY
pass "the helper reports real work and holds every claim; resume runs deferred work"

# 2. The packaged app answers on loopback, hidden, with live work.
start_app
start_time=$(date +%s)
wait_text 0 "Hold Fake NAS needs attention"
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

# 3. An orphan retry must never burn the 20-second settle window, or silently block its own update.
write_one orphan-retry 'Orphan retry' false
start_app
wait_text 0 "Orphan retry needs attention"
start_time=$(date +%s)
body=$(post "timeout_s=20&pause_s=120")
elapsed=$(($(date +%s) - start_time))
[ "$elapsed" -lt 6 ] || fail "a queued retry burned the settle window (${elapsed}s): $body"
[ "$(printf '%s' "$body" | field in_flight)" = "0" ] || fail "a parked mount was counted as running: $body"
[ "$(printf '%s' "$body" | field safe)" = "false" ] || fail "the stranded retry was not named: $body"
printf '%s' "$body" | grep -q "Orphan retry (retry pending)" || fail "the unsafe verdict did not name the retry"
pass "a queued retry does not burn the 20 s settle; the reply names it"
body=$(del)
[ "$(printf '%s' "$body" | field safe)" = "true" ] || fail "DELETE did not resume: $body"
quit_app "$PID"

# 4. A held orphan is deferred by the hold itself and may not block its own update.
write_one orphan-deferred 'Orphan deferred' true
start_app
wait_text 0 "Orphan deferred needs attention"
# Renew with the helper already paused; remove its reconnect label without restarting it.
python3 - "$SUPPORT/settings.json" <<'PY'
import json, sys
from pathlib import Path
path = Path(sys.argv[1])
data = json.loads(path.read_text())
data['storages'][0]['reconnectAtLogin'] = False
data['storages'][0]['reconnectAfterWake'] = False
path.write_text(json.dumps(data))
PY
post "timeout_s=20&pause_s=120" >/dev/null
expiry_mark=$(wc -l < "$LOG")
post "timeout_s=0&pause_s=1" >/dev/null
wait_text "$expiry_mark" "the update pause expired"
body=$(post "timeout_s=20&pause_s=120")
[ "$(printf '%s' "$body" | field safe)" = "true" ] || fail "a retry parked by this app was treated as lost: $body"
del >/dev/null
pass "renewal expires and keeps a deferred retry; the pause never latches"
quit_app "$PID"

# 5. A restart with a hold still standing is unheld and dispatches its retry by itself.
write_one restart-retry 'Restart retry' true
start_app
wait_text 0 "Restart retry needs attention"
mark=$(wc -l < "$LOG")
post "timeout_s=0&pause_s=120" >/dev/null
quit_app "$PID"
start_app
wait_text "$mark" "Restart retry needs attention"
if tail -n +$((mark + 1)) "$LOG" | grep -q "held new work for an update"; then fail "a restart came back still holding"; fi
pass "a restart is unheld and dispatches its retry without an operator"
del >/dev/null

printf '\nHOLD_OK  packaged_version=%s  evidence=%s\n' "$APP_VERSION" "$RUN"