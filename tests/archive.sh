#!/usr/bin/env bash
# Channel archive and restore, proven headless against the real helper binary.
# Every folder is a temp folder under $TMPDIR: no share, no window, no desktop, no login item.
#
#   bash tests/archive.sh [path/to/Storage Studio KH Helper binary]
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/toolchain.sh


HELPER="${1:-src-tauri/helper/Storage Studio KH Helper.app/Contents/MacOS/Storage Studio KH Helper}"
[ -x "$HELPER" ] || { echo "no helper at $HELPER" >&2; exit 2; }

RUN="$(mktemp -d "${TMPDIR:-/tmp}/storage-studio-archive.XXXXXX")"
trap 'rm -rf "$RUN"' EXIT

# The helper's own log goes beside the run, never into the app's real data folder.
mkdir -p "$RUN/home/Library/Application Support/Storage Studio KH"

python3 -I tests/archive.py "$HELPER" "$RUN"
