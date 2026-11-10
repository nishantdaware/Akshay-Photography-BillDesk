const SHEET_HEADERS = {
  Projects: [
    "Order ID", "Client Name", "Client Phone & Email", "Event / Service Type",
    "Event Date", "Total Agreed Amount (₹)", "Status", "Created Date", "Frame Items JSON"
  ],
  Payments: [
    "Payment ID", "Order ID", "Milestone Label", "Amount Paid (₹)",
    "Payment Date", "Payment Mode", "Transaction / Reference No."
  ]
};

function doGet(e) {
  try {
    authorize_(e && e.parameter ? e.parameter.key : "");
    const action = e && e.parameter ? e.parameter.action : "list";
    if (action !== "list") throw new Error("Unsupported GET action.");
    const sheets = getSheets_();
    return json_({
      success: true,
      projects: readRows_(sheets.projects, SHEET_HEADERS.Projects),
      payments: readRows_(sheets.payments, SHEET_HEADERS.Payments)
    });
  } catch (error) {
    return json_({ success: false, error: error.message || "Request failed." });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const body = JSON.parse(e && e.postData && e.postData.contents ? e.postData.contents : "{}");
    authorize_(body.key);
    lock.waitLock(10000);
    const sheets = getSheets_();
    let result;
    if (body.action === "createProject") {
      result = createProject_(sheets.projects, body);
    } else if (body.action === "updateProject") {
      result = updateProject_(sheets.projects, sheets.payments, body);
    } else if (body.action === "deleteProject") {
      result = deleteProject_(sheets.projects, sheets.payments, body);
    } else if (body.action === "addPayment") {
      result = addPayment_(sheets.projects, sheets.payments, body);
    } else if (body.action === "updateStatus") {
      result = updateStatus_(sheets.projects, body);
    } else {
      throw new Error("Unsupported POST action.");
    }
    return json_({ success: true, ...result });
  } catch (error) {
    return json_({ success: false, error: error.message || "Request failed." });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function authorize_(providedKey) {
  const configuredKey = PropertiesService.getScriptProperties().getProperty("API_KEY");
  if (!configuredKey) throw new Error("The API_KEY script property is not configured.");
  if (!providedKey || String(providedKey) !== configuredKey) throw new Error("Unauthorized. Check the API access key.");
}

function getSheets_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("No bound Google Sheet found. Open Apps Script from your spreadsheet.");
  const projects = spreadsheet.getSheetByName("Projects");
  const payments = spreadsheet.getSheetByName("Payments");
  if (!projects || !payments) throw new Error('Missing "Projects" or "Payments" tab. Run setupSheets() in Apps Script.');
  ensureHeaders_(projects, SHEET_HEADERS.Projects);
  ensureHeaders_(payments, SHEET_HEADERS.Payments);
  return { projects: projects, payments: payments };
}

function ensureHeaders_(sheet, expected) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, expected.length).setValues([expected]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, expected.length).setFontWeight("bold");
    return;
  }
  const existingColumns = sheet.getLastColumn();
  const checkedColumns = Math.min(existingColumns, expected.length);
  const actual = checkedColumns ? sheet.getRange(1, 1, 1, checkedColumns).getDisplayValues()[0] : [];
  if (actual.some(function (header, index) { return header !== expected[index]; })) {
    throw new Error('Unexpected columns in "' + sheet.getName() + '". Keep the supplied header row unchanged.');
  }
  if (existingColumns < expected.length) {
    const newHeaders = expected.slice(existingColumns);
    const headerRange = sheet.getRange(1, existingColumns + 1, 1, newHeaders.length);
    headerRange.setValues([newHeaders]);
    headerRange.setFontWeight("bold");
  }
}

function readRows_(sheet, headers) {
  ensureHeaders_(sheet, headers);
  if (sheet.getLastRow() < 2) return [];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  return rows.filter(function (row) { return row.some(function (cell) { return cell !== ""; }); })
    .map(function (row) {
      const result = {};
      headers.forEach(function (header, index) {
        result[camelKey_(header)] = serializeValue_(row[index]);
      });
      return result;
    });
}

function camelKey_(header) {
  const map = {
    "Order ID": "orderId",
    "Client Name": "clientName",
    "Client Phone & Email": "clientContact",
    "Event / Service Type": "serviceType",
    "Event Date": "eventDate",
    "Total Agreed Amount (₹)": "totalAmount",
    "Status": "status",
    "Created Date": "createdDate",
    "Frame Items JSON": "frameItems",
    "Payment ID": "paymentId",
    "Milestone Label": "milestoneLabel",
    "Amount Paid (₹)": "amountPaid",
    "Payment Date": "paymentDate",
    "Payment Mode": "paymentMode",
    "Transaction / Reference No.": "referenceNo"
  };
  if (!map[header]) throw new Error("Unsupported sheet column: " + header);
  return map[header];
}

function serializeValue_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  return value;
}

function createProject_(sheet, body) {
  const clientName = requiredText_(body.clientName, "Client name", 120);
  const clientContact = optionalText_(body.clientContact, 240);
  const serviceType = requiredText_(body.serviceType, "Event / service type", 160);
  const eventDate = dateValue_(body.eventDate, "Event date");
  const serviceAmount = body.serviceAmount === undefined
    ? positiveAmount_(body.totalAmount, "Total agreed amount")
    : nonNegativeAmount_(body.serviceAmount, "Photography service amount");
  const frameItems = normalizeFrameItems_(body.frameItems);
  const frameTotal = frameItems.reduce(function (sum, item) { return sum + item.quantity * item.unitPrice; }, 0);
  const totalAmount = Math.round((serviceAmount + frameTotal) * 100) / 100;
  if (totalAmount <= 0 || totalAmount > 1000000000000) throw new Error("Project total must be greater than zero and no more than ₹1,000,000,000,000.");
  const orderId = nextId_(sheet, "PHO", 1);
  sheet.appendRow([orderId, clientName, clientContact, serviceType, eventDate, totalAmount, "Active", new Date(), JSON.stringify(frameItems)]);
  return { orderId: orderId };
}

function normalizeFrameItems_(items) {
  if (items === undefined || items === null) return [];
  if (!Array.isArray(items) || items.length > 30) throw new Error("Add no more than 30 frame lines per project.");
  return items.map(function (item) {
    if (!item || typeof item !== "object") throw new Error("Each frame line must include a size, quantity, and price.");
    const size = requiredText_(item.size, "Frame size", 40);
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
      throw new Error("Frame quantity must be a whole number between 1 and 999.");
    }
    const unitPrice = positiveAmount_(item.unitPrice, "Price per frame");
    return { size: size, quantity: quantity, unitPrice: unitPrice };
  });
}

function updateProject_(projectsSheet, paymentsSheet, body) {
  const orderId = requiredText_(body.orderId, "Order ID", 40);
  const rowNumber = findRowNumber_(projectsSheet, 1, orderId);
  if (rowNumber < 0) throw new Error("Project not found.");
  const clientName = requiredText_(body.clientName, "Client name", 120);
  const clientContact = optionalText_(body.clientContact, 240);
  const serviceType = requiredText_(body.serviceType, "Event / service type", 160);
  const eventDate = dateValue_(body.eventDate, "Event date");
  const serviceAmount = nonNegativeAmount_(body.serviceAmount, "Photography service amount");
  const frameItems = normalizeFrameItems_(body.frameItems);
  const frameTotal = frameItems.reduce(function (sum, item) { return sum + item.quantity * item.unitPrice; }, 0);
  const totalAmount = Math.round((serviceAmount + frameTotal) * 100) / 100;
  if (totalAmount <= 0 || totalAmount > 1000000000000) throw new Error("Project total must be greater than zero and no more than ₹1,000,000,000,000.");
  const paidToDate = readRows_(paymentsSheet, SHEET_HEADERS.Payments)
    .filter(function (payment) { return payment.orderId === orderId; })
    .reduce(function (sum, payment) { return sum + Number(payment.amountPaid || 0); }, 0);
  if (totalAmount + 0.000001 < paidToDate) throw new Error("Project total cannot be less than payments already received.");
  projectsSheet.getRange(rowNumber, 2, 1, 5).setValues([[clientName, clientContact, serviceType, eventDate, totalAmount]]);
  projectsSheet.getRange(rowNumber, 9).setValue(JSON.stringify(frameItems));
  return { orderId: orderId, totalAmount: totalAmount };
}

function deleteProject_(projectsSheet, paymentsSheet, body) {
  const orderId = requiredText_(body.orderId, "Order ID", 40);
  const projectRow = findRowNumber_(projectsSheet, 1, orderId);
  if (projectRow < 0) throw new Error("Project not found.");
  const lastPaymentRow = paymentsSheet.getLastRow();
  if (lastPaymentRow > 1) {
    const paymentOrderIds = paymentsSheet.getRange(2, 2, lastPaymentRow - 1, 1).getDisplayValues();
    const paymentRows = paymentOrderIds.reduce(function (rows, row, index) {
      if (row[0] === orderId) rows.push(index + 2);
      return rows;
    }, []);
    paymentRows.sort(function (a, b) { return b - a; }).forEach(function (row) { paymentsSheet.deleteRow(row); });
  }
  projectsSheet.deleteRow(projectRow);
  return { orderId: orderId };
}

function findRowNumber_(sheet, column, value) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const rows = sheet.getRange(2, column, lastRow - 1, 1).getDisplayValues();
  const index = rows.findIndex(function (row) { return row[0] === value; });
  return index < 0 ? -1 : index + 2;
}

function addPayment_(projectsSheet, paymentsSheet, body) {
  const orderId = requiredText_(body.orderId, "Order ID", 40);
  const project = readRows_(projectsSheet, SHEET_HEADERS.Projects).find(function (row) { return row.orderId === orderId; });
  if (!project) throw new Error("Project not found.");
  if (project.status === "Cancelled") throw new Error("Payments cannot be added to a cancelled project.");
  const milestoneLabel = requiredText_(body.milestoneLabel, "Milestone label", 120);
  const amountPaid = positiveAmount_(body.amountPaid, "Amount received");
  const paymentDate = dateValue_(body.paymentDate, "Payment date");
  const paymentMode = requiredText_(body.paymentMode, "Payment mode", 40);
  if (["Cash", "UPI", "Bank Transfer"].indexOf(paymentMode) === -1) throw new Error("Payment mode must be Cash, UPI, or Bank Transfer.");
  const referenceNo = optionalText_(body.referenceNo, 160);
  const paidToDate = readRows_(paymentsSheet, SHEET_HEADERS.Payments)
    .filter(function (payment) { return payment.orderId === orderId; })
    .reduce(function (total, payment) { return total + Number(payment.amountPaid || 0); }, 0);
  if (paidToDate + amountPaid > Number(project.totalAmount) + 0.000001) {
    throw new Error("This payment exceeds the project's remaining balance.");
  }
  const paymentId = nextId_(paymentsSheet, "PAY", 1);
  paymentsSheet.appendRow([paymentId, orderId, milestoneLabel, amountPaid, paymentDate, paymentMode, referenceNo]);
  return { paymentId: paymentId };
}

function updateStatus_(projectsSheet, body) {
  const orderId = requiredText_(body.orderId, "Order ID", 40);
  const status = requiredText_(body.status, "Status", 20);
  if (["Active", "Completed", "Cancelled"].indexOf(status) === -1) throw new Error("Status must be Active, Completed, or Cancelled.");
  const rows = readRows_(projectsSheet, SHEET_HEADERS.Projects);
  const index = rows.findIndex(function (row) { return row.orderId === orderId; });
  if (index === -1) throw new Error("Project not found.");
  projectsSheet.getRange(index + 2, 7).setValue(status);
  return { orderId: orderId, status: status };
}

function nextId_(sheet, prefix, width) {
  const year = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy");
  const start = prefix + "-" + year + "-";
  let highest = 0;
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues().forEach(function (row) {
      const value = row[0];
      if (value && value.indexOf(start) === 0) {
        const number = Number(value.slice(start.length));
        if (Number.isInteger(number) && number > highest) highest = number;
      }
    });
  }
  return start + String(highest + 1).padStart(width, "0");
}

function requiredText_(value, label, maxLength) {
  const text = String(value === undefined || value === null ? "" : value).trim();
  if (!text) throw new Error(label + " is required.");
  if (text.length > maxLength) throw new Error(label + " must be " + maxLength + " characters or fewer.");
  return text;
}

function optionalText_(value, maxLength) {
  const text = String(value === undefined || value === null ? "" : value).trim();
  if (text.length > maxLength) throw new Error("Text must be " + maxLength + " characters or fewer.");
  return text;
}

function positiveAmount_(value, label) {
  const amount = Number(value);
  if (!isFinite(amount) || amount <= 0 || amount > 1000000000000) throw new Error(label + " must be a positive amount.");
  return Math.round(amount * 100) / 100;
}

function nonNegativeAmount_(value, label) {
  const amount = Number(value);
  if (!isFinite(amount) || amount < 0 || amount > 1000000000000) throw new Error(label + " must be zero or a positive amount.");
  return Math.round(amount * 100) / 100;
}

function dateValue_(value, label) {
  const text = requiredText_(value, label, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(label + " must use YYYY-MM-DD format.");
  const parts = text.split("-").map(Number);
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  if (date.getFullYear() !== parts[0] || date.getMonth() !== parts[1] - 1 || date.getDate() !== parts[2]) {
    throw new Error(label + " is not a valid calendar date.");
  }
  return date;
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function setupSheets() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("Open Apps Script from the Google Sheet first.");
  Object.keys(SHEET_HEADERS).forEach(function (name) {
    let sheet = spreadsheet.getSheetByName(name);
    if (!sheet) sheet = spreadsheet.insertSheet(name);
    if (sheet.getLastRow() === 0) ensureHeaders_(sheet, SHEET_HEADERS[name]);
    else ensureHeaders_(sheet, SHEET_HEADERS[name]);
    sheet.autoResizeColumns(1, SHEET_HEADERS[name].length);
  });
  spreadsheet.setSpreadsheetTimeZone(Session.getScriptTimeZone());
}
