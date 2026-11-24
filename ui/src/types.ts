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

export interface ShareCandidate {
  name: string;
  url: string;
  user: string | null;
  host: string;
  mountPoint: string;
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
  listView: "cards" | "table";
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
  lastChecked: number | null;
  secondInstance: boolean;
  /** An update is installing: nothing new starts until it finishes. */
  holding: boolean;
  /** While the app is being replaced, the window says so instead of looking idle. */
  updating?: boolean;
  /** Storages with a running attempt or a waiting retry: the rows that offer Stop trying. */
  queued?: string[];
  archives: Archive[];
  /** The one archive or restore job, while one is running or paused. */
  job: JobView | null;
  /** The last discovery result, while the Restore sheet is open. */
  restorable: RestorableList | null;
}

export interface ArchiveLast {
  at: number;
  path: string;
  files: number;
  bytes: number;
}

/** A channel folder (plus its heavy-media folder, when it keeps one) and where it is archived. */
export interface Archive {
  id: string;
  name: string;
  slug: string;
  projectId: string | null;
  roots: string[];
  destination: string;
  last: ArchiveLast | null;
}

export interface JobView {
  id: string;
  kind: "archive" | "restore";
  name: string;
  state: "copying" | "verifying" | "archived" | "restoring" | "restored" | "paused" | "failed" | "cancelled" | "freed";
  filesDone: number;
  filesTotal: number;
  bytesDone: number;
  bytesTotal: number;
  detail: string | null;
  path: string | null;
}

export interface RestorableItem {
  name: string;
  slug: string;
  path: string;
  createdAt: string;
  machine: string;
  files: number;
  bytes: number;
  roots: string[];
}

export interface RestorableList {
  root: string;
  items: RestorableItem[];
  error: string | null;
}

export interface ArchiveInput {
  id?: string;
  name?: string;
  folder: string;
  mediaFolder?: string;
  destination: string;
}

export interface ChannelInspect {
  isChannel: boolean;
  name: string | null;
  slug: string | null;
  hasMediaRoot: boolean;
  looksLikeLibrary: boolean;
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
  removeCredentials?: boolean;
}

export interface SharesPayload {
  host: string;
  shares: string[];
  needsCredentials: boolean;
  error: string | null;
}
