# Release receipt — storage 0.1.30

The current shared Sparkle shim, and a build that puts Homebrew first and names the toolchain it
found. Written from commands this build ran; anything not run says UNMEASURED.

app: storage
version: 0.1.30
commit: 8a2b2d6d5c7494172a3b4366db4ca70c525baf5f
artifact: $HOME/Developer/_orchestra/developer-utilities/storage-studio-kh/app/dist/Storage Studio KH-0.1.30.dmg
sha256: 44cfdf924fba9306bd3da47994ae9e6f609e116e0517b1ef1e6fe288b2dbcc9a
bytes: 5604199
scan: sha256=44cfdf924fba9306bd3da47994ae9e6f609e116e0517b1ef1e6fe288b2dbcc9a clean — scan-dmg/2026-11-20, exit 0, 96 files, `scan-dmg: clean`
gate config: $HOME/Developer/_orchestra/tools/gate-configs/storage-0.1.30.sh
gate exit: 0 — `GATE PASS storage 59a1149d0bd3c6b43da4a9a74a85b453a423bb75 2026-11-25T16:07:33Z`
gate runner: `gate-run.sh 528de9fe53d0` — SHA-256 `528de9fe53d0c0de552d30dca1b21092b073a24fac76daf53e21da738b3b6f46`, 48,065 B, as the gate's own summary records it; pinned at `$HOME/Developer/_orchestra/tools/pinned/gate-run-528de9fe53d0c0de.sh`, byte-identical (`cmp` clean), not standalone-runnable
feed readback: appcast read back from GitHub Pages after the push — `https://theng12.github.io/storage-studio-kh/appcast.xml` serves items `0.1.30` (length 5,604,199, the enclosure above) and `0.1.29`; the served text's signature was re-verified over the anonymously downloaded 0.1.30 DMG with `docs/verify-appcast.swift` → **SIGNATURE OK** (rc 0). Pages build `46c322f` — `built`. Estate row `storage-studio`: **served `0.1.30`** — `published_at 2026-11-25T16:13:39.741Z`, sha `44cfdf92…`, 5,604,199 B, envelope sha256 `62d477c7…`, Pages commit `9970b699`, `PASS signature` against the fleet key (S001's pass)
page state: release page live at `theng12/storage-studio-kh` tag `0.1.30`, non-draft, one asset
dirty: false
retired: UNMEASURED
not proven: live Sparkle self-update click-through on an installed copy (no installed 0.1.29 was walked through an update in this run)

## What shipped

- **The shim is the pinned current one.** `src-tauri/vendor/khsparkle/libkhsparkle.a` is now
  `2bce760e7749a0f21dfa378c53c391d039401355012e774a81b691043a3cb17f`, 86,632 bytes — the first entry
  in `_orchestra/tools/pinned/REQUIRED-SHIM.txt`. 0.1.27, 0.1.28 and 0.1.29 shipped the
  accepted-previous `818826a7…`. `VENDOR.md` says which entry this is.
- **A non-login shell now gets the same tools a login shell does** (row `20261122-318`).
  `scripts/toolchain.sh` is sourced by every script the packaging path runs — `scripts/build-mac.sh`
  and `tests/archive.sh`, `tests/share-list.sh`, `tests/feed-check.sh`, `tests/hold.sh`. It puts
  `/opt/homebrew/bin` and `/usr/local/bin` first, Homebrew's newest `python@3` ahead of the system
  stub, and the owner's `~/.local/bin` on the end (that is where `node` and `npm` live on this Mac).
  Measured in a bare shell (`env -i HOME=$HOME PATH=/usr/bin:/bin`): before, `python3` was
  `Python 3.9.6` and `pkg-config` was absent; after, `python3` is
  `/opt/homebrew/opt/python@3.13/libexec/bin/python3` (`Python 3.13.18`), `pkg-config` is
  `/opt/homebrew/bin/pkg-config`, and `node` and `npm` resolve. `build-mac.sh` now also prints the
  `python3` (with its path), `node` and `cargo` versions and the `PATH` it searched, so a broken
  build names the tool instead of ending in a traceback.

## Gate

Four steps plus the runner's own two, all green, evidence `lead/0.1.30/evidence/gate-20261125-225444-74749`:

```
runner: gate-run.sh 528de9fe53d0 at ~/Developer/_orchestra/tools/gate-run.sh
step build :: bash scripts/build-mac.sh
step scanner :: ~/Developer/_orchestra/tools/pinned/studio-gate-e9ca610dac55c337.sh …/storage-studio-kh/app
step archive-tests :: bash tests/archive.sh '…/Storage Studio KH Helper'
step idle :: bash …/lead/0.1.30/gate-idle.sh
step desktop-safety :: check-desktop-safety.sh over the harness
step commit-identity :: check-commit-identity.sh
step scan-dmg :: …/kh-mirror-tools/scan-dmg.sh Storage Studio KH-0.1.30.dmg
scan-dmg: clean
GATE PASS storage 59a1149d0bd3c6b43da4a9a74a85b453a423bb75 2026-11-25T16:07:33Z
```

The scanner's own line, which is this release's point:

```
SHIM           PASS  libkhsparkle.a matches the required sha — current (…/src-tauri/vendor/khsparkle/libkhsparkle.a;
                     …/storage-studio-kh/app @ storage-0.1.30-shim-and-path 59a1149d)
```

Archive suite inside the gate: **28 PASS, 0 FAIL** — the same 0.1.29 checks (byte-for-byte copy,
Stop, resume, restore, `-nobrowse` disk image, in-place helper restart) re-proved against a helper now
linked with the current shim.

The build step's new line, so a tool problem is readable:

```
Toolchain: python3 3.13.18 at /opt/homebrew/opt/python@3.13/libexec/bin/python3; node v26.13.1; cargo 1.100.0
```

Idle, one full cycle then ten minutes hidden with its own data dir:

```
start, after one cycle        pid=81245  fds=68  ports=1  threads=20  rss=89MB
idle footprint: pid 81245 = 50 MB after 600s, -39 MB while idle (ceiling 512 MB)
after 600s with nothing asked   pid=81245  fds=66  ports=1  threads=20  rss=50MB
Footprint: 29 MB (physical)
```

Flat to falling on every measure (89→50 MB, fds 68→66, ports 1, threads 20).

### Named deviation — the runner's own `idle-footprint` step is unwired

Issue row `20261125-16`, unchanged: the summary prints `step idle-footprint :: UNMEASURED — no
IDLE_PID in the config` because no app pid exists before the build step. The measurement above is the
gate's own `idle` step, which is this build's own run.

### Named deviation — a manual `zsh studio-gate` run reports SHIM FAIL (row `20261125-57`)

Before the gate, running the scanner by hand as `zsh studio-gate-…sh` printed
`SHIM FAIL … which is not in the requirement list` for the correct sha; under `bash` (the file's own
shebang, which is how `gate-run.sh` invokes it) the same tree prints `SHIM PASS … current`. That is
the zsh word-split row `20261125-57`, not a shim fault — the gate's line above is the verdict.

## Publish (2026-11-25)

- `main` fast-forwarded `885110c..803ecbf` and pushed with the branch `storage-0.1.30-shim-and-path`.
- tag `0.1.30` (annotated, object `519c500a…`) → `59a1149d0bd3c6b43da4a9a74a85b453a423bb75`, the gated
  commit; pushed, read back with `git ls-remote`.
- preflight `36ebc8155c2e` (plugin 0.3.342) with `--scan-receipt` and `--gate-receipt` → `PREFLIGHT PASS`,
  artifact sha `REUSED` from the gate receipt.
- release `theng12/storage-studio-kh` tag `0.1.30`, one asset `Storage.Studio.KH-0.1.30.dmg`, 5,604,199 B,
  GitHub digest `sha256:44cfdf92…`. **The first `gh release create` returned HTTP 500 after the asset had
  already uploaded**, leaving a draft holding the correct bytes; it was published with
  `PATCH draft=false` rather than re-uploaded (row-shaped: a 500 after upload does not mean nothing
  landed). Read back now: `draft=false prerelease=false tag=0.1.30`.
- **anonymous download**: **HTTP 200**, 5,604,199 bytes, sha256 `44cfdf92…` — identical to the gated file.
- **appcast signed over the downloaded bytes**: `sign_update` with
  `~/.kh-sparkle/app.storagestudiokh.desktop/private.key`; `docs/verify-appcast.swift` → **SIGNATURE OK**.
- install acceptance: `install-launch-check-847e77db5c99d5d6.sh` → **PASS** —
  `Storage Studio KH.app 0.1.30 launched hidden and is alive after 10s (pid 14597)`, from a temp scratch
  dir, never `/Applications`.

## Retention

`dist/` holds exactly `Storage Studio KH-0.1.30.dmg` (5,604,199 B) and `Storage Studio KH-0.1.29.dmg`.
`Storage Studio KH-0.1.28.dmg` (5,597,951 B, sha256 `e367a51b…`) moved to
`~/Desktop/_trash/storage-studio-kh/2026-11-25 0.1.28 dmg retired at 0.1.30 publish/` with a MANIFEST.
Checked before the move: not open (`lsof`). The appcast now serves 0.1.30 + 0.1.29.

## Not proven

- **Live Sparkle self-update click-through on an installed copy**: **UNMEASURED**.
- **Estate feed row**: **served** — developer-system (S001) published it at
  `published_at 2026-11-25T16:13:39.741Z`, row `0.1.30` / `44cfdf92…` / 5,604,199 B, envelope sha256
  `62d477c7d82a66d970b8e66dc44f039e50fe9978d77d281ce7584a17d0a3329d`, Pages commit `kh-releases 9970b699`,
  `PASS signature — Ed25519 against <fleet key>`. Four other apps' rows moved in the same pass; only
  `storage-studio` is this line's.
- **Pages build failures**: two consecutive Pages builds of receipts-only commits reported
  `Page build failed` (`70ed378`, `620e6ea`), and a later push built (`46c322f`). The appcast is served
  correctly now; the intermittent failure is named here rather than hidden.

## Evidence

- gate log: `lead/0.1.30/evidence/gate-20261125-225444-74749/` (summary.txt, step-build.log, step-scanner.log, step-archive-tests.log, step-idle.log)
- readback command and output: UNMEASURED
- install acceptance: UNMEASURED
