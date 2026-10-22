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

test('unconfirmed prices never become zero or NaN in a quotation', () => {
  const context = catalogue();
  for (const id of [801,802]) {
    assert.equal(vm.runInContext(`byId(${id}).price`, context), null);
    assert.equal(vm.runInContext(`quoteAmount(byId(${id}),10)`, context), 'Prys op aanvraag | Price on request');
  }
  assert.equal(vm.runInContext('quoteAmount(byId(815),3)', context), 'R960');
  assert.equal(vm.runInContext('quoteAmount(byId(820),2)', context), 'R680');
  assert.equal(vm.runInContext('quoteQuantity("invalid")', context), 1);
});

test('every banner product has five existing images and a product page', async () => {
  const products = vm.runInContext('PRODUCTS', catalogue());
  for (const product of products) {
    assert.equal(product.images.length, 5);
    for (const image of product.images) await access(new URL(`..${image}`, import.meta.url));
    await access(new URL(`../product/${product.slug}/index.html`, import.meta.url));
  }
});
