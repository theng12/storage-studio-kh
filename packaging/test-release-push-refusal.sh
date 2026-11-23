#!/bin/bash
# The 1301 guard is real only if it stops before the first upload. Run the release script the way a
# person would, with ssh and scp replaced by markers, and require three things: exit 2, the refusal
# sentence, and no marker file — a refusal that still staged something on the host would pass a test
# that only checked the exit code.
set -uo pipefail
cd "$(dirname "$0")/.."
TMP=$(mktemp -d "${TMPDIR:-/tmp}/kh-1301-guard.XXXXXX")
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"
for tool in ssh scp; do
  printf '#!/bin/sh\ntouch "%s/%s-was-reached"\nexit 0\n' "$TMP" "$tool" > "$TMP/bin/$tool"
  chmod +x "$TMP/bin/$tool"
done
: > "$TMP/app.dmg"; : > "$TMP/CHANGELOG.md"
OUT=$(PATH="$TMP/bin:$PATH" KHU_RELEASE_KEY=/dev/null KHU_RELEASE_HOST=127.0.0.1 \
  ./packaging/release-push.sh test-app 9.9.9 "$TMP/app.dmg" "$TMP/CHANGELOG.md" 2>&1)
RC=$?
fail() { echo "FAIL: $*" >&2; echo "--- output ---" >&2; printf '%s\n' "$OUT" >&2; exit 1; }
[ "$RC" -eq 2 ] || fail "expected exit 2 from the 1301 guard, got $RC"
printf '%s\n' "$OUT" | grep -q "1301 is retired as a release host" || fail "the refusal sentence is missing"
[ -e "$TMP/ssh-was-reached" ] && fail "ssh was reached before the guard"
[ -e "$TMP/scp-was-reached" ] && fail "scp was reached before the guard"
echo "PASS: the 1301 guard refuses with exit 2 and nothing was staged"
