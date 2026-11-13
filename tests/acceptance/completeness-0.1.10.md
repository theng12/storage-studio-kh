# Storage Studio KH 0.1.10 — completeness gates

Reference: `completeness-gates.md` in `efficient-orchestration` 0.3.3. Three checks before the
Storage page's gate. The jobs are asserted through the real command contract (the acceptance run's
fixture implements `docs/contract.md`; the same commands are exercised against the packaged app by
the gate on the test Mac).

## 1. Task list, one end-to-end test per job

| Job on the Storage page | Automated end-to-end test (tests/acceptance/run.cjs) |
| --- | --- |
| Add an SMB share (name + `smb://` address) | `Save enabled for a full address`, `Return saves a complete form`, `saving names the result`, `the new row's actions are clear of the toast` |
| Add an attached disk (connected volume) | `disk Save enabled`, `disk choice shows mount point` |
| Browse a device and pick a share | `chooser shows real names`, `picked address is encoded`, `chooser names the host` |
| Reject an invalid address (scheme/share name) | `host-only reason`, `host-only keeps Save off`, `http://` message (web tests) |
| Mount an unmounted storage | `Mount now invokes`, `a mounting row says Mounting on its button` |
| Unmount a mounted storage | `row Unmount invokes`, `Unmount moves keyboard focus to Mount now` |
| Test reachability without mounting | `row Test invokes`, `a Test reports without mounting`, `a repeated Test still names its result` |
| Edit a storage's name and flags | `row Edit opens the editor`, `editing saves the new name` |
| Reconnect at login / after wake | `reconnect flags are saved` |
| Remove with recovery | `removal offers Undo`, `Undo puts the storage back`, `Undo leaves focus on the restored row` |
| Enter credentials when prompted | `saved password mounts the share in the preview`, `saving a password says what happens next`, `the Trying note ends when the share answers` |
| Forget a saved password | `forget the saved password is offered`, `forget sends remove_credentials` |
| Duplicate protection | `duplicate share keeps Save off`, `duplicate names the existing storage` |
| Switch Cards / Table and remember it | `switching to Table invokes` (`set_list_view`), `the table's first column is pinned`, `switching back shows cards` |
| Group warnings, dedupe rows | `warnings are grouped by kind with counts`, `duplicate storage rows are deduped`, `the row shows how many entries share it` |
| Helper down → recovery | `banner offers a way out`, `restart helper invokes`, `helper comes back` |
| Check for updates / What's New / Support | `check icon invokes`, `a check keeps an available update`, `What's New opens`, `donation button invokes` |
| General settings (notifications, login, retries) | `notifications toggle invokes`, `retries saved`, `login item error shown` |
| Appearance System / Light / Dark | `three choices`, `dark applies live`, `light applies live`, `arrow key selects the next choice` |

## 2. Capability cross-check (from the live snapshot and PRODUCT.md)

| Declared capability | Control / behaviour | Status |
| --- | --- | --- |
| Share and disk kinds | Kind segmented control; disk picker from `snapshot.volumes` | Present |
| Share address and Browse | Address field; `list_shares` + chooser from live data | Present |
| Name, mount point | Name and Mount point fields | Present |
| Credentials | User name / password fields, stored in the app's 0600 file; prompt on demand | Present |
| Forget saved credentials | “Forget the saved password” in Edit when `hasCredentials` | Present (added 0.1.10) |
| Mount now / Unmount | Row primary (unmounted) / row menu (mounted) | Present |
| Test | Row menu; result named in a toast | Present |
| Open in Finder | Row primary (mounted) | Present |
| Edit / Remove | Row menu; Remove confirmation + Undo | Present |
| Reconnect at login / after wake | Two checkboxes in the editor | Present |
| Six status states | Chip per row from `StorageView.status` | Present |
| Helper state and restart | Banner + Restart helper; status line says helper stopped | Present |
| Updates, What's New | Footer check/download icons; version pill | Present |
| Support | Footer row + Support page | Present |
| Appearance System / Light / Dark | Appearance page radios | Present |
| Cards / Table list | Remembered switch; `listView` in the snapshot | Present |
| Notifications, launch at login, retries | General page controls | Present |
| Second instance | In-app note (toast) on `secondInstance` | Present (documented notice) |
| Duplicate entries in older data | Deduped rows with a ×N count | Present |

No declared capability is left without a control or the documented second-instance notice.

## 3. Standard-practice comparison

References: macOS Finder › Go › Connect to Server, AutoMounter (the category leader for automatic
mounting), and macOS System Settings › General › Login Items & Extensions.

| Expected on this screen | State |
| --- | --- |
| Server address + browse | Present |
| Credentials, saved per server | Present (private 0600 file, never Keychain) |
| Saved servers, add/edit/remove | Present |
| Per-server status | Present (six states, never colour alone) |
| Mount / unmount / reveal | Present |
| Reconnect at login and after wake | Present |
| Menu-bar item with per-storage actions | Present |
| Notifications, launch at login, retry count | Present |
| Search / filter / sort | Deliberately absent: the list is a handful of shares in addition order; revisit when it grows past ~12 rows (code comment) |
| Mount all on the page | Deliberately absent: the tray menu has Mount now for every storage; the page keeps one primary per row |
| Copy / sync / bandwidth limits | Deliberately absent: the app mounts and unmounts, it never copies or syncs |
| NFS / AFP / WebDAV | Deliberately absent: SMB shares and attached disks are the declared scope |
| Keychain storage | Deliberately absent: forbidden; the app uses its own 0600 file |

Missing findings: **forget saved password** had no control although the backend supports
`removeCredentials` — fixed in 0.1.10 and covered by the two tests named above. No other missing
control was found.
