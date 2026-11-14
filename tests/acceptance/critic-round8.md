# Storage Studio KH 0.1.10 — fresh critic, round 8

Reviewer: independent studio critic. Did not design or implement this release. Nothing was
fixed by this review.
Commit reviewed: `158349f` (working tree also has a modified `tests/acceptance/release-0.1.10.md`,
which this review did not read as acceptance evidence beyond its stated pending rows).
Test surface: Vite headless at `http://localhost:1420/` with the documented hash fixtures.
Browser: Chromium (Playwright from `music-studio-kh/node_modules`), headless only.
No visible app window was opened, no app was activated, no pointer or keyboard input was sent
outside the page, and the owner's live data was not touched.
Measured at 375×812, 768×900, 820×640, 1440×900; light and dark; Cards and Table.
Dialogs measured at 375, 820 and 1440.
Evidence: `tests/acceptance/critic/round8/` (screenshots and `flows-a..f.json`).

## Verdict: FAIL

| Area | Score /4 | Basis |
|---|---|---|
| Usability | 3 | Core Cards flow is clear, but Table at 768 hides the row menu; the last-checked line does not say what was checked. |
| Usage flow | 3 | Add, mount, Test, edit, credentials, forget, remove/undo and helper restart are traceable; a saved row leaves focus on an off-screen button at 375, and Undo does not restore the mount it removed. |
| Functionality | 4 | Shown data is true and from one snapshot; missing disk/volume copy is honest; duplicates, missing-file, credentials failure, boot failure and helper-down all name a cause and a next step. |
| Craft | 2 | The document scrolls at 375 and 820 in normal use and helper-down, so the footer is not pinned and fixed toasts can cover it; Table at 768 clips the row menu at rest. Contrast, focus rings, dialog containment and menu keys otherwise hold. |
| Trust | 3 | Location, paths, status, update version and Undo are visible, but "Checked just now" is unlabelled and Undo says "Restored" without saying the mounted share was not remounted. |

Any area below 4 is a FAIL. Findings 1 and 2 decide it.

## Findings, most severe first

### 1. The window scrolls and the footer leaves the bottom edge (FAIL)
Severity: high — Craft (bar 11), Usability.

What a person sees: after adding a storage at 375×812, the footer's version pill/update controls
can be scrolled up and a blank strip appears below them; the fixed toast then sits over the footer.
The same happens in the helper-down state at 375 and 820 before the user does anything.

Measured:
- 375 add flow (`#view=storage`, add “Pocket Share”, `smb://pocket.local/media`, Return):
  `document.documentElement.scrollHeight` = **882** vs client 812. `window.scrollTo(0,80)` scrolls
  70 px; `#foot` top moves **708 → 638**; toast bottom stays fixed at 708 and overlaps the footer.
  Screenshots: `add-saved-375.png`, `add-saved-375-scrolled.png`.
- 820×640 same add flow: document scrollHeight = **837** vs 640; `window.scrollTo(0,150)` moves
  `#foot` top **532 → 382**. Screenshot: `add-saved-820-scrolled.png`.
- Helper down (`&engine-down=1`): 375 = **832** vs 812 (20 px), 820 = **731** vs 640 (91 px).
  `window.scrollTo(0,200)` scrolls 20/91 px and moves the footer. Screenshots:
  `engine-down-375.png`, `engine-down-375-scrolled.png`, `engine-down-820.png`,
  `engine-down-820-scrolled.png`, `engine-overflow-375.png`, `engine-overflow-820.png`.
- Normal samples at 768/1440 do not overflow; the empty state does not overflow.

Root cause, measured in the page: `.sr-only` is `position:absolute` with no positioned ancestor
(`ui/src/styles.css:172`). A screen-reader label inside a card that sits below the viewport
(for example the fourth card after saving) becomes an absolute box at page y=882 and extends the
root scroller. Hiding `.storage-list` returns the document height to 812/640; hiding the toolbar
or `#main` does the same. This is the same failure class as round-7 finding 5, which was reported
fixed; it is not fixed, and the normal add flow now exposes it at 820 as well.

Why it fails: bar 11 requires the footer pinned and content, not the window, to scroll. Once the
window scrolls, a fixed toast covers footer controls (bar 11, toasts clear the footer), and the
window can be moved away from its only update/support controls.

Smallest fix: make the screen-reader spans belong to the row/main (`position: relative` on
`.storage-row` or `.main`, or an equivalent clip that does not use the initial containing block),
then re-measure document height == viewport at 375/768/820/1440 in normal, after-add, empty and
helper-down states, with the footer and toast boxes printed.

### 2. Table at 768 hides the row menu at rest (FAIL)
Severity: high — Craft (bar 11), Usability, bar 4.

What a person sees: at 768×900 in Table, the row's “…” menu is a clipped sliver at the right edge
of the table. Test, Edit and Remove are unreachable until the user discovers a horizontal scroll
inside the table. After scrolling, the Status column is cut (“us”, “ounted”, “lected as studio”).

Measured (`#view=storage&list=table`):
- `.storage-table-wrap` x=264..740 (client width 474); table is 510 wide (`scrollWidth` 510).
- Row menu boxes: x=735..763 for every row; the wrapper's right edge is 740, so only 5 px of 28
  is visible at rest.
- After `scrollLeft = 36`: menu x=699..727 is visible, but Status cells/headers are clipped; the
  first column stays pinned.
- At 375: menu 318..346, fully visible. At 820: 751..779, fully visible. At 1440: fully visible.
  So this is specifically the declared 768 breakpoint.
- Screenshots: `table-768-rest.png`, `table-768-scrolled.png`, `storage-768-table-light.png`,
  `dark-375-table.png` (375 is correct), `table-820-rest.png` (820 is correct).

Why it fails: the row menu is the only route to Test/Edit/Remove; a clipped action is not an
actionable state. Bar 11 requires no horizontal overflow and nothing clipped; round-7 finding 2
asked for zero horizontal overflow at all four widths after fixing 375.

Smallest fix: below 900 px make the three visible columns fit 474 px (reduce `cell-name` to ~150,
`cell-status` to ~120 and `cell-actions` to ~170), hide Status below 800 (Cards carries it), or
keep the Actions cell sticky at every width. Re-measure rest and scrolled at 375/768/820/1440.

### 3. "Checked just now" has no subject and no absolute time (FAIL)
Severity: medium — Trust.

What a person sees: the Storage toolbar says only “Checked just now”. It is not labelled as the
mount table, the update check or the helper. In helper-down the status line separately says
“Helper isn't running. Last update 06:39 AM.” while the toolbar still says “Checked just now”,
so two time readings from one source appear together. There is no title or accessible name.

Evidence: DOM is `<span class="checked-line">Checked just now</span>` inside `.storage-toolbar`
(no `title`/`aria-label`); `storage-1440-light.png`, `engine-down-375.png`; normal-state
`flows-c.json` (`checked: "Checked just now"`). Normal-state presence was verified; the round-7
request asked for a last-checked time, and this is present but not self-describing.

Why it fails: Trust asks for time **and what was verified**. A skeptical owner cannot tell what
this timestamp proves. It also duplicates the helper-down “Last update” reading.

Smallest fix: “Storage list read just now” with a title such as “Last read 06:40 AM. Press ⌘R to
re-read.”; use one time source, and keep the helper's absolute time in the same labelled line.

### 4. Undo restores a mounted share as Not mounted and does not say so (FAIL)
Severity: medium-low — Trust / Usage flow.

What a person sees: from the sample, Studio NAS is Mounted. Remove it from the row menu, confirm,
then click Undo. The toast says “Restored Studio NAS.” but the row returns as **Not mounted**, the
path is gone and the status line reads “3 storages, none mounted…”. The user has to notice this and
click Mount now.

Evidence: `undo-restored-820.png`; `flows-a.json` (`undo.statusline` = “3 storages, none mounted,
1 needs attention, 1 unreachable.”; `active` returns to the row menu). The same happens when
removing from the editor (`flows-f.json`).

Why it fails: the item's life is not restored to the state it had; “Restored” claims more than the
row shows without naming the lost mount. The action is traceable but not self-proving.

Smallest fix: either remount with the saved credentials and show Mounted/Needs attention, or make
the toast and row say “Restored Studio NAS. It is not mounted.” Do not leave the owner to infer it.

### 5. Focus after Save at 375 is on an off-screen control (low)
Severity: low — Craft (focus visibility).

What a person sees: after Return-saving a new storage at 375, the list scrolls the new row and toast
into view, but focus stays on **Add storage**, now at y=-349..-321 (main scrollTop 412). The focus
ring is off-screen. `Tab` then moves on from an invisible place.

Evidence: `flows-e.json` (`add375saved.active` = `add-storage`, box y=-349; `doc.sh` 882),
`add-saved-375.png`, `add-saved-375-scrolled.png`.

Why it fails: bar 9's literal “focus never falls to BODY” passes, but bar 11 asks for focus
visibility, and the user's last action leaves the visible focus somewhere else.

Smallest fix: after a save, focus the new row's primary action (or its menu button) and keep it in
view, or leave the header visible so the Add button's ring is still on screen.

## Round-7 findings re-walked

| Round-7 finding | Result at 158349f |
|---|---|
| 1. Missing-disk editor says “connected now” | **Fixed.** Editing SSD and an injected genuinely-missing volume both show the disk field as “Saved disk — …” with “Editing SSD isn't connected. Reconnect it, then reopen this window.” (`edit-missing-disk-820.png`, `edit-missing-volume-injected.png`). |
| 2. 375 Table has no visible row action | **Fixed at 375** (menu 318..346, screenshot `storage-375-table-light.png`). **Not fixed at 768**: menu clipped, see finding 2. |
| 3. Check for Updates drops focus to BODY | **Fixed.** Active element is `BUTTON[check]` before, during (`aria-disabled="true"`, `aria-busy="true"`, not `disabled`) and after (`update-checking-820.png`, `flows-c.json`). |
| 4. Preview duplicate removal leaves the duplicate | **Fixed.** An injected `×2` pair removed both entries; after the remove command only the unrelated row remains (`duplicate-group-820.png`, `duplicate-removed-820.png`, `flows-d.json`). |
| 5. Helper-down adds a 20 px page scroll | **Not fixed.** 375 = 832 vs 812; 820 = 731 vs 640; normal add at 375/820 also overflows. See finding 1. |
| 6. No normal-state last-checked time | **Partial.** “Checked just now” is present, but unlabelled and duplicated by the helper-down absolute time. See finding 3. |
| 7. Row menu wraps at 768/820 | **Fixed at 820** (menu 751..779, 28 px, same row as the primary; `table-820-rest.png`). **Not accepted at 768** because the menu is clipped horizontally (finding 2), not wrapped. |
| 8. Version pill has no icon | **Fixed.** The pill contains the drive icon and names “What's New, Storage Studio KH v0.1.10”; all footer entries have icons (`storage-1440-light.png`, `flows-*.json`). |

## Completeness gates

### 1. Task list — walked end to end in this review

| Job | Result |
|---|---|
| Add an SMB share | Pass. Return saves; toast “Added … Mount now”; row and status line update; new row scrolled clear of toast. At 375 focus lands off-screen (finding 5). |
| Add an attached disk | Pass. Attached disk shows the connected volumes and mount point; “Added Backup Disk” + row; `save_storage` invoked. |
| Browse a device and pick a share | Pass. Real names, host named, encoded target, Escape dismisses the picker first and returns focus to the address field. |
| Reject an invalid address | Pass. Host-only, `http://`, `smb://` empty and plain text keep Save off with a named reason; a complete address enables it. |
| Mount | Pass. Row shows Mounting…/Connecting…, the button disables, then Mounted with the path; credentials prompt appears when needed. |
| Unmount | Pass. Row becomes Not mounted; focus moves to Mount now. |
| Test without mounting, repeat | Pass. An unmounted Archive reports “archive.local is reachable and ready to mount.” without mounting; a second Test replaces the same toast; mounted Test names the path. |
| Edit name and flags | Pass. Save updates the row and toasts; no connected-share rows appear in Edit. |
| Reconnect at login / after wake | Pass. Uncheck/check saved as “No login · after wake” (copy observation: “No login” is awkward; `No login`/`Login · Wake` in Table). |
| Remove + Undo from the row menu and editor | Pass for entry removal and focus; mount state not restored (finding 4). |
| Credentials prompt | Pass. Escape returns focus to the row menu; saved password says “Password saved. Trying …”; the Trying note ends when the share answers; failure path names “couldn't save the password” and keeps focus in the password field. |
| Forget a saved password | Pass. Checkbox disables the password field; toast names the forgotten password; the option is gone afterwards. |
| Cards / Table switch | Pass for the control and `set_list_view`; focus stays on the radio. Persistence across a real restart is not checked. |
| Duplicate handling | Pass. Exact, `:445`, query and `/./` forms keep Save off with the existing name; injected legacy duplicates show one row with ×2 and removal clears both. |
| Group warnings | Pass. Two groups with counts and Show; Show scrolls the row into view and focuses its primary. |
| Helper down → restart | Pass. Banner names the cause, Restart helper invokes, banner clears, “Helper started.”, focus on Storage; footer defect remains (finding 1). |
| Check for updates / What's New / Support | Pass for the visible controls and command dispatch (`check_updates`, `open_updater`, `open_support`); update offer 0.2.0 is kept; What's New opens with focus on Close and Escape returns focus to the pill. External effects not checked. |
| General settings | Pass. Notifications toggles, retries 1–8 saves 5, launch-at-login error names the System Settings path and the checkbox is off. |
| Appearance System / Light / Dark | Pass. Exactly three choices; arrow keys select Light then Dark, theme applies live and focus stays on the chosen radio. |

### 2. Capability cross-check

Every declared capability has a reachable control in the headless surface: kinds, address +
Browse, name/mount point, credentials + forget, mount/unmount, Test, Open in Finder, Edit/Remove,
reconnect flags, six status labels, helper banner/restart, updates/What's New, Support,
System/Light/Dark, Cards/Table, notifications/login/retries, second-instance notice, dedupe ×N.
The only access failure is layout, not a missing control: the Table row menu at 768 (finding 2).
External effects (Open in Finder, donation page, update download, menu-bar item) were not observed.

### 3. Standard comparison (Finder Connect to Server, AutoMounter)

Present: server address + browse, per-server saved credentials (private file, never Keychain),
saved servers add/edit/remove, per-server status in words, mount/unmount/reveal, reconnect at
login/after wake, notifications/login/retries, menu-bar actions described by the app. Recorded
deliberate absences remain: search/filter until the list grows (~12 rows), page-level Mount all
(the tray has it), copy/sync/bandwidth, NFS/AFP/WebDAV, Keychain. No missing control was found
beyond the clipped row menu at 768.

## Not checked (not passed)

- Real SMB mounting/unmounting, helper IPC, menu-bar item, notifications, login/wake behavior,
  Open in Finder, the real 0600 secrets file, the download/install handoff and the donation page.
  The headless URL is a dev fixture.
- Whether the shipped Rust/helper `remove_storage` clears duplicate identities at runtime; only
  the preview fixture was exercised (it now removes all identity matches).
- Cards/Table persistence across a real app restart; the preview resets on reload.
- Reload with cached metadata; the preview has no cache and rebuilds the fixture on reload.
- The `retrying` state, and a real mount failure after saving credentials (the fixture mounts
  successfully after credentials; provider-offline was modelled only through `engine-down`).
- Download button / donation button external effects (their commands dispatch).
- Native gate, DMG build, served-feed readback and installed-app behavior; the release record
  itself lists these as pending, and this review did not run them.
- The acceptance self-report (289/289) and contrast report were not treated as evidence. I measured
  contrast from rendered styles myself: light ratios 5.10–16.33, dark 6.02–12.60 across body,
  muted, quiet, chips, primary, active nav and footer; focus ring is 2 px accent with 2 px offset.
- Network: no provider calls; only local Vite modules. Console: no errors. The dev preview exposes
  no skip log, so “every skip logs a reason” could not be checked in this surface.

## What must change before a fresh critic reviews again

1. Fix the root-scroller overflow from screen-reader spans; prove document height equals the
   viewport at 375/768/820/1440 in normal, after-add, empty and helper-down, with footer and toast
   boxes recorded.
2. Fit the Table columns (or hide Status) so the row menu is fully visible at 768 with zero
   horizontal overflow; re-measure rest and scrolled at all four widths.
3. Label the last-checked line, name what was checked, and use one time source.
4. Make Undo either remount and show the resulting state, or say plainly that the entry came back
   but the mount did not.
5. Keep the focus ring on a visible control after saving at 375.
6. Do not ship on the pending native gate, DMG, served-feed readback and installed-app checks;
   those remain unverified, not passed.

## Evidence index

`tests/acceptance/critic/round8/`: `storage-*` (four widths, both views, light and dark),
`table-768-rest.png`, `table-768-scrolled.png`, `add-saved-375(-scrolled).png`,
`add-saved-820-scrolled.png`, `engine-down-375(-scrolled).png`, `engine-down-820(-scrolled).png`,
`engine-overflow-*.png`, `edit-missing-disk-820.png`, `edit-missing-volume-injected.png`,
`credentials-*.png`, `duplicate-*.png`, `remove-*.png`, `undo-restored-820.png`,
`update-checking-820.png`, `update-after-820.png`, `whats-new-820.png`, `empty-*`, `boot-*`,
`general-*`, `appearance-*`, `support-*`, `browse-*`, `dark-*`, `focus-ring-375.png`,
`long-name-*`, `provider-offline-820.png`, `second-instance-820.png`, and `flows-a..f.json`
(DOM, geometry, focus and command traces).

Skills used: ponytail · efficient-orchestration · graphify queries: none — no Storage Studio graph exists
