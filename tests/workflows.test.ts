import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type DB } from "@/lib/db";
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
import { authenticate, createSession, createUser, sessionUser } from "@/lib/services/auth";
import { toCsv } from "@/lib/csv";

let db: DB;
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

beforeEach(() => {
  db = openDatabase(":memory:");
});

describe("customers", () => {
  it("creates, edits, searches and archives", () => {
    const c = customer();
    customer("Tanvir Hasan");
    updateCustomer(db, c.id, { ...c, notes: "VIP client" });
    expect(listCustomers(db, { search: "rahman" }).map((x) => x.name)).toEqual(["Farhana Rahman"]);
    expect(listCustomers(db, { search: "%" })).toHaveLength(0); // LIKE wildcards are escaped
    setCustomerArchived(db, c.id, true);
    expect(listCustomers(db).map((x) => x.name)).toEqual(["Tanvir Hasan"]);
    expect(listCustomers(db, { archivedOnly: true })[0].notes).toBe("VIP client");
  });

  it("validates input", () => {
    expect(() => createCustomer(db, { name: "", email: "nope" } as never)).toThrow();
  });

  it("blocks new documents for archived customers", () => {
    const c = customer();
    setCustomerArchived(db, c.id, true);
    expect(() => createDocument(db, "invoice", docInput(c.id))).toThrow(/Archived/);
  });
});

describe("quotation to invoice workflow", () => {
  it("calculates totals server side, converts once, and keeps totals", () => {
    const c = customer();
    const q = createDocument(db, "quotation", docInput(c.id));
    // 2 x 500 = 1000, -10% = 900, +15% VAT = 1035; hosting 1200.50 => 2235.50
    expect(q.number).toBe("QT-2026-0001");
    expect(q.subtotal).toBe(220050);
    expect(q.discountTotal).toBe(10000);
    expect(q.taxTotal).toBe(13500);
    expect(q.total).toBe(223550);
    expect(q.items[0].taxName).toBe("VAT 15%");

    expect(() => convertQuotationToInvoice(db, q.id, TODAY)).toThrow(/accepted/);
    setQuotationStatus(db, q.id, "sent");
    setQuotationStatus(db, q.id, "accepted");
    const inv = convertQuotationToInvoice(db, q.id, TODAY);
    expect(inv.kind).toBe("invoice");
    expect(inv.number).toBe("INV-2026-0001");
    expect(inv.total).toBe(q.total);
    expect(inv.items).toHaveLength(2);
    expect(inv.dueDate).toBe("2026-11-12"); // 14 day default terms
    expect(getDocument(db, q.id)!.status).toBe("converted");
    expect(getDocument(db, q.id)!.linked?.number).toBe(inv.number);
    expect(() => convertQuotationToInvoice(db, q.id, TODAY)).toThrow();
  });

  it("deleting the draft invoice re-opens the quotation", () => {
    const c = customer();
    const q = createDocument(db, "quotation", docInput(c.id));
    setQuotationStatus(db, q.id, "accepted");
    const inv = convertQuotationToInvoice(db, q.id, TODAY);
    deleteDraftDocument(db, inv.id);
    expect(getDocument(db, q.id)!.status).toBe("accepted");
  });

  it("tax snapshot survives settings changes", () => {
    const c = customer();
    const q = createDocument(db, "quotation", docInput(c.id));
    const s = getSettings(db);
    saveSettings(db, { ...s, taxRates: s.taxRates.map((t) => (t.id === "vat15" ? { ...t, rateBps: 2000 } : t)) });
    expect(getDocument(db, q.id)!.total).toBe(223550);
  });
});

describe("invoice workflow", () => {
  it("issues unique numbers even if the counter is lowered", () => {
    const c = customer();
    const a = createDocument(db, "invoice", docInput(c.id));
    const s = getSettings(db);
    saveSettings(db, { ...s, invoiceNumbering: { ...s.invoiceNumbering, next: 1 } });
    const b = createDocument(db, "invoice", docInput(c.id));
    expect(a.number).toBe("INV-2026-0001");
    expect(b.number).toBe("INV-2026-0002");
    expect(() =>
      db.prepare("UPDATE documents SET number = ? WHERE id = ?").run(a.number, b.id),
    ).toThrow(/UNIQUE/);
  });

  it("goes draft -> sent -> partially paid -> paid with payment history", () => {
    const c = customer();
    const inv = createDocument(db, "invoice", docInput(c.id));
    expect(() => recordPayment(db, inv.id, { amount: "100", paidAt: TODAY, method: "cash" })).toThrow(/sent/);
    markInvoiceSent(db, inv.id);
    recordPayment(db, inv.id, { amount: "1000", paidAt: "2026-10-05", method: "bkash", reference: "TX1" });
    let d = getDocument(db, inv.id, TODAY)!;
    expect(d.status).toBe("partially_paid");
    expect(d.displayStatus).toBe("overdue"); // due 2026-10-15
    expect(d.balance).toBe(123550);
    expect(() => recordPayment(db, inv.id, { amount: "1235.51", paidAt: TODAY, method: "cash" })).toThrow(/exceeds/);
    recordPayment(db, inv.id, { amount: "1235.50", paidAt: TODAY, method: "bank" });
    d = getDocument(db, inv.id, TODAY)!;
    expect(d.status).toBe("paid");
    expect(d.displayStatus).toBe("paid");
    expect(d.paidAt).toBe(TODAY);
    expect(d.payments.map((p) => p.amount)).toEqual([100000, 123550]);
    expect(() => cancelInvoice(db, inv.id)).toThrow();

    deletePayment(db, d.payments[1].id);
    expect(getDocument(db, inv.id)!.status).toBe("partially_paid");
  });

  it("only drafts are editable; cancelled is terminal", () => {
    const c = customer();
    const inv = createDocument(db, "invoice", docInput(c.id));
    updateDocument(db, inv.id, docInput(c.id, { notes: "updated" }));
    markInvoiceSent(db, inv.id);
    expect(() => updateDocument(db, inv.id, docInput(c.id))).toThrow(/edited/);
    cancelInvoice(db, inv.id);
    expect(() => markInvoiceSent(db, inv.id)).toThrow();
    expect(() => recordPayment(db, inv.id, { amount: "1", paidAt: TODAY, method: "cash" })).toThrow();
    expect(() => deleteDraftDocument(db, inv.id)).toThrow();
  });

  it("filters by derived status", () => {
    const c = customer();
    const a = createDocument(db, "invoice", docInput(c.id));
    markInvoiceSent(db, a.id);
    createDocument(db, "invoice", docInput(c.id, { dueDate: "2026-12-01" }));
    expect(listDocuments(db, "invoice", { status: "overdue" }, TODAY).map((d) => d.id)).toEqual([a.id]);
    expect(listDocuments(db, "invoice", { status: "draft" }, TODAY)).toHaveLength(1);
    expect(listDocuments(db, "invoice", { status: "unpaid" }, TODAY)).toHaveLength(1);
  });

  it("rejects invalid documents", () => {
    const c = customer();
    expect(() => createDocument(db, "invoice", docInput(c.id, { items: [] }))).toThrow();
    expect(() => createDocument(db, "invoice", docInput(c.id, { dueDate: "2026-09-01" }))).toThrow();
    expect(() =>
      createDocument(db, "invoice", docInput(c.id, { items: [{ description: "x", quantity: "-1", unitPrice: "1" }] })),
    ).toThrow();
    expect(() =>
      createDocument(db, "invoice", docInput(c.id, { items: [{ description: "x", quantity: "1", unitPrice: "1", taxRateId: "bogus" }] })),
    ).toThrow(/tax/);
  });
});

describe("follow-ups", () => {
  it("filters pending, overdue and completed", () => {
    const c = customer();
    const a = createFollowUp(db, { title: "Call", dueDate: "2026-10-20", customerId: c.id });
    createFollowUp(db, { title: "Email", dueDate: TODAY, customerId: c.id });
    createFollowUp(db, { title: "Visit", dueDate: "2026-11-05" });
    expect(listFollowUps(db, { filter: "overdue" }, TODAY).map((f) => f.title)).toEqual(["Call"]);
    expect(listFollowUps(db, { filter: "pending" }, TODAY).map((f) => f.title)).toEqual(["Email", "Visit"]);
    expect(reminderCounts(db, TODAY)).toEqual({ overdue: 1, dueToday: 1 });
    setFollowUpCompleted(db, a, true);
    expect(listFollowUps(db, { filter: "completed" }, TODAY).map((f) => f.title)).toEqual(["Call"]);
    expect(reminderCounts(db, TODAY).overdue).toBe(0);
  });
});

describe("reports", () => {
  it("summarises revenue, outstanding balances and activity per currency", () => {
    const c1 = customer();
    const c2 = customer("Sarah Mitchell");
    const a = createDocument(db, "invoice", docInput(c1.id, { issueDate: "2026-09-10", dueDate: "2026-09-20" }));
    markInvoiceSent(db, a.id);
    recordPayment(db, a.id, { amount: "1000", paidAt: "2026-09-25", method: "cash" });
    const b = createDocument(db, "invoice", docInput(c2.id, { currency: "USD", issueDate: "2026-10-02", dueDate: "2026-11-02" }));
    markInvoiceSent(db, b.id);
    recordPayment(db, b.id, { amount: "2235.50", paidAt: "2026-10-03", method: "bank" });

    const months = revenueByMonth(db, { months: 3, currency: "BDT", today: TODAY });
    expect(months.map((m) => m.month)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(months[1]).toMatchObject({ invoiced: 223550, received: 100000 });
    expect(revenueByMonth(db, { months: 1, currency: "USD", today: TODAY })[0].received).toBe(223550);

    const out = outstandingBalances(db, TODAY);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ customerName: "Farhana Rahman", currency: "BDT", total: 123550, days31to60: 123550 });

    const stats = dashboardStats(db, TODAY);
    expect(stats.invoiceCount).toBe(2);
    expect(stats.paid).toEqual({ BDT: 100000, USD: 223550 });
    expect(stats.outstanding).toEqual({ BDT: 123550 });
    expect(stats.overdueCount).toBe(1);

    const active = mostActiveCustomers(db, { since: "2026-01-01" });
    expect(active.map((r) => r.customerName).sort()).toEqual(["Farhana Rahman", "Sarah Mitchell"]);
    expect(active.every((r) => r.activityCount === 2)).toBe(true);
    expect(active.find((r) => r.customerName === "Sarah Mitchell")!.received).toEqual({ USD: 223550 });
  });
});

describe("demo data, reset and backup", () => {
  it("seeds consistent demo data that survives a backup round trip", () => {
    seedDemoData(db, TODAY);
    const before = dashboardStats(db, TODAY);
    expect(before.invoiceCount).toBeGreaterThan(5);
    expect(before.overdueCount).toBeGreaterThan(0);
    // Every stored total matches its lines.
    const bad = db
      .prepare(
        `SELECT d.id FROM documents d WHERE d.total != (SELECT COALESCE(SUM(line_total),0) FROM document_items i WHERE i.document_id = d.id)`,
      )
      .all();
    expect(bad).toEqual([]);

    const backup = JSON.parse(JSON.stringify(exportBackup(db)));
    resetBusinessData(db);
    expect(dashboardStats(db, TODAY).invoiceCount).toBe(0);
    expect(getSettings(db).invoiceNumbering.next).toBe(1);
    restoreBackup(db, backup);
    expect(dashboardStats(db, TODAY)).toEqual(before);
  });
});

describe("auth", () => {
  it("hashes passwords and validates sessions", () => {
    createUser(db, "owner", "correct horse battery");
    expect(authenticate(db, "owner", "wrong password!")).toBeNull();
    const u = authenticate(db, "OWNER", "correct horse battery");
    expect(u?.username).toBe("owner");
    const hash = (db.prepare("SELECT password_hash FROM users").get() as { password_hash: string }).password_hash;
    expect(hash).not.toContain("correct");
    const { token } = createSession(db, u!.id, 1);
    expect(sessionUser(db, token)?.id).toBe(u!.id);
    expect(sessionUser(db, token + "x")).toBeNull();
  });
});

describe("csv", () => {
  it("escapes values and neutralises spreadsheet formulas", () => {
    expect(toCsv(["a", "b"], [["x,y", 'He said "hi"'], ["=SUM(A1)", 5]])).toBe(
      'a,b\r\n"x,y","He said ""hi"""\r\n\'=SUM(A1),5\r\n',
    );
  });
});
