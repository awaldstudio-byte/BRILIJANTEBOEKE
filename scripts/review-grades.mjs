import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/natha/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const origin = (process.env.REVIEW_ORIGIN || "http://127.0.0.1:4318").replace(/\/$/, "");
const output = resolve(process.env.REVIEW_OUTPUT || "../../outputs/briljante-grade-1-2-review/details-local");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" });
const results = [];
const errors = [];
const assertions = [];

async function ready(page, path) {
  const response = await page.goto(origin + path, { waitUntil: "networkidle" });
  assert.equal(response.status(), 200, `HTTP ${path}`);
  await page.evaluate(() => document.fonts.ready);
  // Exercise native lazy loading without changing the site's loading policy.
  for (const image of await page.locator("img").all()) {
    await image.scrollIntoViewIfNeeded();
    await image.evaluate(image => image.decode());
  }
  await top(page);
  assert.equal(await page.evaluate(() => [...document.images].every(image => image.complete && image.naturalWidth > 0)), true, `Missing image: ${path}`);
}

async function top(page) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForFunction(() => window.scrollY === 0 && !document.querySelector(".site-header.is-sticky"));
}

async function layout(page, path, width) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Horizontal overflow: ${path} at ${width}`);
  const logo = await page.locator(".site-logo img").boundingBox();
  assert.ok(logo && logo.width >= 100, `Header logo too small: ${path} at ${width}`);
}

try {
  for (const [width, height] of [[1440, 1000], [1024, 768], [768, 1024], [390, 844], [320, 740]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on("pageerror", error => errors.push({ viewport: `${width}x${height}`, message: error.message }));
    await ready(page, "/books/");
    const grids = page.locator(".shop-shell .products-grid");
    assert.equal(await grids.count(), 2, "Catalogue must retain two distinct grade groups");
    assert.deepEqual(await page.locator(".product-card h2").allTextContents(), ["Graad 1", "Graad 2", "Graad 3", "Graad 4", "Graad 5", "Graad 6", "Graad 7"]);
    assert.deepEqual(await grids.nth(0).locator(".product-card h2").allTextContents(), ["Graad 1", "Graad 2", "Graad 3"]);
    assert.deepEqual(await grids.nth(1).locator(".product-card h2").allTextContents(), ["Graad 4", "Graad 5", "Graad 6", "Graad 7"]);
    assert.match(await page.locator(".shop-shell").innerText(), /Junior/i);
    assert.deepEqual(await grids.nth(0).locator('.price').allTextContents(), ['R320', 'R320', 'R320']);
    if (width < 690) {
      const mobileRows = await grids.evaluateAll(groups => groups.map(group => [...group.querySelectorAll('.product-card')].map(card => {
        const box = card.getBoundingClientRect();
        const button = card.querySelector('.quote-add').getBoundingClientRect();
        return {x:box.x,y:box.y,width:box.width,buttonHeight:button.height};
      })));
      for (const cards of mobileRows) {
        assert.ok(Math.abs(cards[0].y-cards[1].y)<2, 'First two mobile books must sit side by side');
        assert.ok(cards[1].x>cards[0].x, 'Mobile books must progress left to right');
        assert.ok(cards[2].y>cards[0].y, 'Third mobile book must start the next row');
        assert.ok(cards.every(card=>card.buttonHeight>=44), 'Mobile quote buttons need 44px touch height');
      }
      const shellHeight = await page.locator('.shop-shell').evaluate(el=>el.getBoundingClientRect().height);
      assert.ok(shellHeight < 2200, `Mobile catalogue must stay compact: ${shellHeight}px`);
      assertions.push({viewport:`${width}x${height}`,mobileRows,catalogueHeight:shellHeight});
    }
    if (width >= 1000) {
      const rows = await grids.evaluateAll(groups => groups.map(group => [...group.querySelectorAll(".product-card")].map(card => {
        const { x, y, width } = card.getBoundingClientRect();
        return { x, y, width };
      })));
      rows.forEach(cards => {
        assert.ok(cards.every(card => Math.abs(card.y - cards[0].y) < 2), `Expected one catalogue row per group at ${width}`);
        assert.ok(cards.slice(1).every((card, i) => card.x > cards[i].x), "Cards must progress left to right");
      });
      assert.ok(rows[1][0].y > rows[0][0].y, "Grades 4-7 must follow the Junior row");
      assertions.push({ viewport: `${width}x${height}`, catalogueRows: rows });
    }
    await layout(page, "/books/", width);
    await page.screenshot({ path: `${output}/catalogue-${width}.png`, fullPage: true });

    if (width >= 1000) {
      await page.locator("[data-search-open]").click();
      await page.locator("#site-search").fill("Grade 1");
      assert.equal(await page.locator('#search-results a[href="/product/graad-1/"]').count(), 1);
      await page.locator(".search-close").click();
    }

    for (const id of [801, 802, 815]) await page.locator(`.quote-add[data-product="${id}"]`).click();
    await ready(page, "/request-quote/");
    assert.equal(await page.locator("#quote-items tr").count(), 3);
    for (const id of [801, 802]) {
      const subtotal = await page.locator(`#quote-items tr[data-id="${id}"] .product-subtotal`).innerText();
      assert.equal(subtotal, 'R320');
      assert.doesNotMatch(subtotal, /Price on request|R0|NaN/);
      await page.locator(`#quote-items tr[data-id="${id}"] .quote-qty`).fill('2');
    }
    assert.equal(await page.locator('#quote-items tr[data-id="815"] .product-subtotal').innerText(), "R320");
    await page.locator('#quote-items tr[data-id="815"] .quote-qty').fill("2");
    await page.locator("#quote-update").click();
    for (const id of [801, 802]) assert.equal(await page.locator(`#quote-items tr[data-id="${id}"] .product-subtotal`).innerText(), 'R640');
    assert.equal(await page.locator('#quote-items tr[data-id="815"] .product-subtotal').innerText(), "R640");
    assert.doesNotMatch(await page.locator("#quote-items").innerText(), /NaN|R0\b/);
    await layout(page, "/request-quote/", width);
    await page.screenshot({ path: `${output}/quotation-${width}.png`, fullPage: true });
    await page.locator('#quote-items tr[data-id="802"] .quote-remove').click();
    assert.equal(await page.locator("#quote-items tr").count(), 2);
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.locator("#quote-items tr").count(), 2, "Saved quote must retain removals and quantities");
    assert.equal(await page.locator('#quote-items tr[data-id="815"] .quote-qty').inputValue(), "2");

    for (const [grade, count] of [[1, 10], [2, 12]]) {
      const path = `/product/graad-${grade}/`;
      await ready(page, path);
      assert.equal(await page.locator(".product-summary h1").innerText(), `Graad ${grade}`);
      assert.equal(await page.locator(".product-summary .price").innerText(), 'R320');
      const thumbs = page.locator(".gallery-thumb");
      assert.equal(await thumbs.count(), count, `Approved Grade ${grade} gallery count`);
      assert.equal(await page.locator('.gallery-thumb[data-gallery-src*="/module-"]').count(), 0, `Grade ${grade} module covers must not appear as sample pages`);
      const sources = await thumbs.evaluateAll(buttons => buttons.map(button => ({ src: button.dataset.gallerySrc, alt: button.dataset.galleryAlt || button.getAttribute("aria-label") })));
      assert.equal(new Set(sources.map(item => item.src)).size, count, `Grade ${grade} gallery has duplicates`);
      for (let i = 0; i < count; i++) {
        await thumbs.nth(i).click();
        const main = page.locator("#main-product-image");
        await main.evaluate(async image => image.decode());
        assert.equal(await main.getAttribute("src"), sources[i].src);
        assert.equal(await main.getAttribute("alt"), sources[i].alt);
        assert.equal(await thumbs.nth(i).getAttribute("aria-pressed"), "true");
        assert.equal(await page.locator('.gallery-thumb[aria-pressed="true"]').count(), 1);
      }
      await thumbs.nth(0).click();
      await layout(page, path, width);
      await top(page);
      await page.screenshot({ path: `${output}/product-grade-${grade}-${width}.png`, fullPage: true });
    }

    await ready(page, "/about/");
    assert.equal(await page.locator(".about-book").count(), 7);
    const links = await page.locator(".about-book").evaluateAll(books => books.map(book => book.getAttribute("href")));
    assert.deepEqual(links, ["/product/graad-1/", "/product/graad-2/", "/product/graad-3/", "/product/graad-4-werkboek/", "/product/graad-5/", "/product/graad-6/", "/product/graad-7/"]);
    await layout(page, "/about/", width);
    await page.screenshot({ path: `${output}/about-${width}.png`, fullPage: true });
    results.push({ viewport: `${width}x${height}`, catalogue: "7 grades, separate Junior 1-3 / Grades 4-7; Grades 1-3 R320 each; two columns on phones", galleries: "10 Grade 1 and 12 Grade 2 images without module covers; every thumbnail checked", quotations: "Grades 1-3 R320 each and R640 for quantity 2; remove and persistence passed", about: "7 linked covers", overflow: "none", search: width >= 1000 ? "English Grade 1 passed" : "not tested (mobile search hidden)" });
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ origin, results, assertions, errors }, null, 2));
  console.log(JSON.stringify({ origin, results, errors, output }, null, 2));
} catch (error) {
  await writeFile(`${output}/results.json`, JSON.stringify({ origin, results, assertions, errors, failure: { message: error.message, stack: error.stack } }, null, 2));
  throw error;
} finally {
  await browser.close();
}
