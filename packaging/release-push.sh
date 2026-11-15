#!/bin/bash
# The release path: this Mac builds, 1301 publishes. Nothing here writes the feed.
#
#   packaging/release-push.sh <feed-app-id> <version> <dmg> <changelog>
#
# Copies the DMG and its changelog to the release host's staging folder and runs `khu publish`
# there, then reads the served feed back and prints the version it now offers.
set -euo pipefail
HOST="${KHU_RELEASE_HOST:-vengtheng@100.82.91.102}"
KEY="${KHU_RELEASE_KEY:-$HOME/.ssh/id_ed25519_gateway1301}"
STAGE="${KHU_RELEASE_STAGE:-Library/KHUpdater/feed-incoming-$(date +%Y%m%d)}"
[ $# -eq 4 ] || { echo "usage: $0 <feed-app-id> <version> <dmg> <changelog>" >&2; exit 2; }
APP="$1"; VERSION="$2"; DMG="$3"; LOG="$4"
[ -f "$DMG" ] || { echo "no such DMG: $DMG" >&2; exit 2; }
[ -f "$LOG" ] || { echo "no such changelog: $LOG" >&2; exit 2; }
BASE=$(basename "$DMG")
SSH=(ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=10 "$HOST")

"${SSH[@]}" "mkdir -p ~/$STAGE/changelogs"
scp -i "$KEY" -o BatchMode=yes "$DMG" "$HOST:$STAGE/$BASE"
scp -i "$KEY" -o BatchMode=yes "$LOG" "$HOST:$STAGE/changelogs/$APP.md"
# The signed feed names where a running copy takes an update hold (owner rule 2026-11-15).
HOLD_ARGS=""
if [ -n "${KHU_HOLD_URL:-}" ]; then HOLD_ARGS="--hold-url '$KHU_HOLD_URL'"; fi

"${SSH[@]}" "K=\$HOME/Library/KHUpdater; \"\$K/bin/khu\" publish --feed \"\$K/feed\" --key \"\$K/keys/private.key\" \
  --app '$APP' --version '$VERSION' --artifact \"\$HOME/$STAGE/$BASE\" --changelog \"\$HOME/$STAGE/changelogs/$APP.md\" $HOLD_ARGS"

/usr/bin/python3 -I - "$HOST" "$APP" "$VERSION" "${KHU_HOLD_URL:-}" <<'PY'
import base64, json, sys, urllib.request
host, app, want, hold = sys.argv[1].split("@")[-1], sys.argv[2], sys.argv[3], sys.argv[4]
feed = json.loads(base64.b64decode(json.load(urllib.request.urlopen(f"http://{host}:8790/release.json", timeout=20))["feed"]))
entry = feed["apps"].get(app, {})
got = entry.get("version")
previous = (feed.get("previous") or {}).get(app, {}).get("version")
print(f"feed offers {app} {got} (previous {previous}); expected {want}")
print(f"served artifact sha256 {entry.get('sha256')} bytes {entry.get('bytes')}")
print(f"served holdURL {entry.get('holdURL')!r}; expected {hold!r}")
ok = got == want and (not hold or entry.get("holdURL") == hold)
raise SystemExit(0 if ok else 1)
PY
