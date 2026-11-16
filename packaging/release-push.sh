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
: "${KHU_HOLD_URL:?KHU_HOLD_URL is required: set it to the fixed loopback hold endpoint}"
HOLD_ARGS="--hold-url '$KHU_HOLD_URL'"

"${SSH[@]}" "K=\$HOME/Library/KHUpdater; \"\$K/bin/khu\" publish --feed \"\$K/feed\" --key \"\$K/keys/private.key\" \
  --app '$APP' --version '$VERSION' --artifact \"\$HOME/$STAGE/$BASE\" --changelog \"\$HOME/$STAGE/changelogs/$APP.md\" $HOLD_ARGS"

/usr/bin/python3 -I - "$HOST" "$APP" "$VERSION" "$KHU_HOLD_URL" "$DMG" <<'PY'
import base64, hashlib, json, pathlib, sys, urllib.parse, urllib.request
host, app, want, hold, artifact = sys.argv[1].split("@")[-1], sys.argv[2], sys.argv[3], sys.argv[4], pathlib.Path(sys.argv[5])
feed = json.loads(base64.b64decode(json.load(urllib.request.urlopen(f"http://{host}:8790/release.json", timeout=20))["feed"]))
entry = feed["apps"].get(app, {})
got = entry.get("version")
previous = (feed.get("previous") or {}).get(app, {}).get("version")
print(f"feed offers {app} {got} (previous {previous}); expected {want}")
print(f"served artifact sha256 {entry.get('sha256')} bytes {entry.get('bytes')}")
print(f"served holdURL {entry.get('holdURL')!r}; expected {hold!r}")
assert got == want, "served version differs"
assert entry.get("holdURL") == hold, "served holdURL differs"
local_sha = hashlib.sha256(artifact.read_bytes()).hexdigest()
assert entry.get("sha256") == local_sha, "served feed hash differs from local artifact"
assert entry.get("bytes") == artifact.stat().st_size, "served feed size differs from local artifact"
url = f"http://{host}:8790/artifacts/{urllib.parse.quote(entry['file'], safe='')}"
served_sha, served_bytes = hashlib.sha256(), 0
with urllib.request.urlopen(url, timeout=30) as response:
    while chunk := response.read(1024 * 1024):
        served_sha.update(chunk)
        served_bytes += len(chunk)
assert served_sha.hexdigest() == local_sha, "served artifact hash differs"
assert served_bytes == artifact.stat().st_size, "served artifact size differs"
print(f"verified served artifact: {served_sha.hexdigest()} ({served_bytes} bytes)")
PY
