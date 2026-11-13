import type { StorageStatus, UpdateState, WhatsNewEntry } from "./types";

export const STATUS_LABELS: Record<StorageStatus, string> = {
  mounted: "Mounted",
  mounting: "Mounting…",
  retrying: "Retrying…",
  needs_attention: "Needs attention",
  unreachable: "Unreachable",
  not_mounted: "Not mounted",
};

export type StatusTone = "ok" | "warn" | "bad" | "off" | "info";

export const STATUS_TONES: Record<StorageStatus, StatusTone> = {
  mounted: "ok",
  mounting: "info",
  retrying: "warn",
  needs_attention: "warn",
  unreachable: "bad",
  not_mounted: "off",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status as StorageStatus] ?? "Status unavailable";
}

export function statusTone(status: string): StatusTone {
  return STATUS_TONES[status as StorageStatus] ?? "off";
}

export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function testResultChanged(
  before: { detail: string | null; status: string },
  after: { detail: string | null; status: string },
): boolean {
  return before.detail !== after.detail || before.status !== after.status;
}

export interface DraftValidation {
  id?: string;
  name: string;
  kind: string;
  target: string;
  volumeUUID: string | null;
}

export function validateStorageDraft(draft: DraftValidation): string | null {
  if (!draft.name.trim()) return "Give the storage a name.";
  if (draft.kind === "smb") {
    const target = draft.target.trim();
    if (!/^smb:\/\//i.test(target)) {
      return "Use an smb:// address, like smb://nas.local/studio.";
    }
    if (!/^smb:\/\/[^\s/]+\/\S+$/i.test(target)) {
      return "Use a share address like smb://nas.local/studio.";
    }
    return null;
  }
  if (draft.kind === "volume") {
    if (!draft.volumeUUID || !draft.volumeUUID.trim()) return "Choose the disk to reconnect.";
    return null;
  }
  return "Choose SMB share or attached disk.";
}

export function parseShareHost(address: string): string | null {
  let rest = address.trim().replace(/^smb:\/\//i, "").replace(/^\/\//, "");
  rest = rest.split("/")[0]?.split("?")[0] ?? "";
  if (!rest || /\s/.test(rest)) return null;
  return rest;
}

export function shareNameFromTarget(target: string): string | null {
  const match = /^smb:\/\/[^/]+\/(.+)$/i.exec(target.trim());
  if (!match) return null;
  const raw = match[1].split("?")[0] ?? "";
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function saveBlockReason(draft: DraftValidation, hasVolumes = true): string | null {
  // The same rule that Save would fail on, so the reason can sit beside the button.
  if (!draft.name.trim()) return "Give this storage a name.";
  if (draft.kind === "smb") {
    const target = draft.target.trim();
    if (!target) return "Enter the device address first, like smb://studio.local/photos.";
    if (!/^smb:\/\//i.test(target)) return "Use an smb:// address, like smb://nas.local/studio.";
    if (!/^smb:\/\/[^\s/]+\/\S+$/i.test(target)) return "Add the share name to the address, like smb://nas.local/studio.";
    return null;
  }
  if (draft.kind === "volume") {
    if (draft.volumeUUID && draft.volumeUUID.trim()) return null;
    return hasVolumes ? "Choose a disk to reconnect." : "No disks are connected right now.";
  }
  return "Choose SMB share or attached disk.";
}

export function storageSummary(storages: { status: string }[]): string {
  const total = storages.length;
  if (!total) return "No storages yet.";
  const noun = total === 1 ? "storage" : "storages";
  const count = (statuses: string[]): number => storages.filter((item) => statuses.includes(item.status)).length;
  const mounted = count(["mounted"]);
  const needs = count(["needs_attention"]);
  const unreachable = count(["unreachable"]);
  const mounting = count(["mounting"]);
  const retrying = count(["retrying"]);
  const idle = count(["not_mounted"]);
  if (mounted === total) return `${total} ${noun}, all mounted.`;
  const parts = [mounted ? `${mounted} of ${total} ${noun} mounted` : `${total} ${noun}, none mounted`];
  if (needs) parts.push(`${needs} ${needs === 1 ? "needs" : "need"} attention`);
  if (unreachable) parts.push(`${unreachable} unreachable`);
  if (mounting) parts.push(`${mounting} mounting`);
  if (retrying) parts.push(`${retrying} retrying`);
  if (idle && mounted) parts.push(`${idle} not mounted`);
  return `${parts.join(", ")}.`;
}

/** A share is the same mount whether or not a user name is in front of the host. */
function shareKey(target: string): string {
  return target.trim().toLowerCase().replace(/^smb:\/\/([^/@]*@)?/, "smb://");
}

/** A share or disk may exist once: the same address would give two rows for one mount. */
export function duplicateStorageReason(
  draft: DraftValidation,
  storages: { id: string; name: string; kind: string; target: string; volumeUUID: string | null }[],
): string | null {
  const target = shareKey(draft.target);
  const match = storages.find((storage) => {
    if (storage.id === draft.id) return false;
    if (draft.kind === "smb") return storage.kind === "smb" && target !== "smb://" && shareKey(storage.target) === target;
    if (draft.kind === "volume") return Boolean(draft.volumeUUID) && storage.volumeUUID === draft.volumeUUID;
    return false;
  });
  if (!match) return null;
  return `${draft.kind === "smb" ? "This share" : "This disk"} is already added as ${match.name}.`;
}

export function retrySentence(retries: number): string {
  const n = Math.min(Math.max(Math.round(retries) || 1, 1), 8);
  const tail = "then stops and marks the storage Needs attention until you choose Mount now.";
  if (n === 1) return `After a failure it tries once more, 5 s later, ${tail}`;
  if (n === 2) return `After a failure it tries again after 5 s and 15 s, ${tail}`;
  if (n === 3) return `After a failure it tries again after 5 s, 15 s and 60 s, ${tail}`;
  return `After a failure it makes up to ${n} more attempts, waiting 5 s, 15 s, then 60 s for each later try, ${tail}`;
}

export function updateWording(update: UpdateState): string {
  switch (update.state) {
    case "checking":
      return "Checking for updates…";
    case "up-to-date":
      return "Up to date";
    case "available":
      return update.version ? `Version ${update.version} is available` : "An update is available";
    case "failed": {
      const reason = update.reason?.trim();
      if (!reason) return "Couldn't check for updates.";
      // The shell's reasons are already full sentences; do not stitch two claims together.
      return /^(Could|The |This )/i.test(reason) ? reason : `Couldn't check for updates — ${reason}`;
    }
    case "idle":
    case "not-checked":
      return "Not checked yet";
    default:
      return "Not checked yet";
  }
}

export function updateIsAvailable(update: UpdateState): boolean {
  return update.state === "available";
}

function versionParts(version: string): number[] {
  return version
    .trim()
    .replace(/^v/i, "")
    .split(/[.+-]/)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

export function compareVersions(a: string, b: string): number {
  const left = versionParts(a);
  const right = versionParts(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function orderWhatsNew(entries: WhatsNewEntry[]): WhatsNewEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const byVersion = compareVersions(b.entry.version, a.entry.version);
      if (byVersion !== 0) return byVersion;
      const byDate = (b.entry.date ?? "").localeCompare(a.entry.date ?? "");
      if (byDate !== 0) return byDate;
      return a.index - b.index;
    })
    .map(({ entry }) => entry);
}
