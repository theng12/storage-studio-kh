# App ↔ UI contract (Storage Studio KH 0.1.0)

The Rust shell owns settings, the tray and the background helper. The Settings window is a
plain TypeScript page in `ui/`. All calls go through Tauri's `invoke`; the shell pushes a
fresh `Snapshot` on the `snapshot` event after every change.

```ts
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
```

## Types

```ts
type StorageKind = "smb" | "volume";
type StorageStatus =
  | "mounted" | "mounting" | "retrying" | "needs_attention" | "unreachable" | "not_mounted";

interface Storage {
  id: string;
  name: string;
  kind: StorageKind;
  target: string;          // smb://host/share, or the disk's device at add time
  mountPoint: string;      // "" = macOS chooses for SMB; required for an attached disk
  volumeUUID: string | null;
  reconnectAtLogin: boolean;
  reconnectAfterWake: boolean;
  username: string | null;
}

interface StorageView extends Storage {
  status: StorageStatus;
  detail: string | null;      // plain reason for the current state
  mountedPath: string | null;
  hasCredentials: boolean;
}

interface VolumeCandidate { name: string; path: string; uuid: string; device: string; }

/** A share Finder already has mounted, offered as one click. */
interface ShareCandidate {
  name: string;        // readable, e.g. "Public Space-Media - 6TB - TV Show"
  url: string;         // smb://user@host/Share%20Name (percent-encoded)
  user: string | null;
  host: string;
  mountPoint: string;  // where it is mounted now
}

interface General { notifications: boolean; launchAtLogin: boolean; retries: number; }

interface UpdateState {
  state: "idle" | "checking" | "up-to-date" | "available" | "failed" | "not-checked";
  version: string | null;
  reason: string | null;
}

interface WhatsNewEntry { version: string; date: string | null; items: string[]; }

interface Snapshot {
  appName: string;                 // "Storage Studio KH"
  version: string;                 // "0.1.0"
  appearance: "system" | "light" | "dark";
  listView: "cards" | "table";      // remembered per app
  general: General;
  storages: StorageView[];
  volumes: VolumeCandidate[];
  mountedShares: ShareCandidate[];
  update: UpdateState;
  whatsNew: WhatsNewEntry[];
  launchAtLoginEnabled: boolean;
  launchAtLoginError: string | null;
  engineRunning: boolean;
  engineError: string | null;
  secondInstance: boolean;
  holding: boolean;               // an update is installing; nothing new starts
  queued: string[];               // storages with a running attempt or a waiting retry
}
```

## Commands

| Command | Arguments | Returns |
| --- | --- | --- |
| `get_snapshot` | — | `Snapshot` |
| `save_storage` | `{ input: { id?, name, kind, target, mountPoint, volumeUUID, reconnectAtLogin, reconnectAfterWake, username?, password?, removeCredentials? } }` | `Snapshot` |
| `remove_storage` | `{ id }` | `Snapshot` |
| `mount_storage` | `{ id }` | `null` |
| `mount_all` | — | `null` |
| `unmount_storage` | `{ id }` | `null` |
| `cancel_storage` | `{ id }` | `null` — stops a running mount or a waiting retry; the row becomes Not mounted with "Stopped trying. Mount now starts again." |
| `test_storage` | `{ id }` | `null` — the result arrives as a new snapshot (`detail`) |
| `refresh_storage` | — | `null` — re-reads the mount table and connected disks (⌘R) |
| `restart_helper` | — | `null` — starts the background helper again after it stopped (a `snapshot` event follows) |
| `list_shares` | `{ address, username?, password? }` | `null` — the shares arrive on the `shares` event |
| `reveal_storage` | `{ id }` | `null` |
| `set_credentials` | `{ id, username, password }` | `null` |
| `set_appearance` | `{ mode: "system" \| "light" \| "dark" }` | `Snapshot` |
| `set_list_view` | `{ mode: "cards" \| "table" }` | `Snapshot` |
| `set_general` | `{ notifications, launchAtLogin, retries }` | `Snapshot` |
| `check_updates` | — | `UpdateState` (a `snapshot` event follows) |
| `open_updater` | — | `null` (opens Studio Launcher KH) |
| `open_support` | — | `null` (opens the donation page) |

Errors come back as a rejected promise with a plain sentence; show it, never swallow it.

## Events

- `snapshot` — the full `Snapshot` (replace UI state and re-render).
- `second-instance` — another copy was launched; show the plain note.
- `needs-credentials` — `{ id, name }`; ask for a user name and password for that storage.
- `show-whats-new` — open the What's New view (from the menu-bar dropdown).
- `smb_mounts` is not a separate event; candidates arrive inside every `snapshot` as `mountedShares`.
- `shares` — `{ host: string; shares: string[]; needsCredentials: boolean; error: string | null }`.
  `address` may be `smb://host` or `smb://host/share`; the host is what gets listed. Share names
  come back readable (spaces and dashes intact); the app stores them percent-encoded in `target`.

## Update hold (installer ↔ app)

`_orchestra/youtube-stack/update-hold/CONTRACT.md`. Plain HTTP on `127.0.0.1:8646` (the contract's port table row for this app)
(`STORAGE_STUDIO_HOLD_PORT` overrides it for a test instance):

```
POST   /api/maintenance/hold?timeout_s=20&pause_s=120
DELETE /api/maintenance/hold
```

POST pauses new work at once, waits up to `timeout_s` (default 20, max 30) for a mount attempt
already running, and answers `{ "safe", "unsettled", "dispatch_paused_s", "in_flight" }`.
`in_flight` is the helper's own running set; `unsettled` names what a restart right now would
strand. DELETE resumes at once; without it the pause expires after `pause_s`. The pause is memory
only, so a restart always takes work again. While held, `mount_storage`, `mount_all` and
`test_storage` refuse in plain words; unmount, cancel, refresh and Open in Finder still work.

A mount attempt has its own ceiling (90 s default, `STORAGE_STUDIO_MOUNT_BUDGET_S` for a test
instance, never more than 600 s): past it the row turns Needs attention with "It didn't answer
within 90 s. Mount now starts again." and nothing retries on its own. The attempt runs off the
helper's command queue, so a wedged share never blocks other commands or the hold; a mount that
lands late is still reflected by the next mount-table read.

## Copy rules

- Say what happened and what to do: "The share couldn't be mounted (code 13)." →
  the app's own words for a person, never a raw error list.
- "Not mounted" is not "Unreachable", and neither reads as "All good".
- Never invent a percentage, a completion time or a success.
