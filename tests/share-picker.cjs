#!/usr/bin/env node
/*
 * The share address is chosen from what the device offers, not typed.
 *
 *   node tests/share-picker.cjs
 *
 * Headless Chromium against the dev fixture (its `list_shares` answers per host): a list
 * renders and choosing one fills the address in the same normalised shape a typed value has;
 * a device that cannot be listed says why and still allows a typed address; an empty answer
 * never reads as "no shares". No window, no desktop, no share is contacted.
 *
 * Exit: 0 pass · 1 fail · 2 not run (Playwright is not installed here).
 */
const { spawn } = require("node:child_process");
const path = require("node:path");

const REPO = path.resolve(__dirname, "..");
const PLAYWRIGHT = process.env.SS_PLAYWRIGHT
  || require("node:path").join(require("node:os").homedir(), "Developer/My Own Apps/music-studio-kh/node_modules/playwright");
const BASE = "http://localhost:1420/";

// This repo's own playwright-core (no browser download) drives the installed Google Chrome;
// another repo's full Playwright still works where it is installed.
let chromium;
try {
  ({ chromium } = require("playwright-core"));
} catch {
  try {
    ({ chromium } = require(PLAYWRIGHT));
  } catch {
    console.log("NOT RUN  share-picker: neither playwright-core nor Playwright is installed here");
    process.exit(2);
  }
}

const results = [];
function check(name, expected, actual) {
  const pass = expected === actual;
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass) console.log(`      expected: ${expected}\n      actual:   ${actual}`);
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

/** A fresh page per case, so no dialog state carries over. */
async function freshEditor(browser) {
  const page = await browser.newPage({ viewport: { width: 820, height: 640 } });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-action="add-storage"]');
  await page.click('[data-action="add-storage"]');
  await page.waitForSelector("#share-target");
  return page;
}

async function main() {
  const server = spawn(path.join(REPO, "node_modules", ".bin", "vite"), ["--config", "ui/vite.config.ts"], {
    cwd: REPO,
    stdio: "ignore",
  });
  let browser;
  try {
    if (!(await waitForServer(BASE, 30000))) {
      console.log("FAIL  the dev server did not start on " + BASE);
      return 1;
    }
    // Channel "chrome" uses the Google Chrome already on this Mac, so no browser is downloaded.
    browser = await chromium.launch({ headless: true, channel: "chrome" }).catch(() =>
      chromium.launch({ headless: true }),
    );

    // 1. The list renders; choosing one fills the address.
    {
      const page = await freshEditor(browser);
      await page.fill("#share-target", "smb://nas.local");
      await page.waitForSelector('[data-editor-action="pick-share"]', { timeout: 8000 });
      const shares = await page.$$eval('[data-editor-action="pick-share"]', (nodes) =>
        nodes.map((node) => node.getAttribute("data-share")),
      );
      check("the device's shares are listed", 3, shares.length);
      check("the share field is read-only while the list shows", true, await page.$eval("#share-target", (el) => el.readOnly));
      await page.click('[data-editor-action="pick-share"][data-share="Studio Projects"]');
      check(
        "choosing a share fills the address and the person sees the readable name",
        "smb://nas.local/Studio Projects",
        await page.$eval("#share-target", (el) => el.value),
      );
      check(
        "choosing a share also names the storage when the name is empty",
        "Studio Projects",
        await page.$eval('[name="name"]', (el) => el.value),
      );
      const saveBlocked = await page.$eval('[data-editor-action="save"]', (el) => el.disabled);
      check("Save is no longer blocked once a share is chosen", false, saveBlocked);
      await page.close();
    }

    // 2. A device that cannot be listed says why, and typing still works.
    {
      const page = await freshEditor(browser);
      await page.fill("#share-target", "smb://unreachable.local");
      await page.waitForFunction(
        () => (document.querySelector(".field-note-error")?.textContent ?? "").includes("didn't answer"),
        null,
        { timeout: 8000 },
      );
      check("an unlistable device says so", true, true);
      check("the field stays editable when the list fails", false, await page.$eval("#share-target", (el) => el.readOnly));
      await page.fill('[name="name"]', "Archive");
      await page.fill("#share-target", "smb://unreachable.local/archive");
      check(
        "a typed address still reaches Save",
        false,
        await page.$eval('[data-editor-action="save"]', (el) => el.disabled),
      );
      await page.close();
    }

    // 3. An empty answer never reads as "this device has no shares".
    {
      const page = await freshEditor(browser);
      await page.fill("#share-target", "smb://empty-list.local");
      await page.waitForFunction(
        () => (document.querySelector(".field-note-warn")?.textContent ?? "").includes("doesn't mean it has none"),
        null,
        { timeout: 8000 },
      );
      check("an empty list is not called \"no shares\"", true, true);
      check("the field stays editable when nothing is listed", false, await page.$eval("#share-target", (el) => el.readOnly));
      await page.close();
    }

    // 4. A device that wants a sign-in names it and keeps typing open.
    {
      const page = await freshEditor(browser);
      await page.fill("#share-target", "smb://needs-login.local");
      await page.waitForFunction(
        () => (document.querySelector(".field-note-warn")?.textContent ?? "").includes("needs a user name and password"),
        null,
        { timeout: 8000 },
      );
      check("a device that wants a sign-in says so", true, true);
      check("the field stays editable while a sign-in is needed", false, await page.$eval("#share-target", (el) => el.readOnly));
      await page.close();
    }
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
  const failed = results.filter((pass) => !pass).length;
  console.log(failed ? `\n${failed} check(s) failed` : "\nAll share-picker checks passed");
  return failed ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.log("FAIL  " + (error && error.message ? error.message : error));
    process.exit(1);
  });
