export type StorageKind = "smb" | "volume";

export type StorageStatus =
  | "mounted"
  | "mounting"
  | "retrying"
  | "needs_attention"
  | "unreachable"
  | "not_mounted";

export interface Storage {
  id: string;
  name: string;
  kind: StorageKind;
  target: string;
  mountPoint: string;
  volumeUUID: string | null;
  reconnectAtLogin: boolean;
  reconnectAfterWake: boolean;
  username: string | null;
}

export interface StorageView extends Storage {
  status: StorageStatus;
  detail: string | null;
  mountedPath: string | null;
  hasCredentials: boolean;
}

export interface VolumeCandidate {
  name: string;
  path: string;
  uuid: string;
  device: string;
}

export interface General {
  notifications: boolean;
  launchAtLogin: boolean;
  retries: number;
}

export interface UpdateState {
  state: "idle" | "checking" | "up-to-date" | "available" | "failed" | "not-checked";
  version: string | null;
  reason: string | null;
}

export interface WhatsNewEntry {
  version: string;
  date: string | null;
  items: string[];
}

export interface Snapshot {
  appName: string;
  version: string;
  appearance: "system" | "light" | "dark";
  general: General;
  storages: StorageView[];
  volumes: VolumeCandidate[];
  update: UpdateState;
  whatsNew: WhatsNewEntry[];
  launchAtLoginEnabled: boolean;
  launchAtLoginError: string | null;
  engineRunning: boolean;
  engineError: string | null;
  secondInstance: boolean;
}

export interface StorageInput {
  id?: string;
  name: string;
  kind: StorageKind;
  target: string;
  mountPoint: string;
  volumeUUID: string | null;
  reconnectAtLogin: boolean;
  reconnectAfterWake: boolean;
  username?: string;
  password?: string;
}
