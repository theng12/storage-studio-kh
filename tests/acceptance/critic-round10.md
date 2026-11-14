# Storage Studio KH 0.1.10 — fresh critic, round 10

Reviewer: independent studio critic (did not design or implement). No fixes made.
Commit: `3b005c6` (`/Users/you/Developer/My Own Apps/storage-studio-kh`).
Test surface: Vite dev server at `http://localhost:1420/?acceptance=1` with documented hash fixtures, driven by headless Chromium (`/Users/you/Developer/My Own Apps/music-studio-kh/node_modules/playwright`, Chromium 1248). No visible app window opened, no app activated, no pointer/keyboard left the page, owner's live app data untouched.

Evidence (this round): `tests/acceptance/critic/round10/` — 108 screenshots (`page-*`, `state-*`, `tab-*`, flow/dialog captures) plus `evidence.json`, `evidence-b.json`, `evidence-d.json` (automated measurements/traces). Prior evidence read/verified by reference: `tests/acceptance/report.md` (298/298), `critic-round1..9.md`, `contrast-0.1.10.md`, `completeness-0.1.10.md`.

## Verdict: PASS

| Area | Score /4 | Basis |
|---|---:|---|
| Usability | 4 | One read answers what this is, what happened, and what to do next across normal, empty, helper-down, boot-failure and dialog states. |
| Usage flow | 4 | Add, mount/unmount, Open in Finder, Test (repeat), edit, remove+undo (row menu and editor), credentials/forget, duplicate handling, view switch, helper restart, and boot retry are traceable with immediate/terminal feedback in observed flows. |
| Functionality | 4 | Observed states/data are consistent with fixture truth and actions invoked; no silent failure seen; failures name cause; actionable states present. Round-9 stale password claim is fixed. |
| Craft | 4 | No document overflow/footer drift/dialog escape at 375/768/820/1440 in light/dark for required states; table no longer pans at 768; Appearance uses width at 1440; keyboard focus/tab cycle and dialog containment hold in measured flows. |
| Trust | 4 | Status/checked line names subject and absolute time; failures name causes; password-forget copy is honest; Appearance copy no longer overclaims "always". |

## Round 9 failures re-walked (all fixed)

1. **Tab order skipped navigation and had a BODY stop** — **Fixed.**
   - 375×812 (`tab-storage-375x812.png`, `evidence.json` trace `tab-storage-375`): Tab sequence 1–18 = `nav-storage`, `nav-general`, `nav-appearance`, `add-storage`, two warning "Show" controls, view switch, six row actions, `Support this app`, version/What's New pill, Check for Updates, Download update, then wraps to `nav-storage`. No `BODY` stop. All three nav items visited before/with cycle wrap; nav reached before content (`navIndex=0`, `addIndex=3`). After boot-fail Retry, focus landed on `BUTTON fk=nav-storage` (not BODY/main).
   - 820×640 (`tab-storage-820x640.png`, trace `tab-storage-820`): same order/cycle characteristics; no BODY; focus after Retry `nav-storage`.

2. **Forgotten-password placeholder still promised a saved one** — **Fixed.**
   - Edit `studio-nas` (had credentials) → checked `Forget the saved password` → Save: toast `["Saved Studio NAS. The saved password was forgotten."]`. Reopened Edit (`forget-reopen.png`, `evidence.json` `forgetBefore/forgetAfter`): forget checkbox absent (`hasForget=false`), password placeholder `"Stored privately by Storage Studio KH"` (no "keep the saved one"), dialog no longer claims a saved password. Honest state.

3. **Appearance dead right half at 1440** — **Fixed.**
   - 1440×900 light (`appearance-1440-light.png`, trace `appearance1440`): main `w=1204`, segmented control `w=330`, settings row `w=1146/right=1411`; dead right `45px` (~3.7% of main), not a void. Content/controls fill the settings row width.

4. **6 px table pan at 768** — **Fixed.**
   - 768×900 table (`table-768.png`, trace `table768`): wrapper `.storage-table-wrap` `sw=474 cw=474 sl=0`, doc `sw=768 cw=768`; row menu `right=727` inside wrapper `right=740`. No horizontal pan/scroll overflow.

5. **Appearance "always uses … look" overclaim** — **Fixed.**
   - Copies observed (`evidence-b.json` traces): System — "This window follows your Mac's light or dark appearance." Light — "This window is using the light look." Dark — "This window is using the dark look." No "always" in any mode (`appearance-1440-light.png`, `appearance-1440-dark-selected.png`, `appearance-choices.png`).

## Measured checks (headless, this round)

- **Layout/overflow/footer pinned/dialog inside** at 375×812, 768×900, 820×640, 1440×900 in light and dark: Storage/General/Appearance/Support pages and states `list=cards`, `list=table`, `empty=1`, `add=1`, `engine-down=1`, `engine-down=1&add=1` all measured `sw==cw`, `sh==ch` (or doc fits viewport as applicable), `wx=0`, footer bottom at viewport edge. Dialogs (add/helper-down+add, What's New, credentials) inside viewport (e.g. add 375: inside 375×812; add 820: inside 820×640; What's New 375: `x=24,y=8,w=327,h=796,bottom=804`). Screenshots: `page-*-{light,dark}-{375x812,768x900,820x640,1440x900}.png`, `state-*-{light,dark}-*.png`, `whatsnew-375.png`, `add-open-375.png`, `helper-down.png`.
- **Table at 375** (`table-375.png`, `evidence-d.json`): doc `sw=375 cw=375 wx=0`, wrap `sw=341 cw=341 sl=0`; columns hidden deliberately (Status/Address/Mounted at/Reconnects hidden), Storage and Actions visible.
- **Table at 820**: wrapper `sw=cw=526`, row menu right edge inside wrapper (`table820` probe: wrap right 792, menu right 779).
- **Content fill 1440**: Storage cards rows/content fill main width (dead right ~28px, `storage-cards-1440-measure.png`); General settings rows fill width (dead right ~28px); Appearance row fills (dead right ~45px).
- **Keyboard/dialog behavior**: add dialog tab cycle stayed inside sheet (`addTab375` trace, 12 steps, all in dialog); credentials tab stayed inside sheet (`credentialsTab`, 6 steps). Row menu opened, ArrowDown/Home/End moved focus, Escape closed and focus returned to trigger (`row-studio-nas-menu`), outside click closed (`row-menu-open.png`). Row menus measured inside viewport at 375/768/820/1440. Add at 375: typed change + Escape asked "Discard changes?" (`add-discard-ask-375.png`), Keep editing preserved input, Return/save invoked `save_storage`, doc fit `375×812` after save, focus on new row menu on screen (`add-after-save-375.png`). What's New focused Close and Escape closed, returning control to flow.
- **Flows exercised**: Open in Finder invoked `reveal_storage`; Mount now invoked `mount_storage` (`mount-archive.png`); Unmount invoked; Test invoked twice (`test-once.png`, `test-twice.png`); Edit opened/saved name; Remove offered Undo and Undo restored row including mounted state for `studio-nas` (`remove-confirm.png`, `remove-after.png`, `remove-undone.png`); editor remove offered Undo; duplicate address blocked with reason (`duplicate-detection.png`); cards/table view switch worked (`view-table-switched.png`, `view-cards-switched.png`); helper down banner present and Restart helper cleared it (`helper-down.png`, `helper-restarted.png`); credentials prompt opened, tab trapped, Escape closed; credential save command invoked and fixture transitioned row to Mounted/Connected (observed state). Boot failure named and Retry recovered to storage list (`boot-fail.png`, `boot-retry-recovered.png`). Empty state named next step (`empty-state.png`).
- **Chrome/footer/icons/copy** (`chrome-audit-820.png`, traces): nav items 3/3 with SVGs (Storage/General/Appearance). Footer: "Support this app" button with SVG present in footer; version pill `Storage Studio KH v0.1.10` with SVG bottom-left (e.g. 375 pill `x=12 bottom=781.2` in footer ending at 812; 820/1440 pill at bottom-left of footer); Check for Updates icon-only with accessible name `aria-label="Check for Updates"` and SVG; download control present when update offered. Appearance choices exactly `System/Light/Dark`.
- **Contrast (computed, this run, `evidence-b.json`)**: light body 14.19, h1 15.65, nav 5.36, muted/lede 7.30, row text 16.33, quiet/footer 5.13:1; dark body 15.86, h1 13.96, nav 6.69, muted 8.01, row text 12.60, quiet 7.14:1 (all ≥4.5:1). Consistent with `contrast-0.1.10.md` intent.
- **Status/trust text**: Storage summary `1 of 3 storages mounted, 1 needs attention, 1 unreachable.`; checked line `Storage list checked just now` with title `Storage list last read 11/14/2026, 8:08:55 AM` (`checked-status-evidence.png`). Failure/detail states name causes (e.g. "The share couldn't be reached after three tries.", "The disk isn't connected right now.", helper stopped/responding, boot read error).

## Completeness gates (headless scope)

- **Task list / controls spot-checked this round**: add share flow, mount/unmount, Open in Finder, Test + repeat, edit, remove+undo (row menu and editor), credentials prompt save path, forget password, view switch, duplicate handling, helper restart, boot retry, empty state. `tests/acceptance/report.md` (298/298) and `completeness-0.1.10.md` record broader automated coverage including browse/connected shares/disk picker specifics, settings persistence in session, warnings grouping/dedupe, updates/What’s New/support commands, and layout/contrast matrix; those automated results align with this round’s measurements and no regression was observed in exercised flows.
- **Capability cross-check (§2)**: controls/elements observed for storage list actions, add/edit dialogs, view switch, helper restart, appearance choices, footer support/version/check/download, warnings and checked/summary lines — consistent with declared capabilities in completeness doc.
- **Standard comparison (§3)**: no newly observed missing control beyond items marked deliberately absent in `completeness-0.1.10.md`; not re-litigated here.

## Not checked (never to be read as passed)

- Packaged macOS app, native gate on `story-mini`, DMG/build artifacts, update download/install flow, served feed 1301/read-back, menu-bar reopen (`RunEvent::Reopen`), LaunchAtLogin/Login Items real behavior, 0600 secrets file on disk, and any native window/menu behavior.
- Real SMB/disk connectivity, reconnect after wake/login in the live helper, truly missing mounted path behavior where `reveal_storage` would fail, and owner’s live app data or real network shares (all exercised via headless dev fixture/mocked commands).
- Persistence of Cards/Table choice and General/Appearance settings across a real app relaunch (fixture seeds from URL/state; in-session commands observed).
- Focus order and keyboard behavior inside packaged WebView and macOS system/menu shortcuts.
- Full VoiceOver/screen-reader announcements beyond accessible names/labels/text observed in DOM/snapshots.

## Defects

None found in this headless review against the stated studio bar and round-9 regressions.

## Final verdict

**PASS — 5×4/4. Ship it as-is on the basis of this headless release verdict.** (Unverified packaged/native/runtime items remain explicitly not checked above, not passed.)

Skills used: ponytail · efficient-orchestration · graphify queries: none — no Storage Studio graph exists
