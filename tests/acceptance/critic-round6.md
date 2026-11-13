# Storage Studio KH 0.1.10 — fresh critic, round 6

Reviewer: independent studio critic. Did not design or implement this release.
Commit: 86c93af (round-5 fixes at 70be339). Dev URL: http://localhost:1420/ (Vite, headless).
Browsers: Chromium 1248 via Playwright 1.64 (music-studio-kh node_modules). No visible app window was opened.

## Verdict: FAIL

| Area | Score /4 | Basis |
|---|---|---|
| Usability | 2 | Table view is unreadable at 375, 768 and 820; status/address hidden under pinned cells. |
| Usage flow | 3 | Add/mount/test/edit/remove+undo work; Remove is absent from the row menu and forget-password names no result. |
| Functionality | 3 | Live data true and updates; Edit's connected-share "Add" silently retargets the open storage; duplicate detection misses default port/query/dot forms. |
| Craft | 2 | Content clipped under pinned columns at three widths; otherwise contrast, focus rings, dialogs and tab containment hold. |
| Trust | 3 | Version/update/test/mount path are visible; no last-checked time and no path for the credential file. |

Any area below 4 fails this release. The deciding defect is the Table view (Craft and Usability).

## Method

Walked through the headless URL: empty first run; add share; duplicate forms; mount/unmount;
Test (including repeat); edit/rename; remove + undo; credentials (empty save, Return save);
forget password; helper restart; view switch; updates/What's New; second instance; boot failure.
Measured DOM/geometry at 375×812, 768×900, 820×640, 1440×900 in light and dark, Cards and Table.
Tabbed through the page and every sheet, checked focus rings, Escape ordering, row-menu arrows/
Home/End, and focus after timed toasts. No network provider calls exist in this preview: only
Vite module requests; all state comes from the local dev fixture.

## Defects (most severe first)

### 1. Table view hides or clips the data columns — 375, 768, 820 (FAIL)
Severity: critical (Craft / Usability).

What a person sees:
- 375: the table is only "Storage" and "Actions". Status, address, mount point and reconnects
  are never visible, even after scrolling fully right.
- 768: the Address header is shown but every address value is blank; Actions covers them.
- 820: Address shows "smb:" (and on Archive a wrapped "kuops"); scrolled right, the header reads
  "ounted at" and the value reads "olumes/ studio". Mounted-at/Reconnects are covered.
- 820 scrolled right: screenshot `table-light-820-scrolled-right.png`; 768:
  `table-light-768-rest.png`, `table-light-768-scrolled-right.png`; 375:
  `table-light-375.png`, `table-light-375-scrolled-right.png`.

Measured (820): wrapper 526 px wide for an 873 px table. Pinned Storage cell 265–445; pinned
Actions cell x=634.58–791, width 156.42. Address cell 595–775 → only 39 px remains visible.
Mounted-at 775–861 lies under Actions. Measured (768): Actions cell begins at x=582.58, Address
at x=595 → Address is entirely under Actions. Measured (375): Storage pinned 17–197, Actions
201.58–358, leaving 4.6 px of the middle columns. The Actions header is not visible at 768/820.

Why it fails: bar 2 requires "lists fit or scroll (table keeps its first column pinned and
Actions visible)" and bar 11 "nothing clipped". The scroll exists but the pinned columns overlap
and hide other values at rest and while scrolling; a visible value is cut mid-token.

Smallest fix: at <900 px drop Mounted-at and Reconnects from the table and let Address use the
remaining width; at <600 px render each table row as a two-line row (name + status, then actions)
or make Table fall back to Cards. Keep Storage pinned and Actions visible. Re-measure at all four
widths, scrolled and unscrolled, and require zero cell overlap.

### 2. Edit → "From a connected share → Add" silently retargets the open storage
Severity: high (Functionality / Usability).

What a person sees: open Edit for Studio NAS, click "Add" beside
"Public Space-Media - 4TB - Music". The dialog stays "Edit storage", the name stays "Studio NAS",
the address becomes `smb://studio@nas.local/Public%20Space-Media%20-%204TB%20-%20Music`, and Save
is enabled (screenshot `edit-connected-add-retargets.png`).

Why it fails: the control says "Add" but mutates the current storage's target; saving produces a
row whose name and share disagree, with no warning. It violates "every action true" and plain
copy naming the action.

Smallest fix: hide the connected-share picker in Edit (it belongs to Add), or relabel it
"Use this share" and update the name, or require an explicit replace confirmation.

### 3. Remove is not in the row menu
Severity: medium (Usage flow / bar 4).

What a person sees: the "…" menu on a mounted row contains Unmount, Test, Edit; on an unmounted
row Test, Edit. Remove exists only at the bottom-left of the Edit dialog (confirmation and Undo
are good: "Remove Editing SSD", "Files stay where they are", Undo restores and focuses the row).
`tests/acceptance/completeness-0.1.10.md` §1 says Remove is in the row menu; it is not.

Why it fails: bar 4 says the row's remaining actions live in the row menu; Finder/AutoMounter
users look there for remove/eject.

Smallest fix: add Remove to the row menu (reuse the existing confirmation) or correct the
completeness record if Edit-only is the deliberate design.

### 4. Forget password saves with a generic "Saved Studio NAS." toast
Severity: medium (Usage flow / Trust).

What a person sees: tick "Forget the saved password" in Edit, Save → toast "Saved Studio NAS."
Reopening Edit shows the checkbox and the saved-password state gone, but the toast never says the
password was forgotten. Screenshot `forgot-password.png`.

Why it fails: the terminal feedback does not name the action that changed the credential state;
the owner must reopen the editor to prove it.

Smallest fix: when `forgetPassword` is set, toast "Forgot the saved password for Studio NAS." (or
include it in the save result).

### 5. Duplicate protection misses semantically identical addresses
Severity: low–medium (Functionality).

Verified duplicates blocked and named "Studio NAS": trailing slash `smb://nas.local/studio/`,
`%73tudio`, host/share case (`smb://NAS.LOCAL/STUDIO`, `smb://nas.local/Studio`), `%2F`, and a
different user. Uppercase scheme `SMB://…` is refused with an explicit "Use an smb:// address".
Not detected (Save enabled): `smb://nas.local:445/studio`, `smb://nas.local/studio/?x=1`,
`smb://nas.local/./studio` — each creates a second row for the same share.

Why it fails: two entries can be added for one share despite the "already added" protection.
Smallest fix: normalize default port 445, strip query/fragment, and resolve dot segments before
the duplicate check.

### 6. Repeated Test stacks identical toasts
Severity: low (Usage flow).

Two Test actions produced two identical "Test: Connected at /Volumes/Archive Share." toasts at
once; both time out together. The result is true but the stack reads as two events where one
current result would do. Smallest fix: replace an existing toast with the same key/title.

### 7. Focus after a focused Undo toast times out to `<main>`
Severity: low (Craft).

After removing Editing SSD, focus moved to the toast's Undo button (good). At ~12 s the toast
expired and focus became `<main>` (tabindex −1), not BODY. This is an internal container with no
visible focus ring; the next Tab restarts from the first content control. Not the round-5 BODY
failure, but still a focus drop. Smallest fix: return focus to the toolbar Add storage button or
the next surviving row's primary control before removing the toast.

### 8. No last-checked time; helper-down rows still read "Mounted"
Severity: low (Trust).

The helper-down baner is clear and Mount/Test are disabled, but the rows keep "Mounted" chips and
"Connected as studio." with no "as of" indication, and nowhere does the UI state when the state
was read. The credentials dialog says "the app's own data folder" but never gives the path.
Smallest fix: put a quiet "Checked just now / 2 min ago" on the status line and name the data
folder (read-only path) in the credentials copy or Support.

## Round-5 items re-walked (all measured)

- Editor Test focus: stays on Test; toast "Test: Connected at /Volumes/studio." visible; PASS.
- Duplicate forms: trailing slash, %-escape, case, user all blocked and name Studio NAS; PASS
  (exceptions in defect 5).
- Boot error focus/dead nav: `#fail-boot=1` shows one screen, Retry focused, no dead nav; PASS.
- Table Actions hidden at 768/820: Actions are now visible, but they cover Address/Mounted-at
  (defect 1); the round-5 symptom is gone, a worse clipping symptom replaced it.
- Focused Undo timeout: no longer BODY; goes to `<main>` (defect 7).
- 375 toast over footer: Undo toast bottom 708.0 vs footer top 708.16; Add toast same; no
  overlap (touching, zero gap). PASS.
- Remove copy: explicit what/where/what-stays, Keep is the focused safe default, Undo restores
  and focuses the row; PASS (location issue in defect 3).
- Row menu arrows/Home/End, Escape, outside click: PASS. Heading accessible name is once
  ("Studio NAS, SMB share"); the visible kind and sr-only span do not double in the a11y tree.

## Other checks that passed

- Card view at 375/768/820/1440: no horizontal overflow, footer pinned, actions visible.
- Empty state: one Add storage action, names the next step; no duplicate control.
- All sheets inside the window at 375/768/820/1440; bodies scroll when tall (What's New 1953 px
  body in 676 px at 375; Edit at 820 body 550/504); no unreachable button.
- Escape order: Browse results dismissed first, then discard confirmation, then close.
  Return saves Add/Edit. Tab stays inside sheets. Row menu opens on Enter with a visible ring.
- Focus rings: solid 2 px on every tab stop in light and dark.
- Contrast measured (computed colour vs nearest opaque ancestor): no text or placeholder below
  4.5:1 in light or dark on Storage, General, Appearance or the Add sheet.
- Check for Updates: line shows "Checking for updates…" then the result; What's New pill opens,
  closes with Escape, focus returns to the pill. Second-instance toast appears.
- Unmount/remount updates the row, chip, primary action and the status line immediately.
- Helper restart: toast "Helper started.", banner clears, nav usable while down.

## Not checked (stated as not checked)

- Real SMB mounting, Finder reveal, helper IPC, menu-bar item and notifications on macOS. The
  headless URL is the dev fixture; no provider/network calls were made.
- Cards/Table persistence across a real app restart: live switching and the set_list_view call
  work; a reload of the preview resets the fixture to Cards, so persistence is not proven.
- Duplicate-row dedupe with a ×N count: no duplicate data in the fixture and the form blocks
  exact duplicates, so the dedupe path was not exercisable.
- Download icon's external effect: it has a correct accessible name; no in-app result is shown
  and the OS handoff cannot be observed headlessly.

## What must change before a fresh critic reviews again

1. Make Table readable at 375/768/820: no pinned-cell overlap, no address clipped mid-token; keep
   Storage pinned and Actions visible; measure all four widths, unscrolled and scrolled.
2. Fix the Edit connected-share control so it cannot silently retarget the open storage.
3. Put Remove in the row menu (or record Edit-only as deliberate in the completeness record).
4. Name the forgotten credential in its toast; stop stacking identical Test toasts; return focus
   to a real control after an Undo toast expires.
5. Add a last-checked indication and the credential-file location for trust.
6. Re-run the completeness doc against the UI; its §1 Remove location does not match the build.

Evidence: screenshots in `tests/acceptance/critic/round6/`; acceptance self-report was read but
not accepted as evidence.
