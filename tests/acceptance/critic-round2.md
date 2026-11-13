# Storage Studio KH 0.1.10 — critic round 2

Date: 2026-11-13 · Fresh independent critic (did not design, build or fix this work)
Surface: Vite preview `http://localhost:1420/` in headless Chromium (Playwright), 375x812,
768x900, 820x640, 1440x900, light and dark. No visible window, no pointer or keyboard input
on the owner's desktop, no live app data and no activation.
Screenshots: `tests/acceptance/critic/round2/` (95 captures, listed throughout).

## Verdict: FAIL

| Area | Score /4 | Basis |
| --- | --- | --- |
| Usability | 4 | Every page answers what this is, what happened and the next action. One status line, one primary action, no duplicate pages. |
| Usage flow | 3 | Add/edit/remove/undo are traceable and Add now gives a result, but Escape can silently discard typed edits and repeat Test has no terminal result. |
| Functionality | 4 | Duplicate shares, `http://`, helper-down, boot failure and update failure are correctly blocked, named and actionable. No silent failure was found in the app logic. Preview-fixture falsehoods are recorded under Trust (F4), not scored as app functionality. |
| Craft | 3 | Layout, density, width use, contrast, focus rings and icons are strong; dialog focus is lost on several paths and the 375 tab order is illogical. |
| Trust | 3 | Paths, causes, undo and version are visible, but the release note "asks before discarding" is false on one path and the preview cannot prove the password/Test outcomes. |

## Findings (most severe first)

### F1. Usage flow / Trust, high — Escape after the discard prompt closes the editor and loses typed edits without asking

A person can lose the whole storage edit with no confirmation.

Repro at 820x640 (`#view=storage`):
1. Click **Edit** on Studio NAS. Replace Name with `Studio NAS renamed`.
2. Press Escape. The in-app **Discard changes?** sheet appears (correct).
3. Press Escape again. The editor comes back, but focus is `BODY`, not a field. The name stays
   `Studio NAS renamed`.
4. Press Escape once more. The sheet closes. Reopen **Edit**: Name is back to `Studio NAS`.
   The edit is gone and no discard was asked.

Measured: after step 3 `document.activeElement` is `BODY` in 5/5 runs; after step 4 the dialog
is closed in 3/3 runs. With a faster second Escape (150 ms) the sheet closed on the second press
in one run. The first Escape and the **Cancel** button do ask; the path after returning from the
prompt does not.

Evidence: `flow-discard-prompt-820.png`, `kb-esc3-data-loss-820.png`,
`kb-reopen-after-loss-820.png`.

Why it fails: the studio bar and the product accessibility outcome require Escape to ask before
discarding typed edits; the shipped What's New note says the same. On this path it silently
discards them.

Smallest fix: when returning from the discard prompt, focus the name field again and handle
Escape through the editor's own keydown path so every close attempt reaches
`requestCloseEditor()` while the form is dirty. Add a regression check for Escape, Escape,
Escape and for a fast double Escape.

### F2. Craft / accessibility, high — focus falls to `BODY` after several dialog transitions

Keyboard users lose their place after ordinary actions.

Repros, all at 820x640; `document.activeElement` measured after each:
- Edit Studio NAS -> change a field -> **Cancel** -> **Keep editing**: focus is `BODY`; no visible
  focus ring anywhere. `kb-focus-lost-keep-editing-820.png`.
- Add storage -> enter an address -> **Browse…** -> Escape (dismiss results): results are gone and
  the sheet stays open, but focus is `BODY`. `kb-focus-lost-browse-820.png`.
- Edit Archive -> **Remove** -> Escape (return to editor): editor stays open, focus is `BODY`.
  `kb-focus-lost-remove-820.png`.
- Test Archive Share -> credentials sheet -> Escape: prompt closes, focus is `BODY`.
- Add a complete storage with Return: sheet closes, focus is `BODY`; the toast has the only action.

Why it fails: every control is reachable, but after these transitions the next Tab starts from the
top of the window, and this lost focus is what makes F1 possible.

Smallest fix: restore focus after every render/close using the same `data-fk` pattern already used
for General/Appearance. Specifically: Keep editing -> Name; Browse dismissed -> Browse button or
Target; Remove Escape -> Remove button; credentials close -> the row Test button; Add saved ->
the new row's Edit or the Add storage button.

### F3. Craft, medium — at 375 the Tab order jumps from the top nav to the footer, then back up to the content

Measured at 375x812 (`#view=storage`): Tab order is
`nav-storage@y8 -> nav-general@y8 -> nav-appearance@y8 -> nav-support@y717 -> pill@y755 ->
check@y757 -> download@y757 -> add-storage@y63 -> row Unmount@y293 ...`

The page is visually Nav (top), main content (middle), footer (bottom), but the DOM puts the
sidebar footer before `main`, so keyboard focus goes to the bottom bar and then back to the page
title/primary action.

Why it fails: keyboard navigation does not follow the visual order and puts the primary action
after the footer. Evidence: DOM order and the measured y positions above.

Smallest fix: move the footer after `main` in DOM order and keep it pinned with the existing grid
layout, or give the narrow breakpoint an explicit focus order. Re-measure the Tab sequence at 375.

### F4. Trust / preview fidelity, medium — the evidence surface shows states that contradict the action

Three preview behaviours do not match the helper (checked by reading the shipped helper code, not
claimed as passing):
- **Test Editing SSD** leaves the chip **Unreachable** and the row text "Editing SSD is connected."
  at the same time, plus the toast "Test: Editing SSD is connected."
  `flow-test-contradiction-820.png`. The helper's `test()` sets `Not mounted` with "The disk is
  connected and ready to mount."
- **Saving the Archive password** shows "Password saved. Trying Archive Share…" while the row keeps
  "Needs attention / Sign in to this share to continue." for the toast's whole 8 s.
  `flow-credentials-saved-820.png`, `flow-credentials-1.5s-820.png`.
- **Mount now on Archive** (no saved credentials) mounts successfully in the preview instead of
  asking for a password; the preview's **Test** opens the credentials prompt, which the helper's
  `test()` does not do (it only checks the host).

Why it fails: a skeptical owner cannot prove the password or Test outcome from this release
evidence; the acceptance report's credential checks are built on states the shipped helper never
produces.

Smallest fix: make the dev fixture apply the helper's state transitions (Test -> `not_mounted` plus
"connected and ready"; credentials -> `mounting` then `mounted`/failure; mount without credentials
-> `needs_credentials`). Alternatively record the native flows as unproven and test them on the
packaged app.

### F5. Usage flow, low — a repeat Test has no terminal feedback

Repro: click **Test** on the mounted Studio NAS, wait 6.5 s for the toast to clear, click **Test**
again. No toast appears; the row still says "nas.local is reachable." and the button returns to
"Test". Evidence: `flow-test-repeat-820.png`, DOM text before/after.

The helper's `set()` returns without emitting when status, detail and path are unchanged, so in the
packaged app the button can sit on "Testing…" for the UI's 15 s fallback with no result message.

Why it fails: the action has an immediate state but no terminal result. Smallest fix: always
announce a test result ("Still reachable at …") or emit an explicit test-result event.

### F6. Craft / usage flow, low — Add at 820 puts the new row on the bottom edge under the toast

Measured after Return on a complete Add form at 820x640: new row top 537, bottom 640 (window bottom
640), class `is-new`; the toast covers the row's action row. `flow-after-add-820.png`.

The row is no longer below the fold, and the toast offers Mount now, but the row's own actions are
obscured and the row has no bottom breathing room. Smallest fix: scroll the new row clear of the
toast and add bottom padding to the list.

### F7. Craft, low — the share-address placeholder is still clipped at 375

Measured in Add at 375x812: the target input is 191 px wide; "e.g. smb://studio.local/photos" is cut
to "e.g. smb://studio.local/photo" with no ellipsis. `flow-add-375-light.png`,
`flow-add-375-dark.png`.

Long names, the mounted path and the password placeholder now fit (verified with an injected
87-character name at 375). Smallest fix: shorten the example or let the hint wrap.

### F8. Craft / accessibility, low — sidebar arrow keys do nothing

Focus Storage in the nav and press ArrowDown or ArrowRight: focus stays on Storage; only Tab moves
between sections. `kb-nav-arrow-820.png`. This was round 1's low-severity item and is unchanged.
Smallest fix: roving tabindex plus Up/Down (or Left/Right) navigation in the nav, or state that Tab
only is intended.

### F9. Usage flow / craft, low — a mounting row's button still says "Mount now" while the chip says "Mounting…"

During a mount the row reads chip "Mounting…" / detail "Connecting…" but the disabled first button
is still "Mount now" with aria-label "Mount now <name>". `flow-mounting-label-820.png`.

Why it fails: the button's label contradicts the state that is in progress, even though it is
disabled. Smallest fix: show "Mounting…" on the button while `status === "mounting"`, or remove the
button until it settles.

## Round 1 re-walk (18 items)

| # | Round 1 defect | Result in this build |
| --- | --- | --- |
| 1 | duplicate share can be saved | Fixed. `smb://nas.local/studio` and `smb://studio@nas.local/studio` both block Save with "This share is already added as Studio NAS."; Save disabled, target marked invalid. |
| 2 | helper-down had no way out / live-sounding status | Fixed. Banner has **Restart helper**; status line starts "Helper isn't running."; clicking restarts and removes the banner ("Helper started."). Row mount/test/unmount disabled, Edit kept. `flow-engine-down-820.png`, `flow-engine-restarted-820.png`. |
| 3 | focus lost after General switches and appearance arrows | Fixed for those controls. Focus stays on `general-notifications`, `general-launch` and `appearance-*`; two ArrowRight presses move Light -> Dark -> System. `kb-focus-appearance-820.png`. Dialog focus is still lost (F2). |
| 4 | Add gave no feedback; row below the fold | Fixed, with F6 residual. Toast "Added Copy of NAS." plus Mount now; row scrolled into view at 820 and flash-highlighted; Mount now -> Mounting… -> Mounted; status line updates. |
| 5 | saving a password gave no result and left a stale failure | Partly. Toast "Password saved. Trying Archive Share…" appears; the row keeps the old failure in the preview (F4). Production helper does save + mount now. |
| 6 | Download button crossed the sidebar edge | Fixed. At 768/820/1440 the download button is l=197 r=219, sidebar right=236. `flow-footer-768/820/1440.png`. |
| 7 | invalid Retries silently reverted | Fixed structurally: Retries is a native select with exactly 1–8; the sentence updates to "up to 4 more attempts…". `flow-retries-keyboard-820.png`, `flow-general-retries-820.png`. |
| 8 | Escape/Cancel discarded typed edits | Not fixed. Cancel and the first Escape ask; the return-from-prompt path loses edits (F1). |
| 9 | Remove was permanent | Fixed. Confirmation -> "Removed Archive Share." + Undo (12 s); Undo restores the row and says "Restored Archive Share." `flow-removed-undo-820.png`, `flow-restored-820.png`. |
| 10 | Add opened in an error state; placeholders looked like values | Fixed. No Save reason and no aria-invalid on open; placeholders are "e.g. Studio NAS", "e.g. smb://…", "e.g. /Volumes/studio". `flow-add-initial-820.png`. |
| 11 | long names/path/password placeholder clipped at 375 | Fixed for names, paths and the password placeholder: an 87-character name wraps to 4 lines with no overflow (row scrollWidth=clientWidth=341), the path gets its own line, password hint fits (277/279 px). `stress-long-375.png`, `stress-edit-375.png`. The address placeholder is still clipped (F7). |
| 12 | rows too tall and right half unused at 1440 | Fixed. Rows are 106–130 px at 1440 and 130–154 px at 820; actions end at x=1395 (row right 1411), chip at x=1050. `density-1440.png`, `density-820.png`. |
| + | `http://` error | Correct: "Use an smb:// address, like smb://nas.local/studio." `flow-add-duplicate-820.png` sequence. |
| + | status line uses chip words | Yes: "1 needs attention, 1 unreachable" matches the chips. |
| + | login-item error names recovery | Yes: "Check System Settings › General › Login Items & Extensions, then try again." `flow-login-error-820.png`. |
| + | row buttons name their storage | Yes: "Unmount Studio NAS", "Test Archive Share", "Mount now Editing SSD", "Edit …". |
| + | What's New includes 0.1.8 | Yes: 0.1.10, 0.1.9, 0.1.8, 0.1.7; Current version badge on 0.1.10. `flow-whatsnew-fresh-820.png`, `whatsnew-375.png`. |

## What holds (measured)

- No document-level horizontal overflow at 375/768/820/1440 in light and dark across Storage,
  General, Appearance and Support: `scrollWidth == innerWidth` in all 32 captures
  (`measure-*.png`).
- Content uses the width: main content right edge 359 (375), 740 (768), 792 (820), 1412 (1440).
- Footer pinned: bottom 812/812, 892/900, 632/640, 892/900.
- Dialogs stay inside the window at 375 and 820: Add 820 = x 170..650, y 8..632; Add 375 =
  x 24..351, y 69..743; What's New 375 = x 24..351, y 8..804 with its body scrolling 1435/676;
  Credentials 375 = x 24..351, y 256..556. `whatsnew-375.png`, `credentials-375.png`,
  `stress-edit-375.png`.
- Contrast: 0 text or placeholder elements below 4.5:1 on all four pages and in Add/Edit/What's New
  in both themes (selected appearance control 6.41:1 light, 8.92:1 dark). Disabled controls are
  below 3:1, as expected.
- Every Tab stop checked on all four pages showed a 2 px outline or an equivalent box shadow
  (`kb-focus-switch-820.png`, `kb-focus-rowbutton-820.png`, `kb-focus-appearance-820.png`).
- Instructions: exactly System / Light / Dark; Appearance live-switches and the note changes.
- Icons on all nav and footer entries; version + What's New pill bottom-left; Support row above it;
  icon-only Check for Updates with title and accessible name beside the pill.
- Empty first run: "No storage yet", one Add storage action, no overflow at 375 (`flow-empty-820.png`,
  `flow-empty-dark-375.png`).
- Boot error names the cause and offers Retry; Retry loads the list (`flow-boot-error-820.png`).
- Second instance: one toast, gone after ~10 s (`flow-second-instance-375.png`).
- Update failed: cause and recovery in the footer, no download icon (`flow-update-failed-375.png`).
- Add duplicate, edit duplicate, http scheme, disk add (auto-name from the chosen volume), Browse
  (4 choices; Escape dismisses; pick fills encoded address and name), click outside does not close,
  missing password error focuses the password, Return saves a complete form, Cmd+R calls
  `refresh_storage`, no native `confirm`/`alert`/`prompt` fired.

## Not checked (do not read as passed)

- Native macOS behaviour: Cmd+W hides, Cmd+Q quits, menu-bar reopen, the real 820x640 window
  frame, System appearance following macOS, WKWebView's own Escape/focus handling.
- The packaged app's Escape and focus paths; all evidence above is the preview.
- VoiceOver announcements; the accessibility tree was read, not heard.
- Real helper mount/test/retry timing, real credential save, and the real update download.
- Native keyboard behaviour of the Retries `<select>` popup (headless Chromium's ArrowUp/Down/Space
  did not change the value; typing `4` did). Sidebar arrow keys were tested and do nothing (F8).
- Reload with cached metadata: the preview rebuilds its fixture on every load, so there is no
  cache to inspect.
- Native logs for skips; the preview console produced no errors. No provider/server calls exist in
  the preview UI to trace.

## Before a fresh critic reviews again

1. Fix F1 and F2 together: returning from the discard prompt must focus the form, and no close path
   may drop dirty edits. Add regression checks for Escape x3, fast double Escape, Cancel/Keep
   editing, Browse dismissal, Remove return and credentials close.
2. Fix F3 at 375 (footer after main in DOM or an explicit focus order) and re-measure the Tab list.
3. Fix the preview fixture (F4) so Test and credential saves show the helper's real transitions, or
   record those native flows as unproven and test them in the packaged app.
4. F5–F9 are small and fit in the same pass: repeat-Test result, new-row clearance, 375 address
   placeholder, nav arrow keys and the mounting button label.
5. Re-run the layout and contrast measurements at 375/768/820/1440 in both themes, then hand this to
   a different fresh critic.
