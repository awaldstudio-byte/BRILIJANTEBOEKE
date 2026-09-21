const query = new URLSearchParams(location.search);
const language = query.get("lang") === "en" ? "en" : "af";
const reference = (query.get("reference") ?? "").toUpperCase();
const money = new Intl.NumberFormat(language === "en" ? "en-ZA" : "af-ZA", { style: "currency", currency: "ZAR" });
let orderToken = sessionStorage.getItem(`briljante_order_token_${reference}`) ?? "";
const fragment = new URLSearchParams(location.hash.slice(1));

applyLanguage();
if (!orderToken && fragment.get("token")) {
  orderToken = fragment.get("token");
  sessionStorage.setItem(`briljante_order_token_${reference}`, orderToken);
  history.replaceState(null, "", `${location.pathname}?reference=${encodeURIComponent(reference)}&lang=${language}`);
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
  const icon = document.querySelector("#status-icon");
  const title = document.querySelector("#status-title");
  const copy = document.querySelector("#status-copy");
  icon.className = "status-icon";
  if (status === "paid") {
    icon.textContent = "✓";
    icon.classList.add("paid");
    title.textContent = tr("Betaling ontvang", "Payment received");
    copy.textContent = tr("Die betaling is geverifieer en die bestelling is by Briljante se betaalde leerderlys gevoeg.", "The payment has been verified and the order has been added to Briljante's paid learner list.");
  } else if (["payment_failed", "cancelled"].includes(status)) {
    icon.textContent = "!";
    icon.classList.add("failed");
    title.textContent = status === "cancelled" ? tr("Betaling gekanselleer", "Payment cancelled") : tr("Betaling nie voltooi nie", "Payment not completed");
    copy.textContent = tr("Die bestelling is nie as betaal gemerk nie. Gebruik die private skoolskakel om die bestelling weer te probeer.", "The order was not marked as paid. Use the private school link to try the payment again.");
  } else if (status === "pending_payment") {
    icon.textContent = "…";
    title.textContent = tr("Betaling word nagegaan", "Checking payment");
    copy.textContent = tr("PayFast se bevestiging kan ’n kort rukkie neem. Hierdie bladsy sal outomaties bywerk.", "PayFast confirmation may take a moment. This page will update automatically.");
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
