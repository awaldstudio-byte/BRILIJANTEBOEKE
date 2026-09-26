const query = new URLSearchParams(location.search);
const language = query.get("lang") === "en" ? "en" : "af";
const schoolToken = query.get("school") ?? query.get("code") ?? "";
const preview = query.get("preview") === "1";
const policyVersion = "2026-09-26";
const locale = language === "en" ? "en-ZA" : "af-ZA";
const money = new Intl.NumberFormat(locale, { style: "currency", currency: "ZAR" });
const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" });
const $ = (selector) => document.querySelector(selector);
const state = {
  step: 1,
  requestId: crypto.randomUUID(),
  learners: [],
  activeLearnerId: null,
  parent: null,
  consent: null,
  config: null,
  order: null,
};

const englishStatic = new Map([
  ["Veilige skoolbestelling", "Secure school order"],
  ["Skoolbesonderhede word gelaai…", "Loading school details…"],
  ["PRIVAAT SKOOLBESTELLING", "PRIVATE SCHOOL ORDER"],
  ["Voer die skoolkode in", "Enter the school access code"],
  ["Gebruik die toegangskode wat deur die skool of Briljante Boeke verskaf is.", "Use the access code supplied by the school or Briljante Boeke."],
  ["Skoolkode", "School access code"],
  ["Gaan voort", "Continue"],
  ["Hierdie skoolskakel is nie beskikbaar nie", "This school link is unavailable"],
  ["Kontroleer asseblief die skakel wat deur die skool verskaf is.", "Check the link or access code supplied by the school."],
  ["Bestel werkboeke", "Order workbooks"],
  ["Kies die toepaslike werkboek vir elke kind. Meer as een kind van dieselfde skool kan in een betaling ingesluit word.", "Choose the correct workbook for each child. More than one child from the same school can be included in one payment."],
  ["Kinders", "Children"],
  ["Besonderhede", "Details"],
  ["Hersien en betaal", "Review and pay"],
  ["BESKIKBAAR VIR HIERDIE SKOOL", "AVAILABLE FOR THIS SCHOOL"],
  ["Werkboeke", "Workbooks"],
  ["HUIDIGE BESTELLING", "CURRENT ORDER"],
  ["Voeg nog ’n kind by", "Add another child"],
  ["Totaal", "Total"],
  ["OUERBESONDERHEDE", "PARENT DETAILS"],
  ["Kontakbesonderhede", "Contact details"],
  ["Naam", "First name"],
  ["Van", "Surname"],
  ["E-posadres", "Email address"],
  ["Selfoonnommer", "Mobile number"],
  ["Ek bevestig dat die besonderhede korrek is, dat ek die", "I confirm that the details are correct and that I have read the"],
  ["privaatheidsbeleid", "privacy policy"],
  ["gelees het, en dat ek die", "and accept the"],
  ["bestel-, aflewerings- en terugbetalingsbepalings", "order, delivery and returns terms"],
  ["Terug", "Back"],
  ["Hersien bestelling", "Review order"],
  ["BESTELLING", "ORDER"],
  ["Bedrag betaalbaar", "Amount payable"],
  ["Die bestelling word slegs as betaal gemerk nadat PayFast se betalingskennisgewing deur die stelsel geverifieer is.", "The order is marked as paid only after the system verifies PayFast's payment notification."],
  ["Betaal met PayFast", "Pay with PayFast"],
  ["Veilige betalings deur PayFast", "Secure payments through PayFast"],
]);

applyLanguage();
init();

async function init() {
  if (!schoolToken && !preview) {
    $("#loading-state").hidden = true;
    $("#access-view").hidden = false;
    return;
  }
  try {
    state.config = preview ? previewConfig() : await api(`/api/public-school?token=${encodeURIComponent(schoolToken)}`);
    if (!state.config.period.open && !preview) throw new Error(tr("Hierdie skool se bestelperiode is nie tans oop nie.", "This school's ordering period is not currently open."));
    if (!state.config.offerings.length) throw new Error(tr("Geen werkboeke is tans vir hierdie skool beskikbaar nie.", "No workbooks are currently available for this school."));
    const first = newLearner(state.config.offerings[0].id);
    state.learners = [first];
    state.activeLearnerId = first.id;
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
  $("#period-summary").textContent = tr(`Bestellings sluit ${date.format(new Date(period.closes_at))}`, `Orders close ${date.format(new Date(period.closes_at))}`);
  $("#book-count").textContent = tr(`${offerings.length} ${offerings.length === 1 ? "graad" : "grade"} beskikbaar`, `${offerings.length} ${offerings.length === 1 ? "grade" : "grades"} available`);
}

function renderBooks() {
  const active = activeLearner();
  $("#book-grid").innerHTML = state.config.offerings.map((item) => {
    const selected = active?.offering_id === item.id;
    return `
      <article class="book-option ${selected ? "selected" : ""}">
        <img src="${escapeAttribute(item.book.cover_path)}" alt="${escapeAttribute(localBook(item.book.title))}" />
        <div class="book-copy">
          <h3>${escapeHtml(localBook(item.book.title))}</h3>
          <strong>${money.format(item.price_cents / 100)}</strong>
          <button class="btn ${selected ? "btn-primary" : "btn-outline"} btn-full" data-select-offering="${item.id}" type="button" aria-pressed="${selected}">${selected ? tr("Gekies", "Selected") : tr("Kies vir geselekteerde kind", "Choose for selected child")}</button>
        </div>
      </article>`;
  }).join("");
}

function renderLearners() {
  $("#learner-count").textContent = String(state.learners.length);
  $("#learner-list").innerHTML = state.learners.map((learner, index) => `
    <article class="learner-card ${learner.id === state.activeLearnerId ? "active" : ""}" data-learner-id="${learner.id}">
      <div class="learner-heading"><strong>${tr("Kind", "Child")} ${index + 1}</strong><button data-remove-learner="${learner.id}" type="button" ${state.learners.length === 1 ? "disabled" : ""}>${tr("Verwyder", "Remove")}</button></div>
      <div class="field-pair">
        <label>${tr("Naam", "First name")}<input data-field="first_name" value="${escapeAttribute(learner.first_name)}" required minlength="2" maxlength="100" autocomplete="off" /></label>
        <label>${tr("Van", "Surname")}<input data-field="last_name" value="${escapeAttribute(learner.last_name)}" required minlength="2" maxlength="100" autocomplete="off" /></label>
      </div>
      <label>${tr("Graad", "Grade")}<select data-field="offering_id" required>${offeringOptions(learner.offering_id)}</select></label>
    </article>
  `).join("");
  updateTotal();
}

function offeringOptions(selected) {
  return state.config.offerings.map((item) => `<option value="${item.id}" ${item.id === selected ? "selected" : ""}>${escapeHtml(localGrade(item.grade.name))} — ${money.format(item.price_cents / 100)}</option>`).join("");
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
    return `<div><span>${escapeHtml(learner.first_name)} ${escapeHtml(learner.last_name)} — ${escapeHtml(localGrade(item.grade.name))}</span><strong>${money.format(item.price_cents / 100)}</strong></div>`;
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

function addLearner() {
  if (state.learners.length >= 10) return;
  const learner = newLearner(state.config.offerings[0].id);
  state.learners.push(learner);
  state.activeLearnerId = learner.id;
  renderBooks();
  renderLearners();
  $("#learner-list").lastElementChild?.querySelector("input")?.focus();
}

function newLearner(offeringId) {
  return { id: crypto.randomUUID(), first_name: "", last_name: "", offering_id: offeringId };
}

function offering(id) {
  return state.config.offerings.find((item) => item.id === id);
}

function activeLearner() {
  return state.learners.find((item) => item.id === state.activeLearnerId) ?? state.learners[0];
}

$("#access-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const code = String(data.get("access_code") ?? "").trim().toUpperCase().replace(/\s+/g, "");
  const params = new URLSearchParams(location.search);
  params.set("school", code);
  params.set("lang", language);
  location.href = `/order/?${params}`;
});

$("#book-grid").addEventListener("click", (event) => {
  const button = event.target.closest("[data-select-offering]");
  if (!button) return;
  const learner = activeLearner();
  if (!learner) return;
  learner.offering_id = button.dataset.selectOffering;
  renderBooks();
  renderLearners();
});

$("#learner-list").addEventListener("focusin", activateLearnerFromEvent);
$("#learner-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-learner]");
  if (button && state.learners.length > 1) {
    state.learners = state.learners.filter((item) => item.id !== button.dataset.removeLearner);
    if (!state.learners.some((item) => item.id === state.activeLearnerId)) state.activeLearnerId = state.learners[0].id;
    renderBooks();
    renderLearners();
    return;
  }
  activateLearnerFromEvent(event);
});

$("#learner-list").addEventListener("input", (event) => {
  const card = event.target.closest("[data-learner-id]");
  const learner = state.learners.find((item) => item.id === card?.dataset.learnerId);
  if (!learner || !event.target.dataset.field) return;
  learner[event.target.dataset.field] = event.target.value;
  state.activeLearnerId = learner.id;
  updateTotal();
  if (event.target.dataset.field === "offering_id") renderBooks();
});

function activateLearnerFromEvent(event) {
  const card = event.target.closest("[data-learner-id]");
  if (!card || card.dataset.learnerId === state.activeLearnerId) return;
  state.activeLearnerId = card.dataset.learnerId;
  renderBooks();
  document.querySelectorAll(".learner-card").forEach((item) => item.classList.toggle("active", item.dataset.learnerId === state.activeLearnerId));
}

$("#add-learner").addEventListener("click", addLearner);
$("#continue-details").addEventListener("click", () => {
  const fields = [...$("#learner-list").querySelectorAll("input, select")];
  const invalid = fields.find((field) => !field.checkValidity());
  if (invalid) {
    invalid.reportValidity();
    $("#learner-error").textContent = tr("Voltooi asseblief die besonderhede vir elke kind.", "Complete the details for each child.");
    return;
  }
  $("#learner-error").textContent = "";
  setStep(2);
});

$("#parent-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!event.currentTarget.reportValidity()) return;
  const data = new FormData(event.currentTarget);
  state.parent = { first_name: data.get("first_name"), last_name: data.get("last_name"), email: data.get("email"), mobile: data.get("mobile") };
  state.consent = { accepted: data.get("consent") === "on", policy_version: policyVersion };
  setStep(3);
});

document.querySelectorAll("[data-back]").forEach((button) => button.addEventListener("click", () => setStep(Number(button.dataset.back))));
$("#pay-button").addEventListener("click", startPayment);

async function startPayment() {
  const button = $("#pay-button");
  const message = $("#payment-message");
  if (preview) {
    message.textContent = tr("Voorskoumodus: geen bestelling, persoonlike data of betaling is gestuur nie.", "Preview mode: no order, personal information or payment was sent.");
    return;
  }
  button.disabled = true;
  button.textContent = tr("Bestelling word geskep…", "Creating order…");
  message.textContent = "";
  try {
    if (!state.order) {
      const result = await api("/api/orders", { method: "POST", body: JSON.stringify({ school_token: schoolToken, request_id: state.requestId, parent: state.parent, consent: state.consent, learners: state.learners.map(({ id, ...learner }) => learner) }) });
      state.order = result.order;
      sessionStorage.setItem(`briljante_order_token_${state.order.reference}`, state.order.access_token);
    }
    button.textContent = tr("PayFast word oopgemaak…", "Opening PayFast…");
    const checkout = await api("/api/create-checkout", { method: "POST", body: JSON.stringify({ reference: state.order.reference, order_token: state.order.access_token, language }) });
    submitExternalForm(checkout.action, checkout.fields);
  } catch (error) {
    message.textContent = state.order ? `${tr("Bestelling", "Order")} ${state.order.reference} ${tr("is geskep.", "was created.")} ${error.message}` : error.message;
    button.disabled = false;
    button.textContent = tr("Betaal met PayFast", "Pay with PayFast");
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
  if (!response.ok) throw new Error(body.error || tr("Die versoek kon nie voltooi word nie.", "The request could not be completed."));
  return body;
}

function applyLanguage() {
  document.documentElement.lang = language;
  document.title = tr("Bestel werkboeke | Briljante Boeke", "Order workbooks | Briljante Boeke");
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
    if (englishStatic.has(text)) node.nodeValue = node.nodeValue.replace(text, englishStatic.get(text));
  }
  document.querySelector(".step-progress")?.setAttribute("aria-label", "Order process");
}

function tr(afrikaans, english) { return language === "en" ? english : afrikaans; }
function localGrade(value) { return language === "en" ? String(value ?? "").replace(/^Graad\s+/i, "Grade ") : value; }
function localBook(value) { return language === "en" ? String(value ?? "").replace(/^Graad\s+/i, "Grade ").replace(/Werkboek$/i, "Workbook") : value; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]); }
function escapeAttribute(value) { return escapeHtml(value).replaceAll("`", "&#96;"); }

function previewConfig() {
  return {
    school: { slug: "laerskool-voorbeeld", name: language === "en" ? "Example Primary School" : "Laerskool Voorbeeld" },
    period: { name: "Ouersbestellings", academic_year: { year: 2027 }, opens_at: "2026-09-01T00:00:00+02:00", closes_at: "2026-10-31T23:59:59+02:00", class_required: false, delivery_note: tr("Boeke word in grootmaat by die skool afgelewer.", "Books are delivered to the school in bulk."), open: true },
    offerings: [
      { id: "2de1d6a7-02b5-41e0-b9ee-b276c4d65041", price_cents: 32000, expected_quantity: 90, grade: { name: "Graad 3" }, book: { title: "Graad 3 Werkboek", cover_path: "/assets/images/815-Book-Cover-Graad-3.png" } },
      { id: "a96d84c2-6d02-4939-8011-1c293aa0a2e3", price_cents: 34000, expected_quantity: 80, grade: { name: "Graad 4" }, book: { title: "Graad 4 Werkboek", cover_path: "/assets/images/820-Book-Cover-Graad-4.png" } },
      { id: "ec3e1131-5fe0-4516-bc90-2f1b2757d15c", price_cents: 34000, expected_quantity: 75, grade: { name: "Graad 5" }, book: { title: "Graad 5 Werkboek", cover_path: "/assets/images/825-Book-Cover-Graad-5-1.png" } },
    ],
  };
}
