import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { TenantDb } from "../db";
import { idEq, nowIso } from "../db";
import { customers, documentItems, documents, payments } from "../db/schema";
import { calculateDocument, type DiscountType, type LineInput } from "../calc";
import { formatMoney, type Currency } from "../money";
import { addDays, todayIso } from "../dates";
import { allocateDocumentNumber } from "../numbering";
import {
  applyPayment,
  assertCanCancelInvoice,
  assertCanRevertToDraft,
  assertInvoiceTransition,
  assertQuotationTransition,
  invoiceDisplayStatus,
  isInvoiceEditable,
  isQuotationEditable,
  quotationDisplayStatus,
  removePayment,
  TransitionError,
  type InvoiceDisplayStatus,
  type InvoiceStatus,
  type QuotationDisplayStatus,
  type QuotationStatus,
} from "../status";
import { documentSchema, paymentSchema, type DocumentInput, type PaymentInput, type TaxRate } from "../validation";
import { logActivity } from "./activity";
import { getCustomer, NotFoundError } from "./customers";
import { getSettings, saveSettings } from "./settings";

export type DocumentKind = "quotation" | "invoice";

export interface DocumentItem {
  id: number;
  position: number;
  description: string;
  quantityMilli: number;
  unitPrice: number;
  discountType: DiscountType;
  discountValue: number;
  taxName: string;
  taxRateBps: number;
  lineTotal: number;
}

export interface DocumentRow {
  id: number;
  kind: DocumentKind;
  number: string;
  status: InvoiceStatus | QuotationStatus;
  displayStatus: InvoiceDisplayStatus | QuotationDisplayStatus;
  customerId: number;
  customerName: string;
  customerCompany: string;
  issueDate: string;
  dueDate: string | null;
  currency: Currency;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  balance: number;
  notes: string;
  terms: string;
  sourceDocumentId: number | null;
  sentAt: string | null;
  paidAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  id: number;
  invoiceId: number;
  amount: number;
  paidAt: string;
  method: string;
  reference: string;
  note: string;
  createdAt: string;
}

export interface DocumentDetail extends DocumentRow {
  items: DocumentItem[];
  payments: Payment[];
  /** For quotations: the invoice created from it. For invoices: the source quotation. */
  linked: { id: number; kind: DocumentKind; number: string } | null;
}

const documentColumns = {
  id: documents.id,
  kind: documents.kind,
  number: documents.number,
  status: sql<InvoiceStatus | QuotationStatus>`${documents.status}`,
  customerId: documents.customerId,
  customerName: customers.name,
  customerCompany: customers.company,
  issueDate: documents.issueDate,
  dueDate: documents.dueDate,
  currency: documents.currency,
  subtotal: documents.subtotal,
  discountTotal: documents.discountTotal,
  taxTotal: documents.taxTotal,
  total: documents.total,
  amountPaid: documents.amountPaid,
  balance: sql<number>`${documents.total} - ${documents.amountPaid}`,
  notes: documents.notes,
  terms: documents.terms,
  sourceDocumentId: documents.sourceDocumentId,
  sentAt: documents.sentAt,
  paidAt: documents.paidAt,
  cancelledAt: documents.cancelledAt,
  createdAt: documents.createdAt,
  updatedAt: documents.updatedAt,
};

/** Documents of this business with their customer. */
const selectDocuments = (db: TenantDb) =>
  db.orm
    .select(documentColumns)
    .from(documents)
    .innerJoin(customers, and(eq(customers.accountId, documents.accountId), eq(customers.id, documents.customerId)))
    .$dynamic();

const paymentColumns = {
  id: payments.id,
  invoiceId: payments.invoiceId,
  amount: payments.amount,
  paidAt: payments.paidAt,
  method: payments.method,
  reference: payments.reference,
  note: payments.note,
  createdAt: payments.createdAt,
};

const linkColumns = { id: documents.id, kind: documents.kind, number: documents.number };

function withDisplay(row: Omit<DocumentRow, "displayStatus">, today: string): DocumentRow {
  const displayStatus =
    row.kind === "invoice"
      ? invoiceDisplayStatus({ status: row.status as InvoiceStatus, dueDate: row.dueDate }, today)
      : quotationDisplayStatus({ status: row.status as QuotationStatus, dueDate: row.dueDate }, today);
  return { ...row, displayStatus };
}

const label = (kind: DocumentKind) => (kind === "invoice" ? "Invoice" : "Quotation");

function resolveLines(
  items: DocumentInput["items"],
  taxRates: TaxRate[],
): (LineInput & { description: string; taxName: string })[] {
  return items.map((item) => {
    const rate = item.taxRateId ? taxRates.find((t) => t.id === item.taxRateId) : undefined;
    if (item.taxRateId && !rate) throw new TransitionError(`Unknown tax rate "${item.taxRateId}"`);
    return {
      description: item.description,
      quantityMilli: item.quantity,
      unitPrice: item.unitPrice,
      discountType: item.discountType,
      discountValue: item.discountValue,
      taxRateBps: rate?.rateBps ?? 0,
      taxName: rate && rate.rateBps > 0 ? rate.name : "",
    };
  });
}

async function writeItems(db: TenantDb, documentId: number, lines: ReturnType<typeof resolveLines>) {
  const totals = calculateDocument(lines);
  await db.orm.delete(documentItems).where(and(db.owns(documentItems), idEq(documentItems.documentId, documentId)));
  if (lines.length === 0) return totals;
  // One multi-row insert: each round trip to a hosted database costs a few milliseconds.
  await db.orm.insert(documentItems).values(
    lines.map((l, i) => ({
      accountId: db.accountId,
      documentId,
      position: i,
      description: l.description,
      quantityMilli: l.quantityMilli,
      unitPrice: l.unitPrice,
      discountType: l.discountType,
      discountValue: l.discountValue,
      taxName: l.taxName,
      taxRateBps: l.taxRateBps,
      lineTotal: totals.lines[i].total,
    })),
  );
  return totals;
}

async function requireActiveCustomer(db: TenantDb, customerId: number, allowArchivedId?: number) {
  const customer = await getCustomer(db, customerId);
  if (!customer) throw new NotFoundError("Customer");
  if (customer.archivedAt && customer.id !== allowArchivedId) {
    throw new TransitionError("Archived customers cannot receive new documents");
  }
  return customer;
}

/** Call inside a transaction: it reads and then advances the counter in settings. */
export async function nextDocumentNumber(db: TenantDb, kind: DocumentKind, issueDate: string): Promise<string> {
  const settings = await getSettings(db);
  const cfg = kind === "invoice" ? settings.invoiceNumbering : settings.quotationNumbering;
  const taken = new Set(
    (await db.orm.select({ number: documents.number }).from(documents).where(and(db.owns(documents), eq(documents.kind, kind)))).map(
      (r) => r.number,
    ),
  );
  const { number, next } = allocateDocumentNumber(cfg, Number(issueDate.slice(0, 4)), (n) => taken.has(n));
  if (kind === "invoice") settings.invoiceNumbering.next = next;
  else settings.quotationNumbering.next = next;
  await saveSettings(db, settings);
  return number;
}

export async function createDocument(
  db: TenantDb,
  kind: DocumentKind,
  raw: unknown,
  opts: { sourceDocumentId?: number } = {},
): Promise<DocumentDetail> {
  const input = documentSchema.parse(raw);
  return db.tx(async (db) => {
    const customer = await requireActiveCustomer(db, input.customerId);
    const settings = await getSettings(db);
    const lines = resolveLines(input.items, settings.taxRates);
    const number = await nextDocumentNumber(db, kind, input.issueDate);
    const now = nowIso();
    const totals = calculateDocument(lines);
    const [{ id }] = await db.orm
      .insert(documents)
      .values({
        accountId: db.accountId,
        kind,
        number,
        status: "draft",
        customerId: customer.id,
        issueDate: input.issueDate,
        dueDate: input.dueDate,
        currency: input.currency,
        notes: input.notes,
        terms: input.terms,
        sourceDocumentId: opts.sourceDocumentId ?? null,
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: documents.id });
    await writeItems(db, id, lines);
    await logActivity(db, {
      type: `${kind}.created`,
      message: `${label(kind)} ${number} created for ${customer.name} (${formatMoney(totals.total, input.currency)})`,
      customerId: customer.id,
      documentId: id,
    });
    return (await getDocument(db, id))!;
  });
}

export async function updateDocument(db: TenantDb, id: number, raw: unknown): Promise<DocumentDetail> {
  const input = documentSchema.parse(raw);
  return db.tx(async (db) => {
    const doc = await getDocument(db, id);
    if (!doc) throw new NotFoundError("Document");
    const editable =
      doc.kind === "invoice"
        ? isInvoiceEditable(doc.status as InvoiceStatus)
        : isQuotationEditable(doc.status as QuotationStatus);
    if (!editable) throw new TransitionError(`This ${doc.kind} can no longer be edited`);
    const customer = await requireActiveCustomer(db, input.customerId, doc.customerId);
    const lines = resolveLines(input.items, (await getSettings(db)).taxRates);
    const totals = await writeItems(db, id, lines);
    await db.orm
      .update(documents)
      .set({
        customerId: customer.id,
        issueDate: input.issueDate,
        dueDate: input.dueDate,
        currency: input.currency,
        notes: input.notes,
        terms: input.terms,
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        updatedAt: nowIso(),
      })
      .where(db.byId(documents, id));
    await logActivity(db, {
      type: `${doc.kind}.updated`,
      message: `${label(doc.kind)} ${doc.number} updated`,
      customerId: customer.id,
      documentId: id,
    });
    return (await getDocument(db, id))!;
  });
}

export async function getDocument(db: TenantDb, id: number, today: string = todayIso()): Promise<DocumentDetail | null> {
  const [row] = await selectDocuments(db).where(db.byId(documents, id));
  if (!row) return null;
  const [items, paid, [linked]] = await db.parallel(
    () =>
      db.orm
        .select({
          id: documentItems.id,
          position: documentItems.position,
          description: documentItems.description,
          quantityMilli: documentItems.quantityMilli,
          unitPrice: documentItems.unitPrice,
          discountType: documentItems.discountType,
          discountValue: documentItems.discountValue,
          taxName: documentItems.taxName,
          taxRateBps: documentItems.taxRateBps,
          lineTotal: documentItems.lineTotal,
        })
        .from(documentItems)
        .where(and(db.owns(documentItems), eq(documentItems.documentId, id)))
        .orderBy(asc(documentItems.position)),
    async (): Promise<Payment[]> =>
      row.kind !== "invoice"
        ? []
        : db.orm
            .select(paymentColumns)
            .from(payments)
            .where(and(db.owns(payments), eq(payments.invoiceId, id)))
            .orderBy(asc(payments.paidAt), asc(payments.id)),
    async (): Promise<NonNullable<DocumentDetail["linked"]>[]> =>
      row.kind === "invoice"
        ? row.sourceDocumentId
          ? db.orm.select(linkColumns).from(documents).where(db.byId(documents, row.sourceDocumentId))
          : []
        : db.orm.select(linkColumns).from(documents).where(and(db.owns(documents), eq(documents.sourceDocumentId, id))),
  );
  return { ...withDisplay(row, today), items, payments: paid, linked: linked ?? null };
}

export interface DocumentFilter {
  status?: string;
  customerId?: number;
  search?: string;
}

export async function listDocuments(
  db: TenantDb,
  kind: DocumentKind,
  filter: DocumentFilter = {},
  today: string = todayIso(),
): Promise<DocumentRow[]> {
  const q = filter.search?.trim() ? `%${filter.search.trim()}%` : null;
  const rows = (
    await selectDocuments(db)
      .where(
        and(
          db.owns(documents),
          eq(documents.kind, kind),
          filter.customerId ? idEq(documents.customerId, filter.customerId) : undefined,
          q ? or(ilike(documents.number, q), ilike(customers.name, q), ilike(customers.company, q)) : undefined,
        ),
      )
      .orderBy(desc(documents.issueDate), desc(documents.id))
  ).map((r) => withDisplay(r, today));
  if (!filter.status || filter.status === "all") return rows;
  if (filter.status === "unpaid") return rows.filter((r) => ["sent", "partially_paid", "overdue"].includes(r.displayStatus));
  return rows.filter((r) => r.displayStatus === filter.status);
}

async function requireDoc(db: TenantDb, id: number, kind: DocumentKind): Promise<DocumentDetail> {
  const doc = await getDocument(db, id);
  if (!doc || doc.kind !== kind) throw new NotFoundError(label(kind));
  return doc;
}

// ---------- Quotation lifecycle ----------

export async function setQuotationStatus(db: TenantDb, id: number, to: QuotationStatus): Promise<DocumentDetail> {
  if (to === "converted") throw new TransitionError("Use convert to invoice instead");
  return db.tx(async (db) => {
    const q = await requireDoc(db, id, "quotation");
    assertQuotationTransition(q.status as QuotationStatus, to);
    const now = nowIso();
    await db.orm
      .update(documents)
      .set({ status: to, sentAt: sql`COALESCE(${documents.sentAt}, ${to === "sent" ? now : null})`, updatedAt: now })
      .where(db.byId(documents, id));
    await logActivity(db, {
      type: `quotation.${to}`,
      message: `Quotation ${q.number} marked ${to}`,
      customerId: q.customerId,
      documentId: id,
    });
    return (await getDocument(db, id))!;
  });
}

/**
 * Create a draft invoice from an accepted quotation. A partial unique index
 * guarantees a quotation can only ever produce one invoice.
 */
export async function convertQuotationToInvoice(db: TenantDb, quotationId: number, issueDate: string): Promise<DocumentDetail> {
  return db.tx(async (db) => {
    const q = await requireDoc(db, quotationId, "quotation");
    if (q.status !== "accepted") throw new TransitionError("Only accepted quotations can be converted to invoices");
    if (q.linked) throw new TransitionError(`Already converted to invoice ${q.linked.number}`);
    const settings = await getSettings(db);
    const dueDate = addDays(issueDate, settings.paymentTermsDays);
    const invoice = await createInsertFromItems(db, q, issueDate, dueDate, settings.invoiceTerms);
    assertQuotationTransition("accepted", "converted");
    await db.orm.update(documents).set({ status: "converted", updatedAt: nowIso() }).where(db.byId(documents, quotationId));
    await logActivity(db, {
      type: "quotation.converted",
      message: `Quotation ${q.number} converted to invoice ${invoice.number}`,
      customerId: q.customerId,
      documentId: quotationId,
    });
    return invoice;
  });
}

/** Copies quotation lines verbatim (including the tax snapshot) into a new invoice. */
async function createInsertFromItems(
  db: TenantDb,
  q: DocumentDetail,
  issueDate: string,
  dueDate: string,
  terms: string,
): Promise<DocumentDetail> {
  const number = await nextDocumentNumber(db, "invoice", issueDate);
  const now = nowIso();
  const [{ id }] = await db.orm
    .insert(documents)
    .values({
      accountId: db.accountId,
      kind: "invoice",
      number,
      status: "draft",
      customerId: q.customerId,
      issueDate,
      dueDate,
      currency: q.currency,
      subtotal: q.subtotal,
      discountTotal: q.discountTotal,
      taxTotal: q.taxTotal,
      total: q.total,
      notes: q.notes,
      terms,
      sourceDocumentId: q.id,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: documents.id });
  const lines = q.items.map((i) => ({ ...i }));
  const totals = await writeItems(db, id, lines);
  if (totals.total !== q.total) throw new Error("Converted totals do not match the quotation");
  await logActivity(db, {
    type: "invoice.created",
    message: `Invoice ${number} created from quotation ${q.number} (${formatMoney(q.total, q.currency)})`,
    customerId: q.customerId,
    documentId: id,
  });
  return (await getDocument(db, id))!;
}

// ---------- Invoice lifecycle ----------

export async function markInvoiceSent(db: TenantDb, id: number): Promise<DocumentDetail> {
  return db.tx(async (db) => {
    const inv = await requireDoc(db, id, "invoice");
    if (inv.total <= 0) throw new TransitionError("An invoice must have a total greater than zero");
    assertInvoiceTransition(inv.status as InvoiceStatus, "sent");
    const now = nowIso();
    await db.orm
      .update(documents)
      .set({ status: "sent", sentAt: sql`COALESCE(${documents.sentAt}, ${now})`, updatedAt: now })
      .where(db.byId(documents, id));
    await logActivity(db, { type: "invoice.sent", message: `Invoice ${inv.number} marked as sent`, customerId: inv.customerId, documentId: id });
    return (await getDocument(db, id))!;
  });
}

export async function revertInvoiceToDraft(db: TenantDb, id: number): Promise<DocumentDetail> {
  return db.tx(async (db) => {
    const inv = await requireDoc(db, id, "invoice");
    assertCanRevertToDraft({ status: inv.status as InvoiceStatus, amountPaid: inv.amountPaid });
    await db.orm.update(documents).set({ status: "draft", updatedAt: nowIso() }).where(db.byId(documents, id));
    await logActivity(db, { type: "invoice.draft", message: `Invoice ${inv.number} moved back to draft`, customerId: inv.customerId, documentId: id });
    return (await getDocument(db, id))!;
  });
}

export async function cancelInvoice(db: TenantDb, id: number): Promise<DocumentDetail> {
  return db.tx(async (db) => {
    const inv = await requireDoc(db, id, "invoice");
    assertCanCancelInvoice({ status: inv.status as InvoiceStatus, amountPaid: inv.amountPaid });
    const now = nowIso();
    await db.orm.update(documents).set({ status: "cancelled", cancelledAt: now, updatedAt: now }).where(db.byId(documents, id));
    await logActivity(db, { type: "invoice.cancelled", message: `Invoice ${inv.number} cancelled`, customerId: inv.customerId, documentId: id });
    return (await getDocument(db, id))!;
  });
}

export async function recordPayment(db: TenantDb, invoiceId: number, raw: unknown): Promise<Payment> {
  const input: PaymentInput = paymentSchema.parse(raw);
  return db.tx(async (db) => {
    const inv = await requireDoc(db, invoiceId, "invoice");
    const next = applyPayment({ status: inv.status as InvoiceStatus, total: inv.total, amountPaid: inv.amountPaid }, input.amount);
    const [payment] = await db.orm
      .insert(payments)
      .values({
        accountId: db.accountId,
        invoiceId: inv.id,
        amount: input.amount,
        paidAt: input.paidAt,
        method: input.method,
        reference: input.reference,
        note: input.note,
        createdAt: nowIso(),
      })
      .returning(paymentColumns);
    await db.orm
      .update(documents)
      .set({ amountPaid: next.amountPaid, status: next.status, paidAt: next.status === "paid" ? input.paidAt : null, updatedAt: nowIso() })
      .where(db.byId(documents, inv.id));
    await logActivity(db, {
      type: "payment.recorded",
      message: `Payment of ${formatMoney(input.amount, inv.currency)} received for ${inv.number}${next.status === "paid" ? " (paid in full)" : ""}`,
      customerId: inv.customerId,
      documentId: invoiceId,
    });
    return payment;
  });
}

export async function deletePayment(db: TenantDb, paymentId: number): Promise<DocumentDetail> {
  return db.tx(async (db) => {
    const [p] = await db.orm
      .select({ id: payments.id, invoiceId: payments.invoiceId, amount: payments.amount })
      .from(payments)
      .where(db.byId(payments, paymentId));
    if (!p) throw new NotFoundError("Payment");
    const inv = await requireDoc(db, p.invoiceId, "invoice");
    const next = removePayment({ status: inv.status as InvoiceStatus, total: inv.total, amountPaid: inv.amountPaid }, p.amount);
    await db.orm.delete(payments).where(db.byId(payments, p.id));
    await db.orm
      .update(documents)
      .set({ amountPaid: next.amountPaid, status: next.status, paidAt: null, updatedAt: nowIso() })
      .where(db.byId(documents, inv.id));
    await logActivity(db, {
      type: "payment.removed",
      message: `Payment of ${formatMoney(p.amount, inv.currency)} removed from ${inv.number}`,
      customerId: inv.customerId,
      documentId: inv.id,
    });
    return (await getDocument(db, inv.id))!;
  });
}

/** Only drafts with no payments or linked documents can be deleted. Issued documents are cancelled instead. */
export async function deleteDraftDocument(db: TenantDb, id: number): Promise<void> {
  await db.tx(async (db) => {
    const doc = await getDocument(db, id);
    if (!doc) throw new NotFoundError("Document");
    if (doc.status !== "draft") throw new TransitionError("Only drafts can be deleted");
    if (doc.linked && doc.kind === "quotation") throw new TransitionError("This quotation has an invoice");
    await db.orm.delete(documents).where(db.byId(documents, doc.id));
    if (doc.kind === "invoice" && doc.sourceDocumentId) {
      // Deleting the draft invoice re-opens the quotation it came from.
      await db.orm
        .update(documents)
        .set({ status: "accepted", updatedAt: nowIso() })
        .where(and(db.byId(documents, doc.sourceDocumentId), eq(documents.status, "converted")));
    }
    await logActivity(db, { type: `${doc.kind}.deleted`, message: `${label(doc.kind)} draft ${doc.number} deleted`, customerId: doc.customerId });
  });
}

/** Every payment with its invoice and customer, oldest first (CSV export). */
export async function paymentLedger(db: TenantDb) {
  return db.orm
    .select({
      paidAt: payments.paidAt,
      number: documents.number,
      customerName: customers.name,
      currency: documents.currency,
      amount: payments.amount,
      method: payments.method,
      reference: payments.reference,
      note: payments.note,
    })
    .from(payments)
    .innerJoin(documents, and(eq(documents.accountId, payments.accountId), eq(documents.id, payments.invoiceId)))
    .innerJoin(customers, and(eq(customers.accountId, documents.accountId), eq(customers.id, documents.customerId)))
    .where(db.owns(payments))
    .orderBy(asc(payments.paidAt), asc(payments.id));
}
