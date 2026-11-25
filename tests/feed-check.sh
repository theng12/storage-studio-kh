#!/bin/bash
# The readback must fail on a row that lost a field it was told to expect. No network: fixtures.
set -uo pipefail
cd "$(dirname "$0")/.."
. scripts/toolchain.sh

CHECK="packaging/feed-check.py"
T=$(mktemp -d "${TMPDIR:-/tmp}/feed-check.XXXXXX"); trap 'rm -rf "$T"' EXIT

row() { # row <file> <field-overrides as jq-less python>
  python3 - "$1" "$2" <<'PY'
import json, sys
path, overrides = sys.argv[1], json.loads(sys.argv[2])
entry = {"version": "0.1.24", "sha256": "a"*64, "bytes": 123,
         "tagline": "t", "description": "d", "type": "utility", "holdURL": "h", "holdSince": "0.1.11"}
entry.update(overrides)
for k, v in list(entry.items()):
    if v is None: del entry[k]
json.dump({"apps": {"storage-studio": entry}}, open(path, "w"))
PY
}

EXPECT=(--app storage-studio --expect-version 0.1.24 --expect-sha "$(printf 'a%.0s' {1..64})"
        --expect-bytes 123 --expect-tagline t --expect-description d --expect-type utility
        --expect-hold-url h --expect-hold-since 0.1.11)
pass=0; fail=0
want() { # want <name> <expected-rc> <feed>
  python3 -I "$CHECK" "${EXPECT[@]}" --feed-json "$3" >/dev/null 2>&1
  rc=$?
  if [ "$rc" = "$2" ]; then pass=$((pass+1)); printf 'PASS  %s\n' "$1"
  else fail=$((fail+1)); printf 'FAIL  %s (rc %s, wanted %s)\n' "$1" "$rc" "$2"; fi
}

row "$T/full.json" '{}'
row "$T/no-type.json" '{"type": null}'
row "$T/no-since.json" '{"holdSince": null}'
row "$T/no-desc.json" '{"description": null}'
row "$T/wrong-desc.json" '{"description": "something else"}'
row "$T/wrong-tagline.json" '{"tagline": null}'

want "a complete row passes" 0 "$T/full.json"
want "a row without type fails" 1 "$T/no-type.json"
want "a row without holdSince fails" 1 "$T/no-since.json"
want "a row without the approved description fails" 1 "$T/no-desc.json"
want "a row with a different description fails" 1 "$T/wrong-desc.json"
want "a row without a tagline fails" 1 "$T/wrong-tagline.json"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
