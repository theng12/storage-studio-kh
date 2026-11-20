# Storage Studio KH — page acceptance

Run: 2026-11-20T00:49:12.923Z · app 0.1.10 · 311/311 checks passed

| Page | Check | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| Storage | heading | Storage | "Storage" | PASS |
| Storage | row count | 4 | 4 | PASS |
| Storage | real shares visible | Public Space-System pool in list | true | PASS |
| Storage | mounted state visible | Mounted chip | true | PASS |
| Storage | mounted path visible | real /Volumes path | true | PASS |
| Storage | footer pill | Storage Studio KH v0.1.10 | true | PASS |
| Audit | storage controls named |  | [] | PASS |
| Audit | storage no overflow | no horizontal overflow | 0 | PASS |
| Esc | closes the add dialog | no open dialog | true | PASS |
| Esc | dismisses Browse results | chooser gone, dialog open | true | PASS |
| Esc | asks before discarding typed edits | Discard changes? | true | PASS |
| Esc | discard closes the editor | dialog closed | true | PASS |
| Esc | Remove confirmation returns to the editor | editor still open without confirm | true | PASS |
| Storage | row Unmount invokes | unmount_storage | true | PASS |
| Storage | row Test invokes | test_storage | true | PASS |
| Storage | row Open in Finder invokes | reveal_storage | true | PASS |
| Storage | row Edit opens the editor | dialog open | true | PASS |
| Audit | storage no overflow at 700x520 | no horizontal overflow | 0 | PASS |
| Footer | aligned at 1440 light | support, row and status share one left edge | true | PASS |
| Footer | pill and update icon centred at 1440 light | same centre line | true | PASS |
| Footer | aligned at 1440 dark | support, row and status share one left edge | true | PASS |
| Footer | pill and update icon centred at 1440 dark | same centre line | true | PASS |
| Footer | pinned to the bottom at 375 light | footer bottom on the window edge | true | PASS |
| Footer | pill bottom-left at 375 light | pill in the left half near the bottom | true | PASS |
| Footer | pinned to the bottom at 375 dark | footer bottom on the window edge | true | PASS |
| Footer | pill bottom-left at 375 dark | pill in the left half near the bottom | true | PASS |
| Storage | dark theme applied | dark background and a different image | true | PASS |
| Attention | chip | Needs attention | true | PASS |
| Attention | address in reason | Address tried: smb:// | true | PASS |
| Attention | reason is readable (decoded) | no %20 in the reason | true | PASS |
| Attention | Mount now invokes | mount_storage | true | PASS |
| Attention | test result toasted | a Test: toast | true | PASS |
| Audit | attention no overflow at 700x520 | no horizontal overflow | 0 | PASS |
| Engine | banner on Storage | helper stopped sentence | true | PASS |
| Engine | status line admits the helper is down | Helper isn't running | true | PASS |
| Engine | status line shows when the helper last reported | Helper last reported | true | PASS |
| Engine | banner offers a way out | Restart helper button | true | PASS |
| Engine | banner on General | helper stopped sentence | true | PASS |
| Engine | banner on Appearance | helper stopped sentence | true | PASS |
| Engine | restart helper invokes | restart_helper | "restart_helper" | PASS |
| Engine | helper comes back | banner gone | true | PASS |
| Add | label says host + share | Share address (host + share) | true | PASS |
| Add | Save disabled with an empty name | disabled | true | PASS |
| Add | no error before the person types | no save reason | true | PASS |
| Add | name field not marked invalid on open | no aria-invalid | true | PASS |
| Add | placeholders read as examples | e.g. Studio NAS | true | PASS |
| Add | empty address asks for the device | Enter the device address first | true | PASS |
| Add | reason is a live region | role=status | true | PASS |
| Add | reason linked to Save | aria-describedby | true | PASS |
| Add | host-only keeps Save off | disabled | true | PASS |
| Add | host-only reason | Add the share name | true | PASS |
| Add | address marked invalid | aria-invalid | true | PASS |
| Add | Browse sends the host | list_shares | "list_shares" | PASS |
| Add | Browse sends address | address contains host | true | PASS |
| Add | chooser shows real names | Public Space-Media - 4TB - Music,Public Space-System pool | ["Public Space-Media - 4TB - Music","Public Space-System pool"] | PASS |
| Add | chooser names the host | Shares on 192.168.0.217 | true | PASS |
| Add | chooser offers both shares plus Dismiss | 3 | 3 | PASS |
| Add | picked address is encoded | smb://192.168.0.217/Public%20Space-Media%20-%204TB%20-%20Music | "smb://192.168.0.217/Public%20Space-Media%20-%204TB%20-%20Music" | PASS |
| Add | readable share line | Share: Public Space-Media - 4TB - Music | true | PASS |
| Add | Save enabled for a full address | enabled | true | PASS |
| Add | mount point cannot be typed | readonly | true | PASS |
| Add | mount point starts empty | blank | true | PASS |
| Add | Choose asks macOS for a folder | pick_mount_point | true | PASS |
| Add | the panel's folder fills the read-only field | /Volumes/Studio Projects | "/Volumes/Studio Projects" | PASS |
| Add | a chosen folder stays read-only | readonly | true | PASS |
| Add | Clear forgets the chosen folder |  | "" | PASS |
| Add | Clear leaves the share address alone | smb://192.168.0.217/Public%20Space-Media%20-%204TB%20-%20Music | true | PASS |
| Add | a cancelled panel leaves the mount point empty |  | "" | PASS |
| Add | a cancelled panel reports no error | no form error | true | PASS |
| Add | credential message | needs a user name and password | true | PASS |
| Add | credential note is a warning | field-note-warn | true | PASS |
| Add | browse error is an error note | field-note-error | true | PASS |
| Add | empty share list explained | didn't offer any shares | true | PASS |
| Add | browse without a host explains | Enter the device address first | true | PASS |
| Add | connected shares offered | at least one row | true | PASS |
| Add | connected pick fills encoded address | smb://vengtheng@100.69.137.42/Public%20Space-Media%20-%204TB%20-%20Music | "smb://vengtheng@100.69.137.42/Public%20Space-Media%20-%204TB%20-%20Music" | PASS |
| Add | connected list hides after the pick | 0 | 0 | PASS |
| Add | connected pick fills user | vengtheng | "vengtheng" | PASS |
| Add | password field still offered after a connected pick | password input present with a private-storage hint | true | PASS |
| Add | disk Save blocked | disabled | true | PASS |
| Add | disk reason | Choose a disk to reconnect. | true | PASS |
| Add | connected disks offered | options include real volumes | true | PASS |
| Add | disk choice shows mount point | /Volumes/ | true | PASS |
| Add | disk Save enabled | enabled | true | PASS |
| General | three settings rows | 3 | 3 | PASS |
| General | notifications toggle invokes | set_general | "set_general" | PASS |
| General | sends all three values | notifications/launchAtLogin/retries present | true | PASS |
| General | focus stays on the switch | general-notifications | true | PASS |
| General | retries offers 1 to 8 | 8 | 8 | PASS |
| General | retries saved | 5 | 5 | PASS |
| General | focus stays on the changed control | general-... | true | PASS |
| General | login item error shown | Move the app to Applications | true | PASS |
| Appearance | three choices | System, Light, Dark | true | PASS |
| Appearance | dark applies live | dark | "dark" | PASS |
| Appearance | invokes set_appearance | set_appearance | "set_appearance" | PASS |
| Appearance | light applies live | light | "light" | PASS |
| Appearance | arrow keys keep focus in the group | an appearance control | true | PASS |
| Appearance | arrow key selects the next choice | dark | "dark" | PASS |
| Updates | What's New opens | title | true | PASS |
| Updates | current version marked | Current version | true | PASS |
| Updates | pending update explained in What's New | notes appear after install | true | PASS |
| Esc | closes What's New | no open dialog | true | PASS |
| Updates | check icon invokes | check_updates | "check_updates" | PASS |
| Updates | checking state announced | Checking for updates | true | PASS |
| Updates | download icon appears | download button | true | PASS |
| Updates | download opens the Launcher | open_updater | "open_updater" | PASS |
| Updates | failed check shown honestly | Could not reach the Update Studio | true | PASS |
| Support | support page opens | donation copy | true | PASS |
| Support | donation button invokes | open_support | "open_support" | PASS |
| Empty | empty state teaches | No storage yet | true | PASS |
| Dialog | credentials prompt opens | user name and password fields | true | PASS |
| Dialog | the prompt names where the password is saved | secrets.json path | true | PASS |
| Dialog | focus starts inside the prompt | a credentials field | true | PASS |
| Dialog | save invokes set_credentials | set_credentials | "set_credentials" | PASS |
| Dialog | password never rendered in plain text after save | input type=password | true | PASS |
| Dialog | Esc closes only the prompt | dialog closed | true | PASS |
| Dialog | second instance noted once | already running | true | PASS |
| Dialog | second instance not repeated | single note | true | PASS |
| Layout | storage at 375: no horizontal overflow | 0 | "0" | PASS |
| Layout | storage at 375: content fills the width | main at least 335px | true | PASS |
| Layout | storage at 375: footer on the bottom edge | footer within the sidebar inset of the window edge | true | PASS |
| Layout | storage at 375: pill bottom-left | pill in the left half near the bottom | true | PASS |
| Layout | storage at 375: every nav item has an icon | 3 | 3 | PASS |
| Layout | Add storage fits at 375 | dialog inside the window | true | PASS |
| Layout | general at 375: no horizontal overflow | 0 | "0" | PASS |
| Layout | general at 375: content fills the width | main at least 335px | true | PASS |
| Layout | general at 375: footer on the bottom edge | footer within the sidebar inset of the window edge | true | PASS |
| Layout | general at 375: pill bottom-left | pill in the left half near the bottom | true | PASS |
| Layout | general at 375: every nav item has an icon | 3 | 3 | PASS |
| Layout | appearance at 375: no horizontal overflow | 0 | "0" | PASS |
| Layout | appearance at 375: content fills the width | main at least 335px | true | PASS |
| Layout | appearance at 375: footer on the bottom edge | footer within the sidebar inset of the window edge | true | PASS |
| Layout | appearance at 375: pill bottom-left | pill in the left half near the bottom | true | PASS |
| Layout | appearance at 375: every nav item has an icon | 3 | 3 | PASS |
| Layout | support at 375: no horizontal overflow | 0 | "0" | PASS |
| Layout | support at 375: content fills the width | main at least 335px | true | PASS |
| Layout | support at 375: footer on the bottom edge | footer within the sidebar inset of the window edge | true | PASS |
| Layout | support at 375: pill bottom-left | pill in the left half near the bottom | true | PASS |
| Layout | support at 375: every nav item has an icon | 3 | 3 | PASS |
| Layout | storage at 768: no horizontal overflow | 0 | "0" | PASS |
| Layout | storage at 768: content fills the width | main at least 508px | true | PASS |
| Layout | storage at 768: footer on the bottom edge | footer within the sidebar inset of the window edge | true | PASS |
| Layout | storage at 768: pill bottom-left | pill in the left half near the bottom | true | PASS |
| Layout | storage at 768: every nav item has an icon | 3 | 3 | PASS |
| Layout | Add storage fits at 768 | dialog inside the window | true | PASS |
| Layout | general at 768: no horizontal overflow | 0 | "0" | PASS |
| Layout | general at 768: content fills the width | main at least 508px | true | PASS |
| Layout | general at 768: footer on the bottom edge | footer within the sidebar inset of the window edge | true | PASS |
| Layout | general at 768: pill bottom-left | pill in the left half near the bottom | true | PASS |
| Layout | general at 768: every nav item has an icon | 3 | 3 | PASS |
| Layout | appearance at 768: no horizontal overflow | 0 | "0" | PASS |
| Layout | appearance at 768: content fills the width | main at least 508px | true | PASS |
| Layout | appearance at 768: footer on the bottom edge | footer within the sidebar inset of the window edge | true | PASS |
| Layout | appearance at 768: pill bottom-left | pill in the left half near the bottom | true | PASS |
| Layout | appearance at 768: every nav item has an icon | 3 | 3 | PASS |
| Layout | support at 768: no horizontal overflow | 0 | "0" | PASS |
| Layout | support at 768: content fills the width | main at least 508px | true | PASS |
| Layout | support at 768: footer on the bottom edge | footer within the sidebar inset of the window edge | true | PASS |
| Layout | support at 768: pill bottom-left | pill in the left half near the bottom | true | PASS |
| Layout | support at 768: every nav item has an icon | 3 | 3 | PASS |
| Layout | storage at 1440: no horizontal overflow | 0 | "0" | PASS |
| Layout | storage at 1440: content fills the width | main at least 1180px | true | PASS |
| Layout | storage at 1440: footer on the bottom edge | footer within the sidebar inset of the window edge | true | PASS |
| Layout | storage at 1440: pill bottom-left | pill in the left half near the bottom | true | PASS |
| Layout | storage at 1440: every nav item has an icon | 3 | 3 | PASS |
| Layout | Add storage fits at 1440 | dialog inside the window | true | PASS |
| Layout | general at 1440: no horizontal overflow | 0 | "0" | PASS |
| Layout | general at 1440: content fills the width | main at least 1180px | true | PASS |
| Layout | general at 1440: footer on the bottom edge | footer within the sidebar inset of the window edge | true | PASS |
| Layout | general at 1440: pill bottom-left | pill in the left half near the bottom | true | PASS |
| Layout | general at 1440: every nav item has an icon | 3 | 3 | PASS |
| Layout | appearance at 1440: no horizontal overflow | 0 | "0" | PASS |
| Layout | appearance at 1440: content fills the width | main at least 1180px | true | PASS |
| Layout | appearance at 1440: footer on the bottom edge | footer within the sidebar inset of the window edge | true | PASS |
| Layout | appearance at 1440: pill bottom-left | pill in the left half near the bottom | true | PASS |
| Layout | appearance at 1440: every nav item has an icon | 3 | 3 | PASS |
| Layout | support at 1440: no horizontal overflow | 0 | "0" | PASS |
| Layout | support at 1440: content fills the width | main at least 1180px | true | PASS |
| Layout | support at 1440: footer on the bottom edge | footer within the sidebar inset of the window edge | true | PASS |
| Layout | support at 1440: pill bottom-left | pill in the left half near the bottom | true | PASS |
| Layout | support at 1440: every nav item has an icon | 3 | 3 | PASS |
| Contrast | body text at light | at least 4.5:1 | 16.33:1 | PASS |
| Contrast | muted text at light | at least 4.5:1 | 7.3:1 | PASS |
| Contrast | quiet text at light | at least 4.5:1 | 5.13:1 | PASS |
| Contrast | chip text at light | at least 4.5:1 | 5.1:1 | PASS |
| Contrast | primary text at light | at least 4.5:1 | 6.41:1 | PASS |
| Contrast | border at light | measured (decorative) | 1.53:1 | PASS |
| Contrast | planes at light | measured (decorative) | 1.22:1 | PASS |
| Contrast | body text at dark | at least 4.5:1 | 12.6:1 | PASS |
| Contrast | muted text at dark | at least 4.5:1 | 8.01:1 | PASS |
| Contrast | quiet text at dark | at least 4.5:1 | 7.14:1 | PASS |
| Contrast | chip text at dark | at least 4.5:1 | 7.91:1 | PASS |
| Contrast | primary text at dark | at least 4.5:1 | 8.92:1 | PASS |
| Contrast | border at dark | measured (decorative) | 1.28:1 | PASS |
| Contrast | planes at dark | measured (decorative) | 1.07:1 | PASS |
| View | cards is the default view | storage cards | true | PASS |
| View | switching to Table invokes | set_list_view | "set_list_view" | PASS |
| View | the table renders | a storage table | true | PASS |
| View | the table's first column is pinned | sticky | true | PASS |
| View | switching back shows cards | cards again | true | PASS |
| View | duplicate storage rows are deduped | 4 | 4 | PASS |
| View | the row shows how many entries share it | ×2 | true | PASS |
| Warnings | warnings are grouped by kind with counts | Needs a password 1 and Can't be reached 1 | true | PASS |
| Warnings | no repeated warning line | 2 | 2 | PASS |
| Warnings | Show focuses the affected row | a row control | true | PASS |
| Keys | Return saves a complete form | save_storage | true | PASS |
| Dialog | a click outside keeps typed input | editor still open | true | PASS |
| Dialog | Escape asks before discarding | Discard changes? | true | PASS |
| Dialog | Keep editing returns to the form | typed name still there | true | PASS |
| Dialog | Discard closes the editor | no open dialog | true | PASS |
| Add | duplicate share keeps Save off | disabled | true | PASS |
| Add | duplicate names the existing storage | already added as Public Space-Media - 4TB - Music | true | PASS |
| Add | saving names the result | Added New share. | true | PASS |
| Add | the new row is brought into view | row inside the visible list | true | PASS |
| Add | the new row is marked briefly | is-new class | true | PASS |
| Remove | removal removes the row | one fewer storage | true | PASS |
| Remove | removal offers Undo | Undo button | true | PASS |
| Remove | Undo takes keyboard focus after Remove | the Undo toast button | true | PASS |
| Remove | Undo puts the storage back | Public Space-Media - 4TB - Music returned | true | PASS |
| Remove | Undo leaves focus on the restored row | row-s1794488987703-menu | true | PASS |
| Dialog | saving a password says what happens next | Password saved. Trying | true | PASS |
| Dialog | the Trying note ends when the share answers | no stale Trying toast | true | PASS |
| Esc | first Escape asks before discarding | Discard changes? | true | PASS |
| Esc | second Escape returns to the form | edits still there | true | PASS |
| Esc | returning from the prompt focuses the name field | editor-name | true | PASS |
| Esc | third Escape asks again instead of closing | Discard changes? | true | PASS |
| Esc | no edits were lost | dialog still open with the typed name | true | PASS |
| Esc | Keep editing keeps the typed name and focus | Changed name in editor-name | true | PASS |
| Dialog | Browse dismissal returns focus to the address | target field | true | PASS |
| Dialog | Remove return focuses the form | editor-name | true | PASS |
| Dialog | closing the password prompt focuses the row | row menu control | true | PASS |
| Dialog | saving focuses the new row, not an off-screen opener | row menu | true | PASS |
| Dialog | closing What's New focuses the pill | pill | true | PASS |
| Layout | 375 Tab order is nav, content, footer | DOM order matches the screen | true | PASS |
| Keys | arrow keys move between sections | General focused and shown | true | PASS |
| Storage | a repeated Test still names its result | one replaced Test toast with a result | true | PASS |
| Storage | a mounting row offers Stop trying | Stop trying | true | PASS |
| Storage | Stop trying is not a dead disabled button | enabled | true | PASS |
| Storage | Stop trying invokes | cancel_storage | true | PASS |
| Storage | a stopped mount says Not mounted | Not mounted | true | PASS |
| Storage | a stopped mount says it stopped | Stopped trying | true | PASS |
| Dialog | saved password mounts the share in the preview | Mounted chip and no stale sign-in line | true | PASS |
| Add | the new row's actions are clear of the toast | no intersection at 820x640 | true | PASS |
| Storage | a Test reports without mounting | the chip still says Unreachable | true | PASS |
| Storage | a Test never asks for a password | no credentials sheet | true | PASS |
| Updates | a check keeps an available update | still offers 0.2.0 with its download control | true | PASS |
| Boot | Retry leaves focus on the restored page | main | true | PASS |
| Dialog | Tab wraps inside the editor | focus stays in the sheet | true | PASS |
| Updates | What's New opens with Close focused | close button | true | PASS |
| Updates | closing What's New restores the pill | pill | true | PASS |
| Keys | Test returns keyboard focus to the row menu | row-s1794488987703-menu | true | PASS |
| Keys | Unmount moves keyboard focus to Mount now | row-s1794488987703-mount | true | PASS |
| Keys | Check for Updates keeps keyboard focus | check | true | PASS |
| Keys | Restart helper lands on a control, not BODY | nav-storage | true | PASS |
| Completeness | reconnect flags are saved | reconnectAfterWake false | true | PASS |
| Completeness | editing saves the new name | Renamed share row | true | PASS |
| Add | Edit does not offer the connected-share picker | 0 | 0 | PASS |
| Completeness | forget the saved password is offered | a checkbox | true | PASS |
| Completeness | forget disables the password field | password input disabled | true | PASS |
| Completeness | forget sends remove_credentials | removeCredentials true | true | PASS |
| Completeness | the forget toast names the forgotten password | forgotten | true | PASS |
| Completeness | after forgetting, the field does not promise a saved password | no keep phrase | true | PASS |
| Completeness | the forget control disappears once nothing is saved | 0 | 0 | PASS |
| Completeness | declared page capabilities have controls | all present | true | PASS |
| Completeness | General capabilities have controls | notifications, login, retries | true | PASS |
| Completeness | Appearance has exactly three controls | System/Light/Dark | true | PASS |
| Add | an uppercase scheme is refused with the same message | Use an smb:// address | true | PASS |
| Storage | opening another row's menu resets the first | aria-expanded false | true | PASS |
| Remove | the row menu offers Remove | a confirmation | true | PASS |
| Remove | menu Remove removes the row | 3 | 3 | PASS |
| Remove | menu Remove can be undone | Public Space-Media - 4TB - Music returned | true | PASS |
| Storage | the list says what was checked and when | Storage list checked | true | PASS |
| Footer | the version pill carries an icon | an svg | true | PASS |
| Add | a missing disk is not called connected | isn't connected | true | PASS |
| View | at 375 the table shows a row action at rest | menu inside the wrap | true | PASS |
| Keys | Check for Updates never drops focus | check during and after | true | PASS |
| Remove | removing a ×2 row clears its duplicate | no Old copy, three rows | true | PASS |
| Engine | helper-down at 375 scrolls the content, not the window | window stays put, footer pinned, content scrolls | true | PASS |
| View | the table's row actions stay on one line | primary and menu share a top | true | PASS |
| Keys | the editor's Test keeps focus on its button | editor-test | true | PASS |
| Add | a trailing slash is the same share | Save disabled with the duplicate reason | true | PASS |
| Add | percent escapes are the same share | Save disabled with the duplicate reason | true | PASS |
| Add | equivalent address refused: 100.69.137.42:445/Public%20S | Save disabled with the duplicate reason | true | PASS |
| Add | equivalent address refused: 100.69.137.42/Public%20Space | Save disabled with the duplicate reason | true | PASS |
| Add | equivalent address refused: 100.69.137.42/./Public%20Spa | Save disabled with the duplicate reason | true | PASS |
| View | the table keeps Actions visible at 820 | menu inside the wrap | true | PASS |
| View | the table drops Address at 820 (Cards carries it) | Address hidden | true | PASS |
| View | a table row's menu opens | menu items | true | PASS |
| View | arrow keys move inside the row menu | a different item | true | PASS |
| Add | at 375 the toast clears the footer | toast above the footer | true | PASS |
| Add | at 375 the version pill stays clickable | pill is the topmost control | true | PASS |
| Boot | the boot error focuses Retry | retry-boot | true | PASS |
| Boot | the boot error hides navigation | 0 | 0 | PASS |
| Boot | the navigation comes back after Retry | 3 | 3 | PASS |
| Remove | a timed-out Undo leaves focus on a real control | add-storage | true | PASS |
| Keys | the first Tab reaches the navigation | nav-storage | true | PASS |
| Keys | Tab wraps from the footer to the navigation | nav-storage | true | PASS |
| Layout | adding at 375 keeps the window pinned | document height equals the viewport | true | PASS |
| Layout | focus after saving is on screen at 375 | the focused control is visible | true | PASS |
| Layout | adding at 820 keeps the window pinned | document height equals the viewport | true | PASS |
| View | at 768 the table fits and shows the row menu | no horizontal overflow, menu inside | true | PASS |
| Remove | Undo restores a still-mounted share as mounted | Mounted chip | true | PASS |
| Layout | long name wraps instead of clipping | 0 | 0 | PASS |
| Layout | long name adds no page overflow at 375 | 0 | 0 | PASS |
| Footer | download control stays inside at 768 | right edge within the window | true | PASS |
| Footer | download control stays inside at 1440 | right edge within the window | true | PASS |
| Storage | row controls name their storage | each accessible name includes the share name | true | PASS |
| Storage | status line summarises the list | 4 storages, all mounted. | true | PASS |
| Appearance | segmented control is content-sized | narrower than 400 | true | PASS |
| Appearance | three equal segments | 3 | 3 | PASS |
| Appearance | the settings row fills the page | row wider than 500 at 820 | true | PASS |

## Screenshots

- tests/acceptance/screenshots/storage/list-light-820x640.png
- tests/acceptance/screenshots/storage/list-light-700x520.png
- tests/acceptance/screenshots/footer/footer-light-1440x900.png
- tests/acceptance/screenshots/footer/footer-dark-1440x900.png
- tests/acceptance/screenshots/footer/footer-light-375x812.png
- tests/acceptance/screenshots/footer/footer-dark-375x812.png
- tests/acceptance/screenshots/storage/list-dark-820x640.png
- tests/acceptance/screenshots/attention/attention-light-820x640.png
- tests/acceptance/screenshots/attention/attention-light-700x520.png
- tests/acceptance/screenshots/engine/engine-down-appearance-light-820x640.png
- tests/acceptance/screenshots/add/add-validation-light-820x640.png
- tests/acceptance/screenshots/add/add-host-only-light-820x640.png
- tests/acceptance/screenshots/add/add-browse-chooser-light-820x640.png
- tests/acceptance/screenshots/add/add-mount-point-light-820x640.png
- tests/acceptance/screenshots/add/add-browse-credentials-light-820x640.png
- tests/acceptance/screenshots/add/add-browse-error-light-820x640.png
- tests/acceptance/screenshots/add/add-browse-empty-light-820x640.png
- tests/acceptance/screenshots/add/add-connected-light-820x640.png
- tests/acceptance/screenshots/add/add-connected-picked-light-820x640.png
- tests/acceptance/screenshots/add/add-disk-light-820x640.png
- tests/acceptance/screenshots/add/add-validation-dark-820x640.png
- tests/acceptance/screenshots/general/general-light-820x640.png
- tests/acceptance/screenshots/general/general-dark-820x640.png
- tests/acceptance/screenshots/general/general-login-error-light-820x640.png
- tests/acceptance/screenshots/appearance/appearance-dark-820x640.png
- tests/acceptance/screenshots/updates/whats-new-pending-update-light-820x640.png
- tests/acceptance/screenshots/updates/whats-new-light-820x640.png
- tests/acceptance/screenshots/updates/update-available-light-820x640.png
- tests/acceptance/screenshots/updates/update-failed-light-820x640.png
- tests/acceptance/screenshots/support/support-light-820x640.png
- tests/acceptance/screenshots/empty/empty-light-820x640.png
- tests/acceptance/screenshots/dialog/credentials-light-820x640.png
- tests/acceptance/screenshots/layout/storage-375x812.png
- tests/acceptance/screenshots/layout/editor-375x812.png
- tests/acceptance/screenshots/layout/general-375x812.png
- tests/acceptance/screenshots/layout/appearance-375x812.png
- tests/acceptance/screenshots/layout/support-375x812.png
- tests/acceptance/screenshots/layout/storage-768x900.png
- tests/acceptance/screenshots/layout/editor-768x900.png
- tests/acceptance/screenshots/layout/general-768x900.png
- tests/acceptance/screenshots/layout/appearance-768x900.png
- tests/acceptance/screenshots/layout/support-768x900.png
- tests/acceptance/screenshots/layout/storage-1440x900.png
- tests/acceptance/screenshots/layout/editor-1440x900.png
- tests/acceptance/screenshots/layout/general-1440x900.png
- tests/acceptance/screenshots/layout/appearance-1440x900.png
- tests/acceptance/screenshots/layout/support-1440x900.png
- tests/acceptance/screenshots/view/table-light-820x640.png
- tests/acceptance/screenshots/add/add-saved-feedback-light-820x640.png
- tests/acceptance/screenshots/stress/long-name-375x812.png
- tests/acceptance/screenshots/appearance/appearance-light-820x640.png
