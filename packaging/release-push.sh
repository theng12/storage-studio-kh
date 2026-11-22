#!/bin/bash
# The release path: this Mac builds, 1301 publishes. Nothing here writes the feed.
#
#   packaging/release-push.sh <feed-app-id> <version> <dmg> <changelog> [tagline] [description] [type] [hold-since]
#
# Copies the DMG and its changelog to the release host's staging folder and runs `khu publish`
# there, then reads the served feed back and checks every field sent. The tagline is the Launcher
# card's one sentence (owner, 2026-11-22): 62 characters or fewer, from ABOUT.md. The description
# is the owner-approved store row text. Type and hold-since are optional and only sent when given;
# a description without its tagline is refused (a lone description leaves the card blank).
set -euo pipefail
HOST="${KHU_RELEASE_HOST:-vengtheng@100.82.91.102}"
KEY="${KHU_RELEASE_KEY:-$HOME/.ssh/id_ed25519_gateway1301}"
STAGE="${KHU_RELEASE_STAGE:-Library/KHUpdater/feed-incoming-$(date +%Y%m%d)}"
(( $# >= 4 && $# <= 8 )) || { echo "usage: $0 <feed-app-id> <version> <dmg> <changelog> [tagline] [description] [type] [hold-since]" >&2; exit 2; }
APP="$1"; VERSION="$2"; DMG="$3"; LOG="$4"; TAGLINE="${5:-}"; DESCRIPTION="${6:-}"; TYPE="${7:-}"; HOLD_SINCE="${8:-}"
[ -f "$DMG" ] || { echo "no such DMG: $DMG" >&2; exit 2; }
[ -f "$LOG" ] || { echo "no such changelog: $LOG" >&2; exit 2; }
[ -z "$TAGLINE" ] || [ ${#TAGLINE} -le 62 ] || { echo "tagline is ${#TAGLINE} characters; 62 is the limit" >&2; exit 2; }
[ -z "$DESCRIPTION" ] || [ -n "$TAGLINE" ] || { echo "refused: a description needs its tagline too" >&2; exit 2; }
[ -z "$TYPE" ] || [[ "$TYPE" =~ ^(business|entertainment|extension|media|plugin|system|utility)$ ]] \
  || { echo "type must be business, entertainment, extension, media, plugin, system or utility: $TYPE" >&2; exit 2; }
[ -z "$HOLD_SINCE" ] || [[ "$HOLD_SINCE" =~ ^[0-9]+(\.[0-9]+)+$ ]] \
  || { echo "hold-since must be a dotted numeric version: $HOLD_SINCE" >&2; exit 2; }
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
TYPE_ARGS=""
[ -z "$TYPE" ] || TYPE_ARGS="--type '$TYPE'"
SINCE_ARGS=""
[ -z "$HOLD_SINCE" ] || SINCE_ARGS="--hold-since '$HOLD_SINCE'"

"${SSH[@]}" "K=\$HOME/Library/KHUpdater; B=\"\$K/base/current\"; [ -x \"\$B\" ] || { echo \"refused: no current khu at \$B\" >&2; exit 3; }; \"\$B\" publish --feed \"\$K/feed\" --key \"\$K/keys/private.key\" \
  --app '$APP' --version '$VERSION' --artifact \"\$HOME/$STAGE/$BASE\" --changelog \"\$HOME/$STAGE/changelogs/$APP.md\" $HOLD_ARGS $TAG_ARGS $DESC_ARGS $TYPE_ARGS $SINCE_ARGS"

SHA=$(/usr/bin/shasum -a 256 "$DMG" | awk '{print $1}')
BYTES=$(/usr/bin/stat -f %z "$DMG")
CHECKS=(--app "$APP" --feed-url "http://${HOST##*@}:8790/release.json" --artifact "$DMG"
        --expect-version "$VERSION" --expect-sha "$SHA" --expect-bytes "$BYTES"
        --expect-hold-url "$KHU_HOLD_URL")
[ -z "$TAGLINE" ] || CHECKS+=(--expect-tagline "$TAGLINE")
[ -z "$DESCRIPTION" ] || CHECKS+=(--expect-description "$DESCRIPTION")
[ -z "$TYPE" ] || CHECKS+=(--expect-type "$TYPE")
[ -z "$HOLD_SINCE" ] || CHECKS+=(--expect-hold-since "$HOLD_SINCE")
/usr/bin/python3 -I "$(dirname "$0")/feed-check.py" "${CHECKS[@]}"
