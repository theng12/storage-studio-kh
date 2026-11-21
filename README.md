# Storage Studio KH

A menu-bar app for macOS that reconnects the network shares and attached disks you choose
after login, after wake, and after a network change. It mounts and unmounts; it never copies,
mirrors or syncs anything.

- **Add storage** in Settings: an SMB share (`smb://host/share`) or an attached disk.
- **Bounded retries**: 5 s, 15 s, 60 s, then it stops and marks the storage *Needs attention*
  until you choose Mount now.
- **Never mounts twice**: it reads the mount table first and reflects what is already mounted.
- **Private file only**: share passwords live in the app's own data folder, one file readable only by you (0600).

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
| `helper/` | Swift helper: mount table, NetFS SMB mounts, `diskutil`, the private secret file, wake/network watching, bounded retries |
| `ui/` | Settings window (plain TypeScript + Vite) |
| `tests/` | Gate scripts and UI tests |
| `docs/contract.md` | App ↔ UI contract |

## Release

Build here, then `packaging/release-push.sh storage-studio 0.1.10 "dist/Storage Studio KH-0.1.10.dmg" CHANGELOG.md "Reconnects your network shares after login"`.
The last argument is the Launcher card's one sentence (62 characters or fewer, taken from
`ABOUT.md`). It stages the DMG and changelog on 1301, publishes with the host's own key (the only
feed writer), and reads the served feed back to prove the version and tagline it offers.

Then carry the row onto the public page — a release is not finished until the page serves it:

```sh
bash packaging/page-sync.sh --app storage-studio --accepted <sha256> \
  --repo theng12/kh-releases --feed-url http://100.82.91.102:8790/release.json
```

`--accepted` must be the sha256 `feed-verify.sh` passed. Run `--dry-run` first and read the nine
steps; check no other app's page-sync is mid-run (step 8 rebuilds the whole page).

## Verification status (0.1.10)

Verified on this Mac: mount-table detection against the real attached volumes and the real NAS
shares; unmount → remount of a NAS share through NetFS with the saved credential; share listing
(`smbutil view`) over a private terminal, including spaces and dashes, with IPC$ filtered and wrong
credentials reported as needing a user name and a password; the bounded retry ladder ending in one
Needs attention; private-file save/forget; launch/quit/force-quit leaving no helper or launchd job;
a second launch handled plainly; DMG signature and install; launch at login.

UI: every page and dialog is measured at 375/768/820/1440 in light and dark by
`tests/acceptance/run.cjs` (258 checks), and independent critics re-walked the app until it met the
studio bar; their reports are `tests/acceptance/critic-round*.md`. The window reflow, status line,
discard prompt, Undo, Restart helper, duplicate blocking, keyboard focus and the 1–8 retries picker
are covered there. Login items register once, only from the installed `.app`; a development build
never registers. Tests run on the shared machine lane with `lane-mem.sh` (UI peak 794 MB).

Still the owner's hands-on step: add a share in the app's own dialog on a Mac whose private file
has no credential yet, so the in-app password prompt itself is exercised.

## Data

`~/Library/Application Support/Storage Studio KH/` holds `settings.json` and `log.txt`.
Share passwords live in `secrets.json` in that folder (0600). Removing the app leaves the folder so a reinstall keeps your storage list; delete it by hand if you want it gone.
