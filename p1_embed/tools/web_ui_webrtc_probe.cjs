#!/usr/bin/env node
"use strict";

const DEFAULT_URL = "https://127.0.0.1:8082/p1_embed/web/?debug=1";
const DEFAULT_DEVICE = "p1-embed-f7a608";

async function loadPlaywright() {
  try {
    return require("playwright");
  } catch (error) {
    throw new Error(`Could not load playwright: ${error.message}`);
  }
}

async function main() {
  const url = process.argv[2] || DEFAULT_URL;
  const device = process.argv[3] || DEFAULT_DEVICE;
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  page.on("console", (message) => console.log(`[browser:${message.type()}] ${message.text()}`));
  page.on("pageerror", (error) => console.log(`[pageerror] ${error.message}`));

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.selectOption("#debug-level", "debug");
    await page.click("#connect-button");
    await page.click("#new-peer-toggle-button");
    await page.fill("#peer-id", device);
    await page.click("#new-peer-connect-button");
    await page.waitForTimeout(25000);

    const consoleText = await page.locator("#console-output").innerText().catch(() => "");
    console.log("\n[P1E console]");
    console.log(consoleText);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
