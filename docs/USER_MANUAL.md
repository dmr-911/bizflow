# BizFlow user manual

## First start

1. Open the site and choose **Start free trial**. Enter your name, business name, email and a password of at least 10 characters. The free trial starts immediately; no card is needed.
2. Go to **Settings** and fill in **Business details** (name, address, phone, email, tax ID / BIN). These appear on every quotation and invoice.
3. Check **Language & formats** (English or বাংলা, default currency BDT or USD, date format), **Document numbering** and **Tax rates**. Click **Save**.

Want to look around first? **Settings → Load demo data** (type `DEMO` to confirm) fills the app with a sample agency. **Settings → Erase all business data** (type `RESET`) clears it again.

## Dashboard

- **Invoices / Quotations** — counts, with overdue and open numbers.
- **Received** — all payments recorded, and this month's total. BDT and USD are always shown separately.
- **Outstanding** — unpaid balance of sent and partially paid invoices; the red part is overdue.
- **Monthly revenue** — grey bars are amounts invoiced, blue bars are payments received, for your default currency.
- **Upcoming follow-ups** — overdue and next 7 days.
- **Recent activity** — every important action, newest first.

A yellow banner and a red badge on **Follow-ups** appear when something is overdue or due today.

## Customers

- **New customer**: only the name is required. Notes are private and never printed.
- **Search** by name, company, email or phone.
- Open a customer to see their outstanding balance, payments, all quotations and invoices, follow-ups and activity. Use the buttons at the top to create a quotation or invoice for them.
- **Archive** hides a customer from lists and pickers without deleting history. Find them under the **Archived** tab and **Restore** any time. Archived customers cannot receive new documents.

## Quotations

1. **Quotations → New quotation**, choose the customer. Issue date and *valid until* are pre-filled from your settings.
2. Add lines: description, quantity (decimals allowed, e.g. `1.5` hours), unit price, discount (percent or fixed amount) and tax rate. Totals update as you type; the server recalculates them exactly when you save.
3. Save. The quotation gets the next number (e.g. `QT-2026-0007`) and starts as **Draft**.
4. **Print / Save PDF** opens the printable version. In the print dialog choose *Save as PDF* to email or WhatsApp it.
5. Mark it **Sent**, then **Accepted** or **Rejected** when the customer replies. A sent quotation past its valid-until date shows as **Expired**.
6. **Convert to invoice** on an accepted quotation creates a draft invoice with the same lines and totals. A quotation can only be converted once; the two documents link to each other.

Draft and sent quotations can be edited. Drafts can be deleted.

## Invoices

| Status | Meaning | What you can do |
| --- | --- | --- |
| Draft | Being prepared | Edit, delete, mark as sent, cancel |
| Sent | Issued to the customer | Record payments, back to draft (if no payments), cancel |
| Partially paid | Some money received | Record more payments |
| Paid | Fully paid | Remove a payment if it was entered by mistake |
| Overdue | Sent or partially paid and past the due date | Same as sent; follow up! |
| Cancelled | Void; kept for your records | Nothing (final) |

- Invoice numbers are unique and never reused, even if you change the numbering settings.
- Once sent, an invoice is **locked**. To change it, move it back to draft (only if unpaid) or cancel it and create a new one. This keeps your records trustworthy.
- **Record payment**: enter the amount (click *Full balance* to fill the remaining amount), date, method (cash, bank, bKash, Nagad, card, cheque, other) and an optional reference such as the transaction ID. Overpayments are rejected.
- The payment history is listed on the invoice. Use the bin icon to remove a wrong entry; the balance reopens.
- An invoice with payments cannot be cancelled. Remove the payments first (for example after a refund).

## Printing and PDF

Every quotation and invoice has a **Print / Save PDF** button. The page is laid out for A4. In Chrome/Edge choose *Destination → Save as PDF*; turn off *Headers and footers* for a clean result. The file name defaults to the document number and customer name.

The print uses the interface language. Switch to বাংলা for a Bangla document.

## Follow-ups

- Add from **Follow-ups**, from a customer page, or from a quotation/invoice page (which links it to that document).
- Filters: **Pending** (due today or later), **Overdue**, **Completed**, **All**.
- Tick the box to mark done; tick again to reopen. The bin deletes it.

## Reports

- **Revenue by month** for the last 12 months, per currency (switch BDT/USD at the top). *Received* is cash received by payment date; *Invoiced* is issued invoices by issue date.
- **Outstanding balances** per customer, split into not yet due, 1–30, 31–60, 61–90 and 90+ days late.
- **Most active customers** in the last 12 months by documents and payments.
- **Export data**: CSV downloads for customers, invoices, quotations, payments, follow-ups and each report. Files open directly in Excel (Bangla text included).

## Settings

- **Document numbering**: prefix (e.g. `INV-`), digits (padding), next number and whether to include the year. The preview shows the next number.
- **Tax rates**: add the rates you charge (e.g. *VAT 15%*, *VAT 5%*, *No tax*) and choose a default for new lines. The tax label (VAT, GST, Tax) appears on documents. Changing a rate never changes documents already created.
- **Defaults**: payment terms in days, quotation validity, default terms text, and a footer line for documents.
- **Data & backup**: download a JSON backup, restore one (type `RESTORE`), load demo data, or erase everything.
- **Account**: change your password. Other logged-in devices are signed out. Forgot it? Use **Forgot password?** on the sign-in page.

## Billing

**Billing** in the menu shows your plan, days left in the trial, and payment history.

- **Pay by card** (US$5/month): opens Stripe's secure checkout. It renews monthly; **Open billing portal** lets you change the card, download receipts or cancel.
- **Pay with bKash** (৳600/month): opens bKash; approve with your wallet number, OTP and PIN. Each payment adds one month. Pay again before the date shown to continue.
- Paying during the trial does not cost you the remaining free days.
- If the trial or paid month ends, the app pauses (your data is kept). You can still download your backup and CSV files from Billing.
- **Delete account** permanently removes your business data and login and cancels a card subscription.

## Good habits

- Download a backup now and then for your own records. The service also keeps server backups.
- Record payments the same day you receive them.
- Use follow-ups for every overdue invoice.
