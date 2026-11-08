import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = await readFile(new URL("../assets/order-status.js", import.meta.url), "utf8");

async function statusPage({ statuses = ["pending_payment"], language = "en", cancelled = "1", token = true, fragment = "", orderFields = {} } = {}) {
  const elements = new Map();
  const timers = [];
  const requests = [];
  const historyUrls = [];
  const forms = [];
  const storage = new Map(token ? [["briljante_order_token_BB-26-ABC12345", "private-order-access-token"]] : []);
  let requestIndex = 0;
  const document = {
    documentElement: {}, body: {append(form){forms.push(form);}},
    createElement(tag){return {tag,children:[],append(child){this.children.push(child);},submit(){this.submitted=true;}};},
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, { textContent: "", className: "", hidden: true, classList: { add() {} }, addEventListener(event,handler){this[event]=handler;} });
      return elements.get(selector);
    },
    querySelectorAll() { return []; },
    createTreeWalker() { return { nextNode() { return false; } }; },
  };
  runInNewContext(source, {
    URLSearchParams, Intl, document, confirm:()=>true, NodeFilter: { SHOW_TEXT: 4 },
    location: { pathname: "/order/status/", search: `?reference=BB-26-ABC12345&lang=${language}&cancelled=${cancelled}`, hash: fragment },
    sessionStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    history: { replaceState: (_state, _title, url) => historyUrls.push(url) },
    setTimeout: (callback) => timers.push(callback),
    fetch: async (url, options) => {
      requests.push({ url, options });
      if(options.method==='POST') return {ok:true,json:async()=>({action:'https://sandbox.payfast.co.za/eng/process',fields:{m_payment_id:'BB-26-ABC12345',signature:'provider-signature'}})};
      const status = statuses[Math.min(requestIndex++, statuses.length - 1)];
      return { ok: true, json: async () => ({ order: Object.freeze({ status, reference: "BB-26-ABC12345", amount_cents: 66000, school: { name: "Test School" }, ...orderFields }) }) };
    },
  });
  await new Promise(setImmediate);
  return { elements, timers, requests, historyUrls, forms };
}

test('a partially refunded order states the refunded and remaining amounts without offering another payment', async()=>{
  for(const language of ['en','af']){
    const page=await statusPage({statuses:['paid'],language,orderFields:{refunded_cents:32000,remaining_paid_cents:34000}});
    assert.equal(page.elements.get('#status-title').textContent,language==='en'?'Partial refund recorded':'Gedeeltelike terugbetaling aangeteken');
    assert.match(page.elements.get('#status-copy').textContent,/320/);assert.match(page.elements.get('#status-copy').textContent,/340/);
    assert.equal(page.elements.get('#status-retry').hidden,true);
  }
});

test("cancel return explains unfinished checkout in both languages without changing the order", async () => {
  for (const language of ["en", "af"]) {
    const page = await statusPage({ language });
    assert.equal(page.elements.get("#status-title").textContent, language === "en" ? "Payment not completed" : "Betaling nie voltooi nie");
    assert.match(page.elements.get("#status-copy").textContent, language === "en" ? /still awaiting verified payment/ : /Geen betaling is nog/);
    assert.equal(page.timers.length, 1, "continue checking for a delayed verified payment");
    assert.equal(page.requests.length, 1);
    assert.match(page.requests[0].url, /^\/api\/order-status\?/);
    assert.equal(page.requests[0].options.method, undefined, "status lookup stays a read-only GET");
  }
});

test("a delayed paid result replaces cancel-return messaging", async () => {
  const page = await statusPage({ statuses: ["pending_payment", "paid"] });
  assert.equal(page.elements.get("#status-title").textContent, "Payment not completed");
  await page.timers.shift()();
  assert.equal(page.elements.get("#status-title").textContent, "Payment received");
  assert.match(page.elements.get("#status-copy").textContent, /payment has been verified/);
  assert.equal(page.timers.length, 0);
});

test("stored terminal payment states take priority over the cancel return flag", async () => {
  for (const [status, title] of [["paid", "Payment received"], ["refunded", "Payment refunded"], ["payment_failed", "Payment not completed"], ["cancelled", "Payment cancelled"]]) {
    const page = await statusPage({ statuses: [status] });
    assert.equal(page.elements.get("#status-title").textContent, title);
    assert.doesNotMatch(page.elements.get("#status-copy").textContent, /still awaiting verified payment/);
    assert.equal(page.timers.length, 0);
  }
});

test("ordinary pending payment retains its confirmation message in both languages", async () => {
  for (const language of ["en", "af"]) {
    const page = await statusPage({ language, cancelled: "0" });
    assert.equal(page.elements.get("#status-title").textContent, language === "en" ? "Checking payment" : "Betaling word nagegaan");
    assert.equal(page.timers.length, 1);
  }
});

test("cancel return does not reveal a status without the private order token", async () => {
  const page = await statusPage({ token: false });
  assert.equal(page.elements.get("#status-title").textContent, "The order could not be checked");
  assert.equal(page.requests.length, 0);
  assert.equal(page.elements.get('#status-retry').hidden,true);
});

test('retry is offered only for an authenticated payable order', async()=>{
  for(const status of ['pending_payment','payment_failed','paid','refunded','cancelled']){
    const page=await statusPage({statuses:[status]});
    assert.equal(page.elements.get('#status-retry').hidden,!['pending_payment','payment_failed'].includes(status));
  }
});
test('failed-payment guidance reuses the order while cancelled orders direct users to support in both languages', async()=>{
  for(const language of ['en','af']){
    const failed=await statusPage({statuses:['payment_failed'],language});
    const cancelled=await statusPage({statuses:['cancelled'],language});
    assert.match(failed.elements.get('#status-copy').textContent,language==='en'?/Select Try payment again.*same order/:/Kies Probeer betaling weer.*dieselfde bestelling/);
    assert.match(failed.elements.get('#status-copy').textContent,language==='en'?/If you already paid, contact Briljante/:/Indien u reeds betaal het, kontak Briljante/);
    assert.match(cancelled.elements.get('#status-copy').textContent,language==='en'?/cannot be paid again here.*Contact Briljante/:/kan nie weer hier betaal word nie.*Kontak Briljante/);
    for(const page of [failed,cancelled]) assert.doesNotMatch(page.elements.get('#status-copy').textContent,/private school link|private skoolskakel/);
  }
});
test('retry reuses the saved private order and never creates another order or sends its token to PayFast',async()=>{
  const page=await statusPage(); await page.elements.get('#status-retry').click();
  assert.equal(page.requests.length,2); assert.equal(page.requests[1].url,'/api/create-checkout/');
  const body=JSON.parse(page.requests[1].options.body);assert.equal(body.reference,'BB-26-ABC12345');assert.equal(body.order_token,'private-order-access-token');
  assert.equal(page.forms.length,1);assert.equal(page.forms[0].submitted,true);assert.equal(page.forms[0].action,'https://sandbox.payfast.co.za/eng/process');
  assert.equal(JSON.stringify(page.forms).includes('private-order-access-token'),false);
});

test("cleaning an email token fragment retains the cancellation hint", async () => {
  const page = await statusPage({ token: false, fragment: "#token=private-order-access-token" });
  assert.deepEqual(page.historyUrls, ["/order/status/?reference=BB-26-ABC12345&lang=en&cancelled=1"]);
  assert.equal(page.elements.get("#status-title").textContent, "Payment not completed");
});
