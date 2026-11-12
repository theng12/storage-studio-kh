#!/usr/bin/env bash
# Build and sign Storage Studio KH for this Mac, then keep the newest three DMGs in dist/.
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
  local dest="$HOME/Developer/_trash/storage-studio-kh/${target#./}.$(date +%Y%m%d-%H%M%S)"
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

step "Disk floor (80 GB)"
free_gb="$(df -g /System/Volumes/Data | awk 'NR==2 {print $4}')"
[ "$free_gb" -ge 80 ] || fail "only ${free_gb} GB free; the owner's floor is 80 GB"

step "Helper tests"
(cd helper && swift test 2>&1 | tail -5)

step "Building the helper (release)"
(cd helper && swift build -c release)
helper_bin="helper/.build/release/Storage Studio KH Helper"
[ -x "$helper_bin" ] || fail "the helper binary was not built"
helper_app="src-tauri/helper/Storage Studio KH Helper.app"
retire "$helper_app"
mkdir -p "$helper_app/Contents/MacOS" "$helper_app/Contents/Resources" "$helper_app/Contents/Helpers"
cp "$helper_bin" "$helper_app/Contents/MacOS/Storage Studio KH Helper"
chmod 0755 "$helper_app/Contents/MacOS/Storage Studio KH Helper"
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
dmg_source="$(ls -t src-tauri/target/release/bundle/dmg/*.dmg | head -n1)"
[ -f "$dmg_source" ] || fail "the packager made no DMG"
dmg="dist/Storage Studio KH-${version}.dmg"
[ ! -e "$dmg" ] || fail "$dmg already exists; choose a fresh release version"
cp "$dmg_source" "$dmg"

verify_mount="$(mktemp -d /tmp/storage-studio-dmg.XXXXXX)"
hdiutil attach -nobrowse -mountpoint "$verify_mount" "$dmg" >/dev/null
trap 'hdiutil detach "$verify_mount" >/dev/null 2>&1 || true; retire "$verify_mount"' EXIT
[ -d "$verify_mount/Storage Studio KH.app" ] || fail "the DMG does not contain Storage Studio KH.app"
[ -x "$verify_mount/Storage Studio KH.app/Contents/Helpers/Storage Studio KH Helper.app/Contents/MacOS/Storage Studio KH Helper" ] || fail "the DMG's app has no helper"
hdiutil detach "$verify_mount" >/dev/null
retire "$verify_mount"
trap - EXIT

step "Retention: newest three DMGs"
python3 -I scripts/retain-dist.py "Storage Studio KH" "$version"

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
