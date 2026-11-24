const checkoutActions = new Set([
  'https://sandbox.payfast.co.za/eng/process',
  'https://www.payfast.co.za/eng/process',
]);

function checkoutError(code, message) {
  return Object.assign(new Error(message), { code });
}

function httpOrigin(value) {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

export async function requestJson(url, options = {}, { fetchImpl = globalThis.fetch, timeoutMs = 30_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      ...options,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...options.headers },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (controller.signal.aborted) throw checkoutError('REQUEST_TIMEOUT', 'The request took too long. Please try again.');
    if (!response.ok) throw new Error(body.error || 'The request could not be completed.');
    return body;
  } catch (error) {
    if (controller.signal.aborted) throw checkoutError('REQUEST_TIMEOUT', 'The request took too long. Please try again.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// A blocked form navigation does not throw from form.submit(). Wait for either
// the page to leave or a bounded, recoverable failure instead of locking the UI.
export function submitPayFastForm(action, fields, {
  document = globalThis.document,
  eventTarget = globalThis,
  timeoutMs = 15_000,
} = {}) {
  if (!checkoutActions.has(action)) throw new Error('The payment address could not be verified.');
  const form = document.createElement('form');
  form.method = 'post';
  form.action = action;
  form.hidden = true;
  for (const [name, value] of Object.entries(fields ?? {})) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.append(input);
  }
  document.body.append(form);
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timer);
      document.removeEventListener('securitypolicyviolation', blocked);
      eventTarget.removeEventListener('pagehide', departed);
      form.remove();
      if (error) reject(error);
      else resolve();
    };
    const blocked = (event) => {
      if (event.effectiveDirective === 'form-action' && event.disposition !== 'report') {
        const error = checkoutError('PAYMENT_NAVIGATION_BLOCKED', 'Your browser blocked the payment page. Check the order status before trying again.');
        const blockedOrigin = httpOrigin(event.blockedURI);
        if (blockedOrigin) {
          error.blockedOrigin = blockedOrigin;
          console.warn('PayFast navigation blocked by form-action policy.', { blockedOrigin });
        }
        finish(error);
      }
    };
    const departed = () => finish();
    const timer = setTimeout(() => finish(checkoutError('PAYMENT_NAVIGATION_TIMEOUT', 'PayFast did not open. Check the order status before trying again.')), timeoutMs);
    document.addEventListener('securitypolicyviolation', blocked);
    eventTarget.addEventListener('pagehide', departed, { once: true });
    try { form.submit(); } catch (error) { finish(error); }
  });
}
