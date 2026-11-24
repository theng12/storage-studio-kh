# Release receipt — storage 0.1.28

Archive slice 2 (Stop, Free up space, Archive again), the honest startup line, release screenshots
and a measured idle footprint. Written from commands this build ran; anything not run says UNMEASURED.

app: storage
version: 0.1.28
commit: c58923d6be8418802e93e372fdd08ed73556f046
artifact: $HOME/Developer/_orchestra/developer-utilities/storage-studio-kh/app/dist/Storage Studio KH-0.1.28.dmg
sha256: e367a51b2f01ae88cc75ce3d4a4818b54c3ba4765ae7e6b8be5298493add6411
bytes: 5597951
scan: sha256=e367a51b2f01ae88cc75ce3d4a4818b54c3ba4765ae7e6b8be5298493add6411 clean — scan-dmg/2026-11-20, exit 0, 96 files, `scan-dmg: clean`
gate config: $HOME/Developer/_orchestra/tools/gate-configs/storage-0.1.28.sh
gate exit: 0 — `GATE PASS storage c58923d6be8418802e93e372fdd08ed73556f046 2026-11-24T13:39:42Z`
feed readback: UNMEASURED — publication barred to peer sessions; release not created yet
page state: UNMEASURED — publication barred to peer sessions; release not created yet
dirty: false
retired: UNMEASURED — 0.1.26 stays in dist/ until 0.1.28 is published
not proven: public GitHub release, appcast live verification over downloaded asset, Pages feed readback (all blocked on owner authorization; see Not proven below); queued lane measurements (screenshots, install-launch check, two-disk 10-min idle, archive suite) still waiting in app-test-lock.sh

## What shipped

- **Stop** on a running archive ends at the next checked file, says where the part copy is kept, and
  **Archive again** carries on from that file instead of starting over.
- **Free up space** moves the archived channel folder to the Trash — only when the archive's own
  manifest says `verified`. Nothing is deleted by the app; emptying the Trash stays the owner's.
- **Archive again** from an archive's manifest, for a channel whose row is gone.
- The startup log says the hold token was **copied** and that the updater's shared file is left in
  place, instead of claiming it moved.

## Identity

| field | value |
|---|---|
| version | 0.1.28 |
| branch | `storage-0.1.28-archive-slice2` |
| gated commit | `c58923d6be8418802e93e372fdd08ed73556f046` |
| scanner | `$HOME/Developer/_orchestra/tools/pinned/studio-gate-e9ca610dac55c337.sh`, sha256 `e9ca610dac55c337f8a9fe2e6262b35612815006841bf25fb2a68f81d9034cac`, resolved by sha, with its `RECORD.md` (`17ff93c69376d391` exists with the shell-split fix and is adopted at the next gate; this gate ran `e9ca610d` under bash) |
| gate | **PASS**, evidence `lead/0.1.28/evidence/gate-20261124-202731-78686`; steps build ok, scanner ok, idle ok, desktop-safety ok, commit-identity ok, scan-dmg clean |

Two gate faults on the way, both mine, both named rather than hidden: the config pinned an older
scanner (`76dbf7aa…`) that read only the first `REQUIRED-SHIM` entry (row `20261124-59`), and the
`idle` step first died on `lsof`'s exit status under `set -e`. Neither changed the app.

The gate summary prints `step idle-footprint :: UNMEASURED — no IDLE_PID in the config` beside
`ok idle`. That runner step was deliberately left unused because no live app pid exists before the
build runs; our own `idle` step (`lead/0.1.28/gate-idle.sh` in the gate: `fds 68→67`, `ports 1→1`,
`threads 21→20`, `rss 103→82 MB`, `-21 MB while idle`, `Footprint: 27 MB` after 600 s; followed by
the two-disk configured 600 s run in `lead/0.1.28/measure.sh`) **is** the measurement.

## Sparkle shim — which entry, said plainly

`src-tauri/vendor/khsparkle/libkhsparkle.a`, 85,480 B, sha256
`818826a79d4e54885cbb5ad167f7425da8ba77436c6a5e277532f400aa1b4216` — the pin's **accepted-previous**
entry (`matched: accepted-previous 2026-11-24`). The pin's current rebuild is not in this release;
nothing was re-vendored to satisfy a check. The scanner's own line, from this gate's evidence:

```
SHIM  PASS  libkhsparkle.a matches the previous accepted sha — accepted-previous; take the current
            one at the next release (…/vendor/khsparkle/libkhsparkle.a; … @ storage-0.1.28-archive-slice2 c58923d6)
```

## Screenshots (RELEASE-POLICY §5d)

Four PNGs in `docs/screenshots/`, taken by the gated build itself (off-screen, no pointer, demo
content on throwaway disk images and a real archive the helper wrote):
`storage-light.png`, `storage-dark.png`, `archives-light.png`, `general-light.png`. Checker line,
quoted:

```
tool: check-app-screenshots.sh 7a035b7b380c at $HOME/Developer/_orchestra/tools/check-app-screenshots.sh
PASS: 4 screenshots, each within size, named, referenced, and clean in text and metadata
rc=0
```

The first capture attempt said `no WKWebView in the window` for every shot: the walk compared
`class() == WKWebView::class()` and Tauri's webview is a runtime-created subclass, fixed with
`isKindOfClass` in `c58923d` — which is why the gate ran twice on this version.

## Install + launch (pinned 847e77db)

`install-launch-check-847e77db5c99d5d6.sh` over the DMG: **PASS** — `Storage Studio KH.app 0.1.28
launched hidden and is alive after 10s (pid 25314; app.storagestudiokh.desktop)`, the copy running
from a temp scratch dir, never `/Applications`. Log: `lead/0.1.28/install-launch.log`.

## Archive checks — `tests/archive.sh` against the real helper binary

**23 PASS, 0 FAIL, rc=0** (`lead/0.1.28/archive-tests.log`), including the four new 0.1.28
behaviours end to end:

- `Stop ends the archive at a file boundary and names the part copy` / `the part copy is kept` /
  `Stop ended exactly at a file boundary` / `Archive again after Stop finishes the same copy`
- `archive again reads the manifest and writes a new, verified archive`
- `Free up space moves the archived channel to the Trash, and the archive stays`
- plus the standing guarantees: byte-for-byte verification with `manifest says verified`, kill and
  resume from the journal, restore to a new Mac without merging, a second restore taking a dated
  name, and a folder with no manifest refused with its reason.

## Idle footprint — one full cycle, then ten minutes

`lead/0.1.28/idle-final/` (configured with two mounted demo disks, hidden, own data dir):

```
start, after one cycle        pid=25489  fds=68  ports=1  threads=20  rss=93MB
idle footprint: pid 25489 = 69 MB after 600s, -24 MB while idle (ceiling 512 MB)
OK
after 600s with nothing asked   pid=25489  fds=63  ports=1  threads=20  rss=69MB
Footprint: 25 MB (physical)
```

Flat to falling on every measure — fds 68→63, ports 1→1, threads 20→20, rss 93→69 MB, physical
footprint 25 MB. Growth would have failed; nothing grew. The gate's own `idle` step measured the
same shape earlier (103→82 MB over 600 s).

## The window ends every archive state

The scanner's `ROWESCAPE` is an AUDIT, not a pass; walked here from the window:

| state | control that ends it |
|---|---|
| copying, verifying | **Stop** — ends at the next checked file, keeps the part copy |
| cancelled | **Archive again** — carries on from the last checked file |
| paused, failed | **Archive again** / **Resume**, with the reason in plain words on the row |
| verified, archived | **Free up space** (to the Trash), **Archive again**, **Restore** |
| restoring | **Stop**, same rule as copying |
| restored, freed | terminal; the row says where the folder is |

## Archive memory, measured and not fixed here

`lead/0.1.28/MEMORY-FINDING.md` has the whole table. Short form: the helper's residue after a large
archive tracks the size of one file (500 MB → 1,017 MB peak; 1 GiB → 2,070 MB; 3 GiB in 3,072 files →
589 MB), does not return to baseline, and `vmmap` attributes it to freed malloc regions the process
never hands back. A per-file `autoreleasepool` and `malloc_zone_pressure_relief` were both measured
and neither moved the number, so both were reverted. The bounded-lifetime remedy (recycle the helper
between jobs) is the next release's first item. This is a retention fault, not a data-loss bug, and
it is not claimed as fixed.

## Retention

PENDING

## Not proven

- **The GitHub release is not created, and that is a bar, not a forgotten step.** Publication to a
  public repository (pushing `main`/tag and running `gh release create`) is refused to a session
  acting on a peer's request — especially when the peer session itself reports being refused for the
  public surface; only the owner's direct words clear it.
- **Staged and waiting for the owner's direct go-ahead (and completion of the queued lane
  measurement run):**
  - Gated commit on `storage-0.1.28-archive-slice2`: `c58923d6be8418802e93e372fdd08ed73556f046`
  - Artifact: `dist/Storage Studio KH-0.1.28.dmg`, **5,597,951 B**, sha256
    `e367a51b2f01ae88cc75ce3d4a4818b54c3ba4765ae7e6b8be5298493add6411` (`scan-dmg: clean`)
  - Release notes paragraph: `lead/0.1.28/CARD-TEXT.md`
  - Pre-signed appcast item: `lead/0.1.28/appcast-item.xml` (`ASSET_URL` and `PUBDATE` blank until
    the published asset URL is read back; locally verified `SIGNATURE OK` by `docs/verify-appcast.swift`
    and `PASS` by `_orchestra/tools/appcast-verify.sh` over these exact 5,597,951 B). Will be
    re-verified over the anonymously downloaded published asset before committing to `appcast.xml`.
  - Retention: `0.1.26.dmg` stays in `dist/` until `0.1.28` is actually published, then moves to
    `~/Desktop/_trash/storage-studio-kh/<date> 0.1.26 dmg retired at 0.1.28 publish/` with a manifest.
- **Queued lane measurements (`lead/0.1.28/measure.sh`, waiting in `app-test-lock.sh`):** release
  screenshots (`snapshots.sh` + `check-app-screenshots.sh`), pinned
  `install-launch-check-847e77db5c99d5d6.sh`, configured two-disk 10-minute idle run, and
  `tests/archive.sh` against the built helper.
- **Live Sparkle self-update click-through** on an installed copy: **UNMEASURED**.
- **Pages feed row and envelope signature**: **UNMEASURED** (System writes the row after release).
