# Changelog

## 0.1.1 — 2026-11-12
- Browse the shares a device offers and pick one — names with spaces and dashes included.
- The storage form now says exactly what is missing, and Save stays off until the address or disk is complete.
- Connecting a share works with the password your Mac already remembers for that device.
- Attached disks explain what to do when no disk is connected.

## 0.1.0 — 2026-11-12
- Storage Studio KH keeps your chosen network shares and attached disks connected after login, after the Mac wakes, and when the network changes.
- The menu-bar item shows each storage and whether it is connected, with Mount now and Open in Finder.
- If a storage can't be reached, it retries after 5, 15 and 60 seconds, then stops and says which one needs attention — a manual mount starts again.
- Passwords are kept in the macOS Keychain, never in the app's files.
- Settings cover what reconnects, notifications, launch at login, and appearance.
- Not yet checked: the first live connection to your NAS. This build was tested with attached disks and with failing connections — every failed attempt says why and stops at Needs attention.
