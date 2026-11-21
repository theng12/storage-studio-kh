import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  normaliseShareAddress,
  parseShareHost,
  retrySentence,
  shareNameFromTarget,
  shareTarget,
  saveBlockReason,
  compareVersions,
  esc,
  orderWhatsNew,
  statusLabel,
  statusTone,
  storageSummary,
  testResultChanged,
  updateIsAvailable,
  updateWording,
  validateStorageDraft,
  duplicateStorageReason,
  dedupeStorages,
  warningGroups,
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

test("SMB validation accepts what people paste and names only a real problem", () => {
  const ok = (target) => assert.equal(validateStorageDraft({ name: "Studio NAS", kind: "smb", target, volumeUUID: null }), null, target);
  ok("smb://nas.local/studio");
  ok("nas.local/studio");
  ok("//nas.local/studio");
  ok("192.168.0.217/studio");
  ok("smb://100.69.137.42/Public Space-Media - 4TB - Music");
  ok("smb://100.69.137.42/Public%20Space-Media%20-%204TB%20-%20Music");
  assert.equal(validateStorageDraft({ name: "Studio NAS", kind: "smb", target: "smb://nas.local", volumeUUID: null }), "Choose a share below, or add one to the address.");
  assert.equal(validateStorageDraft({ name: "Studio NAS", kind: "smb", target: "http://nas/x", volumeUUID: null }), "Use an smb:// address, like smb://nas.local/studio.");
  assert.equal(validateStorageDraft({ name: "Studio NAS", kind: "smb", target: "nas local/studio", volumeUUID: null }), "Use an smb:// address, like smb://nas.local/studio.");
  assert.equal(validateStorageDraft({ name: "  ", kind: "smb", target: "smb://nas.local/studio", volumeUUID: null }), "Give the storage a name.");
});

test("every accepted address normalises to one stored target", () => {
  const want = "smb://100.69.137.42/Public%20Space-Media%20-%204TB%20-%20Music";
  for (const input of [
    "100.69.137.42/Public Space-Media - 4TB - Music",
    "//100.69.137.42/Public Space-Media - 4TB - Music",
    "smb://100.69.137.42/Public Space-Media - 4TB - Music",
    "smb://100.69.137.42/Public%20Space-Media%20-%204TB%20-%20Music",
  ]) {
    assert.equal(normaliseShareAddress(input)?.target, want, input);
  }
  assert.deepEqual(normaliseShareAddress("  smb://100.69.137.42/  "), { host: "100.69.137.42", share: null, target: "smb://100.69.137.42" });
  assert.equal(parseShareHost("100.69.137.42"), "100.69.137.42");
  assert.equal(parseShareHost("smb://nas/share"), "nas");
  assert.equal(normaliseShareAddress("smb://nas.name/My%20Share")?.target, "smb://nas.name/My%20Share");
  assert.equal(shareNameFromTarget(want), "Public Space-Media - 4TB - Music");
  assert.equal(normaliseShareAddress("http://nas/x"), null);
});

test("attached disk validation requires a chosen volume", () => {
  assert.equal(validateStorageDraft({ name: "Editing SSD", kind: "volume", target: "", volumeUUID: null }), "Choose the disk to reconnect.");
  assert.equal(validateStorageDraft({ name: "Editing SSD", kind: "volume", target: "disk4s1", volumeUUID: "5C2A-9F1E" }), null);
  assert.equal(validateStorageDraft({ name: "Thing", kind: "printer", target: "", volumeUUID: null }), "Choose SMB share or attached disk.");
});

test("update wording stays honest in every state", () => {
  assert.equal(updateWording({ state: "checking", version: null, reason: null }), "Checking for updates…");
  assert.equal(updateWording({ state: "up-to-date", version: null, reason: null }), "You're up to date");
  assert.equal(updateWording({ state: "available", version: "0.1.1", reason: null }), "Version 0.1.1 is available");
  assert.equal(updateWording({ state: "available", version: null, reason: null }), "An update is available");
  assert.equal(updateWording({ state: "failed", version: null, reason: "Could not reach the Update Studio: offline" }), "Could not reach the Update Studio: offline");
  assert.equal(updateWording({ state: "failed", version: null, reason: null }), "Couldn't check for updates.");
  assert.equal(updateWording({ state: "not-checked", version: null, reason: null }), "Updates not checked yet");
  assert.equal(updateWording({ state: "idle", version: null, reason: null }), "Updates not checked yet");
  assert.equal(updateWording({ state: "mystery", version: null, reason: null }), "Updates not checked yet");
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
  assert.match(mainSource, /data-fk="row-\$\{id\}-mount"/);
  assert.match(mainSource, /data-fk="row-\$\{id\}-\$\{action\}"/);
  assert.match(mainSource, /data-row-menu/);
  assert.match(mainSource, /title="Dismiss" aria-label="Dismiss"/);
  assert.match(mainSource, /data-action="retry-boot"/);
});

test("the Storage status line summarises what is true, in the chips' words", () => {
  assert.equal(storageSummary([]), "No storages yet.");
  assert.equal(storageSummary([{ status: "mounted" }]), "1 storage, all mounted.");
  assert.equal(storageSummary([{ status: "mounted" }, { status: "mounted" }]), "2 storages, all mounted.");
  assert.equal(storageSummary([{ status: "mounted" }, { status: "needs_attention" }]), "1 of 2 storages mounted, 1 needs attention.");
  assert.equal(storageSummary([{ status: "unreachable" }, { status: "mounting" }]), "2 storages, none mounted, 1 unreachable, 1 mounting.");
  assert.equal(storageSummary([{ status: "not_mounted" }, { status: "mounted" }]), "1 of 2 storages mounted, 1 not mounted.");
  assert.equal(storageSummary([{ status: "retrying" }]), "1 storage, none mounted, 1 retrying.");
});

test("a share or disk can only be added once", () => {
  const existing = [
    { id: "a", name: "Studio NAS", kind: "smb", target: "smb://nas.local/studio", volumeUUID: null },
    { id: "b", name: "Editing SSD", kind: "volume", target: "disk4s1", volumeUUID: "5C2A-9F1E" },
  ];
  assert.equal(
    duplicateStorageReason({ name: "Again", kind: "smb", target: "SMB://NAS.local/studio", volumeUUID: null }, existing),
    "studio is already added as Studio NAS.",
  );
  assert.equal(
    duplicateStorageReason({ name: "Again", kind: "smb", target: "smb://someone@nas.local/studio", volumeUUID: null }, existing),
    "studio is already added as Studio NAS.",
  );
  assert.equal(
    duplicateStorageReason({ name: "Again", kind: "smb", target: "smb://nas.local/studio/", volumeUUID: null }, existing),
    "studio is already added as Studio NAS.",
  );
  assert.equal(
    duplicateStorageReason({ name: "Again", kind: "smb", target: "smb://nas.local/st%75dio", volumeUUID: null }, existing),
    "studio is already added as Studio NAS.",
  );
  assert.equal(
    duplicateStorageReason({ name: "Disk again", kind: "volume", target: "disk4s1", volumeUUID: "5C2A-9F1E" }, existing),
    "This disk is already added as Editing SSD.",
  );
  // Editing the same entry is not a duplicate of itself.
  assert.equal(
    duplicateStorageReason({ id: "a", name: "Studio NAS", kind: "smb", target: "smb://nas.local/studio", volumeUUID: null }, existing),
    null,
  );
  assert.equal(
    duplicateStorageReason({ name: "Other", kind: "smb", target: "smb://nas.local/other", volumeUUID: null }, existing),
    null,
  );
});

test("rows are deduped by real identity and keep a count", () => {
  const rows = dedupeStorages([
    { id: "a", kind: "smb", target: "smb://nas.local/studio", volumeUUID: null, name: "One" },
    { id: "b", kind: "smb", target: "smb://nas.local/studio", volumeUUID: null, name: "One old" },
    { id: "c", kind: "smb", target: "smb://nas.local/other", volumeUUID: null, name: "Two" },
    { id: "d", kind: "volume", target: "disk4s1", volumeUUID: "UUID-1", name: "Disk" },
    { id: "e", kind: "volume", target: "disk4s1", volumeUUID: "UUID-1", name: "Disk old" },
  ]);
  assert.deepEqual(
    rows.map((row) => [row.storage.name, row.count]),
    [["One", 2], ["Two", 1], ["Disk", 2]],
  );
});

test("warnings are grouped by kind with a count", () => {
  const groups = warningGroups([
    { id: "a", status: "needs_attention", detail: "Sign in to this share to continue." },
    { id: "b", status: "needs_attention", detail: "The device refused the user name or password." },
    { id: "c", status: "unreachable", detail: "Can't reach the host." },
    { id: "d", status: "unreachable", detail: "Can't reach the host." },
    { id: "e", status: "mounted", detail: null },
  ]);
  assert.deepEqual(
    groups.map((group) => [group.label, group.count, group.firstId]),
    [["Needs a password", 2, "a"], ["Can't be reached", 2, "c"]],
  );
});

test("the second-instance note is shown once", () => {
  assert.match(mainSource, /function showSecondInstance[\s\S]{0,220}if \(secondInstanceShown\) return/);
  assert.match(mainSource, /Storage Studio KH is already running\. This window is the running copy\./);
});

test("an update hold says so instead of looking stuck", () => {
  assert.match(mainSource, /function renderHoldBannerIfNeeded[\s\S]{0,120}if \(!snapshot\?\.holding\) return ""/);
  assert.match(mainSource, /Holding new work for an update/);
  assert.match(mainSource, /resumes by itself/);
  // The banner is a status with nothing to click: no button, no dismiss.
  const start = mainSource.indexOf("function renderHoldBannerIfNeeded");
  const banner = mainSource.slice(start, mainSource.indexOf("\nfunction ", start + 1));
  assert.doesNotMatch(banner, /<button/);
});

test("share addresses parse hosts and decode readable names", () => {
  assert.equal(parseShareHost("smb://192.168.0.217"), "192.168.0.217");
  assert.equal(parseShareHost("smb://192.168.0.217/Share"), "192.168.0.217");
  assert.equal(parseShareHost("192.168.0.217"), "192.168.0.217");
  assert.equal(parseShareHost("smb://"), null);
  assert.equal(shareNameFromTarget("smb://nas/Public%20Space-Media%20-%204TB"), "Public Space-Media - 4TB");
});

test("a chosen share becomes the same normalised address a typed one would", () => {
  const target = shareTarget("nas.local", "Public Space-Media - 6TB - TV Show");
  assert.equal(target, "smb://nas.local/Public%20Space-Media%20-%206TB%20-%20TV%20Show");
  assert.equal(parseShareHost(target), "nas.local");
  assert.equal(shareNameFromTarget(target), "Public Space-Media - 6TB - TV Show");
  // Tolerates the spaces a picker's own value may carry, and never doubles the slashes.
  assert.equal(shareTarget(" nas.local ", " Studio Projects "), "smb://nas.local/Studio%20Projects");
  assert.equal(
    validateStorageDraft({ name: "NAS", kind: "smb", target, volumeUUID: null, mountPoint: "" }),
    null,
  );
});

test("the share address is picked from the device's list, and typing is the stated fallback", () => {
  // The list is the primary path: read-only field while it shows, and a refresh beside it.
  assert.match(mainSource, /shareListShown\(\) \? ' readonly aria-describedby="share-list-hint"'/);
  assert.match(mainSource, /shareListShown\(\) \? "Refresh list" : "Find shares"/);
  assert.match(mainSource, /data-editor-action="dismiss-shares">Type the address instead/);
  // Every way the list can fail says why, and none of them reads as "this device has no shares".
  assert.match(mainSource, /This device didn't list any shares\. That doesn't mean it has none\./);
  assert.match(mainSource, /Check the address, or press Find shares\./);
  assert.match(mainSource, /Enter them below, or type the address instead\./);
  // A host typed into the field is listed once typing pauses, and a new user name re-lists.
  assert.match(mainSource, /case "target":[\s\S]{0,220}scheduleShareList\(\)/);
  assert.match(mainSource, /case "username":[\s\S]{0,320}scheduleShareList\(\)/);
  assert.match(mainSource, /scheduleShareList\(0\)/);
});

test("Save has a visible blocked reason for host-only and missing disk", () => {
  assert.equal(saveBlockReason({ name: "NAS", kind: "smb", target: "smb://192.168.0.217", volumeUUID: null, mountPoint: "" }), "Add the share name to the address, like smb://nas.local/studio.");
  assert.equal(saveBlockReason({ name: "Disk", kind: "volume", target: "", volumeUUID: null, mountPoint: "" }), "Choose a disk to reconnect.");
  assert.equal(saveBlockReason({ name: "NAS", kind: "smb", target: "smb://nas/Share", volumeUUID: null, mountPoint: "" }), null);
});

test("the share list sends the host and credentials, and the chosen share is normalised once", () => {
  assert.match(mainSource, /backend\.invoke<null>\("list_shares", \{[\s\S]{0,180}address:[\s\S]{0,120}username:[\s\S]{0,80}password:/);
  // The address is built in one place (model.ts), not inline in the dialog.
  assert.match(mainSource, /editor\.draft\.target = shareTarget\(host, share\)/);
  const modelSource = readFileSync(new URL("../ui/src/model.ts", import.meta.url), "utf8");
  assert.match(modelSource, /function shareTarget[\s\S]{0,120}encodeURIComponent\(share\.trim\(\)\)/);
  assert.match(mainSource, /data-editor-action="browse"/);
  assert.match(mainSource, /editor\.shareChoices = payload\.shares/);
  assert.match(modelSource, /function parseShareHost/);
  assert.match(mainSource, /listen\("shares", applyShares\)/);
  assert.match(mainSource, /id="save-reason"/);
  // A listing always ends: its own wait past the helper's 15 s, and an answer for another device
  // is not read as this one's.
  assert.match(mainSource, /browseLease = window\.setTimeout\(\(\) => \{[\s\S]{0,160}Check the address, or press Find shares/);
  assert.match(mainSource, /payload\.host\.trim\(\)\.toLowerCase\(\) !== editor\.browseHost/);
});

test("offers shares that are already connected and skips ones already added", () => {
  assert.match(mainSource, /data-editor-action="add-connected"/);
  assert.match(mainSource, /candidate\.url !== d\.target/);
  assert.match(mainSource, /\(snapshot\?\.storages \?\? \[\]\)\.some\(\(storage\) => storage\.target === candidate\.url\)/);
  assert.match(mainSource, /draft\.target = candidate\.url/);
  assert.match(mainSource, /draft\.username = candidate\.user \?\? ""/);
});

test("picking a connected share hides the list so the address cannot be swapped later", () => {
  assert.match(mainSource, /editor\.connectedChosen = true/);
  assert.match(mainSource, /d\.kind === "smb" && !editor\.connectedChosen/);
});

test("Save explains a missing name and a disconnected disk beside the button", () => {
  assert.equal(saveBlockReason({ name: "", kind: "smb", target: "smb://nas/Share", volumeUUID: null, mountPoint: "" }), "Give this storage a name.");
  assert.equal(saveBlockReason({ name: "Disk", kind: "volume", target: "", volumeUUID: null, mountPoint: "" }, false), "No disks are connected right now.");
  assert.equal(saveBlockReason({ name: "Disk", kind: "volume", target: "", volumeUUID: null, mountPoint: "" }, true), "Choose a disk to reconnect.");
});

test("retry sentence follows the chosen number", () => {
  assert.match(retrySentence(1), /tries once more, 5 s later/);
  assert.match(retrySentence(2), /after 5 s and 15 s/);
  assert.match(retrySentence(3), /after 5 s, 15 s and 60 s/);
  assert.match(retrySentence(5), /up to 5 more attempts/);
  assert.match(retrySentence(5), /60 s for each later try/);
});

test("Settings opens from launch, the app menu and the tray, rebuilding if missing", () => {
  const rust = readFileSync(new URL("../src-tauri/src/main.rs", import.meta.url), "utf8");
  assert.match(rust, /show_settings\(&handle\)/);
  assert.match(rust, /WebviewWindowBuilder::new\(app, "settings"/);
  assert.match(rust, /"settings" => show_settings\(app\)/);
  assert.match(rust, /"app-settings"[\s\S]{0,160}show_settings\(app\)/);
});

test("footer keeps Support, pill + updates and the status line on one grid", () => {
  const css = readFileSync(new URL("../ui/src/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.foot-updates \{[^}]*gap: var\(--s-xs\)[^}]*padding: 0 var\(--s-s\)/s);
  assert.match(css, /\.update-line \{[^}]*padding: 0 var\(--s-s\)/s);
});

test("Return saves and a click outside never discards typed input", () => {
  assert.match(mainSource, /event\.key !== "Enter"[\s\S]{0,420}saveEditor\(\)/);
  assert.match(mainSource, /A click outside a sheet must never throw away typed input/);
  // Every sheet except What's New ignores an outside click; only What's New closes on it.
  assert.match(mainSource, /if \(dialog !== whatsnewEl\) return/);
});

test("the app menu offers Close Window with the standard shortcut", () => {
  const rust = readFileSync(new URL("../src-tauri/src/main.rs", import.meta.url), "utf8");
  assert.match(rust, /PredefinedMenuItem::close_window\(app, Some\("Close Window"\)\)/);
});

test("only the installed app may register a login item, once", () => {
  const rust = readFileSync(new URL("../src-tauri/src/main.rs", import.meta.url), "utf8");
  assert.match(rust, /fn is_installed_copy/);
  assert.match(rust, /Path::new\("\/Applications"\)/);
  assert.match(rust, /fn login_item_needs_change/);
  assert.match(rust, /login_item::can_register\(\)/);
});

test("a second launch reopens the window, even after it was hidden", () => {
  const rust = readFileSync(new URL("../src-tauri/src/main.rs", import.meta.url), "utf8");
  assert.match(rust, /RunEvent::Reopen \{ \.\. \} => show_settings\(app\)/);
  assert.match(rust, /size\.width < 700 \|\| size\.height < 520/);
  assert.match(rust, /SHOW_ONCE:/);
});

test("a mount point is chosen in the native folder panel and never typed", () => {
  // The path field is read-only, the panel is the only control that sets it, and typing is gone.
  assert.match(mainSource, /name="mountPoint"[^>]*readonly/);
  assert.match(mainSource, /data-editor-action="pick-mount"/);
  assert.match(mainSource, /case "pick-mount":[\s\S]{0,80}pickMountPoint\(\)/);
  assert.match(mainSource, /backend\.invoke<string \| null>\("pick_mount_point", \{\s*startDir:/);
  assert.match(mainSource, /editor\.draft\.mountPoint = chosen\.trim\(\)/);
  assert.match(mainSource, /data-editor-action="clear-mount"/);
  assert.match(mainSource, /editor\.draft\.mountPoint = ""/);
  assert.doesNotMatch(mainSource, /case "mountPoint":\s*\n\s*draft\.mountPoint = target\.value/);
  const rust = readFileSync(new URL("../src-tauri/src/main.rs", import.meta.url), "utf8");
  assert.match(rust, /async fn pick_mount_point/);
  assert.match(rust, /class!\(NSOpenPanel\), openPanel/);
  assert.match(rust, /setCanChooseDirectories: true/);
});

test("the hold route requires the Launcher's token on every request", () => {
  const rust = readFileSync(new URL("../src-tauri/src/main.rs", import.meta.url), "utf8");
  assert.match(rust, /KHU_HOLD_TOKEN_FILE/);
  assert.match(rust, /"Library"\)\.join\("KHUpdater"\)\.join\("state"\)\.join\("hold-token"\)/);
  assert.match(rust, /fn authorize_hold_headers/);
  assert.match(rust, /401 Unauthorized/);
  assert.match(rust, /constant_time_eq/);
});

test("no app surface uses the browser confirm, alert or prompt", () => {
  for (const file of ["../ui/src/main.ts", "../ui/src/dev-fixture.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\bwindow\.(confirm|alert|prompt)\s*\(/);
    assert.doesNotMatch(source, /(?<![.\w])(confirm|alert|prompt)\s*\(/);
  }
});
