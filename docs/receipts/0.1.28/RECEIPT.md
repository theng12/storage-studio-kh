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
feed readback: appcast read back from GitHub Pages after the push — item `0.1.28` served, signature verified over the anonymously downloaded asset (`docs/verify-appcast.swift` → SIGNATURE OK against the app's own `SUPublicEDKey`). Estate row `storage-studio` in `kh-releases/release.json`: **served `0.1.28`, sha256 `e367a51b…`, `5,597,951` B at `published_at 2026-11-25T01:32:08.853Z`**, read back anonymously and verified with `feed-verify.sh storage-studio --expect-version 0.1.28 --expect-sha e367a51b… --public-key <fleet feed key>` → `PASS signature — Ed25519 verified … PASS`. (An earlier draft of this line said UNMEASURED because it looked for a row named `storage`; the row is keyed `storage-studio`.)
page state: release page live at `theng12/storage-studio-kh` tag `0.1.28`, non-draft, one asset
dirty: false
retired: 0.1.26 DMG moved to `~/Desktop/_trash/storage-studio-kh/2026-11-25 0.1.26 dmg retired at 0.1.28 publish/` with a MANIFEST; `dist/` now holds 0.1.28 + 0.1.27
not proven: live Sparkle self-update click-through on an installed copy; the archive helper's residue after a large archive (mem-finding, next release); `-nobrowse` disk-image free-space fallback (row `20261125-23`, next release)

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

### Named deviation — the runner's own `idle-footprint` step is unwired

This is a **deviation, not a pass**, and it is written here rather than smoothed over. The gate
summary prints both lines:

```
step idle-footprint :: UNMEASURED (set IDLE_PID in the gate config to measure it)
step idle-footprint :: UNMEASURED — no IDLE_PID in the config
```

The runner step is unwired in `_orchestra/tools/gate-configs/storage-0.1.28.sh`: it wants an
`IDLE_PID`, and no live app pid exists before the build step has run, so the config leaves it unset.
The measurement that stands behind this release is the gate's own `idle` step
(`lead/0.1.28/gate-idle.sh`), which quotes `start, after one cycle pid=80901 fds=68 ports=1 threads=21
rss=103MB`, then `idle footprint: pid 80901 = 82 MB after 600s, -21 MB while idle (ceiling 512 MB)`,
`OK`, and `after 600s with nothing asked fds=67 ports=1 threads=20 rss=82MB`, with `vmmap` reporting
`Footprint: 27 MB (16384 bytes per page)`. The two-disk configured 600 s run in
`lead/0.1.28/measure.sh` measured the same shape (93→69 MB, fds 68→63). Both are this build's own
runs; neither is the runner step's line.

**Also recorded, because it is in the same log:** `step-idle.log` opens with a failed bind —

```
update hold listening on http://127.0.0.1:8646/api/maintenance/hold
the update hold is not listening on 127.0.0.1:8646: Address already in use (os error 48)
```

A port from an earlier run of the same binary was still held when this run started, so the **update
hold route was not listening during that measurement**. What that does and does not mean: the idle
numbers above are still valid — the hold route is only exercised when an update arrives, and none did
during the run, so nothing in the measurement depended on it. What is **UNMEASURED** is the hold
route's own behaviour in this exact run; it is covered by `tests/archive.sh` and the app's own
`POST /api/maintenance/hold` contract test, not by this log line. The rule this cites: a process that
cannot bind must say so, and it did.

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

**`archives-light.png` was re-captured after the gate, in `ece9b17`.** The first release image
rendered the archive date as `Archived 22 Jan` (seconds written into a millisecond field) and printed
a `/var/folders/…` destination path. The re-capture queued for it came back showing an
`Archive paused — Night Atlas` banner and `Not archived yet` instead, because
`ArchiveRunner.freeSpace(at:)` (`ArchiveRunner.swift:936`) takes
`volumeAvailableCapacityForImportantUsage` as authoritative and macOS returns **0** for that key on
`-nobrowse` disk images while `volumeAvailableCapacity` and `systemFreeSize` both report the real
figure. The demo archive was therefore refused with `"There isn't room for 96 bytes. The destination
has Zero KB free."` and the capture photographed the failure.

The fixture, not the app, was fixed for this release (`lead/0.1.28/demo-archive.py` now stops on
`paused` and prints the job's own reason; `lead/0.1.28/snapshots.sh` now fails closed unless a
verified manifest exists and stages the helper's real archive before photographing). The shipped PNG
shows `Archived 25 Nov · 96 B · 3 files` and
`Archived to /Volumes/Project Disk/Channel Archives/night-atlas/20261124T203153Z-68d1`.

The helper's own free-space reading is **not fixed in 0.1.28** — that would change app source after
the gate, and the gated bytes are what shipped. Real attached volumes (`/Volumes/KH-STUDIO-ATLAS`,
`/Volumes/KH-STUDIO-NOVA`) return correct non-zero values, so a normal destination is unaffected; a
`-nobrowse` disk image is. Recorded as issue row `20261125-23` (distinct from `20261119-06`, which is
the gate's own low-disk governor) and queued as the first item for 0.1.29:
treat an important-usage capacity of `<= 0` as absent and fall back to `systemFreeSize`.

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

## Published (2026-11-25)

Owner's own words cleared the public surface. Re-measured here rather than taken on report:

- `main` fast-forwarded from `1626de6` to the release branch and pushed with the branch
  (`1626de6..ece9b17`, both refs). No rewriting, no force.
- tag `0.1.28` (annotated, object `68a7273f…`) → `c58923d6be8418802e93e372fdd08ed73556f046`, the
  gated commit; pushed and verified on the remote with `git ls-remote`.
- release `theng12/storage-studio-kh` tag `0.1.28`: non-draft, not prerelease, `--verify-tag`. One
  asset `Storage.Studio.KH-0.1.28.dmg`, 5,597,951 B, GitHub reports
  `digest: sha256:e367a51b2f01ae88cc75ce3d4a4818b54c3ba4765ae7e6b8be5298493add6411`.
- **anonymous download** of that asset with no token: **HTTP 200**, 5,597,951 bytes, sha256
  `e367a51b2f01ae88cc75ce3d4a4818b54c3ba4765ae7e6b8be5298493add6411` — identical to the gated file.
- **appcast signed over the downloaded bytes**, not the local build:
  `sign_update` (`vendor/bin/sign_update`, sha256 `43c249771baf…`) with
  `~/.kh-sparkle/app.storagestudiokh.desktop/private.key` produced
  `sparkle:edSignature="aur1oJt0NkWxQDkP1ZignCVk8dHzH8r4oBdqbWwl6yDeLlC+AmQCYUAJFBj5Gaf5QIg/rUcJu+hRsmUmo6hlAw=="`.
  `docs/verify-appcast.swift` → **SIGNATURE OK** (rc 0); `_orchestra/tools/appcast-verify.sh` over the
  same download → **PASS** (rc 0).
- **served readback**: `https://theng12.github.io/storage-studio-kh/appcast.xml` carries
  `sparkle:version 0.1.28`, `pubDate Wed, 25 Nov 2026 01:30:04 +0000`, the enclosure above, and the
  same signature; the signature was re-verified from the **served** text over the anonymous download →
  **PASS**. The feed serves two items (0.1.28 + 0.1.27), as retention requires.
- `_orchestra/tools/appcast-serves-version.sh storage-studio-kh 0.1.28 --bundle <built app>` exited
  **2 (could not measure)** because the estate feed `kh-releases/release.json` answered 200 with no
  `storage` row; that is the publisher's pass, not this release, and it is recorded as UNMEASURED, not
  as a pass.
- preflight: `36ebc8155c2e` (plugin 0.3.333/0.3.336) with `--scan-receipt` and `--gate-receipt` on the
  gate summary → `PREFLIGHT PASS` (rc 0), artifact sha `REUSED` from the gate receipt.

## Retention

`dist/` now holds exactly the pair: `Storage Studio KH-0.1.28.dmg` (5,597,951 B) and
`Storage Studio KH-0.1.27.dmg` (5,575,640 B). `Storage Studio KH-0.1.26.dmg` (4,672,493 B, sha256
`2cebeb77dd42…`) moved to
`~/Desktop/_trash/storage-studio-kh/2026-11-25 0.1.26 dmg retired at 0.1.28 publish/` with a
`MANIFEST.md`. Checked before the move: not open (`lsof`), nothing in `dist/` or `scripts/` reads it,
and its appcast item was dropped in the same publish. Moved, never deleted — the disk gains ~4.5 MB
only when the owner empties the trash. `dist/.release-dist.json` updated in the same change.

## Not proven

- **Live Sparkle self-update click-through on an installed copy**: **UNMEASURED**. The item is served
  and its signature verifies, but no installed 0.1.27 has been walked through the update in this run.
- **Estate feed row**: `kh-releases/release.json` answers 200 with no `storage` row — the publisher's
  pass writes it. UNMEASURED, not a pass.
- **The hold route's own behaviour during the idle measurement**: the run logged
  `Address already in use` on `127.0.0.1:8646` (see the named deviation above), so the route was not
  listening then. Its contract is covered by `tests/archive.sh`, not by that log.
- **The helper's residue after a large archive** (`lead/0.1.28/MEMORY-FINDING.md`): a retention fault,
  not claimed fixed; the bounded-lifetime remedy is 0.1.29's first item.
- **`app-meta.json` at the tag**: the tag is the gated commit `c58923d`, and the `localFile` bump to
  `Storage Studio KH-0.1.28.dmg` landed in `f7de129`, one commit later (metadata only — the source diff
  `c58923d..ece9b17 -- src src-tauri ui-shell ui helper` is empty). So `git show 0.1.28:app-meta.json`
  still names the 0.1.27 file. The feed, appcast and release page all name 0.1.28; this one file at
  this one tag does not. Named, not hidden.
