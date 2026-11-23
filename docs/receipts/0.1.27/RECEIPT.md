# Storage Studio KH 0.1.27 — receipt

Sparkle baseline. Written from commands this build actually ran; anything not run says UNMEASURED.

## What shipped

- Updates arrive on their own: the shim checks once per launch, takes the hold first (`POST` returns
  `{"safe":true}` or the update is refused), installs, relaunches.
- The window says "Updating Storage Studio KH" while the shim reports updating or relaunching.

## Identity

| field | value |
|---|---|
| version | 0.1.27 |
| gated commit | `46b37d5a862b5d52024bbec26e35eb5642dea1dc` (tag `0.1.27`) |
| tree | `main`, pushed to `theng12/storage-studio-kh` |
| scanner | `_orchestra/tools/pinned/studio-gate-<pin>.sh` — 18,754 B, sha256 `76dbf7aa09f5109bee4bb97705a0af3d1737e0b87230270c2f1bd3c779235ae9`, byte-identical to the canonical `_orchestra/tools/studio-gate.sh` (measured 2026-11-23) |
| gate | **PASS**, `gate-20261123-234042-28991`, steps: build ok, scanner ok, desktop-safety ok, commit-identity ok, idle-footprint measured by hand, scan-dmg clean |

## Sparkle baseline

- `src-tauri/vendor/khsparkle/libkhsparkle.a` — 85,480 bytes, sha256 `818826a79d4e5488…`; the pin in
  `_orchestra/tools/pinned/REQUIRED-SHIM.txt` checked by `scripts/build-mac.sh` as its own step.
- `src-tauri/vendor/khsparkle/Sparkle.framework` — Sparkle 2.10.1 (build 2065), committed with the
  library so `git ls-tree -r 0.1.27` proves the inputs the tag builds (policy `1f043c3`, row `160`).
  The framework binary is not hashed as a check: it differs per tree.
- `com.apple.security.cs.disable-library-validation` is signed in from `src-tauri/entitlements.plist`
  and asserted twice: on the built app, and again on the copy inside the mounted DMG. Both the app
  and the framework are self-signed with no Team ID, so without it dyld refuses the load.

## The hold key

`KHHoldTokenFile` is `~/Library/Application Support/Storage Studio KH/hold-token` — the `~/…` form
that the pinned shim expands from the user record (`getpwuid`), never an absolute path, which would
put a home directory inside a public artifact. Measured before this release: neither the app's own
token nor a migration marker existed on this Mac, and the shim opens that file before any hold request
reaches the app, so setup now performs the one-time step at startup instead of on first use. A missing
or unreadable file is a refusal, never a skipped hold.

**It is a copy, and the shared file is left in place.** Measured after the first run: both
`~/Library/KHUpdater/state/hold-token` and the app's own copy are 0600, 64 B and byte-identical, and the
shared file's mtime is unchanged. That matters across apps: another app on this Mac still names the
shared file in its own `KHHoldTokenFile`, so a move would take the token out from under it and its next
launch would refuse its hold — silently, with the shim's log redacted. The code creates the copy with
`create_new` and 0600 and never renames or deletes the shared file. If that ever becomes a move, it must
land in the same change that moves every remaining app off the shared path.

## Acceptance scripts

`tests/acceptance/run.cjs` and `tests/share-picker.cjs` already resolve Playwright with
`require("node:os").homedir()` (measured; neither carries a hard-coded home placeholder). The only
such strings left in `tests/acceptance/` are in historical review notes (`critic-round5.md`,
`critic-round10.md`), which are records, not runs; they are left as written.

## Scan through the pinned scanner (2026-11-23, before the build)

`tool studio-gate.sh 76dbf7aa… at …/tools/pinned/<pin>.sh` announced itself on the first line, then
`scan clean export of ecd6d38be…`. Every check PASS except `ROWESCAPE`, which is an AUDIT (it lists the
states it saw and asks for a manual confirm), never a pass. `SHIM PASS` names this tree at `main
ecd6d38b` and compares `libkhsparkle.a` against `REQUIRED-SHIM.txt`. `ENTITLEMENT PASS` sees the
exemption in `entitlements.plist`.

## Gate runs on the way to this one

- **Run 1** (`evidence/gate-20261123-230953-36732`) built the app and DMG, then failed on this build's
  own assertion: it pointed `otool` at `Contents/MacOS/storage-studio-kh`, but the bundle's executable
  is named by its product, "Storage Studio KH". The rpath was present; the check was wrong. Fixed in
  `84e804d` to read `CFBundleExecutable`. Instrument fault, not a build failure.
- **Run 2** (`evidence/gate-20261123-231943-92824`) passed the build and the pinned scanner, then
  failed `desktop-safety`: `tests/mini-reopen.sh` copied the app over `/Applications/…` and ran
  `open -a`, which activates a window on the owner's desktop. The harness is retired (`46b37d5`, moved
  to `~/Desktop/_trash/storage-studio-kh/2026-11-23 mini-reopen-harness/` with a manifest); nothing
  called it, and reopen handling is unchanged and still asserted by the scanner's REOPEN check.
  Shared-directory row **`20261124-1`** cites exactly this evidence: the file, the `desktop-safety`
  step above, `46b37d5`, the trash destination and its manifest. A live click-through of reopen is
  **UNMEASURED**.
- **Run 3** (`evidence/gate-20261123-233843-17754`) passed the build all the way through the Sparkle
  assertions ("framework embedded, rpath present, entitlement present, framework signature ok") and
  then stopped because run 2 had left `dist/Storage Studio KH-0.1.27.dmg` behind — the build refuses to
  overwrite a version. That unreleased image (built at `84e804d`, sha `37336f233e0a…`, 5,575,659 B) moved
  to `~/Desktop/_trash/storage-studio-kh/2026-11-23 pre-gate-dmg-from-84e804d/` with a manifest.
- **Run 4** is the gated run.

## The gap this release closes

Before 0.1.27 this repo tracked no build input for Sparkle at all (`git ls-tree -r` had no
`libkhsparkle.a`), so a tag could not prove what it built. It now tracks 97 files under
`src-tauri/vendor/khsparkle/`, the library and framework among them, in the same commit as the wiring.

## Artifact

| field | value |
|---|---|
| DMG | `dist/Storage Studio KH-0.1.27.dmg` — 5,575,640 bytes |
| sha256 | `387ea5b5d6ee53b039c3135659e896d87994473942d57082fb486b009467a0cb` |
| scan-dmg | clean, 96 files, `scan-dmg/2026-11-20`, `excused: []` (vendor and CA addresses only) |
| install + launch | `install-launch-check-e1a4850e0c342d3e.sh` (16,523 B, sha `e1a4850e0c342d3e…`) — **PASS**, 0.1.27 alive after 10 s (pid seen; the copy ran from a temp dir, never `/Applications`) |
| idle footprint | 105 MB after 5 s, **+0 MB while idle** (ceiling 500 MB) on a hidden instance with its own temp HOME; the run's own `idle-footprint` gate step was UNMEASURED because it needs a pid before the build |
| tag | `refs/tags/0.1.27^{}` → `46b37d5a862b` (annotated object `aeca746c`, peeled); `git show 0.1.27:app-meta.json` carries `Storage Studio KH-0.1.27.dmg` |
| second measurement | U001's own run of pinned `install-launch-check e1a4850e0c34` on these same bytes: PASS, 0.1.27 alive after 10 s — two measurements, one artifact |
| library | `libkhsparkle.a` 85,480 B, sha256 `818826a79d4e54885cbb5ad167f7425da8ba77436c6a5e277532f400aa1b4216`, matches `REQUIRED-SHIM.txt` (scanner `SHIM PASS`) |

## Published (2026-11-24)

Owner gave the word directly; App Publisher ran the release and the appcast. Re-measured here rather
than taken on report:

- release `theng12/storage-studio-kh` tag `0.1.27`, non-draft, created with `--verify-tag`; the only
  asset is `Storage.Studio.KH-0.1.27.dmg`, 5,575,640 B, `digest: sha256:387ea5b5…a0cb`.
- anonymous download of that asset: **200**, 5,575,640 bytes, sha256 `387ea5b5d6ee53b039c3135659e896d87994473942d57082fb486b009467a0cb`.
- appcast item 0.1.27 live at 17:47:17Z; `docs/verify-appcast.swift` over the anonymously downloaded
  asset with the bundle's `SUPublicEDKey` and the item's signature → **SIGNATURE OK (rc 0)**. A first
  attempt of mine printed `SIGNATURE INVALID` because my extractor produced an empty signature string;
  that was my measurement error, corrected before this line was written.
- `dist/`: 0.1.27 + 0.1.26 kept; 0.1.25 retired to
  `~/Desktop/_trash/storage-studio-kh/2026-11-24 0.1.25 dmg retired at 0.1.27 publish/` with a manifest.
- release body: the paragraph from `lead/0.1.27/CARD-TEXT.md`, 228 characters, no heading. The body
  briefly carried a promoted `## 0.1.27` heading while the preflight was being satisfied; that was a
  metadata-only edit and was put back to the paragraph, with the artifact, tag and asset untouched.
  Shared row **`20261124-10`**: the preflight needs a heading in the file the card shows, so one file
  cannot be both its input and the published body; the JSON-receipt refusal is the same family.
- feed row: **read here, not proven.** `release.json` carries `feed` as plain base64 JSON; decoded, the
  `storage-studio` row still reads **0.1.26** (4,672,493 B, sha `2cebeb77…`, tagline "Keep your drives,
  NAS shares and archives mounted and tidy.") — System's pass for 0.1.27 was starting when this was
  written. What needs the feed key is verifying the envelope signature, not reading the row; the row is
  therefore **UNVERIFIED for 0.1.27** here, and the envelope signature is not checked by this session.
- `app-meta.json`'s tagline was aligned to the sentence the live row carries ("Keep your drives, NAS
  shares and archives mounted and tidy."), so a later release does not silently change the card
  sentence. It is metadata after the tag: `git show 0.1.27:app-meta.json` still carries the earlier
  wording, and that is stated rather than smoothed over.

### Preflight notes (each cost a run)

1. the changelog heading must be **level two** (`## 0.1.27`); level one reports `<no heading>`, which
   reads like a missing file.
2. the scan receipt must be **text that names the sha** — the gate's `summary.txt` passed;
   `scan-receipt.json`, which names it just as plainly, failed.
3. `--type`, `--tagline` and `--description` are required when there is no existing row to inherit.

## Not measured yet

- A live click-through of a Sparkle update on an installed copy: **UNMEASURED** (needs an installed 0.1.27 and a newer appcast item).
- The feed row, for the reason above.
