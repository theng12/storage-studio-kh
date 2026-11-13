# Storage Studio KH 0.1.10 — release evidence

Status: **in progress** (last updated 2026-11-13 23:10Z). Everything below is measured; the
unfilled rows are pending and are never to be read as passed.

## Source

- Version 0.1.10 in `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `Cargo.lock`,
  `CHANGELOG.md`, `src-tauri/whats-new.json`.
- Commits: `bd30b21` (0.1.8) → `2b57f0b`, `746bbfd`, `3dfa2da`, `e772387`, `1242b8f`, `394b361`,
  `70be339`, `86c93af` (0.1.10 work).
- Working tree clean at `86c93af` plus the pending lane work (none).

## Page acceptance (`tests/acceptance/run.cjs`)

- Last run: **281/281 checks passed**, metered `PEAK storage-ui 670 MB over 97s` (runs ranged 609–794 MB).
- Layout measured at 375/768/820/1440 in light and dark, both Cards and Table views.
- Contrast measured from rendered styles: body 16.33:1 light / 12.60:1 dark; quiet footer
  5.13:1 / 7.14:1; chips 5.10:1 / 7.91:1; primary 6.41:1 / 8.92:1. Full tables in
  `contrast-0.1.10.md`.
- Completeness artifacts in `completeness-0.1.10.md` (task list, capability cross-check, standard
  comparison; the cross-check found and fixed the missing Forget-saved-password control).

## Unit and helper tests

- Web unit tests: **30/30** (`tests/web.test.mjs`), typecheck clean.
- Rust tests: pending the build (`cargo test` in `scripts/build-mac.sh`), including the new
  login-item guard and same-share identity tests.
- Swift helper tests: pending the build; the helper now always answers a Test and forgets an
  explicit previous identity.

## Independent critics

| Round | Verdict | Report |
| --- | --- | --- |
| 1 | FAIL 3/3/2/2/3 — 18 findings, all fixed | `critic-round1.md` |
| 2 | FAIL 4/3/4/3/3 — 9 findings, all fixed | `critic-round2.md` |
| 3 | FAIL 4/4/4/3/3 — 7 findings, all fixed | `critic-round3.md` |
| 4 | FAIL 4/4/4/3/4 — 2 focus findings, fixed | `critic-round4.md` |
| 5 | FAIL 3/3/3/2/3 — 9 findings, fixed at 70be339 | `critic-round5.md` |
| 6 | FAIL 2/3/3/2/3 — 8 findings, fixed at 6b5df20 (first attempt died and was restarted) | `critic-round6.md` |
| 7 | running on 6b5df20 | — |

## Native gate (story-mini, macmini-angkor)

- Pending 0.1.10 install: `tests/gate.sh` (6 checks) and `tests/mini-reopen.sh` (5 checks). 0.1.9
  passed both earlier this session.

## Artifact, publish and readback

- DMG: pending (metered `PEAK storage-build`).
- Served feed 1301: currently 0.1.8; 0.1.10 publish pending, with served artifact sha256 and
  readback.
