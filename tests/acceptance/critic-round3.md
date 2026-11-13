# Storage Studio KH 0.1.10 — critic round 3

Date: 2026-11-13 · Fresh independent critic (did not design, build or fix this work)
Surface: Vite preview `http://localhost:1420/` in headless Chromium (Playwright 1.64), 375x812,
768x900, 820x640 and 1440x900, light and dark. No visible window, no pointer or keyboard input
on the owner's desktop, no live app data and no activation.
Screenshots: `tests/acceptance/critic/round3/` (87 captures, named throughout).

## Verdict: FAIL

| Area | Score /4 | Basis |
| --- | --- | --- |
| Usability | 4 | Every page answers what this is, what happened and the next action; one status line, one primary action, no duplicate pages. |
| Usage flow | 4 | Add → mount → unmount → remove → undo is traceable; Escape preserves drafts on every path; repeat Test now gives a result. |
| Functionality | 4 | Duplicates, `http://`, helper down, boot failure and update failure are blocked, named and actionable. App logic reads one snapshot; no silent failure found in the UI. |
| Craft | 3 | Layout, density, width use, contrast and focus rings are strong, but the toast covers the new row's Test/Edit at 820x640, focus reaches BODY after Undo and Retry, and a clipped focus ring shows on What's New. |
| Trust | 3 | The preview still fabricates Test outcomes (Test mounts an unreachable disk; Test on an SMB share asks for a password) and Check for Updates contradicts the offered 0.2.0. |

## Findings (most severe first)

### F1. Craft — the toast covers the newly added row's Test and Edit at 820x640 for 8 s

Repro (`#view=storage&add=1`, 820x640):
1. Name `Copy of NAS`, address `smb://nas.local/copy`, press Return.
2. The row is scrolled into view and highlighted, but the toast sits on its action row.

Measured: new row top 508, bottom 611; toast x 484..804, y 584..624; the `Test` and `Edit`
button rectangles intersect the toast (`covered: true` at 0.4 s and at 4.4 s). The toast clears
at 8.4 s. `Mount now` stays clear. Window height 640 — this is the app's own settings size.
Evidence: `flow-after-add-820.png`.
Why it fails: the brief requires a newly added row to be visible clear of the toast; two of its
four actions are covered for the toast's whole life.
Smallest fix: reserve a bottom inset for the toast in the list (e.g. list `padding-bottom` /
`scroll-margin-bottom` equal to toast height) so the new row lands above it, and re-measure at
820x640.

### F2. Trust — the preview Test action produces states the shipped helper never produces

- Editing SSD is seeded `Unreachable` ("The disk isn't connected right now."). Click **Test**:
  chip becomes **Mounted**, detail "Editing SSD is connected.", path `/Volumes/Editing SSD`,
  toast "Test: Editing SSD is connected." The helper's `test()` only checks the volume and leaves
  `notMounted` with "The disk is connected and ready to mount." (`helper/Sources/StorageHelper/Engine.swift`
  lines 274–296); it never mounts or sets a path.
- Archive Share (SMB, no saved credentials). Click **Test**: the credentials sheet opens and the
  row becomes "Needs attention / Sign in to this share to continue." The helper's `test()` never
  asks for credentials; it checks TCP 445 and sets `notMounted` or `unreachable`.

Evidence: `flow-test-ssd-820.png`, `flow-test-archive-credentials-820.png`.
Why it fails: the preview is the evidence surface for this release and a person cannot tell a
Test from a mount. The report's "test result toasted" check is true, but the state it proves is
not the helper's.
Smallest fix: make `test_storage` in `ui/src/dev-fixture.ts` mirror the helper (`not_mounted`
"… is connected and ready to mount." / "… isn't connected.", no credentials prompt, no path),
or mark Test/credentials as preview-unproven and verify them on the packaged app.

### F3. Trust — Check for Updates contradicts the offered update

Repro: open Storage. Footer says "Version 0.2.0 is available" with the download icon. Click the
icon-only Check for Updates: "Checking for updates…" with a spinning icon (correct immediate
state), then **"Up to date"** and the download icon disappears. The fixture's `check_updates`
always returns `up-to-date`, regardless of the offered 0.2.0.
Evidence: `flow-update-checking-820.png`, `flow-update-checked-820.png`.
Why it fails: a person sees an offer withdrawn one second later with no explanation; the preview
cannot prove the update states truthfully.
Smallest fix: return `available` with 0.2.0 when the seeded offer is present, or return `failed`
with a reason; keep the line and the icon in step.

### F4. Craft / accessibility — focus falls to BODY after Undo and after the boot-error Retry

Measured at 820x640:
- Edit Archive Share → Remove → confirm → click **Undo**: the row is restored and the toast says
  "Restored Archive Share.", but `document.activeElement` is `BODY`; there is no focus ring.
  `flow-restored-detail-820.png`.
- `#view=storage&fail-boot=1` → click **Retry**: the list loads and `document.activeElement` is
  `BODY` (`flow-boot-retry-820.png`).
- In both the editor and What's New, Tab past the last enabled button lands on `BODY` for one
  press before wrapping into the dialog (`whatsnew-375-detail.png`).
Why it fails: the studio bar requires focus never to fall to BODY after a transition; keyboard
users lose their place after Undo and Retry.
Smallest fix: after Undo focus the restored row's Edit (or its row); after Retry focus the list
title or the first row; trap Tab inside an open dialog.

### F5. Craft — What's New opens focused on the scroll body and its ring is clipped at the sheet edge

At 375 and 820, What's New opens with focus on `.sheet-body` (the scroll container). Its 2 px
green outline is clipped by the dialog's `overflow: hidden`, so a green cap pokes out of the
sheet's right edge at 375 and a green rule runs under the subtitle at 820.
Evidence: `whatsnew-375-detail.png`, `whatsnew-820-detail.png`.
Why it fails: it reads as a stray artefact on an otherwise clean sheet, and focus opens on a
non-interactive scroll region rather than a control.
Smallest fix: focus the Close button (or the dialog container) on open and use an inset outline
(`outline-offset: -2px`) on scrollable regions.

### F6. Trust — the password toast stays "Trying…" after the row has already mounted

Repro: Test Archive Share → fill credentials → Save. The row shows **Mounted / Connected.**
with its path within 0.12 s, while the toast still says "Password saved. Trying Archive Share…"
at 1.6 s and stays for its full 8 s.
Evidence: `flow-credentials-saved-820.png`, `flow-credentials-1.6s-820.png`.
Why it fails: the immediate and terminal messages disagree; the request in round 2 was for the
row and the sign-in line to be truthful, which they now are, so this is the remaining stale copy.
Smallest fix: replace the toast text with "Archive Share mounted." on the mounted snapshot, or
shorten the toast to the save result.

### F7. Preview note — Undo restores a new internal id and drops the removed status

In the preview, Undo re-adds Archive Share as `s…` / "Not mounted" instead of the original
`archive` / "Needs attention" (`flow-restored-detail-820.png`). The Rust `save_storage` keeps a
supplied id, so this is a fixture-only divergence, but it makes the preview's Undo evidence
unrepresentative. Preserving the id and status in `dev-fixture.ts` would close the gap.

## Round 2 re-walk (the nine items the lead was asked to fix)

| # | Round 2 item | Result in this build |
| --- | --- | --- |
| 1 | Escape ×3 must never lose typed edits | Fixed. Change Name → Esc (prompt, focus Keep editing) → Esc (form, focus Name, draft kept) → Esc (prompt again, not a close); Keep editing keeps the draft; fast double Escape (150 ms) also returns to the form with the draft. `kb-fast-double-esc-820.png`, `kb-keep-editing-820.png`. |
| 2 | Focus after every transition | Fixed for Keep editing→Name, Browse dismissal→target, Remove Escape→Name, credentials close→row Test, Add saved→Add storage, What's New close→pill. Still fails after Undo and boot Retry (F4). |
| 3 | 375/820 Tab order nav → content → footer | Fixed. 375: nav-storage/general/appearance → add-storage → rows → footer (support, pill, check, download). 820: same with the sidebar order. General/Appearance/Support also follow the screen. `kb-taborder-375.png`, `kb-taborder-820.png`. |
| 4 | Preview must be truthful | Partly. Saving a password mounts the row and clears the sign-in line; Mount now on an uncredentialed share opens the credentials prompt. Test still invents a mount and a credentials prompt (F2). |
| 5 | A repeated Test still names its result | Fixed. Second Test on Studio NAS after the first toast clears shows "Test: nas.local is reachable." again. `flow-test-repeat-820.png`, `flow-test-studio-820.png`. |
| 6 | A newly added row is visible clear of the toast | Not fixed at 820x640: the toast covers Test and Edit for 8 s (F1). |
| 7 | Address placeholder readable at 375 | Fixed. Placeholder "e.g. smb://nas/studio" measures 126.2 px in a 173 px inner width; no clipping. `flow-add-375-address.png`. |
| 8 | Arrow keys move between sections | Fixed. From Storage, ArrowDown/ArrowRight move to General/Appearance; ArrowUp returns. `kb-nav-arrows-375.png`, `kb-nav-arrows-820.png`. |
| 9 | A mounting row's button says "Mounting…" | Fixed. Click Mount now on Editing SSD: chip "Mounting…", button "Mounting… (disabled)", then Mounted / "The disk is connected." `flow-mounting-label-820.png`. |

## Round 1 spot checks

- Duplicate blocking: `smb://nas.local/studio` blocks Save, target `aria-invalid="true"`, visible
  "This share is already added as Studio NAS." `flow-add-duplicate-820.png`.
- Restart helper: banner "The helper stopped responding. Restart helper"; click → banner gone,
  status line normal, toast "Helper started." `flow-engine-down-820.png`, `flow-engine-restarted-820.png`.
- Retries picker: native select with exactly 1–8; choosing 4 updates the sentence to "up to 4 more
  attempts…". `flow-general-changed-820.png`.
- Undo: row removed, toast "Removed Archive Share. Undo"; Undo restores a row and says "Restored
  Archive Share." (preview id/status caveat F7).
- Long names: an 82-character name at 375 wraps inside the row (row scrollWidth = clientWidth =
  341, no document overflow) and the row actions stay visible. `stress-long-375.png`.
- Footer geometry: at 820 the footer is the 236 px sidebar; download button x 197..219 inside it;
  Support above the version pill. `measure-*-820x640.png`.
- Row density: 1440 rows use the full width, actions right-aligned at x≈1395; no dead right half
  in the rows. `measure-storage-light-1440x900.png`.

## What holds (measured)

- No document horizontal overflow in 32 captures: all four pages × 375/768/820/1440 × light/dark
  (`scrollWidth == innerWidth`), main content reaches 375/768/820/1440, footer bottom equals the
  window bottom on all of them. `measure-*.png`.
- Contrast: lowest text/placeholder ratio 4.73:1 (the update line in light), all others ≥ 5.1:1 in
  light and ≥ 5.77:1 in dark; no text below 4.5:1. Disabled controls read normally.
- Every tested Tab stop shows a visible ring; row buttons carry storage-named aria-labels; nav and
  footer entries have icons (the pill is text, as specified).
- Dialogs stay inside the window: Add 820 = 170..650 × 8..632; Add 375 = 24..351 × 69..743;
  What's New 375 = 24..351 × 8..804 (body scrolls 1435/676); Edit 820 body scrolls 525/504.
  `dialog-*.png`, `whatsnew-*.png`.
- Empty first run names the next step ("No storage yet" + Add storage) at 820 and 375.
- Boot failure names the cause and offers Retry; Retry loads the list (focus caveat F4).
- Helper down: one banner, Restart helper, live status line, row mount/test/unmount disabled.
- Second instance: one toast, announced through the `role="status"` toaster, gone after ~10 s.
- Update failed (injected): footer names the cause and keeps the Check button; role="status".
- Retrying / needs attention / not mounted / unreachable rows all show a distinct chip and an
  enabled Mount now (manual restart), plus Test/Edit. `states-all-820.png`.
- No native `confirm`/`alert`/`prompt` fired across the walked flows; the preview console had no
  errors (only Vite debug lines).

## Not checked (do not read as passed)

- Native macOS behaviour: Cmd+W hides, Cmd+Q quits, menu-bar reopen, the real 820x640 frame,
  System appearance following macOS, WKWebView Escape/focus handling.
- The packaged app's Test, credential save, retry timing and update checks; all UI evidence above
  is the preview and F2/F3 show the preview still diverges from the helper there.
- VoiceOver announcements (the DOM roles were read, not heard).
- Native keyboard behaviour of the Retries select popup; Downloads/Open in Finder/donation
  external actions (preview no-ops; the real OS action was not observed).
- Reload with cached metadata: the preview rebuilds its fixture on every load, so there is no
  cache to inspect. No provider or network calls exist in the preview UI to trace.
- Real mount-table duplicate prevention (helper-side); the preview cannot exercise a real mount.

## Before a fresh critic reviews again

1. Fix F1: give the list enough bottom room that a newly added row clears the toast at 820x640;
   add a regression check that intersects every new-row action with the toast.
2. Fix F2 and F3: make the dev fixture's Test and Check for Updates produce the helper's real
   states, or record those two flows as unproven and verify them in the packaged app before the
   release evidence is called complete.
3. Fix F4/F5: restore focus after Undo and boot Retry, trap Tab inside open dialogs, and focus and
   ring What's New without the clipped edge.
4. Fix F6's stale password toast; F7 is preview-only but cheap.
5. Re-run the four-size layout/contrast pass and the Escape/focus set, then hand the build to a
   different fresh critic.

Skills used: ponytail (invoked) · graphify queries: none — this review was a headless UI
measurement; code reads were limited to selectors and the helper's Test semantics.
