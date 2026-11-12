# Storage Studio KH

A menu-bar app for macOS that reconnects the network shares and attached disks you choose
after login, after wake, and after a network change. It mounts and unmounts; it never copies,
mirrors or syncs anything.

- **Add storage** in Settings: an SMB share (`smb://host/share`) or an attached disk.
- **Bounded retries**: 5 s, 15 s, 60 s, then it stops and marks the storage *Needs attention*
  until you choose Mount now.
- **Never mounts twice**: it reads the mount table first and reflects what is already mounted.
- **Keychain only**: share passwords live in the login Keychain, one item per storage.

## Build

```sh
bash scripts/build-mac.sh
```

Builds and signs on this Mac with `KH Studio Local Signing`, runs the helper tests, and keeps
the newest three DMGs in `dist/`. The helper (`Contents/Helpers/Storage Studio KH Helper.app`)
is built from `helper/` and lives only inside the app.

## Layout

| Path | What |
| --- | --- |
| `src-tauri/` | Tauri 2 shell: tray, settings store, update check, helper supervisor |
| `src-tauri/src/main.rs` | Rust core and commands |
| `helper/` | Swift helper: mount table, NetFS SMB mounts, `diskutil`, Keychain, wake/network watching, bounded retries |
| `ui/` | Settings window (plain TypeScript + Vite) |
| `tests/` | Gate scripts and UI tests |
| `docs/contract.md` | App ↔ UI contract |

## Release

Build here, then `packaging/release-push.sh storage-studio 0.1.0 "dist/Storage Studio KH-0.1.0.dmg" CHANGELOG.md`.
It stages the DMG and changelog on 1301, publishes with the host's own key (the only feed
writer), and reads the served feed back to prove the version it offers.

## Data

`~/Library/Application Support/Storage Studio KH/` holds `settings.json` and `log.txt`.
Share passwords are not in either file. Removing the app leaves the folder and the Keychain
items so a reinstall keeps your storage list; remove them by hand if you want them gone.
