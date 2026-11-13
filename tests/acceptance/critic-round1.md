# Storage Studio KH 0.1.9 — critic round 1

Date: 2026-11-13 · Critic: independent (did not build) · Surface: Vite preview http://localhost:1420/ driven by headless Chromium only (no visible window, no desktop input).
Screenshots: `tests/acceptance/critic/round1/` (66 page/state captures at 375x812, 768x900, 1440x900 in light and dark, plus `flow-*`, `stress-*`, `kb-*`). Scripts lived in the session scratchpad and are not part of the repo.

## Verdict: FAIL

| Area | Score |
| --- | --- |
| Usability | 3/4 |
| Usage flow | 2/4 |
| Functionality | 2/4 |
| Craft | 2/4 |
| Trust | 3/4 |

## Defects (most severe first)

1. **Functionality, high: a duplicate storage can be saved.** Open Add storage. Enter Name `Studio NAS` and address `smb://nas.local/studio`, both of which already exist. The save reason is empty and Save is enabled. This breaks "never mount twice" and leaves two rows for one share. Smallest fix: block Save when the address (or the volume UUID) matches an existing storage, and name the existing storage in the save reason.
2. **Functionality/Usability, high: "helper isn't running" leaves the person with no next step.** Repro: `#engine-down=1`. The banner reads "The background helper isn't running / The helper stopped responding." and contains no button and no instruction. Every row action (Unmount, Test, Mount now) is disabled, and the only reason is a `title` tooltip on a disabled button, which does not appear on keyboard focus and often not on hover. The status line still reads "1 of 3 storages mounted, 2 need attention." as though it were live. Screenshot: `storage_engine-down_1-dark-1440.png`. Smallest fix: put one action in the banner, such as Restart helper (or the plain step "Quit and reopen Storage Studio KH"), and add the helper state to the status line.
3. **Craft, high: keyboard focus drops to the page body after every settings change.** On General, click or press Space on the Notifications or Launch at login toggle, and `document.activeElement` becomes `BODY`. On Appearance, focus Light and press ArrowRight: Dark is selected and focus becomes `BODY`, so a second arrow press does nothing. A keyboard user loses their place on every change. Smallest fix: after the snapshot re-render, restore focus to the element with the same `data-fk`.
4. **Usage flow, high: adding a storage gives no terminal feedback.** At the real 820x640 window, fill Add storage and press Return. The sheet closes, nothing is announced, and the new row is placed below the fold (top at y=617 of 640) as "Not mounted". No mount is attempted, and there is no toast and no scroll or highlight. Screenshot: `flow-after-add-complete-820.png`. Smallest fix: scroll to the new row, highlight it, and toast "Added <name>." with Mount now (or mount it when Reconnect at login is on).
5. **Usage flow/Trust, high: saving credentials gives no result, and the row stays stale.** Click Test on Archive Share. The "Sign in to Archive Share" prompt opens. Enter a user and password and press Return. The prompt closes with no message. The row still says "Needs attention / Sign in to this share to continue." and the toast "Test: Sign in to this share to continue." is still on screen. In the UI, `saveCredentials()` simply closes the prompt. Whether the real helper retries afterwards was not checked. Smallest fix: after a successful save, show "Saved. Trying <name>…", start a test or mount, and clear the stale detail.
6. **Craft, medium: the Download button crosses the sidebar edge.** At every sidebar width (768, 820, 1440) the "Download version 0.2.0" button measures left 201 / right 225, while the sidebar ends at 220. The green disc is cut by the sidebar border. Screenshots: `storage-light-1440.png`, `general-light-1440.png`. Smallest fix: reduce the footer row gap, or let the pill shrink so the row fits in 220 - padding.
7. **Functionality, medium: invalid Retries values are rejected silently.** On General, the Retries field reverts `9`, `0`, empty and `-2` to the previous value with no message, and changes `3.5` to `4` without saying so. Smallest fix: clamp to 1–8 and show an inline note such as "Retries go from 1 to 8; set to 8."
8. **Usage flow, medium: Escape and Cancel throw away typed edits without asking.** In Edit storage, change the name and press Escape: the sheet closes and the change is lost. The 0.1.9 notes call losing typed input a bug, but they only fixed clicks outside the sheet. Smallest fix: when the form is dirty, Escape asks "Discard changes?" in-app, or keeps the draft until it is reopened.
9. **Trust, medium: Remove is permanent.** Remove asks for confirmation, then deletes the storage definition (what happens to its saved password was not checked). There is no Undo and no restore. The owner standard is "nothing deleted for good". Smallest fix: show an Undo toast for about 10 s, or keep a Recently removed entry that can be restored.
10. **Usability, medium: Add storage opens in an error state, and its placeholders read as values.** On open, the empty Name field is already `aria-invalid=true` with a red border, and the footer says "Give this storage a name." before anything has been typed. The placeholder "Studio NAS" is the name of an existing storage and looks like a filled value. The address and mount point placeholders (`smb://studio.local/photos`, `/Volumes/studio`) look the same way. Screenshot: `flow-add-820x640.png`. Smallest fix: show the error only after the person edits the field or tries to save, and use "e.g." placeholders that cannot be mistaken for data.
11. **Craft, medium: content is clipped and squeezed at 375.** A storage with a long unbroken name has its name cut off at the card edge, with no ellipsis and no title. `UL.storage-list` measures scrollWidth 468 against clientWidth 341 with overflow hidden. The "Mounted at" label holds a narrow column while the path wraps over 5 lines beside it. In Edit at 375, the password placeholder is cut off ("…leav"). Screenshots: `stress-upd-checking-375.png`, `storage_edit_studio-nas-dark-375.png`. Smallest fix: `overflow-wrap:anywhere` on names and paths, the path on its own line under the label at narrow widths, and shorter placeholder copy.
12. **Craft, medium: density and use of width are below the category bar.** Each storage takes about 157 px of height, so the 820x640 window shows 3 rows and a list of 30 is about 4,700 px tall. At 1440, each row's text and actions sit in the left 40% and the rest of the row is empty except for the chip. Smallest fix: a compact two-line row (name + chip + detail on line 1, path + reconnect facts + actions on line 2) with actions right-aligned.
13. **Functionality, low: the address error names the wrong cause.** `http://nas/x` gets "Add the share name to the address…", but the actual problem is the scheme. Smallest fix: say "Use an smb:// address" when the scheme is not smb.
14. **Trust, low: summary and chips use different words.** The status line says "2 reconnecting" while the chips say "Mounting…" and "Retrying…". It says "2 need attention" when one row is "Needs attention" and one is "Unreachable". Smallest fix: use the chip vocabulary in the status line, or say "2 need attention (1 unreachable)".
15. **Usability, low: launch at login errors have no recovery step.** "macOS refused the login item: Operation not permitted. Launch at login is currently off." names the cause but not what to do next, such as opening System Settings > General > Login Items. Screenshot: `stress-login-error-general-820.png`.
16. **Usability, low: the retry note contradicts the setting.** The note fixes three delays ("5 s, 15 s and 60 s") while the setting allows 1–8 retries. It does not say what tries 4–8 wait.
17. **Accessibility, low: row buttons are named only "Test", "Edit" and "Mount now",** with no storage name in their accessible name. Arrow keys do not move between sidebar sections.
18. **Preview fidelity, low: the preview's What's New skips 0.1.8,** going 0.1.9 → 0.1.7. `src-tauri/whats-new.json` does contain 0.1.8, so this is a fixture gap and not an app defect. Fix the fixture so evidence screenshots match what ships.

## What holds (measured)

- No document-level horizontal overflow on any page, state or dialog at 375/768/1440 in either theme (scrollWidth equals the viewport in all 66 captures).
- The footer is pinned at every width, and dialogs stay inside the window (820x640: Add 8–632, Edit 8–632 with its body scrolling 525/504).
- Contrast is at least 4.5:1 for all enabled text and placeholders in both themes. Only disabled controls fall below (2.54 light, 3.03 dark).
- Every Tab stop shows a 2px focus outline. Dialogs are native modal and return focus to their opener on Escape.
- Escape: it closes Add, What's New and the credentials prompt; dismisses Browse results first; and returns from the Remove confirmation to the editor. Keep also returns to the editor.
- Return saves a complete Add form. A click outside does not close the sheet.
- Mount now shows Mounting…, then Mounted, and the status line updates. Unmount shows Not mounted with Mount now. Check for Updates goes from "Checking for updates…" to "Up to date". The 503 failure is named in the footer.
- The empty state, boot error (with a working Retry) and second-instance toast (about 10.6 s) each name a next step. Appearance is exactly System/Light/Dark. No native dialogs fired in any flow.

## Not checked

- Native behaviour: ⌘W hide, ⌘Q quit, edit shortcuts in the WKWebView, menu-bar reopen, the real window frame, and System appearance following macOS.
- The real helper after credentials are saved, real mount/unmount/retry timing, and the real update download.
- VoiceOver announcements. Only the accessibility tree was read.
- The real app's What's New rendering. Only the JSON was read.

## Before round 2

Fix 1–12. A fresh critic then re-walks: the duplicate add, helper-down recovery, keyboard focus after toggles and theme changes, Add feedback at 820x640, the credentials result, the sidebar footer geometry at 768/820/1440, Retries validation, the dirty-form Escape, Remove undo, the Add sheet's initial state, the 375 long-name stress test, and row density at 820x640.
