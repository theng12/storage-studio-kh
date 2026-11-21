#!/usr/bin/env node
/*
 * The Archives page and the add-storage form, measured at the default window size (820×640).
 *
 *   node tests/measure-0.1.21.cjs
 *
 * Every check reads a size, a position or the rendered text from the page — nothing is eyeballed.
 * Both states are measured: with one archive present and with the empty state. No window is shown;
 * headless Chromium drives the dev fixture, which never contacts a share.
 *
 * Exit: 0 pass · 1 fail · 2 not run (Playwright is not installed here).
 */
const { spawn } = require("node:child_process");
const path = require("node:path");

const REPO = path.resolve(__dirname, "..");
const BASE = "http://localhost:1420/";

let chromium;
try {
  ({ chromium } = require("playwright-core"));
} catch {
  console.log("NOT RUN  measure-0.1.21: playwright-core is not installed here");
  process.exit(2);
}

const results = [];
function check(name, expected, actual) {
  const pass = JSON.stringify(expected) === JSON.stringify(actual);
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass) console.log(`      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`);
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

async function pageAt(browser, hash = "") {
  const page = await browser.newPage({ viewport: { width: 820, height: 640 } });
  await page.goto(BASE + hash, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-view="archives"]');
  return page;
}

/** Wrapped-text lines: per-line boxes of the first text node in the element. */
async function lines(page, selector) {
  return page.$eval(selector, (el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const node = walker.nextNode();
    if (!node) return { count: 0, widths: [] };
    const range = document.createRange();
    range.selectNodeContents(node);
    const widths = Array.from(range.getClientRects()).map((rect) => Math.round(rect.width));
    return { count: widths.length, widths };
  });
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
    browser = await chromium.launch({ headless: true, channel: "chrome" }).catch(() =>
      chromium.launch({ headless: true }),
    );

    // ---- With one archive present ----
    {
      const page = await pageAt(browser, "#update=idle");
      await page.click('[data-view="archives"]');
      await page.waitForSelector(".archive-group");

      const glyphs = await page.evaluate(() => ({
        storage: document.querySelector('[data-view="storage"] svg')?.innerHTML ?? "",
        archives: document.querySelector('[data-view="archives"] svg')?.innerHTML ?? "",
      }));
      check("the Archives nav item has its own glyph, not the Storage one", true, glyphs.storage !== glyphs.archives && glyphs.archives.length > 0);

      check("the page is called Archives, like its nav item", "Archives", await page.$eval("h1", (el) => el.textContent.trim()));
      check("the archive list carries the same name", "Archives", await page.$eval(".archive-group", (el) => el.getAttribute("aria-label")));
      const lede = await page.$eval(".lede", (el) => el.textContent.trim());
      check("the lede says how an archive is checked, never 'checked back in'", true, lede.includes("checked file by file on the destination") && !lede.includes("checked back in"));
      const ledeLines = await lines(page, ".lede");
      check("the lede wraps without a one-word last line", true, ledeLines.count <= 2 && Math.min(...ledeLines.widths) > 80);
      console.log(`      lede lines: ${ledeLines.count}, widths ${ledeLines.widths.join(", ")} px`);

      // The footer sentence has a subject, and the pill is the version alone.
      check("the idle update line names its subject", "Updates not checked yet", await page.$eval(".update-line", (el) => el.textContent.trim()));
      check("the pill shows only the version", "v0.1.21", await page.$eval(".pill", (el) => el.textContent.trim()));
      check("the pill no longer borrows the drive glyph", null, await page.$eval(".pill", (el) => el.querySelector("svg")));
      check(
        "the pill's aria-label still names the app fully",
        true,
        (await page.$eval(".pill", (el) => el.getAttribute("aria-label"))).includes("Storage Studio KH"),
      );

      const pillBox = await page.$eval(".pill", (el) => {
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      });
      console.log(`      pill box: ${pillBox.w}×${pillBox.h} px`);
      await page.close();
    }

    // ---- Empty state ----
    {
      const page = await pageAt(browser, "#no-archives=1");
      await page.click('[data-view="archives"]');
      await page.waitForSelector(".empty");
      const lede = await page.$eval(".lede", (el) => el.textContent.trim());
      check("the empty lede explains a channel archive", "An archive is a copy of one channel's folder, kept ready to restore on a new Mac.", lede);
      const emptyText = await page.$eval(".empty-text", (el) => el.textContent.trim());
      check("the empty state is one plain instruction", "Pick a channel's folder and where to copy it. Every file is checked on the destination.", emptyText);
      const emptyLines = await lines(page, ".empty-text");
      check("the empty instruction wraps without a one-word last line", true, Math.min(...emptyLines.widths) > 60);
      console.log(`      empty text lines: ${emptyLines.count}, widths ${emptyLines.widths.join(", ")} px`);
      const emptyIcon = await page.$eval(".empty-icon svg", (el) => el.innerHTML);
      const navIcon = await page.$eval('[data-view="archives"] svg', (el) => el.innerHTML);
      check("the empty state uses the Archives glyph", navIcon, emptyIcon);
      await page.close();
    }

    // ---- The add-storage form, first-time-user shape ----
    {
      const page = await pageAt(browser);
      await page.click('[data-action="add-storage"]');
      await page.waitForSelector("#share-target");

      check(
        "the address field is labelled for anyone",
        "Device address (or share)",
        await page.$eval('label[for="share-target"]', (el) => el.textContent.trim()),
      );
      check(
        "one hint line explains what to type",
        "The address you type in Finder, or your NAS's IP — we'll find its shares for you.",
        await page.$eval("#share-target-hint", (el) => el.textContent.trim()),
      );
      const sections = await page.evaluate(() =>
        Array.from(document.querySelectorAll(".sheet-body details.group")).map((el) => ({
          title: el.querySelector("summary")?.textContent.trim(),
          open: el.open,
        })),
      );
      check("Sign in and Advanced start closed", [{ title: "Sign in (optional)", open: false }, { title: "Advanced", open: false }], sections);
      check(
        "a share already mounted in Finder is offered with its line",
        "Already mounted in Finder? Add it here.",
        await page.$eval(".connected-group .field-hint", (el) => el.textContent.trim()),
      );
      const advanced = await page.evaluate(() => {
        const group = document.querySelector(".advanced-group");
        return {
          hasMount: Boolean(group?.querySelector("#mount-point")),
          switches: Array.from(group?.querySelectorAll('.check-row input[type="checkbox"]') ?? []).map((el) => el.checked),
        };
      });
      check("Advanced holds the mount point and both switches, on by default", { hasMount: true, switches: [true, true] }, advanced);

      // No address error while the list is still loading: the hint shows alone.
      await page.fill("#share-target", "smb://slow.local");
      await page.waitForFunction(
        () => (document.querySelector(".field-note")?.textContent ?? "").includes("Looking for shares"),
        null,
        { timeout: 3000 },
      );
      const whileLoading = await page.evaluate(() => {
        const reason = document.querySelector("#save-reason")?.textContent ?? "";
        return {
          busy: (document.querySelector(".field-note")?.textContent ?? "").includes("Looking for shares"),
          red: Boolean(document.querySelector(".form-error")),
          addressReason: /address|share/i.test(reason),
        };
      });
      check("a list that is still loading shows the hint and no address error", { busy: true, red: false, addressReason: false }, whileLoading);

      // The rows arrive as full-width rows with Add.
      await page.waitForSelector('[data-editor-action="pick-share"]', { timeout: 8000 });
      const rows = await page.$$eval('[data-editor-action="pick-share"]', (nodes) =>
        nodes.map((el) => ({
          name: el.querySelector(".share-row-name")?.textContent ?? "",
          add: el.querySelector(".share-row-add")?.textContent ?? "",
          width: Math.round(el.getBoundingClientRect().width),
        })),
      );
      const pickerWidth = await page.$eval(".share-picker", (el) => Math.round(el.getBoundingClientRect().width));
      check("each share is a full-width row with Add", true, rows.length === 3 && rows.every((row) => row.add === "Add" && row.width >= pickerWidth - 16));
      console.log(`      share rows: ${rows.map((row) => `${row.name} (${row.width}px)`).join(", ")} in a ${pickerWidth}px picker`);

      // The person sees readable names, never %20.
      await page.click('[data-editor-action="pick-share"][data-share="Public Space-Media - 4TB - Music"]');
      const shown = await page.$eval("#share-target", (el) => el.value);
      check("a picked share is shown readable", "smb://slow.local/Public Space-Media - 4TB - Music", shown);
      await page.close();
    }

    const failed = results.filter((pass) => !pass).length;
    console.log(failed ? `\n${failed} check(s) failed` : "\nAll measured checks passed");
    return failed ? 1 : 0;
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }
}

main().then((code) => process.exit(code)).catch((error) => {
  console.error(error);
  process.exit(1);
});
