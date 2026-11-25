# Release receipt — storage 0.1.31

The saved-login mount attempt: with no password of this app's own, the helper offers the login macOS
already saved to NetAuth before asking the person for one. **The behaviour is not exercised** — no NAS
is reachable from this Mac — and this receipt says so everywhere it applies.

app: storage
version: 0.1.31
commit: eacaf25fbc47fbc0156f66e3a4124e18f8e1be5a
artifact: $HOME/Developer/_orchestra/developer-utilities/storage-studio-kh/app/dist/Storage Studio KH-0.1.31.dmg
sha256: 7a5c560bcc8e298756653b958519f0a9c3e11303781d66eabfc33584c5a0a853
bytes: 5604910
scan: sha256=7a5c560bcc8e298756653b958519f0a9c3e11303781d66eabfc33584c5a0a853 clean — scan-dmg/2026-11-20, exit 0, 96 files, `scan-dmg: clean`
gate config: $HOME/Developer/_orchestra/tools/gate-configs/storage-0.1.31.sh
gate exit: 0 — `GATE PASS storage eacaf25fbc47fbc0156f66e3a4124e18f8e1be5a 2026-11-25T17:15:22Z`
gate runner: `gate-run.sh 8df512ad14da` — SHA-256 `8df512ad14da721f9e48e19d6be58fa100abf6f00b02df177e4ffd288492de70`, 49,914 B, as this gate's own summary recorded it; byte-identical to the plugin copy at `Shared Tools/studio-orchestration/plugins/studio-orchestration/scripts/gate-run.sh` (`cmp` clean). **The canonical runner changed since 0.1.30** — that release ran `528de9fe53d0`, this one `8df512ad14da`; the only pin in `tools/pinned/` is still `gate-run-528de9fe53d0c0de.sh`, so this run's bytes are named by hash above rather than by a pin
feed readback: **appcast** — `https://theng12.github.io/storage-studio-kh/appcast.xml` serves `0.1.31` (length 5,604,910) and `0.1.30`; the served text's signature was verified over the anonymously downloaded 0.1.31 DMG with `docs/verify-appcast.swift` → **SIGNATURE OK** (rc 0). Pages build `2f181bd` — `built`. **Estate row `storage-studio`: SERVED `0.1.31`** — `published_at 2026-11-25T17:25:33.810Z`, sha `7a5c560b…`, `5,604,910` B, file `Storage Studio KH-0.1.31.dmg`, tagline present, envelope sha256 `9304d2fe4e62e2df3e4cfef8fcb0941a9a722531b9330afb8c2c852614c5f38d`, Pages commit `kh-releases ae20a16e`, `url` = the 0.1.31 release asset. **Re-verified here, not taken on report**: `feed-verify.sh storage-studio --expect-version 0.1.31 --expect-sha 7a5c560b… --public-key <fleet key>` → `PASS signature — Ed25519 verified against key <fingerprint>` then `PASS`; and `check-dist-retention.sh storage-studio dist` → `PASS every dist artifact is on the feed: 0.1.30, 0.1.31`
page state: release page live at `theng12/storage-studio-kh` tag `0.1.31`, non-draft, one asset
dirty: false
retired: `Storage Studio KH-0.1.28.dmg` moved to `~/Desktop/_trash/storage-studio-kh/2026-11-25 0.1.28 dmg retired at 0.1.30 publish/` (by 0.1.30); **this release retires `Storage Studio KH-0.1.29.dmg`** — see Retention
not proven: **NAS credential recovery — `not exercised — no NAS exists to test against`** (measured: `nc -z 100.69.137.42 445` refuses, `ping` 100% packet loss, `smbutil statshares -a` lists no share; `tests/mount-check.sh` printed 4 SKIP lines naming the reason and exited 0); **live Sparkle self-update click-through on an installed copy**: UNMEASURED; **estate feed row**: served and verified above (S001's pass; re-read here)

## What shipped

- **`NetFS.mountSMB` takes a `savedLogin` flag.** With it no user and no password are passed to
  `NetFSMountURLSync` and the `Guest` option is **not** set, so NetAuth is free to use the credential
  the person already saved in the login keychain; `NoUserPrompt` and `AllowLoopback` remain set, so
  nothing can appear on screen. Without the flag the call is byte-for-byte what 0.1.30 made.
- **`Engine.performMount` uses it exactly where the old code gave up.** With a user name configured and
  no password of this app's own, the helper mounts once with `savedLogin: true`. A NetAuth denial
  (`-128` userCanceledErr, and the `kNetAuthError*` family the header documents at `-6000…-6600`) is
  treated as a credential answer: the row says "This device needs a user name and password" and the
  window opens Settings, which is what the old code said without trying. Any other result — the share
  is gone, the device did not answer — is returned as it came, so a real fault is not disguised as a
  password problem.
- **The denial message claims nothing it cannot know.** This path also runs when no saved login
  exists, and the helper cannot tell the two apart, so the wording says the device needs a user name
  and password rather than "your saved login failed".

The change is deliberately shaped so the *failure* mode is the behaviour 0.1.30 already had: a denial
lands the person in Settings, exactly as before. What is new is only the attempt before it.

## Why the proof line is `not exercised`, not passed

The owner's rule: code-shaped work rides the release, proof-shaped items go on the receipt as
`not exercised`, once. This Mac has no NAS to reach, so no run could prove that a keychain login is
actually used. What *was* measured is that the path cannot be reached and says why:

```
SKIP  bare-ip: the NAS cannot be reached from this Mac (Can't reach 100.69.137.42 right now. Address tried: smb://100.69.137.42/Public Space-System pool Retrying in 5 s.)
SKIP  double-slash: … nonexistent share …
SKIP  picked-from-list: …
SKIP  no format could be mounted because the NAS was not reachable
All mount checks passed (4 skipped)
```

Nothing here shows the code path has run against a device that has a saved login.

## Gate

Six steps plus the runner's own two, all green, evidence
`lead/0.1.31/evidence/gate-20261126-000226-61509`:

```
runner: gate-run.sh 8df512ad14da at ~/Developer/_orchestra/tools/gate-run.sh
step build :: bash scripts/build-mac.sh
step scanner :: ~/Developer/_orchestra/tools/pinned/studio-gate-e9ca610dac55c337.sh …/storage-studio-kh/app
step archive-tests :: bash tests/archive.sh '…/Storage Studio KH Helper'
step mount-check :: bash tests/mount-check.sh
step idle :: bash …/lead/0.1.31/gate-idle.sh
step desktop-safety :: check-desktop-safety.sh over the harness
step commit-identity :: check-commit-identity.sh
step scan-dmg :: …/kh-mirror-tools/scan-dmg.sh Storage Studio KH-0.1.31.dmg
scan-dmg: clean
GATE PASS storage eacaf25fbc47fbc0156f66e3a4124e18f8e1be5a 2026-11-25T17:15:22Z
```

Scanner: `DIALOGS`, `KEYCHAIN`, `REOPEN`, `TESTMODE`, `SELFUPDATE`, `COMPLETENESS`, `BUNDLEWRITE`,
`ENTITLEMENT`, `HOMEPATH`, `RETIREDHOST` all PASS; `SHIM PASS … current`; `ROWESCAPE` is the usual
AUDIT, not a pass. `-- app: 0 failing check(s)`.

Archive suite: **28 PASS, 0 FAIL** — every earlier guarantee (byte-for-byte copy, Stop, resume,
restore, the `-nobrowse` disk image, the in-place helper restart) re-proved against the changed helper.

Idle, one full cycle then ten minutes hidden with its own data dir:

```
start, after one cycle        pid=65579  fds=68  ports=1  threads=20  rss=104MB
idle footprint: pid 65579 = 85 MB after 600s, -19 MB while idle (ceiling 512 MB)
after 600s with nothing asked   pid=65579  fds=66  ports=1  threads=20  rss=85MB
Footprint: 28 MB (physical)
```

Flat to falling: 104→85 MB, fds 68→66, ports 1, threads 20.

### Named deviation — the runner's own `idle-footprint` step is unwired

Issue row `20261125-16`, unchanged: `step idle-footprint :: UNMEASURED — no IDLE_PID in the config`,
because no app pid exists before the build step. The measurement above is the gate's own `idle` step.

### Named deviation — `Address already in use` on 127.0.0.1:8646, third release running

`step-idle.log` opens `the update hold is not listening on 127.0.0.1:8646: Address already in use (os
error 48)`. As on 0.1.28 and 0.1.29, `lsof` during the run showed the measured app itself holding the
port — the app binds twice. Not this release's scope; recorded here rather than dropped.

### A first gate run of this version was INVALID, not failed

`gate-20261125-235529-28661` ended `GATE INVALID archive-tests`: `-nobrowse disk image was refused:
"There isn't room for 163 bytes. The destination has 66.2 MB free."` The cause was **test
environment, not code**: a 64 MiB `/Volumes/Project Disk` left mounted by an earlier killed `idle.sh`
made macOS attach this run's 256 MiB image as `/Volumes/Project Disk 1`, while `tests/archive.py`
targeted the stale 64 MiB mount. The leftover images were ejected and the run repeated clean, which is
the green line above. The invalid run's DMG was moved to
`~/Desktop/_trash/storage-studio-kh/2026-11-26 invalid 0.1.31 build (stale Project Disk mount)/`
with a MANIFEST before the re-run, so the shipped artifact is the one the green gate hashed.

## Publish (2026-11-25)

- `main` fast-forwarded `af75203..2f181bd` and pushed with the branch `storage-0.1.31-saved-login`.
- tag `0.1.31` (annotated, object `7cb91646…`) → `eacaf25fbc47fbc0156f66e3a4124e18f8e1be5a`, the gated
  commit; pushed and read back with `git ls-remote` (`refs/tags/0.1.31` and its `^{}` peel).
- preflight `36ebc8155c2e` (plugin 0.3.343) with `--scan-receipt` and `--gate-receipt` →
  `PREFLIGHT PASS`, artifact sha `REUSED` from the gate receipt.
- release `theng12/storage-studio-kh` tag `0.1.31`, created with `--verify-tag`, **non-draft first
  time** (no 500 this run), one asset `Storage.Studio.KH-0.1.31.dmg`, 5,604,910 B, GitHub reports
  `sha256:7a5c560b…`.
- **anonymous download**: **HTTP 200**, 5,604,910 bytes, sha256 `7a5c560b…` — identical to the gated
  file. The bundle inside the downloaded image reads `0.1.31` for both the app and its helper.
- **appcast signed over the downloaded bytes**: `sign_update` (`…/sparkle-shim-20261123/vendor/bin/
  sign_update`) with `~/.kh-sparkle/app.storagestudiokh.desktop/private.key`; `docs/verify-appcast.swift`
  → **SIGNATURE OK**, both on the local file and again over the **served** appcast text.
- install acceptance: `install-launch-check-847e77db5c99d5d6.sh` → **PASS** —
  `Storage Studio KH.app 0.1.31 launched hidden and is alive after 10s (pid 97131;
  app.storagestudiokh.desktop)`, from a temp scratch dir, never `/Applications`.

## Retention

`dist/` holds `Storage Studio KH-0.1.31.dmg` (5,604,910 B) and `Storage Studio KH-0.1.30.dmg`.
`Storage Studio KH-0.1.29.dmg` (5,603,564 B, sha256 `1568c4cb…`) is retired to
`~/Desktop/_trash/storage-studio-kh/2026-11-26 0.1.29 dmg retired at 0.1.31 publish/` with a MANIFEST.
The appcast now offers 0.1.31 + 0.1.30.

## Not proven

- **NAS credential recovery**: `not exercised — no NAS exists to test against`. The single most
  important line in this receipt: the feature ships unproven against real hardware.
- **Live Sparkle self-update click-through on an installed copy**: **UNMEASURED**.
- **Estate feed row**: **served** — see the feed readback above; verified here with `feed-verify.sh`
  against the fleet key, and the row's `url` is the 0.1.31 release asset.

## Evidence

- gate log: `lead/0.1.31/evidence/gate-20261126-000226-61509/` (summary.txt, step-build.log,
  step-scanner.log, step-archive-tests.log, step-mount-check.log, step-idle.log,
  step-desktop-safety.log, step-commit-identity.log); the INVALID run kept beside it as
  `gate-20261125-235529-28661`
- install acceptance: `install-launch-check-847e77db5c99d5d6.sh` output quoted above
