# Storage Studio KH — agent guide

A KH menu-bar app (Tauri 2 + TypeScript, Swift helper) that reconnects chosen SMB shares and
attached disks after login, wake and network change. It mounts and unmounts; it never copies,
mirrors or syncs data.

## Rules that apply here

- Follow `/Users/you/Developer/_orchestra/developer-handoff/LEAD-RULES.md` and the owner's
  global instructions. They win over this file.
- First call of a session: the `ponytail` skill. `impeccable` before UI work. `headroom` before a
  log or file over ~500 lines. Graphify before hand-searching when a graph exists.
- Never bring an app to the front, never drive the pointer or keyboard, never leave a window for
  the owner to close. Tests launch hidden with their own data folder (`tests/gate.sh`).
- Commit as `112568204+theng12@users.noreply.github.com`.
- Nothing is deleted in place: retire to `~/Developer/_trash/storage-studio-kh/`.

## Verify before claiming done

```sh
cd helper && swift test
cd .. && npm run build:web && node --test tests/web.test.mjs
cd src-tauri && cargo test --quiet && cargo check --quiet
bash scripts/build-mac.sh          # full signed build + DMG
bash tests/gate.sh                 # hidden launch, retries, second instance, quit, no leftovers
```

## Invariants

- The helper lives only at `Contents/Helpers/Storage Studio KH Helper.app` and is this app's child.
  It must never outlive the app or leave a launchd job, plist or loose binary.
- Passwords are Keychain-only. Never log them, never put them in `settings.json`, never pass them
  on a command line.
- Check the mount table before mounting. A storage that is already mounted is never mounted twice.
- Retries are bounded (5 s, 15 s, 60 s) and end in `needs_attention` with one notification.
- `appearance` is `system` | `light` | `dark`; a stored `default` reads as `system`.
