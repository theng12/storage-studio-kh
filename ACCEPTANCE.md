# Storage Studio KH acceptance

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
on by default, and a person never has to switch it on. The port is `127.0.0.1:8910`, overridable
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
