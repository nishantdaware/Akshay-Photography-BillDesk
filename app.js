"use strict";

const SETTINGS_KEY = "frame-field-settings-v1";
const REFRESH_INTERVAL_MS = 60000;
const defaults = {
  apiUrl: "https://script.google.com/macros/s/AKfycbz3BLp2ARP4Y5gJY_KFyPijmj48LsJj5FwzYvlo6nn5Yf20lsFNJVBEEDjwgWtwaw51gQ/exec",
  apiKey: "", studioName: "Akshay Photo and Films", tagline: "Wedding Photography & Cinematography",
  studioAddress: "", studioPhone: "+91 73851 99613", studioEmail: "Akshaykumarkhot2115@gmail.com",
  studioWebsite: "https://akshayphotography123.netlify.app/", taxId: "", paymentDetails: ""
};
const state = { projects: [], payments: [], settings: loadSettings(), selectedProjectId: null, busy: false, toastTimer: null };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    const settings = { ...defaults, ...saved };
    if (settings.apiUrl === "/.netlify/functions/sheets") {
      settings.apiUrl = defaults.apiUrl;
    }
    if (settings.studioName === "Frame & Field Photography") settings.studioName = defaults.studioName;
    if (!settings.tagline || settings.tagline === "Honest stories, beautifully told") settings.tagline = defaults.tagline;
    if (!settings.studioPhone) settings.studioPhone = defaults.studioPhone;
    if (!settings.studioEmail) settings.studioEmail = defaults.studioEmail;
    return settings;
  } catch (error) {
    console.error("Could not read saved settings.", error);
    return { ...defaults };
  }
}

function saveSettings(settings) {
  state.settings = { ...defaults, ...settings };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  } catch (error) {
    throw new Error("Settings could not be saved in this browser.");
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function money(value) {
  const amount = Number(value) || 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency", currency: "INR", maximumFractionDigits: 2
  }).format(amount);
}

function formatDate(value, options = { day: "numeric", month: "short", year: "numeric" }) {
  if (!value) return "—";
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(parsed.valueOf()) ? "—" : new Intl.DateTimeFormat("en-IN", options).format(parsed);
}

function dayInputValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function getProjectPayments(orderId) {
  return state.payments.filter(payment => payment.orderId === orderId);
}

function getProjectTotals(project) {
  const paid = getProjectPayments(project.orderId).reduce((sum, payment) => sum + Number(payment.amountPaid || 0), 0);
  const total = Number(project.totalAmount || 0);
  return { paid, total, balance: Math.max(0, total - paid), percent: total > 0 ? Math.min(100, paid / total * 100) : 0 };
}

function setConnection(connected, message) {
  $("#connectionDot").classList.toggle("connected", connected);
  $("#connectionTitle").textContent = connected ? "Google Sheets connected" : "Not connected";
  $("#connectionHint").textContent = message;
}

function toast(message, isError = false) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.toggle("error", isError);
  element.classList.add("show");
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => element.classList.remove("show"), 3600);
}

async function apiRequest(method, payload = {}) {
  if (!state.settings.apiUrl || !state.settings.apiKey) {
    throw new Error("Connect your Google Sheets API in Settings & setup first.");
  }
  const url = new URL(state.settings.apiUrl);
  if (url.protocol !== "https:" || (url.hostname !== "script.google.com" && !url.hostname.endsWith(".googleusercontent.com"))) {
    throw new Error("Enter the HTTPS URL of your deployed Google Apps Script Web App.");
  }
  if (method === "GET") {
    url.searchParams.set("key", state.settings.apiKey);
    url.searchParams.set("action", "list");
    const response = await fetch(url.toString(), { method: "GET", redirect: "follow" });
    if (!response.ok) throw new Error(`Google Sheets returned HTTP ${response.status}.`);
    return response.json();
  }
  const response = await fetch(url.toString(), {
    method: "POST",
    redirect: "follow",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ ...payload, key: state.settings.apiKey })
  });
  if (!response.ok) throw new Error(`Google Sheets returned HTTP ${response.status}.`);
  return response.json();
}

function requireSuccess(result) {
  if (!result || result.success !== true) {
    throw new Error(result && result.error ? result.error : "The Sheets API returned an unexpected response.");
  }
  return result;
}

async function refreshData(showToast = false) {
  $("#refreshButton").disabled = true;
  $("#syncLabel").textContent = "Syncing with Sheets…";
  try {
    const result = requireSuccess(await apiRequest("GET"));
    if (!Array.isArray(result.projects) || !Array.isArray(result.payments)) {
      throw new Error("The Sheets API response is missing projects or payments.");
    }
    state.projects = result.projects;
    state.payments = result.payments;
    render();
    const syncedAt = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(new Date());
    $("#syncLabel").textContent = `Synced at ${syncedAt}`;
    setConnection(true, `${state.projects.length} projects · updated just now`);
    if (showToast) toast("Latest data loaded from Google Sheets.");
    if ($("#detailModal").open && state.selectedProjectId) renderProjectDetail(state.selectedProjectId);
  } catch (error) {
    $("#syncLabel").textContent = "Sync failed";
    setConnection(false, state.settings.apiUrl ? "Check your API settings" : "Connect your Google Sheet");
    if (showToast || state.settings.apiUrl) toast(error.message, true);
    else $("#syncLabel").textContent = "Connect Google Sheets in Settings";
  } finally {
    $("#refreshButton").disabled = false;
  }
}

async function mutate(payload, successMessage) {
  if (state.busy) return false;
  state.busy = true;
  const submit = $("button[type='submit']", payload.form);
  if (submit) submit.disabled = true;
  try {
    requireSuccess(await apiRequest("POST", payload.data));
    await refreshData();
    toast(successMessage);
    return true;
  } catch (error) {
    toast(error.message, true);
    return false;
  } finally {
    state.busy = false;
    if (submit) submit.disabled = false;
  }
}

function projectMatches(project, search, status) {
  const statusMatch = status === "all" || project.status === status;
  const haystack = `${project.clientName} ${project.serviceType} ${project.orderId} ${project.clientContact}`.toLowerCase();
  return statusMatch && haystack.includes(search);
}

function render() {
  const search = $("#searchInput").value.trim().toLowerCase();
  const status = $("#statusFilter").value;
  const projects = [...state.projects].sort((a, b) => String(b.createdDate || "").localeCompare(String(a.createdDate || "")));
  const filtered = projects.filter(project => projectMatches(project, search, status));
  const active = projects.filter(project => project.status === "Active");
  const received = state.payments.reduce((sum, payment) => sum + Number(payment.amountPaid || 0), 0);
  const outstanding = active.reduce((sum, project) => sum + getProjectTotals(project).balance, 0);
  $("#activeCount").textContent = String(active.length);
  $("#receivedTotal").textContent = money(received);
  $("#outstandingTotal").textContent = money(outstanding);
  $("#projectCount").textContent = String(projects.length);
  $("#projectNavCount").textContent = String(projects.length);
  $("#tableFooterText").textContent = `Showing ${filtered.length} of ${projects.length} project${projects.length === 1 ? "" : "s"}`;
  $("#projectsTableBody").innerHTML = filtered.map(project => {
    const totals = getProjectTotals(project);
    const statusClass = String(project.status || "").toLowerCase();
    const paymentStatus = totals.balance === 0 && totals.total > 0
      ? "Settled"
      : `${money(totals.paid)} paid`;
    return `<tr>
      <td><span class="client-name">${escapeHtml(project.clientName)}</span><span class="client-service">${escapeHtml(project.serviceType)}</span></td>
      <td>${escapeHtml(formatDate(project.eventDate))}</td>
      <td><span class="amount-cell">${escapeHtml(money(totals.total))}</span></td>
      <td class="payment-cell"><div class="payment-meta">${escapeHtml(paymentStatus)}${totals.balance > 0 ? ` · ${escapeHtml(money(totals.balance))} due` : ""}</div><div class="progress-track"><div class="progress-fill" style="width:${totals.percent}%"></div></div></td>
      <td><span class="status-pill ${escapeHtml(statusClass)}">${escapeHtml(project.status)}</span></td>
      <td><button class="row-action" type="button" data-project="${escapeHtml(project.orderId)}" aria-label="Open ${escapeHtml(project.clientName)} project">↗</button></td>
    </tr>`;
  }).join("");
  const isEmpty = filtered.length === 0;
  $("#emptyState").hidden = !isEmpty;
  $(".table-scroll").hidden = projects.length === 0;
  $(".table-footer").hidden = projects.length === 0;
  if (projects.length === 0) {
    $("#emptyState").hidden = false;
    $(".empty-state h3").textContent = state.settings.apiUrl ? "Your next story starts here." : "Connect your studio to get started.";
    $(".empty-state p").textContent = state.settings.apiUrl
      ? "Create a project to track a client, milestones, and payments all in one place."
      : "Add your Google Apps Script Web App URL and access key in Settings & setup to load your projects.";
  } else if (isEmpty) {
    $(".empty-state h3").textContent = "No projects found.";
    $(".empty-state p").textContent = "Try a different search or project status.";
  }
}

function showDialog(id) {
  const dialog = document.getElementById(id);
  if (dialog && !dialog.open) dialog.showModal();
}

function closeDialog(id) {
  const dialog = document.getElementById(id);
  if (dialog && dialog.open) dialog.close();
}

function openProject(projectId) {
  const project = state.projects.find(item => item.orderId === projectId);
  if (!project) return;
  state.selectedProjectId = projectId;
  renderProjectDetail(projectId);
  showDialog("detailModal");
}

function renderProjectDetail(projectId) {
  const project = state.projects.find(item => item.orderId === projectId);
  if (!project) return closeDialog("detailModal");
  const totals = getProjectTotals(project);
  const payments = getProjectPayments(projectId).sort((a, b) => String(b.paymentDate || "").localeCompare(String(a.paymentDate || "")));
  $("#detailEyebrow").textContent = `${escapeHtml(project.orderId)} · ${escapeHtml(project.status).toUpperCase()}`;
  $("#detailTitle").textContent = project.clientName;
  const paymentRows = payments.map(payment => `<tr>
    <td>${escapeHtml(payment.milestoneLabel)}</td><td>${escapeHtml(formatDate(payment.paymentDate))}</td>
    <td>${escapeHtml(payment.paymentMode)}</td><td>${escapeHtml(money(payment.amountPaid))}</td>
    <td>${escapeHtml(payment.referenceNo || "—")}</td>
  </tr>`).join("");
  $("#detailContent").innerHTML = `
    <div class="detail-summary">
      <div class="detail-stat"><span>PROJECT VALUE</span><strong>${escapeHtml(money(totals.total))}</strong></div>
      <div class="detail-stat"><span>PAID TO DATE</span><strong>${escapeHtml(money(totals.paid))}</strong></div>
      <div class="detail-stat"><span>BALANCE DUE</span><strong>${escapeHtml(money(totals.balance))}</strong></div>
    </div>
    <p class="detail-client-line">${escapeHtml(project.serviceType)} · ${escapeHtml(formatDate(project.eventDate))}<br>${escapeHtml(project.clientContact || "No contact details added")}</p>
    <div class="detail-actions">
      <button class="button button-outline" type="button" id="invoiceButton">↗&nbsp; Print invoice</button>
      <div class="detail-actions-group">
        <select class="status-select" id="projectStatusSelect" aria-label="Project status">
          ${["Active", "Completed", "Cancelled"].map(status => `<option value="${status}" ${status === project.status ? "selected" : ""}>${status}</option>`).join("")}
        </select>
        <button class="button button-dark" type="button" id="addPaymentButton">＋ Add payment</button>
      </div>
    </div>
    <div class="detail-section-heading"><h3>Payment history</h3><span class="client-service">${payments.length} milestone${payments.length === 1 ? "" : "s"}</span></div>
    ${payments.length ? `<div class="table-scroll"><table class="payment-history"><thead><tr><th>MILESTONE</th><th>DATE</th><th>MODE</th><th>AMOUNT</th><th>REFERENCE</th></tr></thead><tbody>${paymentRows}</tbody></table></div>` : `<div class="payment-empty">No payments recorded yet. Add a milestone when your client pays.</div>`}`;
  $("#invoiceButton").addEventListener("click", () => openInvoice(project));
  $("#addPaymentButton").addEventListener("click", () => openPaymentForm(project));
  $("#projectStatusSelect").addEventListener("change", event => changeProjectStatus(project, event.target.value));
}

async function changeProjectStatus(project, status) {
  if (status === project.status) return;
  if (state.busy) return;
  state.busy = true;
  try {
    requireSuccess(await apiRequest("POST", { action: "updateStatus", orderId: project.orderId, status }));
    await refreshData();
    toast("Project status updated.");
  } catch (error) {
    toast(error.message, true);
    renderProjectDetail(project.orderId);
  } finally {
    state.busy = false;
  }
}

function openPaymentForm(project) {
  if (getProjectTotals(project).balance <= 0) {
    toast("This project is fully paid. No further payment can be recorded.", true);
    return;
  }
  $("#paymentForm").reset();
  $("#paymentForm").elements.paymentDate.value = dayInputValue();
  $("#paymentProjectContext").textContent = `${project.clientName} · ${money(getProjectTotals(project).balance)} remaining`;
  $("#paymentForm").dataset.orderId = project.orderId;
  closeDialog("detailModal");
  showDialog("paymentModal");
}

function studioSettingsForm() {
  const form = $("#settingsForm");
  for (const [key, value] of Object.entries(state.settings)) {
    if (form.elements.namedItem(key)) form.elements.namedItem(key).value = value;
  }
}

function invoiceDocument(project) {
  const studio = state.settings;
  const payments = getProjectPayments(project.orderId).sort((a, b) => String(a.paymentDate || "").localeCompare(String(b.paymentDate || "")));
  const totals = getProjectTotals(project);
  const isPaid = totals.balance <= 0 && totals.total > 0;
  const contact = project.clientContact ? `<div class="client-contact">${escapeHtml(project.clientContact)}</div>` : "";
  const taxId = studio.taxId ? `<div><b>GST / TAX ID</b><br>${escapeHtml(studio.taxId)}</div>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invoice ${escapeHtml(project.orderId)} — ${escapeHtml(studio.studioName)}</title>
    <style>
      *{box-sizing:border-box}body{margin:0;background:#ecebe7;color:#222;font:13px Arial,Helvetica,sans-serif}.toolbar{max-width:210mm;margin:18px auto 12px;display:flex;justify-content:space-between;align-items:center;color:#696a65;font-size:12px}.toolbar button{background:#30352f;color:#fff;border:0;border-radius:3px;padding:10px 15px;font-weight:600;cursor:pointer}.invoice{width:210mm;min-height:297mm;background:#fff;margin:0 auto;padding:18mm 19mm;box-shadow:0 4px 25px #0001;display:flex;flex-direction:column}.brandline{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #222;padding-bottom:21px}.brand h1{font:600 25px Georgia,serif;letter-spacing:.3px;margin:0 0 5px}.brand .tagline{font:italic 12px Georgia,serif;color:#777;margin:0 0 10px}.studio-meta{font-size:10px;line-height:1.7;color:#666;white-space:pre-line}.invoice-title{text-align:right}.invoice-title h2{font:500 27px Georgia,serif;letter-spacing:2px;margin:2px 0 9px}.invoice-number{font-size:10px;color:#777}.invoice-number b{color:#222}.invoice-dates{font-size:10px;line-height:1.9;color:#666;margin-top:9px}.client-block{display:grid;grid-template-columns:1fr 1fr;gap:25px;padding:23px 0 20px}.section-label{font-size:9px;letter-spacing:1.2px;font-weight:700;color:#777;margin-bottom:9px}.client-name{font:500 17px Georgia,serif;margin:0 0 6px}.client-contact{font-size:10px;color:#666;line-height:1.6}.event-meta{font-size:11px;line-height:1.75;color:#444}.event-meta b{font-size:9px;letter-spacing:.5px;color:#777}.table-title{font-size:11px;letter-spacing:.5px;margin:14px 0 9px}.invoice table{border-collapse:collapse;width:100%;text-align:left}.invoice th{font-size:9px;letter-spacing:.7px;color:#555;background:#f2f2f0;border-top:1px solid #d5d5d1;border-bottom:1px solid #d5d5d1;padding:10px 9px}.invoice td{font-size:10px;padding:11px 9px;border-bottom:1px solid #e6e6e2;vertical-align:top}.invoice th:last-child,.invoice td:last-child{text-align:right}.payment-table th,.payment-table td{padding:9px}.service-desc{font-weight:600}.service-sub{display:block;color:#777;margin-top:4px;font-weight:400}.summary-area{display:flex;justify-content:flex-end;margin-top:17px}.summary{width:240px}.summary-row{display:flex;justify-content:space-between;padding:7px 0;font-size:11px;border-bottom:1px solid #e7e7e3}.summary-row.total{font-weight:700;font-size:12px}.summary-row.balance{font-weight:700;border-bottom:0;padding-top:11px}.paid-badge{display:inline-block;border:1px solid #555;padding:4px 7px;letter-spacing:1px;font-size:9px;margin-top:5px}.invoice-footer{margin-top:auto;padding-top:23px}.payment-details{border-top:1px solid #ddd;padding-top:13px;font-size:10px;line-height:1.7;white-space:pre-line}.signature-row{display:grid;grid-template-columns:1fr 1fr;gap:55px;margin:31px 0 19px}.signature-box{height:59px;border-bottom:1px solid #888;position:relative}.signature-box span{position:absolute;bottom:-17px;left:0;font-size:9px;color:#666}.legal{border-top:1px solid #ddd;padding-top:12px;font-size:9px;line-height:1.65;color:#666;white-space:pre-line}.thankyou{text-align:center;font:italic 13px Georgia,serif;margin-top:14px;color:#444}@page{size:A4;margin:0}@media print{body{background:#fff}.toolbar{display:none!important}.invoice{width:auto;min-height:297mm;margin:0;padding:17mm 18mm;box-shadow:none;page-break-after:avoid}.invoice table,.client-block,.summary-area{break-inside:avoid}.invoice-footer{break-inside:avoid}}
    </style></head><body>
    <div class="toolbar"><span>Invoice preview · ${escapeHtml(project.orderId)}</span><button onclick="window.print()">Print / Save as PDF</button></div>
    <main class="invoice">
      <header class="brandline"><div class="brand"><h1>${escapeHtml(studio.studioName || "Photography Studio")}</h1>${studio.tagline ? `<p class="tagline">${escapeHtml(studio.tagline)}</p>` : ""}<div class="studio-meta">${escapeHtml([studio.studioAddress, studio.studioPhone, studio.studioEmail, studio.studioWebsite].filter(Boolean).join("\n"))}</div>${taxId}</div>
      <div class="invoice-title"><h2>INVOICE</h2><div class="invoice-number">INVOICE NO. &nbsp;<b>${escapeHtml(project.orderId)}</b></div><div class="invoice-dates">ISSUED &nbsp; ${escapeHtml(formatDate(dayInputValue()))}<br>EVENT DATE &nbsp; ${escapeHtml(formatDate(project.eventDate))}</div></div></header>
      <section class="client-block"><div><div class="section-label">BILLED TO</div><p class="client-name">${escapeHtml(project.clientName)}</p>${contact}</div><div><div class="section-label">EVENT DETAILS</div><div class="event-meta"><b>SERVICE</b><br>${escapeHtml(project.serviceType)}<br><b>DATE OF SHOOT</b><br>${escapeHtml(formatDate(project.eventDate))}</div></div></section>
      <div class="section-label table-title">SERVICE</div><table><thead><tr><th>DESCRIPTION</th><th>QTY</th><th>AMOUNT (INR)</th></tr></thead><tbody><tr><td><span class="service-desc">${escapeHtml(project.serviceType)}</span><span class="service-sub">Photography services for ${escapeHtml(project.clientName)}</span></td><td>1</td><td>${escapeHtml(money(totals.total))}</td></tr></tbody></table>
      <div class="section-label table-title">PAYMENT MILESTONES</div><table class="payment-table"><thead><tr><th>MILESTONE</th><th>DATE RECEIVED</th><th>MODE</th><th>AMOUNT (INR)</th></tr></thead><tbody>${payments.length ? payments.map(payment => `<tr><td>${escapeHtml(payment.milestoneLabel)}</td><td>${escapeHtml(formatDate(payment.paymentDate))}</td><td>${escapeHtml(payment.paymentMode)}</td><td>${escapeHtml(money(payment.amountPaid))}</td></tr>`).join("") : `<tr><td colspan="4">No payments recorded</td></tr>`}</tbody></table>
      <section class="summary-area"><div class="summary"><div class="summary-row"><span>Total package value</span><b>${escapeHtml(money(totals.total))}</b></div><div class="summary-row"><span>Total paid to date</span><b>${escapeHtml(money(totals.paid))}</b></div><div class="summary-row balance"><span>${isPaid ? "Balance due" : "Balance due"}</span><b>${escapeHtml(money(totals.balance))}</b></div>${isPaid ? `<div style="text-align:right"><span class="paid-badge">PAID IN FULL</span></div>` : ""}</div></section>
      <footer class="invoice-footer"><div class="payment-details"><b>PAYMENT DETAILS</b><br>${escapeHtml(studio.paymentDetails || "Please contact the studio for bank / UPI payment details.")}</div>
        <div class="signature-row"><div class="signature-box"><span>Digital studio stamp</span></div><div class="signature-box"><span>Authorized signature</span></div></div>
        <div class="legal"><b>TERMS &amp; CONDITIONS</b><br>Payment received is acknowledged against the services described above. Please retain this invoice for your records. Any outstanding balance is payable as agreed with the studio. Contact us if any invoice details need correction.</div>
        <div class="thankyou">Thank you for trusting us with your story.</div></footer>
    </main></body></html>`;
}

function openInvoice(project) {
  const invoiceWindow = window.open("", "_blank");
  if (!invoiceWindow) {
    toast("Allow pop-ups for this site to open the invoice.", true);
    return;
  }
  invoiceWindow.document.open();
  invoiceWindow.document.write(invoiceDocument(project));
  invoiceWindow.document.close();
  invoiceWindow.focus();
}

function bindEvents() {
  $("#newProjectButton").addEventListener("click", () => showDialog("projectModal"));
  $("#emptyNewProjectButton").addEventListener("click", () => showDialog("projectModal"));
  $("#settingsButton").addEventListener("click", () => { studioSettingsForm(); showDialog("settingsModal"); });
  $("#refreshButton").addEventListener("click", () => refreshData(true));
  $("#searchInput").addEventListener("input", render);
  $("#statusFilter").addEventListener("change", render);
  $("#projectsTableBody").addEventListener("click", event => {
    const button = event.target.closest("[data-project]");
    if (button) openProject(button.dataset.project);
  });
  $$("[data-close]").forEach(button => button.addEventListener("click", () => closeDialog(button.dataset.close)));
  $$(".modal").forEach(dialog => dialog.addEventListener("click", event => {
    if (event.target === dialog) dialog.close();
  }));
  $("#projectForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    const ok = await mutate({ form, data: {
      action: "createProject", clientName: data.clientName.trim(), clientContact: data.clientContact.trim(),
      serviceType: data.serviceType.trim(), eventDate: data.eventDate, totalAmount: Number(data.totalAmount)
    } }, "Project created in Google Sheets.");
    if (ok) { form.reset(); closeDialog("projectModal"); }
  });
  $("#paymentForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    const orderId = form.dataset.orderId;
    const ok = await mutate({ form, data: {
      action: "addPayment", orderId, milestoneLabel: data.milestoneLabel.trim(),
      amountPaid: Number(data.amountPaid), paymentDate: data.paymentDate,
      paymentMode: data.paymentMode, referenceNo: data.referenceNo.trim()
    } }, "Payment milestone saved to Google Sheets.");
    if (ok) { form.reset(); closeDialog("paymentModal"); openProject(orderId); }
  });
  $("#settingsForm").addEventListener("submit", event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const apiUrl = data.apiUrl.trim();
      const parsed = new URL(apiUrl);
      if (parsed.protocol !== "https:" ||
          (parsed.hostname !== "script.google.com" && !parsed.hostname.endsWith(".googleusercontent.com"))) {
        throw new Error("Use the HTTPS URL of a Google Apps Script Web App.");
      }
      if (!data.apiKey.trim()) throw new Error("Enter the API key configured in Apps Script.");
      if (!data.studioName.trim()) throw new Error("Enter your studio name.");
      saveSettings({ ...data, apiUrl, apiKey: data.apiKey.trim() });
      closeDialog("settingsModal");
      toast("Studio settings saved.");
      refreshData();
    } catch (error) {
      toast(error.message || "Could not save settings.", true);
    }
  });
  $$("[data-nav]").forEach(button => button.addEventListener("click", () => {
    $("#breadcrumbCurrent").textContent = button.dataset.nav === "projects" ? "PROJECTS" : "OVERVIEW";
    document.getElementById("projectsPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    $$(".nav-link[data-nav]").forEach(link => link.classList.toggle("active", link === button));
  }));
}

function init() {
  $("#todayLabel").textContent = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" }).format(new Date()).toUpperCase();
  bindEvents();
  render();
  refreshData();
  window.setInterval(() => {
    if (state.settings.apiUrl && !document.hidden && !state.busy) refreshData();
  }, REFRESH_INTERVAL_MS);
}

document.addEventListener("DOMContentLoaded", init);
