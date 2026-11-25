# Changelog

## 0.1.30 — 2026-11-25

- **The app carries the newest shared update library.** The copy built into the app was the previous accepted one; it is now the current build every new release is made against, so what this version ships is what the studio pins today.
- **A build says which tools it used.** Started from a shell that is not a login shell, the build scripts could pick up an old Python or not find `pkg-config` at all; they now look in Homebrew's folders first, and the build prints the Python, Node and Rust it found, so a broken build names the tool instead of ending in a traceback nobody can act on.

## 0.1.29 — 2026-11-25

- **Archiving onto a disk image works.** A copy onto a mounted disk image could be refused with "There isn't room for 96 bytes. The destination has Zero KB free" when the disk had plenty; the room check believed one figure macOS reports as zero there, and now reads the others before it believes a zero.
- **A very large archive no longer weighs on the helper afterwards.** Once an archive has moved 256 MB or more (or twenty archives have run), the helper quietly starts itself again with an empty slate between jobs — same process, nothing interrupted — so the memory a huge file leaves behind goes back to the system instead of being held until the app quits.

## 0.1.28 — 2026-11-24

- **Stop a copy that is taking too long.** While a channel is being archived the window has a Stop button; it ends at the next checked file, says where the part copy is kept, and "Archive again" carries on from there instead of starting over.
- **Free up space once a copy is safely archived.** Each archived channel offers "Free up space", which moves that channel's folder to the Trash — only after the archive's own manifest says every file was checked. Nothing is deleted: emptying the Trash is yours to do, and the archive stays where it is.
- **Archive again from a manifest.** A channel found by its archive can be archived again from what the archive recorded, even when the row that made it is gone.
- **The startup log tells the truth about the update key.** It said the key had moved; it is copied, and the updater's shared file is left in place for the other apps that still read it.

## 0.1.27 — 2026-11-23

- **Updates can now arrive on their own.** Storage Studio KH checks for a new version when it starts and installs it in the background, then reopens by itself — no download, no dragging a new copy in. It asks the app to pause first, and refuses to update at all when it cannot confirm pausing is safe, so a job is never cut off.
- **The window says an update is happening.** While a new version installs, a line at the top of the window says so instead of the app looking idle.

## 0.1.26 — 2026-11-23

- **The update hold only trusts a properly protected key file.** The token must be readable by you alone (mode 600) and be exactly 64 hex characters; anything else is refused, and the refusal now says why — on the route and in the log, instead of only a bare "unauthorized".
- **The update key moves into the app's own folder.** If the key is still in the updater's shared folder, the app copies it into its own support folder once, keeps it readable by you alone, and says it did so; after that the shared copy is never read again.

## 0.1.25 — 2026-11-22

- **A new storage with no address now says what is missing.** Adding a storage with a name but no address left Save switched off with nothing beside it; the "Enter the device address" line now shows as soon as you type.
- **Escape answers the question in front of you.** With a Remove or Discard confirmation open, Escape now returns to the form — before, it could be spent closing the device's share list behind it.

## 0.1.24 — 2026-11-22

- **A share mounts in the folder you choose.** The chosen mount folder was handed to the system's network mounter in the wrong list, so the device answered EINVAL and nothing mounted. It is now passed where the system expects it.
- **The release build finds its What's New step again.** The build looked for a helper script in a folder that moved; it now looks in the shared code's new home and still stops loudly if neither copy exists.

## 0.1.23 — 2026-11-22

- **Your saved storages can no longer be wiped by a bad reply from the app's own helper.** The app read the helper's share list in the wrong spelling, called the answer a fault every time, and then saved that empty list over your storages. Both halves are fixed: the helper's answer now reads correctly, and a save that would replace a saved list with none is refused and logged.
- **A storage comes back by itself when its NAS does.** After the usual quick retries, a storage you asked to restore is tried again every 5 minutes for an hour, so a NAS that was off for an update is reconnected without a relaunch or a click. If it is still away after that it stops and says Needs attention; Mount now starts it again.
- Removing your last storage or archive still saves normally, so nothing is stuck.

## 0.1.22 — 2026-11-21

- **The add/edit sheet no longer hides its own sections.** With a share list showing, "Sign in" used to open cut in half and Advanced could not be reached; the sections keep their full height and the sheet scrolls when it needs to.
- **No red message while the share list is doing its job.** "Choose a share from the list." waited until there is no list and the typing has settled.
- **Archives reads in the right order:** the main action first, then Restore; the icon is a box with its own lid instead of Storage's stacked drives; and each archive names where it was put — "Archived to /Volumes/…".
- **Small copy fixes:** "Tell you when a storage reconnects…", and the archive sheet says "The copy goes inside the folder you choose, named after the channel and the date."
- Sign in and Advanced now show a chevron, so they read as sections rather than empty fields.

## 0.1.21 — 2026-11-21

- **Adding a storage is now one address and a list of shares.** Paste anything you have — an IP, a host name, `//host`, `smb://host`, or a whole share address, with or without `%20` — and the app finds that device's shares and shows each as a row with Add. Typed share names with spaces now save, and the address you see is the readable name, never `%20`.
- **Sign in only when it's needed.** "Sign in (optional)" stays closed for a device that lets guests in and opens by itself when the device asks for a user name and password. Mount folder and the two reconnect switches moved under "Advanced"; both switches stay on.
- **The shares list with a password too.** A password in the form used to make the listing wait out its 15-second ceiling and then say the device didn't answer; it now answers in under a second, guest or signed in.
- **Messages say what to do next.** "The device didn't answer. Check the address, or press Find shares." while a list is loading there's a hint, never a red address error.
- **Archives page corrections.** Its nav item has its own icon (it was the same drawing as Storage), the page, heading and list are all called Archives, the lede says an archive is restored on a new Mac, and the footer pill shows just the version and names the app in full for screen readers.
- **The update line says what it is about:** "Updates not checked yet", "Checking for updates…", "You're up to date".

## 0.1.20 — 2026-11-21

- **Only the installed app can change the login item.** A copy run from a build folder or a mounted installer no longer asks macOS for "launch at login" at all, so a test copy can't take over the item that opens the app at login. Switching Launch at login in a copy that isn't installed now says it needs the installed app instead of half-doing it.

## 0.1.19 — 2026-11-21

- **The share address is chosen, not typed.** Type the device's address once and the dialog lists the shares that device actually offers; choosing one fills the address in for you, and Refresh list asks it again. The field is read-only while the list is showing.
- **Typing remains the way through when there is no list** — a device that can't be listed says why, and a device that returns an empty answer is described as "didn't list any shares", never as "no shares". Both keep the field editable.
- A new user name on the same device asks it for its list again, so a different account's shares are never shown from the previous one.

## 0.1.18 — 2026-11-21

- **Channel archives.** One channel's folder can now be copied to a folder you choose — on a share you pick once, or a disk — so it can be carried to a new Mac without the old one. A channel that keeps its heavy media in another folder can include that folder too.
- **Checked, not assumed.** Every file is read back off the destination and compared before the app says "Archived". An interrupted copy (an update, a lost share, a restart) carries on from the last checked file, and a file that was still being written while it copied is named instead of going missing.
- **Restore on a new Mac.** Choose the folder that holds the archives; each channel is found by its own manifest, so a Mac that has never seen it can restore it. The copy is checked in a staging folder first, then moved into place, and an existing folder of the same name is never merged over — a second copy takes a dated name.
- **A new Archives page** with the two in-app sheets. Nothing is deleted: forgetting a row only forgets the row, and the archive stays where it is.

## 0.1.17 — 2026-11-20

- The update pause now says what it did and how long it took: the helper's log names the ceiling it answers inside, the app's log gives the time in milliseconds, and both are kept in a small `hold-attempts.jsonl` beside settings, with the reason when a pause cannot be taken.

## 0.1.16 — 2026-11-20

- Updating while Storage Studio KH is running works again. The Launcher asks the app to pause before it installs and asks again every few seconds until it may; after the first ask the app answered "I didn't pause", so the update was refused every time and the app stayed paused. It now answers every ask, and says plainly whether it is paused.
- Browse for shares always ends. If a device stops answering, the row says so after a few seconds instead of sitting at "Looking…" with nothing to do; and an answer for another device can't appear under the one you are adding.
- A slow device no longer freezes the rest of the app while it answers: listing shares and disconnecting a drive now happen beside everything else, so other rows, Stop trying and an update's short pause keep working.

## 0.1.15 — 2026-11-19

- New signing certificate. The studio replaced its code-signing certificate today, so this build is signed with the new one and the retired certificate is no longer used. Nothing else changed.

## 0.1.14 — 2026-11-19

- The app you install no longer carries anyone's home folder or build paths. The build replaces them before compiling, then opens the finished DMG and refuses to hand it over if one is still inside.
- Settings are now readable only by you.

## 0.1.13 — 2026-11-17

- Choosing where a share mounts now uses macOS's own folder panel: pick a folder and the path appears in a field you can't type into, so a mount point is never a hand-typed path. Leave it empty and macOS picks a folder in /Volumes as before.
- The update hold now asks for the Launcher's own credential. Studio Launcher sends it automatically, so updating while Storage Studio KH runs is unchanged; anything else that calls the hold address gets "unauthorized" instead of taking a pause.

## 0.1.12 — 2026-11-17

- A mount that never answers now ends by itself: after 90 seconds the row says "It didn't answer within 90 s. Mount now starts again." instead of sitting at Mounting… forever.
- A mounting or waiting row has a Stop trying button, so you can end it yourself; it says "Stopped trying. Mount now starts again."
- A stuck mount no longer holds up the rest of the app: other rows, Unmount, Test and an update's pause all keep working while it waits.
- If a password can't be saved because the disk is full, the row says so when the storage connects, with the free space on that disk, instead of keeping quiet.

## 0.1.11 — 2026-11-15

- Storage Studio KH can now be updated while it runs: Studio Launcher asks it to hold first, it finishes or parks what it was doing within 20 seconds, and the update happens in that gap.
- While an update installs, the window says "Holding new work for an update" and Mount now is greyed out, instead of a button that would do nothing.
- It takes work again by itself: after the update, or after two minutes if the update never happens. Nothing to click, and quitting during the pause never leaves it stuck.

## 0.1.10 — 2026-11-13

- Only the installed app adds a Login Items entry, once: a development copy or a rebuild no longer registers a second "Storage Studio KH".
- Storage can be shown as cards or a table, and the choice is remembered. Cards are equal height with labelled values; the table keeps its first column pinned in a narrow window.
- Each storage has one primary action (Mount now or Open in Finder); Test, Edit and Unmount are in its menu.
- Warnings are grouped by kind with counts instead of repeating a line, and duplicate entries are shown once with a count.
- The neutral ramp is one set of tokens with measured contrast for body, muted and status text in light and dark.
- Edit can forget a saved password; the password field is disabled while that is chosen.
- The same share or disk can't be added twice: Save says which existing storage already uses it.
- A second Test on the same share always answers, even when nothing changed. Removing a storage forgets its saved password and clears any duplicate entries; the confirmation says so.
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
