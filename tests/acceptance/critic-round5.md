# Storage Studio KH 0.1.10 — critic round 5

Date: 2026-11-14 · Fresh independent critic (did not design, build or fix this work)
Commit under review: `394b361` (`/Users/you/Developer/My Own Apps/storage-studio-kh`)
Surface: existing Vite preview `http://localhost:1420/` in headless Chromium (Playwright 1.64),
375x812, 768x900, 820x640 and 1440x900, light and dark, Cards and Table. No visible window, no
activation, no pointer or keyboard input on the owner's desktop, no live app data. I did not
re-run `tests/acceptance/run.cjs` or rely on its 258 checks; every result below is from an
independent headless walk.

Screenshots: `tests/acceptance/critic/round5/` (103 captures; named in the findings).

## Verdict: FAIL

| Area | Score /4 | Basis |
| --- | --- | --- |
| Usability | 3 | Main flows answer what happened and what to do next, but the 768/820 Table view hides every row's actions behind an invisible horizontal scroll and breaks addresses mid-word; the boot error leaves a nav that changes highlight but not content. |
| Usage flow | 3 | Add → mount → Test → Edit → Remove → Undo is traceable and every ordinary action now ends on a control; but a duplicate of the same share can still be added with a trailing slash or percent-encoding, giving one mount two rows. |
| Functionality | 3 | Status, Test and update data are true and failures name their cause; duplicate protection is incomplete and the boot error offers nav controls that do nothing. |
| Craft | 2 | Focus falls to BODY after the editor's Test, on the boot error screen and when a focused Undo toast auto-dismisses; the 820 Table clips the Reconnects/Actions columns; the 375 toast covers the version pill and update controls. |
| Trust | 3 | Mount paths, live status and Test results are provable; the 0.1.10 notes overclaim "the same share or disk can't be added twice" and that the Remove confirmation says duplicate entries are cleared, and it does not. |

## Findings (most severe first)

### F1. Craft — the editor's Test drops focus to BODY

Severity: high (keyboard accessibility; studio bar 9).

Repro, 820x640, `#view=storage&edit=studio-nas`, keyboard only:
1. Tab to **Test** in the Edit sheet (`data-fk="editor-test"`), press Enter.
2. The sheet stays open and the toast reads "Test: Connected at /Volumes/studio.", but
   `document.activeElement` is `BODY` with `outlineStyle: none`; the next Tab goes back to
   `editor-name`, so the user restarts at the top of the form.

Measured after Enter: `{tag:"BODY", fk:null, focusVisible:false, outline:"none"}`.
Evidence: `z-focus-after-editor-test-kb-820.png`, `z-focus-after-editor-test-820.png`.

Why it fails: bar 9 says focus never falls to BODY after a transition. `renderEditor()` rebuilds
its markup and only preserves inputs/selects, so the focused button is lost.

Smallest fix: capture the focused action's `data-fk` (or focus the Test button after the busy
render) and restore it after the Test snapshot, as row Test already does; add a regression check
that `document.activeElement !== document.body` after every editor action.

### F2. Craft / Usability — the boot error opens on BODY and its nav is a dead control

Severity: high (keyboard accessibility and a misleading error state).

Repro, 820x640, `#view=storage&fail-boot=1`:
1. At rest `document.activeElement` is `BODY`, no ring.
2. Tab 1 goes to nav, not **Retry**; Retry is the 4th Tab stop after nav-storage, nav-general and
   nav-appearance (measured 1st Tab = nav-appearance in a clean load).
3. Click **General**: the nav highlight moves to General while the same "Storage Studio KH
   couldn't start" content remains. The nav has no effect on the error screen.

Evidence: `e-boot-error-820.png`, `e-boot-error-focus-820.png`,
`e-boot-error-general-820.png`.

Why it fails: bar 9 (BODY after a transition) and bar 10 (the error state's next step must be the
thing you land on); the nav is an action that appears to navigate but changes nothing.

Smallest fix: focus the Retry button (a `data-autofocus` target) in `renderBootError`, and
hide/disable the nav (or render the same error for every view) until boot succeeds; add a check
that the error screen opens with Retry focused and the first Tab reaches Retry.

### F3. Craft — a focused Undo toast auto-dismisses and focus falls to BODY

Severity: medium (the recovery action disappears while focused).

Repro, 820x640: Edit Archive Share → Remove → Remove Archive Share. The toast is focused on
**Undo**. Leave it: after 12 s the toast is removed and `document.activeElement` is `BODY`
(`outlineStyle: none`).

Evidence: `z-remove-toast-820.png` (Undo focused), `z-remove-toast-gone-820.png` (after 12.5 s).

Why it fails: bar 9. The transition is a timer, but the keyboard user loses the recovery control
they were about to use.

Smallest fix: in `dismissToast`, if the toast being removed contains the active element, focus a
stable control (the affected/next row's menu or `main`) before removing it; or pause the
auto-dismiss timer while a toast action has focus.

### F4. Usage flow / Functionality — duplicate protection and dedupe miss trailing slashes and percent-encoding

Severity: high (the same mount can exist twice; the release note says it cannot).

Repro, 820x640, `#view=storage`, Add storage:
- Name "Duplicate Test", address `smb://nas.local/studio/` → **Save stays enabled**; saving
  creates a second row for the same Studio NAS share. Address `smb://NAS.local/studio/` and
  `smb://nas.local/st%75dio` (which displays as `.../studio`) behave the same.
- The exact address `smb://nas.local/studio` is correctly blocked: "This share is already added
  as Studio NAS." A case-only injected duplicate is deduped to one row with `×2`.

Evidence: `u-dup-trailing-input-820.png` (Save enabled), `u-dup-trailing-two-rows-820.png`
(two rows), `u-dedupe-exact-820.png` (×2 works), `u-dedupe-warnings-1440.png`.

Cause: `shareKey` in `ui/src/model.ts:131-133` and `same_storage` in
`src-tauri/src/main.rs:865-883` lower-case and strip `user@` but do not trim trailing slashes or
decode percent-encoding. Both the Save check and `dedupeStorages` use that key.

Why it fails: bar 6 (duplicate rows deduped with a count); the 0.1.10 note "The same share or disk
can't be added twice: Save says which existing storage already uses it" is false for these forms,
and two mount attempts for one share are possible.

Smallest fix: normalize the share key once (trim trailing slashes, percent-decode, lower-case,
strip user) and use it for both the Save check and the dedupe; add tests for trailing slash,
case, user and encoded variants. Keep `readableTarget` for display.

### F5. Craft / Usability — 768/820 Table view clips the Actions column and breaks addresses mid-word

Severity: medium-high (a declared breakpoint and view; the row's next action is off-screen).

Measured at 820x640, `#view=storage&list=table` (same at 768x900):
- Table wrap 526 px client / 729 px scroll; first column pinned (left 17/265 unchanged).
- Address column is 69 px wide; `smb://nas.local/studio` wraps over 5 lines
  (`smb:// / nas. lo / cal/st / udio`).
- Reconnects header starts at x=750 and is cut at the wrap's right edge x=792; the Actions column
  starts at x=838 and is entirely off-screen (at 768 the wrap ends at 740).
- At 375 only Storage and Status are visible; Actions starts at x=590 with the wrap ending at 359.
- No visible horizontal scroll affordance in the static frame (macOS overlay scrollbar).

Evidence: `measure-storage-light-table-820x640.png`,
`measure-storage-dark-table-820x640.png`, `table-scrolled-light-375x812.png`.

Why it fails: the measurement step asks for clipped columns; the bar 11 "nothing clipped" and the
"best tool in the category" craft floor. The table scrolls and pins column one, but its default
state is not readable and hides the primary action.

Smallest fix: give Address/Reconnects sensible min-widths with `white-space: nowrap` (or hide
Reconnects at <=820, since it is in Edit and Cards), and keep the Actions column visible at 768/820;
add a visible horizontal scroll affordance. Re-measure at 375/768/820 in both themes.

### F6. Craft / Usability — at 375 the toast covers the version pill and the update controls

Severity: medium (footer controls are unclickable while a toast is shown).

Repro, 375x812, `#view=storage&add=1`: add a share. Measured:
- Toast 39..359 x 756..796.
- Version/What's New pill 12..165 x 755..781; Check 169..191; Download 195..217.
- `document.elementFromPoint` at the centre of the pill, Check and Download returns
  `.toast-text`; the pill is visibly cut to "Sto…" in the screenshot.

Evidence: `q-add-toast-overlap-375.png`, `z-editor-test-toast-375.png`.

Why it fails: bar 8 (version + What's New pill and icon-only Check beside it) is blocked for the
toast lifetime (6 s for success, 12 s for Remove); the user cannot use Check/Download.

Smallest fix: on narrow widths place toasts above the footer (bottom = footer height + gap) or
reserve footer space; keep the new row clear of the toast as today.

### F7. Trust / Usage flow — the Remove confirmation does not mention clearing duplicate entries

Severity: medium (the release note claims the confirmation says so).

Repro: Edit → Remove. The confirmation copy is "This removes the storage from Storage Studio KH
and forgets its saved password. Nothing is deleted from the share or disk." It does not mention
duplicate entries. The 0.1.10 note says "Removing a storage forgets its saved password and clears
any duplicate entries; the confirmation says so." The real backend does clear `same_storage`
entries (`src-tauri/src/main.rs:889-905`), but the user is not told.

Evidence: `i-remove-confirm-820.png`.

Why it fails: trust — the user-facing note overstates what the confirmation says; a user removing
a `×2` row is not told both entries go.

Smallest fix: add "and its duplicate entries" to the confirmation copy (or remove the claim from
the note); test with a deduped row.

### F8. Craft / accessibility (non-blocking) — row menus ignore ArrowUp/ArrowDown/Home/End

Repro: focus a row's More actions, press Enter; the first item receives focus. ArrowDown leaves
focus on the first item (measured unchanged); only Tab moves between items. Escape closes and
restores the toggle, outside click closes. Evidence: `m-rowmenu-820.png`.

Why: an ARIA menu should support arrow keys; Tab still works, so this is below the release bar but
worth fixing before the next craft pass.

Smallest fix: handle ArrowUp/ArrowDown/Home/End inside `#row-menu`; keep Escape/outside behavior.

### F9. Craft / accessibility (non-blocking) — the storage heading concatenates name and kind

The DOM heading text is `Studio NASSMB share`, `Editing SSD×2Attached disk`. The CSS margin
separates them visually, but the accessible text has no separator and can read as one word.
Evidence: DOM extraction from `measure-storage-light-cards-375x812.png`.

Smallest fix: put a space/text separator or an `aria-label` on the heading, or make the kind a
separate labelled element.

## Round 4 items re-walk

| Round 4 item | Result |
| --- | --- |
| F1 focus after row Test / Unmount / Check / Restart | **Fixed for row actions.** Keyboard row Test → `row-studio-nas-menu`; Unmount → `row-studio-nas-mount`; Check → `check`; Restart helper → `nav-storage`; all `:focus-visible` with a 2 px ring. `z-focus-after-test-820.png`, `z-focus-after-unmount-820.png`, `z-focus-after-check-820.png`, `z-focus-after-restart-820.png`. |
| F2 Undo 16 Tabs away | **Fixed.** Remove focuses **Undo**; Enter restores the same `data-storage="archive"` row and focus lands on its menu. `z-focus-after-remove-820.png`, `z-focus-after-undo-820.png`. The 12-second auto-dismiss is F3. |
| Row menu on every row | **Yes.** Studio NAS, Archive Share and Editing SSD each have a menu; items match the row state (Unmount/Test/Edit vs Test/Edit). |
| Readable addresses | Cards and the 1440 table show decoded addresses (`smb://nas.local/Public Space-Media - 4TB - Music`); the 768/820 table breaks them mid-word — F5. |
| Grouped warnings | **Yes.** Injected 12-row snapshot produced `Needs attention 3`, `Needs a password 1`, `Can't be reached 3`, `Connecting 1`, `Retrying 1`; no repeated per-row lines. `u-dedupe-warnings-1440.png`. |
| Dedupe counts | **Exact/case dedupe works** (injected identical SMB entries → one row `×2`; disk UUID duplicates → `×2`; title "2 entries for this one storage"). Trailing slash/encoding gap — F4. `u-dedupe-exact-820.png`, `u-table-dedupe-1440.png`. |
| Table first column pinned | **Yes.** Left edge 17 unchanged after scrolling 388 px at 375; 265 at 768/820. `table-scrolled-light-375x812.png`. |
| Contrast ratios | **Body/placeholder >= 4.5:1.** Measured lowest text pair 5.10:1 light (Mounted chip; update line 5.13, nav active 5.36) and 6.68:1 dark (primary/placeholder; chips 6.95-7.91). Details below. |
| Credential-safety copy on Remove | **Present for the password** ("forgets its saved password. Nothing is deleted from the share or disk."), but not for duplicates — F7. |

## Flows walked end to end

- **Empty first run** (`empty=1`): 375 and 820; "No storage yet", one Add storage in the empty card,
  no header duplicate, footer pinned. `g-empty-375.png`, `g-empty-820.png`.
- **Add SMB share**: Add → name/target → Return saved; new row + "Added … Mount now"; row clear of
  toast at 820 (row 390..544, toast 584..624); focus Add storage. `a-add-open-820.png`,
  `a-add-saved-820.png`.
- **Add attached disk**: Kind → Attached disk → Backup Disk; "Reconnects at /Volumes/Backup Disk";
  saved row; focus Add storage. `a-add-disk-820.png`.
- **Browse and pick**: `smb://nas.local` → Browse → "Shares on nas.local"; picked Studio Projects;
  target encoded, card shows decoded; saved. `i-browse-820.png`, `a-browse-picked-820.png`.
- **Mount with credentials**: Archive Share Mount now → credentials prompt (focus username);
  Escape returns to the row menu; save → "Password saved. Trying Archive Share…" → Mounted, toast
  ends when the share answers; focus row menu. `f-credentials-820.png`,
  `f-password-saved-820.png`.
- **Credentials failure** (`fail-credentials=1`): "Storage Studio KH couldn't save the password.",
  focus password. `f-credentials-failed-820.png`.
- **Unmount / mount**: Studio NAS menu → Unmount → Not mounted + Mount now focused; Mount now →
  Mounted + Open in Finder focused (preview mounts instantly; see Not checked).
- **Test reachability**: each row; no credentials and no mount; results name the row's state;
  a repeated Test still names its result; focus row menu. `j-test-archive-820.png`.
- **Edit**: Editing SSD name/flags → saved; row and "Saved Editing SSD 2." toast. `e-edit-saved-820.png`.
- **Remove + Undo**: keyboard Remove confirmation (focus Keep, Shift+Tab to Remove Archive Share);
  removal focuses Undo; Enter restores the same row and toast "Restored Archive Share.".
- **Forget saved password**: Edit Studio NAS → checkbox "Forget the saved password"; password field
  disabled with "Saved password will be forgotten"; save; reopen shows no checkbox. `f-edit-forget-820.png`.
- **Cards / Table**: keyboard ArrowRight switches to Table and invokes `set_list_view`; focus stays
  on the radio; ArrowLeft returns to Cards. `v-table-keyboard-820.png`.
- **Duplicate protection / dedupe**: exact address blocked; exact and case-only duplicates dedupe
  with ×2; trailing slash/encoded forms are accepted — F4.
- **Helper down / restart** (`engine-down=1`): banner "The background helper isn't running / The
  helper stopped responding. / Restart helper"; status line names it; mount/Test disabled, Edit and
  reveal enabled; Restart clears the banner, toast "Helper started.", focus `nav-storage`.
  `g-engine-down-820.png`, `g-engine-down-375.png`, `z-focus-after-restart-820.png`.
- **Check for Updates**: offered 0.2.0; Checking → available; download icon returns; focus `check`.
  `z-focus-after-check-820.png`.
- **What's New**: real 0.1.10 notes plus 0.1.9/0.1.8/0.1.7; open from the pill focuses Close;
  Tab is trapped; Escape returns to the pill. `o-whatsnew-375x812.png`, `n-whatsnew-kbopen-820.png`.
- **Support**: one page action; invokes `open_support`. `measure-support-light-375x812.png`.
- **General**: Notifications and Launch at login toggle with focus retained; Retries 4 updates the
  sentence "up to 4 more attempts…"; `set_general` invoked. The launch-at-login error note (injected)
  names System Settings and says the current state. `t-general-820.png`, `u-login-error-1440.png`.
- **Appearance**: exactly System/Light/Dark; arrows select Light then Dark, theme applies live and
  focus stays on the chosen radio. `t-appearance-dark-820.png`.
- **Escape paths**: Add clean closes; dirty Add prompts "Discard changes?" with Keep editing
  focused; Escape returns to the form with the draft; Discard closes and focuses Add storage;
  Browse results dismiss first; Remove returns to the name field; What's New closes. `i-discard-prompt-820.png`,
  `i-browse-dismissed-820.png`, `i-remove-confirm-820.png`.
- **Return saves**: Add saved from the target field; credentials Enter saves.
- **Second instance** (`second=1`): one toast "Storage Studio KH is already running. This window is
  the running copy." `s-second-820.png`.
- **Boot failure** (`fail-boot=1`): error names cause and Retry; Retry restores the page with focus
  main. Initial focus and the live nav are F2. `e-boot-error-820.png`, `e-boot-retry-820.png`.

The app has no download/import or cleanup-preview flow; its analogues are add → mount → Test and
Remove → Undo. A "missing file" maps to the unreachable disk and the missing-settings boot error;
"provider offline" maps to helper-down, because this app has no provider.

## Measurements

- **Layout sweep** (32 captures): Storage/General/Appearance/Support x 375/768/820/1440 x light/dark.
  No document horizontal overflow (`scrollWidth == innerWidth`), no page vertical overflow, footer
  bottom = window bottom (gap 0), dialogs inside the window. Cards scroll internally at 375
  (904/661), 768 (936/900) and 820 (877/640); Table fits vertically. General/Appearance/Support need
  no full-page scroll at any size. `measure-*` files.
- **Dialogs**: Add 375 = 24..351 x 69..743, Add 820 = 170..650 x 8..632; Edit 820 body 550/504
  (scrolls, actions pinned); What's New 375 = 24..351 x 8..804, body 1953/676; credentials 375 =
  24..351 x 256..556 and 820 = 170..650 x 183..457. All inside the window. `o-*`,
  `f-credentials-375.png`, `f-credentials-820.png`.
- **Footer/geometry at 820**: Support 6..229 x 545..575, pill 14..167 x 583..609, Check
  171..193 x 585..607, Download 197..219 x 585..607, update line 6..229 x 617..632; all inside the
  236 px sidebar; footer 532..640. At 375 the footer is full-width; the toast overlap is F6.
- **Contrast** (computed styles, both themes): light body 16.33, muted 7.62, address 16.33, quiet
  update line 5.13, nav 6.01/5.36, chips 5.10/5.65/5.81, row primary 5.36, status line 7.30,
  placeholder 6.23; dark body 12.60, muted 7.23, quiet 7.14, nav 8.57/6.69, chips 7.91/7.45/6.95,
  row primary 6.69, status line 8.01, placeholder 6.68. All body/placeholder pairs >= 4.5:1.
  `contrast-dialog-light.png`, `contrast-dialog-dark.png`.
- **Focus rings**: 2 px solid rgb(13,107,92) light / rgb(110,207,188) dark on buttons, nav, rows and
  menu items; inputs use a 3 px rgba accent shadow. Visible on keyboard paths.
- **Table geometry**: 375 wrap 343/341, table 729, Address 69 px (5 lines), Actions x=590;
  768 wrap 476/474, table 729, Reconnects x=750 (wrap ends 740), Actions x=838; 820 wrap 528/526,
  table 729, Reconnects x=750..838 (clip at 792), Actions x=838; 1440 wrap 1148/1146, table fits.
- **Network/console**: 11 module requests, all `localhost:1420`; no provider calls, no page errors,
  no console errors. There is no skip log in the preview.

## Completeness gates

- **Task list**: add-share, add-disk, browse, mount/unmount, Test, edit, remove+undo, credentials,
  forget-password, view switch, duplicate-dedupe and helper-restart all produce a visible
  end-to-end result. The duplicate job passes for exact/case forms and fails for trailing
  slash/encoded forms (F4).
- **Capability cross-check**: every declared capability in §2 has a reachable control, including
  Forget saved password, Cards/Table, both reconnect switches, the row menu and Restart helper.
  The only gap in behaviour is the duplicate-key normalisation above; no declared capability is
  missing.
- **Standard-practice comparison**: no missing control versus Finder Connect to Server / AutoMounter
  beyond the documented absences (search, mount-all, copy/sync, NFS/AFP/WebDAV, Keychain). At the
  documented ~12-row threshold search is still absent (revisit point); not a missing control here.
  The 768/820 Table layout itself is below the category bar (F5).

## Not checked (do not read as passed)

- Native macOS behaviour: the real 820x640 frame, Cmd+W hides, Cmd+Q quits, menu-bar reopen, System
  appearance following macOS, WKWebView Escape/focus handling.
- The packaged app's Test, credential save, update check, login-item refusal, mount timing and the
  real delayed "Password saved. Trying…" path. The preview mounts instantly and even mounts the
  "Unreachable" Editing SSD, so the real mount-failure path is not exercised.
- Real mount-table duplicate prevention and real mounts (helper-side).
- VoiceOver announcements and the native select popup's keyboard behaviour. The retries select was
  changed with `selectOption` (focus retained, sentence updated); arrow keys on the closed native
  select were not verified.
- Reload with cached metadata: the preview rebuilds its fixture on every load; there is no cache to
  inspect.
- Provider offline: this app has no provider; helper-down was used as the offline analogue.
- The update-failed state (no route in the provided test URL; injected to inspect the copy:
  "The update server couldn't be reached." with the Check icon beside it — it names the cause but
  not the retry in text).
- External actions (Download, Open in Finder, donation) are preview no-ops; their commands fire
  (`open_updater`, `open_support`).
- The skip log: no preview log; the real `~/Library/Application Support/Storage Studio KH/log.txt`
  was not read.
- The 258-check acceptance suite was not rerun; this is an independent walk.

## Before a fresh critic reviews again

1. Fix F1: restore focus after the editor's Test (and any editor action that re-renders) to the
   triggering control or the next logical control; add a BODY regression check.
2. Fix F2: focus Retry on the boot error and disable/hide the nav there; verify initial focus and
   the first Tab.
3. Fix F3: never remove a focused toast action into BODY; move focus to a stable control first.
4. Fix F4: normalise the share key (trailing slash, percent-encoding, case, user) for Save and
   dedupe; add tests; correct the What's New claim if the behaviour is not fixed.
5. Fix F5: make the 768/820/375 Table readable and keep Actions reachable; re-measure both themes.
6. Fix F6: keep the 375 toast clear of the footer pill and Check/Download.
7. Fix F7: state the duplicate-clearing consequence in the Remove confirmation (or remove the
   claim from the notes).
8. F8/F9 are non-blocking craft/accessibility items; fix them before the next craft pass if the
   release is otherwise ready.
9. Add the above to the acceptance suite, re-run at 375/768/820/1440 in both themes, and hand the
   build to a different fresh critic. Do not call 0.1.10 shipped until that pass is clean; if it
   still fails, stop and send the owner the gap, the evidence above and one recommendation rather
   than lowering the bar.

Skills used: ponytail · efficient-orchestration · graphify queries: none — no Storage Studio graph exists
