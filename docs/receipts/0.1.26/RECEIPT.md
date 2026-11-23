> Tracked copy of `lead/0.1.26/RECEIPT-0.1.26.md`, backfilled under RELEASE-POLICY §5b (2026-11-23)
> because 0.1.26 is the version the feed currently serves. One change: the retired release host is
> named by role rather than by its machine name. Bulk build/test output stays untracked beside the
> original in `lead/0.1.26/`.

# RECEIPT — Storage Studio KH 0.1.26

Built and gated 2026-11-23 from `main`; **published 2026-11-23** — GitHub release `0.1.26` (asset
`2cebeb77dd42-Storage.Studio.KH-0.1.26.dmg`), feed serving it from `11:41:56.324Z`. The build and gate
evidence below was produced before the release; the scan line was added afterwards by the Developer
because the gate evidence carried none, and it was run on the exact published DMG.

## What shipped (source)

1. **The update hold's token is enforced, not just documented** — `hold_token_fault()` refuses a
   symlink, non-file, oversized file, any group/other permission bit, and anything that is not exactly
   64 hex (`b3663d5`). The 401 body names the reason and the same line is logged.
2. **The token moves into the app's own folder once** — a legacy
   `~/Library/KHUpdater/state/hold-token` is copied to `<app support>/hold-token` at 0600, the move is
   logged, a marker stops it being re-created, and the legacy path is never read again (`b20ec83`).
3. **Tests no longer write the live app log under `cargo test`** (issue-365 class).

## Artifact

| | |
|---|---|
| DMG | `dist/Storage Studio KH-0.1.26.dmg` |
| sha256 | `2cebeb77dd42e3fc6885ab51b0b407409b25486c5f738e27364bad51ac4686df` |
| bytes | 4,672,493 |
| commit | `d39d28f` (bump) over `b20ec83`, `b3663d5`, `74d587b` |
| signature | in-DMG check: helper `codesign --verify --strict` OK, app `codesign --verify --deep --strict` OK |
| scan | `scan: sha256=2cebeb77dd42e3fc6885ab51b0b407409b25486c5f738e27364bad51ac4686df clean` — `scan-dmg/2026-11-20`, exit 0, 11 files, `excused: []`, run `2026-11-23T12:04:14Z` on this exact DMG with `KH_EXPECTED_BYTES=4672493` |
| appcast | `docs/appcast.xml`, Pages `main /docs`, served 200; `appcast-verify.sh` **exit 0** against this DMG — key taken from `~/.kh-sparkle/app.storagestudiokh.desktop/`, not from the bundle |

> **signed and verified against the release key; the shipped app carries no key, so the item is not usable by
> the app itself.** The 0.1.26 bundle carries no `SUPublicEDKey`, no `SUFeedURL` and no Sparkle framework —
> checked by mounting the DMG and by Release Tooling independently, which also flipped one signature character
> to prove the verifier returns exit 1. **Storage's Sparkle baseline is therefore the next version**, and the
> verifier is re-run **from that bundle** then, which is what makes the chain complete.

## Proof

- `build-0.1.26.log` / `rust-test-0.1.26.log` / `gate-0.1.26.log` / `hold-0.1.26.log` — exits reported
  in the handback.
- Live token migration proof: `lead/migration-proof-20261123/migration-proof.log` — **MIGRATION_PROOF_OK**.
  Legacy token copied once into a fresh temp HOME (0600, no symlink); first hold 200; own token exists
  with the same bytes at mode 600; `.hold-token-migrated` written; one migration line; legacy copy
  removed → hold delete 200; second launch → hold 200 with still one migration line (legacy not read
  again); own token deleted with the legacy copy present → **401 naming the reason**, own token not
  re-created; temp root removed (verified absent).
- Exits: `build-mac.sh` 0, gate 0 (28 PASS), hold 0 (10 PASS), Rust suite 35 passed; helper unit tests
  NOT RUN (no XCTest).
- Signing order from the build log: helper binary (`build-mac.sh:99`), helper app (`:100`), then the
  bundler re-signs the app (`:203`/`:206` of the log), then `codesign --verify --strict "$helper_inside"`
  (`:177`) and `codesign --verify --deep --strict "$app"` (`:178`).
- Acceptance harness defaults are `$HOME`-relative since `74d587b` (post-rewrite fix).


## Appcast (2026-11-23)

`docs/appcast.xml` committed and pushed (`79178b5`); Pages enabled (main /docs). Anonymous read of
`https://theng12.github.io/storage-studio-kh/appcast.xml` returns **200** with the 0.1.26 item
(length 4,672,493, asset `2cebeb77dd42-Storage.Studio.KH-0.1.26.dmg`); the anonymously downloaded
asset is 4,672,493 bytes, sha `2cebeb77…`, and its **signature verifies against this app's own
Ed25519 key** (`~/.kh-sparkle/app.storagestudiokh.desktop/`, 0600, generated today — the restorable
copy on the KH drives is still owed). The app itself does not carry `SUFeedURL`/`SUPublicEDKey` yet;
the appcast is ready and unused until the Sparkle shim ships in it.

## Card text (metadata only, 2026-11-23)

0.1.26's release body was published with the placeholder ("Signed release from the KH Studio feed.");
the feed row's `notes` inherit the release body, so the Launcher card for the current release shows
it. Replacement text was written from `app/CHANGELOG.md` 0.1.26 and this receipt: the hold key must
be mode 600 and exactly 64 hex (refusals say why), and a legacy key in the Launcher's shared folder
is copied into the app's own folder once.

Applied by App Publisher with `gh release edit --notes-file` against `lead/0.1.26/CARD-TEXT.md` —
that file holds the paragraph and nothing else, so the file applied is the file checked (the same
rule as row `20261123-118`). Metadata-only: the artifact, its sha256 (`2cebeb77…`) and bytes
(4,672,493) do not change, and 0.1.25 and older keep their bodies.

## Not proven / not done

- NAS mount proof: blocked (NAS answers TCP 445, refuses guest authentication, no password available).
- Helper unit tests NOT RUN (no XCTest module on this Mac).
- No publish to the retired release host, and no page sync, for 0.1.26: that host is retired, and the
  page row belongs to the estate's file-studio-0.6.1 row, not to this app.
- The GitHub release `0.1.26` **does** exist — tag `0.1.26`, non-draft, one asset
  `2cebeb77dd42-Storage.Studio.KH-0.1.26.dmg`, 4,672,493 B — created through App Publisher, after
  this build's handoff.

### Applied and read back — 2026-11-23, App Publisher

- File applied: `lead/0.1.26/CARD-TEXT.md`, 296 bytes, sha256 `8496f0ede97b35ac9252116cdd406578aac06014eca4a18319e79c9b840aa25a`, first line `Same app as 0.1.25. …`, no heading, no `---`, single trailing newline — checked before the edit.
- Command: `gh release edit 0.1.26 --repo theng12/storage-studio-kh --notes-file lead/0.1.26/CARD-TEXT.md` (rc 0).
- Read back with `gh release view 0.1.26 --json body`: the body is **byte-identical to the file** and carries nothing else.
- Artifact unchanged: `2cebeb77dd42-Storage.Studio.KH-0.1.26.dmg`, 4,672,493 bytes, digest `sha256:2cebeb77dd42e3fc6885ab51b0b407409b25486c5f738e27364bad51ac4686df`. 0.1.25 and older untouched.
- This edit is metadata-only: the release body changed, the artifact and every digest above did not.
