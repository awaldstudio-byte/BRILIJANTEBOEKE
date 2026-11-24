import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { requestJson, submitPayFastForm } from '../assets/payment-checkout.js';

test('checkout CSP allows the supported PayFast redirect origins without wildcard or scheme-wide access', async () => {
  // PayFast documents payment.payfast.io in its AWS migration notice:
  // https://support.payfast.help/portal/en/kb/articles/whitelisting-ip-addresses-2-7-2025
  const configuration = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  const policy = configuration.headers.find(({ source }) => source === '/order/(.*)').headers
    .find(({ key }) => key.toLowerCase() === 'content-security-policy').value;
  const formAction = policy.split(';').map((directive) => directive.trim().split(/\s+/))
    .filter(([name]) => name === 'form-action');
  assert.deepEqual(formAction, [['form-action',
    'https://sandbox.payfast.co.za',
    'https://www.payfast.co.za',
    'https://payment.payfast.io',
  ]]);
});

function browser() {
  const listeners = new Map();
  const forms = [];
  const events = {
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener(name) { listeners.delete(name); },
    emit(name, event = {}) { listeners.get(name)?.(event); },
  };
  const document = {
    ...events,
    body: { append(form) { forms.push(form); } },
    createElement(tag) { return { tag, children: [], append(input) { this.children.push(input); }, submit() { this.submitted = true; }, remove() { this.removed = true; } }; },
  };
  return { document, eventTarget: events, forms, listeners, timeoutMs: 10 };
}

test('checkout accepts only the documented HTTPS POST destinations', async () => {
  for (const action of ['https://sandbox.payfast.co.za/eng/process', 'https://www.payfast.co.za/eng/process']) {
    const page = browser();
    const navigation = submitPayFastForm(action, { m_payment_id: 'BB-TEST', signature: 'signed-value' }, page);
    const form = page.forms[0];
    assert.equal(form.method, 'post');
    assert.equal(form.action, action);
    assert.equal(form.hidden, true);
    assert.deepEqual(form.children.map(({ name, value }) => [name, value]), [['m_payment_id', 'BB-TEST'], ['signature', 'signed-value']]);
    page.eventTarget.emit('pagehide');
    await navigation;
    assert.equal(page.listeners.size, 0);
  }
  for (const action of ['https://payment.payfast.io/eng/process', 'https://www.payfast.co.za.evil.test/eng/process', 'http://www.payfast.co.za/eng/process', 'javascript:alert(1)']) {
    const page = browser();
    assert.throws(() => submitPayFastForm(action, {}, page), /could not be verified/);
    assert.equal(page.forms.length, 0);
  }
});

test('enforced form-action rejection and a stalled navigation reject and remove the submitted form', async () => {
  for (const blocked of [true, false]) {
    const page = browser();
    const navigation = submitPayFastForm('https://www.payfast.co.za/eng/process', {}, page);
    if (blocked) page.document.emit('securitypolicyviolation', { effectiveDirective: 'form-action', disposition: 'enforce' });
    await assert.rejects(navigation, { code: blocked ? 'PAYMENT_NAVIGATION_BLOCKED' : 'PAYMENT_NAVIGATION_TIMEOUT' });
    assert.equal(page.forms[0].removed, true);
    assert.equal(page.listeners.size, 0);
  }
});

test('report-only and unrelated policy events do not report a failed payment navigation', async () => {
  const page = browser();
  const navigation = submitPayFastForm('https://www.payfast.co.za/eng/process', {}, page);
  page.document.emit('securitypolicyviolation', { effectiveDirective: 'form-action', disposition: 'report' });
  page.document.emit('securitypolicyviolation', { effectiveDirective: 'img-src', disposition: 'enforce' });
  page.eventTarget.emit('pagehide');
  await navigation;
});

test('a signed-checkout request is aborted within its deadline and remains recoverable', async () => {
  let signal;
  await assert.rejects(requestJson('/api/create-checkout/', { method: 'POST', body: 'same-order' }, {
    timeoutMs: 5,
    fetchImpl: async (_url, options) => {
      signal = options.signal;
      assert.equal(options.credentials, 'same-origin');
      assert.equal(options.body, 'same-order');
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    },
  }), { code: 'REQUEST_TIMEOUT' });
  assert.equal(signal.aborted, true);
});

test('JSON requests preserve server rejection messages', async () => {
  await assert.rejects(requestJson('/api/create-checkout/', {}, {
    fetchImpl: async () => ({ ok: false, json: async () => ({ error: 'This order has already been paid.' }) }),
  }), /already been paid/);
});
