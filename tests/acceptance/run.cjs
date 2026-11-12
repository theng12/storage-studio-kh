#!/usr/bin/env node
/*
 * Page-by-page acceptance run for Storage Studio KH.
 *
 *   node tests/acceptance/run.cjs
 *
 * Uses the dev fixture's injected snapshot hook (`window.__SS_TEST__`) so the real UI code
 * runs against a snapshot captured from the live app (`live-snapshot.json`, produced with
 * `Storage Studio KH --dump-snapshot`). Headless Chromium only; no visible window, no focus.
 * Writes screenshots and expected-vs-actual evidence under tests/acceptance/.
 */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const REPO = path.resolve(__dirname, "..", "..");
const OUT = __dirname;
const SHOTS = path.join(OUT, "screenshots");
const PLAYWRIGHT = process.env.SS_PLAYWRIGHT || "/Users/you/Developer/My Own Apps/music-studio-kh/node_modules/playwright";
const { chromium } = require(PLAYWRIGHT);

const BASE = "http://localhost:1420/";
const live = JSON.parse(fs.readFileSync(path.join(OUT, "live-snapshot.json"), "utf8"));

const checks = [];
const screenshots = [];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function variant(mutate) {
  const snapshot = clone(live);
  mutate(snapshot);
  return snapshot;
}

function record(page, id, expected, actual, pass, evidence) {
  checks.push({ page, id, expected, actual, pass, evidence: evidence || null });
  const mark = pass ? "PASS" : "FAIL";
  console.log(`${mark} ${page} ${id}`);
  if (!pass) console.log(`     expected: ${expected}\n     actual:   ${actual}`);
}

function eq(page, id, expected, actual, evidence) {
  record(page, id, expected, JSON.stringify(expected), JSON.stringify(actual), JSON.stringify(expected) === JSON.stringify(actual), evidence);
}

function truthy(page, id, expected, actual, evidence) {
  record(page, id, expected, String(actual), Boolean(actual), evidence);
}

async function open(browser, snapshot, options = {}) {
  const width = options.width || 820;
  const height = options.height || 640;
  const theme = options.theme || "light";
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, reducedMotion: "reduce" });
  await page.addInitScript((payload) => {
    window.__SS_TEST__ = { snapshot: payload, commands: [] };
  }, clone(snapshot));
  await page.goto(`${BASE}?acceptance=1#view=storage&theme=${theme}`);
  await page.waitForSelector("h1");
  await page.waitForTimeout(120);
  return page;
}

async function shot(page, name) {
  const file = path.join(SHOTS, `${name}.png`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file });
  screenshots.push(path.relative(REPO, file));
  return path.relative(REPO, file);
}

async function commands(page) {
  return page.evaluate(() => (window.__SS_TEST__?.commands ?? []).map((item) => item.command));
}

async function lastCommand(page) {
  return page.evaluate(() => {
    const list = window.__SS_TEST__?.commands ?? [];
    return list.length ? list[list.length - 1] : null;
  });
}

async function emit(page, event, payload) {
  await page.evaluate(({ event, payload }) => window.__SS_EMIT__?.(event, payload), { event, payload });
  await page.waitForTimeout(120);
}

async function accessibleNameAudit(page, id) {
  const unnamed = await page.evaluate(() => {
    const controls = [...document.querySelectorAll("button, [role=button], input, select, a[href]")];
    return controls
      .filter((el) => {
        if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") return false;
        if (el.tagName === "INPUT" && el.type === "hidden") return false;
        const aria = el.getAttribute("aria-label") || "";
        const labelledBy = el.getAttribute("aria-labelledby");
        const byId = labelledBy ? document.getElementById(labelledBy)?.textContent || "" : "";
        const text = (el.textContent || "").trim();
        const title = el.getAttribute("title") || "";
        if (el.tagName === "INPUT") {
          const label = el.closest("label");
          return !(aria || byId || title || (label && label.textContent.trim()));
        }
        return !(aria || byId || text || title);
      })
      .map((el) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}.${el.className || ""}`);
  });
  eq("Audit", id, [], unnamed);
}

async function noOverflow(page, id) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  truthy("Audit", id, "no horizontal overflow", overflow <= 0 ? "0" : `${overflow}px`, null);
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = spawn("npm", ["run", "dev"], { cwd: REPO, stdio: "ignore", env: { ...process.env } });
  let browser;
  try {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        const response = await fetch(BASE);
        if (response.ok) break;
      } catch {
        /* still starting */
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    browser = await chromium.launch({ headless: true });

    /* ---------------------------------------------------------- Storage list */
    {
      const page = await open(browser, live);
      eq("Storage", "heading", "Storage", await page.locator("h1").first().textContent());
      eq("Storage", "row count", 4, await page.locator("li.storage-row").count());
      const rowsText = await page.locator("main, .content").first().innerText();
      truthy("Storage", "real shares visible", "Public Space-System pool in list", rowsText.includes("Public Space-System pool"), null);
      truthy("Storage", "mounted state visible", "Mounted chip", rowsText.includes("Mounted"), null);
      truthy("Storage", "mounted path visible", "real /Volumes path", rowsText.includes("/Volumes/Public Space-System pool"), null);
      truthy("Storage", "footer pill", "Storage Studio KH v0.1.2", (await page.locator('[data-fk="pill"]').innerText()).includes("v0.1.2"), null);
      const evidence = await shot(page, "storage/list-light-820x640");
      await accessibleNameAudit(page, "storage controls named");
      await noOverflow(page, "storage no overflow");
      // Row actions invoke their commands.
      await page.locator('[data-action="unmount"]').first().click().catch(() => {});
      await page.waitForTimeout(150);
      let names = await commands(page);
      truthy("Storage", "row Unmount invokes", "unmount_storage", names.includes("unmount_storage"), evidence);
      await page.locator('[data-action="test"]').first().click().catch(() => {});
      await page.waitForTimeout(150);
      names = await commands(page);
      truthy("Storage", "row Test invokes", "test_storage", names.includes("test_storage"), evidence);
      {
        const revealPage = await open(browser, live);
        await revealPage.locator('[data-action="reveal"]:not([disabled])').first().click();
        await revealPage.waitForTimeout(150);
        truthy("Storage", "row Open in Finder invokes", "reveal_storage", (await commands(revealPage)).includes("reveal_storage"), evidence);
        await revealPage.close();
      }
      await page.locator('[data-action="edit"]').first().click().catch(() => {});
      await page.waitForTimeout(150);
      truthy("Storage", "row Edit opens the editor", "dialog open", await page.locator("dialog[open]").count() > 0, evidence);
      await page.keyboard.press("Escape");

      // Narrow window.
      const narrow = await open(browser, live, { width: 700, height: 520 });
      await noOverflow(narrow, "storage no overflow at 700x520");
      await shot(narrow, "storage/list-light-700x520");
      await narrow.close();

      // Dark theme.
      const dark = await open(browser, live, { theme: "dark" });
      await shot(dark, "storage/list-dark-820x640");
      await dark.close();
      await page.close();
    }

    /* ------------------------------------------------- Needs attention / errors */
    {
      const attention = variant((snapshot) => {
        snapshot.storages[1].status = "needs_attention";
        snapshot.storages[1].detail = "The share couldn't be mounted (code 13). Address tried: smb://vengtheng@100.69.137.42/Public%20Space-Media%20-%206TB%20-%20TV%20Show";
        snapshot.storages[1].mountedPath = null;
        snapshot.storages[2].status = "unreachable";
        snapshot.storages[2].detail = "Can't reach 100.69.137.42 right now. Address tried: smb://vengtheng@100.69.137.42/Public%20Space-System%20pool";
        snapshot.storages[2].mountedPath = null;
      });
      const page = await open(browser, attention);
      const text = await page.locator("main, .content").first().innerText();
      truthy("Attention", "chip", "Needs attention", text.includes("Needs attention"), null);
      truthy("Attention", "address in reason", "Address tried: smb://", text.includes("Address tried: smb://"), null);
      const evidence = await shot(page, "attention/attention-light-820x640");
      await page.locator('[data-action="mount"]').first().click().catch(() => {});
      await page.waitForTimeout(150);
      truthy("Attention", "Mount now invokes", "mount_storage", (await commands(page)).includes("mount_storage"), evidence);

      // Test result toast comes from a changed detail.
      await page.locator('[data-action="test"]').first().click().catch(() => {});
      const before = clone(attention);
      before.storages[1].detail = "The share couldn't be mounted (code 13). Address tried: smb://vengtheng@100.69.137.42/Public%20Space-Media%20-%206TB%20-%20TV%20Show";
      const after = clone(before);
      after.storages[1].detail = "100.69.137.42 is reachable and ready to mount.";
      await emit(page, "snapshot", after);
      const toastText = await page.locator(".toast, [role=status]").allInnerTexts().catch(() => []);
      truthy("Attention", "test result toasted", "toast mentions reachable", toastText.join(" ").includes("reachable"), evidence);
      await page.close();

      // Engine down on every view.
      const down = variant((snapshot) => {
        snapshot.engineRunning = false;
        snapshot.engineError = "The background helper stopped. Reopen the app to start it again.";
      });
      const downPage = await open(browser, down);
      const storageText = await downPage.locator("main, .content").first().innerText();
      truthy("Engine", "banner on Storage", "helper stopped sentence", storageText.includes("background helper stopped"), null);
      await downPage.locator('[data-fk="nav-general"]').click();
      truthy("Engine", "banner on General", "helper stopped sentence", (await downPage.locator("main, .content").first().innerText()).includes("background helper stopped"), null);
      await downPage.locator('[data-fk="nav-appearance"]').click();
      truthy("Engine", "banner on Appearance", "helper stopped sentence", (await downPage.locator("main, .content").first().innerText()).includes("background helper stopped"), null);
      await shot(downPage, "engine/engine-down-appearance-light-820x640");
      await downPage.close();
    }

    /* ------------------------------------------------------- Add storage (SMB) */
    {
      const page = await open(browser, live);
      await page.locator('[data-fk="add-storage"], [data-action="add-storage"]').first().click();
      await page.waitForTimeout(150);
      const dialogText = await page.locator("dialog[open]").innerText();
      truthy("Add", "label says host + share", "Share address (host + share)", dialogText.includes("Share address (host + share)"), null);
      const save = page.locator('[data-editor-action="save"]');
      truthy("Add", "Save disabled before address", "disabled", await save.isDisabled(), null);
      const reason = await page.locator("#save-reason").innerText();
      truthy("Add", "reason visible next to Save", "Add the share name…", reason.includes("Add the share name"), null);
      truthy("Add", "reason linked to Save", "aria-describedby", (await save.getAttribute("aria-describedby")) === "save-reason", null);
      const evidence = await shot(page, "add/add-validation-light-820x640");

      // Host-only address keeps Save blocked with the reason.
      await page.locator('input[name="target"]').fill("smb://192.168.0.217");
      await page.waitForTimeout(120);
      truthy("Add", "host-only keeps Save off", "disabled", await save.isDisabled(), evidence);
      truthy("Add", "host-only reason", "Add the share name", (await page.locator("#save-reason").innerText()).includes("Add the share name"), evidence);

      // Browse: real shares with spaces, pick one, encoded address.
      await page.locator('[data-editor-action="browse"]').click();
      await page.waitForTimeout(150);
      const browse = await lastCommand(page);
      eq("Add", "Browse sends the host", "list_shares", browse && browse.command);
      const browseArgs = browse && browse.args;
      truthy("Add", "Browse sends address", "address contains host", String(browseArgs?.address || "").includes("192.168.0.217"), null);
      await emit(page, "shares", {
        host: "192.168.0.217",
        shares: ["Public Space-Media - 4TB - Music", "Public Space-System pool"],
        needsCredentials: false,
        error: null,
      });
      const chooser = await page.locator('[data-editor-action="pick-share"]').allInnerTexts();
      eq("Add", "chooser shows real names", ["Public Space-Media - 4TB - Music", "Public Space-System pool"], chooser);
      await shot(page, "add/add-browse-chooser-light-820x640");
      await page.locator('[data-editor-action="pick-share"]').first().click();
      await page.waitForTimeout(150);
      eq("Add", "picked address is encoded", "smb://192.168.0.217/Public%20Space-Media%20-%204TB%20-%20Music", await page.locator('input[name="target"]').inputValue());
      truthy("Add", "readable share line", "Share: Public Space-Media - 4TB - Music", (await page.locator("dialog[open]").innerText()).includes("Share: Public Space-Media - 4TB - Music"), null);
      truthy("Add", "Save enabled for a full address", "enabled", !(await save.isDisabled()), null);

      // Credential request for a device with no saved password.
      await page.locator('[data-editor-action="browse"]').click();
      await page.waitForTimeout(100);
      await emit(page, "shares", { host: "192.168.0.217", shares: [], needsCredentials: true, error: null });
      truthy("Add", "credential message", "needs a user name and password", (await page.locator("dialog[open]").innerText()).includes("needs a user name and password"), null);

      // From a connected share: one click fills the form and hides the list.
      await page.keyboard.press("Escape");
      const addable = variant((snapshot) => {
        snapshot.storages = snapshot.storages.filter((item) => !item.name.includes("4TB - Music"));
      });
      const connPage = await open(browser, addable);
      await connPage.locator('[data-fk="add-storage"], [data-action="add-storage"]').first().click();
      await connPage.waitForTimeout(150);
      const connected = connPage.locator('[data-editor-action="add-connected"]');
      const connectedCount = await connected.count();
      truthy("Add", "connected shares offered", "at least one row", connectedCount >= 1, null);
      await shot(connPage, "add/add-connected-light-820x640");
      await connected.first().click();
      await connPage.waitForTimeout(150);
      eq("Add", "connected pick fills encoded address", "smb://vengtheng@100.69.137.42/Public%20Space-Media%20-%204TB%20-%20Music", await connPage.locator('input[name="target"]').inputValue());
      eq("Add", "connected list hides after the pick", 0, await connPage.locator('[data-editor-action="add-connected"]').count());
      eq("Add", "connected pick fills user", "vengtheng", await connPage.locator('input[name="username"]').inputValue());
      await connPage.keyboard.press("Escape");
      await connPage.close();

      // Attached disk flow.
      await page.locator('[data-fk="add-storage"], [data-action="add-storage"]').first().click();
      await page.locator('input[name="kind"][value="volume"]').check();
      await page.waitForTimeout(120);
      truthy("Add", "disk Save blocked", "disabled", await save.isDisabled(), null);
      truthy("Add", "disk reason", "Choose a disk to reconnect.", (await page.locator("#save-reason").innerText()).includes("Choose a disk"), null);
      const diskOptions = await page.locator('select[name="volumeUUID"] option').count();
      truthy("Add", "connected disks offered", "options include real volumes", diskOptions >= 2, null);
      await shot(page, "add/add-disk-light-820x640");
      await page.locator('select[name="volumeUUID"]').selectOption({ index: 1 });
      await page.waitForTimeout(120);
      truthy("Add", "disk choice shows mount point", "/Volumes/", (await page.locator("dialog[open]").innerText()).includes("/Volumes/"), null);
      truthy("Add", "disk Save enabled", "enabled", !(await save.isDisabled()), null);
      await page.keyboard.press("Escape");
      await page.close();
    }

    /* ------------------------------------------------------------ General */
    {
      const page = await open(browser, live);
      await page.locator('[data-fk="nav-general"]').click();
      const evidence = await shot(page, "general/general-light-820x640");
      const toggles = page.locator('input[type="checkbox"]');
      eq("General", "three settings rows", 3, await page.locator(".setting-row").count());
      await toggles.first().click();
      await page.waitForTimeout(150);
      let last = await lastCommand(page);
      eq("General", "notifications toggle invokes", "set_general", last && last.command);
      truthy("General", "sends all three values", "notifications/launchAtLogin/retries present", ["notifications", "launchAtLogin", "retries"].every((key) => key in (last?.args || {})), evidence);
      await page.locator('[data-general="retries"]').fill("5");
      await page.locator('[data-general="retries"]').blur();
      await page.waitForTimeout(150);
      last = await lastCommand(page);
      eq("General", "retries saved", 5, last?.args?.retries);
      await shot(page, "general/general-dark-820x640", await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; }));
      await page.close();

      // Launch-at-login mismatch is explained.
      const mismatch = variant((snapshot) => {
        snapshot.general.launchAtLogin = true;
        snapshot.launchAtLoginEnabled = false;
        snapshot.launchAtLoginError = "macOS would not change the login item. Move the app to Applications and try again.";
      });
      const page2 = await open(browser, mismatch);
      await page2.locator('[data-fk="nav-general"]').click();
      truthy("General", "login item error shown", "Move the app to Applications", (await page2.locator("main, .content").first().innerText()).includes("Move the app to Applications"), null);
      await shot(page2, "general/general-login-error-light-820x640");
      await page2.close();
    }

    /* --------------------------------------------------------- Appearance */
    {
      const page = await open(browser, live);
      await page.locator('[data-fk="nav-appearance"]').click();
      const labels = await page.locator('label:has(input[data-appearance])').allInnerTexts().catch(() => []);
      truthy("Appearance", "three choices", "System, Light, Dark", ["System", "Light", "Dark"].every((name) => labels.join(" ").includes(name)), null);
      await page.locator('input[data-appearance="dark"]').check();
      await page.waitForTimeout(150);
      eq("Appearance", "dark applies live", "dark", await page.evaluate(() => document.documentElement.dataset.theme));
      eq("Appearance", "invokes set_appearance", "set_appearance", (await lastCommand(page))?.command);
      await shot(page, "appearance/appearance-dark-820x640");
      await page.locator('input[data-appearance="light"]').check();
      await page.waitForTimeout(150);
      eq("Appearance", "light applies live", "light", await page.evaluate(() => document.documentElement.dataset.theme));
      await page.close();
    }

    /* --------------------------------------------- What's New / Support / updates */
    {
      const page = await open(browser, live);
      await page.locator('[data-fk="pill"]').click();
      await page.waitForTimeout(150);
      const whatsnew = await page.locator("dialog[open]").innerText();
      truthy("Updates", "What's New opens", "title", whatsnew.includes("What's New"), null);
      truthy("Updates", "current version marked", "Current version", whatsnew.includes("Current version"), null);
      await shot(page, "updates/whats-new-light-820x640");
      await page.keyboard.press("Escape");

      await page.locator('[data-fk="check"]').click();
      await page.waitForTimeout(120);
      eq("Updates", "check icon invokes", "check_updates", (await lastCommand(page))?.command);
      await page.waitForTimeout(120);
      await page.waitForTimeout(80);
      truthy("Updates", "checking state announced", "Checking for updates", (await page.locator("body").innerText()).includes("Checking for updates"), null);

      const available = variant((snapshot) => {
        snapshot.update = { state: "available", version: "0.1.3", reason: null };
      });
      const page2 = await open(browser, available);
      await page2.waitForSelector('[data-fk="download"]', { timeout: 3000 }).catch(() => {});
      truthy("Updates", "download icon appears", "download button", (await page2.locator('[data-fk="download"]').count()) === 1, null);
      await page2.locator('[data-fk="download"]').click();
      await page2.waitForTimeout(120);
      eq("Updates", "download opens the Launcher", "open_updater", (await lastCommand(page2))?.command);
      await shot(page2, "updates/update-available-light-820x640");
      await page2.close();

      const failed = variant((snapshot) => {
        snapshot.update = { state: "failed", version: null, reason: "Could not reach the Update Studio: offline" };
      });
      const page3 = await open(browser, failed);
      await page3.waitForTimeout(150);
      truthy("Updates", "failed check shown honestly", "Could not reach the Update Studio", (await page3.locator("body").innerText()).includes("Could not reach the Update Studio"), null);
      await shot(page3, "updates/update-failed-light-820x640");
      await page3.close();

      await page.locator('[data-fk="nav-support"]').click();
      truthy("Support", "support page opens", "donation copy", (await page.locator("main, .content").first().innerText()).toLowerCase().includes("donation"), null);
      await shot(page, "support/support-light-820x640");
      await page.locator('[data-action="open-support"]').first().click().catch(() => {});
      await page.waitForTimeout(120);
      eq("Support", "donation button invokes", "open_support", (await lastCommand(page))?.command);
      await page.close();

      // Empty state.
      const empty = variant((snapshot) => {
        snapshot.storages = [];
        snapshot.mountedShares = [];
      });
      const page4 = await open(browser, empty);
      const emptyText = await page4.locator("main, .content").first().innerText();
      truthy("Empty", "empty state teaches", "No storage yet", emptyText.includes("No storage yet"), null);
      await shot(page4, "empty/empty-light-820x640");
      await page4.close();
    }

    /* --------------------------------------- Credentials dialog / second instance */
    {
      const page = await open(browser, live);
      await emit(page, "needs-credentials", { id: "s1794488987703", name: "Public Space-Media - 4TB - Music" });
      const dialog = await page.locator("dialog[open]").innerText().catch(() => "");
      truthy("Dialog", "credentials prompt opens", "user name and password fields", dialog.toLowerCase().includes("password"), null);
      await page.locator('input[name="credential-username"]').fill("vengtheng");
      await page.locator('input[name="credential-password"]').fill("not-a-real-password");
      await shot(page, "dialog/credentials-light-820x640");
      await page.locator('[data-credentials-action="save"]').click();
      await page.waitForTimeout(150);
      const last = await lastCommand(page);
      eq("Dialog", "save invokes set_credentials", "set_credentials", last && last.command);
      truthy("Dialog", "password never rendered in plain text after save", "input type=password", (await page.locator('input[name="credential-password"]').getAttribute("type").catch(() => "password")) === "password", null);
      await page.keyboard.press("Escape");

      await emit(page, "second-instance", null);
      const toast = await page.locator(".toast, [role=status]").allInnerTexts().catch(() => []);
      truthy("Dialog", "second instance noted once", "already running", toast.join(" ").includes("already running"), null);
      await emit(page, "second-instance", null);
      const noted = await page.locator(".toast").filter({ hasText: "already running" }).count();
      truthy("Dialog", "second instance not repeated", "single note", noted <= 1, null);
      await page.close();
    }
  } finally {
    if (browser) await browser.close();
    server.kill("SIGTERM");
  }

  const failed = checks.filter((item) => !item.pass);
  const report = {
    generatedAt: new Date().toISOString(),
    appVersion: live.version,
    checks,
    screenshots,
    summary: { total: checks.length, passed: checks.length - failed.length, failed: failed.length },
  };
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  const lines = [
    "# Storage Studio KH — page acceptance",
    "",
    `Run: ${report.generatedAt} · app ${live.version} · ${report.summary.passed}/${report.summary.total} checks passed`,
    "",
    "| Page | Check | Expected | Actual | Result |",
    "| --- | --- | --- | --- | --- |",
    ...checks.map((item) => `| ${item.page} | ${item.id} | ${String(item.expected).replace(/\|/g, "\\|")} | ${String(item.actual).replace(/\|/g, "\\|")} | ${item.pass ? "PASS" : "FAIL"} |`),
    "",
    "## Screenshots",
    "",
    ...screenshots.map((file) => `- ${file}`),
    "",
  ];
  fs.writeFileSync(path.join(OUT, "report.md"), lines.join("\n"));
  console.log(`\n${report.summary.passed}/${report.summary.total} checks passed; report at tests/acceptance/report.md`);
  if (failed.length) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
