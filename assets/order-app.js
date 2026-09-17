const query = new URLSearchParams(location.search);
const schoolToken = query.get("school") ?? "";
const preview = query.get("preview") === "1";
const money = new Intl.NumberFormat("af-ZA", { style: "currency", currency: "ZAR" });
const date = new Intl.DateTimeFormat("af-ZA", { day: "numeric", month: "long", year: "numeric" });
const $ = (selector) => document.querySelector(selector);
const state = {
  step: 1,
  requestId: crypto.randomUUID(),
  learners: [],
  parent: null,
  config: null,
  order: null,
};

init();

async function init() {
  try {
    if (!schoolToken && !preview) throw new Error("Kontroleer asseblief die skakel wat deur die skool verskaf is.");
    state.config = preview ? previewConfig() : await api(`/api/public-school?token=${encodeURIComponent(schoolToken)}`);
    if (!state.config.period.open && !preview) {
      throw new Error("Hierdie skool se bestelperiode is nie tans oop nie.");
    }
    if (!state.config.offerings.length) throw new Error("Geen werkboeke is tans vir hierdie skool beskikbaar nie.");
    state.learners = [newLearner(state.config.offerings[0].id)];
    renderBase();
    renderBooks();
    renderLearners();
    setStep(1, false);
    $("#loading-state").hidden = true;
    $("#order-app").hidden = false;
  } catch (error) {
    $("#loading-state").hidden = true;
    $("#error-state").hidden = false;
    $("#error-message").textContent = error.message;
  }
}

function renderBase() {
  const { school, period, offerings } = state.config;
  $("#school-name").textContent = school.name;
  $("#school-initial").textContent = school.name.trim().charAt(0).toUpperCase();
  $("#period-summary").textContent = `Bestellings sluit ${date.format(new Date(period.closes_at))}`;
  $("#book-count").textContent = `${offerings.length} ${offerings.length === 1 ? "graad" : "grade"} beskikbaar`;
}

function renderBooks() {
  $("#book-grid").innerHTML = state.config.offerings.map((offering) => `
    <article class="book-option">
      <img src="${escapeAttribute(offering.book.cover_path)}" alt="${escapeAttribute(offering.book.title)}" />
      <div class="book-copy">
        <h3>${escapeHtml(offering.book.title)}</h3>
        <strong>${money.format(offering.price_cents / 100)}</strong>
        <button class="btn btn-outline btn-full" data-add-offering="${offering.id}" type="button">Kies vir ’n leerder</button>
      </div>
    </article>
  `).join("");
}

function renderLearners() {
  $("#learner-count").textContent = String(state.learners.length);
  $("#learner-list").innerHTML = state.learners.map((learner, index) => `
    <article class="learner-card" data-learner-id="${learner.id}">
      <div class="learner-heading"><strong>Leerder ${index + 1}</strong><button data-remove-learner="${learner.id}" type="button" ${state.learners.length === 1 ? "disabled" : ""}>Verwyder</button></div>
      <div class="field-pair">
        <label>Naam<input data-field="first_name" value="${escapeAttribute(learner.first_name)}" required minlength="2" maxlength="100" autocomplete="off" /></label>
        <label>Van<input data-field="last_name" value="${escapeAttribute(learner.last_name)}" required minlength="2" maxlength="100" autocomplete="off" /></label>
      </div>
      <label>Graad<select data-field="offering_id" required>${offeringOptions(learner.offering_id)}</select></label>
      <label>Klas ${state.config.period.class_required ? "" : "<small>(opsioneel)</small>"}<input data-field="class_name" value="${escapeAttribute(learner.class_name)}" ${state.config.period.class_required ? "required" : ""} maxlength="30" placeholder="bv. 3A" autocomplete="off" /></label>
    </article>
  `).join("");
  updateTotal();
}

function offeringOptions(selected) {
  return state.config.offerings.map((offering) => `<option value="${offering.id}" ${offering.id === selected ? "selected" : ""}>${escapeHtml(offering.grade.name)} — ${money.format(offering.price_cents / 100)}</option>`).join("");
}

function orderTotal() {
  return state.learners.reduce((total, learner) => total + (offering(learner.offering_id)?.price_cents ?? 0), 0);
}

function updateTotal() {
  $("#order-total").textContent = money.format(orderTotal() / 100);
}

function renderReview() {
  $("#review-lines").innerHTML = state.learners.map((learner) => {
    const item = offering(learner.offering_id);
    return `<div><span>${escapeHtml(learner.first_name)} ${escapeHtml(learner.last_name)} — ${escapeHtml(item.grade.name)}</span><strong>${money.format(item.price_cents / 100)}</strong></div>`;
  }).join("");
  $("#review-total").textContent = money.format(orderTotal() / 100);
}

function setStep(step, scroll = true) {
  state.step = step;
  for (const number of [1, 2, 3]) {
    $(`#step-${number}`).hidden = number !== step;
    const indicator = document.querySelector(`[data-step-indicator="${number}"]`);
    indicator.classList.toggle("active", number === step);
    indicator.classList.toggle("complete", number < step);
  }
  if (step === 3) renderReview();
  if (scroll) scrollTo({ top: 0, behavior: "smooth" });
}

function addLearner(offeringId = state.config.offerings[0].id) {
  if (state.learners.length >= 10) return;
  state.learners.push(newLearner(offeringId));
  renderLearners();
  $("#learner-list").lastElementChild?.querySelector("input")?.focus();
}

function newLearner(offeringId) {
  return { id: crypto.randomUUID(), first_name: "", last_name: "", offering_id: offeringId, class_name: "" };
}

function offering(id) {
  return state.config.offerings.find((item) => item.id === id);
}

$("#book-grid").addEventListener("click", (event) => {
  const button = event.target.closest("[data-add-offering]");
  if (button) addLearner(button.dataset.addOffering);
});

$("#learner-list").addEventListener("input", (event) => {
  const card = event.target.closest("[data-learner-id]");
  const learner = state.learners.find((item) => item.id === card?.dataset.learnerId);
  if (!learner || !event.target.dataset.field) return;
  learner[event.target.dataset.field] = event.target.value;
  updateTotal();
});

$("#learner-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-learner]");
  if (!button || state.learners.length === 1) return;
  state.learners = state.learners.filter((item) => item.id !== button.dataset.removeLearner);
  renderLearners();
});

$("#add-learner").addEventListener("click", () => addLearner());
$("#continue-details").addEventListener("click", () => {
  const fields = [...$("#learner-list").querySelectorAll("input, select")];
  const invalid = fields.find((field) => !field.checkValidity());
  if (invalid) {
    invalid.reportValidity();
    $("#learner-error").textContent = "Voltooi asseblief die besonderhede vir elke leerder.";
    return;
  }
  $("#learner-error").textContent = "";
  setStep(2);
});

$("#parent-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!event.currentTarget.reportValidity()) return;
  const data = new FormData(event.currentTarget);
  state.parent = {
    first_name: data.get("first_name"),
    last_name: data.get("last_name"),
    email: data.get("email"),
    mobile: data.get("mobile"),
  };
  setStep(3);
});

document.querySelectorAll("[data-back]").forEach((button) => button.addEventListener("click", () => setStep(Number(button.dataset.back))));
$("#pay-button").addEventListener("click", startPayment);

async function startPayment() {
  const button = $("#pay-button");
  const message = $("#payment-message");
  if (preview) {
    message.textContent = "Voorskoumodus: geen bestelling, persoonlike data of betaling is gestuur nie.";
    return;
  }
  button.disabled = true;
  button.textContent = "Bestelling word geskep…";
  message.textContent = "";
  try {
    if (!state.order) {
      const result = await api("/api/orders", {
        method: "POST",
        body: JSON.stringify({ school_token: schoolToken, request_id: state.requestId, parent: state.parent, learners: state.learners.map(({ id, ...learner }) => learner) }),
      });
      state.order = result.order;
      sessionStorage.setItem(`briljante_order_token_${state.order.reference}`, state.order.access_token);
    }
    button.textContent = "PayFast word oopgemaak…";
    const checkout = await api("/api/create-checkout", {
      method: "POST",
      body: JSON.stringify({ reference: state.order.reference, order_token: state.order.access_token }),
    });
    submitExternalForm(checkout.action, checkout.fields);
  } catch (error) {
    message.textContent = state.order ? `Bestelling ${state.order.reference} is geskep. ${error.message}` : error.message;
    button.disabled = false;
    button.textContent = "Betaal met PayFast";
  }
}

function submitExternalForm(action, fields) {
  const form = document.createElement("form");
  form.method = "post";
  form.action = action;
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.append(input);
  }
  document.body.append(form);
  form.submit();
}

async function api(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", headers: { "Content-Type": "application/json", ...(options.headers ?? {}) }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Die versoek kon nie voltooi word nie.");
  return body;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

function previewConfig() {
  return {
    school: { slug: "laerskool-voorbeeld", name: "Laerskool Voorbeeld" },
    period: { name: "Ouersbestellings", academic_year: { year: 2027 }, opens_at: "2026-09-01T00:00:00+02:00", closes_at: "2026-10-31T23:59:59+02:00", class_required: false, delivery_note: "Boeke word in grootmaat by die skool afgelewer.", open: true },
    offerings: [
      { id: "2de1d6a7-02b5-41e0-b9ee-b276c4d65041", price_cents: 32000, expected_quantity: 90, grade: { name: "Graad 3" }, book: { title: "Graad 3 Werkboek", cover_path: "/assets/images/815-Book-Cover-Graad-3.png" } },
      { id: "a96d84c2-6d02-4939-8011-1c293aa0a2e3", price_cents: 34000, expected_quantity: 80, grade: { name: "Graad 4" }, book: { title: "Graad 4 Werkboek", cover_path: "/assets/images/820-Book-Cover-Graad-4.png" } },
      { id: "ec3e1131-5fe0-4516-bc90-2f1b2757d15c", price_cents: 34000, expected_quantity: 75, grade: { name: "Graad 5" }, book: { title: "Graad 5 Werkboek", cover_path: "/assets/images/825-Book-Cover-Graad-5-1.png" } },
    ],
  };
}
