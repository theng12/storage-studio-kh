#!/usr/bin/env bash
# Every address format a person may paste, driven through the real helper. The NAS checks skip
# cleanly (SKIP, not FAIL) when this Mac cannot reach it — a machine with no NAS proves nothing,
# and saying so is the point. Nothing is mounted under /Volumes and no window is shown.
#
#   bash tests/mount-check.sh [path/to/Storage Studio KH Helper binary]
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/toolchain.sh

HELPER="${1:-src-tauri/target/release/bundle/macos/Storage Studio KH.app/Contents/Helpers/Storage Studio KH Helper.app/Contents/MacOS/Storage Studio KH Helper}"
[ -x "$HELPER" ] || { echo "no helper at $HELPER" >&2; exit 2; }

RUN="$(mktemp -d "${TMPDIR:-/tmp}/storage-studio-mount.XXXXXX")"
trap 'rm -rf "$RUN"' EXIT

python3 -I tests/mount-check.py "$HELPER" "$RUN"
