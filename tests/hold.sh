#!/usr/bin/env bash
# The fleet update hold (`_orchestra/youtube-stack/update-hold/CONTRACT.md`), proven headless:
# a held helper claims nothing, a real running mount gets a bounded settle, the verdict names a
# stranded retry, DELETE and expiry resume, and a restart always takes work again.
# No window, no desktop, its own data folder and its own port (the live app keeps 8646).
#
#   bash tests/hold.sh [path/to/Storage Studio KH.app]
set -euo pipefail
. scripts/toolchain.sh

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
PORT="${HOLD_TEST_PORT:-18646}"
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
# The Launcher's hold credential, as the fleet contract defines it: a 0600 file the app reads
# fresh on every request, presented as X-Hub-Token or Authorization: Bearer.
HOLD_TOKEN_FILE="$RUN/hold-token"
printf '%s\n' "$(/usr/bin/python3 -I -c 'import secrets; print(secrets.token_hex(32))')" > "$HOLD_TOKEN_FILE"
chmod 600 "$HOLD_TOKEN_FILE"
HOLD_TOKEN="$(cat "$HOLD_TOKEN_FILE")"
export KHU_HOLD_TOKEN_FILE="$HOLD_TOKEN_FILE"
post() { curl -sS --max-time 35 -X POST -H "X-Hub-Token: $HOLD_TOKEN" "http://127.0.0.1:$PORT/api/maintenance/hold?$1"; }
del() { curl -sS --max-time 5 -X DELETE -H "X-Hub-Token: $HOLD_TOKEN" "http://127.0.0.1:$PORT/api/maintenance/hold"; }
code() { curl -sS -o /dev/null -w '%{http_code}' "$@"; }
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
  sleep 8
  printf '{"type":"hold","ceiling":20}\n'
  printf '{"type":"mount","id":"hold-fake"}\n'
  sleep 1
  printf '{"type":"resume"}\n'
  sleep 4
  printf '{"type":"quit"}\n'
# Since 0.1.12 a mount answer no longer blocks the command queue, so the mount below must land
# in a retry gap rather than behind a running attempt, where "already mounting" is right. The
# gap is 20 s and the hold waits 8 s, so a slow first attempt under load cannot eat the fixture
# (measured 2026-11-20: a 3 s wait left the attempt in flight and nothing was deferred).
} | STORAGE_STUDIO_RETRY_DELAYS=20 "$HELPER" > "$helper_out" 2>/dev/null || true
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

# 1b. A repeat hold is answered, not ignored. Angkor 2026-11-20: the Launcher renewed its hold
#     every 7 s; the helper said nothing when already paused, so every retry was refused with
#     "the helper did not pause" and the app stayed held forever.
{
  printf '{"type":"configure","retries":3,"storages":[%s]}\n' "$STORAGE_JSON"
  sleep 1
  printf '{"type":"hold"}\n'
  sleep 0.5
  printf '{"type":"hold"}\n'
  sleep 0.5
  printf '{"type":"quit"}\n'
} | "$HELPER" > "$RUN/helper-hold-twice.jsonl" 2>/dev/null || true
python3 - "$RUN/helper-hold-twice.jsonl" <<'PY'
import json, sys
from pathlib import Path
lines = [json.loads(line) for line in Path(sys.argv[1]).read_text().splitlines() if line.strip()]
paused = [line for line in lines if line.get('type') == 'state' and line.get('paused') is True]
assert len(paused) >= 2, f'a repeated hold was not answered: {len(paused)} paused report(s)'
print('helper: both holds answered with paused')
PY
pass "a repeated hold while already paused is answered, not ignored"

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
# The Launcher retries its hold every few seconds. A second hold while the app is already paused
# must answer the same as the first — angkor was refused every 7 s for exactly this.
repeat=$(post "timeout_s=20&pause_s=120")
[ "$(printf '%s' "$repeat" | field safe)" = "true" ] || fail "a repeated hold was refused: $repeat"
[ "$(printf '%s' "$repeat" | field in_flight)" = "0" ] || fail "a repeated hold invented work in flight: $repeat"
pass "a repeated hold answers safe while the helper is already paused"
[ "$(code "http://127.0.0.1:$PORT/api/other")" = "404" ] || fail "an unknown path was served"
# Only the Launcher's own credential opens the route: none, a wrong one, or another header is 401.
[ "$(code -X POST "http://127.0.0.1:$PORT/api/maintenance/hold?timeout_s=1")" = "401" ] \
  || fail "a hold with no credential was served"
[ "$(code -X POST -H 'X-Hub-Token: not-the-token' "http://127.0.0.1:$PORT/api/maintenance/hold?timeout_s=1")" = "401" ] \
  || fail "a hold with a wrong credential was served"
[ "$(code -X DELETE "http://127.0.0.1:$PORT/api/maintenance/hold")" = "401" ] \
  || fail "a resume with no credential was served"
[ "$(code "http://127.0.0.1:$PORT/api/maintenance/hold")" = "401" ] \
  || fail "an uncredentialed GET was answered with anything but 401"
[ "$(code -H "X-Hub-Token: $HOLD_TOKEN" "http://127.0.0.1:$PORT/api/maintenance/hold")" = "405" ] \
  || fail "an authorized GET on the hold was not refused as a method"
[ "$(code -X POST -H "Authorization: Bearer $HOLD_TOKEN" "http://127.0.0.1:$PORT/api/maintenance/hold?timeout_s=1")" = "200" ] \
  || fail "the Bearer form of the hold credential was refused"
# Rotated on disk, the very next request follows the new value: the file is read per request.
printf '%s\n' "$(/usr/bin/python3 -I -c 'import secrets; print(secrets.token_hex(32))')" > "$HOLD_TOKEN_FILE"
[ "$(code -X POST -H "X-Hub-Token: $HOLD_TOKEN" "http://127.0.0.1:$PORT/api/maintenance/hold?timeout_s=1")" = "401" ] \
  || fail "a rotated-away credential still worked"
HOLD_TOKEN="$(cat "$HOLD_TOKEN_FILE")"
post "timeout_s=0&pause_s=120" >/dev/null || fail "the rotated credential was refused"
del >/dev/null
pass "POST answers the contract's reply; the hold requires the Launcher's token, read fresh"
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
# The app keeps its own record of the handshake, with the ceiling and the time it took, so nobody
# has to reconstruct a night from the updater's side of it.
grep -qE "update hold: safe in [0-9]+ ms \(ceiling 20 s" "$LOG" \
  || fail "the app's own log did not name the ceiling and the time: $(tail -3 "$LOG")"
grep -q "holding new work for an update (settle ceiling 20 s" "$LOG" \
  || fail "the helper's log did not name the ceiling it respects: $(grep 'holding new work' "$LOG" | tail -1)"
[ -f "$SUPPORT/hold-attempts.jsonl" ] || fail "no hold-attempts.jsonl beside settings.json"
/usr/bin/python3 -I -c '
import json, sys
lines = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
last = lines[-1]
assert last["request"] == "hold" and last["safe"] is True, last
assert isinstance(last["answered_in_ms"], int) and last["asked_s"] == 20, last
assert last["at"] > 0, last
print("record:", json.dumps(last))
' "$SUPPORT/hold-attempts.jsonl" || fail "the hold attempt was not recorded with its moment and timing"
pass "the hold names its ceiling in both logs and is recorded with its moment and time"
del >/dev/null
quit_app "$PID"

# 6. A helper that stops answering is refused in one plain sentence, recorded, and nothing changes.
write_one stuck-hold 'Stuck hold' true
start_app
wait_text 0 "Stuck hold needs attention"
HELPER_PID="$(pgrep -P "$PID" | head -n1)"
[ -n "${HELPER_PID:-}" ] || fail "no helper process to stop"
kill -STOP "$HELPER_PID"
body=$(post "timeout_s=20&pause_s=120")
kill -CONT "$HELPER_PID"
[ "$(printf '%s' "$body" | field safe)" = "false" ] || fail "a silent helper was called safe: $body"
printf '%s' "$body" | grep -q "did not answer the pause within 3 s" \
  || fail "the refusal did not say what happened: $body"
printf '%s' "$body" | grep -qi "ceiling is 20 s" || fail "the refusal did not name the ceiling: $body"
/usr/bin/python3 -I -c '
import json, sys
last = [json.loads(l) for l in open(sys.argv[1]) if l.strip()][-1]
assert last["safe"] is False and "did not answer" in (last["reason"] or ""), last
print("record:", json.dumps(last))
' "$SUPPORT/hold-attempts.jsonl" || fail "the refusal was not recorded with its reason"
del >/dev/null
# Answering again, it pauses and resumes like any other run: the stop was not a one-way door.
body=$(post "timeout_s=20&pause_s=120")
[ "$(printf '%s' "$body" | field safe)" = "true" ] || fail "the helper did not recover after it was continued: $body"
del >/dev/null
pass "a helper that cannot answer is refused in plain words, recorded, and recovers"
quit_app "$PID"

# 7. A process answers more than one hold. Angkor 2026-11-20: the first hold after a restart was
#    accepted and the next was refused - one answerable hold per process, and whoever asked second
#    was refused for as long as the process ran. Hold, resume, hold, resume: every answer emitted,
#    with its ceiling and its time.
write_one repeat-hold 'Repeat hold' true
start_app
wait_text 0 "Repeat hold needs attention"
records_before=$( [ -f "$SUPPORT/hold-attempts.jsonl" ] && grep -c . "$SUPPORT/hold-attempts.jsonl" || echo 0 )
mark=$(wc -l < "$LOG")
for i in 1 2 3 4; do
  body=$(post "timeout_s=20&pause_s=120")
  [ "$(printf '%s' "$body" | field safe)" = "true" ] || fail "hold #$i was not answered: $body"
  [ "$(printf '%s' "$body" | field dispatch_paused_s)" = "120" ] || fail "hold #$i did not pause: $body"
  del >/dev/null
done
announced=$(tail -n +$((mark + 1)) "$LOG" | grep -c "holding new work for an update (settle ceiling 20 s")
[ "$announced" -ge 4 ] || fail "the helper announced $announced of 4 holds"
/usr/bin/python3 -I -c '
import json, sys
rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()][int(sys.argv[2]):]
assert len(rows) == 4, f"expected 4 recorded holds, got {len(rows)}"
for i, row in enumerate(rows, 1):
    assert row["request"] == "hold" and row["safe"] is True, (i, row)
    assert row["asked_s"] == 20 and isinstance(row["answered_in_ms"], int), (i, row)
print("records:", json.dumps([{k: r[k] for k in ("answered_in_ms", "safe")} for r in rows]))
' "$SUPPORT/hold-attempts.jsonl" "$records_before" || fail "not every hold was recorded with its ceiling and time"
pass "hold, resume, hold, resume: every answer is emitted, with its ceiling and its time"
quit_app "$PID"

# 4. A hold with no DELETE expires by itself and work resumes — including after a repeat, the way
#    the Launcher renews its hold. The pause must not outlive the asking (contract rule 3).
write_one expire-hold 'Expire hold' true
start_app
wait_text 0 "Expire hold needs attention"
post "timeout_s=0&pause_s=2" >/dev/null
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
post "timeout_s=0&pause_s=120" >/dev/null
quit_app "$PID"
mark=$(wc -l < "$LOG")
start_app
wait_text "$mark" "Restart hold needs attention"
if tail -n +$((mark + 1)) "$LOG" | grep -q "held new work for an update"; then fail "a restart came back still holding"; fi
pass "a restart is unheld and mounts again without an operator"
del >/dev/null

printf '\nHOLD_OK  packaged_version=%s  evidence=%s\n' "$APP_VERSION" "$RUN"