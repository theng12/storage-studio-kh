# Storage Studio KH 0.1.10 — fresh critic, round 7

Reviewer: independent studio critic. Did not design or implement this release.
Commit: `6b5df20` (round-6 fixes). Dev URL: `http://localhost:1420/` (Vite, headless).
Browser: Chromium via Playwright from `music-studio-kh/node_modules`. No visible app window was
opened, no owner data was touched, and no pointer or keyboard input was sent outside the page.
Measurements: 375×812, 768×900, 820×640, 1440×900; light and dark; Cards and Table; dialogs at
all four widths. Evidence: `tests/acceptance/critic/round7/`.

## Verdict: FAIL

| Area | Score /4 | Basis |
|---|---|---|
| Usability | 3 | The default Cards flow is clear, but at 375 the Table view has no visible row action at rest, and the missing-disk editor contradicts the row. |
| Usage flow | 3 | Add, mount, test, edit, remove/undo, credentials and helper restart are traceable; the update check drops focus, and the preview's duplicate removal leaves a stale row. |
| Functionality | 3 | Live snapshot updates are true, but the missing-disk editor says the disk is connected while the row says it is not; the duplicate-clear promise is not observable in the provided build. |
| Craft | 3 | Contrast, rings, dialogs, tab containment and menu keys hold; the 375 Table hides the action cell, the update check focuses BODY, and helper-down at 375 adds a 20 px page scroll. |
| Trust | 3 | Path, credential location, update version and Undo are visible; the normal state has no last-checked time, and the missing-disk contradiction weakens proof. |

Any area below 4 is a FAIL. The deciding defects are findings 1–3.

## Method

Walked the headless URL end to end: empty first run; add a share (typed and Return-saved); duplicate
forms (`:445`, query, `/./`); mount an unmounted share with a credentials prompt (empty save, then
saved); unmount; repeated Test; edit and Test; forget password; remove from the row menu with
confirmation and Undo (including the 12 s Undo timeout); remove from the editor; browse shares and
dismiss with Escape; discard prompt; view switch by keyboard; General toggles and retries;
Appearance System/Light/Dark by keyboard; Check for Updates; What's New; second instance; helper
down and Restart helper; boot failure and Retry. Tabbed the page and every sheet, checked focus
rings, Escape ordering, row-menu arrows/Home/End, dialog containment and focus after transitions.
Measured DOM geometry, contrast, network and console. Injected a snapshot through the fixture's
documented `__SS_TEST__` hook only for the duplicate/dedupe and genuinely-missing-volume states that
the supplied sample does not produce.

Network: no external requests; only local Vite modules. Console: no errors. The preview has no
runtime skip log; no skip was observed. The acceptance self-report was read for its claims but is
not treated as evidence.

## Findings (most severe first)

### 1. Missing-disk editor says the opposite of the row (FAIL)
Severity: high — Functionality / Trust.

What a person sees: the Editing SSD row says **Unreachable** and "The disk isn't connected right
now." Open its editor and the Disk field selects `Editing SSD — /Volumes/Editing SSD` with the hint
**"These disks are connected now."** With a snapshot where the saved volume is genuinely absent,
the field shows `Saved disk — /Volumes/Editing SSD` and still says "These disks are connected now."
The row and the sheet are on screen together (`edit-missing-disk-820.png`,
`edit-missing-volume-injected.png`).

Why it fails: the missing-file state's shown data is contradictory and the next step is not named.
The app has `savedVolumeMissing` logic, but the copy does not use it; the hint describes the other
attached volumes and reads as if the selected saved disk were among them. This is the exact flow the
brief calls "a missing file".

Smallest fix: when the selected saved volume is not in `volumes` (or the storage status is
`unreachable`), say "Editing SSD isn't connected. Reconnect it, then reopen this window." Do not
render the unreachable disk as a connected choice in the default sample; either remove it from the
sample `volumes` or align the row status from `volumes`. One source, one sentence.

### 2. Table view at 375 has no visible row action at rest (FAIL)
Severity: high — Craft / Usability (bar 2, bar 4, bar 11).

What a person sees: at 375 the Table shows only Storage and Status. There is no Open in Finder,
Mount now, or "…" button in the rows, and no visible indication that more content exists to the
right (`measure-table-light-375.png`, `measure-table-dark-375.png`). After a horizontal scroll the
Actions column appears but the Status column leaves the screen
(`table-light-375-scrolled-right.png`).

Measured: the `.storage-table-wrap` is x=16..359, width 343, client width 341; the table is 486 px
wide; the Actions cell is x=347..502.9; the primary button is x=359..490.9. The wrapper's right
edge is 359, so **0 px of the primary button is visible at rest**. The wrapper has `overflow-x:auto`
with a 2 px overlay scrollbar; the document itself does not overflow. At 768 the table is 486 px in
a 474 px client, Actions are visible (primary x=607..739); at 820 and 1440 all visible columns fit.

Why it fails: the row's primary action is the main job, and at 375 the table offers no visible way
to do it without discovering a hidden horizontal scroll. Cards is the default and carries the
actions, but Table is offered at the same width; the previous round asked to keep Actions visible.
The fix that hid Address/Mounted-at/Reconnects did not solve the action column.

Smallest fix: keep the Actions cell sticky at every width (as it was above 1100 px), or fall back
to Cards / two-line rows (name + status, then actions) below 600 px. Re-measure rest and
scrolled-right at 375/768/820/1440 and require zero horizontal overflow.

### 3. Check for Updates drops keyboard focus to BODY while checking (FAIL, bar 9)
Severity: medium — Craft / accessibility.

Repro: focus the Check for Updates icon, press Enter. Measured active element: before =
`BUTTON[check]`; during the 700 ms "Checking for updates…" state = `BODY`; after the result =
`BUTTON[check]`. The button is disabled while checking (`update-checking-820.png`), which removes
focus; the app restores it only after the check finishes.

Why it fails: bar 9 says focus never falls to BODY after a transition. A keyboard user loses their
place (and any Tab during that window restarts from the top). The final focus is correct, but the
transition is not.

Smallest fix: keep the icon focusable while busy (`aria-disabled="true"` instead of `disabled`, no
focus loss) or move focus to a stable control before disabling and restore it immediately; verify
the active element at 0 ms, 100 ms and after the result.

### 4. Removing a grouped duplicate row leaves the duplicate behind in the provided build
Severity: medium — Functionality / Trust (test-surface).

What a person sees: with two entries for one share the row reads `×2`. Remove it from the row menu;
the confirmation says "This removes the storage from Storage Studio KH, forgets its saved password
and clears any duplicate entries." The toast says "Removed …"; the other entry survives as
`Old copy` (`duplicate-group-820.png`, `duplicate-remove-result-820.png`; DOM rows after removal:
Movies, System pool, TV Show, Old copy). The What's New text makes the same clear-duplicates claim.

Why it fails: through the provided headless build the action does not match its own copy. The
acceptance self-report and `completeness-0.1.10.md` cover dedupe but not duplicate removal. The Rust
`remove_storage` path uses `same_storage` and appears to remove all matching entries, but source is
not runtime evidence and the preview fixture sends only one id. Either the fixture is wrong or the
promise is false; the release evidence cannot tell which.

Smallest fix: make the dev/acceptance `remove_storage` mirror the real `same_storage` removal (or
have the UI send every grouped id), then add one gate assertion: remove a ×2 row, assert both
entries are gone. Do not accept the self-report for this flow.

### 5. Helper-down at 375 adds a 20 px page scroll; the footer leaves a gap
Severity: low — Craft (bar 11, footer pinned).

Measured at 375×812 with `#view=storage&engine-down=1`: document scrollHeight 832 vs viewport 812
(body 812); scrolling to 20 moves the footer top from 708.2 to 688.2 and leaves 20 px of blank below.
Normal state: docH 812, no page scroll. The footer is visible at rest but is not pinned in this
state; `engine-down-375.png` shows the banner state.

Smallest fix: contain the banner and list inside the existing main scroll area (or remove the 20 px
child overflow), then re-measure docH = 812 at 375 in normal, helper-down and empty states.

### 6. No last-checked time in the normal state
Severity: low — Trust.

The helper-down status line says "Helper isn't running. Last update 06:09 AM." (good), but the
running state never says when the mount table was read; the lede tooltip only says "Press ⌘R to
re-read." The credential sheet now names `~/Library/Application Support/Storage Studio KH/secrets.json`
(good). The round-6 request was a last-checked indication; it is only present when the helper is
down. The normal list is live, so this is not the deciding defect, but a skeptical owner cannot see
the time in the state they normally use.

Smallest fix: a quiet "Checked just now" / "Checked 2 min ago" on the status line or its title,
updated by the snapshot's `lastChecked`, in every helper state.

### 7. The Studio NAS row menu wraps below its primary at 768/820
Severity: low — Craft.

At 820 the Actions cell is 165 px wide; "Open in Finder" is 131.9 px + the 28 px menu button + gap,
so the menu button wraps to a second line; the row is 81 px tall while Archive/Editing are 78.9 px.
At 768 the same happens in a 155.9 px cell (`measure-table-dark-820.png`, `measure-table-light-768.png`).
It is not clipped, but the action pair is inconsistent across rows.

Smallest fix: give the Actions cell a min-width/nowrap that fits the widest primary, or use an
icon-only primary with the menu always beside it. Re-measure row heights at 768/820.

### 8. One footer entry has no icon (bar 7 literal)
Severity: low — Craft.

Support, Check for Updates and Download have icons; the version + What's New pill is text-only. If
bar 7 ("icons on every nav item and footer entry") is literal, add the What's New icon to the pill;
if the pill is the version badge and deliberately exempt, record that exception in the completeness
record. `support-375.png`.

## Round-6 findings re-walked

| Round-6 finding | Result at 6b5df20 |
|---|---|
| Table clipping/overlap and blank cells | Fixed at 768/820 (Storage, Status, Actions; no overlap; no blank values). At 375 the table now scrolls but the Actions cell is off-screen at rest — finding 2. |
| Edit connected-share "Add" silently retargets | Fixed: Edit renders 0 connected-share rows; the picker exists only in Add. |
| Remove absent from the row menu | Fixed: menu is Unmount (mounted only), Test, Edit, Remove…; confirmation and Undo reuse the editor flow. |
| Generic forget toast | Fixed: "Saved Studio NAS. The saved password was forgotten." (`forgot-password.png`). |
| Duplicate forms not detected | Fixed: `:445`, query and `/./` forms all keep Save off with "This share is already added as Studio NAS." (`dup-1..3.png`). |
| Repeated Test stacks identical toasts | Fixed: one "Test: Connected at /Volumes/studio." toast after two Tests. |
| Undo timeout focuses invisible main | Fixed: after 13 s the toast is gone and focus is `BUTTON[add-storage]`. |
| No last-checked time / credential path | Partial: helper-down shows "Last update"; credential sheet names `secrets.json`; normal state still has no time — finding 6. |
| Boot Retry focus | Retry is focused on the error screen; after a successful Retry focus is `<main>` (tabindex −1), not BODY. Low; not scored as a failure. |

## Completeness gates

### 1. Task list

| Job | Walked | Result |
|---|---|---|
| Add an SMB share | yes | Save enabled for name + `smb://`; Return saves; toast names the row and offers Mount now; focus returns to Add storage. |
| Add an attached disk | yes | Editor lists the fixture volumes; mount point shown. The supplied sample's Editing SSD is both "connected now" and unreachable — finding 1. |
| Browse and pick a share | yes | `Shares on nas.local` with real names; picking sets an encoded target; Escape dismisses the picker first and returns focus to the address field. |
| Reject an invalid address | yes | Host-only keeps Save off; an `http://` address names the scheme. |
| Mount | yes | Row goes Mounting… (chip, detail and button), then Mounted with the path; status line updates. Credentials prompt appears when needed. |
| Unmount | yes | Row becomes Not mounted; status line updates; no toast, row state is the feedback. |
| Test (repeat) | yes | Named result toast; repeated Test replaces the identical toast; focus stays on the editor Test button. |
| Edit name/flags | yes | Save updates the row and toasts. |
| Reconnect at login/after wake | yes | Two checkboxes saved in the editor; visible in Cards as "At login · after wake". |
| Remove + Undo (editor and row menu) | yes | Confirmation states what/where/what stays; Keep focused; Undo restores and focuses the row. Duplicate removal is finding 4. |
| Credentials | yes | Empty save names the missing password and focuses it; saved password mounts; failure path names "couldn't save the password"; focus returns to the row menu. |
| Forget saved password | yes | Checkbox disables the password field; toast names the forgotten password; the checkbox disappears afterwards. |
| Cards/Table switch | yes | Radio keyboard works, `set_list_view` invoked; the preview resets to Cards on reload, so persistence is not checked. |
| Duplicate handling | yes | Exact and normalized duplicates blocked; injected legacy duplicates dedupe to one row with ×N and the status line counts groups (4). Removal is finding 4. |
| Helper restart | yes | Banner, reason, Restart helper; toast "Helper started."; nav usable while down; focus lands on a real nav control. |

### 2. Capability cross-check

Every declared capability has a reachable control: kinds, address + Browse, name/mount point,
credentials + forget, mount/unmount, Test, Open in Finder, Edit/Remove, reconnect flags, six-status
chip, helper banner/restart, updates/What's New, Support, System/Light/Dark, Cards/Table,
notifications/login/retries, second-instance note, dedupe ×N. The `mounting` state was observed;
`retrying` was not produced by the fixture. Open in Finder, donation and download have external
effects that cannot be observed headlessly.

### 3. Standard comparison

Finder Connect to Server / AutoMounter expectations are present: server + browse, per-server
credentials, saved servers add/edit/remove, status, mount/unmount/reveal, reconnect at login/wake,
menu-bar item, notifications/login/retries. Search/filter, mount all, sync/bandwidth, NFS/AFP and
Keychain are recorded as deliberately absent with reasons. No missing control found beyond the
missing-disk copy in finding 1.

## Not checked (not passed)

- Real SMB mounting/unmounting, Finder reveal, helper IPC, menu-bar item, notifications, login/wake
  behavior, login-item error, and the real 0600 secrets file. The headless URL is a dev fixture.
- Whether the shipped Rust `remove_storage` actually clears duplicates at runtime; only the preview
  fixture was exercised (finding 4).
- Cards/Table persistence across a real app restart; a preview reload resets to the hash default.
- Reload with cached metadata; the preview has no cache and rebuilds the fixture on reload.
- Download/update handoff, donation page and Open in Finder external effects.
- The `retrying` status, and any helper failure after a mount attempt.
- Native gate, DMG build, served feed readback and installed-app behavior; the release record says
  those are pending, and this review did not run them.

## What must change before a fresh critic reviews again

1. Fix the missing-disk editor: one source for the saved volume, honest copy, and a named next step;
   remove the contradictory "connected now" state from the sample.
2. Make the Table's row actions reachable at 375 without a hidden horizontal scroll (sticky Actions,
   Cards fallback below 600, or two-line rows), and re-measure rest/scrolled at all four widths.
3. Keep keyboard focus off BODY during Check for Updates, with a measured active element at the
   start, during and end of the check.
4. Make duplicate removal in the preview match the confirmation/What's New promise and add a gate
   assertion for it; do not accept the self-report for this flow.
5. Remove the 20 px helper-down page scroll at 375 and re-measure the footer.
6. Add a normal-state last-checked time.
7. Align the row menu with the primary at 768/820, and decide the pill icon/bar-7 exception.

## Evidence index

`tests/acceptance/critic/round7/`: `measure-*` layout shots, `table-light-375*`,
`edit-missing-disk-820.png`, `edit-missing-volume-injected.png`, `update-checking-820.png`,
`duplicate-group-820.png`, `duplicate-remove-result-820.png`, `engine-down-375.png`,
`forgot-password.png`, `dup-1..3.png`, `remove-*`, `toast-*`, `browse-820.png`,
`whats-new-*`, `general-*`, `appearance-*`, `support-*`, `empty-*`, `menu-375.png`.
