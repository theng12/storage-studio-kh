#!/usr/bin/env bash
# Build and sign Storage Studio KH for this Mac; retention follows verified publication.
# This Mac builds; the artifact goes to this app's own GitHub release (App Publisher uploads it)
# and System writes the feed row. The canonical release wrapper lives in update-studio-kh's
# packaging/; this repo carries no release script of its own (1301 is retired).
#
#   bash scripts/build-mac.sh            # full build + Swift tests
#   bash scripts/build-mac.sh --check    # versions, tools and identity only
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31mStopped: %s\033[0m\n' "$1" >&2; exit 1; }

retire() {
  local target="$1"
  [ -e "$target" ] || return 0
  local dest="$HOME/Desktop/_trash/storage-studio-kh/${target#./}.$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$(dirname "$dest")"
  mv "$target" "$dest"
  printf 'Retired %s -> %s\n' "$target" "$dest"
}

for p in /opt/homebrew/bin /opt/homebrew/opt/rustup/bin "$HOME/.cargo/bin" /usr/local/bin; do
  [ -d "$p" ] && [[ ":$PATH:" != *":$p:"* ]] && export PATH="$p:$PATH"
done

command -v swift >/dev/null || fail "Swift is missing; install the Xcode command line tools."
command -v node >/dev/null || fail "Node.js is missing."
command -v cargo >/dev/null || fail "Rust (cargo) is missing."
command -v python3 >/dev/null || fail "Python 3 is missing."
command -v hdiutil >/dev/null || fail "hdiutil is missing."
[ -f src-tauri/vendor/khsparkle/libkhsparkle.a ] || fail "the vendored libkhsparkle.a is missing"
[ -d src-tauri/vendor/khsparkle/Sparkle.framework ] || fail "the vendored Sparkle.framework is missing"
[ -f src-tauri/entitlements.plist ] || fail "src-tauri/entitlements.plist is missing"

not_run=""
step "Sparkle shim pin"
# A separate step with its own line: the scanner does not check the shim, and an unpinned library is
# exactly what made every app refuse its own hold (2026-11-23). No pin file means UNMEASURED.
pin_file="${KH_REQUIRED_SHIM:-$HOME/Developer/_orchestra/tools/pinned/REQUIRED-SHIM.txt}"
if [ ! -f "$pin_file" ]; then
  printf 'UNMEASURED  shim pin: no REQUIRED-SHIM.txt at %s\n' "$pin_file"
  not_run="${not_run:+$not_run; }shim pin (REQUIRED-SHIM.txt missing)"
else
  want="$(awk 'NF>=2 && $2=="libkhsparkle.a" {print $1; exit}' "$pin_file")"
  got="$(shasum -a 256 src-tauri/vendor/khsparkle/libkhsparkle.a | awk '{print $1}')"
  [ -n "$want" ] || fail "REQUIRED-SHIM.txt names no libkhsparkle.a line"
  [ "$want" = "$got" ] || fail "the vendored libkhsparkle.a is $got; the pin is $want"
  printf 'shim: libkhsparkle.a %s matches the pin\n' "$got"
fi

step "Checking the local signing identity"
security find-identity -p codesigning 2>/dev/null | grep -F '"KH Studio Local Signing"' >/dev/null \
  || fail "the shared 'KH Studio Local Signing' identity is missing; do not create a replacement"

step "Checking versions agree"
version="$(python3 -c "import json;print(json.load(open('src-tauri/tauri.conf.json'))['version'])")"
[ "$(python3 -c "import json;print(json.load(open('package.json'))['version'])")" = "$version" ] || fail "package.json version differs from tauri.conf.json"
[ "$(sed -n 's/^version = "\(.*\)"/\1/p' src-tauri/Cargo.toml | head -n1)" = "$version" ] || fail "Cargo.toml version differs from tauri.conf.json"
[ "$(awk '/^## / { print $2; exit }' CHANGELOG.md)" = "$version" ] || fail "CHANGELOG.md's newest entry is not $version"
printf 'Version %s\n' "$version"

if [ "${1:-}" = "--check" ]; then
  step "Check passed"
  exit 0
fi

# Keep a modest free margin for the build; check the unit on the system Data volume.
step "Free build space"
free_gb="$(df -g /System/Volumes/Data | awk 'NR==2 {print $4}')"
[ "${free_gb:-0}" -ge 10 ] || fail "Free build space is ${free_gb:-unknown} GiB (expected at least 10 GiB on /System/Volumes/Data); free space or choose a less busy build machine"

step "Helper tests"
# XCTest ships with Xcode, not with the Command Line Tools. Where it is absent this says so
# loudly and the archive checks in tests/gate.sh still prove archive, resume and restore
# against the real helper binary.
if echo 'import XCTest' | swiftc -typecheck - >/dev/null 2>&1; then
  (cd helper && swift test 2>&1 | tail -5)
else
  printf 'NOT RUN  helper unit tests: this Mac has no XCTest module (Command Line Tools only).\n'
  printf '         tests/gate.sh proves archive, resume and restore against the real helper binary.\n'
  not_run="helper unit tests — no XCTest module on this Mac (Command Line Tools only)"
fi

step "Building the helper (release)"
# Swift records absolute source and object paths unless they are remapped, and the
# shipped copy is stripped so no debug-info path reaches the bundle at all.
(cd helper && swift build -c release \
  -Xswiftc -file-prefix-map -Xswiftc "$PWD=/build/helper" \
  -Xswiftc -debug-prefix-map -Xswiftc "$PWD=/build/helper")
helper_bin="helper/.build/release/Storage Studio KH Helper"
[ -x "$helper_bin" ] || fail "the helper binary was not built"
helper_app="src-tauri/helper/Storage Studio KH Helper.app"
retire "$helper_app"
mkdir -p "$helper_app/Contents/MacOS" "$helper_app/Contents/Resources" "$helper_app/Contents/Helpers"
cp "$helper_bin" "$helper_app/Contents/MacOS/Storage Studio KH Helper"
chmod 0755 "$helper_app/Contents/MacOS/Storage Studio KH Helper"
strip -S "$helper_app/Contents/MacOS/Storage Studio KH Helper"
cp src-tauri/icons/icon.icns "$helper_app/Contents/Resources/icon.icns"
python3 - "$helper_app/Contents/Info.plist" "$version" <<'PY'
import plistlib, sys
plist = {
    "CFBundleName": "Storage Studio KH Helper",
    "CFBundleDisplayName": "Storage Studio KH Helper",
    "CFBundleIdentifier": "app.storagestudiokh.desktop.helper",
    "CFBundleExecutable": "Storage Studio KH Helper",
    "CFBundlePackageType": "APPL",
    "CFBundleShortVersionString": sys.argv[2],
    "CFBundleVersion": sys.argv[2],
    "CFBundleIconFile": "icon.icns",
    "LSUIElement": True,
    "NSHighResolutionCapable": True,
}
with open(sys.argv[1], "wb") as stream:
    plistlib.dump(plist, stream)
PY
codesign --force --sign "KH Studio Local Signing" "$helper_app/Contents/MacOS/Storage Studio KH Helper"
codesign --force --sign "KH Studio Local Signing" "$helper_app"
codesign --verify --strict "$helper_app"

step "What's New from CHANGELOG.md"
# The shared script lives in Shared Tools on a Mac that has it; the Updater's checkout
# carries the same file (moved to _orchestra/developer-system, measured 2026-11-22).
whats_new=""
for candidate in \
  "$HOME/Developer/Shared Tools/kh-shared-ui/whats-new.py" \
  "$HOME/Developer/_orchestra/developer-system/update-studio-kh/app/packaging/shared-ui/whats-new.py"; do
  [ -f "$candidate" ] && { whats_new="$candidate"; break; }
done
[ -n "$whats_new" ] || fail "whats-new.py is missing: looked in Shared Tools/kh-shared-ui and _orchestra/developer-system/update-studio-kh/app/packaging/shared-ui"
python3 -I "$whats_new" CHANGELOG.md src-tauri/whats-new.json
[ "$(python3 -c "import json;print(json.load(open('src-tauri/whats-new.json'))[0]['version'])")" = "$version" ] \
  || fail "whats-new.json's newest entry is not $version"

step "Building and testing the web UI"
if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
npm run build:web
if [ -f tests/web.test.mjs ]; then node --test tests/web.test.mjs; fi
# The publish readback's own check: a fixture row that lost type, holdSince or the description
# must fail it (2026-11-22: those fields passed a readback that only checked what it sent).
if [ -f tests/feed-check.sh ]; then bash tests/feed-check.sh || fail "the feed-check fixtures failed"; fi
if [ -f tests/share-picker.cjs ]; then
  # Headless Chromium against the dev fixture: no window, no share is contacted.
  picker_rc=0
  node tests/share-picker.cjs || picker_rc=$?
  if [ "$picker_rc" -eq 2 ]; then
    printf 'NOT RUN  share-picker checks: Playwright is not installed on this Mac.\n'
    not_run="${not_run:+$not_run; }share-picker checks (no Playwright)"
  elif [ "$picker_rc" -ne 0 ]; then
    fail "the share-picker checks failed"
  fi
fi
if [ -f tests/measure-0.1.21.cjs ]; then
  # The Archives page and the add-storage form, measured at 820x640 in both states.
  measure_rc=0
  node tests/measure-0.1.21.cjs || measure_rc=$?
  if [ "$measure_rc" -eq 2 ]; then
    printf 'NOT RUN  measured page checks: Playwright is not installed on this Mac.\n'
    not_run="${not_run:+$not_run; }measured page checks (no Playwright)"
  elif [ "$measure_rc" -ne 0 ]; then
    fail "the measured page checks failed"
  fi
fi
if [ -f tests/share-list.sh ]; then
  # The real helper lists the owner's NAS; SKIP lines when this Mac cannot reach it.
  bash tests/share-list.sh "helper/.build/out/Products/Release/Storage Studio KH Helper" || \
    fail "the share-list checks failed"
fi

step "Rust tests"
(cd src-tauri && cargo test --quiet)

step "Building the app and DMG (signed)"
npm run build:desktop -- --bundles app,dmg

app="src-tauri/target/release/bundle/macos/Storage Studio KH.app"
[ -d "$app" ] || fail "the app bundle was not produced at $app"

step "Verifying the bundle"
python3 - "$app" "$version" <<'PY'
import plistlib, sys
path, version = sys.argv[1], sys.argv[2]
plist = plistlib.load(open(path + "/Contents/Info.plist", "rb"))
assert plist.get("CFBundleIdentifier") == "app.storagestudiokh.desktop", plist.get("CFBundleIdentifier")
assert plist.get("CFBundleShortVersionString") == version, plist.get("CFBundleShortVersionString")
assert plist.get("CFBundleName") == "Storage Studio KH", plist.get("CFBundleName")
assert plist.get("LSUIElement") is True, "LSUIElement must be true (menu-bar app)"
print("Info.plist: id, version, name, LSUIElement ok")
PY
helper_inside="$app/Contents/Helpers/Storage Studio KH Helper.app"
[ -x "$helper_inside/Contents/MacOS/Storage Studio KH Helper" ] || fail "the helper is not inside the app bundle"
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleDisplayName' "$helper_inside/Contents/Info.plist" 2>/dev/null)" = "Storage Studio KH Helper" ] || fail "helper display name is missing"
[ "$(/usr/libexec/PlistBuddy -c 'Print :LSUIElement' "$helper_inside/Contents/Info.plist" 2>/dev/null)" = "true" ] || fail "helper LSUIElement is not true"
[ -f "$app/Contents/Resources/whats-new.json" ] || fail "whats-new.json is missing from Resources"
codesign --verify --strict "$helper_inside" || fail "the bundled helper's signature is broken"
codesign --verify --deep --strict "$app" || fail "the app's signature is broken"
# Sparkle: the framework travels beside the binary, the rpath finds it, and the entitlement is in
# the signature — the three things that decide whether the app survives its first second.
[ -d "$app/Contents/Frameworks/Sparkle.framework" ] || fail "the app carries no Sparkle.framework"
exe_name="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app/Contents/Info.plist")"
[ -x "$app/Contents/MacOS/$exe_name" ] || fail "the bundle names an executable it does not carry: $exe_name"
otool -l "$app/Contents/MacOS/$exe_name" | grep -q '@executable_path/../Frameworks' \
  || fail "the binary carries no @executable_path/../Frameworks rpath"
codesign -d --entitlements :- "$app" 2>/dev/null | grep -q 'disable-library-validation' \
  || fail "the app is signed without com.apple.security.cs.disable-library-validation"
codesign --verify --strict "$app/Contents/Frameworks/Sparkle.framework" \
  || fail "the embedded Sparkle.framework is not signed"
printf 'Sparkle: framework embedded, rpath present, entitlement present, framework signature ok\n'
# Nothing may be started from a loose copy outside the bundle.
[ -z "$(find "$app/Contents" -maxdepth 1 -name '*.app' ! -name 'Storage Studio KH.app')" ] || fail "a second app bundle sits loose in Contents"

step "Keeping the DMG in dist/"
mkdir -p dist
case "$(uname -m)" in
  arm64) dmg_arch=aarch64 ;;
  x86_64) dmg_arch=x64 ;;
  *) fail "unsupported DMG architecture: $(uname -m)" ;;
esac
dmg_source="src-tauri/target/release/bundle/dmg/Storage Studio KH_${version}_${dmg_arch}.dmg"
[ -f "$dmg_source" ] || fail "the packager did not produce the exact release DMG: $dmg_source"
dmg="dist/Storage Studio KH-${version}.dmg"
[ ! -e "$dmg" ] || fail "$dmg already exists; choose a fresh release version"
cp "$dmg_source" "$dmg"

verify_mount="$(mktemp -d /tmp/storage-studio-dmg.XXXXXX)"
hdiutil attach -nobrowse -mountpoint "$verify_mount" "$dmg" >/dev/null
trap 'hdiutil detach "$verify_mount" >/dev/null 2>&1 || true; rmdir "$verify_mount" 2>/dev/null || true' EXIT
[ -d "$verify_mount/Storage Studio KH.app" ] || fail "the DMG does not contain Storage Studio KH.app"
[ -x "$verify_mount/Storage Studio KH.app/Contents/Helpers/Storage Studio KH Helper.app/Contents/MacOS/Storage Studio KH Helper" ] || fail "the DMG's app has no helper"
[ -d "$verify_mount/Storage Studio KH.app/Contents/Frameworks/Sparkle.framework" ] || fail "the DMG's app carries no Sparkle.framework"
codesign -d --entitlements :- "$verify_mount/Storage Studio KH.app" 2>/dev/null | grep -q 'disable-library-validation' \
  || fail "the DMG's app is signed without com.apple.security.cs.disable-library-validation"
printf 'DMG: Sparkle.framework present and the entitlement survived signing inside the mounted copy\n'
hdiutil detach "$verify_mount" >/dev/null
rmdir "$verify_mount"
trap - EXIT

# Keep the prior verified installers until the new release has passed its packaged gate and
# served-feed readback. Run scripts/retain-dist.py during release closeout, never during build.

sha="$(shasum -a 256 "$dmg" | awk '{print $1}')"
bytes="$(stat -f %z "$dmg")"
python3 - "$dmg" "$version" "$sha" "$bytes" <<'PY'
import json, sys, datetime
path, version, sha, size = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
receipt = {
    "app": "Storage Studio KH",
    "bundleID": "app.storagestudiokh.desktop",
    "version": version,
    "artifact": path,
    "sha256": sha,
    "bytes": size,
    "builtAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
}
with open(f"dist/receipt-{version}.json", "w") as stream:
    json.dump(receipt, stream, indent=2)
print(json.dumps(receipt, indent=2))
PY
if [ -n "$not_run" ]; then
  printf '\n\033[33mNOT RUN, and not claimed as passed: %s\033[0m\n' "$not_run"
fi
printf '\n\033[32mRelease ready: %s\033[0m\n' "$dmg"
