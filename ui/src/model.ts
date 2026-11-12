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
  name: string;
  kind: string;
  target: string;
  volumeUUID: string | null;
}

export function validateStorageDraft(draft: DraftValidation): string | null {
  if (!draft.name.trim()) return "Give the storage a name.";
  if (draft.kind === "smb") {
    const target = draft.target.trim();
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

export function updateWording(update: UpdateState): string {
  switch (update.state) {
    case "checking":
      return "Checking for updates…";
    case "up-to-date":
      return "Up to date";
    case "available":
      return update.version ? `Version ${update.version} is available` : "An update is available";
    case "failed":
      return update.reason ? `Update check failed: ${update.reason}` : "Update check failed.";
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
