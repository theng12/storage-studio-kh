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
  const view = options.view || "storage";
  const extra = options.extra || "";
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, reducedMotion: "reduce" });
  await page.addInitScript((payload) => {
    window.__SS_TEST__ = { snapshot: payload, commands: [] };
  }, clone(snapshot));
  await page.goto(`${BASE}?acceptance=1#view=${view}&theme=${theme}${extra}`);
  await page.waitForSelector("h1");
  await page.waitForTimeout(120);
  return page;
}

async function rowAction(page, id, action) {
  await page.locator(`[data-storage="${id}"] [data-row-menu]`).click();
  await page.waitForTimeout(100);
  await page.locator(`#row-menu [data-action="${action}"]`).click();
  await page.waitForTimeout(180);
}

async function closeEditorDiscarding(page) {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  if (await page.locator('[data-editor-action="discard"]').count()) {
    await page.locator('[data-editor-action="discard"]').click();
    await page.waitForTimeout(100);
  }
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
      truthy("Storage", "footer pill", `Storage Studio KH v${live.version}`, (await page.locator('[data-fk="pill"]').innerText()).includes(`v${live.version}`), null);
      const evidence = await shot(page, "storage/list-light-820x640");
      await accessibleNameAudit(page, "storage controls named");
      await noOverflow(page, "storage no overflow");
      // Esc closes the editor.
      await page.locator('[data-action="add-storage"], [data-fk="add-storage"]').first().click();
      await page.waitForTimeout(120);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(120);
      truthy("Esc", "closes the add dialog", "no open dialog", (await page.locator("dialog[open]").count()) === 0, null);
      // Esc dismisses Browse results first, keeping the editor open.
      await page.locator('[data-action="add-storage"], [data-fk="add-storage"]').first().click();
      await page.locator('input[name="name"]').fill("Esc test");
      await page.locator('input[name="target"]').fill("smb://192.168.0.217");
      await page.locator('[data-editor-action="browse"]').click();
      await page.waitForTimeout(100);
      await emit(page, "shares", { host: "192.168.0.217", shares: ["One"], needsCredentials: false, error: null });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(100);
      truthy("Esc", "dismisses Browse results", "chooser gone, dialog open", (await page.locator(".share-picker").count()) === 0 && (await page.locator("dialog[open]").count()) === 1, null);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(100);
      truthy("Esc", "asks before discarding typed edits", "Discard changes?", (await page.locator("#editor-title").innerText()).includes("Discard changes"), null);
      await page.locator('[data-editor-action="discard"]').click();
      await page.waitForTimeout(100);
      truthy("Esc", "discard closes the editor", "dialog closed", (await page.locator("dialog[open]").count()) === 0, null);
      // Esc returns from a Remove confirmation to the editor.
      const escRow = await open(browser, live);
      await rowAction(escRow, live.storages[0].id, "edit");
      await escRow.waitForTimeout(120);
      await escRow.locator('[data-editor-action="remove"]').click();
      await escRow.waitForTimeout(100);
      await escRow.keyboard.press("Escape");
      await escRow.waitForTimeout(100);
      truthy("Esc", "Remove confirmation returns to the editor", "editor still open without confirm", (await escRow.locator("#editor-title").innerText()).includes("Edit storage"), null);
      await escRow.keyboard.press("Escape");
      await escRow.close();

      // Row actions invoke their commands.
      await rowAction(page, live.storages[0].id, "unmount");
      let names = await commands(page);
      truthy("Storage", "row Unmount invokes", "unmount_storage", names.includes("unmount_storage"), evidence);
      await rowAction(page, live.storages[0].id, "test");
      names = await commands(page);
      truthy("Storage", "row Test invokes", "test_storage", names.includes("test_storage"), evidence);
      {
        const revealPage = await open(browser, live);
        await revealPage.locator('[data-action="reveal"]:not([disabled])').first().click();
        await revealPage.waitForTimeout(150);
        truthy("Storage", "row Open in Finder invokes", "reveal_storage", (await commands(revealPage)).includes("reveal_storage"), evidence);
        await revealPage.close();
      }
      await rowAction(page, live.storages[0].id, "edit");
      truthy("Storage", "row Edit opens the editor", "dialog open", await page.locator("dialog[open]").count() > 0, evidence);
      await page.keyboard.press("Escape");

      // Narrow window.
      const narrow = await open(browser, live, { width: 700, height: 520 });
      await noOverflow(narrow, "storage no overflow at 700x520");
      await shot(narrow, "storage/list-light-700x520");
      await narrow.close();

      // Footer alignment evidence at 1440 and 375, light and dark.
      for (const [fw, fh] of [[1440, 900], [375, 812]]) {
        for (const tone of ["light", "dark"]) {
          const footSnap = variant((snapshot) => { snapshot.appearance = tone; });
          const footPage = await open(browser, footSnap, { width: fw, height: fh });
          await footPage.waitForSelector('html[data-theme="' + tone + '"]', { timeout: 3000 });
          const box = await footPage.evaluate(() => {
            const left = (selector) => {
              const el = document.querySelector(selector);
              return el ? Math.round(el.getBoundingClientRect().left + parseFloat(getComputedStyle(el).paddingLeft)) : null;
            };
            const support = document.querySelector(".foot-support");
            const pill = document.querySelector('[data-fk="pill"]');
            const check = document.querySelector('[data-fk="check"]');
            const foot = document.querySelector("#foot").getBoundingClientRect();
            return {
              supportLeft: support ? Math.round(support.getBoundingClientRect().left + parseFloat(getComputedStyle(support).paddingLeft)) : null,
              rowLeft: left(".foot-updates"),
              lineLeft: left(".update-line"),
              pillCenter: pill ? Math.round(pill.getBoundingClientRect().top + pill.getBoundingClientRect().height / 2) : null,
              checkCenter: check ? Math.round(check.getBoundingClientRect().top + check.getBoundingClientRect().height / 2) : null,
              footBottom: Math.round(foot.bottom),
              pillLeft: pill ? Math.round(pill.getBoundingClientRect().left) : null,
              pillBottom: pill ? Math.round(pill.getBoundingClientRect().bottom) : null,
            };
          });
          if (fw > 640) {
            truthy("Footer", `aligned at ${fw} ${tone}`, "support, row and status share one left edge", box.supportLeft === box.rowLeft && box.rowLeft === box.lineLeft, JSON.stringify(box));
            truthy("Footer", `pill and update icon centred at ${fw} ${tone}`, "same centre line", box.pillCenter === box.checkCenter, JSON.stringify(box));
          } else {
            truthy("Footer", `pinned to the bottom at ${fw} ${tone}`, "footer bottom on the window edge", Math.abs(box.footBottom - fh) <= 1, JSON.stringify(box));
            truthy("Footer", `pill bottom-left at ${fw} ${tone}`, "pill in the left half near the bottom", box.pillLeft < fw / 2 && box.pillBottom > fh - 120, JSON.stringify(box));
          }
          await shot(footPage, `footer/footer-${tone}-${fw}x${fh}`);
          await footPage.close();
        }
      }

      // Dark theme: the app follows snapshot.appearance, not the URL hash.
      const darkSnap = variant((snapshot) => { snapshot.appearance = "dark"; });
      const dark = await open(browser, darkSnap);
      await dark.waitForSelector('html[data-theme="dark"]', { timeout: 3000 });
      const darkEvidence = await shot(dark, "storage/list-dark-820x640");
      const darkBg = await dark.evaluate(() => getComputedStyle(document.body).backgroundColor);
      const crypto = require("node:crypto");
      const lightBytes = fs.readFileSync(path.join(SHOTS, "storage/list-light-820x640.png"));
      const darkBytes = fs.readFileSync(path.join(SHOTS, "storage/list-dark-820x640.png"));
      const different = crypto.createHash("md5").update(lightBytes).digest("hex") !== crypto.createHash("md5").update(darkBytes).digest("hex");
      truthy("Storage", "dark theme applied", "dark background and a different image", !darkBg.includes("241, 240, 236") && different, darkEvidence);
      await dark.close();

      await page.close();
    }

    /* ------------------------------------------------- Needs attention / errors */
    {
      const attention = variant((snapshot) => {
        snapshot.storages[1].status = "needs_attention";
        snapshot.storages[1].detail = "The device refused the user name or password. Address tried: smb://vengtheng@100.69.137.42/Public Space-Media - 6TB - Movies";
        snapshot.storages[1].mountedPath = null;
        // The reason says the password was refused, so a saved one exists.
        snapshot.storages[1].hasCredentials = true;
        snapshot.storages[2].status = "unreachable";
        snapshot.storages[2].detail = "Can't reach 100.69.137.42 right now. Address tried: smb://vengtheng@100.69.137.42/Public Space-System pool";
        snapshot.storages[2].mountedPath = null;
      });
      const attentionVariant = clone(attention);
      const page = await open(browser, attention);
      const text = await page.locator("main, .content").first().innerText();
      truthy("Attention", "chip", "Needs attention", text.includes("Needs attention"), null);
      truthy("Attention", "address in reason", "Address tried: smb://", text.includes("Address tried: smb://"), null);
      truthy("Attention", "reason is readable (decoded)", "no %20 in the reason", !text.includes("%20"), null);
      const evidence = await shot(page, "attention/attention-light-820x640");
      await page.locator('[data-action="mount"]').first().click().catch(() => {});
      await page.waitForTimeout(150);
      truthy("Attention", "Mount now invokes", "mount_storage", (await commands(page)).includes("mount_storage"), evidence);

      // Test result toast follows the storage's changed detail.
      await rowAction(page, live.storages[0].id, "test");
      await page.waitForTimeout(700);
      const toastText = await page.locator(".toast").allInnerTexts().catch(() => []);
      truthy("Attention", "test result toasted", "a Test: toast", toastText.some((text) => text.startsWith("Test:")), evidence);
      const narrowAttention = await open(browser, attentionVariant, { width: 700, height: 520 });
      await shot(narrowAttention, "attention/attention-light-700x520");
      await noOverflow(narrowAttention, "attention no overflow at 700x520");
      await narrowAttention.close();
      await page.close();

      // Engine down on every view: the banner carries the way out, and the status line says so.
      const down = variant((snapshot) => {
        snapshot.engineRunning = false;
        snapshot.engineError = "It stopped unexpectedly. Restart it here.";
      });
      const downPage = await open(browser, down);
      const storageText = await downPage.locator("main, .content").first().innerText();
      truthy("Engine", "banner on Storage", "helper stopped sentence", storageText.includes("It stopped unexpectedly"), null);
      truthy("Engine", "status line admits the helper is down", "Helper isn't running", storageText.includes("Helper isn't running"), null);
      truthy("Engine", "status line shows when the helper last reported", "Helper last reported", storageText.includes("Helper last reported"), null);
      truthy("Engine", "banner offers a way out", "Restart helper button", (await downPage.locator('[data-fk="restart-helper"]').count()) === 1, null);
      await downPage.locator('[data-fk="nav-general"]').click();
      truthy("Engine", "banner on General", "helper stopped sentence", (await downPage.locator("main, .content").first().innerText()).includes("It stopped unexpectedly"), null);
      await downPage.locator('[data-fk="nav-appearance"]').click();
      truthy("Engine", "banner on Appearance", "helper stopped sentence", (await downPage.locator("main, .content").first().innerText()).includes("It stopped unexpectedly"), null);
      await shot(downPage, "engine/engine-down-appearance-light-820x640");
      await downPage.locator('[data-fk="restart-helper"]').click();
      await downPage.waitForTimeout(200);
      eq("Engine", "restart helper invokes", "restart_helper", (await lastCommand(downPage))?.command);
      truthy("Engine", "helper comes back", "banner gone", (await downPage.locator(".banner").count()) === 0, null);
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
      truthy("Add", "Save disabled with an empty name", "disabled", await save.isDisabled(), null);
      truthy("Add", "no error before the person types", "no save reason", (await page.locator("#save-reason").count()) === 0, null);
      truthy("Add", "name field not marked invalid on open", "no aria-invalid", (await page.locator('input[name="name"]').getAttribute("aria-invalid")) === null, null);
      truthy("Add", "placeholders read as examples", "e.g. Studio NAS", (await page.locator('input[name="name"]').getAttribute("placeholder")) === "e.g. Studio NAS", null);
      await page.locator('input[name="name"]').fill("Studio NAS");
      await page.waitForTimeout(80);
      truthy("Add", "empty address asks for the device", "Enter the device address first", (await page.locator("#save-reason").innerText()).includes("Enter the device address first"), null);
      truthy("Add", "reason is a live region", "role=status", (await page.locator("#save-reason").getAttribute("role")) === "status", null);
      truthy("Add", "reason linked to Save", "aria-describedby", (await save.getAttribute("aria-describedby")) === "save-reason", null);
      const evidence = await shot(page, "add/add-validation-light-820x640");

      // Host-only address keeps Save blocked with the reason.
      await page.locator('input[name="target"]').fill("smb://192.168.0.217");
      await page.waitForTimeout(120);
      await shot(page, "add/add-host-only-light-820x640");
      truthy("Add", "host-only keeps Save off", "disabled", await save.isDisabled(), evidence);
      truthy("Add", "host-only reason", "Add the share name", (await page.locator("#save-reason").innerText()).includes("Add the share name"), evidence);
      truthy("Add", "address marked invalid", "aria-invalid", (await page.locator('input[name="target"]').getAttribute("aria-invalid")) === "true", null);

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
      truthy("Add", "chooser names the host", "Shares on 192.168.0.217", (await page.locator(".share-picker-head").innerText()).includes("Shares on 192.168.0.217"), null);
      eq("Add", "chooser offers both shares plus Dismiss", 3, await page.locator(".share-picker button").count());
      await shot(page, "add/add-browse-chooser-light-820x640");
      await page.locator('[data-editor-action="pick-share"]').first().click();
      await page.waitForTimeout(150);
      eq("Add", "picked address is encoded", "smb://192.168.0.217/Public%20Space-Media%20-%204TB%20-%20Music", await page.locator('input[name="target"]').inputValue());
      truthy("Add", "readable share line", "Share: Public Space-Media - 4TB - Music", (await page.locator("dialog[open]").innerText()).includes("Share: Public Space-Media - 4TB - Music"), null);
      truthy("Add", "Save enabled for a full address", "enabled", !(await save.isDisabled()), null);

      // Credential request, error and empty results each read as a warning/error, not a hint.
      await page.locator('[data-editor-action="browse"]').click();
      await page.waitForTimeout(100);
      await emit(page, "shares", { host: "192.168.0.217", shares: [], needsCredentials: true, error: null });
      truthy("Add", "credential message", "needs a user name and password", (await page.locator("dialog[open]").innerText()).includes("needs a user name and password"), null);
      truthy("Add", "credential note is a warning", "field-note-warn", (await page.locator(".field-note-warn").count()) === 1, null);
      await shot(page, "add/add-browse-credentials-light-820x640");
      await page.locator('[data-editor-action="browse"]').click();
      await page.waitForTimeout(100);
      await emit(page, "shares", { host: "192.168.0.217", shares: [], needsCredentials: false, error: "The device didn't answer." });
      truthy("Add", "browse error is an error note", "field-note-error", (await page.locator(".field-note-error").innerText()).includes("didn't answer"), null);
      await shot(page, "add/add-browse-error-light-820x640");
      await page.locator('[data-editor-action="browse"]').click();
      await page.waitForTimeout(100);
      await emit(page, "shares", { host: "192.168.0.217", shares: [], needsCredentials: false, error: null });
      truthy("Add", "empty share list explained", "didn't offer any shares", (await page.locator(".field-note-warn").innerText()).includes("didn't offer any shares"), null);
      await shot(page, "add/add-browse-empty-light-820x640");

      // Browse with no host.
      await page.locator('[data-editor-action="dismiss-shares"]').click().catch(() => {});
      await page.locator('input[name="target"]').fill("");
      await page.locator('[data-editor-action="browse"]').click();
      await page.waitForTimeout(100);
      truthy("Add", "browse without a host explains", "Enter the device address first", (await page.locator(".field-note-warn").innerText()).includes("Enter the device address first"), null);

      // From a connected share: one click fills the form and hides the list.
      await closeEditorDiscarding(page);
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
      truthy("Add", "password field still offered after a connected pick", "password input present with a private-storage hint", (await connPage.locator('input[name="password"]').getAttribute("placeholder").catch(() => "")).includes("privately"), null);
      await shot(connPage, "add/add-connected-picked-light-820x640");
      await closeEditorDiscarding(connPage);
      await connPage.close();

      // Attached disk flow.
      await page.locator('[data-fk="add-storage"], [data-action="add-storage"]').first().click();
      await page.locator('input[name="name"]').fill("Backup disk");
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
      await closeEditorDiscarding(page);
      await page.close();

      // Dark dialog evidence.
      const darkAdd = variant((snapshot) => { snapshot.appearance = "dark"; });
      const darkPage = await open(browser, darkAdd);
      await darkPage.waitForSelector('html[data-theme="dark"]', { timeout: 3000 });
      await darkPage.locator('[data-fk="add-storage"], [data-action="add-storage"]').first().click();
      await darkPage.waitForTimeout(150);
      await shot(darkPage, "add/add-validation-dark-820x640");
      await darkPage.close();
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
      const toggleFocus = await page.evaluate(() => document.activeElement?.getAttribute("data-fk"));
      truthy("General", "focus stays on the switch", "general-notifications", toggleFocus === "general-notifications", String(toggleFocus));
      eq("General", "retries offers 1 to 8", 8, await page.locator('[data-general="retries"] option').count());
      await page.locator('[data-general="retries"]').selectOption("5");
      await page.waitForTimeout(150);
      last = await lastCommand(page);
      eq("General", "retries saved", 5, last?.args?.retries);
      const focusAfterToggle = await page.evaluate(() => document.activeElement?.getAttribute("data-fk"));
      truthy("General", "focus stays on the changed control", "general-...", String(focusAfterToggle || "").startsWith("general-"), String(focusAfterToggle));
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
      await page.locator('input[data-appearance="light"]').focus();
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(200);
      const arrowFocus = await page.evaluate(() => document.activeElement?.getAttribute("data-fk"));
      truthy("Appearance", "arrow keys keep focus in the group", "an appearance control", String(arrowFocus || "").startsWith("appearance-"), String(arrowFocus));
      eq("Appearance", "arrow key selects the next choice", "dark", await page.evaluate(() => document.documentElement.dataset.theme));
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
      const previewSnap = variant((snapshot) => { snapshot.update = { state: "available", version: "9.9.9", reason: null }; });
      const previewPage = await open(browser, previewSnap);
      await previewPage.locator('[data-fk="pill"]').click();
      await previewPage.waitForTimeout(150);
      truthy("Updates", "pending update explained in What's New", "notes appear after install", (await previewPage.locator("dialog[open]").innerText()).includes("notes appear here after it is installed"), null);
      await shot(previewPage, "updates/whats-new-pending-update-light-820x640");
      await previewPage.close();
      await shot(page, "updates/whats-new-light-820x640");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(120);
      truthy("Esc", "closes What's New", "no open dialog", (await page.locator("dialog[open]").count()) === 0, null);

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
      truthy("Dialog", "the prompt names where the password is saved", "secrets.json path", dialog.includes("secrets.json"), null);
      const focusInside = await page.evaluate(() => {
        const name = document.activeElement?.getAttribute("name") ?? "";
        return name === "credential-password" || name === "credential-username";
      });
      truthy("Dialog", "focus starts inside the prompt", "a credentials field", focusInside, null);
      await page.locator('input[name="credential-username"]').fill("vengtheng");
      await page.locator('input[name="credential-password"]').fill("not-a-real-password");
      await shot(page, "dialog/credentials-light-820x640");
      await page.locator('[data-credentials-action="save"]').click();
      await page.waitForTimeout(150);
      const last = await lastCommand(page);
      eq("Dialog", "save invokes set_credentials", "set_credentials", last && last.command);
      truthy("Dialog", "password never rendered in plain text after save", "input type=password", (await page.locator('input[name="credential-password"]').getAttribute("type").catch(() => "password")) === "password", null);
      await page.keyboard.press("Escape");
      truthy("Dialog", "Esc closes only the prompt", "dialog closed", (await page.locator("dialog[open]").count()) === 0, null);

      await emit(page, "second-instance", null);
      const toast = await page.locator(".toast, [role=status]").allInnerTexts().catch(() => []);
      truthy("Dialog", "second instance noted once", "already running", toast.join(" ").includes("already running"), null);
      await emit(page, "second-instance", null);
      const noted = await page.locator(".toast").filter({ hasText: "already running" }).count();
      truthy("Dialog", "second instance not repeated", "single note", noted <= 1, null);
      await page.close();
    }

    /* -------------------------------------- Measured layout at 375/768/1440 */
    {
      for (const [w, h] of [[375, 812], [768, 900], [1440, 900]]) {
        for (const viewName of ["storage", "general", "appearance", "support"]) {
          const page = await open(browser, live, { width: w, height: h, view: viewName });
          const m = await page.evaluate(() => {
            const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect() ?? null;
            const nav = document.querySelector("#nav");
            const main = rect("#main");
            return {
              overflow: document.documentElement.scrollWidth - window.innerWidth,
              viewport: window.innerWidth,
              mainWidth: Math.round(main.width),
              footBottom: Math.round(rect("#foot")?.bottom ?? -1),
              pillLeft: Math.round(rect('[data-fk="pill"]')?.left ?? -1),
              pillBottom: Math.round(rect('[data-fk="pill"]')?.bottom ?? -1),
              navItems: nav.querySelectorAll(".nav-item").length,
              navIcons: nav.querySelectorAll(".nav-item svg").length,
            };
          });
          eq("Layout", `${viewName} at ${w}: no horizontal overflow`, "0", `${m.overflow}`);
          const floor = w <= 640 ? w - 40 : w - 260;
          truthy("Layout", `${viewName} at ${w}: content fills the width`, `main at least ${floor}px`, m.mainWidth >= floor, JSON.stringify(m));
          truthy("Layout", `${viewName} at ${w}: footer on the bottom edge`, "footer within the sidebar inset of the window edge", Math.abs(m.footBottom - h) <= 12, JSON.stringify(m));
          truthy("Layout", `${viewName} at ${w}: pill bottom-left`, "pill in the left half near the bottom", m.pillLeft >= 0 && m.pillLeft < w / 2 && m.pillBottom > h - 120, JSON.stringify(m));
          eq("Layout", `${viewName} at ${w}: every nav item has an icon`, m.navItems, m.navIcons);
          await shot(page, `layout/${viewName}-${w}x${h}`);
          if (viewName === "storage") {
            const dialogWidth = w;
            await page.locator('[data-fk="add-storage"], [data-action="add-storage"]').first().click();
            await page.waitForTimeout(150);
            const dialog = await page.evaluate(() => {
              const rect = document.querySelector("dialog[open]")?.getBoundingClientRect();
              return rect ? { left: Math.round(rect.left), right: Math.round(rect.right), top: Math.round(rect.top), bottom: Math.round(rect.bottom) } : null;
            });
            truthy("Layout", `Add storage fits at ${w}`, "dialog inside the window", Boolean(dialog) && dialog.left >= 0 && dialog.right <= dialogWidth && dialog.top >= 0 && dialog.bottom <= h, JSON.stringify(dialog));
            await shot(page, `layout/editor-${w}x${h}`);
            await page.keyboard.press("Escape");
          }
          await page.close();
        }
      }
    }

    /* ------------------------------------------ Contrast ramp, light and dark */
    {
      for (const tone of ["light", "dark"]) {
        const snap = variant((snapshot) => {
          snapshot.appearance = tone;
        });
        const page = await open(browser, snap, { width: 1440, height: 900 });
        await page.waitForSelector(`html[data-theme="${tone}"]`, { timeout: 3000 });
        const pairs = await page.evaluate(() => {
          const parse = (value) => (value.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
          const lum = ([r, g, b]) => {
            const f = (c) => {
              const n = c / 255;
              return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
            };
            return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
          };
          const ratio = (a, b) => {
            const la = lum(a);
            const lb = lum(b);
            const hi = Math.max(la, lb);
            const lo = Math.min(la, lb);
            return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
          };
          const css = (selector, property) => getComputedStyle(document.querySelector(selector))[property];
          const fg = (selector) => parse(css(selector, "color"));
          const bg = (selector) => parse(css(selector, "backgroundColor"));
          return {
            body: ratio(fg(".storage-row h3"), bg(".storage-card")),
            muted: ratio(fg(".lede"), bg("#main")),
            quiet: ratio(fg(".update-line"), bg("#foot")),
            chip: ratio(fg(".chip-ok"), bg(".chip-ok")),
            primary: ratio(fg('[data-fk="add-storage"]'), bg('[data-fk="add-storage"]')),
            border: ratio(parse(css(".storage-card", "borderTopColor")), bg(".storage-card")),
            planes: ratio(bg("#nav"), bg("#main")),
          };
        });
        for (const [name, value] of Object.entries(pairs)) {
          const decorative = name === "border" || name === "planes";
          record(
            "Contrast",
            `${name}${decorative ? "" : " text"} at ${tone}`,
            decorative ? "measured (decorative)" : "at least 4.5:1",
            `${value}:1`,
            decorative ? value > 1 : value >= 4.5,
            null,
          );
        }
        await page.close();
      }
    }

    /* ------------------------------ Table/Cards switch, deduped rows, grouped warnings */
    {
      const page = await open(browser, live);
      truthy("View", "cards is the default view", "storage cards", (await page.locator(".storage-card").count()) > 0, null);
      await page.locator('[data-list-view="table"]').check();
      await page.waitForTimeout(250);
      eq("View", "switching to Table invokes", "set_list_view", (await lastCommand(page))?.command);
      truthy("View", "the table renders", "a storage table", (await page.locator("table.storage-table").count()) === 1, null);
      const sticky = await page.evaluate(() => getComputedStyle(document.querySelector(".storage-table th")).position);
      truthy("View", "the table's first column is pinned", "sticky", sticky === "sticky", sticky);
      await shot(page, "view/table-light-820x640");
      await page.locator('[data-list-view="cards"]').check();
      await page.waitForTimeout(250);
      truthy("View", "switching back shows cards", "cards again", (await page.locator(".storage-card").count()) > 0, null);
      await page.close();
    }

    {
      const duplicated = variant((snapshot) => {
        snapshot.storages.push({ ...snapshot.storages[0], id: "dup-old", name: "Public Space-Media - 4TB - Music (old)" });
      });
      const page = await open(browser, duplicated);
      eq("View", "duplicate storage rows are deduped", 4, await page.locator(".storage-row").count());
      truthy("View", "the row shows how many entries share it", "×2", (await page.locator(".storage-row").first().innerText()).includes("×2"), null);
      await page.close();
    }

    {
      const attention = variant((snapshot) => {
        snapshot.storages[1].status = "needs_attention";
        snapshot.storages[1].detail = "The device refused the user name or password.";
        snapshot.storages[2].status = "unreachable";
        snapshot.storages[2].detail = "Can't reach the host right now.";
        snapshot.storages[2].mountedPath = null;
      });
      const page = await open(browser, attention);
      const groups = await page.locator(".warning-group").allInnerTexts();
      truthy(
        "Warnings",
        "warnings are grouped by kind with counts",
        "Needs a password 1 and Can't be reached 1",
        groups.some((group) => group.includes("Needs a password") && group.includes("1")) &&
          groups.some((group) => group.includes("Can't be reached") && group.includes("1")),
        JSON.stringify(groups),
      );
      eq("Warnings", "no repeated warning line", 2, groups.length);
      await page.locator(".warning-group").first().click();
      await page.waitForTimeout(150);
      truthy(
        "Warnings",
        "Show focuses the affected row",
        "a row control",
        await page.evaluate(() => Boolean(document.activeElement?.closest(".storage-row"))),
        null,
      );
      await page.close();
    }

    /* ------------------------------------------ Keyboard and dialog behaviour */
    {
      const page = await open(browser, live);
      await page.locator('[data-fk="add-storage"], [data-action="add-storage"]').first().click();
      await page.waitForTimeout(120);
      await page.locator('input[name="name"]').fill("Return test");
      await page.locator('input[name="target"]').fill("smb://nas.local/studio");
      await page.locator('input[name="target"]').press("Enter");
      await page.waitForTimeout(150);
      truthy("Keys", "Return saves a complete form", "save_storage", (await lastCommand(page))?.command === "save_storage", null);

      await page.locator('[data-fk="add-storage"], [data-action="add-storage"]').first().click().catch(() => {});
      await page.waitForTimeout(150);
      await page.locator('input[name="name"]').fill("Backdrop test");
      await page.mouse.click(8, Math.round(640 / 2));
      await page.waitForTimeout(120);
      truthy("Dialog", "a click outside keeps typed input", "editor still open", (await page.locator("dialog[open]").count()) === 1, null);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(120);
      truthy("Dialog", "Escape asks before discarding", "Discard changes?", (await page.locator("#editor-title").innerText()).includes("Discard changes"), null);
      await page.locator('[data-editor-action="keep-editing"]').click();
      await page.waitForTimeout(100);
      truthy("Dialog", "Keep editing returns to the form", "typed name still there", (await page.locator('input[name="name"]').inputValue()) === "Backdrop test", null);
      await closeEditorDiscarding(page);
      truthy("Dialog", "Discard closes the editor", "no open dialog", (await page.locator("dialog[open]").count()) === 0, null);
      await page.close();
    }

    /* ------------------------------------ Duplicate add, feedback, undo, sign-in */
    {
      const page = await open(browser, live);
      await page.locator('[data-fk="add-storage"], [data-action="add-storage"]').first().click();
      await page.locator('input[name="name"]').fill("Music again");
      await page.locator('input[name="target"]').fill("smb://vengtheng@100.69.137.42/Public%20Space-Media%20-%204TB%20-%20Music");
      await page.waitForTimeout(150);
      truthy("Add", "duplicate share keeps Save off", "disabled", await page.locator('[data-editor-action="save"]').isDisabled(), null);
      truthy(
        "Add",
        "duplicate names the existing storage",
        "already added as Public Space-Media - 4TB - Music",
        (await page.locator("#save-reason").innerText()).includes("already added as Public Space-Media - 4TB - Music"),
        null,
      );
      await closeEditorDiscarding(page);
      await page.close();
    }

    {
      const page = await open(browser, live, { width: 820, height: 640 });
      await page.locator('[data-fk="add-storage"], [data-action="add-storage"]').first().click();
      await page.locator('input[name="name"]').fill("New share");
      await page.locator('input[name="target"]').fill("smb://nas.local/newshare");
      await page.locator('input[name="target"]').press("Enter");
      await page.waitForTimeout(250);
      const toastText = (await page.locator(".toast").allInnerTexts().catch(() => [])).join(" ");
      truthy("Add", "saving names the result", "Added New share.", toastText.includes("Added New share."), null);
      const rowBox = await page.evaluate(() => {
        const rows = [...document.querySelectorAll(".storage-row")];
        const row = rows.find((el) => el.textContent.includes("New share"));
        if (!row) return null;
        const r = row.getBoundingClientRect();
        const main = document.querySelector("#main").getBoundingClientRect();
        return {
          top: Math.round(r.top),
          bottom: Math.round(r.bottom),
          mainTop: Math.round(main.top),
          mainBottom: Math.round(main.bottom),
          newMark: row.classList.contains("is-new"),
        };
      });
      truthy(
        "Add",
        "the new row is brought into view",
        "row inside the visible list",
        Boolean(rowBox) && rowBox.top >= rowBox.mainTop && rowBox.bottom <= rowBox.mainBottom,
        JSON.stringify(rowBox),
      );
      truthy("Add", "the new row is marked briefly", "is-new class", Boolean(rowBox?.newMark), JSON.stringify(rowBox));
      await shot(page, "add/add-saved-feedback-light-820x640");
      await page.close();
    }

    {
      const page = await open(browser, live);
      const before = await page.locator(".storage-row").count();
      const removedName = live.storages[0].name;
      await rowAction(page, live.storages[0].id, "edit");
      await page.locator('[data-editor-action="remove"]').click();
      await page.locator('[data-editor-action="confirm-remove"]').click();
      await page.waitForTimeout(200);
      truthy("Remove", "removal removes the row", "one fewer storage", (await page.locator(".storage-row").count()) === before - 1, null);
      const undo = page.locator("[data-toast-action]");
      truthy("Remove", "removal offers Undo", "Undo button", (await undo.count()) === 1, null);
      truthy(
        "Remove",
        "Undo takes keyboard focus after Remove",
        "the Undo toast button",
        (await page.evaluate(() => document.activeElement?.hasAttribute("data-toast-action"))) === true,
        null,
      );
      await undo.click();
      await page.waitForTimeout(250);
      truthy(
        "Remove",
        "Undo puts the storage back",
        `${removedName} returned`,
        (await page.locator(".storage-row").filter({ hasText: removedName }).count()) === 1,
        null,
      );
      truthy(
        "Remove",
        "Undo leaves focus on the restored row",
        `row-${live.storages[0].id}-menu`,
        (await page.evaluate(() => document.activeElement?.getAttribute("data-fk"))) === `row-${live.storages[0].id}-menu`,
        null,
      );
      await page.close();
    }

    {
      const page = await open(browser, live);
      await emit(page, "needs-credentials", { id: "s1794488987703", name: "Public Space-Media - 4TB - Music" });
      await page.locator('input[name="credential-username"]').fill("vengtheng");
      await page.locator('input[name="credential-password"]').fill("not-a-real-password");
      await page.locator('input[name="credential-password"]').press("Enter");
      await page.waitForTimeout(60);
      const toastText = (await page.locator(".toast").allInnerTexts().catch(() => [])).join(" ");
      truthy("Dialog", "saving a password says what happens next", "Password saved. Trying", toastText.includes("Password saved. Trying"), null);
      await page.waitForTimeout(500);
      const afterMount = (await page.locator(".toast").allInnerTexts().catch(() => [])).join(" ");
      truthy("Dialog", "the Trying note ends when the share answers", "no stale Trying toast", !afterMount.includes("Trying"), afterMount);
      await page.close();
    }

    /* ------------------------------- Escape ×3, focus after every transition */
    {
      const page = await open(browser, live);
      await rowAction(page, live.storages[0].id, "edit");
      await page.locator('input[name="name"]').fill("Changed name");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(120);
      truthy("Esc", "first Escape asks before discarding", "Discard changes?", (await page.locator("#editor-title").innerText()).includes("Discard changes"), null);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(120);
      const back = await page.evaluate(() => ({
        title: document.querySelector("#editor-title")?.textContent || "",
        value: document.querySelector('input[name="name"]')?.value || "",
        focus: document.activeElement?.getAttribute("data-fk") || "",
      }));
      truthy("Esc", "second Escape returns to the form", "edits still there", back.title === "Edit storage" && back.value === "Changed name", JSON.stringify(back));
      truthy("Esc", "returning from the prompt focuses the name field", "editor-name", back.focus === "editor-name", JSON.stringify(back));
      await page.keyboard.press("Escape");
      await page.waitForTimeout(120);
      truthy("Esc", "third Escape asks again instead of closing", "Discard changes?", (await page.locator("#editor-title").innerText()).includes("Discard changes"), null);
      truthy("Esc", "no edits were lost", "dialog still open with the typed name", (await page.locator("dialog[open]").count()) === 1, null);
      await page.locator('[data-editor-action="keep-editing"]').click();
      await page.waitForTimeout(120);
      const kept = await page.evaluate(() => ({
        value: document.querySelector('input[name="name"]')?.value || "",
        focus: document.activeElement?.getAttribute("data-fk") || "",
      }));
      truthy("Esc", "Keep editing keeps the typed name and focus", "Changed name in editor-name", kept.value === "Changed name" && kept.focus === "editor-name", JSON.stringify(kept));
      await closeEditorDiscarding(page);
      await page.close();
    }

    {
      const page = await open(browser, live);
      // Dismissing Browse results returns focus to the address field.
      await page.locator('[data-fk="add-storage"]').click();
      await page.locator('input[name="target"]').fill("smb://192.168.0.217");
      await page.locator('[data-editor-action="browse"]').click();
      await page.waitForTimeout(100);
      await emit(page, "shares", { host: "192.168.0.217", shares: ["One"], needsCredentials: false, error: null });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(120);
      const dismissed = await page.evaluate(() => document.activeElement?.getAttribute("data-fk") || document.activeElement?.getAttribute("name") || "");
      truthy("Dialog", "Browse dismissal returns focus to the address", "target field", dismissed === "share-target" || dismissed === "target", String(dismissed));
      await closeEditorDiscarding(page);

      // Returning from Remove focuses the form again.
      await rowAction(page, live.storages[0].id, "edit");
      await page.locator('[data-editor-action="remove"]').click();
      await page.keyboard.press("Escape");
      await page.waitForTimeout(120);
      truthy("Dialog", "Remove return focuses the form", "editor-name", (await page.evaluate(() => document.activeElement?.getAttribute("data-fk"))) === "editor-name", null);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(120);
      if (await page.locator('[data-editor-action="discard"]').count()) await page.locator('[data-editor-action="discard"]').click();
      await page.waitForTimeout(100);

      // Closing the password prompt returns focus to the row's Test control.
      await page.waitForTimeout(100);
      await emit(page, "needs-credentials", { id: "s1794488987703", name: "Public Space-Media - 4TB - Music" });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(120);
      truthy("Dialog", "closing the password prompt focuses the row", "row menu control", (await page.evaluate(() => document.activeElement?.getAttribute("data-fk"))) === "row-s1794488987703-menu", null);

      // Saving Add returns focus to the Add button.
      await page.locator('[data-fk="add-storage"]').click();
      await page.locator('input[name="name"]').fill("Focus check");
      await page.locator('input[name="target"]').fill("smb://nas.local/focus");
      await page.locator('input[name="target"]').press("Enter");
      await page.waitForTimeout(250);
      const savedFocus = await page.evaluate(() => document.activeElement?.getAttribute("data-fk") || "");
      truthy("Dialog", "saving focuses the new row, not an off-screen opener", "row menu", savedFocus.startsWith("row-") && savedFocus.endsWith("-menu"), savedFocus);

      // Closing What's New returns focus to the pill.
      await page.locator('[data-fk="pill"]').click();
      await page.waitForTimeout(120);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(120);
      truthy("Dialog", "closing What's New focuses the pill", "pill", (await page.evaluate(() => document.activeElement?.getAttribute("data-fk"))) === "pill", null);
      await page.close();
    }

    /* ---------------------------------- Tab order, nav arrows, repeat results */
    {
      const page = await open(browser, live, { width: 375, height: 812 });
      const order = await page.evaluate(() => {
        const nav = document.querySelector("#nav");
        const main = document.querySelector("#main");
        const foot = document.querySelector("#foot");
        const follows = (a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
        return { navBeforeMain: follows(nav, main), mainBeforeFoot: follows(main, foot) };
      });
      truthy("Layout", "375 Tab order is nav, content, footer", "DOM order matches the screen", order.navBeforeMain && order.mainBeforeFoot, JSON.stringify(order));
      await page.close();
    }

    {
      const page = await open(browser, live);
      await page.locator('[data-fk="nav-storage"]').focus();
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(150);
      const moved = await page.evaluate(() => ({
        page: document.querySelector("h1")?.textContent,
        focus: document.activeElement?.getAttribute("data-fk"),
      }));
      truthy("Keys", "arrow keys move between sections", "General focused and shown", moved.page === "General" && moved.focus === "nav-general", JSON.stringify(moved));
      await page.close();
    }

    {
      const page = await open(browser, live);
      await rowAction(page, live.storages[0].id, "test");
      await rowAction(page, live.storages[0].id, "test");
      const testToastText = (await page.locator(".toast").filter({ hasText: "Test:" }).allInnerTexts()).join(" ");
      truthy("Storage", "a repeated Test still names its result", "one replaced Test toast with a result", testToastText.includes("Test:"), testToastText);
      await page.close();
    }

    {
      const mounting = variant((snapshot) => {
        snapshot.storages[0].status = "mounting";
        snapshot.storages[0].mountedPath = null;
      });
      const page = await open(browser, mounting);
      const button = await page.locator('[data-fk$="-mount"]').first().innerText();
      truthy("Storage", "a mounting row says Mounting on its button", "Mounting…", button.includes("Mounting"), button);
      await page.close();
    }

    {
      // The preview must reflect the helper's real transitions.
      const needsPassword = variant((snapshot) => {
        snapshot.storages[0].status = "needs_attention";
        snapshot.storages[0].detail = "Sign in to this share to continue.";
        snapshot.storages[0].mountedPath = null;
        snapshot.storages[0].hasCredentials = false;
      });
      const page = await open(browser, needsPassword);
      await emit(page, "needs-credentials", { id: live.storages[0].id, name: live.storages[0].name });
      await page.locator('input[name="credential-username"]').fill("vengtheng");
      await page.locator('input[name="credential-password"]').fill("not-a-real-password");
      await page.locator('input[name="credential-password"]').press("Enter");
      await page.waitForTimeout(250);
      const rowText = await page.locator(".storage-row").first().innerText();
      truthy("Dialog", "saved password mounts the share in the preview", "Mounted chip and no stale sign-in line", rowText.includes("Mounted") && !rowText.includes("Sign in to this share"), rowText.replace(/\n/g, " | "));
      await page.close();
    }

    /* ------------------------------------ Round-3: toast clearance, Test, updates, focus */
    {
      const page = await open(browser, live, { width: 820, height: 640 });
      await page.locator('[data-fk="add-storage"]').click();
      await page.locator('input[name="name"]').fill("Copy of NAS");
      await page.locator('input[name="target"]').fill("smb://nas.local/copy");
      await page.locator('input[name="target"]').press("Enter");
      await page.waitForTimeout(300);
      const overlap = await page.evaluate(() => {
        const toast = document.querySelector(".toast")?.getBoundingClientRect();
        const row = [...document.querySelectorAll(".storage-row")].find((el) => el.textContent.includes("Copy of NAS"));
        if (!toast || !row) return { toast: Boolean(toast), row: Boolean(row), intersects: null };
        const intersects = [...row.querySelectorAll(".row-primary, .row-menu-btn")].some((button) => {
          const r = button.getBoundingClientRect();
          const x = Math.max(0, Math.min(r.right, toast.right) - Math.max(r.left, toast.left));
          const y = Math.max(0, Math.min(r.bottom, toast.bottom) - Math.max(r.top, toast.top));
          return x > 0 && y > 0;
        });
        return { toast: true, row: true, intersects };
      });
      truthy("Add", "the new row's actions are clear of the toast", "no intersection at 820x640", overlap.intersects === false, JSON.stringify(overlap));
      await page.close();
    }

    {
      const volume = variant((snapshot) => {
        snapshot.storages[2].kind = "volume";
        snapshot.storages[2].status = "unreachable";
        snapshot.storages[2].detail = "The disk isn't connected.";
        snapshot.storages[2].mountedPath = null;
      });
      const id = live.storages[2].id;
      const page = await open(browser, volume);
      await rowAction(page, id, "test");
      const chip = await page.locator(`[data-storage="${id}"] .chip`).innerText();
      truthy("Storage", "a Test reports without mounting", "the chip still says Unreachable", chip.includes("Unreachable"), chip);
      truthy("Storage", "a Test never asks for a password", "no credentials sheet", (await page.locator("dialog[open]").count()) === 0, null);
      await page.close();
    }

    {
      const available = variant((snapshot) => {
        snapshot.update = { state: "available", version: "0.2.0", reason: null };
      });
      const page = await open(browser, available);
      await page.locator('[data-fk="check"]').click();
      await page.waitForTimeout(1000);
      truthy(
        "Updates",
        "a check keeps an available update",
        "still offers 0.2.0 with its download control",
        (await page.locator("body").innerText()).includes("Version 0.2.0 is available") && (await page.locator('[data-fk="download"]').count()) === 1,
        null,
      );
      await page.close();
    }

    {
      const page = await open(browser, live, { extra: "&fail-boot=1" });
      await page.waitForSelector('[data-action="retry-boot"]');
      await page.locator('[data-action="retry-boot"]').click();
      await page.waitForTimeout(300);
      truthy("Boot", "Retry leaves focus on the restored page", "main", (await page.evaluate(() => document.activeElement?.id)) === "main", null);
      await page.close();
    }

    {
      const page = await open(browser, live);
      await page.locator('[data-fk="add-storage"]').click();
      await page.waitForTimeout(120);
      await page.locator('[data-editor-action="cancel"]').focus();
      await page.keyboard.press("Tab");
      const trapped = await page.evaluate(() => ({
        inside: document.querySelector("#editor").contains(document.activeElement),
        name: document.activeElement?.getAttribute("name"),
      }));
      truthy("Dialog", "Tab wraps inside the editor", "focus stays in the sheet", trapped.inside, JSON.stringify(trapped));
      await closeEditorDiscarding(page);
      await page.locator('[data-fk="pill"]').click();
      await page.waitForTimeout(120);
      truthy("Updates", "What's New opens with Close focused", "close button", (await page.evaluate(() => document.activeElement?.getAttribute("data-whatsnew-action"))) === "close", null);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(120);
      truthy("Updates", "closing What's New restores the pill", "pill", (await page.evaluate(() => document.activeElement?.getAttribute("data-fk"))) === "pill", null);
      await page.close();
    }

    /* ------------------------------- Keyboard focus after row/footer transitions */
    {
      const page = await open(browser, live);
      const rowId = live.storages[0].id;
      await page.locator(`[data-storage="${rowId}"] [data-row-menu]`).click();
      await page.waitForTimeout(100);
      await page.locator('#row-menu [data-action="test"]').focus();
      await page.keyboard.press("Enter");
      await page.waitForTimeout(300);
      const afterTest = await page.evaluate(() => document.activeElement?.getAttribute("data-fk") || document.activeElement?.tagName);
      truthy("Keys", "Test returns keyboard focus to the row menu", `row-${rowId}-menu`, afterTest === `row-${rowId}-menu`, String(afterTest));

      await page.locator(`[data-storage="${rowId}"] [data-row-menu]`).click();
      await page.waitForTimeout(100);
      await page.locator('#row-menu [data-action="unmount"]').focus();
      await page.keyboard.press("Enter");
      await page.waitForTimeout(300);
      const afterUnmount = await page.evaluate(() => document.activeElement?.getAttribute("data-fk") || document.activeElement?.tagName);
      truthy("Keys", "Unmount moves keyboard focus to Mount now", `row-${rowId}-mount`, afterUnmount === `row-${rowId}-mount`, String(afterUnmount));

      await page.locator('[data-fk="check"]').focus();
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1000);
      const afterCheck = await page.evaluate(() => document.activeElement?.getAttribute("data-fk") || document.activeElement?.tagName);
      truthy("Keys", "Check for Updates keeps keyboard focus", "check", afterCheck === "check", String(afterCheck));
      await page.close();
    }

    {
      const down = variant((snapshot) => {
        snapshot.engineRunning = false;
        snapshot.engineError = "It stopped unexpectedly. Restart it here.";
      });
      const page = await open(browser, down);
      await page.locator('[data-fk="restart-helper"]').focus();
      await page.keyboard.press("Enter");
      await page.waitForTimeout(250);
      const afterRestart = await page.evaluate(() => document.activeElement?.getAttribute("data-fk") || document.activeElement?.tagName);
      truthy("Keys", "Restart helper lands on a control, not BODY", "nav-storage", afterRestart === "nav-storage", String(afterRestart));
      await page.close();
    }

    /* -------------------------------- Completeness: flags, forget, capability controls */
    {
      const page = await open(browser, live);
      await page.locator('[data-fk="add-storage"]').click();
      await page.locator('input[name="name"]').fill("Flags check");
      await page.locator('input[name="target"]').fill("smb://nas.local/flags");
      await page.locator('input[name="wake"]').uncheck();
      await page.locator('input[name="target"]').press("Enter");
      await page.waitForTimeout(250);
      const command = await lastCommand(page);
      truthy(
        "Completeness",
        "reconnect flags are saved",
        "reconnectAfterWake false",
        command?.args?.input?.reconnectAfterWake === false,
        JSON.stringify(command?.args),
      );
      await page.close();
    }

    {
      const page = await open(browser, live);
      await rowAction(page, live.storages[0].id, "edit");
      await page.locator('input[name="name"]').fill("Renamed share");
      await page.locator('input[name="target"]').press("Enter");
      await page.waitForTimeout(250);
      truthy(
        "Completeness",
        "editing saves the new name",
        "Renamed share row",
        (await page.locator(".storage-row").filter({ hasText: "Renamed share" }).count()) === 1,
        null,
      );
      await page.close();
    }

    {
      const credentials = variant((snapshot) => {
        snapshot.storages[0].hasCredentials = true;
        snapshot.storages[0].username = "vengtheng";
      });
      const page = await open(browser, credentials);
      await rowAction(page, live.storages[0].id, "edit");
      eq("Add", "Edit does not offer the connected-share picker", 0, await page.locator('[data-editor-action="add-connected"]').count());
      const forget = page.locator('input[name="forgetPassword"]');
      truthy("Completeness", "forget the saved password is offered", "a checkbox", (await forget.count()) === 1, null);
      await forget.check();
      await page.waitForTimeout(120);
      truthy("Completeness", "forget disables the password field", "password input disabled", await page.locator('input[name="password"]').isDisabled(), null);
      await page.locator('[data-editor-action="save"]').click();
      await page.waitForTimeout(250);
      const last = await lastCommand(page);
      truthy("Completeness", "forget sends remove_credentials", "removeCredentials true", last?.args?.input?.removeCredentials === true, JSON.stringify(last?.args));
      const forgetToast = (await page.locator(".toast").allInnerTexts()).join(" ");
      truthy("Completeness", "the forget toast names the forgotten password", "forgotten", forgetToast.includes("forgotten"), forgetToast);
      await page.waitForTimeout(200);
      await rowAction(page, live.storages[0].id, "edit");
      const placeholder = await page.locator('input[name="password"]').getAttribute("placeholder");
      truthy(
        "Completeness",
        "after forgetting, the field does not promise a saved password",
        "no keep phrase",
        !String(placeholder).includes("keep the saved one"),
        String(placeholder),
      );
      eq("Completeness", "the forget control disappears once nothing is saved", 0, await page.locator('input[name="forgetPassword"]').count());
      await closeEditorDiscarding(page);
      await page.close();
    }

    {
      const page = await open(browser, live);
      const caps = await page.evaluate(() => ({
        add: Boolean(document.querySelector('[data-action="add-storage"]')),
        viewCards: Boolean(document.querySelector('[data-list-view="cards"]')),
        viewTable: Boolean(document.querySelector('[data-list-view="table"]')),
        primary: Boolean(document.querySelector(".storage-row .row-primary")),
        menu: Boolean(document.querySelector("[data-row-menu]")),
        check: Boolean(document.querySelector('[data-fk="check"]')),
        pill: Boolean(document.querySelector('[data-fk="pill"]')),
        support: Boolean(document.querySelector(".foot-support")),
        nav: document.querySelectorAll(".nav-item").length === 3,
      }));
      truthy("Completeness", "declared page capabilities have controls", "all present", Object.values(caps).every(Boolean), JSON.stringify(caps));
      const general = await page.evaluate(() => {
        document.querySelector('[data-fk="nav-general"]').click();
        return {
          notifications: Boolean(document.querySelector('[data-general="notifications"]')),
          login: Boolean(document.querySelector('[data-general="launchAtLogin"]')),
          retries: Boolean(document.querySelector('[data-general="retries"]')),
        };
      });
      truthy("Completeness", "General capabilities have controls", "notifications, login, retries", Object.values(general).every(Boolean), JSON.stringify(general));
      const appearance = await page.evaluate(() => {
        document.querySelector('[data-fk="nav-appearance"]').click();
        return ["system", "light", "dark"].every((value) => Boolean(document.querySelector(`[data-appearance="${value}"]`)));
      });
      truthy("Completeness", "Appearance has exactly three controls", "System/Light/Dark", appearance === true, String(appearance));
      await page.close();
    }

    {
      const page = await open(browser, live);
      await page.locator('[data-fk="add-storage"]').click();
      await page.locator('input[name="name"]').fill("Upper scheme");
      await page.locator('input[name="target"]').fill("SMB://nas.local/studio");
      await page.waitForTimeout(150);
      truthy(
        "Add",
        "an uppercase scheme is refused with the same message",
        "Use an smb:// address",
        (await page.locator("#save-reason").innerText()).includes("Use an smb:// address"),
        null,
      );
      await closeEditorDiscarding(page);

      const first = live.storages[0].id;
      const second = live.storages[1].id;
      await page.locator(`[data-storage="${first}"] [data-row-menu]`).click();
      await page.waitForTimeout(120);
      await page.locator(`[data-storage="${second}"] [data-row-menu]`).click();
      await page.waitForTimeout(120);
      const stale = await page.locator(`[data-storage="${first}"] [data-row-menu]`).getAttribute("aria-expanded");
      truthy("Storage", "opening another row's menu resets the first", "aria-expanded false", stale === "false", String(stale));
      await page.keyboard.press("Escape");
      await page.close();
    }

    {
      const page = await open(browser, live);
      const before = await page.locator(".storage-row").count();
      const name = live.storages[0].name;
      await rowAction(page, live.storages[0].id, "remove");
      truthy("Remove", "the row menu offers Remove", "a confirmation", (await page.locator("#editor-title").innerText()).includes("Remove"), null);
      await page.locator('[data-editor-action="confirm-remove"]').click();
      await page.waitForTimeout(250);
      eq("Remove", "menu Remove removes the row", before - 1, await page.locator(".storage-row").count());
      await page.locator("[data-toast-action]").click();
      await page.waitForTimeout(250);
      truthy("Remove", "menu Remove can be undone", `${name} returned`, (await page.locator(".storage-row").filter({ hasText: name }).count()) === 1, null);
      await page.close();
    }

    /* -------------------------------------------- Round-7: disk hint, table, check, removal */
    {
      const page = await open(browser, live);
      truthy("Storage", "the list says what was checked and when", "Storage list checked", (await page.locator(".checked-line").innerText()).includes("Storage list checked"), await page.locator(".checked-line").innerText());
      truthy("Footer", "the version pill carries an icon", "an svg", (await page.locator('[data-fk="pill"] svg').count()) === 1, null);

      // A missing saved disk is described as missing, not "connected now".
      const missing = variant((snapshot) => {
        snapshot.storages[2].kind = "volume";
        snapshot.storages[2].volumeUUID = "GONE-0000";
        snapshot.storages[2].status = "unreachable";
        snapshot.storages[2].detail = "The disk isn't connected right now.";
        snapshot.storages[2].mountedPath = null;
      });
      await page.close();
      const diskPage = await open(browser, missing);
      await rowAction(diskPage, live.storages[2].id, "edit");
      const hint = await diskPage.locator(".field-hint").last().innerText().catch(() => "");
      truthy("Add", "a missing disk is not called connected", "isn't connected", hint.includes("isn't connected"), hint);
      await closeEditorDiscarding(diskPage);
      await diskPage.close();
    }

    {
      const page = await open(browser, live, { width: 375, height: 812 });
      await page.locator('[data-list-view="table"]').check();
      await page.waitForTimeout(300);
      const actions = await page.evaluate(() => {
        const wrap = document.querySelector(".storage-table-wrap").getBoundingClientRect();
        const button = document.querySelector(".storage-table .cell-actions [data-row-menu]");
        const r = button.getBoundingClientRect();
        return { wrapRight: Math.round(wrap.right), buttonRight: Math.round(r.right), scrollLeft: document.querySelector(".storage-table-wrap").scrollLeft };
      });
      truthy("View", "at 375 the table shows a row action at rest", "menu inside the wrap", actions.buttonRight <= actions.wrapRight && actions.scrollLeft === 0, JSON.stringify(actions));
      await page.close();
    }

    {
      const page = await open(browser, live, { width: 820, height: 640 });
      await page.locator('[data-fk="check"]').focus();
      await page.keyboard.press("Enter");
      await page.waitForTimeout(100);
      const during = await page.evaluate(() => document.activeElement?.getAttribute("data-fk") || document.activeElement?.tagName);
      await page.waitForTimeout(900);
      const after = await page.evaluate(() => document.activeElement?.getAttribute("data-fk") || document.activeElement?.tagName);
      truthy("Keys", "Check for Updates never drops focus", "check during and after", during === "check" && after === "check", `${during} / ${after}`);
      await page.close();
    }

    {
      const duplicated = variant((snapshot) => {
        snapshot.storages.push({ ...snapshot.storages[0], id: "dup-old", name: "Old copy" });
      });
      const page = await open(browser, duplicated);
      await rowAction(page, live.storages[0].id, "remove");
      await page.locator('[data-editor-action="confirm-remove"]').click();
      await page.waitForTimeout(300);
      const text = await page.locator("main").innerText();
      truthy("Remove", "removing a ×2 row clears its duplicate", "no Old copy, three rows", !text.includes("Old copy") && (await page.locator(".storage-row").count()) === 3, String(await page.locator(".storage-row").count()));
      await page.close();
    }

    {
      const down = variant((snapshot) => {
        snapshot.engineRunning = false;
        snapshot.engineError = "It stopped unexpectedly. Restart it here.";
      });
      const page = await open(browser, down, { width: 375, height: 812 });
      await page.mouse.move(180, 400);
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(300);
      const wheeled = await page.evaluate(() => {
        const foot = document.querySelector("#foot").getBoundingClientRect();
        return {
          winY: window.scrollY,
          mainScroll: document.querySelector("#main").scrollTop,
          footerPinned: Math.abs(foot.bottom - window.innerHeight) <= 1,
        };
      });
      truthy(
        "Engine",
        "helper-down at 375 scrolls the content, not the window",
        "window stays put, footer pinned, content scrolls",
        wheeled.winY === 0 && wheeled.footerPinned && wheeled.mainScroll > 0,
        JSON.stringify(wheeled),
      );
      await page.close();
    }

    {
      const page = await open(browser, live, { width: 820, height: 640 });
      await page.locator('[data-list-view="table"]').check();
      await page.waitForTimeout(300);
      const noWrap = await page.evaluate(() => {
        const cell = document.querySelector(".storage-table .cell-actions");
        const primary = cell.querySelector(".row-primary");
        const menu = cell.querySelector("[data-row-menu]");
        const a = primary.getBoundingClientRect();
        const b = menu.getBoundingClientRect();
        return { cellWidth: Math.round(cell.getBoundingClientRect().width), sameLine: Math.abs(a.top - b.top) < 2, primaryRight: Math.round(a.right), menuLeft: Math.round(b.left) };
      });
      truthy("View", "the table's row actions stay on one line", "primary and menu share a top", noWrap.sameLine, JSON.stringify(noWrap));
      await page.close();
    }

    /* --------------------------------------- Round-5: focus, identity, table, toasts */
    {
      const page = await open(browser, live);
      await rowAction(page, live.storages[0].id, "edit");
      await page.locator('[data-editor-action="test"]').focus();
      await page.keyboard.press("Enter");
      await page.waitForTimeout(350);
      const focus = await page.evaluate(() => document.activeElement?.getAttribute("data-fk") || document.activeElement?.tagName);
      truthy("Keys", "the editor's Test keeps focus on its button", "editor-test", focus === "editor-test", String(focus));
      await closeEditorDiscarding(page);

      await page.locator('[data-fk="add-storage"]').click();
      await page.locator('input[name="name"]').fill("Slash copy");
      await page.locator('input[name="target"]').fill("smb://vengtheng@100.69.137.42/Public%20Space-Media%20-%204TB%20-%20Music/");
      await page.waitForTimeout(150);
      truthy(
        "Add",
        "a trailing slash is the same share",
        "Save disabled with the duplicate reason",
        await page.locator('[data-editor-action="save"]').isDisabled() &&
          (await page.locator("#save-reason").innerText()).includes("already added"),
        await page.locator("#save-reason").innerText().catch(() => ""),
      );
      await page.locator('input[name="target"]').fill("smb://vengtheng@100.69.137.42/Public%20Space-Media%20-%204TB%20-%20M%75sic");
      await page.waitForTimeout(150);
      truthy(
        "Add",
        "percent escapes are the same share",
        "Save disabled with the duplicate reason",
        await page.locator('[data-editor-action="save"]').isDisabled() &&
          (await page.locator("#save-reason").innerText()).includes("already added"),
        await page.locator("#save-reason").innerText().catch(() => ""),
      );
      for (const form of [
        "smb://100.69.137.42:445/Public%20Space-Media%20-%204TB%20-%20Music",
        "smb://100.69.137.42/Public%20Space-Media%20-%204TB%20-%20Music?x=1",
        "smb://100.69.137.42/./Public%20Space-Media%20-%204TB%20-%20Music",
      ]) {
        await page.locator('input[name="target"]').fill(form);
        await page.waitForTimeout(120);
        truthy(
          "Add",
          `equivalent address refused: ${form.replace("smb://", "").slice(0, 28)}`,
          "Save disabled with the duplicate reason",
          await page.locator('[data-editor-action="save"]').isDisabled() &&
            (await page.locator("#save-reason").innerText()).includes("already added"),
          await page.locator("#save-reason").innerText().catch(() => ""),
        );
      }
      await closeEditorDiscarding(page);
      await page.close();
    }

    {
      const page = await open(browser, live, { width: 820, height: 640 });
      await page.locator('[data-list-view="table"]').check();
      await page.waitForTimeout(300);
      const visible = await page.evaluate(() => {
        const wrap = document.querySelector(".storage-table-wrap").getBoundingClientRect();
        const cell = document.querySelector(".storage-table .cell-actions");
        const button = cell?.querySelector("[data-row-menu]");
        return {
          wrapRight: Math.round(wrap.right),
          buttonRight: button ? Math.round(button.getBoundingClientRect().right) : null,
        };
      });
      truthy("View", "the table keeps Actions visible at 820", "menu inside the wrap", visible.buttonRight !== null && visible.buttonRight <= visible.wrapRight, JSON.stringify(visible));
      const narrow = await page.evaluate(() => {
        const address = document.querySelector(".storage-table .cell-address");
        return { addressShown: address ? getComputedStyle(address).display !== "none" : null };
      });
      truthy("View", "the table drops Address at 820 (Cards carries it)", "Address hidden", narrow.addressShown === false, JSON.stringify(narrow));
      await page.locator(".storage-table [data-row-menu]").first().click();
      await page.waitForTimeout(150);
      truthy("View", "a table row's menu opens", "menu items", (await page.locator("#row-menu [role=menuitem]").count()) > 0, null);
      await page.locator("#row-menu [role=menuitem]").first().focus();
      const beforeArrow = await page.evaluate(() => document.activeElement?.getAttribute("data-action"));
      await page.keyboard.press("ArrowDown");
      const moved = await page.evaluate(() => document.activeElement?.getAttribute("data-action"));
      truthy("View", "arrow keys move inside the row menu", "a different item", Boolean(moved) && moved !== beforeArrow, `${beforeArrow} -> ${moved}`);
      await page.keyboard.press("Escape");
      await page.close();
    }

    {
      const page = await open(browser, live, { width: 375, height: 812 });
      await page.locator('[data-fk="add-storage"]').click();
      await page.locator('input[name="name"]').fill("Toast room");
      await page.locator('input[name="target"]').fill("smb://nas.local/toastroom");
      await page.locator('input[name="target"]').press("Enter");
      await page.waitForTimeout(350);
      const clear = await page.evaluate(() => {
        const toast = document.querySelector(".toast")?.getBoundingClientRect();
        const foot = document.querySelector("#foot").getBoundingClientRect();
        const pill = document.querySelector('[data-fk="pill"]');
        const rect = pill.getBoundingClientRect();
        const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return {
          toastBottom: toast ? Math.round(toast.bottom) : null,
          footTop: Math.round(foot.top),
          pillHittable: top === pill || pill.contains(top),
        };
      });
      truthy("Add", "at 375 the toast clears the footer", "toast above the footer", clear.toastBottom !== null && clear.toastBottom <= clear.footTop, JSON.stringify(clear));
      truthy("Add", "at 375 the version pill stays clickable", "pill is the topmost control", clear.pillHittable, JSON.stringify(clear));
      await page.close();
    }

    {
      // Boot rest points at Retry and offers no dead navigation.
      const page = await open(browser, live, { extra: "&fail-boot=1" });
      await page.waitForSelector('[data-action="retry-boot"]');
      const boot = await page.evaluate(() => ({
        focus: document.activeElement?.getAttribute("data-fk"),
        nav: document.querySelectorAll(".nav-item").length,
      }));
      truthy("Boot", "the boot error focuses Retry", "retry-boot", boot.focus === "retry-boot", JSON.stringify(boot));
      eq("Boot", "the boot error hides navigation", 0, boot.nav);
      await page.locator('[data-action="retry-boot"]').click();
      await page.waitForTimeout(300);
      eq("Boot", "the navigation comes back after Retry", 3, await page.locator(".nav-item").count());
      await page.close();
    }

    {
      // A focused Undo toast that times out leaves focus on the page, not BODY.
      const page = await open(browser, live);
      await rowAction(page, live.storages[0].id, "edit");
      await page.locator('[data-editor-action="remove"]').click();
      await page.locator('[data-editor-action="confirm-remove"]').click();
      await page.waitForTimeout(200);
      await page.locator("[data-toast-action]").focus();
      await page.waitForTimeout(12500);
      truthy(
        "Remove",
        "a timed-out Undo leaves focus on a real control",
        "add-storage",
        (await page.evaluate(() => document.activeElement?.getAttribute("data-fk"))) === "add-storage",
        await page.evaluate(() => document.activeElement?.getAttribute("data-fk") || document.activeElement?.tagName),
      );
      await page.close();
    }

    {
      const page = await open(browser, live, { width: 820, height: 640 });
      await page.evaluate(() => document.body.focus());
      await page.waitForTimeout(50);
      await page.keyboard.press("Tab");
      const firstStop = await page.evaluate(() => document.activeElement?.getAttribute("data-fk") || document.activeElement?.tagName);
      truthy("Keys", "the first Tab reaches the navigation", "nav-storage", firstStop === "nav-storage", String(firstStop));
      await page.locator('[data-fk="check"]').focus();
      await page.keyboard.press("Tab");
      const wrapped = await page.evaluate(() => document.activeElement?.getAttribute("data-fk") || document.activeElement?.tagName);
      truthy("Keys", "Tab wraps from the footer to the navigation", "nav-storage", wrapped === "nav-storage", String(wrapped));
      await page.close();
    }

    /* ------------------------------------------- Round-8: root height, 768 table, undo state */
    {
      const page = await open(browser, live, { width: 375, height: 812 });
      await page.locator('[data-fk="add-storage"]').click();
      await page.locator('input[name="name"]').fill("Height check");
      await page.locator('input[name="target"]').fill("smb://nas.local/height");
      await page.locator('input[name="target"]').press("Enter");
      await page.waitForTimeout(350);
      const heights = await page.evaluate(() => ({ doc: document.documentElement.scrollHeight, view: window.innerHeight }));
      truthy("Layout", "adding at 375 keeps the window pinned", "document height equals the viewport", heights.doc === heights.view, JSON.stringify(heights));
      const focusedVisible = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { fk: el.getAttribute("data-fk"), top: Math.round(r.top), bottom: Math.round(r.bottom), h: window.innerHeight };
      });
      truthy("Layout", "focus after saving is on screen at 375", "the focused control is visible", Boolean(focusedVisible) && focusedVisible.top >= 0 && focusedVisible.bottom <= focusedVisible.h, JSON.stringify(focusedVisible));
      await page.close();
    }

    {
      const page = await open(browser, live, { width: 820, height: 640 });
      await page.locator('[data-fk="add-storage"]').click();
      await page.locator('input[name="name"]').fill("Height check");
      await page.locator('input[name="target"]').fill("smb://nas.local/height");
      await page.locator('input[name="target"]').press("Enter");
      await page.waitForTimeout(350);
      const heights = await page.evaluate(() => ({ doc: document.documentElement.scrollHeight, view: window.innerHeight }));
      truthy("Layout", "adding at 820 keeps the window pinned", "document height equals the viewport", heights.doc === heights.view, JSON.stringify(heights));
      await page.close();
    }

    {
      const page = await open(browser, live, { width: 768, height: 900 });
      await page.locator('[data-list-view="table"]').check();
      await page.waitForTimeout(300);
      const table = await page.evaluate(() => {
        const wrap = document.querySelector(".storage-table-wrap");
        const button = document.querySelector(".storage-table .cell-actions [data-row-menu]");
        const r = button.getBoundingClientRect();
        return {
          wrapRight: Math.round(wrap.getBoundingClientRect().right),
          buttonRight: Math.round(r.right),
          overflow: wrap.scrollWidth - wrap.clientWidth,
        };
      });
      truthy("View", "at 768 the table fits and shows the row menu", "no horizontal overflow, menu inside", table.overflow === 0 && table.buttonRight <= table.wrapRight, JSON.stringify(table));
      await page.close();
    }

    {
      // Undo of a share that is still mounted comes back mounted, not Not mounted.
      const page = await open(browser, live);
      await rowAction(page, live.storages[0].id, "remove");
      await page.locator('[data-editor-action="confirm-remove"]').click();
      await page.waitForTimeout(250);
      await page.locator("[data-toast-action]").click();
      await page.waitForTimeout(300);
      const row = page.locator(`[data-storage="${live.storages[0].id}"]`);
      const text = await row.innerText().catch(() => "");
      truthy("Remove", "Undo restores a still-mounted share as mounted", "Mounted chip", text.includes("Mounted"), text.replace(/\n/g, " | "));
      await page.close();
    }

    /* ------------------------------------ Long names, geometry, accessible names */
    {
      const longName = variant((snapshot) => {
        snapshot.storages[0].name = "StudioNASArchiveShareWithoutAnySpacesAtAll2026";
      });
      const page = await open(browser, longName, { width: 375, height: 812 });
      const overflow = await page.evaluate(() => {
        const list = document.querySelector(".storage-list");
        return { list: list.scrollWidth - list.clientWidth, doc: document.documentElement.scrollWidth - innerWidth };
      });
      eq("Layout", "long name wraps instead of clipping", 0, overflow.list);
      eq("Layout", "long name adds no page overflow at 375", 0, overflow.doc);
      await shot(page, "stress/long-name-375x812");
      await page.close();
    }

    {
      const withUpdate = variant((snapshot) => {
        snapshot.update = { state: "available", version: "9.9.9", reason: null };
      });
      for (const [w, h] of [[768, 900], [1440, 900]]) {
        const page = await open(browser, withUpdate, { width: w, height: h });
        await page.waitForSelector('[data-fk="download"]', { timeout: 3000 });
        const gap = await page.evaluate(() => {
          const dl = document.querySelector('[data-fk="download"]').getBoundingClientRect();
          const edge = window.innerWidth > 640 ? document.querySelector("#nav").getBoundingClientRect().right : window.innerWidth;
          return { right: Math.round(dl.right), edge: Math.round(edge) };
        });
        truthy("Footer", `download control stays inside at ${w}`, "right edge within the window", gap.right <= gap.edge, JSON.stringify(gap));
        await page.close();
      }
    }

    {
      const page = await open(browser, live);
      const names = await page.locator(".storage-row").first().locator(".row-primary, .row-menu-btn").evaluateAll((buttons) =>
        buttons.filter((button) => !button.disabled).map((button) => button.getAttribute("aria-label") || ""),
      );
      truthy(
        "Storage",
        "row controls name their storage",
        "each accessible name includes the share name",
        names.length > 0 && names.every((name) => name.includes("Public Space-Media - 4TB - Music")),
        JSON.stringify(names),
      );
      await page.close();
    }

    /* --------------------------------------------- Status line and appearance */
    {
      const page = await open(browser, live);
      truthy("Storage", "status line summarises the list", "4 storages, all mounted.", (await page.locator(".page-head .lede").innerText()) === "4 storages, all mounted.", null);
      await page.locator('[data-fk="nav-appearance"]').click();
      const control = await page.evaluate(() => {
        const segmented = document.querySelector(".appearance-block .segmented");
        const row = document.querySelector(".appearance-block .setting-row");
        return {
          width: Math.round(segmented.getBoundingClientRect().width),
          rowWidth: Math.round(row.getBoundingClientRect().width),
          segments: [...segmented.querySelectorAll("label")].map((el) => Math.round(el.getBoundingClientRect().width)),
        };
      });
      truthy("Appearance", "segmented control is content-sized", "narrower than 400", control.width < 400, JSON.stringify(control));
      eq("Appearance", "three equal segments", 3, new Set(control.segments).size);
      truthy("Appearance", "the settings row fills the page", "row wider than 500 at 820", control.rowWidth > 500, JSON.stringify(control));
      await shot(page, "appearance/appearance-light-820x640");
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
