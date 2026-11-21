#!/usr/bin/env node
/*
 * The visual pass: photograph every page and state, and measure each one.
 *
 *   node tests/visual-pass.cjs <output-dir>
 *
 * Headless Chromium (installed Google Chrome) against the dev fixture at the default window size
 * 820×640, light and dark: no window, no desktop, no share contacted. Writes NN-<page>-<state>.png
 * plus measurements.json beside them. Exit 0 always when it ran; 2 when Playwright is absent.
 */
const { spawn } = require("node:child_process");
const { mkdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const REPO = path.resolve(__dirname, "..");
const BASE = "http://localhost:1420/";
const OUT = path.resolve(process.argv[2] || path.join(REPO, "tests", "screenshots", "visual-pass"));

let chromium;
try {
  ({ chromium } = require("playwright-core"));
} catch {
  console.log("NOT RUN  visual-pass: playwright-core is not installed here");
  process.exit(2);
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

/** Facts a photograph cannot carry: overflow, clipped text, controls with no name. */
function audit() {
  const main = document.querySelector("main") || document.body;
  const clipped = [];
  for (const el of main.querySelectorAll("*")) {
    if (el.closest("dialog")) continue;
    const style = getComputedStyle(el);
    if (style.overflow === "visible" && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
      clipped.push({ tag: el.tagName.toLowerCase(), cls: el.className.toString().slice(0, 40), text: (el.textContent || "").trim().slice(0, 60) });
    }
  }
  const unnamed = [];
  for (const el of document.querySelectorAll("button, a[href], input:not([type=hidden]), select, summary")) {
    if (el.closest("[hidden]")) continue;
    const labelledBy = (el.getAttribute("aria-labelledby") || "")
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent || "")
      .join(" ")
      .trim();
    const name =
      (el.getAttribute("aria-label") || "").trim() ||
      labelledBy ||
      (el.getAttribute("title") || "").trim() ||
      (el.innerText || "").trim() ||
      (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent) ||
      (el.closest("label")?.textContent || "").trim();
    if (!name) unnamed.push({ tag: el.tagName.toLowerCase(), cls: el.className.toString().slice(0, 40), html: el.outerHTML.slice(0, 90) });
  }
  const nav = Array.from(document.querySelectorAll(".nav-item")).map((el) => ({
    label: el.textContent.trim(),
    icon: el.querySelector("svg")?.innerHTML.slice(0, 80) ?? "",
  }));
  const dupIcons = [];
  nav.forEach((a, i) => nav.forEach((b, j) => { if (i < j && a.icon && a.icon === b.icon) dupIcons.push([a.label, b.label]); }));
  const dialogs = Array.from(document.querySelectorAll("dialog[open]")).map((el) => {
    const r = el.getBoundingClientRect();
    return { id: el.id, w: Math.round(r.width), h: Math.round(r.height), scrollH: el.scrollHeight, clientH: el.clientHeight };
  });
  return {
    viewport: { w: innerWidth, h: innerHeight },
    docOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    clipped: clipped.slice(0, 12),
    unnamed: unnamed.slice(0, 12),
    duplicateNavIcons: dupIcons,
    nav,
    dialogs,
    h1: document.querySelector("main h1")?.textContent.trim() ?? null,
    lede: document.querySelector(".lede")?.textContent.trim() ?? null,
  };
}

async function shoot(browser, shots, name, hash, act, theme) {
  const page = await browser.newPage({ viewport: { width: 820, height: 640 } });
  await page.goto(BASE + hash, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-view="storage"]');
  await page.waitForTimeout(250);
  if (act) await act(page);
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  shots.push({ name, ...(await page.evaluate(audit)) });
  await page.close();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const server = spawn(path.join(REPO, "node_modules", ".bin", "vite"), ["--config", "ui/vite.config.ts"], {
    cwd: REPO,
    stdio: "ignore",
  });
  let browser;
  const shots = [];
  try {
    if (!(await waitForServer(BASE, 30000))) {
      console.log("FAIL  the dev server did not start on " + BASE);
      return 1;
    }
    browser = await chromium.launch({ headless: true, channel: "chrome" }).catch(() =>
      chromium.launch({ headless: true }),
    );
    const click = (selector) => async (page) => page.click(selector);
    const themes = ["light", "dark"];
    let n = 1;
    const num = () => String(n++).padStart(2, "0");

    for (const theme of themes) {
      const suffix = theme;
      await shoot(browser, shots, `${num()}-storage-populated-${suffix}`, `#theme=${theme}`, null, theme);
      await shoot(browser, shots, `${num()}-storage-empty-${suffix}`, `#theme=${theme}&empty=1`, null, theme);
      await shoot(browser, shots, `${num()}-storage-table-${suffix}`, `#theme=${theme}&list=table`, null, theme);
      await shoot(browser, shots, `${num()}-archives-populated-${suffix}`, `#theme=${theme}`, click('[data-view="archives"]'), theme);
      await shoot(browser, shots, `${num()}-archives-empty-${suffix}`, `#theme=${theme}&no-archives=1`, click('[data-view="archives"]'), theme);
      await shoot(browser, shots, `${num()}-general-${suffix}`, `#theme=${theme}`, click('[data-view="general"]'), theme);
      await shoot(browser, shots, `${num()}-appearance-${suffix}`, `#theme=${theme}`, click('[data-view="appearance"]'), theme);
      await shoot(browser, shots, `${num()}-support-${suffix}`, `#theme=${theme}`, click('[data-view="support"]'), theme);
      await shoot(browser, shots, `${num()}-add-storage-${suffix}`, `#theme=${theme}`, click('[data-action="add-storage"]'), theme);
      await shoot(
        browser,
        shots,
        `${num()}-add-storage-shares-${suffix}`,
        `#theme=${theme}`,
        async (page) => {
          await page.click('[data-action="add-storage"]');
          await page.fill("#share-target", "smb://nas.local");
          await page.waitForSelector('[data-editor-action="pick-share"]', { timeout: 8000 });
        },
        theme,
      );
      await shoot(
        browser,
        shots,
        `${num()}-edit-storage-${suffix}`,
        `#theme=${theme}`,
        async (page) => {
          await page.click('[data-row-menu][data-id="studio-nas"]');
          await page.waitForSelector('[data-action="edit"]');
          await page.click('[data-action="edit"]');
          await page.waitForSelector("#editor-title");
        },
        theme,
      );
      await shoot(
        browser,
        shots,
        `${num()}-row-menu-${suffix}`,
        `#theme=${theme}`,
        async (page) => {
          await page.click('[data-row-menu][data-id="archive"]');
          await page.waitForSelector('[data-action="remove"]');
        },
        theme,
      );
      await shoot(
        browser,
        shots,
        `${num()}-archive-sheet-${suffix}`,
        `#theme=${theme}`,
        async (page) => {
          await page.click('[data-view="archives"]');
          await page.waitForSelector('[data-action="add-archive"]');
          await page.click('[data-action="add-archive"]');
          await page.waitForSelector("#archive-sheet-title, #archive-sheet h2");
        },
        theme,
      );
      await shoot(
        browser,
        shots,
        `${num()}-restore-sheet-${suffix}`,
        `#theme=${theme}`,
        async (page) => {
          await page.click('[data-view="archives"]');
          await page.waitForSelector('[data-action="restore-open"]');
          await page.click('[data-action="restore-open"]');
          await page.waitForSelector("#restore-sheet h2, #restore-sheet-title");
        },
        theme,
      );
      await shoot(
        browser,
        shots,
        `${num()}-job-banner-${suffix}`,
        `#theme=${theme}&job-copying=1`,
        click('[data-view="archives"]'),
        theme,
      );
    }

    writeFileSync(path.join(OUT, "measurements.json"), JSON.stringify(shots, null, 2) + "\n");
    console.log(`Captured ${shots.length} states into ${OUT}`);
    return 0;
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }
}

main().then((code) => process.exit(code)).catch((error) => {
  console.error(error);
  process.exit(1);
});
