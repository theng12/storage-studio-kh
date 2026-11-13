import type { Snapshot, StorageInput, StorageView, UpdateState } from "./types";

type Handler = (payload: unknown) => void;

const handlers = new Map<string, Handler[]>();

function listenTo(event: string, handler: Handler): () => void {
  const list = handlers.get(event) ?? [];
  list.push(handler);
  handlers.set(event, list);
  return () => {
    const current = handlers.get(event) ?? [];
    handlers.set(
      event,
      current.filter((item) => item !== handler),
    );
  };
}

function emit(event: string, payload: unknown): void {
  for (const handler of handlers.get(event) ?? []) handler(payload);
}

function buildSnapshot(hash: string): Snapshot {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const theme = params.get("theme");
  const storages: StorageView[] =
    params.get("empty") === "1"
      ? []
      : [
    {
      id: "studio-nas",
      name: "Studio NAS",
      kind: "smb",
      target: "smb://nas.local/studio",
      mountPoint: "",
      volumeUUID: null,
      reconnectAtLogin: true,
      reconnectAfterWake: true,
      username: "studio",
      status: "mounted",
      detail: "Connected as studio.",
      mountedPath: "/Volumes/studio",
      hasCredentials: true,
    },
    {
      id: "archive",
      name: "Archive Share",
      kind: "smb",
      target: "smb://archive.local/backups",
      mountPoint: "",
      volumeUUID: null,
      reconnectAtLogin: true,
      reconnectAfterWake: false,
      username: null,
      status: "needs_attention",
      detail: "The share couldn't be reached after three tries.",
      mountedPath: null,
      hasCredentials: false,
    },
    {
      id: "editing-ssd",
      name: "Editing SSD",
      kind: "volume",
      target: "disk4s1",
      mountPoint: "/Volumes/Editing SSD",
      volumeUUID: "5C2A-9F1E",
      reconnectAtLogin: true,
      reconnectAfterWake: true,
      username: null,
      status: "unreachable",
      detail: "The disk isn't connected right now.",
      mountedPath: null,
      hasCredentials: false,
    },
  ];
  return {
    appName: "Storage Studio KH",
    version: "0.1.10",
    appearance: theme === "dark" || theme === "light" ? theme : "system",
    listView: params.get("list") === "table" ? "table" : "cards",
    general: { notifications: true, launchAtLogin: true, retries: 3 },
    storages,
    volumes: [
      { name: "Editing SSD", path: "/Volumes/Editing SSD", uuid: "5C2A-9F1E", device: "disk4s1" },
      { name: "Backup Disk", path: "/Volumes/Backup Disk", uuid: "8B14-2D77", device: "disk5s1" },
    ],
    mountedShares: params.get("empty") === "1" ? [] : [
      {
        name: "Public Space-Media - 4TB - Music",
        url: "smb://studio@nas.local/Public%20Space-Media%20-%204TB%20-%20Music",
        user: "studio",
        host: "nas.local",
        mountPoint: "/Volumes/Public Space-Media - 4TB - Music",
      },
      {
        name: "Studio NAS",
        url: "smb://nas.local/studio",
        user: null,
        host: "nas.local",
        mountPoint: "/Volumes/studio",
      },
    ],
    update: { state: "available", version: "0.2.0", reason: null },
    whatsNew: [
      {
        version: "0.1.10",
        date: "2026-11-13",
        items: [
          "Only the installed app adds a Login Items entry, once: a development copy or a rebuild no longer registers a second \"Storage Studio KH\".",
          "Storage can be shown as cards or a table, and the choice is remembered. Cards are equal height with labelled values; the table keeps its first column pinned in a narrow window.",
          "Each storage has one primary action (Mount now or Open in Finder); Test, Edit and Unmount are in its menu.",
          "Warnings are grouped by kind with counts instead of repeating a line, and duplicate entries are shown once with a count.",
          "The neutral ramp is one set of tokens with measured contrast for body, muted and status text in light and dark.",
          "Edit can forget a saved password; the password field is disabled while that is chosen.",
          "The same share or disk can't be added twice: Save says which existing storage already uses it.",
          "A second Test on the same share always answers, even when nothing changed. Removing a storage forgets its saved password and clears any duplicate entries; the confirmation says so.",
          "The helper-stopped banner now has a Restart helper button, and the Storage line says the helper isn't running.",
          "Keyboard focus stays on the switch or appearance choice you just changed.",
          "Saving a storage says what happened, scrolls the new row clear of the toast and offers Mount now; removing one offers Undo.",
          "Tab stays inside open sheets, and Undo, a boot Retry and What's New keep keyboard focus.",
          "Saving a password says the share is being tried again instead of leaving the old failure on screen.",
          "Closing Add or Edit with typed changes asks before discarding them.",
          "Retries is a 1–8 picker, an http:// address gets the right message, and a refused login item says where to allow it.",
          "Long names wrap, the mounted path gets its own line in a narrow window, and the update button no longer crosses the sidebar edge.",
          "Storage rows are shorter, use the right side of a wide window, and their buttons name the storage for screen readers.",
        ],
      },
      {
        version: "0.1.9",
        date: "2026-11-13",
        items: [
          "A narrow window keeps the same layout: sections move to a row at the top, the storage list fills the width, and Support, the version pill and the update controls stay pinned to the bottom.",
          "Storage says one honest line about the list, such as \"4 storages, all mounted.\" — and counts what needs attention instead of leaving you to scan.",
          "The Add storage sheet no longer closes, losing what you typed, when you click outside it. Return saves when the form is complete.",
          "Appearance is one content-sized System / Light / Dark control.",
          "Close Window (⌘W) hides Settings like a standard macOS window.",
        ],
      },
      {
        version: "0.1.8",
        date: "2026-11-13",
        items: [
          "Opening the app again while it is already running brings the Settings window back on screen, even after you closed it.",
          "A window that comes back tiny or offscreen is given a normal size again.",
        ],
      },
      {
        version: "0.1.7",
        date: "2026-11-13",
        items: ["Passwords live in Storage Studio KH's own private file — never a system credential store."],
      },
    ],
    launchAtLoginEnabled: true,
    launchAtLoginError: null,
    engineRunning: params.get("engine-down") !== "1",
    engineError: params.get("engine-down") === "1" ? "The helper stopped responding." : null,
    secondInstance: params.get("second") === "1",
  };
}

function hostOf(target: string): string {
  return target.replace(/^smb:\/\//i, "").split("/")[0] || "The share";
}

interface DevTestHook {
  snapshot?: Snapshot;
  commands?: Array<{ command: string; args?: unknown }>;
}

export function createDevBackend(hash: string): {
  backend: {
    invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
    listen<T>(event: string, handler: (payload: T) => void): Promise<() => void>;
  };
} {
  // Acceptance runs inject a snapshot captured from the real app and record every command.
  const hook = (window as unknown as { __SS_TEST__?: DevTestHook }).__SS_TEST__;
  const snapshot = hook?.snapshot
    ? (JSON.parse(JSON.stringify(hook.snapshot)) as Snapshot)
    : buildSnapshot(hash);
  (window as unknown as { __SS_EMIT__?: typeof emit }).__SS_EMIT__ = emit;
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  let bootFailures = 0;

  function mountStorage(storage: StorageView): void {
    // Mirror the helper: without a saved password a share asks, then mounts once it has one.
    if (storage.kind === "smb" && storage.status !== "mounted" && !storage.hasCredentials) {
      storage.status = "needs_attention";
      storage.detail = "Sign in to this share to continue.";
      storage.mountedPath = null;
      emit("snapshot", snapshot);
      emit("needs-credentials", { id: storage.id, name: storage.name });
      return;
    }
    storage.status = "mounting";
    storage.detail = "Connecting…";
    emit("snapshot", snapshot);
    window.setTimeout(() => {
      storage.status = "mounted";
      storage.detail = storage.kind === "smb" ? "Connected." : "The disk is connected.";
      storage.mountedPath = storage.mountPoint || `/Volumes/${storage.name}`;
      emit("snapshot", snapshot);
    }, 450);
  }

  async function handle(command: string, args?: Record<string, unknown>): Promise<unknown> {
    hook?.commands?.push({ command, args });
    window.dispatchEvent(new CustomEvent("dev-command", { detail: command }));
    switch (command) {
      case "get_snapshot":
        if (params.get("fail-boot") === "1" && bootFailures < 1) {
          bootFailures += 1;
          throw new Error("The app couldn't read its settings.");
        }
        return snapshot;

      case "save_storage": {
        const input = (args?.input ?? {}) as StorageInput;
        const existing = input.id ? snapshot.storages.find((item) => item.id === input.id) : undefined;
        const view: StorageView = {
          id: input.id ?? existing?.id ?? `s${Date.now()}`,
          name: input.name,
          kind: input.kind,
          target: input.target,
          mountPoint: input.mountPoint,
          volumeUUID: input.volumeUUID,
          reconnectAtLogin: input.reconnectAtLogin,
          reconnectAfterWake: input.reconnectAfterWake,
          username: input.username ?? existing?.username ?? null,
          status: existing?.status ?? "not_mounted",
          detail: existing?.detail ?? null,
          mountedPath: existing?.mountedPath ?? null,
          hasCredentials: input.removeCredentials ? false : Boolean(existing?.hasCredentials || input.password),
        };
        if (existing) {
          const index = snapshot.storages.indexOf(existing);
          snapshot.storages.splice(index, 1, view);
        } else {
          snapshot.storages.push(view);
        }
        emit("snapshot", snapshot);
        return snapshot;
      }

      case "remove_storage": {
        const id = String(args?.id ?? "");
        const index = snapshot.storages.findIndex((item) => item.id === id);
        if (index >= 0) snapshot.storages.splice(index, 1);
        emit("snapshot", snapshot);
        return snapshot;
      }

      case "mount_storage": {
        const storage = snapshot.storages.find((item) => item.id === args?.id);
        if (storage) mountStorage(storage);
        return null;
      }

      case "mount_all": {
        for (const storage of snapshot.storages) if (storage.status !== "mounted") mountStorage(storage);
        return null;
      }

      case "unmount_storage": {
        const storage = snapshot.storages.find((item) => item.id === args?.id);
        if (storage) {
          storage.status = "not_mounted";
          storage.detail = null;
          storage.mountedPath = null;
          emit("snapshot", snapshot);
        }
        return null;
      }

      case "test_storage": {
        // Mirror the helper: a Test reports; it never mounts and never asks for a password.
        const storage = snapshot.storages.find((item) => item.id === args?.id);
        if (!storage) return null;
        if (storage.status === "mounted") {
          storage.detail = `Connected at ${storage.mountedPath || storage.mountPoint || `/Volumes/${storage.name}`}.`;
        } else if (storage.kind === "smb") {
          storage.status = "not_mounted";
          storage.detail = `${hostOf(storage.target)} is reachable and ready to mount.`;
        } else if (storage.status === "unreachable") {
          storage.detail = "The disk isn't connected.";
        } else {
          storage.status = "not_mounted";
          storage.detail = "The disk is connected and ready to mount.";
        }
        emit("snapshot", snapshot);
        return null;
      }

      case "reveal_storage":
        return null;

      case "set_credentials": {
        if (params.get("fail-credentials") === "1") {
          throw new Error("Storage Studio KH couldn't save the password.");
        }
        const storage = snapshot.storages.find((item) => item.id === args?.id);
        if (storage) {
          storage.username = String(args?.username ?? "") || null;
          storage.hasCredentials = true;
          // The helper mounts a moment later, so the "Trying…" note has a real end.
          window.setTimeout(() => {
            storage.status = "mounted";
            storage.detail = storage.kind === "smb" ? "Connected." : "The disk is connected.";
            storage.mountedPath = storage.mountPoint || `/Volumes/${storage.name}`;
            emit("snapshot", snapshot);
          }, 150);
        }
        return null;
      }

      case "set_appearance": {
        const mode = String(args?.mode ?? "system");
        snapshot.appearance = mode === "light" || mode === "dark" ? mode : "system";
        emit("snapshot", snapshot);
        return snapshot;
      }

      case "set_general": {
        snapshot.general = {
          notifications: Boolean(args?.notifications),
          launchAtLogin: Boolean(args?.launchAtLogin),
          retries: Number(args?.retries ?? 3),
        };
        snapshot.launchAtLoginEnabled = snapshot.general.launchAtLogin;
        emit("snapshot", snapshot);
        return snapshot;
      }

      case "list_shares": {
        const address = String((args as Record<string, unknown>).address ?? "");
        const host = address.replace(/^smb:\/\//i, "").split("/")[0] || "192.168.0.217";
        const shares = ["Public Space-Media - 4TB - Music", "Public Space-System pool", "Studio Projects"];
        setTimeout(() => emit("shares", { host, shares, needsCredentials: false, error: null }), 250);
        return null;
      }
      case "set_list_view": {
        snapshot.listView = args?.mode === "table" ? "table" : "cards";
        emit("snapshot", snapshot);
        return snapshot;
      }

      case "check_updates": {
        // Keep the offer it already has instead of claiming "up to date" over it.
        const offered = snapshot.update.version;
        snapshot.update = { state: "checking", version: null, reason: null };
        emit("snapshot", snapshot);
        await new Promise((resolve) => window.setTimeout(resolve, 700));
        const result: UpdateState = offered
          ? { state: "available", version: offered, reason: null }
          : { state: "up-to-date", version: null, reason: null };
        snapshot.update = result;
        emit("snapshot", snapshot);
        return result;
      }

      case "refresh_storage":
        emit("snapshot", snapshot);
        return null;

      case "restart_helper": {
        snapshot.engineRunning = true;
        snapshot.engineError = null;
        emit("snapshot", snapshot);
        return null;
      }

      case "open_updater":
      case "open_support":
        return null;

      default:
        throw new Error(`The dev preview does not know the command "${command}".`);
    }
  }

  return {
    backend: {
      invoke: <T,>(command: string, args?: Record<string, unknown>) => handle(command, args) as Promise<T>,
      listen: async <T,>(event: string, handler: (payload: T) => void) => listenTo(event, handler as Handler),
    },
  };
}
