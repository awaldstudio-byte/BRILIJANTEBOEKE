import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../assets/site.js', import.meta.url), 'utf8');
function catalogue() {
  const context = vm.createContext({
    document: { querySelectorAll: () => [], getElementById: () => null, querySelector: () => null },
    addEventListener() {},
  });
  vm.runInContext(source, context);
  return context;
}

test('public catalogue retains all seven unique products in grade order', () => {
  const context = catalogue();
  assert.deepEqual(Array.from(vm.runInContext('PRODUCTS.map(p=>p.title)', context)),
    [1,2,3,4,5,6,7].map(grade => `Graad ${grade}`));
  assert.equal(vm.runInContext('new Set(PRODUCTS.map(p=>p.id)).size', context), 7);
  assert.equal(vm.runInContext('new Set(PRODUCTS.map(p=>p.slug)).size', context), 7);
  assert.deepEqual(Array.from(vm.runInContext('PRODUCTS.slice(2).map(p=>p.id)', context)), [815,820,825,830,835]);
});

test('Grade 1 and 2 quotations use the client-confirmed R320 unit prices', () => {
  const context = catalogue();
  for (const id of [801,802]) {
    assert.equal(vm.runInContext(`byId(${id}).price`, context), '320');
    assert.equal(vm.runInContext(`quoteAmount(byId(${id}),1)`, context), 'R320');
    assert.equal(vm.runInContext(`quoteAmount(byId(${id}),10)`, context), 'R3200');
  }
  assert.equal(vm.runInContext('quoteAmount(byId(815),3)', context), 'R960');
  assert.equal(vm.runInContext('quoteAmount(byId(820),2)', context), 'R680');
  assert.equal(vm.runInContext('quoteQuantity("invalid")', context), 1);
});

test('an unconfirmed future price is never displayed as zero or NaN', () => {
  assert.equal(vm.runInContext('quoteAmount({price:null},10)', catalogue()), 'Prys op aanvraag | Price on request');
});

test('every banner product has five existing images and a product page', async () => {
  const products = vm.runInContext('PRODUCTS', catalogue());
  for (const product of products) {
    assert.equal(product.images.length, 5);
    for (const image of product.images) await access(new URL(`..${image}`, import.meta.url));
    await access(new URL(`../product/${product.slug}/index.html`, import.meta.url));
  }
});

test('Grade 1 sample gallery excludes module covers but retains its cover, title and eight content pages', async () => {
  const html = await readFile(new URL('../product/graad-1/index.html', import.meta.url), 'utf8');
  const sources = [...html.matchAll(/data-gallery-src="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(sources, ['cover', 'title-page', 'content-13', 'content-53', 'content-70', 'content-108', 'content-125', 'content-130', 'content-146', 'content-159'].map(name => `/assets/images/grade-1/${name}.png`));
  assert.doesNotMatch(html, /\/grade-1\/module-\d+\.png/);
});

test('Grade 2 gallery excludes all four crossed-out module covers and retains ten content samples', async () => {
  const html = await readFile(new URL('../product/graad-2/index.html', import.meta.url), 'utf8');
  const sources = [...html.matchAll(/data-gallery-src="([^"]+)"/g)].map(match => match[1]);
  assert.equal(sources.length, 12);
  assert.equal(sources.filter(src=>src.includes('/content-')).length, 10);
  assert.ok(sources.includes('/assets/images/grade-2/cover.png'));
  assert.ok(sources.includes('/assets/images/grade-2/title-page.png'));
  assert.doesNotMatch(html, /\/grade-2\/module-\d+\.png/);
});
