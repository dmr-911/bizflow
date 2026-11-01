import type { TenantDb } from "../db";
import { withClock } from "../db";
import { customers as customersTable } from "../db/schema";
import { addDays, todayIso } from "../dates";
import { createCustomer, type Customer } from "./customers";
import { resetBusinessData } from "./data";
import {
  cancelInvoice,
  convertQuotationToInvoice,
  createDocument,
  markInvoiceSent,
  recordPayment,
  setQuotationStatus,
} from "./documents";
import { createFollowUp, setFollowUpCompleted } from "./followups";
import { getSettings, saveSettings } from "./settings";

const at = (iso: string, hour = 10) => `${iso}T${String(hour).padStart(2, "0")}:00:00.000Z`;

/**
 * Replace all business data with a realistic demo company: a Dhaka-based
 * digital agency with local and international clients, spread over the last
 * six months so the dashboard and reports have something to show.
 */
export async function seedDemoData(db: TenantDb, today = todayIso()): Promise<void> {
  await db.tx(async (db) => {
    await resetBusinessData(db);
    const s = await getSettings(db);
    await saveSettings(db, {
      ...s,
      business: {
        name: "Nogor Digital Studio",
        email: "hello@nogordigital.example",
        phone: "+880 1711-000000",
        address: "House 12, Road 5, Dhanmondi, Dhaka 1205, Bangladesh",
        website: "nogordigital.example",
        taxId: "BIN 000000000-0101",
      },
      taxRates: [
        { id: "none", name: "No tax", rateBps: 0, isDefault: true },
        { id: "vat15", name: "VAT 15%", rateBps: 1500, isDefault: false },
        { id: "vat5", name: "VAT 5%", rateBps: 500, isDefault: false },
      ],
    });

    const d = (offset: number) => addDays(today, offset);

    const customers = [
      { name: "Farhana Rahman", company: "Rahman Textiles Ltd.", email: "farhana@rahmantex.example", phone: "+880 1819-111222", city: "Narayanganj", country: "Bangladesh", notes: "Prefers bKash for small invoices. Monthly retainer for social media." },
      { name: "Tanvir Hasan", company: "Hasan Electronics", email: "tanvir@hasanelec.example", phone: "+880 1912-333444", city: "Chattogram", country: "Bangladesh", notes: "E-commerce store on Facebook. Pays by bank transfer." },
      { name: "Sarah Mitchell", company: "Brightline Consulting", email: "sarah@brightline.example", phone: "+1 415 555 0142", city: "San Francisco", country: "United States", notes: "Bills in USD. Net 14. Contact via email only." },
      { name: "Imran Chowdhury", company: "Chowdhury Dental Care", email: "imran@cdcare.example", phone: "+880 1555-777888", city: "Sylhet", country: "Bangladesh", notes: "Website + booking system project." },
      { name: "Nusrat Jahan", company: "", email: "nusrat.jahan@example.com", phone: "+880 1677-123456", city: "Dhaka", country: "Bangladesh", notes: "Freelance photographer, occasional design work." },
      { name: "Oliver Brandt", company: "Brandt & Söhne GmbH", email: "o.brandt@brandt.example", phone: "+49 30 555 0199", city: "Berlin", country: "Germany", notes: "Quarterly catalogue design. Invoices in USD." },
      { name: "Kamal Uddin", company: "Uddin Traders", email: "", phone: "+880 1712-998877", city: "Rajshahi", country: "Bangladesh", notes: "Old client, archived after business closed." },
    ];
    const c: Customer[] = [];
    for (const [i, x] of customers.entries()) {
      c.push(await withClock(at(d(-180 + i * 5)), () => createCustomer(db, { address: "", taxId: "", ...x })));
    }

    const [rahman, hasan, brightline, dental, nusrat, brandt, uddin] = c;

    type Line = { description: string; quantity: string; unitPrice: string; discountType?: "percent" | "amount"; discountValue?: string; taxRateId?: string };
    const doc = (kind: "invoice" | "quotation", customerId: number, issue: number, due: number, currency: "BDT" | "USD", items: Line[], notes = "") =>
      withClock(at(d(issue)), () =>
        createDocument(db, kind, {
          customerId,
          issueDate: d(issue),
          dueDate: d(due),
          currency,
          notes,
          terms: kind === "invoice" ? s.invoiceTerms : s.quotationTerms,
          items: items.map((l) => ({ discountType: "percent", discountValue: "0", taxRateId: "none", ...l })),
        }),
      );
    const send = (id: number, day: number) => withClock(at(d(day), 11), () => markInvoiceSent(db, id));
    const pay = (id: number, day: number, amount: string, method: string, reference = "") =>
      withClock(at(d(day), 15), () => recordPayment(db, id, { amount, paidAt: d(day), method, reference, note: "" }));
    const quote = (id: number, day: number, status: "sent" | "accepted" | "rejected") =>
      withClock(at(d(day), 12), () => setQuotationStatus(db, id, status));

    // Monthly social media retainer for Rahman Textiles, paid every month.
    for (let m = 5; m >= 0; m--) {
      const issue = -m * 30 - 3;
      const inv = await doc("invoice", rahman.id, issue, issue + 14, "BDT", [
        { description: "Social media management (monthly retainer)", quantity: "1", unitPrice: "35000", taxRateId: "vat15" },
        { description: "Boosted post management", quantity: "4", unitPrice: "1500", taxRateId: "vat15" },
      ]);
      await send(inv.id, issue);
      if (m > 0) pay(inv.id, issue + 9, "47150", m % 2 ? "bank" : "bkash", `TRX${8800 + m}`);
    }

    // Hasan Electronics: product photography, partially paid, now overdue.
    const hInv = await doc("invoice", hasan.id, -48, -34, "BDT", [
      { description: "Product photography (per product)", quantity: "60", unitPrice: "450" },
      { description: "Background removal & retouching", quantity: "60", unitPrice: "120", discountType: "percent", discountValue: "10" },
    ]);
    await send(hInv.id, -48);
    await pay(hInv.id, -30, "15000", "bank", "DBBL-55120");

    // Brightline (USD): quotation accepted and converted, invoice paid in two parts.
    const bQ = await doc("quotation", brightline.id, -120, -90, "USD", [
      { description: "Brand strategy workshop (2 days)", quantity: "2", unitPrice: "900" },
      { description: "Logo & visual identity system", quantity: "1", unitPrice: "2400" },
      { description: "Brand guidelines document", quantity: "1", unitPrice: "800", discountType: "amount", discountValue: "100" },
    ], "Includes two rounds of revisions.");
    await quote(bQ.id, -118, "sent");
    await quote(bQ.id, -112, "accepted");
    const bInv = await withClock(at(d(-110)), () => convertQuotationToInvoice(db, bQ.id, d(-110)));
    await send(bInv.id, -110);
    await pay(bInv.id, -100, "2000", "bank", "WISE-1188");
    await pay(bInv.id, -70, "2900", "bank", "WISE-1290");

    // Brightline: new invoice, sent and not yet due.
    const bInv2 = await doc("invoice", brightline.id, -5, 9, "USD", [
      { description: "Website copywriting (pages)", quantity: "6", unitPrice: "180" },
      { description: "Consulting hours", quantity: "7.5", unitPrice: "95" },
    ]);
    await send(bInv2.id, -5);

    // Chowdhury Dental: big website project, quote accepted, invoice deposit paid.
    const dQ = await doc("quotation", dental.id, -40, -10, "BDT", [
      { description: "Website design & development (8 pages)", quantity: "1", unitPrice: "120000", taxRateId: "vat5" },
      { description: "Online appointment booking module", quantity: "1", unitPrice: "45000", taxRateId: "vat5" },
      { description: "Domain & hosting (1 year)", quantity: "1", unitPrice: "8500" },
    ], "50% advance, 50% on launch.");
    await quote(dQ.id, -38, "sent");
    await quote(dQ.id, -33, "accepted");
    const dInv = await withClock(at(d(-32)), () => convertQuotationToInvoice(db, dQ.id, d(-32)));
    await send(dInv.id, -32);
    await pay(dInv.id, -28, "90875", "bank", "CITY-77812");

    // Nusrat: small paid invoice, plus a draft.
    const nInv = await doc("invoice", nusrat.id, -75, -61, "BDT", [{ description: "Portfolio website template customisation", quantity: "1", unitPrice: "18000" }]);
    await send(nInv.id, -75);
    await pay(nInv.id, -66, "18000", "nagad", "NG-221");
    await doc("invoice", nusrat.id, -1, 13, "BDT", [{ description: "Business card design", quantity: "1", unitPrice: "3500" }]);

    // Brandt (USD): catalogue design paid in full; new quote awaiting reply.
    const brInv = await doc("invoice", brandt.id, -95, -81, "USD", [
      { description: "Product catalogue layout (pages)", quantity: "24", unitPrice: "65" },
      { description: "Cover design", quantity: "1", unitPrice: "350" },
    ]);
    await send(brInv.id, -95);
    await pay(brInv.id, -84, "1910", "bank", "SEPA-4410");
    const brQ = await doc("quotation", brandt.id, -6, 24, "USD", [
      { description: "Spring catalogue layout (pages)", quantity: "32", unitPrice: "65" },
      { description: "Rush delivery surcharge", quantity: "1", unitPrice: "250" },
    ]);
    await quote(brQ.id, -6, "sent");

    // Hasan: a draft quotation and a rejected one.
    await doc("quotation", hasan.id, -2, 28, "BDT", [{ description: "Facebook shop setup & catalogue upload", quantity: "1", unitPrice: "22000", taxRateId: "vat15" }]);
    const hQ = await doc("quotation", hasan.id, -60, -30, "BDT", [{ description: "Monthly ads management", quantity: "3", unitPrice: "15000" }]);
    await quote(hQ.id, -59, "sent");
    await quote(hQ.id, -50, "rejected");

    // Uddin Traders: an old cancelled invoice, then the customer is archived.
    const uInv = await doc("invoice", uddin.id, -150, -136, "BDT", [{ description: "Shop signboard design", quantity: "1", unitPrice: "6000" }]);
    await withClock(at(d(-140)), () => cancelInvoice(db, uInv.id));
    await db.orm.update(customersTable).set({ archivedAt: at(d(-130)) }).where(db.byId(customersTable, uddin.id));

    // Follow-ups: overdue, today, upcoming and done.
    const fu = (title: string, due: number, customerId: number, documentId?: number, note = "") =>
      withClock(at(d(Math.min(due, 0) - 3)), () => createFollowUp(db, { title, dueDate: d(due), customerId, documentId, note }));
    await fu("Chase remaining balance for product photography", -3, hasan.id, hInv.id, "Promised payment after Eid sales.");
    await fu("Call about launch date and final payment", 0, dental.id, dInv.id);
    await fu("Check if Brandt reviewed the spring catalogue quote", 3, brandt.id, brQ.id);
    await fu("Send monthly social media report", 5, rahman.id);
    await fu("Ask Sarah for a testimonial", 12, brightline.id);
    const done = await fu("Confirm portfolio site went live", -60, nusrat.id, nInv.id);
    await withClock(at(d(-59)), () => setFollowUpCompleted(db, done, true));
  });
}
