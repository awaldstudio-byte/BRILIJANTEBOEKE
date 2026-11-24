import { requestJson, submitPayFastForm } from './payment-checkout.js';

const query = new URLSearchParams(location.search);
const language = query.get("lang") === "en" ? "en" : "af";
const reference = (query.get("reference") ?? "").toUpperCase();
const checkoutCancelled = query.get("cancelled") === "1";
const money = new Intl.NumberFormat(language === "en" ? "en-ZA" : "af-ZA", { style: "currency", currency: "ZAR" });
let orderToken = sessionStorage.getItem(`briljante_order_token_${reference}`) ?? "";
const fragment = new URLSearchParams(location.hash.slice(1));
let retrying = false;
document.querySelector('#status-retry').addEventListener('click', retryPayment);
window.addEventListener('pageshow', (event) => {
  if (!event.persisted || !orderToken) return;
  retrying = false;
  checkStatus(12);
});

applyLanguage();
if (!orderToken && fragment.get("token")) {
  orderToken = fragment.get("token");
  sessionStorage.setItem(`briljante_order_token_${reference}`, orderToken);
  history.replaceState(null, "", `${location.pathname}?reference=${encodeURIComponent(reference)}&lang=${language}${checkoutCancelled ? "&cancelled=1" : ""}`);
}

document.querySelector("#status-reference").textContent = reference;
if (!reference || !orderToken) show("unknown");
else checkStatus(0);

async function checkStatus(attempt) {
  try {
    const body = await requestJson(`/api/order-status?reference=${encodeURIComponent(reference)}&token=${encodeURIComponent(orderToken)}`);
    show(body.order.status, body.order);
    if (body.order.status === "pending_payment" && attempt < 12) setTimeout(() => checkStatus(attempt + 1), 5000);
  } catch {
    show("unknown");
  }
}

function show(status, order = null) {
  const retry = document.querySelector('#status-retry');
  retry.hidden = !order || !orderToken || !['pending_payment','payment_failed'].includes(status);
  retry.disabled = retrying;
  retry.textContent = tr('Probeer betaling weer','Try payment again');
  const icon = document.querySelector("#status-icon");
  const title = document.querySelector("#status-title");
  const copy = document.querySelector("#status-copy");
  icon.className = "status-icon";
  if (status === "paid") {
    icon.textContent = "✓";
    icon.classList.add("paid");
    const demo = order?.reference?.startsWith('DEMO-');
    if (Number.isSafeInteger(order?.refunded_cents) && order.refunded_cents > 0) {
      title.textContent = tr('Gedeeltelike terugbetaling aangeteken','Partial refund recorded');
      copy.textContent = demo
        ? tr(`Toets slegs: ${money.format(order.refunded_cents/100)} is as terugbetaal aangeteken. Geen geld is gehef of terugbetaal nie.`,`Test only: ${money.format(order.refunded_cents/100)} is recorded as refunded. No money was charged or returned.`)
        : tr(`${money.format(order.refunded_cents/100)} is as terugbetaal aangeteken. Die oorblywende betaalde bedrag is ${money.format(order.remaining_paid_cents/100)}. Kontak Briljante met die bestelverwysing vir navrae.`,`${money.format(order.refunded_cents/100)} is recorded as refunded. The remaining paid amount is ${money.format(order.remaining_paid_cents/100)}. Contact Briljante with the order reference for help.`);
    } else {
      title.textContent = demo ? tr('Demobestelling voltooi','Demo order complete') : tr("Betaling ontvang", "Payment received");
      copy.textContent = demo ? tr('Geen geld is gehef nie. Die bestelling verskyn slegs vir toetsing as betaal.','No money was charged. The order appears as paid for testing only.') : tr("Die betaling is geverifieer en die bestelling is by Briljante se lys van betaalde bestellings gevoeg.", "The payment has been verified and the order has been added to Briljante's list of paid orders.");
    }
  } else if (status === "refunded") {
    icon.textContent = "!";
    title.textContent = tr("Betaling terugbetaal", "Payment refunded");
    copy.textContent = tr("Hierdie bestelling is as terugbetaal gemerk. Kontak Briljante met die bestelverwysing indien u hulp benodig.", "This order is marked as refunded. Contact Briljante with the order reference if you need assistance.");
  } else if (status === "payment_failed") {
    icon.textContent = "!";
    icon.classList.add("failed");
    title.textContent = tr("Betaling nie voltooi nie", "Payment not completed");
    copy.textContent = tr("Die bestelling is nie as betaal gemerk nie. Kies Probeer betaling weer om met dieselfde bestelling voort te gaan. Indien u reeds betaal het, kontak Briljante met die bestelverwysing voordat u weer probeer.", "The order was not marked as paid. Select Try payment again to continue with this same order. If you already paid, contact Briljante with the order reference before trying again.");
  } else if (status === "cancelled") {
    icon.textContent = "!";
    icon.classList.add("failed");
    title.textContent = tr("Betaling gekanselleer", "Payment cancelled");
    copy.textContent = tr("Hierdie bestelling is gekanselleer en kan nie weer hier betaal word nie. Kontak Briljante met die bestelverwysing indien u hulp benodig.", "This order is cancelled and cannot be paid again here. Contact Briljante with the order reference if you need assistance.");
  } else if (status === "pending_payment") {
    if (checkoutCancelled) {
      icon.textContent = "!";
      title.textContent = tr("Betaling nie voltooi nie", "Payment not completed");
      copy.textContent = tr("Die betaalproses is verlaat. Geen betaling is nog vir hierdie bestelling bevestig nie. Indien die betaling reeds voltooi is, sal hierdie bladsy bywerk sodra dit geverifieer is.", "Checkout was left before payment was confirmed. This order is still awaiting verified payment. If you already paid, this page will update when it is verified.");
    } else {
      icon.textContent = "…";
      title.textContent = tr("Betaling word nagegaan", "Checking payment");
      copy.textContent = tr("PayFast se bevestiging kan ’n kort rukkie neem. Hierdie bladsy sal outomaties bywerk.", "PayFast confirmation may take a moment. This page will update automatically.");
    }
  } else {
    icon.textContent = "?";
    icon.classList.add("failed");
    title.textContent = tr("Bestelling kon nie nagegaan word nie", "The order could not be checked");
    copy.textContent = tr("Maak asseblief die statusbladsy oop op dieselfde toestel waarmee die bestelling geplaas is, of kontak Briljante met die bestelverwysing.", "Open the status page on the same device used to place the order, or contact Briljante with the order reference.");
  }
  if (order) {
    document.querySelector("#status-details").hidden = false;
    document.querySelector("#status-school").textContent = order.school?.name ?? "";
    document.querySelector("#status-amount").textContent = money.format(order.amount_cents / 100);
  }
}

async function retryPayment() {
  if (retrying || !orderToken || document.querySelector('#status-retry').hidden) return;
  if (!confirm(tr('Kontroleer eers u betalingsgeskiedenis. Indien u reeds betaal het, kontak Briljante en moenie weer betaal nie. Gaan voort met dieselfde bestelling?', 'Check your payment history first. If you already paid, contact Briljante and do not pay again. Continue with this same order?'))) return;
  retrying = true;
  const button = document.querySelector('#status-retry');
  const message = document.querySelector('#status-retry-message');
  button.disabled = true; message.textContent = '';
  try {
    const checkout = await requestJson('/api/create-checkout/', {method:'POST',body:JSON.stringify({reference,order_token:orderToken,language})});
    await submitPayFastForm(checkout.action, checkout.fields);
  } catch (error) {
    message.textContent = paymentErrorMessage(error);
    retrying = false;
    await checkStatus(12);
  }
}

function paymentErrorMessage(error) {
  if (error.code === 'REQUEST_TIMEOUT') return tr('Die versoek het te lank geneem. Gaan u betalingsgeskiedenis na voordat u weer probeer.', 'The request took too long. Check your payment history before trying again.');
  if (error.code === 'PAYMENT_NAVIGATION_BLOCKED') return tr('U blaaier het die betalingsbladsy geblokkeer. Gaan u betalingsgeskiedenis na voordat u weer probeer.', 'Your browser blocked the payment page. Check your payment history before trying again.');
  if (error.code === 'PAYMENT_NAVIGATION_TIMEOUT') return tr('PayFast het nie oopgemaak nie. Gaan u betalingsgeskiedenis na voordat u weer probeer.', 'PayFast did not open. Check your payment history before trying again.');
  return error.message;
}

function applyLanguage() {
  document.documentElement.lang = language;
  document.title = tr("Bestellingstatus | Briljante Boeke", "Order status | Briljante Boeke");
  const staticCopy = new Map([
    ["Bestellingstatus", "Order status"], ["BESTELLING", "ORDER"], ["Betaling word nagegaan", "Checking payment"],
    ["PayFast se bevestiging kan ’n kort rukkie neem. Hierdie bladsy sal outomaties bywerk.", "PayFast confirmation may take a moment. This page will update automatically."],
    ["Skool", "School"], ["Bedrag", "Amount"], ["Terug na Briljante Boeke", "Back to Briljante Boeke"],
  ]);
  document.querySelectorAll("[data-language]").forEach((button) => {
    button.classList.toggle("active", button.dataset.language === language);
    button.addEventListener("click", () => {
      const params = new URLSearchParams(location.search);
      params.set("lang", button.dataset.language);
      location.search = params;
    });
  });
  if (language !== "en") return;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = node.nodeValue.trim();
    if (staticCopy.has(text)) node.nodeValue = node.nodeValue.replace(text, staticCopy.get(text));
  }
}

function tr(afrikaans, english) { return language === "en" ? english : afrikaans; }
