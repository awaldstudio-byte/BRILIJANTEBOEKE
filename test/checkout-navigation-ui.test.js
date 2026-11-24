import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../assets/order-app.js', import.meta.url), 'utf8');
const functions = source.slice(source.indexOf('async function startPayment()'), source.indexOf('async function startDemoPayment()'));

function orderPage({ failAt = 'checkout', failureCode = 'REQUEST_TIMEOUT', language = 'en' } = {}) {
  const elements = new Map();
  const state = { requestId: 'same-idempotency-key', config: { payments_enabled: true, school: { slug: 'example-school' }, period: { id: 'existing-period' } }, parent: {}, consent: {}, learners: [{ id: 'local-only', first_name: 'Test', last_name: 'Learner', offering_id: 'offering' }], order: null };
  const requests = [], storage = new Map(), location = {};
  let fail = true;
  const context = {
    state, location, language, preview: false,
    window: { addEventListener() {} },
    sessionStorage: { setItem: (key, value) => storage.set(key, value) },
    $: (selector) => { if (!elements.has(selector)) elements.set(selector, { hidden: true }); return elements.get(selector); },
    tr: (af, en) => language === 'en' ? en : af,
    paymentReadiness: () => ({ enabled: true }),
    api: async (url, options) => {
      requests.push({ url, input: JSON.parse(options.body) });
      if (fail && ((url === '/api/orders' && failAt === 'orders') || (url === '/api/create-checkout' && failAt === 'checkout'))) {
        fail = false;
        throw Object.assign(new Error('Request failed'), { code: failureCode });
      }
      if (url === '/api/orders') return { order: { reference: 'BB-26-RECOVERY', access_token: 'private-token' } };
      return { action: 'https://www.payfast.co.za/eng/process', fields: { m_payment_id: 'BB-26-RECOVERY' } };
    },
    submitPayFastForm: async () => { throw Object.assign(new Error('Navigation failed'), { code: 'PAYMENT_NAVIGATION_BLOCKED' }); },
  };
  runInNewContext(`${functions}\nglobalThis.startPayment = startPayment;`, context);
  return { ...context, elements, requests, storage };
}

test('a checkout failure exposes the existing order and routes recovery to its status without creating another', async () => {
  for (const language of ['en', 'af']) {
    const page = orderPage({ language });
    await page.startPayment();
    assert.equal(page.requests.length, 2);
    assert.equal(page.storage.get('briljante_order_token_BB-26-RECOVERY'), 'private-token');
    assert.equal(page.elements.get('#pay-button').disabled, false);
    assert.equal(page.elements.get('#payment-order-status').hidden, false);
    assert.equal(page.elements.get('#payment-order-status').href, `/order/status/?reference=BB-26-RECOVERY&lang=${language}`);
    assert.match(page.elements.get('#payment-message').textContent, /BB-26-RECOVERY/);
    await page.startPayment();
    assert.equal(page.requests.length, 2);
    assert.equal(page.location.href, `/order/status/?reference=BB-26-RECOVERY&lang=${language}`);
    assert.doesNotMatch(page.location.href, /private-token/);
  }
});

test('an order-creation deadline preserves its idempotency key for the next attempt', async () => {
  const page = orderPage({ failAt: 'orders' });
  await page.startPayment();
  assert.equal(page.state.order, null);
  assert.equal(page.elements.get('#pay-button').disabled, false);
  await page.startPayment();
  const orderRequests = page.requests.filter(({ url }) => url === '/api/orders');
  assert.equal(orderRequests.length, 2);
  assert.equal(orderRequests[0].input.request_id, orderRequests[1].input.request_id);
  assert.equal(page.state.order.reference, 'BB-26-RECOVERY');
  assert.equal(page.state.paymentRecoveryRequired, true);
  assert.match(page.elements.get('#payment-message').textContent, /browser blocked the payment page/);
});
