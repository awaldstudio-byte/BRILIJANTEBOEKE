import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/natha/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const origin = process.env.REVIEW_ORIGIN || "http://127.0.0.1:4318";
const output = resolve(".vercel/payfast-review");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" });
const results = [];
const errors = [];
try {
  for (const [width, height] of [[1440, 1000], [1024, 768], [768, 1024], [390, 844], [320, 740]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator(".home-hero video").count(), 0);
    const font = await page.locator("#workbook-heading").evaluate((el) => getComputedStyle(el).fontFamily);
    assert.match(font, /Roboto/);
    for (const grade of [3, 4, 5, 6, 7]) {
      await page.locator(`[data-banner-grade="${grade}"]`).click();
      await page.waitForFunction(() => [...document.querySelectorAll(".workbook-banner img")].every((img) => img.complete && img.naturalWidth > 0));
      assert.equal(await page.locator("#banner-grade").innerText(), `Graad ${grade}`);
      assert.match(await page.locator("#banner-cover-link").getAttribute("href"), new RegExp(`graad-${grade}`));
      assert.equal(await page.locator('[data-banner-grade][aria-pressed="true"]').count(), 1);
    }
    await page.locator('[data-banner-grade="3"]').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Home overflow at ${width}`);
    await page.screenshot({ path: `${output}/home-${width}.png`, fullPage: true });
    for (const path of ["/privacy-policy-2/", "/refund_returns/", "/frequently-asked-questions/"]) {
      await page.goto(origin + path, { waitUntil: "networkidle" });
      assert.equal(await page.locator("h1").count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Policy overflow at ${width}: ${path}`);
      assert.ok((await page.locator(".legal-brand img").boundingBox()).width >= 100);
    }
    await page.screenshot({ path: `${output}/policy-${width}.png`, fullPage: true });
    results.push({ viewport: `${width}x${height}`, homepage: "passed", grades: "3-7 passed", policies: "passed" });
    await page.close();
  }
  for (const lang of ["en", "af"]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${origin}/order/?preview=1&lang=${lang}`, { waitUntil: "networkidle" });
    await page.locator('[data-field="first_name"]').first().fill("Test");
    await page.locator('[data-field="last_name"]').first().fill("Parent");
    await page.locator("#continue-details").click();
    assert.equal(await page.locator(`[data-policy-language="${lang}"]`).first().isVisible(), true);
    await page.locator('#parent-form [name="first_name"]').fill("Example");
    await page.locator('#parent-form [name="last_name"]').fill("Parent");
    await page.locator('#parent-form [name="email"]').fill("example@example.com");
    await page.locator('#parent-form [name="mobile"]').fill("0820000000");
    await page.locator('#parent-form [name="consent"]').check();
    await page.locator('#parent-form button[type="submit"]').click();
    assert.ok((await page.locator("#checkout-delivery-note").innerText()).length > 20);
    await page.locator("#pay-button").click();
    assert.match(await page.locator("#payment-message").innerText(), /Preview mode|Voorskoumodus/);
    await page.screenshot({ path: `${output}/checkout-${lang}.png`, fullPage: true });
    results.push({ checkout: lang, inlineConditions: "passed", previewDoesNotPay: "passed" });
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ origin, results, errors }, null, 2));
  console.log(JSON.stringify({ origin, results, errors, output }, null, 2));
} finally { await browser.close(); }
