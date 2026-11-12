# Storage Studio KH — page acceptance

Run: 2026-11-12T16:17:55.942Z · app 0.1.6 · 96/96 checks passed

| Page | Check | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| Storage | heading | Storage | "Storage" | PASS |
| Storage | row count | 4 | 4 | PASS |
| Storage | real shares visible | Public Space-System pool in list | true | PASS |
| Storage | mounted state visible | Mounted chip | true | PASS |
| Storage | mounted path visible | real /Volumes path | true | PASS |
| Storage | footer pill | Storage Studio KH v0.1.6 | true | PASS |
| Audit | storage controls named |  | [] | PASS |
| Audit | storage no overflow | no horizontal overflow | 0 | PASS |
| Esc | closes the add dialog | no open dialog | true | PASS |
| Esc | dismisses Browse results | chooser gone, dialog open | true | PASS |
| Esc | closes the editor after dismissing results | dialog closed | true | PASS |
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
| Footer | aligned at 375 light | support, row and status share one left edge | true | PASS |
| Footer | pill and update icon centred at 375 light | same centre line | true | PASS |
| Footer | aligned at 375 dark | support, row and status share one left edge | true | PASS |
| Footer | pill and update icon centred at 375 dark | same centre line | true | PASS |
| Storage | dark theme applied | dark background and a different image | true | PASS |
| Attention | chip | Needs attention | true | PASS |
| Attention | address in reason | Address tried: smb:// | true | PASS |
| Attention | reason is readable (decoded) | no %20 in the reason | true | PASS |
| Attention | Mount now invokes | mount_storage | true | PASS |
| Attention | test result toasted | a Test: toast | true | PASS |
| Audit | attention no overflow at 700x520 | no horizontal overflow | 0 | PASS |
| Engine | banner on Storage | helper stopped sentence | true | PASS |
| Engine | banner on General | helper stopped sentence | true | PASS |
| Engine | banner on Appearance | helper stopped sentence | true | PASS |
| Add | label says host + share | Share address (host + share) | true | PASS |
| Add | Save disabled with an empty name | disabled | true | PASS |
| Add | name reason beside Save | Give this storage a name. | true | PASS |
| Add | name field marked invalid | aria-invalid | true | PASS |
| Add | reason linked to Save | aria-describedby | true | PASS |
| Add | empty address asks for the device | Enter the device address first | true | PASS |
| Add | reason is a live region | role=status | true | PASS |
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
| Add | credential message | needs a user name and password | true | PASS |
| Add | credential note is a warning | field-note-warn | true | PASS |
| Add | browse error is an error note | field-note-error | true | PASS |
| Add | empty share list explained | didn't offer any shares | true | PASS |
| Add | browse without a host explains | Enter the device address first | true | PASS |
| Add | connected shares offered | at least one row | true | PASS |
| Add | connected pick fills encoded address | smb://vengtheng@100.69.137.42/Public%20Space-Media%20-%204TB%20-%20Music | "smb://vengtheng@100.69.137.42/Public%20Space-Media%20-%204TB%20-%20Music" | PASS |
| Add | connected list hides after the pick | 0 | 0 | PASS |
| Add | connected pick fills user | vengtheng | "vengtheng" | PASS |
| Add | password field still offered after a connected pick | password input present with Keychain hint | true | PASS |
| Add | disk Save blocked | disabled | true | PASS |
| Add | disk reason | Choose a disk to reconnect. | true | PASS |
| Add | connected disks offered | options include real volumes | true | PASS |
| Add | disk choice shows mount point | /Volumes/ | true | PASS |
| Add | disk Save enabled | enabled | true | PASS |
| General | three settings rows | 3 | 3 | PASS |
| General | notifications toggle invokes | set_general | "set_general" | PASS |
| General | sends all three values | notifications/launchAtLogin/retries present | true | PASS |
| General | retries saved | 5 | 5 | PASS |
| General | login item error shown | Move the app to Applications | true | PASS |
| Appearance | three choices | System, Light, Dark | true | PASS |
| Appearance | dark applies live | dark | "dark" | PASS |
| Appearance | invokes set_appearance | set_appearance | "set_appearance" | PASS |
| Appearance | light applies live | light | "light" | PASS |
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
| Dialog | focus starts inside the prompt | a credentials field | true | PASS |
| Dialog | save invokes set_credentials | set_credentials | "set_credentials" | PASS |
| Dialog | password never rendered in plain text after save | input type=password | true | PASS |
| Dialog | Esc closes only the prompt | dialog closed | true | PASS |
| Dialog | second instance noted once | already running | true | PASS |
| Dialog | second instance not repeated | single note | true | PASS |

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
