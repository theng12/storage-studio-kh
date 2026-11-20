# Storage Studio KH — what it is

Storage Studio KH is a macOS menu-bar app that reconnects the network shares and
attached disks you choose after login, after wake and after a network change. It
only mounts and unmounts storage; it never copies, mirrors or syncs anything.

## What it does

- Adds an SMB share (`smb://host/share`) or an attached disk from Settings and
  reconnects it on the events above.
- Retries at 5 s, 15 s and 60 s, then stops and marks the storage Needs attention
  until you choose Mount now.
- Reads the mount table first, so an already mounted share is reflected rather
  than mounted twice.
- Keeps share passwords in `secrets.json` in its own data folder, readable only by
  the signed-in user (0600), with atomic writes.
- Keeps the Swift helper as a child inside the app bundle; launch, quit and
  force-quit leave no helper or launchd job behind.
- Registers launch-at-login only from the installed `.app`, and stores the
  appearance choice as system, light or dark.
- Shows mount and attention state in the menu bar and settings window; UI checks
  cover 375, 768, 820 and 1440 widths in light and dark.

## How it is built

Tauri 2 shell in Rust (`src-tauri/`: tray, settings store, update check, helper
supervisor), a Swift helper (`helper/`: mount table, NetFS SMB mounts, `diskutil`,
wake/network watching, bounded retries and the private secret file), a plain
TypeScript + Vite settings window (`ui/`) and gate/UI tests (`tests/`).

Build and sign the DMG with:

    bash scripts/build-mac.sh

## Where it fits

It is a standalone utility for one Mac. It does not use Studio Hub, GatewayKH or a
job queue, and its helper lives only inside the signed app. Updates go through the
shared Updater feed; settings and logs stay in `~/Library/Application
Support/Storage Studio KH/`.

## Current version

0.1.17, from the `version` field in `package.json`; the newest `CHANGELOG.md` entry
agrees.
