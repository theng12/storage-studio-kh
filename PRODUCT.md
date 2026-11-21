# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

macOS application shell: Tauri 2 WebView, 820×640 settings window. The product UI is a desktop settings window, not a website.

## Stack

Existing codebase: Tauri 2 shell with plain TypeScript and Vite in `ui/`; Swift helper in `helper/`; Rust core in `src-tauri/`. No framework change.

## Users

People who keep files on a home or studio NAS share, or on an external disk, and want those volumes back after login, after the Mac wakes, or after the network changes. They configure it once in a macOS settings window and then rely on the menu-bar item.

## Product Purpose

Storage Studio KH reconnects the network shares and attached disks a person chooses, and copies one channel's folder to and from an archive when they ask it to. It never mirrors or syncs in the background. Success means the chosen storage is connected when needed, a channel can be moved to a new Mac without the old one, and when the app cannot do it it says so plainly and stops instead of pretending.

## Positioning

Bounded, honest reconnection for macOS storage: it reads the mount table first so it never mounts twice, retries a fixed schedule (5 s, 15 s, 60 s), then stops and marks the storage *Needs attention* until the person chooses Mount now. Passwords live only in the app's own private file.

## Operating Context

A single Settings window opened from the menu-bar item. The person adds SMB shares (`smb://host/share`) or attached disks (chosen from currently connected volumes), edits them, mounts and unmounts, tests reachability, and opens a mounted storage in Finder. The app runs a background helper that watches login, wake and network changes. A second copy of the app may be launched by mistake.

## Capabilities and Constraints

- Storage list with status: Mounted, Mounting…, Retrying…, Needs attention, Unreachable, Not mounted.
- Add/Edit: name, kind (SMB share or attached disk), SMB address, optional user name and password, optional mount point, or a connected-volume picker.
- Reconnect at login and reconnect after wake per storage, read-only as facts in the list.
- Row actions: Mount now, Stop trying (while a mount or retry runs), Unmount, Open in Finder, Test, Edit.
- Archives page: one row per channel folder, an Archive a channel… sheet, and a Restore a channel… sheet. Every file is hashed, copied into place, read back and compared before the row says Archived; an interrupted copy resumes from the last checked file; a restore stages and checks the copy before moving it, and never merges or replaces an existing folder. Nothing is deleted by the app.
- Credentials prompt when the helper needs a user name and password; saved in the app's own private file.
- General: notifications, launch at login, retries before it stops (1–8, default 3).
- Appearance: System (default), Light, Dark; a stored `default` reads as System.
- Footer: Support this app, version + What's New pill, Check for Updates, update download when available.
- What's New from the app's release notes; Support page with an optional one-time donation.
- The helper failing is shown as a banner with its reason; reopening the app restarts the helper.
- Contract: `docs/contract.md` owns every Snapshot type, command and event. The UI does not change it.
- Copy rules: plain sentences, no raw error lists, never invent a percentage, completion time or success.

## Brand Commitments

"Storage Studio KH" name, KH app family voice: calm, plain, native-feeling macOS settings. Shared KH layout tokens from `Shared Tools/kh-shared-ui` (spacing, radii, type scale, status names). No emoji or Unicode glyphs as icons; inline SVG only.

## Evidence on Hand

`docs/contract.md`, `README.md`, `CHANGELOG.md` (0.1.0 release notes), `Shared Tools/kh-shared-ui/UI-CONVENTIONS.md` and `design-tokens.json`. No marketing claims, testimonials or metrics exist and none may be invented.

## Product Principles

1. Tell the truth about state: "Not mounted" is not "Unreachable", and neither reads as "All good".
2. Stop trying when the app says it will stop; a manual Mount now is the restart.
3. Keep secrets in the app's own private file, never in logs, settings or the interface.
4. Configure once, then stay out of the way: one settings window, few controls, plain words.
5. Never mount twice; reflect what the Mac already has.

## Accessibility & Inclusion

Every control keyboard-reachable with a visible focus ring; Esc closes the topmost modal; Return saves a complete storage form and the credentials prompt; Cmd+R re-reads the mount table; Cmd+W hides Settings; live-region announcements for results; body and placeholder text at least 4.5:1 in light and dark; reduced-motion preferences respected; status never conveyed by colour alone.
