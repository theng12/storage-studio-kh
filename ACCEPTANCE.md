# Storage Studio KH acceptance

## Release scope: 0.1.13

0.1.13 closes two carried items: a mount point is chosen in macOS's folder panel and can no longer
be typed, and the update-hold route requires the Launcher's own credential. Everything from 0.1.12
is carried unchanged.

| User task | Check and evidence | State |
| --- | --- | --- |
| Choose where a share mounts with a folder panel | `tests/acceptance/run.cjs` — the mount point field is `readonly`, Choose… invokes `pick_mount_point` and the panel's folder fills it, Clear empties it, a cancelled panel changes nothing and reports no error. `tests/web.test.mjs` asserts no typed-path branch remains; the Rust panel is code-verified only (a real panel needs a desktop, so it is not clicked in a test) | Required on 0.1.13; the native panel itself is not clicked by a test |
| The Launcher can still hold the app; nobody else can | `tests/hold.sh` — a hold with no credential, a wrong one or a plain GET answers 401, the Bearer form and `X-Hub-Token` both open it, an authorized GET answers 405, another path answers 404, and a token rotated on disk takes effect on the next request. `cargo test` covers the same rules at unit level (missing, empty, symlinked and wrong tokens; two disagreeing credentials; an `Origin` header) | Required on 0.1.13 |
| Keep the rest of the app working | `tests/gate.sh`, `tests/web.test.mjs`, `helper swift test`, `cargo test` | Required on 0.1.13 |

## Release scope: 0.1.12

0.1.12 makes a mount end. A share that accepts the connection but never answers used to leave
its row at "Mounting…" for as long as NetFS stayed blocked, and the helper's single command queue
froze with it. Now the attempt has its own ceiling, runs off the command queue, and the row has a
Stop trying control. Everything from 0.1.11 is carried unchanged.

| User task | Check and evidence | State |
| --- | --- | --- |
| A mount that never answers ends by itself | `MountBudget` unit test (90 s default, 600 s ceiling) and `EngineTests.testAnAttemptPastItsBudgetEndsTheRowAndIgnoresItsLateAnswer` — a watched slow mount trips the 1 s test budget, the row says "It didn't answer within 1 s. Mount now starts again.", holds no work, ignores its late failure, and a refresh still answers while the attempt is wedged. A real half-open share is not reproducible on this Mac (the TCP probe fails fast before NetFS); `tests/mount-ceiling.cjs` skips that case honestly | Required on 0.1.12; live half-open share not checked |
| Stop trying ends a running mount or a waiting retry | `tests/acceptance/run.cjs` — a mounting row shows an enabled Stop trying, invokes `cancel_storage`, and the row says Not mounted with "Stopped trying."; `EngineTests` cancel tests drop a waiting retry and stop believing a running attempt; `tests/mount-ceiling.cjs` — the real helper goes not_mounted with "Stopped trying" and clears its queue | Required on 0.1.12 |
| A stuck mount no longer freezes the rest of the app | Mounts run on their own queue, so `hold`, unmount, test and refresh run while a mount waits; `tests/hold.sh` still proves the contract | Required on 0.1.12 |
| A full disk is not a quiet failure | The helper on a 100%-full HFS+ volume logged the failed save, did not create `secrets.json`, and kept `hasCredentials` false; the connected row now says the password wasn't saved and the disk's free space (`SecretsTests`) | Required on 0.1.12; the app's own settings save on a full disk is code-verified, not run |
| Keep the rest of the app working | `tests/gate.sh`, `tests/web.test.mjs`, `helper swift test`, `cargo test` | Required on 0.1.12 |

## Release scope: 0.1.11

0.1.11 makes the app update-safe: Studio Launcher can hold its work before an install, so an
update no longer interrupts a mount. Everything from 0.1.10 is carried unchanged.

| User task | Check and evidence | State |
| --- | --- | --- |
| Update the app while it is open without cutting off a mount | `tests/hold.sh` — `POST /api/maintenance/hold` reports the helper's real in-flight mount, and the settle is bounded at 20 s default / 30 s max | Required on 0.1.11 |
| Nothing new starts while the update installs | `tests/hold.sh` — a mount sent to a held helper is deferred, never run; `refuse_new_work` (unit test) refuses Mount now / Test in plain words | Required on 0.1.11 |
| See why a clicked Mount now did nothing | The window shows "Holding new work for an update"; the tray's Mount now is disabled and the row action answers with the same plain reason | Required on 0.1.11; the click itself is not photographed |
| Resume at once when the installer says so | `tests/hold.sh` — `DELETE` clears the pause and the deferred mount runs again | Required on 0.1.11 |
| Carry on by itself when an update is abandoned | `tests/hold.sh` — a hold with no `DELETE` expires after `pause_s` and work resumes | Required on 0.1.11 |
| Quit and reopen during a hold: work runs again with nothing to switch back on | `tests/hold.sh` — a restart after a hold mounts again with no `DELETE`; the pause is never written to disk | Required on 0.1.11 |
| Keep the rest of the app working | `tests/gate.sh` (launch, helper child, bounded retries, second instance, quit, no leftovers), `tests/web.test.mjs`, `helper swift test`, `cargo test` | Required on 0.1.11 |
| Read What's New for the installed version | `src-tauri/whats-new.json`, generated from `CHANGELOG.md` by the build and checked by `scripts/build-mac.sh` | Required on 0.1.11 package |

## Capability cross-check

The hold's only knobs are the contract's two query values: `timeout_s` (default 20, ceiling 30) and
`pause_s` (default 120). Both are enforced in code and shown in the reply (`dispatch_paused_s`).
There is no app setting to add, disable or persist the hold: it is an installer-facing contract,
on by default, and a person never has to switch it on. The port is `127.0.0.1:8646` (its row in the contract's port table), overridable
for a test instance with `STORAGE_STUDIO_HOLD_PORT`.

## Standard-practice comparison

macOS menu-bar utilities that do background work (disk, network and backup helpers) either quit
mid-work when replaced, or take a short quiesce. The fleet contract is the latter, with one shared
reply shape so one installer drives every app. Storage Studio KH follows it exactly: hold, bounded
settle, update in the gap, resume by itself. The pause is memory-only, which matches how a
system-wide install is expected to behave: an aborted install cannot leave the app refusing work.

## Evidence boundaries

The hold is proven headless over real loopback HTTP and against the real helper process, with no
window and its own data folder. A person clicking Mount now while held is shown the plain reason in
code and in the toast path, not photographed on a desktop. Publication is not an installed-version
claim; installation belongs to Studio Launcher.
