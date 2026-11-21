#!/usr/bin/env node
/*
 * The measurements behind the visual pass: layout, clipping and contrast, before and after.
 *
 *   node tests/visual-measure.cjs [output.json]
 *
 * Headless Chromium against the dev fixture at 820×640, light and dark. Prints one JSON object.
 */
const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const path = require("node:path");

const REPO = path.resolve(__dirname, "..");
const BASE = "http://localhost:1420/";
const OUT = process.argv[2] || "";

let chromium;
try {
  ({ chromium } = require("playwright-core"));
} catch {
  console.log("NOT RUN  visual-measure: playwright-core is not installed here");
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

function contrastProbe() {
  const parse = (value) => {
    const m = value.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const parts = m[1].split(",").map((n) => parseFloat(n));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const bgOf = (el) => {
    let node = el;
    while (node) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0.9) return c;
      node = node.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };
  const luminance = (c) => {
    const channel = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  };
  const ratio = (el) => {
    const style = getComputedStyle(el);
    const fg = parse(style.color);
    if (!fg) return null;
    const bg = bgOf(el);
    const f = over(fg, bg);
    const a = luminance(f);
    const b = luminance(bg);
    const [hi, lo] = a > b ? [a, b] : [b, a];
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
  };
  const pick = (selector) => {
    const el = [...document.querySelectorAll(selector)].find((node) => !node.closest("dialog") || node.closest("dialog")?.open);
    if (!el) return null;
    const style = getComputedStyle(el);
    const size = parseFloat(style.fontSize);
    return { ratio: ratio(el), px: size, text: (el.textContent || "").trim().slice(0, 40) };
  };
  return {
    body: pick("main p"),
    muted: pick(".quiet-line, .field-hint, .archive-meta"),
    cardTitle: pick(".card-title, .storage-name, h3"),
    primaryButton: pick(".btn-primary"),
    quietLink: pick(".share-row-add, .share-choice-dismiss"),
    statusPill: pick(".status-pill, .status"),
    navLabel: pick(".nav-item span"),
    h1: pick("h1"),
    path: pick(".path-text, .archive-path"),
  };
}

function flowProbe() {
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom) };
  };
  const dialog = document.querySelector("dialog[open]");
  const body = dialog?.querySelector(".sheet-body");
  const actions = dialog?.querySelector(".sheet-actions");
  const rows = [...(dialog?.querySelectorAll('[data-editor-action="pick-share"]') ?? [])];
  const dismiss = dialog?.querySelector(".share-choice-dismiss");
  const reason = dialog?.querySelector("#save-reason");
  const head = document.querySelector(".page-head");
  const headActions = document.querySelector(".page-head-actions");
  const lede = document.querySelector(".lede");
  return {
    dialog: rect(dialog),
    sheetBody: body
      ? {
          clientH: body.clientHeight,
          scrollH: body.scrollHeight,
          overflowY: getComputedStyle(body).overflowY,
          rect: rect(body),
        }
      : null,
    actions: rect(actions),
    shareRows: rows.map((el) => ({ name: el.textContent.trim().slice(0, 30), rect: rect(el), visible: actions ? el.getBoundingClientRect().bottom <= actions.getBoundingClientRect().top + 1 : null })),
    dismiss: { rect: rect(dismiss), visible: actions && dismiss ? dismiss.getBoundingClientRect().bottom <= actions.getBoundingClientRect().top + 1 : null },
    saveReason: reason ? { text: reason.textContent.trim(), rect: rect(reason) } : null,
    head: rect(head),
    headActions: headActions
      ? {
          rect: rect(headActions),
          children: [...headActions.children].map((el) => ({ text: el.textContent.trim(), rect: rect(el) })),
        }
      : null,
    lede: lede ? { rect: rect(lede), lines: (() => { const walker = document.createTreeWalker(lede, NodeFilter.SHOW_TEXT); const n = walker.nextNode(); if (!n) return 0; const r = document.createRange(); r.selectNodeContents(n); return r.getClientRects().length; })() } : null,
  };
}

async function main() {
  const server = spawn(path.join(REPO, "node_modules", ".bin", "vite"), ["--config", "ui/vite.config.ts"], {
    cwd: REPO,
    stdio: "ignore",
  });
  let browser;
  const out = {};
  try {
    if (!(await waitForServer(BASE, 30000))) {
      console.log("FAIL  the dev server did not start");
      return 1;
    }
    browser = await chromium.launch({ headless: true, channel: "chrome" }).catch(() =>
      chromium.launch({ headless: true }),
    );

    const openAddShares = async (page) => {
      await page.click('[data-action="add-storage"]');
      await page.fill("#share-target", "smb://nas.local");
      await page.waitForSelector('[data-editor-action="pick-share"]', { timeout: 8000 });
    };
    const openEdit = async (page) => {
      await page.click('[data-row-menu][data-id="studio-nas"]');
      await page.waitForSelector('[data-action="edit"]');
      await page.click('[data-action="edit"]');
      await page.waitForSelector("#editor-title");
      await page.fill("#share-target", "smb://nas.local");
      await page.waitForSelector('[data-editor-action="pick-share"]', { timeout: 8000 });
    };

    for (const theme of ["light", "dark"]) {
      {
        const page = await browser.newPage({ viewport: { width: 820, height: 640 } });
        await page.goto(BASE + `#theme=${theme}`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector('[data-view="storage"]');
        await page.waitForTimeout(300);
        out[`storage-${theme}`] = await page.evaluate(flowProbe);
        out[`contrast-storage-${theme}`] = await page.evaluate(contrastProbe);
        await page.close();
      }
      {
        const page = await browser.newPage({ viewport: { width: 820, height: 640 } });
        await page.goto(BASE + `#theme=${theme}`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector('[data-view="archives"]');
        await page.click('[data-view="archives"]');
        await page.waitForSelector(".archive-group");
        await page.waitForTimeout(300);
        out[`archives-${theme}`] = await page.evaluate(flowProbe);
        out[`contrast-archives-${theme}`] = await page.evaluate(contrastProbe);
        await page.close();
      }
      {
        const page = await browser.newPage({ viewport: { width: 820, height: 640 } });
        await page.goto(BASE + `#theme=${theme}`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector('[data-view="storage"]');
        await openAddShares(page);
        out[`add-shares-${theme}`] = await page.evaluate(flowProbe);
        out[`contrast-dialog-${theme}`] = await page.evaluate(contrastProbe);
        await page.close();
      }
      {
        const page = await browser.newPage({ viewport: { width: 820, height: 640 } });
        await page.goto(BASE + `#theme=${theme}`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector('[data-view="storage"]');
        await openEdit(page);
        out[`edit-shares-${theme}`] = await page.evaluate(flowProbe);
        await page.close();
      }
    }

    const text = JSON.stringify(out, null, 2);
    console.log(text);
    if (OUT) writeFileSync(OUT, text + "\n");
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
