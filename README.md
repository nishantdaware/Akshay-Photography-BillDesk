# Akshay Photo and Films — Studio Manager

A lightweight, responsive project and payment tracker for Akshay Photo and Films. Project and payment records live in Google Sheets; the static frontend stores the API connection and invoice presentation settings in the current browser.

The studio name, wedding photography/cinematography tagline, phone number, email, website, Instagram link, and listed service categories are prefilled from [akshayphotography123.netlify.app](https://akshayphotography123.netlify.app/). The public site does not list a postal address, GST/Tax ID, or bank/UPI payment details, so those invoice fields are intentionally left blank until supplied by the studio.

## Files

- `index.html`, `styles.css`, `app.js` — the static single-page application.
- `google-apps-script.gs` — the Google Sheets REST API to paste into the spreadsheet-bound Apps Script project.
- `_redirects` — Netlify single-page fallback.

## 1. Create the Google Sheet and API

1. Create a Google spreadsheet for the studio.
2. Open **Extensions → Apps Script** from that spreadsheet.
3. Replace the editor contents with `google-apps-script.gs` and save the project.
4. In the Apps Script editor, choose `setupSheets` from the function selector and click **Run**. Review and grant the requested spreadsheet permissions. This creates the `Projects` and `Payments` tabs with the exact required headers. Keep those header rows unchanged.
5. In Apps Script, open **Project Settings → Script Properties → Add script property**. Set:
   - **Property:** `API_KEY`
   - **Value:** a long, unique random secret (at least 32 characters).
6. Choose **Deploy → New deployment → Web app**:
   - **Execute as:** Me
   - **Who has access:** Anyone
7. Deploy, authorize if prompted, and copy the Web app URL ending in `/exec`. If the script changes later, use **Deploy → Manage deployments → Edit → New version → Deploy**.

The app requires the API key in Apps Script `Script Properties` and sends it from the browser for each request. Because the key is present in browser storage and network requests, anyone who can use the app may be able to retrieve it and access the spreadsheet. Use only with trusted users and non-sensitive data; never publish the key in source code or a public repository. Rotate any key that has been shared.

## 2. Connect and use the app

1. Serve the site over HTTP for local use (do not open the file as `file://`): from the app folder, run `python -m http.server 8000`, then visit `http://localhost:8000`. Alternatively, deploy the site using the steps below.
2. Open **Settings & setup**, confirm the prefilled `/exec` URL (replace it if you deploy a new Apps Script version with a new URL), and enter the exact `API_KEY` value.
3. Enter the studio name, tagline, address, phone, email, optional GST/Tax ID, and bank / UPI instructions used on invoices. Select **Save settings**.
4. Create projects, record payments, and open a project to review its payment history, update its status, or print its invoice.
5. To create a quotation, choose **New quotation** from the dashboard. Enter the client name, mobile number, enquiry date, and enquiry details. All packages are selected by default; leave **Select all packages** checked for the complete price list, or deselect packages to make a custom quotation. Generating opens the browser's print dialog; choose **Save as PDF** to download the A4 quotation. A print button is also available in the preview. Browsers require this confirmation and do not permit a site to silently save a PDF. Quotations do not create projects or write to Google Sheets.

### Quotation price list

The five packages and prices are prefilled from the studio's supplied rate card: Wedding Package 1 (₹26,000), Package 2 · Traditional Wedding (₹38,000), Package 3 · Cinematic Wedding (₹70,000), Pre-Wedding Package (₹55,000), and Complete Pre-Wedding, Wedding & Engagement (₹1,40,000). The ₹1,40,000 complete package includes the 20-page pre-wedding album along with the wedding and engagement inclusions. Open **Settings & setup** to confirm or edit these fixed rates. Custom quotations use these same rates; amounts are treated as GST-inclusive and cannot be changed per quote. Quotation validity defaults to 30 days and can be changed in Settings.

Quotation PDFs contain the package headings, detailed inclusions, client/enquiry details, and package prices. The full fixed quotation can span more than one A4 page to keep package details readable.

The app fetches the Sheets data on startup, on manual refresh, and automatically once a minute while the page is visible. Reloading the app fetches the latest Sheet values, including edits made directly in the spreadsheet.

## 3. Netlify deployment

No build command, function, or package installation is needed.

### Drag and drop

1. Put `index.html`, `styles.css`, `app.js`, and `_redirects` in the same folder.
2. In Netlify, choose **Add new site → Deploy manually** and drag that folder into the deploy area.
3. Open the deployed site and configure its Apps Script URL, API key, and studio settings.

### Git-based deploy

Connect the project in Netlify and set the publish directory to the folder containing `index.html`. Leave the build command blank. The included `_redirects` file is applied automatically.

## Data and invoice notes

- The spreadsheet has two tabs: `Projects` and `Payments`. Sheet rows are the durable source of truth; the browser refreshes from the Web App instead of maintaining a separate local project database.
- Project and payment IDs are generated by Apps Script. Payment amounts are validated server-side against each project's remaining balance; cancelled projects cannot receive new payments.
- A project invoice is generated in a separate browser tab. Use **Print / Save as PDF** and select A4 paper. Add actual stamp/signature artwork by replacing the labeled signature placeholders in `app.js` invoice markup if required.
- Quotations are generated independently of projects and are not persisted to Sheets; download the print-ready A4 quotation as a PDF when created.
- Invoice wording is a basic receipt/invoice template, not tax or legal advice. Configure tax details and terms to match applicable local requirements.
- The API key and studio invoice settings are saved in this browser's local storage. The key is not shared between browser profiles or devices. Clear browser site data before using a shared device.
