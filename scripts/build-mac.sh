#!/usr/bin/env bash
# Build and sign Storage Studio KH for this Mac; retention follows verified publication.
# This Mac builds; publishing happens on 1301 with packaging/release-push.sh.
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
(cd helper && swift test 2>&1 | tail -5)

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
python3 -I "$HOME/Developer/Shared Tools/kh-shared-ui/whats-new.py" CHANGELOG.md src-tauri/whats-new.json
[ "$(python3 -c "import json;print(json.load(open('src-tauri/whats-new.json'))[0]['version'])")" = "$version" ] \
  || fail "whats-new.json's newest entry is not $version"

step "Building and testing the web UI"
if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
npm run build:web
if [ -f tests/web.test.mjs ]; then node --test tests/web.test.mjs; fi

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
printf '\n\033[32mRelease ready: %s\033[0m\n' "$dmg"
