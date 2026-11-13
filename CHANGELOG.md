# Changelog

## 0.1.10 — 2026-11-13

- Only the installed app adds a Login Items entry, once: a development copy or a rebuild no longer registers a second "Storage Studio KH".
- The same share or disk can't be added twice: Save says which existing storage already uses it.
- The helper-stopped banner now has a Restart helper button, and the Storage line says the helper isn't running.
- Keyboard focus stays on the switch or appearance choice you just changed.
- Saving a storage says what happened, scrolls the new row clear of the toast and offers Mount now; removing one offers Undo.
- Tab stays inside open sheets, and Undo, a boot Retry and What's New keep keyboard focus.
- Saving a password says the share is being tried again instead of leaving the old failure on screen.
- Closing Add or Edit with typed changes asks before discarding them.
- Retries is a 1–8 picker, an http:// address gets the right message, and a refused login item says where to allow it.
- Long names wrap, the mounted path gets its own line in a narrow window, and the update button no longer crosses the sidebar edge.
- Storage rows are shorter, use the right side of a wide window, and their buttons name the storage for screen readers.

## 0.1.9 — 2026-11-13

- A narrow window keeps the same layout: sections move to a row at the top, the storage list fills the width, and Support, the version pill and the update controls stay pinned to the bottom.
- Storage says one honest line about the list, such as "4 storages, all mounted." — and counts what needs attention instead of leaving you to scan.
- The Add storage sheet no longer closes, losing what you typed, when you click outside it. Return saves when the form is complete.
- Appearance is one content-sized System / Light / Dark control.
- Close Window (⌘W) hides Settings like a standard macOS window.

## 0.1.8 — 2026-11-13

- Opening the app again while it is already running brings the Settings window back on screen, even after you closed it.
- A window that comes back tiny or offscreen is given a normal size again.

## 0.1.7 — 2026-11-13

- Passwords now live in Storage Studio KH's own private file — readable only by you (mode 0600) and saved atomically — never in a system credential store.
- A password saved by an earlier version is entered once more in the app; the old item is left untouched.
- This app can no longer trigger a system credential prompt.

## 0.1.6 — 2026-11-12

- Browse shows the device it is listing, each share and a Dismiss action; failures and an empty list read as warnings instead of quiet hints.
- The Add storage dialog marks the field that needs attention, and every option including the reconnect switches stays reachable at 820×640.
- The Save reason sits beside the button without crowding the action row.
- The footer is one evenly spaced column: Support, the version pill with the update controls on one line, then the status line.
- Escape closes any dialog; with Browse results open it dismisses those first, and a Remove confirmation returns to the edit form.
- Settings opens from launch, the app menu and the tray, and rebuilds its window if it is missing.


## 0.1.5 — 2026-11-12

- Appearance offers System, Light and Dark only; a stored "Default" reads as System.

## 0.1.4 — 2026-11-12

- Launching the app shows its window; the menu-bar item is an addition, not a replacement.
- Saved share passwords keep working after an app update.
- A missing password is asked for in the app's own window; a refused one is named plainly and only retried when you choose Mount now.
- Appearance now offers Default alongside System, Light and Dark; Default follows the Mac.
- The Add storage dialog explains a blocked save beside the button, Browse names the device and fills the share name, and choosing a connected share closes the list.
- The NAS connection was verified live: mount, unmount and automatic reconnect.

## 0.1.3 — 2026-11-12

- Settings always opens: if the window is missing or was destroyed, it is rebuilt on demand instead of doing nothing.

## 0.1.2 — 2026-11-12
- Choosing a share under "From a connected share" now closes the list, so the address and the name can never get out of step.
- A storage row shows the address it actually reconnects, including in a failure reason.

## 0.1.1 — 2026-11-12
- Browse the shares a device offers and pick one — names with spaces and dashes included.
- The storage form now says exactly what is missing, and Save stays off until the address or disk is complete.
- Connecting a share works with the password your Mac already remembers for that device.
- Attached disks explain what to do when no disk is connected.

## 0.1.0 — 2026-11-12
- Storage Studio KH keeps your chosen network shares and attached disks connected after login, after the Mac wakes, and when the network changes.
- The menu-bar item shows each storage and whether it is connected, with Mount now and Open in Finder.
- If a storage can't be reached, it retries after 5, 15 and 60 seconds, then stops and says which one needs attention — a manual mount starts again.
- Passwords are kept in the app's own private data folder.
- Settings cover what reconnects, notifications, launch at login, and appearance.
- Not yet checked: the first live connection to your NAS. This build was tested with attached disks and with failing connections — every failed attempt says why and stops at Needs attention.
