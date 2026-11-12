import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  parseShareHost,
  shareNameFromTarget,
  saveBlockReason,
  compareVersions,
  esc,
  orderWhatsNew,
  statusLabel,
  statusTone,
  testResultChanged,
  updateIsAvailable,
  updateWording,
  validateStorageDraft,
} from "../ui/src/model.ts";

const mainSource = readFileSync(new URL("../ui/src/main.ts", import.meta.url), "utf8");

test("status labels use the shared KH names", () => {
  assert.equal(statusLabel("mounted"), "Mounted");
  assert.equal(statusLabel("mounting"), "Mounting…");
  assert.equal(statusLabel("retrying"), "Retrying…");
  assert.equal(statusLabel("needs_attention"), "Needs attention");
  assert.equal(statusLabel("unreachable"), "Unreachable");
  assert.equal(statusLabel("not_mounted"), "Not mounted");
  assert.equal(statusLabel("something-else"), "Status unavailable");
  assert.equal(statusLabel(""), "Status unavailable");
});

test("status tones never read a failure as fine", () => {
  assert.equal(statusTone("mounted"), "ok");
  assert.equal(statusTone("mounting"), "info");
  assert.equal(statusTone("retrying"), "warn");
  assert.equal(statusTone("needs_attention"), "warn");
  assert.equal(statusTone("unreachable"), "bad");
  assert.equal(statusTone("not_mounted"), "off");
  assert.equal(statusTone("something-else"), "off");
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
  assert.equal(updateWording({ state: "mystery", version: null, reason: null }), "Not checked yet");
  assert.notEqual(updateWording({ state: "mystery", version: null, reason: null }), undefined);
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


test("esc escapes markup in user-supplied text", () => {
  assert.equal(esc('<img src="x" onerror="y"> & more'), "&lt;img src=&quot;x&quot; onerror=&quot;y&quot;&gt; &amp; more");
  assert.equal(esc(null), "");
  assert.equal(esc(0), "0");
});

test("a test result is only consumed when the storage changed", () => {
  assert.equal(testResultChanged({ detail: "old", status: "needs_attention" }, { detail: "old", status: "needs_attention" }), false);
  assert.equal(testResultChanged({ detail: "old", status: "needs_attention" }, { detail: "nas.local is reachable.", status: "needs_attention" }), true);
  assert.equal(testResultChanged({ detail: null, status: "not_mounted" }, { detail: null, status: "mounted" }), true);
});

test("the command wiring in main.ts is present and unique", () => {
  assert.match(mainSource, /event\.metaKey[\s\S]{0,160}refreshStorage/);
  assert.match(mainSource, /async function refreshStorage[\s\S]{0,320}"refresh_storage"/);
  assert.match(mainSource, /async function checkUpdates[\s\S]{0,400}"check_updates"/);
  assert.match(mainSource, /async function openUpdater[\s\S]{0,200}"open_updater"/);
  assert.match(mainSource, /data-action="check-updates"/);
  assert.match(mainSource, /action === "check-updates"\) void checkUpdates\(\)/);
  assert.match(mainSource, /data-action="download-update"/);
  assert.match(mainSource, /action === "download-update"\) void openUpdater\(\)/);
  assert.match(mainSource, /data-fk="row-\$\{esc\(storage\.id\)\}-mount"/);
  assert.match(mainSource, /data-fk="row-\$\{esc\(storage\.id\)\}-test"/);
  assert.match(mainSource, /title="Dismiss" aria-label="Dismiss"/);
  assert.match(mainSource, /data-action="retry-boot"/);
});

test("the second-instance note is shown once", () => {
  assert.match(mainSource, /function showSecondInstance[\s\S]{0,220}if \(secondInstanceShown\) return/);
  assert.match(mainSource, /Storage Studio KH is already running\. This window is the running copy\./);
});

test("share addresses parse hosts and decode readable names", () => {
  assert.equal(parseShareHost("smb://192.168.0.217"), "192.168.0.217");
  assert.equal(parseShareHost("smb://192.168.0.217/Share"), "192.168.0.217");
  assert.equal(parseShareHost("192.168.0.217"), "192.168.0.217");
  assert.equal(parseShareHost("smb://"), null);
  assert.equal(shareNameFromTarget("smb://nas/Public%20Space-Media%20-%204TB"), "Public Space-Media - 4TB");
});

test("Save has a visible blocked reason for host-only and missing disk", () => {
  assert.equal(saveBlockReason({ name: "NAS", kind: "smb", target: "smb://192.168.0.217", volumeUUID: null, mountPoint: "" }), "Add the share name to the address, like smb://nas.local/studio.");
  assert.equal(saveBlockReason({ name: "Disk", kind: "volume", target: "", volumeUUID: null, mountPoint: "" }), "Choose a disk to reconnect.");
  assert.equal(saveBlockReason({ name: "NAS", kind: "smb", target: "smb://nas/Share", volumeUUID: null, mountPoint: "" }), null);
});

test("Browse sends the host and credentials and shows a chooser", () => {
  assert.match(mainSource, /backend\.invoke<null>\("list_shares", \{[\s\S]{0,180}address:[\s\S]{0,120}username:[\s\S]{0,80}password:/);
  assert.match(mainSource, /encodeURIComponent\(share\)/);
  assert.match(mainSource, /data-editor-action="browse"/);
  assert.match(mainSource, /editor\.shareChoices = payload\.shares/);
  const modelSource = readFileSync(new URL("../ui/src/model.ts", import.meta.url), "utf8");
  assert.match(modelSource, /function parseShareHost/);
  assert.match(mainSource, /listen\("shares", applyShares\)/);
  assert.match(mainSource, /id="save-reason"/);
});

test("offers shares that are already connected and skips ones already added", () => {
  assert.match(mainSource, /data-editor-action="add-connected"/);
  assert.match(mainSource, /candidate\.url !== d\.target/);
  assert.match(mainSource, /\(snapshot\?\.storages \?\? \[\]\)\.some\(\(storage\) => storage\.target === candidate\.url\)/);
  assert.match(mainSource, /draft\.target = candidate\.url/);
  assert.match(mainSource, /draft\.username = candidate\.user \?\? ""/);
  assert.match(mainSource, /editor\.shareNote = `Share: \$\{candidate\.name\}`/);
});

test("picking a connected share hides the list so the address cannot be swapped later", () => {
  assert.match(mainSource, /editor\.connectedChosen = true/);
  assert.match(mainSource, /d\.kind === "smb" && !editor\.connectedChosen/);
});
