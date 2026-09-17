const query = new URLSearchParams(location.search);
const reference = (query.get("reference") ?? "").toUpperCase();
const money = new Intl.NumberFormat("af-ZA", { style: "currency", currency: "ZAR" });
let orderToken = sessionStorage.getItem(`briljante_order_token_${reference}`) ?? "";
const fragment = new URLSearchParams(location.hash.slice(1));
if (!orderToken && fragment.get("token")) {
  orderToken = fragment.get("token");
  sessionStorage.setItem(`briljante_order_token_${reference}`, orderToken);
  history.replaceState(null, "", `${location.pathname}?reference=${encodeURIComponent(reference)}`);
}

document.querySelector("#status-reference").textContent = reference;
if (!reference || !orderToken) {
  show("unknown");
} else {
  checkStatus(0);
}

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
    title.textContent = "Betaling ontvang";
    copy.textContent = "Die betaling is geverifieer en die bestelling is by Briljante se betaalde leerderlys gevoeg.";
  } else if (["payment_failed", "cancelled"].includes(status)) {
    icon.textContent = "!";
    icon.classList.add("failed");
    title.textContent = status === "cancelled" ? "Betaling gekanselleer" : "Betaling nie voltooi nie";
    copy.textContent = "Die bestelling is nie as betaal gemerk nie. Gebruik die private skoolskakel om die bestelling weer te probeer.";
  } else if (status === "pending_payment") {
    icon.textContent = "…";
    title.textContent = "Betaling word nagegaan";
    copy.textContent = "PayFast se bevestiging kan ’n kort rukkie neem. Hierdie bladsy sal outomaties bywerk.";
  } else {
    icon.textContent = "?";
    icon.classList.add("failed");
    title.textContent = "Bestelling kon nie nagegaan word nie";
    copy.textContent = "Maak asseblief die statusbladsy oop op dieselfde toestel waarmee die bestelling geplaas is, of kontak Briljante met die bestelverwysing.";
  }
  if (order) {
    document.querySelector("#status-details").hidden = false;
    document.querySelector("#status-school").textContent = order.school?.name ?? "";
    document.querySelector("#status-amount").textContent = money.format(order.amount_cents / 100);
  }
}
