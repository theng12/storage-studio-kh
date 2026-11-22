#!/bin/bash
# The release path: this Mac builds, 1301 publishes. Nothing here writes the feed.
#
#   packaging/release-push.sh <feed-app-id> <version> <dmg> <changelog> [tagline] [description]
#
# Copies the DMG and its changelog to the release host's staging folder and runs `khu publish`
# there, then reads the served feed back and prints the version it now offers. The tagline is the
# Launcher card's one sentence (owner, 2026-11-22): 62 characters or fewer, from ABOUT.md. The
# description is the owner-approved store row text, carried here until the publisher carries it.
set -euo pipefail
HOST="${KHU_RELEASE_HOST:-vengtheng@100.82.91.102}"
KEY="${KHU_RELEASE_KEY:-$HOME/.ssh/id_ed25519_gateway1301}"
STAGE="${KHU_RELEASE_STAGE:-Library/KHUpdater/feed-incoming-$(date +%Y%m%d)}"
(( $# >= 4 && $# <= 6 )) || { echo "usage: $0 <feed-app-id> <version> <dmg> <changelog> [tagline] [description]" >&2; exit 2; }
APP="$1"; VERSION="$2"; DMG="$3"; LOG="$4"; TAGLINE="${5:-}"; DESCRIPTION="${6:-}"
[ -f "$DMG" ] || { echo "no such DMG: $DMG" >&2; exit 2; }
[ -f "$LOG" ] || { echo "no such changelog: $LOG" >&2; exit 2; }
[ -z "$TAGLINE" ] || [ ${#TAGLINE} -le 62 ] || { echo "tagline is ${#TAGLINE} characters; 62 is the limit" >&2; exit 2; }
BASE=$(basename "$DMG")
SSH=(ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=10 "$HOST")

"${SSH[@]}" "mkdir -p ~/$STAGE/changelogs"
scp -i "$KEY" -o BatchMode=yes "$DMG" "$HOST:$STAGE/$BASE"
scp -i "$KEY" -o BatchMode=yes "$LOG" "$HOST:$STAGE/changelogs/$APP.md"
# The signed feed names where a running copy takes an update hold (owner rule 2026-11-15).
: "${KHU_HOLD_URL:?KHU_HOLD_URL is required: set it to the fixed loopback hold endpoint}"
HOLD_ARGS="--hold-url '$KHU_HOLD_URL'"
TAG_ARGS=""
[ -z "$TAGLINE" ] || TAG_ARGS="--tagline '$TAGLINE'"
DESC_ARGS=""
[ -z "$DESCRIPTION" ] || DESC_ARGS="--description '$DESCRIPTION'"

"${SSH[@]}" "K=\$HOME/Library/KHUpdater; B=\"\$K/base/current\"; [ -x \"\$B\" ] || { echo \"refused: no current khu at \$B\" >&2; exit 3; }; \"\$B\" publish --feed \"\$K/feed\" --key \"\$K/keys/private.key\" \
  --app '$APP' --version '$VERSION' --artifact \"\$HOME/$STAGE/$BASE\" --changelog \"\$HOME/$STAGE/changelogs/$APP.md\" $HOLD_ARGS $TAG_ARGS $DESC_ARGS"

/usr/bin/python3 -I - "$HOST" "$APP" "$VERSION" "$KHU_HOLD_URL" "$DMG" "$TAGLINE" "$DESCRIPTION" <<'PY'
import base64, hashlib, json, pathlib, sys, urllib.parse, urllib.request
host, app, want, hold, artifact, tagline, description = sys.argv[1].split("@")[-1], sys.argv[2], sys.argv[3], sys.argv[4], pathlib.Path(sys.argv[5]), sys.argv[6], sys.argv[7]
feed = json.loads(base64.b64decode(json.load(urllib.request.urlopen(f"http://{host}:8790/release.json", timeout=20))["feed"]))
entry = feed["apps"].get(app, {})
got = entry.get("version")
previous = (feed.get("previous") or {}).get(app, {}).get("version")
print(f"feed offers {app} {got} (previous {previous}); expected {want}")
print(f"served artifact sha256 {entry.get('sha256')} bytes {entry.get('bytes')}")
print(f"served holdURL {entry.get('holdURL')!r}; expected {hold!r}")
print(f"served tagline {entry.get('tagline')!r}")
assert got == want, "served version differs"
assert entry.get("holdURL") == hold, "served holdURL differs"
assert not tagline or entry.get("tagline") == tagline, "served tagline differs — the Launcher card would be blank"
assert not description or entry.get("description") == description, "served description differs"
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
