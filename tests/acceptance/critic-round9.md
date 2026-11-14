# Storage Studio KH 0.1.10 — fresh critic, round 9

Reviewer: independent studio critic. Did not design or implement this release. Nothing was
fixed by this review.

Commit reviewed: `f9e8148` (working tree also has a modified `tests/acceptance/release-0.1.10.md`,
which this review did not use as acceptance evidence). Test surface: Vite headless at
`http://localhost:1420/?acceptance=1` with the documented hash fixtures, Chromium (Playwright from
`music-studio-kh/node_modules`), headless only. No visible app window was opened, no app was
activated, no pointer or keyboard input left the page, and the owner's live app data was not
touched.

Measured at 375×812, 768×900, 820×640 and 1440×900; light and dark; Cards and Table; empty,
engine-down, add, edit, credentials, browse, What's New, second-instance and fail-boot states.
Evidence: `tests/acceptance/critic/round9/` (92 evidence files: screenshots and JSON traces).

## Verdict: FAIL

| Area | Score /4 | Basis |
|---|---|---|
| Usability | 4 | Every normal, empty and failure state answers what this is, what happened and what to do next. |
| Usage flow | 4 | Add, mount, unmount, Test, Edit, Remove/Undo, credentials, forget, duplicate refusal, helper restart and boot retry are traceable with immediate and terminal feedback. |
| Functionality | 3 | The password field still claims a saved password is kept after it was forgotten. |
| Craft | 3 | Tab order does not match the screen and includes a BODY stop; Appearance at 1440 leaves 846 px dead; Table at 768 still pans 6 px. |
| Trust | 3 | The forgotten-password placeholder is false, and the Appearance line says the app "always" uses a look the user can change. |

Any area below 4 is a FAIL. The keyboard defect and the stale password claim decide it.

## Round-8 findings re-walked

All figures below are re-measured on `f9e8148`.

| Round-8 finding | Result |
|---|---|
| Root scroller overflow in normal add and helper-down | **Fixed.** Add at 375: document 812/812, footer bottom 812, toast 668–708 vs footer top 708.2. Add at 820: 640/640. Helper-down at 375: 812/812; at 820: 640/640. Helper-down plus add: 812/812 and 640/640. Footer never moves and the document never scrolls. |
| Table at 768 clipped the row menu | **Fixed.** Wrapper x 264–740; every row menu is x 699–727, fully inside the wrapper at rest. The table still has 6 px of empty horizontal scroll; see finding 4. |
| "Checked just now" had no subject or absolute time | **Fixed.** Visible text is "Storage list checked just now"; the title is "Storage list last read 11/14/2026, 7:15:17 AM". Helper-down adds a labelled "Helper last reported 07:11 AM". |
| Undo restored a mounted share as Not mounted | **Fixed.** Remove Studio NAS, confirm, Undo: the row returns **Mounted** at `/Volumes/studio`; the line returns to "1 of 3 storages mounted…"; focus is on the restored row menu. |
| Focus after Save at 375 was off-screen | **Fixed.** After Return-saving at 375, the document stays 812, main scrollTop is 412, focus is on the new row's menu at y 571–599 (visible). |

## Findings, most severe first

### 1. Keyboard order skips the page navigation and lands on BODY (FAIL)
Area: Craft (bar 11), keyboard accessibility.
Severity: high.

What a person sees: open Storage and press Tab. Focus jumps straight to **Add storage**, leaving
Storage / General / Appearance above it untouched. Only after the warning buttons, view switch,
every row action and the whole footer does Tab reach the navigation; between the footer and the
navigation, one Tab lands on BODY with no focus ring at all.

Measured (`flows-kbd2.json`, `tab-820.png`, `tab-375.png`):
- Initial `document.activeElement` is `MAIN` on load at both 375 and 820.
- Tab sequence at 375 and 820: `add-storage` → two warning groups → `view-cards` → six row
  actions → Support → pill → check → download → **BODY** → `nav-storage` → `nav-general` →
  `nav-appearance` → back to `add-storage`.
- At 375 the BODY stop happened with main scrollTop 243; at 820 the nav (visually y 16–98) is
  reached only after the footer.
- After Boot failure → Retry, focus also returns to `MAIN`, reproducing the same start.

Why it fails: bar 11 requires the Tab order to match the screen, and bar 9 requires focus never to
fall to BODY and to stay visible. A keyboard-only person cannot switch to General or Appearance
without traversing the entire Storage page, and one stop has no ring.

Smallest fix: stop focusing `#main` on the first render (the line that focuses main when
`document.activeElement === document.body`). Leave focus on the body, or focus the active nav
item. Keep main focus only for a subsequent in-page view change, and ensure the cycle is
navigation → header action → content → footer with no BODY stop.

### 2. After "Forget the saved password", the field still says a saved password will be kept (FAIL)
Area: Functionality, Trust.
Severity: medium.

What a person sees: Edit Studio NAS → check **Forget the saved password** → Save. The toast says
"Saved Studio NAS. The saved password was forgotten." Reopen Edit: the checkbox is gone and the
saved password is gone, but the Password field still reads **"Leave blank to keep the saved one."**

Measured (`flows-dialog.json`, `forget-reopen-placeholder-820.png`):
`forget: false`, `placeholder: "Leave blank to keep the saved one"`, the Forget checkbox text is
absent, and the toast confirms the password was forgotten.

Why it fails: shown data is false. A skeptical owner is told a credential still exists when the
app just removed it, and cannot tell whether the forget actually took effect.

Smallest fix: derive the placeholder from `hasCredentials`: "Leave blank to keep the saved one"
only when a password exists; otherwise "No saved password" (or "Optional").

### 3. Appearance uses 330 px of a 1204 px page at 1440 (FAIL)
Area: Craft (bar 2).
Severity: medium.

What a person sees: at 1440 the Appearance page is a title, a 330 px System/Light/Dark control,
one sentence, and then 846 px of empty space to the right. General fills the same width with a
full-width settings group; Appearance reads like an unfinished page.

Measured: main x 236–1440 (1204 wide); segmented control x 264–594 (330 wide); dead right
**846 px (70% of the main area)**. Screenshots `page-appearance-1440.png`,
`appearance-dark-820.png`.

Why it fails: bar 2 requires content to fill the window with no dead right half.

Smallest fix: put the appearance choices in a full-width group like General's rows (label on the
left, the choice on the right or full-width), or give the page a deliberate bounded settings
column aligned with the heading. Do not leave a lone segmented control in a 1200 px void.

### 4. Table at 768 still pans 6 px horizontally (low)
Area: Craft (bar 11).
Severity: low.

What a person sees: at 768 the table's last edge sits under the wrapper; the wrapper can be
scrolled 6 px sideways. The row menu is now fully visible, and no cell text is clipped.

Measured: wrapper client width 474, scrollWidth 480; table right edge 745.5 vs wrapper right 740;
every cell reports `clip:false`; row menu x 699–727. Screenshot `table-768.png`.

Why it fails: bar 11 requires no horizontal overflow at the declared breakpoints. This is empty
right padding, not lost content, but it is still a pan.

Smallest fix: set the table to width 100% / fixed layout below 900 px, or trim 6 px from the
Actions column.

### 5. Appearance says the app "always" uses a look the user can change (low)
Area: Trust (bar 12).
Severity: low.

What a person sees: with Light selected, "Storage Studio KH always uses the light look."; with
Dark selected, "always uses the dark look."; with System selected, "System follows your Mac's
light or dark appearance." The word "always" promises permanence while the page invites a change.

Measured (`flows-kbd2.json` `copyLight` / `copyDark` / `copySystem`; screenshots
`page-appearance-1440.png`, `appearance-dark-820.png`).

Why it fails: plain, honest copy. "Always" is not true of a user-selectable setting.

Smallest fix: "This window is using the light look." (or remove the sentence and keep the System
explanation). Keep the copy in step with the selected choice.

## What passed

- **Empty first run** at 375, 820 and 1440: "No storage yet", one next step, Add storage; document
  height equals the viewport and the footer is pinned.
- **Normal Storage** at 375/768/820/1440, light and dark, Cards and Table: document height equals
  the viewport, footer bottom equals the viewport, no clipping, no dead right half on Storage.
- **Add** at 375 and 820: sheet fully inside, Save enabled only when complete, Return saves, new
  row and status line update, toast clears the footer. Helper-down plus add also keeps 812/812 and
  640/640.
- **Mount / unmount / Open in Finder / Test twice**: row state, status line and focus update; a
  repeated Test still names the host.
- **Credentials prompt**: inside the viewport, focus on the user name, 12-Tab loop stays inside;
  empty Save gives "Enter the password for this share."; a saved password shows "Password saved.
  Trying Archive Share…" and the row settles Mounted at `/Volumes/Archive Share`.
- **Forget saved password**: checkbox present when credentials exist, Save reports "The saved
  password was forgotten", and the checkbox disappears (the placeholder is finding 2).
- **Duplicate and invalid address**: Save stays off, "This share is already added as Studio NAS."
  and "Use an smb:// address, like smb://nas.local/studio."
- **Remove + Undo** from both the row menu and the editor; confirmation says nothing is deleted;
  Undo restores the row and focus; the mounted share returns mounted.
- **Row menu**: Down/Up/End/Home move, Escape closes and returns focus to the trigger, outside
  click closes; menus stay inside at 375/768/820/1440.
- **Sheets**: 40 Tabs in Add and 12 in credentials never leave the sheet; Escape dismisses Browse
  results first and returns focus to the share address; Add/Edit with typed changes asks before
  discarding; Keep editing returns to the field; Discard closes and returns focus to Add storage.
- **What's New** at 375/820/1440 is inside the viewport, focuses Close, and Escape returns to the
  version pill.
- **View switch**: Cards/Table switches in session, first column stays pinned, 375 hides columns
  deliberately. See "not checked" for persistence across relaunch.
- **Helper down**: banner names the cause and offers Restart helper; Restart shows "Helper
  started." and the banner clears. Document height 812/812 at 375 and 640/640 at 820.
- **Boot failure**: names the cause, Retry recovers to the Storage list.
- **Duplicate snapshot injection**: two entries for one share render as one row with `×2`.
- **Long name** at 375 wraps to 56.5 px, no document overflow.
- **Icons**: every nav item and every footer entry has an SVG; version + What's New pill is bottom
  left with its icon, Support row above it, Check for Updates is icon-only with an accessible name.
- **Exactly System / Light / Dark** on Appearance; dark applies live; arrow keys move the choice;
  System explains that it follows the Mac.
- **Contrast** from rendered styles: light body 7.30:1, quiet 5.13:1, chip 5.90:1, primary
  6.41:1, secondary 5.36:1; dark body 8.01:1, quiet 7.14:1, chip 7.99:1, primary 8.92:1,
  secondary 6.69:1. Matches `contrast-0.1.10.md`.
- **Accessible names**: an audit of visible buttons, inputs, selects and links found none unnamed.
- **No native `confirm`/`alert`/`prompt`** in `ui/src`; all prompts are in-app dialogs.

## Not checked (never to be read as passed)

- The packaged app, native gate on `story-mini`, DMG, update download/install, served feed 1301,
  menu-bar reopen, LaunchAtLogin/Login Items behaviour and the 0600 secrets file. These are not
  reachable through the headless URL.
- Persistence of the Cards/Table choice across a real relaunch: the dev fixture reseeds
  `listView` from the URL on reload. The in-session switch and the `set_list_view` command were
  observed; cross-relaunch retention was not.
- A truly missing mounted file/path: the fixture's `reveal_storage` always succeeds. The
  "unreachable disk", "needs attention" and unreadable-boot states were used instead.
- Real SMB/disk offline and reconnect after wake; only the helper-down and sample failure states
  were available.
- Focus order and native keyboard behaviour inside the packaged WebView, and macOS menu commands.
- General settings persistence across relaunch and failure feedback: the toggle and retries
  change and save in session (control state is the only feedback; no toast or live announcement).
- The owner's live app data and any real network share.

## What must change before a fresh critic reviews it again

1. Fix the Tab order and the BODY stop (finding 1), and re-measure the full 20-stop cycle at 375
   and 820.
2. Make the password placeholder depend on whether credentials exist (finding 2), and re-check
   after Forget and after adding a new password.
3. Make Appearance use the width at 1440 (finding 3) and remove the "always" overclaim
   (finding 5).
4. Remove the 6 px Table pan at 768 (finding 4).
5. Re-run the same headless walk; a fresh critic, not this reviewer, must sign the final verdict.

This is round 9; the delivery contract's stop rule is two rounds. The remaining work is bounded,
but it should be one last correction pass with the same measurements, not another open-ended
round. Do not ship at 4/4/3/3/3.

Skills used: ponytail · efficient-orchestration · graphify queries: none — no Storage Studio graph exists
