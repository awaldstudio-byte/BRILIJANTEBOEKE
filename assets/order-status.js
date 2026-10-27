const query = new URLSearchParams(location.search);
const language = query.get("lang") === "en" ? "en" : "af";
const reference = (query.get("reference") ?? "").toUpperCase();
const checkoutCancelled = query.get("cancelled") === "1";
const money = new Intl.NumberFormat(language === "en" ? "en-ZA" : "af-ZA", { style: "currency", currency: "ZAR" });
let orderToken = sessionStorage.getItem(`briljante_order_token_${reference}`) ?? "";
const fragment = new URLSearchParams(location.hash.slice(1));
let retrying = false;
document.querySelector('#status-retry').addEventListener('click', retryPayment);

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
    const response = await fetch(`/api/order-status?reference=${encodeURIComponent(reference)}&token=${encodeURIComponent(orderToken)}`, { credentials: "same-origin" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
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
    title.textContent = demo ? tr('Demobestelling voltooi','Demo order complete') : tr("Betaling ontvang", "Payment received");
    copy.textContent = demo ? tr('Geen geld is gehef nie. Die bestelling verskyn slegs vir toetsing as betaal.','No money was charged. The order appears as paid for testing only.') : tr("Die betaling is geverifieer en die bestelling is by Briljante se betaalde leerderlys gevoeg.", "The payment has been verified and the order has been added to Briljante's paid learner list.");
  } else if (status === "refunded") {
    icon.textContent = "!";
    title.textContent = tr("Betaling terugbetaal", "Payment refunded");
    copy.textContent = tr("Hierdie bestelling is as terugbetaal gemerk. Kontak Briljante met die bestelverwysing indien u hulp benodig.", "This order is marked as refunded. Contact Briljante with the order reference if you need assistance.");
  } else if (["payment_failed", "cancelled"].includes(status)) {
    icon.textContent = "!";
    icon.classList.add("failed");
    title.textContent = status === "cancelled" ? tr("Betaling gekanselleer", "Payment cancelled") : tr("Betaling nie voltooi nie", "Payment not completed");
    copy.textContent = tr("Die bestelling is nie as betaal gemerk nie. Gebruik die private skoolskakel om die bestelling weer te probeer.", "The order was not marked as paid. Use the private school link to try the payment again.");
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
    const response = await fetch('/api/create-checkout/', {method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({reference,order_token:orderToken,language})});
    const checkout = await response.json();
    if (!response.ok) { await checkStatus(12); throw new Error(checkout.error || tr('Betaling kon nie oopgemaak word nie.','Payment could not be opened.')); }
    if (!['https://sandbox.payfast.co.za/eng/process','https://www.payfast.co.za/eng/process'].includes(checkout.action)) throw new Error(tr('Die betalingsadres kon nie geverifieer word nie.','The payment address could not be verified.'));
    const form = document.createElement('form'); form.method='post'; form.action=checkout.action;
    for (const [name,value] of Object.entries(checkout.fields || {})) { const input=document.createElement('input');input.type='hidden';input.name=name;input.value=value;form.append(input); }
    document.body.append(form); form.submit();
  } catch (error) { message.textContent=error.message; retrying=false; button.disabled=false; }
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
