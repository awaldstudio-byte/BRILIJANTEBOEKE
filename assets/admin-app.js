const query = new URLSearchParams(location.search);
const preview = query.get("preview") === "1";
const language = query.get("lang") === "en" ? "en" : "af";
const locale = language === "en" ? "en-ZA" : "af-ZA";
const money = new Intl.NumberFormat(locale, { style: "currency", currency: "ZAR" });
const shortDate = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" });
const $ = (selector) => document.querySelector(selector);
const state = { dashboard: null, progress: [], catalog: null, orders: [], batches: [] };

const englishStatic = new Map([
  ["Administrasie", "Administration"], ["Teken uit", "Sign out"], ["INTERNE TOEGANG", "INTERNAL ACCESS"],
  ["Meld aan", "Sign in"], ["Gebruik die Briljante-administrasierekening.", "Use the Briljante administration account."],
  ["E-posadres", "Email address"], ["Wagwoord", "Password"], ["Oorsig", "Overview"],
  ["Bestellings", "Orders"], ["Skole", "Schools"], ["Aflewering", "Fulfilment"], ["Verslae", "Reports"], ["Interne toegang vir Briljante Boeke", "Internal access for Briljante Boeke"],
  ["BRILJANTE BOEKE ADMINISTRASIE", "BRILJANTE BOEKE ADMINISTRATION"], ["VORDERING", "PROGRESS"],
  ["Vordering", "Progress"],
  ["Bestellings per skool en graad", "Orders by school and grade"], ["Skool", "School"], ["Jaar", "Year"],
  ["Graad", "Grade"], ["Verwag", "Expected"], ["Betaal", "Paid"], ["Uitstaande", "Outstanding"],
  ["BESTELPERIODES", "ORDERING PERIODS"], ["Huidige periodes", "Current periods"], ["ONLANGS", "RECENT"],
  ["Onlangse bestellings", "Recent orders"], ["Sien alle bestellings", "View all orders"], ["Datum", "Date"],
  ["Verwysing", "Reference"], ["Ouer", "Parent"], ["Bedrag", "Amount"], ["Status", "Status"],
  ["REKORDS", "RECORDS"], ["Laai betaalde kinderlys af", "Download paid child list"],
  ["Alle statusse", "All statuses"], ["Wag vir betaling", "Pending payment"], ["Betaling onsuksesvol", "Payment failed"],
  ["Gekanselleer", "Cancelled"], ["Alle skole", "All schools"], ["Filter", "Filter"], ["Kinders", "Children"],
  ["Geen bestellings pas by die filter nie.", "No orders match the filter."], ["OPSTELLING", "SETUP"],
  ["Voeg skool by", "Add school"], ["Bestaande skole", "Existing schools"], ["SKOOL EN BESTELPERIODE", "SCHOOL AND ORDERING PERIOD"],
  ["Nuwe skool", "New school"], ["Skoolnaam", "School name"], ["Skakelfragment", "Link identifier"],
  ["Kontakpersoon", "Contact person"], ["Kontak-e-pos", "Contact email"], ["Akademiese jaar", "Academic year"],
  ["Naam van bestelperiode", "Ordering period name"], ["Open vanaf", "Opens on"], ["Sluit op", "Closes on"],
  ["Konsep", "Draft"], ["Oop", "Open"], ["Gesluit", "Closed"], ["Geargiveer", "Archived"],
  ["Afleweringsnota", "Delivery note"],
  ["Grade, pryse en verwagte hoeveelhede", "Grades, prices and expected quantities"],
  ["Genereer ’n nuwe private skoolkode en herroep die huidige kode", "Generate a new private school code and revoke the current code"],
  ["Stoor skoolopstelling", "Save school setup"], ["Nuwe private skooltoegang", "New private school access"],
  ["Toegangskode", "Access code"], ["Bestelskakel", "Order link"], ["Kopieer kode", "Copy code"],
  ["Kopieer skakel", "Copy link"], ["Berei e-pos voor", "Prepare email"],
  ["Die volledige kode en skakel word slegs een keer gewys. Genereer ’n nuwe kode indien dit verlore raak.", "The complete code and link are shown only once. Generate a new code if they are lost."],
  ["VERSLAE", "REPORTS"], ["Betaalde kinderlyste", "Paid child lists"],
  ["Laai ’n CSV-lys af met die betaalde kinders, grade, ouerbesonderhede en bestelverwysings. Die lys kan per skool of bestelperiode gefilter word.", "Download a CSV containing paid children, grades, parent details and order references. The list can be filtered by school or ordering period."],
  ["Bestelperiode", "Ordering period"], ["Alle periodes", "All periods"], ["Laai CSV af", "Download CSV"],
  ["AFLEWERING", "FULFILMENT"], ["Skoolbestellings", "School orders"],
  ["Skep ’n afleweringsbatch vir een skool op ’n slag. Slegs betaalde boeke wat nog nie in ’n batch is nie, word ingesluit. Latere betalings bly beskikbaar vir die volgende batch.", "Create a fulfilment batch for one school at a time. Only paid books not already in a batch are included. Later payments remain available for the next batch."],
  ["Skep batch", "Create batch"], ["Batchnaam", "Batch name"], ["Skep afleweringsbatch", "Create fulfilment batch"], ["Bestaande batches", "Existing batches"],
]);

applyLanguage();
$("#today").textContent = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(new Date());
init();

async function init() {
  if (preview) {
    showAdmin({ display_name: "Briljante", role: "administrator" });
    await loadData();
    return;
  }
  try {
    const session = await api("/api/admin-dashboard?session=1");
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
  location.href = `/admin/?lang=${language}`;
});

function showAdmin(staff) {
  $("#login-view").hidden = true;
  $("#admin-app").hidden = false;
  $("#admin-user").hidden = false;
  $("#user-name").textContent = staff.display_name;
  $("#user-initial").textContent = staff.display_name.charAt(0).toUpperCase();
}

async function loadData() {
  const [dashboard, progress, catalog, orders, fulfilment] = preview
    ? [previewDashboard(), previewProgress(), previewCatalog(), previewOrders(), previewFulfilment()]
    : await Promise.all([api("/api/admin-dashboard"), api("/api/admin-progress"), api("/api/admin-schools"), api("/api/admin-orders"), api("/api/admin-fulfilment")]);
  state.dashboard = dashboard;
  state.progress = progress.progress;
  state.catalog = catalog;
  state.orders = orders.orders;
  state.batches = fulfilment.batches;
  renderOverview();
  renderCatalog();
  renderOrders(state.orders);
  renderFulfilment();
}

function renderOverview() {
  const summary = state.dashboard.summary;
  $("#metric-grid").innerHTML = [
    [tr("Aktiewe skole", "Active schools"), summary.active_schools, tr("Huidige opstellings", "Current configurations"), "", "schools"],
    [tr("Wag vir betaling", "Pending payment"), summary.pending_orders, tr("Nog nie deur PayFast bevestig nie", "Not yet confirmed by PayFast"), "attention", "pending_payment"],
    [tr("Betaalde bestellings", "Paid orders"), summary.paid_orders, tr("PayFast geverifieer", "Verified by PayFast"), "success", "paid"],
    [tr("Betaalde waarde", "Paid value"), money.format(summary.paid_total_cents / 100), tr("Alle betaalde bestellings", "All paid orders"), "", "paid"],
  ].map(([label, value, note, tone, target]) => `<button class="metric-card ${tone}" type="button" data-metric-target="${target}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></button>`).join("");

  $("#progress-rows").innerHTML = state.progress.map((item) => {
    const percentage = item.expected_quantity ? Math.min(100, Math.round(item.paid_quantity / item.expected_quantity * 100)) : 0;
    return `<tr><td>${escapeHtml(item.schools?.name)}</td><td>${escapeHtml(item.ordering_periods?.academic_years?.year)}</td><td>${escapeHtml(localGrade(item.grades?.name))}</td><td>${item.expected_quantity}</td><td>${item.paid_quantity}</td><td>${item.remaining_quantity}</td><td><span class="progress-track"><span style="width:${percentage}%"></span></span> ${percentage}%</td></tr>`;
  }).join("") || emptyRow(7, tr("Geen aktiewe graadopstellings nie.", "No active grade configurations."));

  $("#period-list").innerHTML = state.dashboard.periods.map((period) => `<article><strong>${escapeHtml(period.schools?.name)}</strong><span>${escapeHtml(period.academic_years?.year)} · ${escapeHtml(period.status === "open" ? tr("Oop", "Open") : tr("Gesluit", "Closed"))} · ${tr("sluit", "closes")} ${shortDate.format(new Date(period.closes_at))}</span></article>`).join("") || `<p class='quiet-text'>${tr("Geen bestelperiodes nie.", "No ordering periods.")}</p>`;
  $("#recent-order-rows").innerHTML = state.dashboard.recent_orders.map(orderRow).join("") || emptyRow(6, tr("Geen bestellings nie.", "No orders."));
}

function renderCatalog() {
  const schoolOptions = state.catalog.schools.map((school) => `<option value="${school.id}">${escapeHtml(school.name)}</option>`).join("");
  $("#order-filters [name=school_id]").insertAdjacentHTML("beforeend", schoolOptions);
  $("#report-school").insertAdjacentHTML("beforeend", schoolOptions);
  $("#report-period").insertAdjacentHTML("beforeend", state.catalog.periods.map((period) => {
    const school = state.catalog.schools.find((item) => item.id === period.school_id);
    return `<option value="${period.id}">${escapeHtml(school?.name)} — ${escapeHtml(localPeriod(period.name))}</option>`;
  }).join(""));

  $("#school-list").innerHTML = state.catalog.schools.map((school) => {
    const period = latestPeriod(school.id);
    const access = period ? state.catalog.access_links.find((item) => item.ordering_period_id === period.id) : null;
    const accessNote = access?.code_hint ? ` · ${tr("kode eindig op", "code ending in")} ${access.code_hint}` : "";
    return `<button type="button" data-edit-school="${school.id}"><strong>${escapeHtml(school.name)}</strong><span>${escapeHtml(period ? `${localPeriod(period.name)} · ${localStatus(period.status)}${accessNote}` : tr("Geen bestelperiode", "No ordering period"))}</span></button>`;
  }).join("") || `<p class='quiet-text'>${tr("Geen skole is nog opgestel nie.", "No schools have been configured yet.")}</p>`;

  $("#school-form [name=academic_year_id]").innerHTML = state.catalog.academic_years.map((year) => `<option value="${year.id}">${year.year}</option>`).join("");
  renderOfferingFields([]);
  resetSchoolForm();
}

function renderOfferingFields(selected) {
  const selectedMap = new Map(selected.map((item) => [item.grade_id, item]));
  $("#offering-fields").innerHTML = state.catalog.grades.map((grade) => {
    const book = state.catalog.books.find((item) => item.grade_id === grade.id);
    const current = selectedMap.get(grade.id);
    return `<label class="offering-row"><input type="checkbox" data-offering-enabled data-grade-id="${grade.id}" data-book-id="${book?.id ?? ""}" ${current?.active ? "checked" : ""} /><span>${escapeHtml(localGrade(grade.name))}</span><input data-offering-price type="number" min="0" step="0.01" value="${((current?.price_cents ?? book?.default_price_cents ?? 0) / 100).toFixed(2)}" aria-label="${escapeAttribute(`${localGrade(grade.name)} ${tr("prys", "price")}`)}" /><input data-offering-expected type="number" min="0" step="1" value="${current?.expected_quantity ?? 0}" aria-label="${escapeAttribute(`${localGrade(grade.name)} ${tr("verwagte hoeveelheid", "expected quantity")}`)}" /></label>`;
  }).join("");
}

function renderOrders(orders) {
  $("#all-order-rows").innerHTML = orders.map((order) => `<tr><td>${shortDate.format(new Date(order.created_at))}</td><td>${escapeHtml(order.reference)}</td><td>${escapeHtml(order.schools?.name)}</td><td>${(order.learners ?? []).map((learner) => `${escapeHtml(learner.first_name)} ${escapeHtml(learner.last_name)} (${escapeHtml(localGrade(learner.grades?.name))})`).join("<br>")}</td><td>${escapeHtml(order.parent_first_name)} ${escapeHtml(order.parent_last_name)}<br><span class="quiet-text">${escapeHtml(order.parent_email)}</span></td><td>${money.format(order.amount_cents / 100)}</td><td>${statusPill(order.status)}</td></tr>`).join("");
  $("#orders-empty").hidden = orders.length > 0;
}

function renderFulfilment() {
  const schoolSelect = $("#batch-form [name=school_id]");
  const periodSelect = $("#batch-form [name=period_id]");
  if (!schoolSelect || !periodSelect) return;
  const selectedSchool = schoolSelect.value || state.catalog.schools[0]?.id || "";
  schoolSelect.innerHTML = state.catalog.schools.map((school) => `<option value="${school.id}" ${school.id === selectedSchool ? "selected" : ""}>${escapeHtml(school.name)}</option>`).join("");
  renderBatchPeriods();
  $("#batch-list").innerHTML = state.batches.map((batch) => {
    const count = batch.fulfilment_batch_items?.[0]?.count ?? 0;
    return `<article><strong>${escapeHtml(batch.schools?.name)} · ${escapeHtml(batch.label)}</strong><span>${escapeHtml(batch.ordering_periods?.academic_years?.year)} · ${escapeHtml(localFulfilmentStatus(batch.status))} · ${count} ${tr("boeke", "books")}</span><div class="batch-actions"><a class="btn btn-outline" href="/api/admin-batch-export?batch_id=${encodeURIComponent(batch.id)}">${tr("Laai batch-CSV af", "Download batch CSV")}</a><select data-batch-status="${batch.id}" aria-label="${tr("Batchstatus", "Batch status")}">${["created", "packing", "ready", "dispatched", "delivered", "cancelled"].map((status) => `<option value="${status}" ${batch.status === status ? "selected" : ""}>${escapeHtml(localFulfilmentStatus(status))}</option>`).join("")}</select></div></article>`;
  }).join("") || `<p class="quiet-text">${tr("Geen afleweringsbatches is nog geskep nie.", "No fulfilment batches have been created yet.")}</p>`;
}

function renderBatchPeriods() {
  const schoolId = $("#batch-form [name=school_id]").value;
  const selected = $("#batch-form [name=period_id]").value;
  $("#batch-form [name=period_id]").innerHTML = state.catalog.periods.filter((period) => period.school_id === schoolId).map((period) => `<option value="${period.id}" ${period.id === selected ? "selected" : ""}>${escapeHtml(localPeriod(period.name))} · ${escapeHtml(period.academic_year_id ? state.catalog.academic_years.find((year) => year.id === period.academic_year_id)?.year : "")}</option>`).join("");
}

function orderRow(order) {
  return `<tr><td>${shortDate.format(new Date(order.created_at))}</td><td>${escapeHtml(order.reference)}</td><td>${escapeHtml(order.schools?.name)}</td><td>${escapeHtml(order.parent_first_name)} ${escapeHtml(order.parent_last_name)}</td><td>${money.format(order.amount_cents / 100)}</td><td>${statusPill(order.status)}</td></tr>`;
}

function statusPill(status) {
  const labels = language === "en"
    ? { paid: "Paid", pending_payment: "Pending payment", payment_failed: "Failed", cancelled: "Cancelled", refunded: "Refunded" }
    : { paid: "Betaal", pending_payment: "Wag vir betaling", payment_failed: "Onsuksesvol", cancelled: "Gekanselleer", refunded: "Terugbetaal" };
  const tone = status === "paid" ? "paid" : (["payment_failed", "cancelled"].includes(status) ? "failed" : "");
  return `<span class="status-pill ${tone}">${escapeHtml(labels[status] ?? status)}</span>`;
}

document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
document.querySelectorAll("[data-view-link]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.viewLink)));
$("#metric-grid").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-metric-target]");
  if (!button) return;
  if (button.dataset.metricTarget === "schools") return setView("schools");
  setView("orders");
  $("#order-filters [name=status]").value = button.dataset.metricTarget;
  $("#order-filters").requestSubmit();
});
function setView(view) {
  document.querySelectorAll(".admin-view").forEach((section) => { section.hidden = section.id !== `view-${view}`; });
  document.querySelectorAll(".admin-nav [data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  scrollTo({ top: 0, behavior: "smooth" });
}

$("#order-filters").addEventListener("submit", async (event) => {
  event.preventDefault();
  const params = new URLSearchParams(Object.fromEntries([...new FormData(event.currentTarget)].filter(([, value]) => value)));
  try {
    const result = preview ? { orders: filterPreviewOrders(params) } : await api(`/api/admin-orders?${params}`);
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

$("#batch-form [name=school_id]").addEventListener("change", renderBatchPeriods);
$("#batch-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = $("#batch-message");
  if (!confirm(tr("Skep ’n vaste afleweringsbatch vir hierdie skool? Latere betalings sal nie by hierdie batch gevoeg word nie.", "Create a fixed fulfilment batch for this school? Later payments will not be added to this batch."))) return;
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  message.textContent = "";
  try {
    if (preview) {
      message.textContent = tr("Voorskoumodus: die voorbeeldbatch is gereed om af te laai.", "Preview mode: the example batch is ready to download.");
      return;
    }
    const values = Object.fromEntries(new FormData(form));
    const result = await api("/api/admin-fulfilment", { method: "POST", body: JSON.stringify(values) });
    message.textContent = tr(`${result.batch.item_count} boeke is in die batch vasgelê.`, `${result.batch.item_count} books were captured in the batch.`);
    state.batches = (await api("/api/admin-fulfilment")).batches;
    renderFulfilment();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$("#batch-list").addEventListener("change", async (event) => {
  const select = event.target.closest("[data-batch-status]");
  if (!select || preview) return;
  const previous = state.batches.find((batch) => batch.id === select.dataset.batchStatus)?.status;
  if (!confirm(tr("Werk die batchstatus op?", "Update the batch status?"))) { select.value = previous; return; }
  try {
    await api("/api/admin-fulfilment", { method: "PATCH", body: JSON.stringify({ id: select.dataset.batchStatus, status: select.value }) });
    state.batches = (await api("/api/admin-fulfilment")).batches;
    renderFulfilment();
  } catch (error) {
    alert(error.message);
    select.value = previous;
  }
});

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
  form.period_name.value = period?.name ?? tr("Ouersbestellings", "Parent orders");
  form.opens_at.value = localDateTime(period?.opens_at);
  form.closes_at.value = localDateTime(period?.closes_at);
  form.period_status.value = period?.status ?? "draft";
  form.class_required.checked = false;
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
  form.period_name.value = tr("Ouersbestellings", "Parent orders");
  form.period_status.value = "draft";
  form.academic_year_id.value = state.catalog?.academic_years[0]?.id ?? "";
  const now = new Date();
  const close = new Date(now.getTime() + 30 * 86400000);
  form.opens_at.value = localDateTime(now.toISOString());
  form.closes_at.value = localDateTime(close.toISOString());
  $("#school-form-title").textContent = tr("Nuwe skool", "New school");
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
    message.textContent = tr("Kies ten minste een graad.", "Select at least one grade.");
    return;
  }
  if (preview) {
    message.textContent = tr("Voorskoumodus: geen skooldata is gestoor nie.", "Preview mode: no school data was saved.");
    showGeneratedAccess({
      generated_code: "BRILJ-2027",
      generated_link: `${location.origin}/order/?school=BRILJ-2027&lang=en`,
    }, form.contact_email.value, form.school_name.value || tr("Nuwe skool", "New school"));
    return;
  }
  const values = Object.fromEntries(new FormData(form));
  const payload = {
    school: { id: values.school_id || null, name: values.school_name, slug: values.school_slug, status: "active", contact_name: values.contact_name, contact_email: values.contact_email, notes: "" },
    period: { id: values.period_id || null, academic_year_id: values.academic_year_id, name: values.period_name, opens_at: new Date(values.opens_at).toISOString(), closes_at: new Date(values.closes_at).toISOString(), status: values.period_status, class_required: false, delivery_note: values.delivery_note },
    offerings,
    replace_link: form.replace_link.checked,
  };
  const submit = form.querySelector("button[type=submit]");
  submit.disabled = true;
  message.textContent = "";
  try {
    const result = await api("/api/admin-schools", { method: "POST", body: JSON.stringify(payload) });
    message.textContent = tr("Skoolopstelling is gestoor.", "School setup was saved.");
    state.catalog = await api("/api/admin-schools");
    renderCatalog();
    editSchool(result.school.id);
    if (result.generated_link) showGeneratedAccess(result, values.contact_email, values.school_name);
  } catch (error) {
    message.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

$("[data-copy-code]").addEventListener("click", async (event) => copyAccess(event.currentTarget, $("[data-generated-code]").value));
$("[data-copy-link]").addEventListener("click", async (event) => copyAccess(event.currentTarget, $("[data-generated-url]").value));

$("#report-school").addEventListener("change", updateReportLink);
$("#report-period").addEventListener("change", updateReportLink);
function updateReportLink() {
  const params = new URLSearchParams();
  if ($("#report-school").value) params.set("school_id", $("#report-school").value);
  if ($("#report-period").value) params.set("period_id", $("#report-period").value);
  $("#report-download").href = `/api/admin-paid-export?${params}`;
}

function showGeneratedAccess(result, contactEmail, schoolName) {
  $("#generated-link").hidden = false;
  $("[data-generated-code]").value = result.generated_code ?? "";
  $("[data-generated-url]").value = result.generated_link ?? "";
  const subject = tr("Briljante Boeke private skoolbestelling", "Briljante Boeke private school ordering");
  const body = tr(
    `Goeiedag\n\nDie private besteltoegang vir ${schoolName} is gereed.\n\nToegangskode: ${result.generated_code}\nBestelskakel: ${result.generated_link}\n\nDeel asseblief hierdie besonderhede slegs met die betrokke ouers.`,
    `Good day\n\nThe private ordering access for ${schoolName} is ready.\n\nAccess code: ${result.generated_code}\nOrder link: ${result.generated_link}\n\nPlease share these details only with the relevant parents.`,
  );
  $("[data-email-access]").href = `mailto:${encodeURIComponent(contactEmail || "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

async function copyAccess(button, value) {
  await navigator.clipboard.writeText(value);
  const original = button.textContent;
  button.textContent = tr("Gekopieer", "Copied");
  setTimeout(() => { button.textContent = original; }, 1800);
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
  if (!response.ok) throw new Error(body.error || tr("Die versoek kon nie voltooi word nie.", "The request could not be completed."));
  return body;
}

function emptyRow(columns, message) { return `<tr><td colspan="${columns}">${escapeHtml(message)}</td></tr>`; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]); }
function escapeAttribute(value) { return escapeHtml(value).replaceAll("`", "&#96;"); }

function applyLanguage() {
  document.documentElement.lang = language;
  document.title = tr("Administrasie | Briljante Boeke", "Administration | Briljante Boeke");
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
  document.querySelector(".admin-nav")?.setAttribute("aria-label", "Administration");
  const search = $("#order-filters [name=search]");
  if (search) search.placeholder = "Reference, surname or email";
}

function tr(afrikaans, english) { return language === "en" ? english : afrikaans; }
function localGrade(value) { return language === "en" ? String(value ?? "").replace(/^Graad\s+/i, "Grade ") : value; }
function localPeriod(value) { return language === "en" && value === "Ouersbestellings" ? "Parent orders" : value; }
function localStatus(value) {
  const labels = language === "en"
    ? { draft: "draft", open: "open", closed: "closed", archived: "archived" }
    : { draft: "konsep", open: "oop", closed: "gesluit", archived: "geargiveer" };
  return labels[value] ?? value;
}

function localFulfilmentStatus(value) {
  const labels = language === "en"
    ? { created: "Created", packing: "Packing", ready: "Ready", dispatched: "Dispatched", delivered: "Delivered", cancelled: "Cancelled" }
    : { created: "Geskep", packing: "Verpak", ready: "Gereed", dispatched: "Versend", delivered: "Afgelewer", cancelled: "Gekanselleer" };
  return labels[value] ?? value;
}

function previewDashboard() {
  return { summary: { active_schools: 3, pending_orders: 18, paid_orders: 132, paid_total_cents: 4488000 }, periods: [{ name: "Ouersbestellings", status: "open", closes_at: "2026-10-31T21:59:59Z", schools: { name: tr("Laerskool Voorbeeld", "Example Primary School") }, academic_years: { year: 2027 } }], recent_orders: previewOrders().orders.slice(0, 4) };
}
function previewProgress() {
  return { progress: [{ id: "o1", expected_quantity: 90, paid_quantity: 74, remaining_quantity: 16, schools: { name: tr("Laerskool Voorbeeld", "Example Primary School") }, ordering_periods: { academic_years: { year: 2027 } }, grades: { name: "Graad 3" } }, { id: "o2", expected_quantity: 80, paid_quantity: 58, remaining_quantity: 22, schools: { name: tr("Laerskool Voorbeeld", "Example Primary School") }, ordering_periods: { academic_years: { year: 2027 } }, grades: { name: "Graad 4" } }] };
}
function previewCatalog() {
  const schoolId = "7f7e51d9-6464-4cd0-8250-3b946011b645";
  const periodId = "a3290cc2-a98d-42d6-af04-47041be75e2b";
  const grades = [{ id: "5dc50b47-660a-4ff4-8532-a245188ec803", name: "Graad 3", sort_order: 3 }, { id: "dfc52037-530e-436e-9703-c1d80288aee3", name: "Graad 4", sort_order: 4 }, { id: "0b65911f-171c-49f3-8ea5-1b15596fe76b", name: "Graad 5", sort_order: 5 }, { id: "2cd27b9c-b343-42d9-888d-300934eaa181", name: "Graad 6", sort_order: 6 }, { id: "35827cbc-2e68-4dd3-8815-786e3f953739", name: "Graad 7", sort_order: 7 }];
  const books = grades.map((grade, index) => ({ id: `00000000-0000-4000-8000-00000000000${index}`, grade_id: grade.id, title: `${grade.name} Werkboek`, default_price_cents: index ? 34000 : 32000 }));
  return { academic_years: [{ id: "92cd8cf0-5a03-4a48-934a-3d27d1377b9a", year: 2027, label: "2027 Academic Year", is_active: true }], grades, books, schools: [{ id: schoolId, name: tr("Laerskool Voorbeeld", "Example Primary School"), slug: "laerskool-voorbeeld", status: "active", contact_name: "", contact_email: "" }], periods: [{ id: periodId, school_id: schoolId, academic_year_id: "92cd8cf0-5a03-4a48-934a-3d27d1377b9a", name: "Ouersbestellings", opens_at: "2026-09-01T00:00:00+02:00", closes_at: "2026-10-31T23:59:59+02:00", status: "open", class_required: false, delivery_note: tr("Boeke word in grootmaat afgelewer.", "Books are delivered in bulk.") }], offerings: grades.slice(0, 3).map((grade, index) => ({ id: `10000000-0000-4000-8000-00000000000${index}`, school_id: schoolId, ordering_period_id: periodId, grade_id: grade.id, book_id: books[index].id, price_cents: index ? 34000 : 32000, expected_quantity: 90 - index * 10, active: true })), access_links: [{ id: "20000000-0000-4000-8000-000000000001", school_id: schoolId, ordering_period_id: periodId, code_hint: "2027" }] };
}
function previewOrders() {
  const base = { school_id: "7f7e51d9-6464-4cd0-8250-3b946011b645", schools: { name: tr("Laerskool Voorbeeld", "Example Primary School") }, ordering_periods: { name: "Ouersbestellings", academic_years: { year: 2027 } } };
  return { orders: [{ ...base, id: "1", reference: "BB-26-7FA912C3", amount_cents: 66000, status: "paid", parent_first_name: "Annelie", parent_last_name: "Jacobs", parent_email: "annelie@example.com", created_at: "2026-09-16T08:30:00Z", learners: [{ first_name: "Mia", last_name: "Jacobs", grades: { name: "Graad 3" } }, { first_name: "Liam", last_name: "Jacobs", grades: { name: "Graad 5" } }] }, { ...base, id: "2", reference: "BB-26-42C81A9E", amount_cents: 34000, status: "pending_payment", parent_first_name: "Pieter", parent_last_name: "Botha", parent_email: "pieter@example.com", created_at: "2026-09-16T09:15:00Z", learners: [{ first_name: "Lea", last_name: "Botha", grades: { name: "Graad 4" } }] }] };
}

function filterPreviewOrders(params) {
  return previewOrders().orders.filter((order) => {
    if (params.get("status") && order.status !== params.get("status")) return false;
    if (params.get("school_id") && order.school_id !== params.get("school_id")) return false;
    const search = params.get("search")?.toLowerCase();
    return !search || [order.reference, order.parent_last_name, order.parent_email].some((value) => value.toLowerCase().includes(search));
  });
}

function previewFulfilment() {
  return {
    batches: [{
      id: "30000000-0000-4000-8000-000000000001",
      school_id: "7f7e51d9-6464-4cd0-8250-3b946011b645",
      ordering_period_id: "a3290cc2-a98d-42d6-af04-47041be75e2",
      label: tr("Oktober 2026", "October 2026"),
      status: "packing",
      schools: { name: tr("Laerskool Voorbeeld", "Example Primary School") },
      ordering_periods: { academic_years: { year: 2027 } },
      fulfilment_batch_items: [{ count: 74 }],
    }],
  };
}
