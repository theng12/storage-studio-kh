# Storage Studio KH 0.1.10 — critic round 4

Date: 2026-11-13 · Fresh independent critic (did not design, build or fix this work)
Surface: Vite preview `http://localhost:1420/` in headless Chromium (Playwright 1.64), 375x812,
768x900, 820x640 and 1440x900, light and dark. No visible window, no activation, no pointer or
keyboard input on the owner's desktop, no live app data.
Screenshots: `tests/acceptance/critic/round4/` (110 captures, named below).

I did not re-run `tests/acceptance/run.cjs` or rely on its 219 checks; every result below is from
an independent headless walk.

## Verdict: FAIL

| Area | Score /4 | Basis |
| --- | --- | --- |
| Usability | 4 | Every page answers what it is, what happened and the next action; one status line, one primary action, no duplicate pages. |
| Usage flow | 4 | Add → mount → unmount → remove → undo is traceable; Test and updates now match the helper; repeat Test, credentials and update checks give a terminal result. |
| Functionality | 4 | Shown status and Test results match the helper's semantics; duplicates, `http://`, helper-down, boot failure and update state are named and actionable; no silent failure or console error found. |
| Craft | 3 | Layout, density, contrast, focus rings and sheets are strong, but focus falls to BODY after five keyboard transitions, and Undo is 16 Tab presses away after a removal. |
| Trust | 4 | Test now reports the helper's real outcomes and Check for Updates agrees with the offered 0.2.0; mount paths, live status and What's New notes are truthful. |

## Findings (most severe first)

### F1. Craft — focus falls to BODY after Test, Unmount, Check for Updates and Restart helper

Severity: high (keyboard accessibility; violates studio bar 9 and 12).

Repro, 820x640, keyboard only:
1. Tab to Studio NAS **Test**, press Enter. The row changes and the toast shows the result, but
   `document.activeElement` is `BODY`; `getComputedStyle(BODY).outlineStyle` is `none`.
2. Tab to Studio NAS **Unmount**, press Enter. The row becomes Not mounted and focus is `BODY`.
3. Tab to **Check for Updates**, press Enter. The line goes Checking → available, but focus is
   `BODY`.
4. Engine-down preview, Tab to **Restart helper**, press Enter. The banner clears and the helper
   starts, but focus is `BODY`.

Measured active elements after each action: `{tag:"BODY", fk:null}` in all four cases.
Evidence: `z-focus-after-test-820.png`, `z-focus-after-unmount-820.png`,
`z-focus-after-check-820.png`, `z-focus-after-restart-820.png`.

Why it fails: a keyboard user loses their place after ordinary row and footer actions. No focus
ring is visible, and the next Tab starts again at the first navigation item instead of where the
action happened.

Smallest fix: after each snapshot, restore focus to the triggering control if it still exists
(Test, Check for Updates, Restart helper); if it disappears, focus the replacement primary action
(Unmount → **Mount now**, Restart helper → the Storage title or first row). Add a regression check
that `document.activeElement !== document.body` after every row and footer action.

### F2. Craft / keyboard flow — after Remove, focus is BODY and Undo is 16 Tab presses away

Severity: high (the recovery action is not available where the person is).

Repro, 820x640:
1. **Edit** Archive Share → **Remove** → **Remove Archive Share** (confirm).
2. The row is gone and the toast reads "Removed Archive Share. Undo", but
   `document.activeElement` is `BODY`.
3. Tab forward: nav-storage, nav-general, nav-appearance, Add storage, every remaining row action,
   Support, pill, Check, Download — **Undo** is the 16th Tab stop. The toast is after the footer in
   DOM order, so the undo is effectively out of reach without many presses.

Evidence: `z-focus-after-remove-820.png`, `l-remove-focus-820.png`.

Why it fails: studio bar 9 says focus never falls to BODY after a transition, and a state must be
actionable; the only recovery from removal is not focused and is last in the tab order.

Smallest fix: focus the **Undo** button when the removal toast appears (or the next row's Edit if
no undo is offered), and place the toast action before the footer in tab order. Verify with a
keyboard-only Remove → Undo run.

## Round 3 items re-walk

| # | Round 3 item | Result |
| --- | --- | --- |
| 1 | New row at 820x640 clear of the toast | **Fixed.** Row 441..544, toast 584..624; no new-row action intersects at 0.4 s, 4.4 s or after the toast clears. At 375: row 509..612, toast 756..796; clear. `b-add-toast-820-0.4s.png`, `q-add-overlap-375x812.png`. |
| 2 | Preview Test mirrors the helper | **Fixed.** Studio NAS → Mounted, "Connected at /Volumes/studio."; Archive Share → Not mounted, "archive.local is reachable and ready to mount.", no credentials sheet; Editing SSD → Unreachable, "The disk isn't connected." Neither Test mounts nor asks for a password. `a-test-mounted-820.png`, `a-test-archive-820.png`, `a-test-ssd-820.png`. |
| 3 | Check for Updates agrees with the 0.2.0 offer | **Fixed.** Footer "Version 0.2.0 is available" + download; click → "Checking for updates…" (icon spinning, download hidden) → "Version 0.2.0 is available" and the download icon returns. `a-update-checking-820.png`, `a-update-checked-820.png`. |
| 4 | Focus after Undo, boot Retry, Tab inside sheets | **Partly fixed.** Undo → restored row's **Edit**; boot Retry (`fail-boot=1`) → `main` (id `main`); Tab cycles inside Add, What's New and credentials and never reaches BODY. But F1/F2 show BODY after other transitions. `d-undo-focus-820.png`, `e-boot-retry-820.png`, `e-whatsnew-focus-375.png`. |
| 5 | What's New opens on Close with its ring inside | **Fixed.** Keyboard open focuses Close; outline 2 px, offset 2 px, inside the sheet (375: Close 267.8..327, sheet 24..351; 820: Close 566.8..626, sheet 170..650). No clipped ring. Mouse-open shows no ring because the app uses `:focus-visible`; that is standard, not a defect. `n-whatsnew-kbopen-375.png`, `e-whatsnew-focus-375.png`. |
| 6 | "Password saved. Trying …" does not linger after mount | **Fixed for the preview.** Save credentials → the row is Mounted/Connected within 150 ms, no "Password saved. Trying…" toast remains at 0.15, 0.4, 0.9 or 1.6 s. The preview mounts instantly, so the real delayed-toast path is not exercised (see Not checked). `f-password-saved-400ms-820.png`. |
| 7 | Undo restores the same row id | **Fixed.** `data-storage="archive"` is present before removal and after Undo; editing the restored row shows the same `smb://archive.local/backups` target. The preview shows status Not mounted rather than the pre-removal Needs attention; the id is preserved as asked. `d-undo-focus-820.png`, `d-restored-edit-820.png`. |

## Spot checks of earlier fixes

- Duplicate blocking: Save disabled, `aria-invalid="true"`, visible "This share is already added as Studio NAS." (`k-duplicate-820.png`).
- `http://` address: Save disabled, `aria-invalid="true"`, visible "Use an smb:// address, like smb://nas.local/studio." (`k-http-820.png`).
- Restart helper: banner clears, status line returns to the counts, toast "Helper started." (`g-engine-restarted-820.png`); focus is BODY (F1).
- Retries picker: exactly 1–8; selecting 4 updates the sentence to "up to 4 more attempts…" (`j-retries-820.png`).
- Undo: removes and restores Archive Share, toast says "Restored Archive Share." (`d-undo-focus-820.png`); focus after the removal itself is F2.
- Long names: 82+ characters wrap at 375 and 820, document `scrollWidth == innerWidth`, row actions visible, no leaf text clipped (`x-longname-375x812.png`, `x-longname-820x640.png`).
- Footer geometry: Support above the version pill; icon-only Check for Updates beside the pill; download icon when 0.2.0 is offered; footer bottom equals viewport bottom at 375/768/820/1440 (`measure-*-375x812.png`, `measure-*-1440x900.png`).
- Row density: at 1440 rows use the full width and actions sit at the right edge, no dead right half (`measure-storage-light-1440x900.png`).
- Escape ×3 / no data loss: clean Add closes; dirty Add prompts; Keep editing returns to Name with the draft; fast double Escape returns to the form with the draft; Discard closes. Escape returns from Remove to the form and dismisses Browse results first (`i-discard-prompt-820.png`, `i-browse-820.png`, `i-browse-dismissed-820.png`).
- 375 Tab order: nav-storage → nav-general → nav-appearance → Add storage → rows → footer; 820 is the same with the sidebar. No BODY stop in the page cycle before the footer (`h-tab-375.png`, measured sequence).
- Nav arrows: ArrowDown from Storage switches to General, ArrowRight to Appearance, ArrowUp back; focus visible (`kb` measurement in this round; no screenshot needed for the state change).
- Mounting label: Editing SSD shows "Mounting…" with a disabled `Mounting…` button, then Mounted within 600 ms (`j-mounting-820.png`, `k-mount-final-820.png`).
- Repeated Test: the second Test after the first toast clears still shows "Test: Connected at /Volumes/studio."; toast lifetime is about 5–6 s (`j-test-repeat-820.png`).
- Empty first run: "No storage yet", "Add your first share or disk…", Add storage at 375 and 820 (`g-empty-375.png`, `g-empty-820.png`).
- Engine down: one banner "The background helper isn't running / The helper stopped responding / Restart helper"; status line "Helper isn't running. …"; mount/test disabled, Edit and reveal for the mounted row remain enabled (`g-engine-down-820.png`).
- Second instance: one toast "Storage Studio KH is already running. This window is the running copy."
- Appearance: exactly System/Light/Dark; selected state follows the route; the explanatory sentence updates; focus stays on the chosen radio (`t-appearance-system-820.png`, `t-appearance-light-820.png`, `t-appearance-dark-820.png`, `aa-appearance-light-820.png`).
- General: toggles change immediately and keep focus; retries sentence updates; the switch state is the feedback (`t-general-toggles-820.png`).
- Support: one page action ("Open donation page"), no duplicate of the footer entry (`h-support-375.png`).

## Measurements

- Layout: 32 captures (storage/General/Appearance/Support × 375/768/820/1440 × light/dark). No
  document horizontal overflow (`scrollWidth == innerWidth`), no clipped leaf text, footer bottom
  equals the window bottom in every capture. The main area has a 6 px internal scroll at 820x640
  (646 scroll height / 640 client) but no full-page scroll; lists fit at the four sizes.
- Sheets: Add 820 = 170..650 × 8..632; Add 375 = 24..351 × 69..743; Edit 820 body 525/504 (scrolls,
  actions pinned); What's New 375 = 24..351 × 8..804, body 1435/676; credentials 820 = 170..650 ×
  183..457. All inside the window (`o-add-*`, `o-edit-*`, `o-whatsnew-*`, `o-creds-*`).
- Contrast: lowest text ratio 4.73:1 light (update line) and 5.77:1 dark; all body text ≥ 4.5:1.
  Placeholders are rgb(102,101,95) light and rgb(163,162,155) dark, both above 4.5:1 in their
  fields (`contrast-dialog-light.png`, `contrast-dialog-dark.png`).
- Focus rings: nav, Add storage, row actions and pill show a 2 px solid rgb(13,107,92) outline with
  2 px offset; text inputs use a 3 px rgba(13,107,92,0.4) box-shadow; What's New's Close shows the
  same 2 px outline when opened from the keyboard. No clipped ring at 375 or 820.
- Network/console: only local Vite module requests; no provider calls, no page errors. Console has
  only the Vite connect messages. There is no skip log in the preview to read.

## Not checked (do not read as passed)

- Native macOS behaviour: the real 820x640 frame, Cmd+W hides, Cmd+Q quits, menu-bar reopen,
  System appearance following macOS, WKWebView Escape/focus handling.
- The packaged app's Test, credential save, update check, login-item refusal, mount timing and
  the real delayed "Password saved. Trying…" toast path; the preview mounts instantly.
- VoiceOver announcements; the native select popup's keyboard behaviour.
- Reload with cached metadata: the preview rebuilds its fixture on every load, so there is no cache
  to inspect.
- Real mount-table duplicate prevention and real mounts (helper-side).
- The update-failed state (no route in the provided test URL) and external actions
  (Download, Open in Finder, donation page) which are preview no-ops.
- I did not re-run the 219-check acceptance suite; the flows above are independent headless walks.

## Before a fresh critic reviews again

1. Fix F1: after Test, Unmount, Check for Updates and Restart helper, leave focus on a control (the
   triggering button or the replacement primary action), never BODY.
2. Fix F2: focus the Undo toast action on removal, or move it into the immediate tab path; verify
   Remove → Undo with the keyboard and that Tab never passes through BODY.
3. Add those transitions to the page acceptance script and re-run at 820x640 and 375x812; then
   hand the build to a different fresh critic. The seven round-3 items themselves are fixed.

Skills used: ponytail (invoked) · graphify queries: none — this was a headless UI measurement;
code reads were limited to selectors and the fixture's visible states.
