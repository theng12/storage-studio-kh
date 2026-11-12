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
    version: "0.1.1",
    appearance: theme === "dark" || theme === "light" ? theme : "system",
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
    update: { state: "available", version: "0.1.1", reason: null },
    whatsNew: [
      {
        version: "0.1.0",
        date: "2026-11-12",
        items: [
          "Keeps chosen SMB shares and attached disks connected after login and after wake.",
          "Retries three times, then says which storage needs attention.",
          "Passwords stay in Storage Studio KH's private file.",
        ],
      },
      {
        version: "0.1.1",
        date: "2026-11-19",
        items: [
          "Check for updates from the footer, then update through Studio Launcher KH.",
          "Attached disks show the folder they will reconnect to.",
        ],
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
          id: existing?.id ?? `s${Date.now()}`,
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
          hasCredentials: Boolean(existing?.hasCredentials || input.password),
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
        const storage = snapshot.storages.find((item) => item.id === args?.id);
        if (!storage) return null;
        if (storage.kind === "smb" && !storage.hasCredentials) {
          storage.detail = "Sign in to this share to continue.";
          emit("snapshot", snapshot);
          emit("needs-credentials", { id: storage.id, name: storage.name });
          return null;
        }
        storage.detail =
          storage.kind === "smb" ? `${hostOf(storage.target)} is reachable.` : `${storage.name} is connected.`;
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
          emit("snapshot", snapshot);
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
      case "check_updates": {
        snapshot.update = { state: "checking", version: null, reason: null };
        emit("snapshot", snapshot);
        await new Promise((resolve) => window.setTimeout(resolve, 700));
        const result: UpdateState = { state: "up-to-date", version: null, reason: null };
        snapshot.update = result;
        emit("snapshot", snapshot);
        return result;
      }

      case "refresh_storage":
        emit("snapshot", snapshot);
        return null;

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
