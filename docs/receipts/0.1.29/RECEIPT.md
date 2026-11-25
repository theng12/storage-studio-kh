# Release receipt — storage 0.1.29

Two fixes: an archive onto a mounted disk image is no longer refused with "Zero KB free", and the
archive helper starts itself again in place so a large file's memory goes back to the system.
Written from commands this build ran; anything not run says UNMEASURED.

app: storage
version: 0.1.29
commit: b4b1e08600181c3f0765dca69964f305a1944d49
artifact: $HOME/Developer/_orchestra/developer-utilities/storage-studio-kh/app/dist/Storage Studio KH-0.1.29.dmg
sha256: 1568c4cb95db8a01a9f5f6019152c05e91aa366e7dd4c763962ba64a8853fc08
bytes: 5603564
scan: sha256=1568c4cb95db8a01a9f5f6019152c05e91aa366e7dd4c763962ba64a8853fc08 clean — scan-dmg/2026-11-20, exit 0, 96 files, `scan-dmg: clean`
gate config: $HOME/Developer/_orchestra/tools/gate-configs/storage-0.1.29.sh
gate exit: 0 — `GATE PASS storage b4b1e08600181c3f0765dca69964f305a1944d49 2026-11-25T02:30:55Z`
feed readback: appcast read back from GitHub Pages after the push — item `0.1.29` served with `length="5603564"` and the signature made over the anonymously downloaded asset; `docs/verify-appcast.swift` re-run over the **served** text → `SIGNATURE OK` (rc 0). Estate row `storage-studio` in `kh-releases/release.json`: **served `0.1.29`, sha256 `1568c4cb…`, `5,603,564` B, `published 2026-11-25T03:05:18.835Z`, tagline present**, read back anonymously and verified here with `feed-verify.sh storage-studio --expect-version 0.1.29 --expect-sha 1568c4cb… --public-key <fleet feed key from the Launcher's PinnedKey>` → `PASS signature — Ed25519 verified against key <fingerprint>` (the value `PinnedKey.fingerprint` prints for that key) and `PASS`
page state: release page live at `theng12/storage-studio-kh` tag `0.1.29`, non-draft, one asset
dirty: false
retired: `Storage Studio KH-0.1.27.dmg` (5,575,640 B) moved to `~/Desktop/_trash/storage-studio-kh/2026-11-25 0.1.27 retired at 0.1.29 publish/` with a MANIFEST; `dist/` now holds 0.1.29 + 0.1.28
not proven: live Sparkle self-update click-through on an installed copy (no installed 0.1.28 was walked through an update in this run)

## What shipped

- **Archiving onto a disk image works.** `ArchiveRunner.freeSpace(at:)` took
  `volumeAvailableCapacityForImportantUsage` as authoritative, and macOS reports **0** for that key on
  `-nobrowse` disk images while the other two report the real figure. Measured on a blank 256 MB APFS
  image attached with `nobrowse`:
  `importantUsage=Optional(0) availableCapacity=Optional(254439424) systemFreeSize=Optional(254439424)`.
  A non-positive answer at a step now means "unknown" and the next step answers; only `systemFreeSize`
  itself is believed when it says 0. Issue row `20261125-23`.
- **A bounded lifetime for the archive helper.** After one very large archive (256 MB, or 20 of them)
  the helper re-executes itself in place between jobs — same pid, same pipes, fresh heap — with one
  log line naming why. Its setup is carried across in `recycle-state.json` in the app support folder,
  re-applied at startup and removed on read. Never mid-job, never while paused for an update, never
  while anything is in flight or queued.
  One consequence, said plainly: the restarted process comes up the way a fresh helper does, so a
  storage set to reconnect at login is tried once more if it is not mounted — the same behaviour as
  the app's own launch, and it only happens after an archive has finished.

## The memory measurement (`lead/0.1.29/MEMORY-0.1.29.md`)

Three 500 MB archives through one real helper, RSS sampled every 50 ms and two seconds after each job:

| | job 1 | job 2 | job 3 |
|---|---|---|---|
| retained at job end, **without** the recycle | 1,017.2 MB | 1,726.3 MB | 1,817.8 MB |
| retained at job end, **with** it (product default) | 9.6 MB | 9.6 MB | 9.6 MB |
| peak while copying, with it | 941.8 MB | 984.6 MB | 1,001.6 MB |

Idle before any job: 8.9 MB. Without the recycle the residue grows job to job; with it every job ends
back at idle and the peak stays at one file's worth.

## Gate

Four steps, all green, evidence `lead/0.1.29/evidence/gate-20261125-091840-9706`:

```
step build :: bash scripts/build-mac.sh
step scanner :: …/pinned/studio-gate-e9ca610dac55c337.sh …/storage-studio-kh/app
step archive-tests :: bash tests/archive.sh '…/Storage Studio KH.app/Contents/Helpers/…'
step idle :: bash …/lead/0.1.29/gate-idle.sh
GATE PASS storage b4b1e08600181c3f0765dca69964f305a1944d49 2026-11-25T02:30:55Z
```

The archive suite inside the gate: **28 PASS, 0 FAIL, rc=0**, including the two new checks —
`an archive onto a -nobrowse disk image is accepted (important usage reads 0 there)` and
`the helper starts itself again in place after a large archive` / `it is the same process afterwards
(pid 92380, no new pid)` / `the archive after the in-place restart finishes without the app re-sending
its setup`.

Scanner: `DIALOGS`, `KEYCHAIN`, `REOPEN`, `TESTMODE`, `SELFUPDATE`, `COMPLETENESS`, `BUNDLEWRITE`,
`ENTITLEMENT`, `HOMEPATH`, `RETIREDHOST` all PASS; `SHIM PASS libkhsparkle.a matches the previous
accepted sha — accepted-previous` (the same pin as 0.1.28; the current rebuild is still to be taken).

### Named deviation — the runner's own `idle-footprint` step is unwired

Same form as 0.1.28 (issue row `20261125-16`), and written here rather than smoothed over. The summary prints
`step idle-footprint :: UNMEASURED — no IDLE_PID in the config`: the step wants a live pid and no app
is running before the build step. The measurement that stands behind this release is the gate's own
`idle` step:

```
start, after one cycle        pid=11428  fds=68  ports=1  threads=20  rss=104MB
idle footprint: pid 11428 = 104 MB after 600s, +0 MB while idle (ceiling 512 MB)
OK
after 600s with nothing asked   pid=11428  fds=67  ports=1  threads=20  rss=104MB
Storage Studio KH [11428]: 64-bit    Footprint: 28 MB (16384 bytes per page)
```

Flat: fds 68→67, ports 1, threads 20, rss 104 MB unchanged, physical footprint 28 MB.

**Also in that log, unchanged from 0.1.28:** `the update hold is not listening on 127.0.0.1:8646:
Address already in use (os error 48)`. `lsof` during the run showed pid 11428 — the measured app
itself — listening on 8646, so the second bind is the app's own; the route was therefore up for that
run, but this is the second release to log the line and it belongs in the next one's scope.

## Publish (2026-11-25)

- `main` fast-forwarded `bfbaaf2..51e18a1` and pushed with the branch `storage-0.1.29-helper-bounds`.
  No rewrite, no force.
- tag `0.1.29` (annotated, object `173808fe…`) → `b4b1e08600181c3f0765dca69964f305a1944d49`, the gated
  commit; pushed and read back with `git ls-remote` (`refs/tags/0.1.29`).
- preflight `36ebc8155c2e` (plugin 0.3.338) with `--scan-receipt` and `--gate-receipt` on the gate
  summary → `PREFLIGHT PASS`, artifact sha `REUSED` from the gate receipt.
- release `theng12/storage-studio-kh` tag `0.1.29`: non-draft, not prerelease, `--verify-tag`. One asset
  `Storage.Studio.KH-0.1.29.dmg`, 5,603,564 B, GitHub reports
  `digest: sha256:1568c4cb95db8a01a9f5f6019152c05e91aa366e7dd4c763962ba64a8853fc08`.
- **anonymous download** with no token: **HTTP 200**, 5,603,564 bytes, sha256
  `1568c4cb95db8a01a9f5f6019152c05e91aa366e7dd4c763962ba64a8853fc08` — identical to the gated file.
- **appcast signed over the downloaded bytes**: `sign_update`
  (`…/sparkle-shim-20261123/vendor/bin/sign_update`, sha256 `43c249771baf…`) with
  `~/.kh-sparkle/app.storagestudiokh.desktop/private.key` produced the enclosure's
  `edSignature` and `length="5603564"`. `docs/verify-appcast.swift` → **SIGNATURE OK** (rc 0) both
  before and after the push, the second time over the **served** appcast text.
- served readback: `https://theng12.github.io/storage-studio-kh/appcast.xml` carries
  `sparkle:version 0.1.29`, the enclosure above and the same signature; the feed serves two items
  (0.1.29 + 0.1.28), as retention requires.
- install acceptance: `install-launch-check-847e77db5c99d5d6.sh` over the DMG → **PASS** —
  `Storage Studio KH.app 0.1.29 launched hidden and is alive after 10s (pid 15753;
  app.storagestudiokh.desktop)`, run from a temp scratch dir, never `/Applications`.

## Not proven

- **Live Sparkle self-update click-through on an installed copy**: **UNMEASURED**. The item is served
  and its signature verifies over the anonymous download, but no installed 0.1.28 was walked through
  the update in this run.
- **The feed generator's own fix was made by the publisher, not by this line**: while publishing the
  row it found that the prebuilt `khu feed` ignored `app-meta.json` at the tag (a mixed-type cast) and
  fixed it in the Launcher's repo. That fix is **uncommitted** in
  `_orchestra/developer-system/update-studio-kh/app` (`Sources/KHUpdaterCore/FeedGenerator.swift` and
  `Tests/Runner/FeedGeneratorTests.swift`); its focused suite passed (69), its broad suite is
  **UNVERIFIED**. Issue row `20261125-24`. The row this receipt proves was generated by that rebuild.
- **`Cargo.lock` at the tag** names `0.1.28` for the app package: the build rewrites it, so the bump
  landed one commit later (`51e18a1`). Metadata only — `git diff b4b1e08..51e18a1 -- src helper` is
  empty.
