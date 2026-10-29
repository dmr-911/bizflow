import { beforeEach, describe, expect, it } from "vitest";
import { getDb, type TenantDb } from "@/lib/db";
import { createCustomer, listCustomers, setCustomerArchived, updateCustomer } from "@/lib/services/customers";
import {
  cancelInvoice,
  convertQuotationToInvoice,
  createDocument,
  deleteDraftDocument,
  deletePayment,
  getDocument,
  listDocuments,
  markInvoiceSent,
  recordPayment,
  setQuotationStatus,
  updateDocument,
} from "@/lib/services/documents";
import { createFollowUp, listFollowUps, reminderCounts, setFollowUpCompleted } from "@/lib/services/followups";
import { dashboardStats, mostActiveCustomers, outstandingBalances, revenueByMonth } from "@/lib/services/reports";
import { getSettings, saveSettings } from "@/lib/services/settings";
import { exportBackup, resetBusinessData, restoreBackup } from "@/lib/services/data";
import { seedDemoData } from "@/lib/services/seed";
import {
  authenticate,
  createAccount,
  createPasswordReset,
  createSession,
  EmailTakenError,
  isResetTokenValid,
  resetPassword,
  sessionUser,
} from "@/lib/services/auth";
import { toCsv } from "@/lib/csv";
import { newTenant, useTestDatabase } from "./helpers/db";

useTestDatabase();

let db: TenantDb;
const TODAY = "2026-10-29";

const customer = (name = "Farhana Rahman", company = name === "Farhana Rahman" ? "Rahman Textiles" : "") =>
  createCustomer(db, { name, company, email: "f@example.com", phone: "", address: "", city: "Dhaka", country: "BD", taxId: "", notes: "" });

const docInput = (customerId: number, overrides: Record<string, unknown> = {}) => ({
  customerId,
  issueDate: "2026-10-01",
  dueDate: "2026-10-15",
  currency: "BDT",
  notes: "",
  terms: "",
  items: [
    { description: "Design", quantity: "2", unitPrice: "500", discountType: "percent", discountValue: "10", taxRateId: "vat15" },
    { description: "Hosting", quantity: "1", unitPrice: "1200.50", discountType: "amount", discountValue: "0", taxRateId: "none" },
  ],
  ...overrides,
});

beforeEach(async () => {
  db = await newTenant();
});

describe("customers", () => {
  it("creates, edits, searches and archives", async () => {
    const c = await customer();
    await customer("Tanvir Hasan");
    await updateCustomer(db, c.id, { ...c, notes: "VIP client" });
    expect((await listCustomers(db, { search: "rahman" })).map((x) => x.name)).toEqual(["Farhana Rahman"]);
    expect(await listCustomers(db, { search: "%" })).toHaveLength(0); // LIKE wildcards are escaped
    await setCustomerArchived(db, c.id, true);
    expect((await listCustomers(db)).map((x) => x.name)).toEqual(["Tanvir Hasan"]);
    expect((await listCustomers(db, { archivedOnly: true }))[0].notes).toBe("VIP client");
  });

  it("validates input", async () => {
    await expect(createCustomer(db, { name: "", email: "nope" } as never)).rejects.toThrow();
  });

  it("blocks new documents for archived customers", async () => {
    const c = await customer();
    await setCustomerArchived(db, c.id, true);
    await expect(createDocument(db, "invoice", docInput(c.id))).rejects.toThrow(/Archived/);
  });
});

describe("quotation to invoice workflow", () => {
  it("calculates totals server side, converts once, and keeps totals", async () => {
    const c = await customer();
    const q = await createDocument(db, "quotation", docInput(c.id));
    // 2 x 500 = 1000, -10% = 900, +15% VAT = 1035; hosting 1200.50 => 2235.50
    expect(q.number).toBe("QT-2026-0001");
    expect(q.subtotal).toBe(220050);
    expect(q.discountTotal).toBe(10000);
    expect(q.taxTotal).toBe(13500);
    expect(q.total).toBe(223550);
    expect(q.items[0].taxName).toBe("VAT 15%");

    await expect(convertQuotationToInvoice(db, q.id, TODAY)).rejects.toThrow(/accepted/);
    await setQuotationStatus(db, q.id, "sent");
    await setQuotationStatus(db, q.id, "accepted");
    const inv = await convertQuotationToInvoice(db, q.id, TODAY);
    expect(inv.kind).toBe("invoice");
    expect(inv.number).toBe("INV-2026-0001");
    expect(inv.total).toBe(q.total);
    expect(inv.items).toHaveLength(2);
    expect(inv.dueDate).toBe("2026-11-12"); // 14 day default terms
    expect((await getDocument(db, q.id))!.status).toBe("converted");
    expect((await getDocument(db, q.id))!.linked?.number).toBe(inv.number);
    await expect(convertQuotationToInvoice(db, q.id, TODAY)).rejects.toThrow();
  });

  it("deleting the draft invoice re-opens the quotation", async () => {
    const c = await customer();
    const q = await createDocument(db, "quotation", docInput(c.id));
    await setQuotationStatus(db, q.id, "accepted");
    const inv = await convertQuotationToInvoice(db, q.id, TODAY);
    await deleteDraftDocument(db, inv.id);
    expect((await getDocument(db, q.id))!.status).toBe("accepted");
  });

  it("tax snapshot survives settings changes", async () => {
    const c = await customer();
    const q = await createDocument(db, "quotation", docInput(c.id));
    const s = await getSettings(db);
    await saveSettings(db, { ...s, taxRates: s.taxRates.map((t) => (t.id === "vat15" ? { ...t, rateBps: 2000 } : t)) });
    expect((await getDocument(db, q.id))!.total).toBe(223550);
  });
});

describe("invoice workflow", () => {
  it("issues unique numbers even if the counter is lowered", async () => {
    const c = await customer();
    const a = await createDocument(db, "invoice", docInput(c.id));
    const s = await getSettings(db);
    await saveSettings(db, { ...s, invoiceNumbering: { ...s.invoiceNumbering, next: 1 } });
    const b = await createDocument(db, "invoice", docInput(c.id));
    expect(a.number).toBe("INV-2026-0001");
    expect(b.number).toBe("INV-2026-0002");
    await expect(db.run("UPDATE documents SET number = $2 WHERE account_id = $1 AND id = $3", db.accountId, a.number, b.id)).rejects.toThrow(
      /documents_account_id_kind_number_key/,
    );
  });

  it("goes draft -> sent -> partially paid -> paid with payment history", async () => {
    const c = await customer();
    const inv = await createDocument(db, "invoice", docInput(c.id));
    await expect(recordPayment(db, inv.id, { amount: "100", paidAt: TODAY, method: "cash" })).rejects.toThrow(/sent/);
    await markInvoiceSent(db, inv.id);
    await recordPayment(db, inv.id, { amount: "1000", paidAt: "2026-10-05", method: "bkash", reference: "TX1" });
    let d = (await getDocument(db, inv.id, TODAY))!;
    expect(d.status).toBe("partially_paid");
    expect(d.displayStatus).toBe("overdue"); // due 2026-10-15
    expect(d.balance).toBe(123550);
    await expect(recordPayment(db, inv.id, { amount: "1235.51", paidAt: TODAY, method: "cash" })).rejects.toThrow(/exceeds/);
    await recordPayment(db, inv.id, { amount: "1235.50", paidAt: TODAY, method: "bank" });
    d = (await getDocument(db, inv.id, TODAY))!;
    expect(d.status).toBe("paid");
    expect(d.displayStatus).toBe("paid");
    expect(d.paidAt).toBe(TODAY);
    expect(d.payments.map((p) => p.amount)).toEqual([100000, 123550]);
    await expect(cancelInvoice(db, inv.id)).rejects.toThrow();

    await deletePayment(db, d.payments[1].id);
    expect((await getDocument(db, inv.id))!.status).toBe("partially_paid");
  });

  it("only drafts are editable; cancelled is terminal", async () => {
    const c = await customer();
    const inv = await createDocument(db, "invoice", docInput(c.id));
    await updateDocument(db, inv.id, docInput(c.id, { notes: "updated" }));
    await markInvoiceSent(db, inv.id);
    await expect(updateDocument(db, inv.id, docInput(c.id))).rejects.toThrow(/edited/);
    await cancelInvoice(db, inv.id);
    await expect(markInvoiceSent(db, inv.id)).rejects.toThrow();
    await expect(recordPayment(db, inv.id, { amount: "1", paidAt: TODAY, method: "cash" })).rejects.toThrow();
    await expect(deleteDraftDocument(db, inv.id)).rejects.toThrow();
  });

  it("filters by derived status", async () => {
    const c = await customer();
    const a = await createDocument(db, "invoice", docInput(c.id));
    await markInvoiceSent(db, a.id);
    await createDocument(db, "invoice", docInput(c.id, { dueDate: "2026-12-01" }));
    expect((await listDocuments(db, "invoice", { status: "overdue" }, TODAY)).map((d) => d.id)).toEqual([a.id]);
    expect(await listDocuments(db, "invoice", { status: "draft" }, TODAY)).toHaveLength(1);
    expect(await listDocuments(db, "invoice", { status: "unpaid" }, TODAY)).toHaveLength(1);
  });

  it("rejects invalid documents", async () => {
    const c = await customer();
    await expect(createDocument(db, "invoice", docInput(c.id, { items: [] }))).rejects.toThrow();
    await expect(createDocument(db, "invoice", docInput(c.id, { dueDate: "2026-09-01" }))).rejects.toThrow();
    await expect(
      createDocument(db, "invoice", docInput(c.id, { items: [{ description: "x", quantity: "-1", unitPrice: "1" }] })),
    ).rejects.toThrow();
    await expect(
      createDocument(db, "invoice", docInput(c.id, { items: [{ description: "x", quantity: "1", unitPrice: "1", taxRateId: "bogus" }] })),
    ).rejects.toThrow(/tax/);
  });
});

describe("follow-ups", () => {
  it("filters pending, overdue and completed", async () => {
    const c = await customer();
    const a = await createFollowUp(db, { title: "Call", dueDate: "2026-10-20", customerId: c.id });
    await createFollowUp(db, { title: "Email", dueDate: TODAY, customerId: c.id });
    await createFollowUp(db, { title: "Visit", dueDate: "2026-11-05" });
    expect((await listFollowUps(db, { filter: "overdue" }, TODAY)).map((f) => f.title)).toEqual(["Call"]);
    expect((await listFollowUps(db, { filter: "pending" }, TODAY)).map((f) => f.title)).toEqual(["Email", "Visit"]);
    expect(await reminderCounts(db, TODAY)).toEqual({ overdue: 1, dueToday: 1 });
    await setFollowUpCompleted(db, a, true);
    expect((await listFollowUps(db, { filter: "completed" }, TODAY)).map((f) => f.title)).toEqual(["Call"]);
    expect((await reminderCounts(db, TODAY)).overdue).toBe(0);
  });
});

describe("reports", () => {
  it("summarises revenue, outstanding balances and activity per currency", async () => {
    const c1 = await customer();
    const c2 = await customer("Sarah Mitchell");
    const a = await createDocument(db, "invoice", docInput(c1.id, { issueDate: "2026-09-10", dueDate: "2026-09-20" }));
    await markInvoiceSent(db, a.id);
    await recordPayment(db, a.id, { amount: "1000", paidAt: "2026-09-25", method: "cash" });
    const b = await createDocument(db, "invoice", docInput(c2.id, { currency: "USD", issueDate: "2026-10-02", dueDate: "2026-11-02" }));
    await markInvoiceSent(db, b.id);
    await recordPayment(db, b.id, { amount: "2235.50", paidAt: "2026-10-03", method: "bank" });

    const months = await revenueByMonth(db, { months: 3, currency: "BDT", today: TODAY });
    expect(months.map((m) => m.month)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(months[1]).toMatchObject({ invoiced: 223550, received: 100000 });
    expect((await revenueByMonth(db, { months: 1, currency: "USD", today: TODAY }))[0].received).toBe(223550);

    const out = await outstandingBalances(db, TODAY);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ customerName: "Farhana Rahman", currency: "BDT", total: 123550, days31to60: 123550 });

    const stats = await dashboardStats(db, TODAY);
    expect(stats.invoiceCount).toBe(2);
    expect(stats.paid).toEqual({ BDT: 100000, USD: 223550 });
    expect(stats.outstanding).toEqual({ BDT: 123550 });
    expect(stats.overdueCount).toBe(1);

    const active = await mostActiveCustomers(db, { since: "2026-01-01" });
    expect(active.map((r) => r.customerName).sort()).toEqual(["Farhana Rahman", "Sarah Mitchell"]);
    expect(active.every((r) => r.activityCount === 2)).toBe(true);
    expect(active.find((r) => r.customerName === "Sarah Mitchell")!.received).toEqual({ USD: 223550 });
  });
});

describe("demo data, reset and backup", () => {
  it("seeds consistent demo data that survives a backup round trip", async () => {
    await seedDemoData(db, TODAY);
    const before = await dashboardStats(db, TODAY);
    expect(before.invoiceCount).toBeGreaterThan(5);
    expect(before.overdueCount).toBeGreaterThan(0);
    // Every stored total matches its lines.
    const bad = await db.all(
      `SELECT d.id FROM documents d WHERE d.account_id = $1
         AND d.total != (SELECT COALESCE(SUM(line_total), 0) FROM document_items i WHERE i.account_id = d.account_id AND i.document_id = d.id)`,
      db.accountId,
    );
    expect(bad).toEqual([]);

    const backup = JSON.parse(JSON.stringify(await exportBackup(db)));
    await resetBusinessData(db);
    expect((await dashboardStats(db, TODAY)).invoiceCount).toBe(0);
    expect((await getSettings(db)).invoiceNumbering.next).toBe(1);
    await restoreBackup(db, backup);
    expect(await dashboardStats(db, TODAY)).toEqual(before);
  });
});

describe("auth", () => {
  it("creates an account with a trial, hashes passwords and validates sessions", async () => {
    const control = await getDb();
    const { accountId, userId } = await createAccount(
      control,
      { name: "Farhana", businessName: "Rahman Textiles", email: "Owner@Example.com", password: "correct horse battery" },
      { trialDays: 14 },
    );
    await expect(
      createAccount(control, { name: "X", businessName: "Y", email: "owner@example.com", password: "another password" }, { trialDays: 14 }),
    ).rejects.toThrow(EmailTakenError);
    expect(await authenticate(control, "owner@example.com", "wrong password!")).toBeNull();
    const u = await authenticate(control, " OWNER@example.com ", "correct horse battery");
    expect(u).toMatchObject({ id: userId, accountId, email: "owner@example.com", businessName: "Rahman Textiles" });
    const { password_hash: hash } = (await control.get<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", userId))!;
    expect(hash).not.toContain("correct");
    const { token } = await createSession(control, u!.id, 1);
    expect((await sessionUser(control, token))?.accountId).toBe(accountId);
    expect(await sessionUser(control, token + "x")).toBeNull();
  });

  it("resets a password once with an emailed token and signs out old sessions", async () => {
    const control = await getDb();
    const { userId } = await createAccount(control, { name: "A", businessName: "B", email: "a@example.com", password: "first password 1" }, { trialDays: 14 });
    const { token: session } = await createSession(control, userId, 1);
    expect(await createPasswordReset(control, "nobody@example.com")).toBeNull();
    const reset = (await createPasswordReset(control, "A@example.com"))!;
    expect(await isResetTokenValid(control, reset)).toBe(true);
    expect(await resetPassword(control, reset, "second password 2")).toBe(userId);
    expect(await resetPassword(control, reset, "third password 3")).toBeNull();
    expect(await sessionUser(control, session)).toBeNull();
    expect((await authenticate(control, "a@example.com", "second password 2"))?.id).toBe(userId);
  });
});

describe("csv", () => {
  it("escapes values and neutralises spreadsheet formulas", () => {
    expect(toCsv(["a", "b"], [["x,y", 'He said "hi"'], ["=SUM(A1)", 5]])).toBe(
      'a,b\r\n"x,y","He said ""hi"""\r\n\'=SUM(A1),5\r\n',
    );
  });
});
