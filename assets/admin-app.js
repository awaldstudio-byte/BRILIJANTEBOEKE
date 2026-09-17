const preview = new URLSearchParams(location.search).get("preview") === "1";
const money = new Intl.NumberFormat("af-ZA", { style: "currency", currency: "ZAR" });
const shortDate = new Intl.DateTimeFormat("af-ZA", { day: "numeric", month: "short", year: "numeric" });
const $ = (selector) => document.querySelector(selector);
const state = { dashboard: null, progress: [], catalog: null, orders: [] };

$("#today").textContent = new Intl.DateTimeFormat("af-ZA", { day: "numeric", month: "long", year: "numeric" }).format(new Date());
init();

async function init() {
  if (preview) {
    showAdmin({ display_name: "Briljante", role: "administrator" });
    await loadData();
    return;
  }
  try {
    const session = await api("/api/admin-session");
    showAdmin(session.staff);
    await loadData();
  } catch {
    $("#login-view").hidden = false;
  }
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  $("#login-message").textContent = "";
  try {
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const result = await api("/api/admin-login", { method: "POST", body: JSON.stringify(values) });
    showAdmin(result.staff);
    await loadData();
  } catch (error) {
    $("#login-message").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$("#logout-button").addEventListener("click", async () => {
  if (!preview) await api("/api/admin-logout", { method: "POST", body: "{}" }).catch(() => {});
  location.href = "/admin/";
});

function showAdmin(staff) {
  $("#login-view").hidden = true;
  $("#admin-app").hidden = false;
  $("#admin-user").hidden = false;
  $("#user-name").textContent = staff.display_name;
  $("#user-initial").textContent = staff.display_name.charAt(0).toUpperCase();
}

async function loadData() {
  const [dashboard, progress, catalog, orders] = preview
    ? [previewDashboard(), previewProgress(), previewCatalog(), previewOrders()]
    : await Promise.all([api("/api/admin-dashboard"), api("/api/admin-progress"), api("/api/admin-schools"), api("/api/admin-orders")]);
  state.dashboard = dashboard;
  state.progress = progress.progress;
  state.catalog = catalog;
  state.orders = orders.orders;
  renderOverview();
  renderCatalog();
  renderOrders(state.orders);
}

function renderOverview() {
  const summary = state.dashboard.summary;
  $("#metric-grid").innerHTML = [
    ["Aktiewe skole", summary.active_schools, "Huidige opstellings", ""],
    ["Wag vir betaling", summary.pending_orders, "Nog nie deur PayFast bevestig nie", "attention"],
    ["Betaalde bestellings", summary.paid_orders, "PayFast geverifieer", "success"],
    ["Betaalde waarde", money.format(summary.paid_total_cents / 100), "Alle betaalde bestellings", ""],
  ].map(([label, value, note, tone]) => `<article class="metric-card ${tone}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>`).join("");

  $("#progress-rows").innerHTML = state.progress.map((item) => {
    const percentage = item.expected_quantity ? Math.min(100, Math.round(item.paid_quantity / item.expected_quantity * 100)) : 0;
    return `<tr><td>${escapeHtml(item.schools?.name)}</td><td>${escapeHtml(item.ordering_periods?.academic_years?.year)}</td><td>${escapeHtml(item.grades?.name)}</td><td>${item.expected_quantity}</td><td>${item.paid_quantity}</td><td>${item.remaining_quantity}</td><td><span class="progress-track"><span style="width:${percentage}%"></span></span> ${percentage}%</td></tr>`;
  }).join("") || emptyRow(7, "Geen aktiewe graadopstellings nie.");

  $("#period-list").innerHTML = state.dashboard.periods.map((period) => `<article><strong>${escapeHtml(period.schools?.name)}</strong><span>${escapeHtml(period.academic_years?.year)} · ${escapeHtml(period.status === "open" ? "Oop" : "Gesluit")} · sluit ${shortDate.format(new Date(period.closes_at))}</span></article>`).join("") || "<p class='quiet-text'>Geen bestelperiodes nie.</p>";
  $("#recent-order-rows").innerHTML = state.dashboard.recent_orders.map(orderRow).join("") || emptyRow(6, "Geen bestellings nie.");
}

function renderCatalog() {
  const schoolOptions = state.catalog.schools.map((school) => `<option value="${school.id}">${escapeHtml(school.name)}</option>`).join("");
  $("#order-filters [name=school_id]").insertAdjacentHTML("beforeend", schoolOptions);
  $("#report-school").insertAdjacentHTML("beforeend", schoolOptions);
  $("#report-period").insertAdjacentHTML("beforeend", state.catalog.periods.map((period) => {
    const school = state.catalog.schools.find((item) => item.id === period.school_id);
    return `<option value="${period.id}">${escapeHtml(school?.name)} — ${escapeHtml(period.name)}</option>`;
  }).join(""));

  $("#school-list").innerHTML = state.catalog.schools.map((school) => {
    const period = latestPeriod(school.id);
    return `<button type="button" data-edit-school="${school.id}"><strong>${escapeHtml(school.name)}</strong><span>${escapeHtml(period ? `${period.name} · ${period.status}` : "Geen bestelperiode")}</span></button>`;
  }).join("") || "<p class='quiet-text'>Geen skole is nog opgestel nie.</p>";

  $("#school-form [name=academic_year_id]").innerHTML = state.catalog.academic_years.map((year) => `<option value="${year.id}">${year.year}</option>`).join("");
  renderOfferingFields([]);
  resetSchoolForm();
}

function renderOfferingFields(selected) {
  const selectedMap = new Map(selected.map((item) => [item.grade_id, item]));
  $("#offering-fields").innerHTML = state.catalog.grades.map((grade) => {
    const book = state.catalog.books.find((item) => item.grade_id === grade.id);
    const current = selectedMap.get(grade.id);
    return `<label class="offering-row"><input type="checkbox" data-offering-enabled data-grade-id="${grade.id}" data-book-id="${book?.id ?? ""}" ${current?.active ? "checked" : ""} /><span>${escapeHtml(grade.name)}</span><input data-offering-price type="number" min="0" step="0.01" value="${((current?.price_cents ?? book?.default_price_cents ?? 0) / 100).toFixed(2)}" aria-label="${escapeAttribute(grade.name)} prys" /><input data-offering-expected type="number" min="0" step="1" value="${current?.expected_quantity ?? 0}" aria-label="${escapeAttribute(grade.name)} verwagte hoeveelheid" /></label>`;
  }).join("");
}

function renderOrders(orders) {
  $("#all-order-rows").innerHTML = orders.map((order) => `<tr><td>${shortDate.format(new Date(order.created_at))}</td><td>${escapeHtml(order.reference)}</td><td>${escapeHtml(order.schools?.name)}</td><td>${(order.learners ?? []).map((learner) => `${escapeHtml(learner.first_name)} ${escapeHtml(learner.last_name)} (${escapeHtml(learner.grades?.name)})`).join("<br>")}</td><td>${escapeHtml(order.parent_first_name)} ${escapeHtml(order.parent_last_name)}<br><span class="quiet-text">${escapeHtml(order.parent_email)}</span></td><td>${money.format(order.amount_cents / 100)}</td><td>${statusPill(order.status)}</td></tr>`).join("");
  $("#orders-empty").hidden = orders.length > 0;
}

function orderRow(order) {
  return `<tr><td>${shortDate.format(new Date(order.created_at))}</td><td>${escapeHtml(order.reference)}</td><td>${escapeHtml(order.schools?.name)}</td><td>${escapeHtml(order.parent_first_name)} ${escapeHtml(order.parent_last_name)}</td><td>${money.format(order.amount_cents / 100)}</td><td>${statusPill(order.status)}</td></tr>`;
}

function statusPill(status) {
  const labels = { paid: "Betaal", pending_payment: "Wag vir betaling", payment_failed: "Onsuksesvol", cancelled: "Gekanselleer", refunded: "Terugbetaal" };
  const tone = status === "paid" ? "paid" : (["payment_failed", "cancelled"].includes(status) ? "failed" : "");
  return `<span class="status-pill ${tone}">${escapeHtml(labels[status] ?? status)}</span>`;
}

document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
document.querySelectorAll("[data-view-link]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.viewLink)));
function setView(view) {
  document.querySelectorAll(".admin-view").forEach((section) => { section.hidden = section.id !== `view-${view}`; });
  document.querySelectorAll(".admin-nav [data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  scrollTo({ top: 0, behavior: "smooth" });
}

$("#order-filters").addEventListener("submit", async (event) => {
  event.preventDefault();
  const params = new URLSearchParams(Object.fromEntries([...new FormData(event.currentTarget)].filter(([, value]) => value)));
  try {
    const result = preview ? { orders: previewOrders().orders } : await api(`/api/admin-orders?${params}`);
    state.orders = result.orders;
    renderOrders(result.orders);
  } catch (error) {
    alert(error.message);
  }
});

$("#school-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-edit-school]");
  if (!button) return;
  editSchool(button.dataset.editSchool);
});
$("#new-school").addEventListener("click", resetSchoolForm);

function editSchool(schoolId) {
  const school = state.catalog.schools.find((item) => item.id === schoolId);
  const period = latestPeriod(schoolId);
  const form = $("#school-form");
  form.school_id.value = school.id;
  form.period_id.value = period?.id ?? "";
  form.school_name.value = school.name;
  form.school_slug.value = school.slug;
  form.contact_name.value = school.contact_name ?? "";
  form.contact_email.value = school.contact_email ?? "";
  form.academic_year_id.value = period?.academic_year_id ?? state.catalog.academic_years[0]?.id ?? "";
  form.period_name.value = period?.name ?? "Ouersbestellings";
  form.opens_at.value = localDateTime(period?.opens_at);
  form.closes_at.value = localDateTime(period?.closes_at);
  form.period_status.value = period?.status ?? "draft";
  form.class_required.checked = Boolean(period?.class_required);
  form.delivery_note.value = period?.delivery_note ?? "";
  form.replace_link.checked = false;
  $("#school-form-title").textContent = school.name;
  renderOfferingFields(state.catalog.offerings.filter((item) => item.ordering_period_id === period?.id));
  $("#generated-link").hidden = true;
}

function resetSchoolForm() {
  const form = $("#school-form");
  form.reset();
  form.school_id.value = "";
  form.period_id.value = "";
  form.period_name.value = "Ouersbestellings";
  form.period_status.value = "draft";
  form.academic_year_id.value = state.catalog?.academic_years[0]?.id ?? "";
  const now = new Date();
  const close = new Date(now.getTime() + 30 * 86400000);
  form.opens_at.value = localDateTime(now.toISOString());
  form.closes_at.value = localDateTime(close.toISOString());
  $("#school-form-title").textContent = "Nuwe skool";
  $("#school-form-message").textContent = "";
  $("#generated-link").hidden = true;
  if (state.catalog) renderOfferingFields([]);
}

$("#school-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = $("#school-form-message");
  const rows = [...$("#offering-fields").querySelectorAll(".offering-row")];
  const offerings = rows.filter((row) => row.querySelector("[data-offering-enabled]").checked).map((row) => ({
    grade_id: row.querySelector("[data-offering-enabled]").dataset.gradeId,
    book_id: row.querySelector("[data-offering-enabled]").dataset.bookId,
    price_cents: Math.round(Number(row.querySelector("[data-offering-price]").value) * 100),
    expected_quantity: Number(row.querySelector("[data-offering-expected]").value),
  }));
  if (!offerings.length) {
    message.textContent = "Kies ten minste een graad.";
    return;
  }
  if (preview) {
    message.textContent = "Voorskoumodus: geen skooldata is gestoor nie.";
    return;
  }
  const values = Object.fromEntries(new FormData(form));
  const payload = {
    school: { id: values.school_id || null, name: values.school_name, slug: values.school_slug, status: "active", contact_name: values.contact_name, contact_email: values.contact_email, notes: "" },
    period: { id: values.period_id || null, academic_year_id: values.academic_year_id, name: values.period_name, opens_at: new Date(values.opens_at).toISOString(), closes_at: new Date(values.closes_at).toISOString(), status: values.period_status, class_required: form.class_required.checked, delivery_note: values.delivery_note },
    offerings,
    replace_link: form.replace_link.checked,
  };
  const submit = form.querySelector("button[type=submit]");
  submit.disabled = true;
  message.textContent = "";
  try {
    const result = await api("/api/admin-schools", { method: "POST", body: JSON.stringify(payload) });
    message.textContent = "Skoolopstelling is gestoor.";
    if (result.generated_link) {
      $("#generated-link").hidden = false;
      $("#generated-link input").value = result.generated_link;
    }
    state.catalog = await api("/api/admin-schools");
    renderCatalog();
    editSchool(result.school.id);
  } catch (error) {
    message.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

$("#generated-link button").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("#generated-link input").value);
  $("#generated-link button").textContent = "Gekopieer";
});

$("#report-school").addEventListener("change", updateReportLink);
$("#report-period").addEventListener("change", updateReportLink);
function updateReportLink() {
  const params = new URLSearchParams();
  if ($("#report-school").value) params.set("school_id", $("#report-school").value);
  if ($("#report-period").value) params.set("period_id", $("#report-period").value);
  $("#report-download").href = `/api/admin-paid-export?${params}`;
}

function latestPeriod(schoolId) {
  return state.catalog.periods.filter((period) => period.school_id === schoolId).sort((a, b) => Date.parse(b.closes_at) - Date.parse(a.closes_at))[0];
}

function localDateTime(value) {
  if (!value) return "";
  const dateValue = new Date(value);
  const local = new Date(dateValue.getTime() - dateValue.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

async function api(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", headers: { "Content-Type": "application/json", ...(options.headers ?? {}) }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Die versoek kon nie voltooi word nie.");
  return body;
}

function emptyRow(columns, message) { return `<tr><td colspan="${columns}">${escapeHtml(message)}</td></tr>`; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]); }
function escapeAttribute(value) { return escapeHtml(value).replaceAll("`", "&#96;"); }

function previewDashboard() {
  return { summary: { active_schools: 3, pending_orders: 18, paid_orders: 132, paid_total_cents: 4488000 }, periods: [{ name: "Ouersbestellings", status: "open", closes_at: "2026-10-31T21:59:59Z", schools: { name: "Laerskool Voorbeeld" }, academic_years: { year: 2027 } }], recent_orders: previewOrders().orders.slice(0, 4) };
}
function previewProgress() {
  return { progress: [{ id: "o1", expected_quantity: 90, paid_quantity: 74, remaining_quantity: 16, schools: { name: "Laerskool Voorbeeld" }, ordering_periods: { academic_years: { year: 2027 } }, grades: { name: "Graad 3" } }, { id: "o2", expected_quantity: 80, paid_quantity: 58, remaining_quantity: 22, schools: { name: "Laerskool Voorbeeld" }, ordering_periods: { academic_years: { year: 2027 } }, grades: { name: "Graad 4" } }] };
}
function previewCatalog() {
  const schoolId = "7f7e51d9-6464-4cd0-8250-3b946011b645";
  const periodId = "a3290cc2-a98d-42d6-af04-47041be75e2b";
  const grades = [{ id: "5dc50b47-660a-4ff4-8532-a245188ec803", name: "Graad 3", sort_order: 3 }, { id: "dfc52037-530e-436e-9703-c1d80288aee3", name: "Graad 4", sort_order: 4 }, { id: "0b65911f-171c-49f3-8ea5-1b15596fe76b", name: "Graad 5", sort_order: 5 }, { id: "2cd27b9c-b343-42d9-888d-300934eaa181", name: "Graad 6", sort_order: 6 }, { id: "35827cbc-2e68-4dd3-8815-786e3f953739", name: "Graad 7", sort_order: 7 }];
  const books = grades.map((grade, index) => ({ id: `00000000-0000-4000-8000-00000000000${index}`, grade_id: grade.id, title: `${grade.name} Werkboek`, default_price_cents: index ? 34000 : 32000 }));
  return { academic_years: [{ id: "92cd8cf0-5a03-4a48-934a-3d27d1377b9a", year: 2027, label: "2027 Academic Year", is_active: true }], grades, books, schools: [{ id: schoolId, name: "Laerskool Voorbeeld", slug: "laerskool-voorbeeld", status: "active", contact_name: "", contact_email: "" }], periods: [{ id: periodId, school_id: schoolId, academic_year_id: "92cd8cf0-5a03-4a48-934a-3d27d1377b9a", name: "Ouersbestellings", opens_at: "2026-09-01T00:00:00+02:00", closes_at: "2026-10-31T23:59:59+02:00", status: "open", class_required: false, delivery_note: "Boeke word in grootmaat afgelewer." }], offerings: grades.slice(0, 3).map((grade, index) => ({ id: `10000000-0000-4000-8000-00000000000${index}`, school_id: schoolId, ordering_period_id: periodId, grade_id: grade.id, book_id: books[index].id, price_cents: index ? 34000 : 32000, expected_quantity: 90 - index * 10, active: true })), access_links: [] };
}
function previewOrders() {
  const base = { school_id: "7f7e51d9-6464-4cd0-8250-3b946011b645", schools: { name: "Laerskool Voorbeeld" }, ordering_periods: { name: "Ouersbestellings", academic_years: { year: 2027 } } };
  return { orders: [{ ...base, id: "1", reference: "BB-26-7FA912C3", amount_cents: 66000, status: "paid", parent_first_name: "Annelie", parent_last_name: "Jacobs", parent_email: "annelie@example.com", created_at: "2026-09-16T08:30:00Z", learners: [{ first_name: "Mia", last_name: "Jacobs", grades: { name: "Graad 3" } }, { first_name: "Liam", last_name: "Jacobs", grades: { name: "Graad 5" } }] }, { ...base, id: "2", reference: "BB-26-42C81A9E", amount_cents: 34000, status: "pending_payment", parent_first_name: "Pieter", parent_last_name: "Botha", parent_email: "pieter@example.com", created_at: "2026-09-16T09:15:00Z", learners: [{ first_name: "Lea", last_name: "Botha", grades: { name: "Graad 4" } }] }] };
}
