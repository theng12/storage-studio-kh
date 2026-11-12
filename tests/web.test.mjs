import test from "node:test";
import assert from "node:assert/strict";

import {
  compareVersions,
  orderWhatsNew,
  statusLabel,
  statusTone,
  updateIsAvailable,
  updateWording,
  validateStorageDraft,
} from "../ui/src/model.ts";

test("status labels use the shared KH names", () => {
  assert.equal(statusLabel("mounted"), "Mounted");
  assert.equal(statusLabel("mounting"), "Mounting…");
  assert.equal(statusLabel("retrying"), "Retrying…");
  assert.equal(statusLabel("needs_attention"), "Needs attention");
  assert.equal(statusLabel("unreachable"), "Unreachable");
  assert.equal(statusLabel("not_mounted"), "Not mounted");
  assert.equal(statusLabel("something-else"), "Not mounted");
});

test("status tones never read a failure as fine", () => {
  assert.equal(statusTone("mounted"), "ok");
  assert.equal(statusTone("mounting"), "info");
  assert.equal(statusTone("retrying"), "warn");
  assert.equal(statusTone("needs_attention"), "warn");
  assert.equal(statusTone("unreachable"), "bad");
  assert.equal(statusTone("not_mounted"), "off");
});

test("SMB validation names the required shape", () => {
  assert.equal(validateStorageDraft({ name: "Studio NAS", kind: "smb", target: "smb://nas.local/studio", volumeUUID: null }), null);
  assert.equal(validateStorageDraft({ name: "Studio NAS", kind: "smb", target: "nas.local/studio", volumeUUID: null }), "Use a share address like smb://nas.local/studio.");
  assert.equal(validateStorageDraft({ name: "Studio NAS", kind: "smb", target: "smb://nas.local", volumeUUID: null }), "Use a share address like smb://nas.local/studio.");
  assert.equal(validateStorageDraft({ name: "  ", kind: "smb", target: "smb://nas.local/studio", volumeUUID: null }), "Give the storage a name.");
});

test("attached disk validation requires a chosen volume", () => {
  assert.equal(validateStorageDraft({ name: "Editing SSD", kind: "volume", target: "", volumeUUID: null }), "Choose the disk to reconnect.");
  assert.equal(validateStorageDraft({ name: "Editing SSD", kind: "volume", target: "disk4s1", volumeUUID: "5C2A-9F1E" }), null);
  assert.equal(validateStorageDraft({ name: "Thing", kind: "printer", target: "", volumeUUID: null }), "Choose SMB share or attached disk.");
});

test("update wording stays honest in every state", () => {
  assert.equal(updateWording({ state: "checking", version: null, reason: null }), "Checking for updates…");
  assert.equal(updateWording({ state: "up-to-date", version: null, reason: null }), "Up to date");
  assert.equal(updateWording({ state: "available", version: "0.1.1", reason: null }), "Version 0.1.1 is available");
  assert.equal(updateWording({ state: "available", version: null, reason: null }), "An update is available");
  assert.equal(updateWording({ state: "failed", version: null, reason: "No network" }), "Update check failed: No network");
  assert.equal(updateWording({ state: "failed", version: null, reason: null }), "Update check failed.");
  assert.equal(updateWording({ state: "not-checked", version: null, reason: null }), "Not checked yet");
  assert.equal(updateWording({ state: "idle", version: null, reason: null }), "Not checked yet");
  assert.equal(updateIsAvailable({ state: "available", version: "0.1.1", reason: null }), true);
  assert.equal(updateIsAvailable({ state: "up-to-date", version: null, reason: null }), false);
});

test("versions compare numerically", () => {
  assert.ok(compareVersions("0.1.10", "0.1.9") > 0);
  assert.ok(compareVersions("1.0.0", "1.0") === 0);
  assert.ok(compareVersions("v0.1.1", "0.1.0") > 0);
});

test("What's New is newest first without losing entries", () => {
  const ordered = orderWhatsNew([
    { version: "0.1.0", date: "2026-01-01", items: ["first"] },
    { version: "0.2.0", date: "2026-02-01", items: ["third"] },
    { version: "0.1.10", date: "2026-01-15", items: ["second"] },
  ]);
  assert.deepEqual(
    ordered.map((entry) => entry.version),
    ["0.2.0", "0.1.10", "0.1.0"],
  );
});

test("What's New ties fall back to the newer date, then input order", () => {
  const ordered = orderWhatsNew([
    { version: "0.1.0", date: "2026-01-01", items: ["old"] },
    { version: "0.1.0", date: "2026-03-01", items: ["new"] },
    { version: "0.1.0", date: null, items: ["undated"] },
  ]);
  assert.deepEqual(
    ordered.map((entry) => entry.items[0]),
    ["new", "old", "undated"],
  );
});
