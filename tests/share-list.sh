#!/usr/bin/env bash
# Share listing, proven against the real helper binary.
# The NAS checks skip when this Mac cannot reach it; nothing is mounted, no window is shown.
#
#   bash tests/share-list.sh [path/to/Storage Studio KH Helper binary]
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/toolchain.sh


HELPER="${1:-src-tauri/helper/Storage Studio KH Helper.app/Contents/MacOS/Storage Studio KH Helper}"
[ -x "$HELPER" ] || { echo "no helper at $HELPER" >&2; exit 2; }

RUN="$(mktemp -d "${TMPDIR:-/tmp}/storage-studio-sharelist.XXXXXX")"
trap 'rm -rf "$RUN"' EXIT
mkdir -p "$RUN/home/Library/Application Support/Storage Studio KH"

python3 -I tests/share-list.py "$HELPER" "$RUN"
